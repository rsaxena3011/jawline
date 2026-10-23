import { checkCapture } from "../../decision/capture.ts";
import { runDecision } from "../../decision/decision.ts";
import { studyTone } from "../../decision/fixtures.ts";
import {
  buildFixtureInput,
  faceShareText,
  fixtureFraming,
  type FixtureSelection,
} from "../fixture-session.ts";
import { buildReceiptView, formatDistance } from "../receipt-view.ts";

/**
 * Receipt UI, fixture mode: the screen must render the engine's
 * output unchanged. Every assertion here compares the view model
 * (which is exactly what the receipt screen renders) against the
 * Receipt runDecision produced for the same selections, so a UI
 * that recomputed, rounded differently, or paraphrased would fail.
 * Runs the full path: selections, fixture input, engine, view.
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

function runSelection(selection: FixtureSelection) {
  const built = buildFixtureInput(selection);
  if ("error" in built) {
    throw new Error(`Unexpected fixture input error: ${built.error}`);
  }
  const receipt = runDecision(built.input);
  return { receipt, view: buildReceiptView(receipt) };
}

function thresholdValue(
  view: ReturnType<typeof buildReceiptView>,
  label: string,
): string | undefined {
  return view.thresholdRows.find((row) => row.label === label)?.value;
}

function main() {
  const plain: FixtureSelection = {
    toneId: "tone2",
    framingId: "study-crop",
    ownedHex: "",
    ownedName: "",
  };

  // ---- tone2: cluster BUY reaches the screen verbatim ----
  const tone2 = runSelection(plain);
  check(
    tone2.receipt.verdict === "BUY" &&
      tone2.view.verdict === tone2.receipt.verdict,
    "tone2: the engine says BUY (cluster rule) and the screen's verdict is that value",
  );
  check(
    tone2.view.headline === tone2.receipt.headline,
    "tone2: the cluster BUY headline renders character for character as the engine wrote it",
  );
  check(
    tone2.receipt.cluster.length === 2 &&
      tone2.view.clusterText !== null &&
      tone2.receipt.cluster.every((row) =>
        tone2.view.clusterText?.includes(
          `${row.shade.brand} ${row.shade.shadeName} (${row.shade.hex}) at ${formatDistance(row.distance)}`,
        ),
      ) &&
      thresholdValue(tone2.view, "Shades within noise of the top pick") ===
        "2" &&
      tone2.view.allLines.includes(tone2.view.clusterText),
    "tone2: the cluster reaches the screen with every member's label, hex and the engine's distance, copied not recomputed",
  );
  const runnerUp = tone2.receipt.ranking[1];
  check(
    tone2.view.rankingRows[1]?.distanceText ===
      formatDistance(runnerUp.distance) &&
      tone2.view.rankingRows[1]?.shadeLabel ===
        `${runnerUp.shade.brand} ${runnerUp.shade.shadeName}`,
    "tone2: the runner-up distance on screen is the engine's distance, formatted once, never recomputed",
  );
  check(
    thresholdValue(tone2.view, "Margin over the runner-up") ===
      String(tone2.receipt.margin) &&
      thresholdValue(tone2.view, "Noise floor applied") ===
        String(tone2.receipt.noiseFloor),
    "tone2: margin and noise floor on screen are the receipt's own numbers",
  );

  // ---- tone6: pale cluster BUY, verbatim ----
  const tone6 = runSelection({ ...plain, toneId: "tone6" });
  check(
    tone6.receipt.verdict === "BUY" &&
      tone6.view.headline === tone6.receipt.headline,
    "tone6: the pale cluster BUY headline renders character for character as the engine wrote it",
  );
  check(
    tone6.receipt.cluster.length === 4 &&
      tone6.view.clusterText !== null &&
      tone6.view.clusterText.includes("4 shades within measurement noise"),
    "tone6: the screen names the pale cluster of 4 the engine formed at the 5.0 floor",
  );
  check(
    tone6.view.rankingRows[0]?.distanceText ===
      formatDistance(tone6.receipt.ranking[0].distance),
    "tone6: the closest distance on screen is the engine's distance",
  );
  check(
    tone6.receipt.paleBand &&
      thresholdValue(tone6.view, "Pale band reading") === "Yes",
    "tone6: the screen states the pale band flag the engine set",
  );

  // ---- Planner log: complete, in order, reasons verbatim ----
  check(
    tone2.view.plannerRows.length === tone2.receipt.plannerLog.length &&
      tone2.view.plannerRows.every(
        (row, i) =>
          row.step === tone2.receipt.plannerLog[i].step &&
          row.outcome === tone2.receipt.plannerLog[i].outcome &&
          row.why === tone2.receipt.plannerLog[i].why,
      ),
    "planner log: every step reaches the screen in order, with its reason verbatim",
  );
  const clusterRow = tone2.view.plannerRows.find(
    (row) => row.step === "cluster-evaluation",
  );
  check(
    clusterRow?.outcome === "done" &&
      (clusterRow?.why.includes("Cluster check: 2 shades") ?? false),
    "planner log: the cluster evaluation is on screen as done, with the engine's cluster size",
  );
  const vtoRow = tone2.view.plannerRows.find(
    (row) => row.step === "makeup-vto-preview",
  );
  check(
    vtoRow?.outcome === "skipped" && (vtoRow?.why.includes("preview only") ?? false),
    "planner log: the Makeup VTO step is on screen as skipped, labelled preview only",
  );
  const analysisRow = tone2.view.plannerRows.find(
    (row) => row.step === "skin-analysis",
  );
  check(
    analysisRow?.outcome === "skipped" &&
      (analysisRow?.why.includes("carry no verdict authority") ?? false),
    "planner log: the Skin Analysis skip reason is on screen in the engine's words",
  );

  // ---- Capture gate: the gate's own language, through the UI path ----
  const portraitGate = checkCapture(fixtureFraming("portrait").measurement);
  const portrait = runSelection({ ...plain, framingId: "portrait" });
  check(
    portrait.receipt.verdict === "CAN'T TELL" &&
      portrait.view.headline.includes(portraitGate.reasons[0]),
    "a portrait framing ends in CAN'T TELL, and the screen carries the gate's rejection word for word",
  );
  const atLimit = runSelection({ ...plain, framingId: "at-limit" });
  check(
    atLimit.receipt.verdict === "CAN'T TELL" &&
      atLimit.receipt.reasonTag === "capture-rejected",
    "an exactly-60% face is rejected through the UI path (the rule is exceed, not reach)",
  );
  check(
    faceShareText(fixtureFraming("portrait").measurement).includes("45%") &&
      faceShareText(fixtureFraming("at-limit").measurement).includes("60%"),
    "the capture screen states the measured face share for the chosen framing",
  );

  // ---- Owned bottle through the form path ----
  const owned = runSelection({
    ...plain,
    ownedHex: studyTone("tone2").result.skinColorHex,
    ownedName: "My Bottle",
  });
  const ownedDistance =
    owned.receipt.ownedMatch !== null
      ? formatDistance(owned.receipt.ownedMatch.distance)
      : "missing";
  check(
    owned.receipt.verdict === "NO" &&
      owned.receipt.reasonTag === "already-own-it" &&
      owned.view.headline === owned.receipt.headline &&
      owned.view.ownedText !== null &&
      owned.view.ownedText.includes(ownedDistance),
    "an owned bottle at the measured tone renders the NO headline and the engine's owned distance",
  );
  const badHex = buildFixtureInput({ ...plain, ownedHex: "banana" });
  check(
    "error" in badHex,
    "a shade that is not a hex colour is refused at input, never reaching the engine",
  );

  // ---- Fixture honesty on screen ----
  check(
    tone2.receipt.fixtureMode &&
      tone2.view.fixtureLabel.includes("Fixture mode") &&
      tone2.view.unitsSpentText === "Total units spent: 0",
    "the receipt screen labels itself fixture mode and shows the engine's zero spend",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
