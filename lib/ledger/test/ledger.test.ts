import { canSpendLive, resolveAccessMode } from "../access.ts";
import {
  NullBalanceProvider,
  PublicSpendError,
  UnitLedger,
  type BalanceProvider,
} from "../ledger.ts";

/**
 * Ledger math and the judge/public split. The load-bearing
 * assertions: reservations hold the estimated cost at start, settling
 * swaps in the actual charge, releasing returns the hold, double
 * closing an entry is an error, the judging reserve is ring-fenced
 * from build spend, public mode can never reserve, and an unknown
 * balance reports "unverified" (null), never "sufficient".
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

class FixedBalanceProvider implements BalanceProvider {
  private readonly balance: number | null;
  constructor(balance: number | null) {
    this.balance = balance;
  }
  async getBalanceUnits(): Promise<number | null> {
    return this.balance;
  }
}

async function main() {
  // Access split.
  check(resolveAccessMode("s3cret", "s3cret") === "judge", "correct passcode is judge mode");
  check(resolveAccessMode("wrong", "s3cret") === "public", "wrong passcode is public mode");
  check(resolveAccessMode(null, "s3cret") === "public", "no passcode is public mode");
  check(resolveAccessMode("s3cret", undefined) === "public", "unconfigured passcode fails closed to public");
  check(canSpendLive("judge") && !canSpendLive("public"), "only judge mode can spend live units");

  // Reserve / settle math.
  const ledger = new UnitLedger();
  const tone = ledger.reserve("skin-tone", "judge", "study capture");
  check(tone.estimatedUnits === 20, "skin tone reserves its 20-unit estimate");
  check(ledger.outstandingUnits() === 20, "outstanding holds the reservation");
  check(ledger.committedUnits() === 20, "committed counts the open reservation");

  const vto = ledger.reserve("makeup-vto", "judge", "candidate render");
  check(vto.estimatedUnits === 1, "makeup VTO reserves 1 unit");
  ledger.settle(vto.id, 1);
  check(ledger.spentUnits() === 1, "settled units move to spent");
  check(ledger.outstandingUnits() === 20, "settling clears that hold");

  ledger.settle(tone.id, 20);
  check(ledger.spentUnits() === 21, "spent totals settled actuals");
  check(ledger.outstandingUnits() === 0, "no holds remain after settling all");

  // Release returns the hold without spending.
  const analysis = ledger.reserve("skin-analysis", "judge", "borderline undertone", { concerns: 4 });
  check(analysis.estimatedUnits === 9, "skin analysis at 4 concerns reserves 9");
  ledger.release(analysis.id);
  check(ledger.outstandingUnits() === 0 && ledger.spentUnits() === 21, "release returns the hold unspent");

  const wide = ledger.reserve("skin-analysis", "judge", "wide check", { concerns: 6 });
  check(wide.estimatedUnits === 12, "skin analysis at 5-8 concerns reserves 12");
  ledger.release(wide.id);

  // Double close is an error.
  let doubleCloseThrew = false;
  try {
    ledger.settle(tone.id, 20);
  } catch {
    doubleCloseThrew = true;
  }
  check(doubleCloseThrew, "settling an already-settled entry throws");

  // Reserve ring-fence: 1,000 granted, 300 reserve, 21 spent.
  check(ledger.nonReserveRemaining() === 1000 - 300 - 21, "non-reserve remaining ring-fences the judge reserve");

  // Public mode can never reserve.
  let publicThrew = false;
  try {
    ledger.reserve("skin-tone", "public", "gallery click");
  } catch (err) {
    publicThrew = err instanceof PublicSpendError;
  }
  check(publicThrew, "public mode reserve throws PublicSpendError");

  // Budget checks: known and unknown balances.
  const stub = new NullBalanceProvider();
  const unknown = await ledger.checkBudget(stub, 30);
  check(unknown.balance === null && unknown.sufficient === null, "stub balance reads unknown and unverified");
  const enough = await ledger.checkBudget(new FixedBalanceProvider(300), 30);
  check(enough.balance === 300 && enough.sufficient === true, "known balance can be sufficient");
  const short = await ledger.checkBudget(new FixedBalanceProvider(10), 30);
  check(short.sufficient === false, "known balance can be insufficient");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
