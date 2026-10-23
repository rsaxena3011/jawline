/**
 * Brand view model: the aggregate coverage screen. It answers one
 * question for the brand side: across the study set, how often did
 * this catalog give each scan a safe answer, and where are the gaps?
 *
 * The discipline, same as the receipt view: this module contains
 * NO verdict logic of its own. The aggregate is computed by running
 * runDecision, the same engine entry point the check page uses,
 * once per study tone, over the same default inputs the receipt
 * flow builds (the study framing that passed, no owned bottles),
 * and then counting the verdicts on the receipts that come back.
 * If a number cannot be read off those six receipts, it does not
 * appear on this screen.
 *
 * The three non-BUY verdicts are reported as three separate
 * buckets, never merged into one scary number: a SHADE-RISK (a
 * near match the engine will not call safe), a NO (nothing in the
 * catalog sits in range), and a CAN'T TELL (the reading itself
 * could not separate the candidates) are different problems for a
 * brand, with different fixes. The coverage-gap line counts every
 * tone without a safe BUY, and the breakdown line right under it
 * un-merges that count again.
 *
 * Honesty, stated on the screen itself: the six tones are the
 * synthetic study faces, the catalog is the fixture catalog
 * standing in for the licensed one, the set is small by design,
 * and these are study results, not population statistics. Every
 * percentage is shown with its count of 6 beside it.
 */

import type { Catalog } from "../catalog/types.ts";
import { runDecision, type Verdict } from "../decision/decision.ts";
import { STUDY_TONES, studyFixtureCatalog } from "../decision/fixtures.ts";
import { fixtureFraming } from "./fixture-session.ts";

/** Canonical verdict order, the order the receipt names them. */
export const BRAND_VERDICT_ORDER: readonly Verdict[] = [
  "BUY",
  "SHADE-RISK",
  "NO",
  "CAN'T TELL",
];

export interface BrandToneRow {
  toneId: string;
  label: string;
  /** The skin_color reading the engine judged, verbatim. */
  readingHex: string;
  /** Study ground truth (pixel medians), shown for contrast. */
  pixelHex: string;
  verdict: Verdict;
  reasonTag: string;
  /** The receipt headline for this tone, verbatim from the engine. */
  headline: string;
}

export interface BrandVerdictRow {
  verdict: Verdict;
  count: number;
  total: number;
  /** "2 of 6 (33%)": a percentage never appears without its count. */
  shareText: string;
  /** Ids of the tones in this bucket, in study order. */
  toneIds: string[];
  /** "tone2 (warm medium), tone3 (golden tan)", or "none". */
  toneListText: string;
}

export interface BrandView {
  total: number;
  perTone: BrandToneRow[];
  verdictRows: BrandVerdictRow[];
  /** Tones with no safe BUY: the total minus the BUY count. */
  gapNumerator: number;
  gapDenominator: number;
  /** "5 of 6 study tones had no safe BUY in this catalog". */
  coverageGapLine: string;
  /** The gap un-merged again, one count per non-BUY verdict. */
  gapBreakdownLine: string;
  /** The labelling statements the screen prints about itself. */
  honestyLines: string[];
  /** Every string the screen renders, flattened, for tests. */
  allLines: string[];
}

/**
 * Run the engine once per study tone against the given catalog
 * (the fixture catalog by default, exactly what fixture mode ranks
 * against) and count the receipts. Pure: the same catalog always
 * produces the same view, which is what makes the screen testable
 * and the public replay honest.
 */
export function computeBrandView(
  catalog: Catalog = studyFixtureCatalog(),
): BrandView {
  const framing = fixtureFraming("study-crop").measurement;

  const perTone: BrandToneRow[] = STUDY_TONES.map((tone) => {
    const receipt = runDecision({
      capture: framing,
      skinTone: tone.result,
      catalog,
      ownedShades: [],
    });
    return {
      toneId: tone.id,
      label: tone.label,
      readingHex: tone.result.skinColorHex,
      pixelHex: tone.pixelHex,
      verdict: receipt.verdict,
      reasonTag: receipt.reasonTag,
      headline: receipt.headline,
    };
  });

  const total = perTone.length;

  const verdictRows: BrandVerdictRow[] = BRAND_VERDICT_ORDER.map(
    (verdict) => {
      const tones = perTone.filter((row) => row.verdict === verdict);
      const count = tones.length;
      const pct = Math.round((count / total) * 100);
      return {
        verdict,
        count,
        total,
        shareText: `${count} of ${total} (${pct}%)`,
        toneIds: tones.map((row) => row.toneId),
        toneListText:
          tones.length === 0
            ? "none"
            : tones.map((row) => `${row.toneId} (${row.label})`).join(", "),
      };
    },
  );

  const countOf = (verdict: Verdict): number =>
    verdictRows.find((row) => row.verdict === verdict)?.count ?? 0;

  const gapNumerator = total - countOf("BUY");
  const gapDenominator = total;
  const coverageGapLine = `${gapNumerator} of ${gapDenominator} study tones had no safe BUY in this catalog`;
  const gapBreakdownLine =
    `Counted separately, never merged: SHADE-RISK ${countOf("SHADE-RISK")} of ${total}, ` +
    `NO ${countOf("NO")} of ${total}, CAN'T TELL ${countOf("CAN'T TELL")} of ${total}. ` +
    "A shade risk, an empty range and an unreadable gap are three different problems, with three different fixes.";

  const honestyLines: string[] = [
    "How this was counted: the same decision engine that prints the check page receipt ran once per study tone, with the study framing that passed and no owned bottles listed, and the verdicts on those six receipts were counted. Nothing on this screen is computed any other way.",
    "Study set: the six tones are the synthetic faces from the C088 measurement study, each generated to a known skin tone. The set is small by design: six tones, one per band the study covered.",
    "Catalog: the shades ranked here are the fixture catalog, placeholder shades invented for the study and labelled fixture in their own records, standing in for the licensed catalog until it lands.",
    "These are study results on six synthetic faces, not population statistics. They describe how this catalog covers this test set, and nothing wider.",
    "Every share is a count of 6 first. The percentage beside it is that same count rounded to the nearest percent, never a separate measurement.",
  ];

  const allLines: string[] = [
    coverageGapLine,
    gapBreakdownLine,
    ...verdictRows.map(
      (row) => `${row.verdict} ${row.shareText} ${row.toneListText}`,
    ),
    ...perTone.map(
      (row) =>
        `${row.toneId} ${row.label} ${row.readingHex} ${row.pixelHex} ${row.verdict} ${row.reasonTag} ${row.headline}`,
    ),
    ...honestyLines,
  ];

  return {
    total,
    perTone,
    verdictRows,
    gapNumerator,
    gapDenominator,
    coverageGapLine,
    gapBreakdownLine,
    honestyLines,
    allLines,
  };
}
