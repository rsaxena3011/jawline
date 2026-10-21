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
  taskType: TaskType,
  opts: { contentType: string; fileName?: string; fileSize: number },
): Promise<UploadTicket> {
  // VERIFIED 2026-10-22 (live probe): V2 file endpoint is feature-scoped
  // and the body is { files: [{ content_type, file_name, file_size }] };
  // file_size is mandatory ("File size is required" without it). The
  // response nests the ticket at data.files[0] with a requests[0] PUT.
  const res = await client.fetchFn(
    `${client.baseUrl}${API_PATHS.file(taskType)}`,
    {
      method: "POST",
      headers: { ...authHeaders(client), "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          {
            content_type: opts.contentType,
            file_name: opts.fileName ?? "capture.jpg",
            file_size: opts.fileSize,
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    throw new YouCamError(
      `Upload ticket request failed (HTTP ${res.status}).`,
      res.status,
    );
  }
  const body = unwrap(await readJson(res));
  const firstFile =
    Array.isArray(body.files) && body.files.length > 0
      ? (body.files[0] as Record<string, unknown>)
      : body;
  const fileId = pickString(firstFile, ["file_id", "fileId", "id"]);
  const firstRequest =
    Array.isArray(firstFile.requests) && firstFile.requests.length > 0
      ? (firstFile.requests[0] as Record<string, unknown>)
      : null;
  const uploadUrl =
    (firstRequest ? pickString(firstRequest, ["url"]) : null) ??
    pickString(firstFile, ["upload_url", "uploadUrl", "presigned_url", "url"]);
  if (!fileId || !uploadUrl) {
    throw new YouCamError(
      "Upload ticket response is missing a file id or upload URL.",
    );
  }
  const headers =
    firstRequest?.headers && typeof firstRequest.headers === "object"
      ? (firstRequest.headers as Record<string, string>)
      : firstFile.headers && typeof firstFile.headers === "object"
        ? (firstFile.headers as Record<string, string>)
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

/** Upload a photo for one feature; V2 uploads are feature-scoped, so
 * the task type decides which file endpoint issues the ticket. */
export async function uploadFile(
  client: YouCamClient,
  taskType: TaskType,
  bytes: Uint8Array,
  contentType: string,
  fileName?: string,
): Promise<string> {
  const ticket = await requestUploadTicket(client, taskType, {
    contentType,
    fileName,
    fileSize: bytes.byteLength,
  });
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
  // VERIFIED 2026-10-22 (live probe + docs): the status field is
  // task_status ("running" | "success" | "error"), results nest under
  // "results", and failures carry error + error_message.
  const status =
    pickString(body, ["task_status", "status", "state"]) ?? "";
  if (status === "success" || status === "succeeded" || status === "done") {
    const result =
      body.results && typeof body.results === "object"
        ? (body.results as Record<string, unknown>)
        : body.result && typeof body.result === "object"
          ? (body.result as Record<string, unknown>)
          : body;
    return { state: "success", result };
  }
  if (status === "error" || status === "failed" || status === "failure") {
    const message =
      pickString(body, ["error_message", "error", "message"]) ??
      "The task failed.";
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
  // VERIFIED shape (docs, 2026-10-22): results.color.{skin_color,
  // eye_color, lip_color, eyebrow_color, hair_color}.
  const colorRaw =
    raw.color && typeof raw.color === "object"
      ? (raw.color as Record<string, unknown>)
      : raw;
  const skinColorHex = pickString(colorRaw, ["skin_color", "skinColor", "skin_color_hex"]);
  if (!skinColorHex) {
    throw new YouCamError("Skin Tone result is missing skin_color.");
  }
  const facialRaw =
    raw.facial_colors && typeof raw.facial_colors === "object"
      ? (raw.facial_colors as Record<string, unknown>)
      : colorRaw;
  const facialColors: SkinToneResult["facialColors"] = {};
  const eye = pickString(facialRaw, ["eye_color", "eyeColor"]);
  const lip = pickString(facialRaw, ["lip_color", "lipColor"]);
  const brow = pickString(facialRaw, ["eyebrow_color", "brow_color", "browColor"]);
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
  // VERIFIED 2026-10-22 (live run): the input is the archive's
  // score_info.json, an object keyed by concern:
  // {texture: {raw_score, ui_score, output_mask_name}, ..., all: {score},
  // skin_age: 36, resize_image: {...}}. NOT an inline array.
  const scores: SkinConcernScore[] = [];
  const maskNames: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "all" || key === "resize_image") continue;
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.raw_score !== "number") continue;
    const maskName =
      typeof entry.output_mask_name === "string"
        ? entry.output_mask_name
        : null;
    scores.push({
      action: key,
      rawScore: entry.raw_score,
      uiScore: typeof entry.ui_score === "number" ? entry.ui_score : null,
      maskName,
    });
    if (maskName) maskNames[key] = maskName;
  }
  if (scores.length === 0) {
    throw new YouCamError(
      "Skin Analysis score_info carries no concern scores.",
    );
  }
  const all = raw.all as Record<string, unknown> | undefined;
  return {
    scores,
    maskNames,
    overallScore:
      all && typeof all.score === "number" ? all.score : null,
    skinAge: typeof raw.skin_age === "number" ? raw.skin_age : null,
    archiveUrl: null,
  };
}

/**
 * Minimal ZIP reader for the Skin Analysis result archive: walks the
 * central directory and extracts one entry (stored or deflated).
 * Server-side only (node:zlib). Throws YouCamError on any mismatch.
 */
export async function extractZipEntry(
  bytes: Uint8Array,
  wantedSuffix: string,
): Promise<Uint8Array> {
  const { inflateRawSync } = await import("node:zlib");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new YouCamError("Result archive is not a ZIP file.");
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) {
      throw new YouCamError("Result archive central directory is corrupt.");
    }
    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = decoder.decode(
      bytes.subarray(off + 46, off + 46 + nameLen),
    );
    if (name.endsWith(wantedSuffix)) {
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const comp = bytes.subarray(start, start + compSize);
      if (method === 0) return new Uint8Array(comp);
      if (method === 8) return new Uint8Array(inflateRawSync(comp));
      throw new YouCamError(`Unsupported ZIP method ${method}.`);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new YouCamError(`Result archive has no ${wantedSuffix} entry.`);
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
  // VERIFIED 2026-10-22 (live probe): V2 task bodies take src_file_id.
  const raw = await runTask(client, "skin-tone", { src_file_id: fileId });
  return parseSkinToneResult(raw);
}

export async function runSkinAnalysis(
  client: YouCamClient,
  fileId: string,
  actions: string[],
): Promise<SkinAnalysisResult> {
  // VERIFIED 2026-10-22 (live runs): body takes dst_actions (SD set like
  // wrinkle/pore/texture/acne, or the hd_* set; never mixed). The face
  // must exceed 60% of image width or the task errors with
  // error_src_face_too_small, so callers must send a close framing.
  // The task result is {url} pointing at a ZIP archive; scores live in
  // its score_info.json, which is fetched and parsed here.
  const raw = await runTask(client, "skin-analysis", {
    src_file_id: fileId,
    dst_actions: actions,
  });
  const archiveUrl = pickString(raw, ["url"]);
  if (!archiveUrl) {
    throw new YouCamError("Skin Analysis result is missing its archive URL.");
  }
  const res = await client.fetchFn(archiveUrl);
  if (!res.ok) {
    throw new YouCamError(
      `Skin Analysis archive download failed with HTTP ${res.status}.`,
      res.status,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const scoreBytes = await extractZipEntry(bytes, "score_info.json");
  const scoreInfo = JSON.parse(
    new TextDecoder().decode(scoreBytes),
  ) as Record<string, unknown>;
  return { ...parseSkinAnalysisResult(scoreInfo), archiveUrl };
}

export async function runMakeupVto(
  client: YouCamClient,
  fileId: string,
  params: MakeupVtoParams,
): Promise<MakeupVtoResult> {
  // VERIFIED 2026-10-22 (official docs + 4 live study runs): the makeup-vto
  // task body is src_file_id + version + an effects array; foundation takes
  // palettes [{color, colorIntensity, glowIntensity, coverageIntensity}].
  // Smoothing is OFF by omission: no skin_smooth effect is sent at all.
  // Study caveat: coverageIntensity 60 vs 100 produced identical sampled
  // output, so coverage is a request to the renderer, not a guarantee.
  // The render is a labelled PREVIEW only (jawline gate verdict, 2026-10-22):
  // it can never authorize a BUY verdict.
  const raw = await runTask(client, "makeup-vto", {
    src_file_id: fileId,
    version: "1.0",
    effects: [
      {
        category: "foundation",
        palettes: [
          {
            color: params.colorHex,
            colorIntensity: params.intensity,
            glowIntensity: params.glow,
            coverageIntensity: params.coverage,
          },
        ],
      },
    ],
  });
  return parseMakeupVtoResult(raw);
}
