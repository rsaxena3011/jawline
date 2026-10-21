/**
 * Central configuration for the YouCam integration.
 *
 * UNVERIFIED FIGURES: every cost, path, and host in this file is a
 * working figure taken from the merged plan (MERGED_PLAN_V2, 2026-10-21).
 * The returns disagreed with each other on several of them. Each one
 * must be confirmed against the real account in the YouCam console
 * during the day-1 probe before any budget or behaviour claim is made
 * to anyone. Do not quietly treat a value here as settled.
 */

/** Per-call unit costs, by task type. UNVERIFIED, see header. */
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

/** Total units granted with the hackathon redeem code. */
export const GRANTED_UNITS = 1000;

/**
 * API paths. UNVERIFIED: the exact versioned paths and the India
 * region host are day-1 probe items (the plan records two candidate
 * hosts: yce-api-01.makeupar.com and a perfectcorp.com address a
 * Round 1 team used).
 */
export const API_PATHS = {
  file: "/s2s/v1.0/file",
  task: (taskType: TaskType) => `/s2s/v1.0/task/${taskType}`,
  taskStatus: (taskType: TaskType, taskId: string) =>
    `/s2s/v1.0/task/${taskType}/${taskId}`,
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
