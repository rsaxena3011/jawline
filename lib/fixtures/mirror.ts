/**
 * Fixture mirroring: YouCam result URLs (renders, masks) expire, so
 * the moment a result arrives, its image is downloaded and stored
 * locally. Replays and judge fixtures are then served from disk
 * forever, independent of the provider's retention window.
 *
 * Layout (see fixtures/README.md for the full convention):
 * - Raw API response JSON:  fixtures/<capture-id>/response.json
 * - Mirrored images:        public/fixtures/<capture-id>/<name>
 * - Manifest:               public/fixtures/manifest.json
 *
 * Mirrored binaries are git-ignored by default: they can show real
 * faces, and faces stay out of the public repo until written consent
 * is on file (MERGED_PLAN_V2). The manifest is safe to commit.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FixtureManifestEntry {
  /** "<capture-id>/<file-name>" */
  id: string;
  captureId: string;
  /** What the image is, e.g. "vto-render" or "skin-mask". */
  kind: string;
  sourceUrl: string;
  /** Web path the mirrored file is served from. */
  localPath: string;
  capturedAt: string;
  bytes: number;
}

export interface FixtureManifest {
  version: 1;
  entries: FixtureManifestEntry[];
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export function fixturesRoot(rootDir: string = process.cwd()): string {
  return join(rootDir, "public", "fixtures");
}

export function manifestPath(rootDir: string = process.cwd()): string {
  return join(fixturesRoot(rootDir), "manifest.json");
}

export async function readManifest(
  rootDir: string = process.cwd(),
): Promise<FixtureManifest> {
  try {
    const text = await readFile(manifestPath(rootDir), "utf8");
    const parsed = JSON.parse(text) as FixtureManifest;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error("Fixture manifest has an unexpected shape.");
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    throw err;
  }
}

function sanitize(segment: string): string {
  const clean = segment.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "");
  if (!clean) throw new Error(`Invalid fixture path segment: "${segment}"`);
  return clean;
}

function extensionFor(name: string, contentType: string | null): string {
  const dot = name.lastIndexOf(".");
  if (dot > 0) return "";
  if (contentType) {
    const ext = EXT_BY_CONTENT_TYPE[contentType.split(";")[0].trim()];
    if (ext) return ext;
  }
  return ".bin";
}

/**
 * Download a result image NOW and store it under public/fixtures,
 * recording it in the manifest. Call this at capture time for every
 * URL the API returns; never store the bare URL and hope it lives.
 */
export async function mirrorResultImage(
  sourceUrl: string,
  opts: {
    captureId: string;
    name: string;
    kind?: string;
    rootDir?: string;
    fetchFn?: typeof fetch;
  },
): Promise<FixtureManifestEntry> {
  const rootDir = opts.rootDir ?? process.cwd();
  const fetchFn = opts.fetchFn ?? fetch;
  const captureId = sanitize(opts.captureId);
  const rawName = sanitize(opts.name);

  const res = await fetchFn(sourceUrl);
  if (!res.ok) {
    throw new Error(
      `Mirroring failed for ${sourceUrl} (HTTP ${res.status}). ` +
        "Result URLs expire; re-run the capture instead of retrying later.",
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const fileName = rawName + extensionFor(rawName, res.headers.get("content-type"));

  const dir = join(fixturesRoot(rootDir), captureId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), bytes);

  const entry: FixtureManifestEntry = {
    id: `${captureId}/${fileName}`,
    captureId,
    kind: opts.kind ?? "image",
    sourceUrl,
    localPath: `/fixtures/${captureId}/${fileName}`,
    capturedAt: new Date().toISOString(),
    bytes: bytes.length,
  };

  const manifest = await readManifest(rootDir);
  const existing = manifest.entries.findIndex((e) => e.id === entry.id);
  if (existing >= 0) manifest.entries[existing] = entry;
  else manifest.entries.push(entry);
  await writeFile(
    manifestPath(rootDir),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return entry;
}
