/**
 * Receipt view model: turns a decision Receipt into the exact
 * strings the receipt screen renders, and nothing else.
 *
 * The rule this module exists to enforce: the UI renders engine
 * output, it never recomputes it. No distance, margin, threshold or
 * verdict is calculated here. Values are copied out of the Receipt
 * (or out of the engine's own exported constants) and formatted for
 * display through the one formatter below. If a value is not in the
 * engine output, it does not appear on the receipt screen.
 */

import {
  MATCH_MAX_DELTA_E,
  type Receipt,
} from "../decision/decision.ts";

/**
 * The single display format for engine distances. The engine emits
 * raw CIEDE2000 numbers; the screen shows them at two decimals.
 * Tests assert against this same formatter applied to the raw
 * receipt values, so what is tested is what is shipped.
 */
export function formatDistance(n: number): string {
  return n.toFixed(2);
}

export interface ReceiptThresholdRow {
  label: string;
  value: string;
}

export interface ReceiptRankingRow {
  position: number;
  shadeLabel: string;
  hex: string;
  distanceText: string;
}

export interface ReceiptPlannerRow {
  step: string;
  outcome: string;
  unitsText: string;
  why: string;
}

export interface ReceiptView {
  fixtureLabel: string;
  verdict: string;
  headline: string;
  reasonTag: string;
  measuredToneText: string;
  thresholdRows: ReceiptThresholdRow[];
  rankingRows: ReceiptRankingRow[];
  ownedText: string | null;
  plannerRows: ReceiptPlannerRow[];
  unitsSpentText: string;
  /** Every string the screen renders, flattened, for tests. */
  allLines: string[];
}

const NOT_APPLICABLE = "Not applicable on this receipt";

export function buildReceiptView(receipt: Receipt): ReceiptView {
  const fixtureLabel = receipt.fixtureMode
    ? "Fixture mode: this receipt replays recorded study data. No live API call was made."
    : "Live mode receipt.";

  const measuredToneText =
    receipt.measuredToneHex !== null
      ? `Measured tone (skin_color): ${receipt.measuredToneHex}`
      : "Measured tone: no usable reading on this receipt.";

  const thresholdRows: ReceiptThresholdRow[] = [
    { label: "Match range (CIEDE2000)", value: String(MATCH_MAX_DELTA_E) },
    {
      label: "Margin over the runner-up",
      value:
        receipt.margin === null ? NOT_APPLICABLE : String(receipt.margin),
    },
    {
      label: "Noise floor applied",
      value:
        receipt.noiseFloor === null
          ? NOT_APPLICABLE
          : String(receipt.noiseFloor),
    },
    { label: "Pale band reading", value: receipt.paleBand ? "Yes" : "No" },
  ];

  const rankingRows: ReceiptRankingRow[] = receipt.ranking.map((row, i) => ({
    position: i + 1,
    shadeLabel: `${row.shade.brand} ${row.shade.shadeName}`,
    hex: row.shade.hex,
    distanceText: formatDistance(row.distance),
  }));

  const ownedText =
    receipt.ownedMatch !== null
      ? `Already owned match: ${receipt.ownedMatch.shade.brand} ${receipt.ownedMatch.shade.shadeName} (${receipt.ownedMatch.shade.hex}), distance ${formatDistance(receipt.ownedMatch.distance)}.`
      : null;

  const plannerRows: ReceiptPlannerRow[] = receipt.plannerLog.map((step) => ({
    step: step.step,
    outcome: step.outcome,
    unitsText:
      step.liveUnits === null
        ? `Spent ${step.unitsSpent} units`
        : `Spent ${step.unitsSpent} units (live cost: ${step.liveUnits} units)`,
    why: step.why,
  }));

  const unitsSpentText = `Total units spent: ${receipt.unitsSpent}`;

  const allLines: string[] = [
    fixtureLabel,
    receipt.verdict,
    receipt.headline,
    receipt.reasonTag,
    measuredToneText,
    ...thresholdRows.map((row) => `${row.label}: ${row.value}`),
    ...rankingRows.map(
      (row) => `${row.position}. ${row.shadeLabel} ${row.hex} ${row.distanceText}`,
    ),
    ...(ownedText !== null ? [ownedText] : []),
    ...plannerRows.map(
      (row) => `${row.step} ${row.outcome} ${row.unitsText} ${row.why}`,
    ),
    unitsSpentText,
  ];

  return {
    fixtureLabel,
    verdict: receipt.verdict,
    headline: receipt.headline,
    reasonTag: receipt.reasonTag,
    measuredToneText,
    thresholdRows,
    rankingRows,
    ownedText,
    plannerRows,
    unitsSpentText,
    allLines,
  };
}
