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
 * - BUY follows the cluster rule (boss ruling 2026-10-23, closing
 *   defects #10 and #6). The original rule demanded the winner beat
 *   the runner-up by more than the noise floor; against a real
 *   catalog of 617 shades the top two sit 0.25 to 1.10 apart, far
 *   inside the floors, so BUY could never fire and the product
 *   shipped as a machine that only hedges. The ruling separates
 *   two risks the margin rule had merged: "this shade might not
 *   match your face" is a real risk; "this shade might not be
 *   uniquely the best" is no risk when the near-tied alternatives
 *   are themselves matches. So: the cluster is every shade within
 *   the band's noise floor of the winner's distance, and BUY fires
 *   when the winner is inside the match range and every cluster
 *   member is inside it too. The receipt names the whole cluster
 *   and never claims a unique winner the measurement cannot
 *   support. SHADE-RISK is what remains genuinely risky: a cluster
 *   member outside the match range, where the reading cannot
 *   separate a match from a near miss.
 * - The floors come from the study: two honest measurements of the
 *   same face (API reading vs pixel medians) disagreed by 4.6 to
 *   13.3 CIEDE2000, worst at the pale end, where adjacent faces'
 *   readings sit 1.6 to 1.7 apart despite being clearly different
 *   people. That is why the pale band's cluster is wider: at the
 *   pale end more shades count as within noise of the winner.
 *
 * Thresholds below are working values derived from that one study.
 * They are stated on the receipt, not hidden.
 */

import type { Catalog, ShadeEntry } from "../catalog/types.ts";
import { TASK_COSTS } from "../config.ts";
import type { SkinToneResult } from "../youcam/types.ts";
import { checkCapture, type CaptureMeasurement } from "./capture.ts";
import { deltaE2000, hexToLab, isHexColor } from "./color.ts";

/** A shade counts as a match candidate within this CIEDE2000 distance. */
export const MATCH_MAX_DELTA_E = 6.0;

/**
 * Standard cluster width: a shade whose distance from the measured
 * tone sits within this much of the winner's distance counts as
 * within measurement noise of the winner, and joins its cluster.
 * Set just above the smallest separation between two genuinely
 * different faces' readings in the mid cluster (tone2 vs tone3,
 * 2.85 in the study).
 */
export const MARGIN_NOISE_STANDARD = 3.0;

/**
 * Pale-end cluster width: wider, per the study. Pale readings
 * compress hardest (tone5 and tone6 readings sit 1.73 apart for
 * clearly different faces; tone6's reading disagreed with its own
 * face by 13.26), so at the pale end more shades count as within
 * noise of the winner, and the cluster reaches further.
 */
export const MARGIN_NOISE_PALE = 5.0;

/** Readings at or above this CIELAB lightness count as pale-end. */
export const PALE_BAND_MIN_L = 60;

export type Verdict = "BUY" | "SHADE-RISK" | "NO" | "CAN'T TELL";

export type ReasonTag =
  | "clear-match"
  | "cluster-match"
  | "candidates-within-noise"
  | "already-own-it"
  | "no-shade-in-range"
  | "capture-rejected"
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

/**
 * One member of the winner's cluster: a shade within the band's
 * noise floor of the winner's distance. The engine marks whether
 * the member itself sits inside the match range, because that is
 * the fact the BUY rule turns on (and the receipt view copies the
 * mark rather than recomputing it).
 */
export interface ClusterMember {
  shade: ShadeEntry;
  /** CIEDE2000 distance from the measured tone. */
  distance: number;
  /** True when this member is itself inside the match range. */
  inMatchRange: boolean;
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
  /**
   * The winner's cluster, winner first: every shade within the
   * noise floor of the winner's distance, each marked in or out
   * of the match range. Empty when no cluster was formed (the run
   * short-circuited, or no shade sat inside the match range).
   */
  cluster: ClusterMember[];
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
      cluster: [],
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
      cluster: [],
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
      cluster: [],
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

  const best = ranking[0] ?? null;
  const runnerUp = ranking[1] ?? null;
  const margin =
    best && runnerUp ? round2(runnerUp.distance - best.distance) : null;

  // Step 5: the cluster evaluation (cluster rule, boss ruling
  // 2026-10-23). The cluster is every shade within the band's
  // noise floor of the winner's distance. It only exists when
  // there is a winner inside the match range to cluster around.
  const cluster: ClusterMember[] =
    best && best.distance <= MATCH_MAX_DELTA_E
      ? ranking
          .filter((row) => row.distance <= best.distance + noiseFloor)
          .map((row) => ({
            shade: row.shade,
            distance: row.distance,
            inMatchRange: row.distance <= MATCH_MAX_DELTA_E,
          }))
      : [];
  const clusterOutsiders = cluster.filter((row) => !row.inMatchRange);
  if (!best) {
    skipped(
      "cluster-evaluation",
      "Not run: this catalog has no shades, so there is no top pick to cluster around.",
    );
  } else if (best.distance > MATCH_MAX_DELTA_E) {
    skipped(
      "cluster-evaluation",
      `Not run: the closest shade sits ${round2(best.distance)} from your measured tone, outside the match range of ${MATCH_MAX_DELTA_E}, so there is no match to cluster around.`,
    );
  } else {
    done(
      "cluster-evaluation",
      `Cluster check: ${cluster.length} shade${cluster.length === 1 ? "" : "s"} sit within the noise floor of ${noiseFloor} around the top pick's distance of ${round2(best.distance)}; ${clusterOutsiders.length === 0 ? "every one of them is inside" : `${clusterOutsiders.length} of them fall${clusterOutsiders.length === 1 ? "s" : ""} outside`} the match range of ${MATCH_MAX_DELTA_E}.`,
    );
  }

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

  const base = {
    measuredToneHex: toneHex,
    fixtureMode: !live,
    ranking,
    cluster,
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

  const bestLabel = `${best.shade.brand} ${best.shade.shadeName}`;

  // SHADE-RISK: the winner matches, but the measurement cannot
  // separate it from a near miss: at least one shade within noise
  // of the winner falls outside the match range.
  if (clusterOutsiders.length > 0) {
    const firstOutsider = clusterOutsiders[0];
    return {
      ...base,
      verdict: "SHADE-RISK",
      reasonTag: "candidates-within-noise",
      headline: `Shade risk: ${bestLabel} matches your measured tone at ${round2(best.distance)}, but ${clusterOutsiders.length} shade${clusterOutsiders.length === 1 ? "" : "s"} within measurement noise of it fall${clusterOutsiders.length === 1 ? "s" : ""} outside the match range of ${MATCH_MAX_DELTA_E} (closest: ${firstOutsider.shade.brand} ${firstOutsider.shade.shadeName} at ${round2(firstOutsider.distance)}). The reading cannot separate a match from a near miss here.`,
    };
  }

  // BUY, cluster of one: no other shade is within noise of the
  // winner, so the pick is the winner outright.
  if (cluster.length <= 1) {
    return {
      ...base,
      verdict: "BUY",
      reasonTag: "clear-match",
      headline: `Buy: ${bestLabel} matches your measured tone at ${round2(best.distance)}, and no other shade in this catalog sits within measurement noise of that match.`,
    };
  }

  // BUY, cluster pick: every shade within noise of the winner is
  // itself a match, so the pick does not rest on telling
  // near-identical shades apart. The headline names the cluster
  // and never claims a unique winner.
  return {
    ...base,
    verdict: "BUY",
    reasonTag: "cluster-match",
    headline: `Buy: top pick is ${bestLabel} at ${round2(best.distance)}; ${cluster.length} shades sit within measurement noise of each other here and all of them match your measured tone. This is a cluster pick, not a unique winner.`,
  };
}
