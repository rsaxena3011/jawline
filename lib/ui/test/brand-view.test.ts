import { parseCatalog, type Catalog } from "../../catalog/types.ts";
import { runDecision, type Verdict } from "../../decision/decision.ts";
import {
  STUDY_TONES,
  studyFixtureCatalog,
} from "../../decision/fixtures.ts";
import { buildFixtureInput } from "../fixture-session.ts";
import {
  BRAND_VERDICT_ORDER,
  computeBrandView,
  type BrandView,
} from "../brand-view.ts";

/**
 * Brand screen: the aggregate must be nothing but the engine's own
 * receipts, counted. Every assertion here computes the per-tone
 * verdicts independently, through the same path the check page
 * uses (buildFixtureInput into runDecision), and compares the
 * tallies, the per-tone rows and the receipt headlines against the
 * aggregate view. A screen that computed its own verdicts, rounded
 * its own way, or quietly merged the uncomfortable buckets would
 * fail. The tampered-catalog run at the end pushes a damaged
 * catalog through the same code path and checks the distribution
 * moves the way the damage says it must.
 */

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string) {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}`);
  }
}

/** Per-tone engine verdicts, computed without the brand module. */
function independentReceipts(catalog?: Catalog) {
  return STUDY_TONES.map((tone) => {
    if (catalog === undefined) {
      const built = buildFixtureInput({
        toneId: tone.id,
        framingId: "study-crop",
        ownedHex: "",
        ownedName: "",
      });
      if ("error" in built) throw new Error(built.error);
      return runDecision(built.input);
    }
    return runDecision({
      capture: { faceDetected: true, faceWidthPx: 680, imageWidthPx: 1000 },
      skinTone: tone.result,
      catalog,
      ownedShades: [],
    });
  });
}

function tallyOf(verdicts: Verdict[]): Map<Verdict, number> {
  const tally = new Map<Verdict, number>();
  for (const verdict of BRAND_VERDICT_ORDER) tally.set(verdict, 0);
  for (const verdict of verdicts)
    tally.set(verdict, (tally.get(verdict) ?? 0) + 1);
  return tally;
}

function rowsMatchEngine(view: BrandView, catalog?: Catalog): boolean {
  const receipts = independentReceipts(catalog);
  const tally = tallyOf(receipts.map((r) => r.verdict));
  return (
    view.verdictRows.every(
      (row) => row.count === (tally.get(row.verdict) ?? 0),
    ) &&
    view.perTone.every(
      (row, i) =>
        row.verdict === receipts[i].verdict &&
        row.reasonTag === receipts[i].reasonTag &&
        row.headline === receipts[i].headline,
    )
  );
}

function main() {
  const view = computeBrandView();
  const receipts = independentReceipts();
  const tally = tallyOf(receipts.map((r) => r.verdict));

  // ---- The aggregate is the engine's receipts, counted ----
  check(
    view.total === STUDY_TONES.length && view.perTone.length === 6,
    "the aggregate covers exactly the six study tones",
  );
  check(
    rowsMatchEngine(view),
    "every verdict count equals the tally of per-tone runDecision receipts computed independently",
  );
  check(
    view.perTone.every(
      (row, i) => row.headline === receipts[i].headline,
    ),
    "each tone's headline on the brand screen is its receipt headline, verbatim",
  );
  check(
    view.verdictRows.reduce((sum, row) => sum + row.count, 0) === view.total,
    "the four bucket counts sum to the six tones, nothing lost or double counted",
  );

  // ---- Buckets stay separate, and name their tones ----
  check(
    view.verdictRows.map((row) => row.verdict).join("|") ===
      BRAND_VERDICT_ORDER.join("|"),
    "the buckets are reported one per verdict, in verdict order, never merged",
  );
  check(
    view.verdictRows.every((row) => {
      const expected = view.perTone
        .filter((tone) => tone.verdict === row.verdict)
        .map((tone) => tone.toneId);
      return (
        row.toneIds.join("|") === expected.join("|") &&
        row.count === expected.length
      );
    }),
    "each bucket names exactly the tones the engine put in it",
  );

  // ---- The coverage-gap line carries the counts it claims ----
  const buyCount = tally.get("BUY") ?? 0;
  check(
    view.gapNumerator === view.total - buyCount &&
      view.gapDenominator === view.total &&
      view.coverageGapLine ===
        `${view.total - buyCount} of ${view.total} study tones had no safe BUY in this catalog`,
    "the coverage-gap line's numerator and denominator are the engine's own counts",
  );
  check(
    view.gapBreakdownLine.includes(
      `SHADE-RISK ${tally.get("SHADE-RISK")} of ${view.total}`,
    ) &&
      view.gapBreakdownLine.includes(`NO ${tally.get("NO")} of ${view.total}`) &&
      view.gapBreakdownLine.includes(
        `CAN'T TELL ${tally.get("CAN'T TELL")} of ${view.total}`,
      ) &&
      view.gapNumerator ===
        (tally.get("SHADE-RISK") ?? 0) +
          (tally.get("NO") ?? 0) +
          (tally.get("CAN'T TELL") ?? 0),
    "the breakdown line un-merges the gap into its three verdict counts, which sum back to the gap",
  );

  // ---- No percentage without its count ----
  check(
    view.verdictRows.every(
      (row) =>
        row.shareText ===
        `${row.count} of ${row.total} (${Math.round((row.count / row.total) * 100)}%)`,
    ),
    "every share is its count of 6 with the rounded percentage beside it, in that order",
  );

  // ---- Pinned baseline, re-derived at slice 6 (cluster rule) ----
  // Every study tone has an exact-match shade in the fixture
  // catalog and every cluster member sits inside the match
  // range, so under the cluster rule (boss ruling 2026-10-23)
  // all six tones return BUY and the gap reads 0 of 6.
  check(
    view.perTone.every((row) => row.verdict === "BUY") &&
      buyCount === 6 &&
      view.coverageGapLine ===
        "0 of 6 study tones had no safe BUY in this catalog",
    "baseline holds under the cluster rule: all six tones BUY against the fixture catalog, gap 0 of 6",
  );

  // ---- Honest labelling is on the screen, not just in this file ----
  const honesty = view.honestyLines.join(" ");
  check(
    honesty.includes("synthetic faces") &&
      honesty.includes("small by design") &&
      honesty.includes("fixture catalog") &&
      honesty.includes("not population statistics"),
    "the screen labels itself: synthetic set, small by design, fixture catalog, not population statistics",
  );
  check(
    view.allLines.includes(view.coverageGapLine) &&
      view.allLines.includes(view.gapBreakdownLine),
    "the flattened screen text carries the gap line and its breakdown",
  );

  // ---- Attack: a tampered catalog through the same code path ----
  const full = studyFixtureCatalog();
  const decoysOnly = parseCatalog({
    version: 1,
    shades: full.shades.filter((shade) => shade.id.startsWith("decoy")),
  });
  const damaged = computeBrandView(decoysOnly);
  check(
    rowsMatchEngine(damaged, decoysOnly),
    "tampered catalog: the aggregate still equals the engine's per-tone receipts, computed the same way",
  );
  check(
    damaged.perTone.every((row) => row.verdict === "NO") &&
      (damaged.verdictRows.find((row) => row.verdict === "NO")?.count ?? 0) ===
        6 &&
      damaged.coverageGapLine ===
        "6 of 6 study tones had no safe BUY in this catalog",
    "tampered catalog: with the closest shades removed, all six tones fall to NO and the gap reads 6 of 6",
  );
  check(
    (damaged.verdictRows.find((row) => row.verdict === "BUY")?.count ?? 0) <
      buyCount &&
      damaged.gapNumerator > view.gapNumerator,
    "the damage moves the distribution the expected way: fewer safe BUYs, a wider gap",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
