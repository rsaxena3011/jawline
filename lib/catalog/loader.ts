import { readFile } from "node:fs/promises";
import { parseCatalog, type Catalog } from "./types.ts";

/** Load and validate a catalog JSON file from disk. */
export async function loadCatalogFromFile(path: string): Promise<Catalog> {
  const text = await readFile(path, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Catalog file is not valid JSON: ${path}`);
  }
  return parseCatalog(json);
}

/** Load the bundled seed catalog that ships with the repo. */
export async function loadSeedCatalog(): Promise<Catalog> {
  const url = new URL("./data/catalog.json", import.meta.url);
  return loadCatalogFromFile(url.pathname);
}
