/**
 * Central configuration for the YouCam integration.
 *
 * VERIFIED 2026-10-22 against the live account (console ledger reads +
 * the study in ../study/STUDY_LOG.md): the three task costs below are
 * exact, failed tasks net zero (charge, then full refund), and the API
 * paths/host match the official V2 docs. The one figure still marked
 * UNVERIFIED is the 5-8 concern Skin Analysis price, which no live run
 * has exercised yet; do not quote it as settled.
 */

/** Per-call unit costs, by task type. VERIFIED 2026-10-22, see header. */
export const TASK_COSTS = {
  /** AI Skin Tone / Facial Color Tones: the 20-unit whale. */
  "skin-tone": 20,
  /** AI Skin Analysis SD, 1-4 concerns. */
  "skin-analysis": 9,
  /** AI Makeup Virtual Try-On, per render. */
  "makeup-vto": 1,
  /** AI Clothes VTO: listed for completeness, unused by this product. */
  "clothes-vto": 2,
} as const;

export type TaskType = keyof typeof TASK_COSTS;

/** Skin Analysis SD at 5-8 concerns. UNVERIFIED, see header. */
export const SKIN_ANALYSIS_SD_5_TO_8_CONCERNS_UNITS = 12;

/**
 * Estimated unit cost of one task. Skin Analysis is the only task
 * whose price moves with its parameters (concern count).
 */
export function estimateTaskUnits(
  taskType: TaskType,
  opts?: { concerns?: number },
): number {
  if (taskType === "skin-analysis" && (opts?.concerns ?? 0) > 4) {
    return SKIN_ANALYSIS_SD_5_TO_8_CONCERNS_UNITS;
  }
  return TASK_COSTS[taskType];
}

/** Units held back, untouched, for the judging window. */
export const JUDGE_RESERVE_UNITS = 300;

/**
 * Total units granted: 1,000 from the hackathon redeem code plus a
 * 40-unit "free tries" grant found in the ledger 2026-10-22.
 */
export const GRANTED_UNITS = 1040;

/**
 * API feature names, per the official YouCam API documentation.
 * VERIFIED 2026-10-22 by live probe (docs: yce.perfectcorp.com/document):
 * V2 endpoints are feature-scoped, and the skin tone feature is named
 * "skin-tone-analysis", not "skin-tone".
 */
export const FEATURE_NAMES: Record<TaskType, string> = {
  "skin-tone": "skin-tone-analysis",
  "skin-analysis": "skin-analysis",
  "makeup-vto": "makeup-vto",
  "clothes-vto": "cloth",
};

/**
 * API paths. VERIFIED 2026-10-22 by live probe against
 * yce-api-01.makeupar.com with the account's real key: file ticket
 * (V2, feature-scoped), presigned PUT, task create with src_file_id,
 * and status polling all returned the documented shapes. Task bodies
 * for skin-analysis and makeup-vto beyond src_file_id remain
 * UNVERIFIED until their first live calls.
 */
export const API_PATHS = {
  file: (taskType: TaskType) =>
    `/s2s/v2.0/file/${FEATURE_NAMES[taskType]}`,
  task: (taskType: TaskType) =>
    `/s2s/v2.0/task/${FEATURE_NAMES[taskType]}`,
  taskStatus: (taskType: TaskType, taskId: string) =>
    `/s2s/v2.0/task/${FEATURE_NAMES[taskType]}/${taskId}`,
} as const;

/** Poll interval for task status checks: 2-3s per the plan. */
export const DEFAULT_POLL_INTERVAL_MS = 2500;

/** Give up polling a single task after this long. */
export const DEFAULT_POLL_TIMEOUT_MS = 120_000;

/** Plan limit: 250 requests per 5 minutes per key, shared. */
export const RATE_LIMIT_NOTE =
  "Task status is always polled server-side; browsers never poll the API directly.";

export interface YouCamEnvConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * Build the client config from environment variables.
 * Throws a plain-language error when the key is missing, so a failed
 * probe says what to fix instead of dying inside a fetch.
 */
export function youcamConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): YouCamEnvConfig {
  const apiKey = env.YOUCAM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "YOUCAM_API_KEY is not set. Copy .env.example to .env.local and " +
        "paste the key from the YouCam console (India region: yce.makeupar.com).",
    );
  }
  const baseUrl = (
    env.YOUCAM_API_BASE_URL ?? "https://yce-api-01.makeupar.com"
  ).replace(/\/+$/, "");
  return { apiKey, baseUrl };
}
