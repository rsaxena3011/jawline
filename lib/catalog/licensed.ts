/**
 * The licensed catalog: real foundation shade data, replacing the
 * fixture shades as the ranking target for live mode and the brand
 * screen (slice 5). The fixture catalog stays for the fixture-mode
 * replay and its tests; nothing about it changes here.
 *
 * Provenance, stated once and carried by every entry: the shades
 * are The Pudding's foundation shades dataset, published with the
 * essay "Beauty Brawl" in June 2018. The Pudding collected them in
 * May 2018 by recording the swatch hex of each liquid foundation
 * shade from the brands' own websites (best-seller lines in the
 * US, Nigeria, India and Japan). The dataset is used under the MIT
 * License (repository LICENSE, Copyright (c) 2019 The Pudding),
 * verified from github.com/the-pudding/data on 2026-10-23.
 *
 * The dataset records no shade names, so display labels are the
 * shades' own hex codes; inventing names would be fabrication.
 * Brand and product line names from the dataset never enter this
 * catalog at all (see scripts/build-licensed-catalog.ts), so no
 * surface can print them: entry brand reads "Licensed catalog"
 * and the label is the hex code. A shade stays traceable through
 * the public dataset, where dataset plus hex identifies the row.
 *
 * 625 dataset rows became 617 catalog shades: 8 rows repeated a
 * hex already listed under another brand and were dropped, so no
 * hex appears twice. Swatches are from 2018, and every surface
 * that ranks this catalog says so.
 */

import { parseCatalog, type Catalog } from "./types.ts";
import rawLicensedCatalog from "./data/licensed-catalog.json" with { type: "json" };

export interface LicensedCatalogProvenance {
  dataset: string;
  essay: string;
  sourceUrl: string;
  license: string;
  /** Year the swatches were recorded (May) and published (June). */
  swatchYear: number;
  /** ISO date this dataset copy was accessed for the build. */
  accessedDate: string;
  /** Rows in the source shades.csv when accessed. */
  sourceRows: number;
}

export const LICENSED_CATALOG_PROVENANCE: LicensedCatalogProvenance = {
  dataset: "The Pudding foundation shades dataset",
  essay: "Beauty Brawl (The Pudding, June 2018)",
  sourceUrl: "https://github.com/the-pudding/data/tree/master/makeup-shades",
  license: "MIT License (Copyright (c) 2019 The Pudding)",
  swatchYear: 2018,
  accessedDate: "2026-10-23",
  sourceRows: 625,
};

const PARSED: Catalog = parseCatalog(rawLicensedCatalog);

/** The licensed catalog, parsed and validated once at load. */
export function licensedCatalog(): Catalog {
  return PARSED;
}
