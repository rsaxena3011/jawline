/**
 * Judge / public access split (MERGED_PLAN_V2).
 *
 * - "judge" mode: unlocked by the JUDGE_PASSCODE environment variable.
 *   Judges may run live API calls, spending units including the
 *   300-unit reserve held back for the judging window. A judge never
 *   sees a refusal.
 * - "public" mode: everyone else. Public visitors get fixture replays
 *   only, so gallery traffic can never drain the unit budget.
 */

import { timingSafeEqual } from "node:crypto";

export type AccessMode = "judge" | "public";

/** True when live (unit-spending) calls are allowed in this mode. */
export function canSpendLive(mode: AccessMode): boolean {
  return mode === "judge";
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Resolve the access mode for a request. The expected passcode comes
 * from the JUDGE_PASSCODE environment variable; when it is not
 * configured, everyone is public (fail closed, spend nothing).
 */
export function resolveAccessMode(
  presentedPasscode: string | null | undefined,
  expectedPasscode: string | undefined = process.env.JUDGE_PASSCODE,
): AccessMode {
  if (!expectedPasscode || !presentedPasscode) return "public";
  return safeEqual(presentedPasscode, expectedPasscode) ? "judge" : "public";
}
