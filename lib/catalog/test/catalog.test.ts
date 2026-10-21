import { loadCatalogFromFile, loadSeedCatalog } from "../loader.ts";
import { CatalogError, parseCatalog } from "../types.ts";

/**
 * Catalog loader and schema validation. The load-bearing assertions:
 * the seed catalog loads and its only entry is the labelled fixture,
 * and provenance is enforced (an entry with no source, a bad hex, an
 * out-of-range LAB value, or a duplicate id is rejected at load).
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

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-001",
    brand: "Test Brand",
    product: "Test Foundation",
    shadeId: "T-01",
    shadeName: "Test Shade",
    hex: "#A9744F",
    lab: { l: 48.1, a: 15.2, b: 20.3 },
    finish: "matte",
    source: "Hand-checked swatch card",
    sourceDate: "2026-10-21",
    reliability: "Checked by hand against the physical swatch.",
    license: "MIT",
    ...overrides,
  };
}

function throwsCatalog(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof CatalogError;
  }
}

async function main() {
  // Seed catalog loads; its single entry is the labelled fixture.
  const seed = await loadSeedCatalog();
  check(seed.version === 1, "seed catalog loads with version 1");
  check(seed.shades.length === 1, "seed catalog has exactly the example entry");
  check(seed.shades[0].fixture === true, "seed entry is marked as a fixture");
  check(
    seed.shades[0].reliability.includes("FIXTURE ONLY"),
    "seed entry reliability note says FIXTURE ONLY",
  );

  // Loader from an explicit path agrees with the bundled loader.
  const byPath = await loadCatalogFromFile(
    new URL("../data/catalog.json", import.meta.url).pathname,
  );
  check(byPath.shades[0].id === seed.shades[0].id, "path loader reads the same seed");

  // A well-formed real entry parses, fixture defaults to false.
  const parsed = parseCatalog({ version: 1, shades: [validEntry()] });
  check(parsed.shades[0].fixture === false, "real entries default fixture to false");
  check(parsed.shades[0].hex === "#A9744F", "entry fields survive parsing");

  // Provenance and shape enforcement.
  check(
    throwsCatalog(() => parseCatalog({ version: 1, shades: [validEntry({ source: "" })] })),
    "entry with an empty source is rejected",
  );
  check(
    throwsCatalog(() => parseCatalog({ version: 1, shades: [validEntry({ hex: "A9744F" })] })),
    "hex without the leading # is rejected",
  );
  check(
    throwsCatalog(() =>
      parseCatalog({ version: 1, shades: [validEntry({ lab: { l: 140, a: 0, b: 0 } })] }),
    ),
    "lab.l above 100 is rejected",
  );
  check(
    throwsCatalog(() => parseCatalog({ version: 1, shades: [validEntry({ sourceDate: "Oct 2026" })] })),
    "non-ISO sourceDate is rejected",
  );
  check(
    throwsCatalog(() =>
      parseCatalog({ version: 1, shades: [validEntry(), validEntry()] }),
    ),
    "duplicate shade ids are rejected",
  );
  check(
    throwsCatalog(() => parseCatalog({ version: 1, shades: "nope" })),
    "non-array shades are rejected",
  );

  // An empty catalog is valid (the real shade build comes later).
  const empty = parseCatalog({ version: 1, shades: [] });
  check(empty.shades.length === 0, "an empty catalog parses cleanly");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
