/**
 * Build the licensed catalog from The Pudding foundation shades
 * dataset (script for slice 5; the catalog it writes is committed,
 * this script is the provenance of the transformation).
 *
 * Source: shades.csv from the makeup-shades folder of
 * https://github.com/the-pudding/data (The Pudding, "Beauty Brawl",
 * June 2018). The repository LICENSE is the MIT License, Copyright
 * (c) 2019 The Pudding; verified from the repo on 2026-10-23. The
 * dataset records, per shade: brand, product line, the swatch hex
 * recorded from the brand's own website in May 2018, and colour
 * values. It records NO shade names.
 *
 * What this script keeps, and what it deliberately drops:
 * - Kept: the per-shade hex (the dataset's measured value), and
 *   nothing else from the row. Lab values are recomputed from the
 *   hex with the engine's own hexToLab, so the catalog and the
 *   readings share one colour convention.
 * - Dropped at the boundary: brand and product line names. They
 *   never enter the catalog file, so no UI surface can print them.
 *   Display labels are the shades' own hex codes, because the
 *   dataset carries no shade names and inventing names would be
 *   fabrication. A row stays traceable through the public dataset
 *   (dataset + hex identifies it).
 * - Duplicate hexes: the dataset lists some colours under more
 *   than one brand. The catalog keeps the first occurrence and
 *   drops the rest, so no hex appears twice.
 *
 * Usage: node scripts/build-licensed-catalog.ts <path-to-shades.csv>
 * Writes lib/catalog/data/licensed-catalog.json.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseCatalog, type ShadeEntry } from "../lib/catalog/types.ts";
import { hexToLab } from "../lib/decision/color.ts";

/** Minimal RFC 4180 parser: the dataset quotes every field. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])),
  );
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

const SOURCE =
  "The Pudding foundation shades dataset (Beauty Brawl, June 2018), shades.csv, https://github.com/the-pudding/data/tree/master/makeup-shades";
const RELIABILITY =
  "Swatch hex recorded from the brand's own website in May 2018 for The Pudding's Beauty Brawl essay. A website swatch and a selfie reading are two different measurements with an unknown offset, and 2018 shade ranges may have changed or been discontinued since. Dated reference data, not a current shelf check.";
const LICENSE = "MIT License (The Pudding, the-pudding/data repository)";

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: node scripts/build-licensed-catalog.ts <shades.csv>");
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(csvPath, "utf8"));

  const seenHex = new Set<string>();
  const shades: ShadeEntry[] = [];
  let dropped = 0;
  for (const row of rows) {
    const hexBody = (row.hex ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hexBody)) {
      console.error(`Skipping row with unusable hex: ${JSON.stringify(row)}`);
      dropped++;
      continue;
    }
    if (seenHex.has(hexBody)) {
      dropped++;
      continue;
    }
    seenHex.add(hexBody);
    const seq = String(shades.length + 1).padStart(4, "0");
    const hex = `#${hexBody}`;
    const lab = hexToLab(hex);
    shades.push({
      id: `pudding-${seq}`,
      brand: "Licensed catalog",
      product: "Foundation shade swatch (dataset entry)",
      shadeId: `PUD-${seq}`,
      shadeName: hexBody.toUpperCase(),
      hex,
      lab: { l: round3(lab.l), a: round3(lab.a), b: round3(lab.b) },
      finish: "Not recorded in the source dataset",
      source: SOURCE,
      sourceDate: "2018-06-05",
      reliability: RELIABILITY,
      license: LICENSE,
      fixture: false,
    });
  }

  // Validate through the real schema before anything is written.
  const catalog = parseCatalog({ version: 1, shades });

  const outUrl = new URL(
    "../lib/catalog/data/licensed-catalog.json",
    import.meta.url,
  );
  writeFileSync(outUrl, JSON.stringify(catalog));
  console.log(
    `Wrote ${catalog.shades.length} shades from ${rows.length} dataset rows (${dropped} dropped: duplicate or unusable hexes) to ${outUrl.pathname}`,
  );
}

main();
