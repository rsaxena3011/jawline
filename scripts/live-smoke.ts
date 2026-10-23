/**
 * Slice-3 live smoke driver. Two modes:
 *
 *   node scripts/live-smoke.ts balance
 *     Reads ONLY the unit balance through the connector-backed
 *     client. Spends nothing; proves the credential path, the
 *     proxy swap, and the balance endpoint on this account.
 *
 *   node scripts/live-smoke.ts run
 *     Runs ONE real Skin Tone call on the study's tone2 close-up
 *     through the full live runner (passcode gate, capture gate,
 *     caps, ledger, balance before/after, runDecision) and prints
 *     the outcome. This is the single live call slice 3 is
 *     authorized to make. The passcode used is an ephemeral value
 *     set inside this process only; it is not the judge passcode
 *     and is never printed.
 *
 * Nothing in either mode prints the credential or its surrogate.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  createConnectorLiveDeps,
  runLiveCheck,
} from "../lib/live/runner.ts";
import { getUnitBalance } from "../lib/youcam/client.ts";
import { licensedCatalog } from "../lib/catalog/licensed.ts";
import { UnitInfoBalanceProvider } from "../lib/live/balance.ts";
import { LiveStore } from "../lib/live/store.ts";
import { liveSpendCaps } from "../lib/live/limits.ts";

const mode = process.argv[2] ?? "balance";

async function main() {
  if (mode === "balance") {
    const deps = await createConnectorLiveDeps();
    const balance = await getUnitBalance(deps.client);
    console.log(`unit balance: ${balance === null ? "UNREADABLE (null)" : balance}`);
    return;
  }

  if (mode !== "run") {
    console.error("usage: live-smoke.ts [balance|run]");
    process.exit(2);
  }

  // Ephemeral in-process passcode: satisfies the gate for this one
  // proof run without touching the real judge passcode.
  const passcode = `smoke-${randomUUID()}`;
  process.env.JUDGE_PASSCODE = passcode;

  const photoPath = new URL(
    "../../study/faces/tone2_closeup.jpg",
    import.meta.url,
  );
  const bytes = new Uint8Array(readFileSync(photoPath));

  const deps = await createConnectorLiveDeps();
  // A fresh store for the smoke run so the accounting printed here
  // is exactly this run's, while the deps factory (client, balance
  // provider, catalog, caps) is the production one.
  const smokeDeps = {
    ...deps,
    store: new LiveStore(),
    balance: new UnitInfoBalanceProvider(deps.client),
    catalog: licensedCatalog(),
    caps: liveSpendCaps(),
  };

  const outcome = await runLiveCheck(smokeDeps, {
    sessionId: "slice3-smoke",
    passcode,
    // The study's own numbers for this image: a tight central crop
    // whose face fills 68% of the 1024 px width (study/STUDY_LOG).
    capture: { faceDetected: true, faceWidthPx: 696, imageWidthPx: 1024 },
    photo: { bytes, contentType: "image/jpeg", fileName: "tone2_closeup.jpg" },
    ownedShades: [],
  });

  console.log(`outcome kind: ${outcome.kind}`);
  if (outcome.kind === "receipt") {
    const r = outcome.receipt;
    console.log(`balance before: ${outcome.balanceBefore}`);
    console.log(`balance after: ${outcome.balanceAfter}`);
    console.log(
      `balance delta: ${
        outcome.balanceBefore !== null && outcome.balanceAfter !== null
          ? outcome.balanceBefore - outcome.balanceAfter
          : "unknown (a balance read was unavailable)"
      }`,
    );
    console.log(`fixtureMode: ${r.fixtureMode}`);
    console.log(`verdict: ${r.verdict} (${r.reasonTag})`);
    console.log(`measured tone: ${r.measuredToneHex}`);
    console.log(`units settled on receipt: ${r.unitsSpent}`);
    const toneStep = r.plannerLog.find((s) => s.step === "skin-tone");
    console.log(`planner skin-tone step: ${toneStep?.outcome}, spent ${toneStep?.unitsSpent}`);
    console.log(`planner note: ${toneStep?.why}`);
  } else if ("message" in outcome) {
    console.log(`message: ${outcome.message}`);
  }
  console.log(
    `ledger committed after run: ${smokeDeps.store.globalCommitted()}`,
  );
}

main().catch((err) => {
  console.error("smoke driver failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
