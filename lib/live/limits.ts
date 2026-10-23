/**
 * Live-mode spend caps (defect #9 in DEFECT_LOG: a passcode is not
 * a spending control). Two caps guard every live run, enforced
 * server-side in lib/live/runner.ts against the unit ledger:
 *
 * - Per-session cap: one judge session can commit at most this
 *   many units (spent plus held by open reservations). Default 60,
 *   three Skin Tone calls: enough for a judge to retry a photo,
 *   not enough to drain the account from one browser.
 * - Global cap: all live sessions together can commit at most
 *   this many units. Default is the 300-unit judge reserve itself
 *   (JUDGE_RESERVE_UNITS in lib/config.ts): live mode may spend
 *   the reserve it exists to serve, and not a unit past it.
 *
 * Both are overridable by env for a judging deployment, and both
 * refuse with a plain message, never silently, when hit.
 */

import { JUDGE_RESERVE_UNITS } from "../config.ts";

export interface LiveSpendCaps {
  sessionCapUnits: number;
  globalCapUnits: number;
}

export const DEFAULT_SESSION_CAP_UNITS = 60;
export const DEFAULT_GLOBAL_CAP_UNITS = JUDGE_RESERVE_UNITS;

function parseCap(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function liveSpendCaps(
  env: Record<string, string | undefined> = process.env,
): LiveSpendCaps {
  return {
    sessionCapUnits: parseCap(
      env.LIVE_SESSION_SPEND_CAP_UNITS,
      DEFAULT_SESSION_CAP_UNITS,
    ),
    globalCapUnits: parseCap(
      env.LIVE_GLOBAL_SPEND_CAP_UNITS,
      DEFAULT_GLOBAL_CAP_UNITS,
    ),
  };
}
