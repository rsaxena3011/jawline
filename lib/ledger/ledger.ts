/**
 * Unit ledger: the bookkeeping that keeps a 1,000-unit API budget
 * honest (MERGED_PLAN_V2).
 *
 * Rules encoded here:
 * - Units are counted (reserved) at task START, using the estimated
 *   cost, and settled when the task completes. A task that finishes
 *   but is never checked is still charged by the provider, so the
 *   reservation, not the result, is what the budget trusts.
 * - The real balance comes from a BalanceProvider. Phase 1 ships a
 *   stub that returns null ("unknown"); the real provider reads the
 *   provider's own balance endpoint and is wired in after the day-1
 *   probe. Nothing in the app invents a balance when the provider
 *   says null.
 * - Access split: judges (passcode) may spend live units, including
 *   the 300-unit judging reserve. The public gets replays only, and
 *   reserve() refuses public mode outright, so no code path can
 *   accidentally spend units on public traffic.
 */

import {
  estimateTaskUnits,
  GRANTED_UNITS,
  JUDGE_RESERVE_UNITS,
  type TaskType,
} from "../config.ts";
import type { AccessMode } from "./access.ts";

export interface BalanceProvider {
  /** Real remaining units, or null when the balance is unknown. */
  getBalanceUnits(): Promise<number | null>;
}

/** Phase 1 stub: the real endpoint is wired after the day-1 probe. */
export class NullBalanceProvider implements BalanceProvider {
  async getBalanceUnits(): Promise<number | null> {
    return null;
  }
}

export type LedgerEntryStatus = "reserved" | "settled" | "released";

export interface LedgerEntry {
  id: string;
  taskType: TaskType;
  mode: AccessMode;
  estimatedUnits: number;
  /** Actual units charged, set on settle; null until then. */
  actualUnits: number | null;
  status: LedgerEntryStatus;
  /** Why the spend happened or was skipped (planner's note). */
  note: string;
  createdAt: number;
  closedAt: number | null;
}

export class PublicSpendError extends Error {
  constructor() {
    super(
      "Public mode serves replays only and cannot spend API units. " +
        "Live calls require judge access.",
    );
    this.name = "PublicSpendError";
  }
}

export class UnitLedger {
  private readonly entries: LedgerEntry[] = [];
  private sequence = 0;
  readonly judgeReserveUnits: number;

  constructor(opts?: { judgeReserveUnits?: number }) {
    this.judgeReserveUnits = opts?.judgeReserveUnits ?? JUDGE_RESERVE_UNITS;
  }

  /**
   * Reserve the estimated cost of a task before it starts.
   * Throws PublicSpendError for public mode.
   */
  reserve(
    taskType: TaskType,
    mode: AccessMode,
    note: string,
    opts?: { concerns?: number },
  ): LedgerEntry {
    if (mode !== "judge") throw new PublicSpendError();
    this.sequence += 1;
    const entry: LedgerEntry = {
      id: `ledger-${this.sequence}`,
      taskType,
      mode,
      estimatedUnits: estimateTaskUnits(taskType, opts),
      actualUnits: null,
      status: "reserved",
      note,
      createdAt: Date.now(),
      closedAt: null,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Settle a reservation with the actual charged units. */
  settle(entryId: string, actualUnits: number): LedgerEntry {
    const entry = this.openEntry(entryId);
    entry.actualUnits = actualUnits;
    entry.status = "settled";
    entry.closedAt = Date.now();
    return entry;
  }

  /** Release a reservation that provably consumed nothing. */
  release(entryId: string): LedgerEntry {
    const entry = this.openEntry(entryId);
    entry.actualUnits = 0;
    entry.status = "released";
    entry.closedAt = Date.now();
    return entry;
  }

  private openEntry(entryId: string): LedgerEntry {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry) throw new Error(`Unknown ledger entry: ${entryId}`);
    if (entry.status !== "reserved") {
      throw new Error(
        `Ledger entry ${entryId} is already ${entry.status}; it cannot change again.`,
      );
    }
    return entry;
  }

  /** Units currently held by open reservations. */
  outstandingUnits(): number {
    return this.entries
      .filter((e) => e.status === "reserved")
      .reduce((sum, e) => sum + e.estimatedUnits, 0);
  }

  /** Units actually spent (settled entries only). */
  spentUnits(): number {
    return this.entries
      .filter((e) => e.status === "settled")
      .reduce((sum, e) => sum + (e.actualUnits ?? 0), 0);
  }

  /** Total units the ledger believes are committed: spent + held. */
  committedUnits(): number {
    return this.spentUnits() + this.outstandingUnits();
  }

  /**
   * Units left for build and demo work before the judging reserve is
   * touched, based on local bookkeeping alone.
   */
  nonReserveRemaining(grantedUnits: number = GRANTED_UNITS): number {
    return grantedUnits - this.judgeReserveUnits - this.committedUnits();
  }

  /**
   * Budget check against the real balance when the provider knows it.
   * sufficient is null when the balance is unknown; callers must treat
   * null as "unverified", never as "fine".
   */
  async checkBudget(
    provider: BalanceProvider,
    neededUnits: number,
  ): Promise<{ balance: number | null; sufficient: boolean | null }> {
    const balance = await provider.getBalanceUnits();
    if (balance === null) return { balance: null, sufficient: null };
    return { balance, sufficient: balance >= neededUnits };
  }

  list(): readonly LedgerEntry[] {
    return this.entries;
  }
}
