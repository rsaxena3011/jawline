import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mirrorResultImage, readManifest } from "../mirror.ts";

/**
 * Fixture mirroring against a stub fetch and a temp directory. The
 * load-bearing assertions: the bytes land on disk at the conventional
 * path, the manifest records the entry with its web path, a second
 * mirror appends instead of clobbering, and re-mirroring the same id
 * replaces the entry.
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

function pngFetch(bytes: number[]): typeof fetch {
  return (async () =>
    new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    })) as unknown as typeof fetch;
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "jawline-fixtures-"));

  const empty = await readManifest(root);
  check(empty.entries.length === 0, "missing manifest reads as empty");

  const entry = await mirrorResultImage("https://cdn.example/render.png", {
    captureId: "capture-001",
    name: "vto-shade-a",
    kind: "vto-render",
    rootDir: root,
    fetchFn: pngFetch([9, 8, 7]),
  });
  check(entry.localPath === "/fixtures/capture-001/vto-shade-a.png", "mirrored file gets the conventional web path");
  check(entry.bytes === 3 && entry.kind === "vto-render", "manifest entry records bytes and kind");

  const onDisk = await readFile(
    join(root, "public", "fixtures", "capture-001", "vto-shade-a.png"),
  );
  check(
    onDisk.length === 3 && onDisk[0] === 9,
    "mirrored bytes are stored on disk verbatim",
  );

  const second = await mirrorResultImage("https://cdn.example/mask.png", {
    captureId: "capture-001",
    name: "mask-oiliness.png",
    kind: "skin-mask",
    rootDir: root,
    fetchFn: pngFetch([1, 2]),
  });
  check(second.localPath.endsWith("mask-oiliness.png"), "names that already carry an extension keep it");

  const manifest = await readManifest(root);
  check(manifest.entries.length === 2, "second mirror appends to the manifest");

  await mirrorResultImage("https://cdn.example/render-v2.png", {
    captureId: "capture-001",
    name: "vto-shade-a",
    kind: "vto-render",
    rootDir: root,
    fetchFn: pngFetch([5, 5, 5, 5]),
  });
  const after = await readManifest(root);
  check(after.entries.length === 2, "re-mirroring the same id replaces, not duplicates");
  check(
    after.entries.find((e) => e.id === "capture-001/vto-shade-a.png")?.bytes === 4,
    "the replaced entry carries the new byte count",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
