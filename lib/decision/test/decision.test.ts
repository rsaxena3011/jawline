import { parseCatalog, type Catalog, type ShadeEntry } from "../../catalog/types.ts";
import { checkCapture } from "../capture.ts";
import { hexToLab } from "../color.ts";
import {
  MARGIN_NOISE_PALE,
  MARGIN_NOISE_STANDARD,
  runDecision,
  type DecisionInput,
} from "../decision.ts";
import { STUDY_TONES, studyTone } from "../fixtures.ts";

/**
 * Decision engine, fixture mode end to end. Covers the five
 * behaviours the slice promises: the capture gate, the owned-bottle
 * short-circuit, ranking order on the study's six tones, the BUY
 * margin rule, and the CAN'T TELL abstention at the pale end.
 * Everything runs on recorded study data; no API call exists here.
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

function fixtureShade(id: string, shadeName: string, hex: string): ShadeEntry {
  const lab = hexToLab(hex);
  return {
    id,
    brand: "FIXTURE Brand",
    product: "Fixture Foundation (placeholder)",
    shadeId: id.toUpperCase(),
    shadeName,
    hex,
    lab: { l: round3(lab.l), a: round3(lab.a), b: round3(lab.b) },
    finish: "satin",
    source: "C088 study fixture: shade placed at a recorded API reading, not a real product",
    sourceDate: "2026-10-22",
    reliability: "FIXTURE ONLY: invented to exercise ranking and verdicts. Never a real product.",
    license: "CC0 (project-authored placeholder)",
    fixture: true,
  };
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function catalogOf(shades: ShadeEntry[]): Catalog {
  return parseCatalog({ version: 1, shades });
}

/** One exact-match shade per study tone, plus two far decoys. */
function sharedCatalog(): Catalog {
  const matches = STUDY_TONES.map((t) =>
    fixtureShade(`match-${t.id}`, `Study Match ${t.id}`, t.result.skinColorHex),
  );
  return catalogOf([
    ...matches,
    fixtureShade("decoy-plum", "Decoy Deep Plum", "#5B2333"),
    fixtureShade("decoy-pink", "Decoy Pale Pink", "#EFD3C5"),
  ]);
}

const GOOD_CAPTURE = { faceDetected: true, faceWidthPx: 680, imageWidthPx: 1000 };

function input(
  toneId: string,
  overrides: Partial<DecisionInput> = {},
): DecisionInput {
  return {
    capture: GOOD_CAPTURE,
    skinTone: studyTone(toneId).result,
    catalog: sharedCatalog(),
    ownedShades: [],
    ...overrides,
  };
}

function plannerStep(receipt: ReturnType<typeof runDecision>, step: string) {
  return receipt.plannerLog.find((s) => s.step === step);
}

function main() {
  // ---- Capture gate (study framing rule: face must exceed 60%) ----
  check(
    checkCapture({ faceDetected: true, faceWidthPx: 680, imageWidthPx: 1000 }).ok,
    "gate passes at 68% face width (the study's successful crop)",
  );
  const at60 = checkCapture({ faceDetected: true, faceWidthPx: 600, imageWidthPx: 1000 });
  check(!at60.ok, "gate rejects at exactly 60% (the rule is exceed, not reach)");
  const small = checkCapture({ faceDetected: true, faceWidthPx: 450, imageWidthPx: 1000 });
  check(
    !small.ok && small.reasons[0].includes("45%") && small.reasons[0].includes("60%"),
    "gate rejection names the measured share and the required share",
  );
  const noFace = checkCapture({ faceDetected: false, faceWidthPx: 0, imageWidthPx: 1000 });
  check(!noFace.ok && noFace.reasons[0].includes("No face"), "gate rejects when no face is found");

  // Gate failure flows to CAN'T TELL with nothing spent or read.
  const gated = runDecision(input("tone2", {
    capture: { faceDetected: true, faceWidthPx: 450, imageWidthPx: 1000 },
  }));
  check(
    gated.verdict === "CAN'T TELL" && gated.reasonTag === "capture-rejected",
    "a rejected photo ends in CAN'T TELL, never a guessed verdict",
  );
  check(
    gated.unitsSpent === 0 && plannerStep(gated, "skin-tone")?.outcome === "skipped",
    "gate rejection spends 0 units and never touches the reading",
  );

  // ---- Ranking order on the study's six tones ----
  for (const tone of STUDY_TONES) {
    const receipt = runDecision(input(tone.id));
    check(
      receipt.ranking[0]?.shade.id === `match-${tone.id}` &&
        receipt.ranking[0].distance < 0.01,
      `${tone.id}: its own study match ranks first at distance ~0`,
    );
  }
  const tone1 = runDecision(input("tone1"));
  check(
    (tone1.margin ?? 0) > MARGIN_NOISE_STANDARD,
    "tone1 (deep, isolated) clears the standard noise floor by a wide margin",
  );
  for (const id of ["tone5", "tone6"]) {
    const receipt = runDecision(input(id));
    check(
      receipt.paleBand && (receipt.margin ?? 99) < MARGIN_NOISE_PALE,
      `${id}: pale band, and the sibling shade sits inside the pale noise floor`,
    );
  }

  // ---- Verdicts on the shared (dense) catalog ----
  for (const id of ["tone5", "tone6"]) {
    const receipt = runDecision(input(id));
    check(
      receipt.verdict === "CAN'T TELL" && receipt.reasonTag === "pale-end-abstention",
      `${id}: CAN'T TELL at the pale end instead of a guessed BUY`,
    );
  }
  const dense2 = runDecision(input("tone2"));
  check(
    dense2.verdict === "SHADE-RISK" && dense2.reasonTag === "candidates-within-noise",
    "tone2 on the dense catalog: SHADE-RISK (tone3's shade sits 2.85 behind)",
  );

  // ---- BUY margin rule on scenario catalogs ----
  const sparse = catalogOf([
    fixtureShade("match-tone2", "Study Match tone2", studyTone("tone2").result.skinColorHex),
    fixtureShade("decoy-plum", "Decoy Deep Plum", "#5B2333"),
    fixtureShade("decoy-pink", "Decoy Pale Pink", "#EFD3C5"),
  ]);
  const buy = runDecision(input("tone2", { catalog: sparse }));
  check(
    buy.verdict === "BUY" && buy.reasonTag === "clear-match",
    "a lone clear match with far decoys returns BUY",
  );
  const pairCatalog = catalogOf([
    fixtureShade("match-tone2", "Study Match tone2", studyTone("tone2").result.skinColorHex),
    fixtureShade("match-tone4", "Study Match tone4", studyTone("tone4").result.skinColorHex),
  ]);
  check(
    runDecision(input("tone2", { catalog: pairCatalog })).verdict === "BUY",
    "margin of 5.90 over the runner-up clears the 3.0 floor: BUY",
  );
  const closePair = catalogOf([
    fixtureShade("match-tone2", "Study Match tone2", studyTone("tone2").result.skinColorHex),
    fixtureShade("match-tone3", "Study Match tone3", studyTone("tone3").result.skinColorHex),
  ]);
  check(
    runDecision(input("tone2", { catalog: closePair })).verdict === "SHADE-RISK",
    "margin of 2.85 under the 3.0 floor: SHADE-RISK, not BUY",
  );

  // ---- NO when nothing in the catalog is in range ----
  const lightOnly = catalogOf([
    fixtureShade("match-tone5", "Study Match tone5", studyTone("tone5").result.skinColorHex),
    fixtureShade("match-tone6", "Study Match tone6", studyTone("tone6").result.skinColorHex),
  ]);
  const noMatch = runDecision(input("tone1", { catalog: lightOnly }));
  check(
    noMatch.verdict === "NO" && noMatch.reasonTag === "no-shade-in-range",
    "tone1 against a light-only catalog: NO, no shade in range",
  );

  // ---- Owned-bottle check runs FIRST and short-circuits ----
  const ownedBottle = fixtureShade(
    "owned-1",
    "My Bottle",
    studyTone("tone2").result.skinColorHex,
  );
  ownedBottle.brand = "Owned Brand";
  const owned = runDecision(input("tone2", { ownedShades: [ownedBottle] }));
  check(
    owned.verdict === "NO" && owned.reasonTag === "already-own-it",
    "an owned bottle at the measured tone returns NO, already own it",
  );
  check(
    owned.ranking.length === 0 &&
      plannerStep(owned, "catalog-ranking")?.outcome === "skipped",
    "the owned-bottle verdict short-circuits before any ranking",
  );
  const farOwned = fixtureShade("owned-far", "Old Bottle", "#5B2333");
  const notOwned = runDecision(input("tone2", {
    catalog: sparse,
    ownedShades: [farOwned],
  }));
  check(
    notOwned.verdict === "BUY",
    "an owned bottle far from the measured tone does not block a BUY",
  );

  // ---- Only skin_color is load-bearing ----
  const tone2 = studyTone("tone2");
  const tampered = {
    skinColorHex: tone2.result.skinColorHex,
    facialColors: { hair: "#000000", eye: "#FF0000", lip: "#00FF00", brow: "#0000FF" },
  };
  const honest = runDecision(input("tone2", { catalog: sparse }));
  const tamperedRun = runDecision(input("tone2", { catalog: sparse, skinTone: tampered }));
  check(
    tamperedRun.verdict === honest.verdict &&
      tamperedRun.ranking[0].distance === honest.ranking[0].distance,
    "changing hair, eye, lip and brow colours changes nothing (study: hair_color wrong on 6 of 6)",
  );

  // ---- Receipt and planner honesty ----
  check(
    buy.unitsSpent === 0 &&
      plannerStep(buy, "skin-tone")?.outcome === "replayed" &&
      plannerStep(buy, "skin-tone")?.liveUnits === 20,
    "fixture mode spends 0 and prices the replayed reading at its live cost of 20",
  );
  check(
    plannerStep(buy, "makeup-vto-preview")?.outcome === "skipped" &&
      (plannerStep(buy, "makeup-vto-preview")?.why.includes("preview only") ?? false),
    "makeup VTO is logged as a skipped preview, never a verdict input",
  );
  check(
    buy.measuredToneHex === "#a77d60" && buy.fixtureMode === true,
    "the receipt states the exact tone it rests on and that it is a fixture replay",
  );
  const unusable = runDecision(input("tone2", { skinTone: { skinColorHex: "not-a-hex", facialColors: {} } }));
  check(
    unusable.verdict === "CAN'T TELL" && unusable.reasonTag === "reading-unusable",
    "an unreadable skin_color ends in CAN'T TELL, not a crash or a guess",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
