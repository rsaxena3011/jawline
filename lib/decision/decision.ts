/**
 * The decision engine: capture gate, owned-bottle check, catalog
 * ranking, verdict. The engine is pure and mode-agnostic: the skin
 * tone reading arrives as a SkinToneResult, recorded (fixture mode)
 * or from one live API call (live mode), in the same shape either
 * way, and the planner log prices each step honestly for the mode
 * it ran in. Whoever calls live mode owns the spend discipline
 * (passcode, caps, ledger, recovery) in lib/live; the engine only
 * reports what it was told the call spent.
 *
 * Verdict rules (MERGED_PLAN_V2, as amended by the 2026-10-22 study):
 * - Only skin_color is load-bearing. Hair, eye and lip colours and
 *   every Skin Analysis score are ignored by this engine; the study
 *   found hair_color wrong on 6 of 6 faces, and raw_score is not a
 *   confidence value.
 * - Makeup VTO never feeds a verdict. The jawline gap metric failed
 *   its validation gate (the renderer moves the neck itself), so a
 *   VTO render is a labelled preview concept only. It appears in the
 *   planner log as a skipped step, with the reason, and nowhere else.
 * - The owned-bottle check runs FIRST, before ranking: if a bottle
 *   the user already owns sits within the buy threshold of their
 *   measured tone, the answer is NO, already own it, and it costs 0
 *   units to say so (defect #7 in DEFECT_LOG).
 * - BUY needs a close match that beats the runner-up by more than
 *   the noise floor for the reading's band. The floors come from the
 *   study: two honest measurements of the same face (API reading vs
 *   pixel medians) disagreed by 4.6 to 13.3 CIEDE2000, worst at the
 *   pale end, where adjacent faces' readings sit 1.6 to 1.7 apart
 *   despite being clearly different people. At the pale end the
 *   reading cannot separate close candidates, so the engine
 *   abstains with CAN'T TELL instead of guessing (defect #6).
 *
 * Thresholds below are working values derived from that one study.
 * They are stated on the receipt, not hidden, and defect #6 stays
 * open until repeatability data (repeated captures) replaces them.
 */

import type { Catalog, ShadeEntry } from "../catalog/types.ts";
import { TASK_COSTS } from "../config.ts";
import type { SkinToneResult } from "../youcam/types.ts";
import { checkCapture, type CaptureMeasurement } from "./capture.ts";
import { deltaE2000, hexToLab, isHexColor } from "./color.ts";

/** A shade counts as a match candidate within this CIEDE2000 distance. */
export const MATCH_MAX_DELTA_E = 6.0;

/**
 * Standard margin: the winner must beat the runner-up by more than
 * this, or the two candidates are within measurement noise. Set
 * just above the smallest separation between two genuinely
 * different faces' readings in the mid cluster (tone2 vs tone3,
 * 2.85 in the study).
 */
export const MARGIN_NOISE_STANDARD = 3.0;

/**
 * Pale-end margin: widest abstention, per the study. Pale readings
 * compress hardest (tone5 and tone6 readings sit 1.73 apart for
 * clearly different faces; tone6's reading disagreed with its own
 * face by 13.26), so a pale winner must clear the runner-up by more
 * than this before the engine will speak at all.
 */
export const MARGIN_NOISE_PALE = 5.0;

/** Readings at or above this CIELAB lightness count as pale-end. */
export const PALE_BAND_MIN_L = 60;

export type Verdict = "BUY" | "SHADE-RISK" | "NO" | "CAN'T TELL";

export type ReasonTag =
  | "clear-match"
  | "candidates-within-noise"
  | "already-own-it"
  | "no-shade-in-range"
  | "capture-rejected"
  | "pale-end-abstention"
  | "reading-unusable";

export interface PlannerStep {
  step: string;
  outcome: "done" | "skipped" | "replayed";
  /** Units actually spent by this step. Always 0 in fixture mode. */
  unitsSpent: number;
  /** What the step would cost live, when that is known. */
  liveUnits: number | null;
  why: string;
}

export interface RankedShade {
  shade: ShadeEntry;
  /** CIEDE2000 distance from the measured tone. */
  distance: number;
}

export interface OwnedMatch {
  shade: ShadeEntry;
  distance: number;
}

export interface Receipt {
  verdict: Verdict;
  reasonTag: ReasonTag;
  /** One plain-language sentence a shopper can act on. */
  headline: string;
  /** The skin_color the verdict rests on, verbatim. Null if none. */
  measuredToneHex: string | null;
  /** True when the reading came from a recorded fixture replay. */
  fixtureMode: boolean;
  /** Full catalog ranking, closest first. Empty when short-circuited. */
  ranking: RankedShade[];
  /** Set when the owned-bottle check decided the outcome. */
  ownedMatch: OwnedMatch | null;
  /** Winner's margin over the runner-up, when a ranking exists. */
  margin: number | null;
  /** Noise floor applied to this reading (band dependent). */
  noiseFloor: number | null;
  /** True when the reading sits in the pale band. */
  paleBand: boolean;
  plannerLog: PlannerStep[];
  /** Total units spent by the whole run. 0 in fixture mode. */
  unitsSpent: number;
}

/**
 * Where the skin tone reading came from. Fixture mode replays a
 * recorded result and spends nothing. Live mode carries the units
 * the real call actually spent (settled from the balance delta, or
 * the verified per-call cost when no balance read was available),
 * so the receipt and the planner log tell the same story in both
 * modes. The verdict logic never branches on this: only the labels
 * and the spend accounting do.
 */
export type ReadingSource =
  | { kind: "fixture" }
  | { kind: "live"; unitsSpent: number; note?: string };

export interface DecisionInput {
  capture: CaptureMeasurement;
  /** Skin Tone result: recorded (fixture) or live, same shape. */
  skinTone: SkinToneResult | null;
  catalog: Catalog;
  /** Bottles the user already owns, as catalog-shaped entries. */
  ownedShades: ShadeEntry[];
  /** Defaults to fixture mode, the only mode slices 1-2 knew. */
  readingSource?: ReadingSource;
}

function rankCatalog(toneHex: string, catalog: Catalog): RankedShade[] {
  const toneLab = hexToLab(toneHex);
  return catalog.shades
    .map((shade) => ({ shade, distance: deltaE2000(toneLab, shade.lab) }))
    .sort((x, y) => x.distance - y.distance);
}

function closestOwned(
  toneHex: string,
  ownedShades: ShadeEntry[],
): OwnedMatch | null {
  const toneLab = hexToLab(toneHex);
  let best: OwnedMatch | null = null;
  for (const shade of ownedShades) {
    const distance = deltaE2000(toneLab, shade.lab);
    if (!best || distance < best.distance) best = { shade, distance };
  }
  return best && best.distance <= MATCH_MAX_DELTA_E ? best : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Run one purchase decision, fixture mode. Pure: the same input
 * always produces the same receipt, which is what makes the public
 * replay and the test suite possible.
 */
export function runDecision(input: DecisionInput): Receipt {
  const source: ReadingSource = input.readingSource ?? { kind: "fixture" };
  const live = source.kind === "live";
  /** Units the live call spent, attributed to this receipt. */
  const liveUnits = live ? source.unitsSpent : 0;
  const log: PlannerStep[] = [];
  const done = (
    step: string,
    why: string,
    liveUnits: number | null = null,
  ): void => {
    log.push({ step, outcome: "done", unitsSpent: 0, liveUnits, why });
  };
  const skipped = (step: string, why: string, liveUnits: number | null = null) =>
    log.push({ step, outcome: "skipped", unitsSpent: 0, liveUnits, why });

  // Step 1: capture gate. Nothing is spent or read before it passes.
  const gate = checkCapture(input.capture);
  if (!gate.ok) {
    done("capture-gate", "Checked the photo framing for 0 units.");
    skipped(
      "skin-tone",
      "Not read: the capture gate rejected the photo.",
      TASK_COSTS["skin-tone"],
    );
    skipped("owned-bottle-check", "Not run: there is no reading to check against.");
    skipped("catalog-ranking", "Not run: there is no reading to rank.");
    return {
      verdict: "CAN'T TELL",
      reasonTag: "capture-rejected",
      headline: `We can't tell from this photo. ${gate.reasons[0]}`,
      measuredToneHex: null,
      fixtureMode: !live,
      ranking: [],
      ownedMatch: null,
      margin: null,
      noiseFloor: null,
      paleBand: false,
      plannerLog: log,
      unitsSpent: 0,
    };
  }
  done(
    "capture-gate",
    `Framing passed: face fills ${Math.round(gate.faceWidthRatio * 100)}% of the photo width.`,
  );

  // Step 2: the reading. Fixture mode replays a recorded result;
  // live mode arrives with the result of one real API call.
  const toneHex = input.skinTone?.skinColorHex ?? null;
  if (!toneHex || !isHexColor(toneHex)) {
    if (live) {
      log.push({
        step: "skin-tone",
        outcome: "done",
        unitsSpent: liveUnits,
        liveUnits: TASK_COSTS["skin-tone"],
        why:
          source.note ??
          "Live mode: the Skin Tone call returned no usable skin_color reading.",
      });
    } else {
      skipped("skin-tone", "No usable skin_color reading was supplied.");
    }
    skipped("owned-bottle-check", "Not run: there is no reading to check against.");
    skipped("catalog-ranking", "Not run: there is no reading to rank.");
    return {
      verdict: "CAN'T TELL",
      reasonTag: "reading-unusable",
      headline:
        "We can't tell: the skin tone reading is missing or unreadable, so no verdict is honest.",
      measuredToneHex: null,
      fixtureMode: !live,
      ranking: [],
      ownedMatch: null,
      margin: null,
      noiseFloor: null,
      paleBand: false,
      plannerLog: log,
      unitsSpent: liveUnits,
    };
  }
  if (live) {
    log.push({
      step: "skin-tone",
      outcome: "done",
      unitsSpent: liveUnits,
      liveUnits: TASK_COSTS["skin-tone"],
      why:
        source.note ??
        "Live mode: one Skin Tone call on the uploaded photo returned this reading. Only its skin_color is used; the same payload's hair colour was wrong on 6 of 6 study faces and is ignored.",
    });
  } else {
    log.push({
      step: "skin-tone",
      outcome: "replayed",
      unitsSpent: 0,
      liveUnits: TASK_COSTS["skin-tone"],
      why: "Fixture mode: replayed a recorded Skin Tone result. Only its skin_color is used; the same payload's hair colour was wrong on 6 of 6 study faces and is ignored.",
    });
  }

  const paleBand = hexToLab(toneHex).l >= PALE_BAND_MIN_L;
  const noiseFloor = paleBand ? MARGIN_NOISE_PALE : MARGIN_NOISE_STANDARD;

  // Step 3: owned-bottle check, FIRST, before any ranking.
  const owned = closestOwned(toneHex, input.ownedShades);
  if (owned) {
    done(
      "owned-bottle-check",
      `A bottle you already own (${owned.shade.brand} ${owned.shade.shadeName}) sits ${round2(owned.distance)} from your measured tone, inside the buy threshold of ${MATCH_MAX_DELTA_E}.`,
    );
    skipped("catalog-ranking", "Not run: you already own a match, so there is no purchase to judge.");
    skipped(
      "skin-analysis",
      "Not run: Skin Analysis scores carry no verdict authority in this product, and no purchase question remains.",
      TASK_COSTS["skin-analysis"],
    );
    return {
      verdict: "NO",
      reasonTag: "already-own-it",
      headline: `Don't buy: you already own ${owned.shade.brand} ${owned.shade.shadeName}, which matches your measured tone.`,
      measuredToneHex: toneHex,
      fixtureMode: !live,
      ranking: [],
      ownedMatch: owned,
      margin: null,
      noiseFloor,
      paleBand,
      plannerLog: log,
      unitsSpent: liveUnits,
    };
  }
  done(
    "owned-bottle-check",
    input.ownedShades.length === 0
      ? "No owned bottles were listed, so there is nothing to match against."
      : "None of your owned bottles sits within the buy threshold of your measured tone.",
  );

  // Step 4: rank the catalog against the reading.
  const ranking = rankCatalog(toneHex, input.catalog);
  done(
    "catalog-ranking",
    `Ranked ${ranking.length} catalog shades by CIEDE2000 against the measured tone, locally, for 0 units.`,
  );
  skipped(
    "skin-analysis",
    "Not run: its scores carry no verdict authority (a low score means a concern is more visible; it is not a confidence value), and the ranking already decides this purchase.",
    TASK_COSTS["skin-analysis"],
  );
  skipped(
    "makeup-vto-preview",
    "Not run: a try-on render is a labelled preview only. The jawline measurement failed its validation gate in the study, so a render can never feed a verdict.",
    TASK_COSTS["makeup-vto"],
  );

  const best = ranking[0] ?? null;
  const runnerUp = ranking[1] ?? null;
  const margin =
    best && runnerUp ? round2(runnerUp.distance - best.distance) : null;

  const base = {
    measuredToneHex: toneHex,
    fixtureMode: !live,
    ranking,
    ownedMatch: null,
    margin,
    noiseFloor,
    paleBand,
    plannerLog: log,
    unitsSpent: liveUnits,
  } as const;

  if (!best || best.distance > MATCH_MAX_DELTA_E) {
    return {
      ...base,
      verdict: "NO",
      reasonTag: "no-shade-in-range",
      headline: best
        ? `Don't buy: the closest shade in this catalog sits ${round2(best.distance)} from your measured tone, outside the match range of ${MATCH_MAX_DELTA_E}.`
        : "Don't buy: this catalog has no shades to check against your measured tone.",
    };
  }

  // A single candidate with no runner-up clears the margin by default.
  const clearMargin = margin === null || margin > noiseFloor;
  if (!clearMargin) {
    if (paleBand) {
      return {
        ...base,
        verdict: "CAN'T TELL",
        reasonTag: "pale-end-abstention",
        headline: `We can't tell: at the pale end, readings compress, and the top two shades sit only ${margin} apart, inside the pale noise floor of ${noiseFloor}. A wrong call here is likelier than a right one.`,
      };
    }
    return {
      ...base,
      verdict: "SHADE-RISK",
      reasonTag: "candidates-within-noise",
      headline: `Shade risk: ${best.shade.brand} ${best.shade.shadeName} ranks first, but the runner-up sits only ${margin} behind it, inside the noise floor of ${noiseFloor}. Either could be your match.`,
    };
  }

  return {
    ...base,
    verdict: "BUY",
    reasonTag: "clear-match",
    headline: `Buy: ${best.shade.brand} ${best.shade.shadeName} matches your measured tone at ${round2(best.distance)}, clear of the runner-up by ${margin === null ? "default (it is the only candidate)" : margin}.`,
  };
}
