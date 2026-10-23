import { licensedCatalog, LICENSED_CATALOG_PROVENANCE } from "../licensed.ts";
import { CatalogError, parseCatalog } from "../types.ts";
import { hexToLab } from "../../decision/color.ts";
import { runDecision, type Verdict } from "../../decision/decision.ts";
import { STUDY_TONES } from "../../decision/fixtures.ts";
import { computeBrandView } from "../../ui/brand-view.ts";
import { buildReceiptView } from "../../ui/receipt-view.ts";

/**
 * Licensed catalog (slice 5): the Pudding foundation shades
 * dataset as the ranking target for live mode and the brand
 * screen. The load-bearing assertions: every entry is real,
 * provenance-carrying data (valid hex, a display label, dataset,
 * source URL, license and year all present); no hex appears
 * twice; display labels are structurally brand-free (the dataset's
 * brand names cannot appear in any rendered line of the receipt
 * or the brand screen); and the brand aggregate over this catalog
 * equals an independent per-tone tally through the same engine
 * path the receipt uses. The pinned distribution at the end is
 * the measured baseline for this catalog under the cluster rule
 * (boss ruling 2026-10-23, defect #10), recorded in BUILD_LOG:
 * the three standard-band tones return BUY as cluster picks,
 * and the three pale tones return SHADE-RISK because the pale
 * band's wider 5.0 cluster reaches past the match-range edge.
 * That is the rule behaving as ruled, not a target to tune
 * thresholds towards.
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

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const STUDY_FRAMING = {
  faceDetected: true,
  faceWidthPx: 680,
  imageWidthPx: 1000,
};

/** The dataset's brand names (from shades.csv), for leakage checks. */
const DATASET_BRANDS = [
  "Addiction", "Beauty Bakerie", "Bharat & Doris", "Black Opal",
  "Black Up", "Blue Heaven", "Bobbi Brown", "Colorbar",
  "Covergirl + Olay", "Dior", "Elsas Pro", "Estée Lauder", "Fenty",
  "Hegai and Ester", "House of Tara", "IPSA", "Iman", "Kate",
  "Kuddy", "L'Oréal", "Lakmé", "Lancôme", "Laws of Nature",
  "Lotus Herbals", "MAC", "Make Up For Ever", "Maybelline", "NARS",
  "Nykaa", "Olivia", "RMK", "Revlon", "Shiseido", "Shu Uemera",
  "Trim & Prissy", "bareMinerals",
];

function leaksBrand(text: string): string | null {
  const hay = text.toLowerCase();
  for (const brand of DATASET_BRANDS) {
    if (hay.includes(brand.toLowerCase())) return brand;
  }
  return null;
}

function main() {
  const catalog = licensedCatalog();
  const shades = catalog.shades;

  // ---- Size and provenance of the catalog as a whole ----
  check(
    shades.length === 617,
    "licensed catalog holds 617 shades (625 dataset rows minus 8 duplicate hexes)",
  );
  check(
    LICENSED_CATALOG_PROVENANCE.dataset.includes("Pudding") &&
      LICENSED_CATALOG_PROVENANCE.sourceUrl ===
        "https://github.com/the-pudding/data/tree/master/makeup-shades" &&
      LICENSED_CATALOG_PROVENANCE.license.includes("MIT") &&
      LICENSED_CATALOG_PROVENANCE.swatchYear === 2018 &&
      LICENSED_CATALOG_PROVENANCE.sourceRows === 625 &&
      /^\d{4}-\d{2}-\d{2}$/.test(LICENSED_CATALOG_PROVENANCE.accessedDate),
    "catalog provenance names the dataset, its URL, the MIT license, the 2018 swatches and the access date",
  );

  // ---- Every entry: valid hex, display label, full provenance ----
  check(
    shades.every((s) => HEX_RE.test(s.hex)),
    "every catalog entry has a valid #RRGGBB hex",
  );
  check(
    shades.every((s) => s.shadeName === s.hex.slice(1).toUpperCase()),
    "every display label is the shade's own hex code (the dataset records no shade names; none were invented)",
  );
  check(
    shades.every(
      (s) =>
        s.brand === "Licensed catalog" &&
        s.fixture === false &&
        s.source.includes("The Pudding foundation shades dataset") &&
        s.source.includes("github.com/the-pudding/data") &&
        s.license.includes("MIT") &&
        s.sourceDate === "2018-06-05" &&
        s.reliability.length > 0 &&
        s.finish.length > 0 &&
        s.product.length > 0 &&
        s.shadeId.length > 0,
    ),
    "every entry carries complete provenance (dataset, source URL, license, 2018 date, reliability note) and is not a fixture",
  );
  check(
    shades.every((s) => {
      const lab = hexToLab(s.hex);
      return (
        Math.abs(s.lab.l - Math.round(lab.l * 1000) / 1000) < 1e-9 &&
        Math.abs(s.lab.a - Math.round(lab.a * 1000) / 1000) < 1e-9 &&
        Math.abs(s.lab.b - Math.round(lab.b * 1000) / 1000) < 1e-9
      );
    }),
    "every entry's Lab is the engine's own hexToLab of its hex, so catalog and readings share one colour convention",
  );

  // ---- No duplicates ----
  check(
    new Set(shades.map((s) => s.hex.toLowerCase())).size === shades.length &&
      new Set(shades.map((s) => s.id)).size === shades.length &&
      new Set(shades.map((s) => s.shadeId)).size === shades.length,
    "no duplicate hexes, ids or shade codes in the licensed catalog",
  );

  // ---- Brand names cannot reach a rendered surface ----
  check(
    shades.every(
      (s) => leaksBrand(`${s.brand} ${s.shadeName} ${s.product}`) === null,
    ),
    "no dataset brand name appears in any entry's display fields (brand, label, product)",
  );
  const view = computeBrandView(catalog);
  check(
    view.allLines.every((line) => leaksBrand(line) === null),
    "no dataset brand name appears anywhere in the brand screen's rendered lines",
  );
  const receipts = STUDY_TONES.map((tone) =>
    runDecision({
      capture: STUDY_FRAMING,
      skinTone: tone.result,
      catalog,
      ownedShades: [],
    }),
  );
  check(
    receipts.every((receipt) =>
      buildReceiptView(receipt).allLines.every(
        (line) => leaksBrand(line) === null,
      ),
    ),
    "no dataset brand name appears anywhere in any receipt's rendered lines over this catalog",
  );
  check(
    receipts.every((receipt) =>
      buildReceiptView(receipt).rankingRows.every((row) =>
        /^Licensed catalog [0-9A-F]{6}$/.test(row.shadeLabel),
      ),
    ),
    "every ranking label on every receipt is the brand-free form: Licensed catalog plus hex code",
  );

  // ---- The aggregate equals an independent per-tone tally ----
  const tally = new Map<Verdict, number>();
  for (const receipt of receipts) {
    tally.set(receipt.verdict, (tally.get(receipt.verdict) ?? 0) + 1);
  }
  check(
    view.verdictRows.every(
      (row) => row.count === (tally.get(row.verdict) ?? 0),
    ) &&
      view.perTone.every(
        (row, i) =>
          row.verdict === receipts[i].verdict &&
          row.reasonTag === receipts[i].reasonTag &&
          row.headline === receipts[i].headline,
      ),
    "the brand aggregate over the licensed catalog equals an independent per-tone tally through runDecision",
  );
  check(
    view.verdictRows.reduce((sum, row) => sum + row.count, 0) === 6 &&
      view.gapNumerator === 6 - (tally.get("BUY") ?? 0),
    "the licensed buckets sum to the six tones and the gap line uses the engine's counts",
  );

  // ---- Honest labelling on the licensed screen ----
  const catalogLine =
    view.honestyLines.find((line) => line.startsWith("Catalog:")) ?? "";
  check(
    catalogLine.includes("real, licensed catalog") &&
      catalogLine.includes("The Pudding foundation shades dataset") &&
      catalogLine.includes("2018") &&
      catalogLine.includes("MIT") &&
      !catalogLine.includes("fixture catalog"),
    "the brand screen's catalog line names the real dataset, its 2018 swatches and its license where the fixture label used to be",
  );

  // ---- Pinned measured baseline for this catalog (BUILD_LOG) ----
  check(
    view.perTone.map((row) => row.verdict).join("|") ===
      "BUY|BUY|BUY|SHADE-RISK|SHADE-RISK|SHADE-RISK" &&
      (tally.get("BUY") ?? 0) === 3 &&
      view.coverageGapLine ===
        "3 of 6 study tones had no safe BUY in this catalog",
    "baseline holds under the cluster rule: tones 1 to 3 BUY as cluster picks, tones 4 to 6 SHADE-RISK (pale clusters straddle the range edge), gap 3 of 6",
  );
  check(
    receipts.every(
      (receipt) =>
        receipt.cluster.length > 0 &&
        receipt.cluster[0].shade.id === receipt.ranking[0].shade.id,
    ) &&
      receipts
        .slice(0, 3)
        .every(
          (receipt) =>
            receipt.verdict === "BUY" &&
            receipt.cluster.every((row) => row.inMatchRange),
        ) &&
      receipts
        .slice(3)
        .every(
          (receipt) =>
            receipt.verdict === "SHADE-RISK" &&
            receipt.cluster.some((row) => !row.inMatchRange),
        ),
    "every licensed receipt carries its cluster, winner first; the BUY clusters are fully in range and each SHADE-RISK cluster has a member outside it",
  );

  // ---- Attack: a damaged licensed entry is refused at load ----
  const real = JSON.parse(JSON.stringify(shades[0])) as Record<
    string,
    unknown
  >;
  const throwsCatalog = (entry: Record<string, unknown>): boolean => {
    try {
      parseCatalog({ version: 1, shades: [entry] });
      return false;
    } catch (err) {
      return err instanceof CatalogError;
    }
  };
  check(
    throwsCatalog({ ...real, hex: "banana" }) &&
      throwsCatalog({ ...real, hex: "#GGGGGG" }) &&
      throwsCatalog({ ...real, hex: "F3CFB3" }),
    "attack: a licensed entry with a malformed hex is rejected by catalog validation",
  );
  check(
    throwsCatalog({ ...real, source: "" }) &&
      throwsCatalog({ ...real, license: "" }),
    "attack: a licensed entry stripped of its provenance is rejected by catalog validation",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
