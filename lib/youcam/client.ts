/**
 * Server-side YouCam API client skeleton (phase 1: no live calls are
 * made anywhere in the app yet; the day-1 probe is the first caller).
 *
 * The flow follows the documented shape: a two-step file upload
 * (request a presigned URL, then PUT the binary), then task creation,
 * then polling the task status server-side every 2-3 seconds.
 *
 * HARD RULE, from MERGED_PLAN_V2: task creation is NEVER auto-retried.
 * The API server can connect slowly; if a first create actually landed
 * and a retry creates a second task, the account is charged twice.
 * createTask below therefore makes exactly one attempt and surfaces
 * the error. Callers that want to try again must do so deliberately,
 * after checking, never from a retry loop.
 */

import {
  API_PATHS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  type TaskType,
} from "../config.ts";
import type {
  MakeupVtoParams,
  MakeupVtoResult,
  SkinAnalysisResult,
  SkinConcernScore,
  SkinToneResult,
} from "./types.ts";

export interface YouCamClient {
  apiKey: string;
  baseUrl: string;
  fetchFn: typeof fetch;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export function createYouCamClient(opts: {
  apiKey: string;
  baseUrl: string;
  fetchFn?: typeof fetch;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}): YouCamClient {
  return {
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl.replace(/\/+$/, ""),
    fetchFn: opts.fetchFn ?? fetch,
    pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs: opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
  };
}

export class YouCamError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "YouCamError";
    this.status = status;
  }
}

export class YouCamTaskError extends YouCamError {
  constructor(message: string) {
    super(message);
    this.name = "YouCamTaskError";
  }
}

function authHeaders(client: YouCamClient): Record<string, string> {
  return { Authorization: `Bearer ${client.apiKey}` };
}

/** Responses may arrive flat or wrapped in a data envelope. */
function unwrap(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.data && typeof obj.data === "object") {
      return obj.data as Record<string, unknown>;
    }
    return obj;
  }
  throw new YouCamError("YouCam response was not a JSON object.");
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new YouCamError(
      `YouCam returned a non-JSON response (HTTP ${res.status}).`,
      res.status,
    );
  }
}

/* ------------------------------------------------------------------ */
/* File upload (two-step)                                              */
/* ------------------------------------------------------------------ */

export interface UploadTicket {
  fileId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export async function requestUploadTicket(
  client: YouCamClient,
  opts: { contentType: string; fileName?: string },
): Promise<UploadTicket> {
  const res = await client.fetchFn(`${client.baseUrl}${API_PATHS.file}`, {
    method: "POST",
    headers: { ...authHeaders(client), "Content-Type": "application/json" },
    body: JSON.stringify({
      content_type: opts.contentType,
      file_name: opts.fileName ?? "capture.jpg",
    }),
  });
  if (!res.ok) {
    throw new YouCamError(
      `Upload ticket request failed (HTTP ${res.status}).`,
      res.status,
    );
  }
  const body = unwrap(await readJson(res));
  const fileId = pickString(body, ["file_id", "fileId", "id"]);
  const uploadUrl = pickString(body, [
    "upload_url",
    "uploadUrl",
    "presigned_url",
    "url",
  ]);
  if (!fileId || !uploadUrl) {
    throw new YouCamError(
      "Upload ticket response is missing a file id or upload URL.",
    );
  }
  const headers =
    body.headers && typeof body.headers === "object"
      ? (body.headers as Record<string, string>)
      : {};
  return { fileId, uploadUrl, headers };
}

export async function uploadBinary(
  client: YouCamClient,
  ticket: UploadTicket,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const res = await client.fetchFn(ticket.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType, ...ticket.headers },
    body: bytes as BodyInit,
  });
  if (!res.ok) {
    throw new YouCamError(
      `Binary upload failed (HTTP ${res.status}).`,
      res.status,
    );
  }
}

/** Upload a photo once; the returned file id is reused by every task. */
export async function uploadFile(
  client: YouCamClient,
  bytes: Uint8Array,
  contentType: string,
  fileName?: string,
): Promise<string> {
  const ticket = await requestUploadTicket(client, { contentType, fileName });
  await uploadBinary(client, ticket, bytes, contentType);
  return ticket.fileId;
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

/**
 * Create a task. EXACTLY ONE attempt is made here, by design: see the
 * hard rule in the file header. A failed create charges nothing; a
 * duplicated create charges twice, so this function never retries
 * and never loops.
 */
export async function createTask(
  client: YouCamClient,
  taskType: TaskType,
  params: Record<string, unknown>,
): Promise<string> {
  const res = await client.fetchFn(
    `${client.baseUrl}${API_PATHS.task(taskType)}`,
    {
      method: "POST",
      headers: { ...authHeaders(client), "Content-Type": "application/json" },
      body: JSON.stringify(params),
    },
  );
  if (!res.ok) {
    throw new YouCamError(
      `Task creation failed for ${taskType} (HTTP ${res.status}). ` +
        "It was NOT retried automatically; a retry could double-charge units.",
      res.status,
    );
  }
  const body = unwrap(await readJson(res));
  const taskId = pickString(body, ["task_id", "taskId", "id"]);
  if (!taskId) {
    throw new YouCamError("Task creation response is missing a task id.");
  }
  return taskId;
}

export type TaskStatus =
  | { state: "running" }
  | { state: "success"; result: Record<string, unknown> }
  | { state: "error"; message: string };

export async function getTaskStatus(
  client: YouCamClient,
  taskType: TaskType,
  taskId: string,
): Promise<TaskStatus> {
  const res = await client.fetchFn(
    `${client.baseUrl}${API_PATHS.taskStatus(taskType, taskId)}`,
    { headers: authHeaders(client) },
  );
  if (!res.ok) {
    throw new YouCamError(
      `Status check failed for task ${taskId} (HTTP ${res.status}).`,
      res.status,
    );
  }
  const body = unwrap(await readJson(res));
  const status = pickString(body, ["status", "state"]) ?? "";
  if (status === "success" || status === "succeeded" || status === "done") {
    const result =
      body.result && typeof body.result === "object"
        ? (body.result as Record<string, unknown>)
        : body;
    return { state: "success", result };
  }
  if (status === "error" || status === "failed" || status === "failure") {
    const message =
      pickString(body, ["error", "message"]) ?? "The task failed.";
    return { state: "error", message };
  }
  return { state: "running" };
}

/**
 * Poll a task until it succeeds, fails, or times out. Status checks
 * are free (a task is charged on completion, not per check), and a
 * couple of transient network errors are tolerated; the task itself
 * is never re-created from here.
 */
export async function pollTask(
  client: YouCamClient,
  taskType: TaskType,
  taskId: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + client.pollTimeoutMs;
  let consecutiveFailures = 0;
  for (;;) {
    let status: TaskStatus | null = null;
    try {
      status = await getTaskStatus(client, taskType, taskId);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) throw err;
    }
    if (status?.state === "success") return status.result;
    if (status?.state === "error") {
      throw new YouCamTaskError(
        `YouCam task ${taskId} (${taskType}) failed: ${status.message}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new YouCamTaskError(
        `YouCam task ${taskId} (${taskType}) did not finish within ` +
          `${Math.round(client.pollTimeoutMs / 1000)}s. Check its status ` +
          "before spending again; a finished-but-unchecked task is still charged.",
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, client.pollIntervalMs),
    );
  }
}

/** Create + poll. Reserve ledger units BEFORE calling this. */
export async function runTask(
  client: YouCamClient,
  taskType: TaskType,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const taskId = await createTask(client, taskType, params);
  return pollTask(client, taskType, taskId);
}

/* ------------------------------------------------------------------ */
/* Result parsers                                                      */
/* ------------------------------------------------------------------ */

export function parseSkinToneResult(raw: Record<string, unknown>): SkinToneResult {
  const skinColorHex = pickString(raw, ["skin_color", "skinColor", "skin_color_hex"]);
  if (!skinColorHex) {
    throw new YouCamError("Skin Tone result is missing skin_color.");
  }
  const facialRaw =
    raw.facial_colors && typeof raw.facial_colors === "object"
      ? (raw.facial_colors as Record<string, unknown>)
      : raw;
  const facialColors: SkinToneResult["facialColors"] = {};
  const eye = pickString(facialRaw, ["eye_color", "eyeColor"]);
  const lip = pickString(facialRaw, ["lip_color", "lipColor"]);
  const brow = pickString(facialRaw, ["brow_color", "browColor"]);
  const hair = pickString(facialRaw, ["hair_color", "hairColor"]);
  if (eye) facialColors.eye = eye;
  if (lip) facialColors.lip = lip;
  if (brow) facialColors.brow = brow;
  if (hair) facialColors.hair = hair;
  return { skinColorHex, facialColors };
}

export function parseSkinAnalysisResult(
  raw: Record<string, unknown>,
): SkinAnalysisResult {
  const list = (raw.actions ?? raw.scores ?? raw.results) as unknown;
  if (!Array.isArray(list)) {
    throw new YouCamError("Skin Analysis result is missing its score list.");
  }
  const scores: SkinConcernScore[] = list.map((item) => {
    const entry = item as Record<string, unknown>;
    const rawScore = entry.raw_score;
    if (typeof rawScore !== "number") {
      throw new YouCamError(
        "Skin Analysis score entry is missing a numeric raw_score.",
      );
    }
    return {
      action: pickString(entry, ["action", "name"]) ?? "unknown",
      rawScore,
      uiScore: typeof entry.ui_score === "number" ? entry.ui_score : null,
    };
  });
  const maskUrls: Record<string, string> = {};
  const masksRaw = (raw.masks ?? raw.mask_urls) as unknown;
  if (masksRaw && typeof masksRaw === "object") {
    for (const [key, value] of Object.entries(
      masksRaw as Record<string, unknown>,
    )) {
      if (typeof value === "string") maskUrls[key] = value;
    }
  }
  return { scores, maskUrls };
}

export function parseMakeupVtoResult(
  raw: Record<string, unknown>,
): MakeupVtoResult {
  const imageUrl = pickString(raw, ["image_url", "imageUrl", "url"]);
  if (!imageUrl) {
    throw new YouCamError("Makeup VTO result is missing an image URL.");
  }
  return { imageUrl };
}

/* ------------------------------------------------------------------ */
/* Typed task wrappers                                                 */
/* ------------------------------------------------------------------ */

export async function runSkinTone(
  client: YouCamClient,
  fileId: string,
): Promise<SkinToneResult> {
  const raw = await runTask(client, "skin-tone", { file_id: fileId });
  return parseSkinToneResult(raw);
}

export async function runSkinAnalysis(
  client: YouCamClient,
  fileId: string,
  actions: string[],
): Promise<SkinAnalysisResult> {
  const raw = await runTask(client, "skin-analysis", {
    file_id: fileId,
    dst_actions: actions,
  });
  return parseSkinAnalysisResult(raw);
}

export async function runMakeupVto(
  client: YouCamClient,
  fileId: string,
  params: MakeupVtoParams,
): Promise<MakeupVtoResult> {
  const raw = await runTask(client, "makeup-vto", {
    file_id: fileId,
    color: params.colorHex,
    smoothing: params.smoothing,
    coverage: params.coverage,
    glow: params.glow,
    intensity: params.intensity,
  });
  return parseMakeupVtoResult(raw);
}
