/**
 * Shade catalog schema (MERGED_PLAN_V2).
 *
 * The catalog is the least credible artifact in the original plan, so
 * every entry is forced to carry its provenance: where the colour
 * came from, when, how reliable it is, and under what license it is
 * used. An entry without a source is rejected at load time; there is
 * no way to load a bare hex and quietly treat it as measured truth.
 * Swatch colours copied from brand websites and selfie colours are
 * two different measurements with an unknown offset; the reliability
 * note is where that gets said, per entry.
 */

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

export interface ShadeEntry {
  id: string;
  brand: string;
  product: string;
  shadeId: string;
  shadeName: string;
  /** Swatch colour, "#RRGGBB". Provenance lives in source/reliability. */
  hex: string;
  lab: LabColor;
  /** Finish family, e.g. "matte", "satin", "dewy", "serum". */
  finish: string;
  /** Where the colour data came from. */
  source: string;
  /** ISO date (YYYY-MM-DD) the source data was captured or published. */
  sourceDate: string;
  /** Plain-language reliability note, including known error sources. */
  reliability: string;
  /** License the colour data is used under. */
  license: string;
  /** True only for the labelled plumbing example. Real entries: false. */
  fixture: boolean;
}

export interface Catalog {
  version: number;
  shades: ShadeEntry[];
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireString(
  obj: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CatalogError(`${where}: "${key}" must be a non-empty string.`);
  }
  return value;
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  where: string,
): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CatalogError(`${where}: "${key}" must be a finite number.`);
  }
  return value;
}

export function validateShadeEntry(raw: unknown, index = 0): ShadeEntry {
  const where = `shades[${index}]`;
  if (!raw || typeof raw !== "object") {
    throw new CatalogError(`${where}: entry must be an object.`);
  }
  const obj = raw as Record<string, unknown>;

  const hex = requireString(obj, "hex", where);
  if (!HEX_RE.test(hex)) {
    throw new CatalogError(`${where}: "hex" must look like "#RRGGBB".`);
  }

  const sourceDate = requireString(obj, "sourceDate", where);
  if (!DATE_RE.test(sourceDate) || Number.isNaN(Date.parse(sourceDate))) {
    throw new CatalogError(
      `${where}: "sourceDate" must be an ISO date (YYYY-MM-DD).`,
    );
  }

  const labRaw = obj.lab;
  if (!labRaw || typeof labRaw !== "object") {
    throw new CatalogError(`${where}: "lab" must be an object with l, a, b.`);
  }
  const labObj = labRaw as Record<string, unknown>;
  const lab: LabColor = {
    l: requireNumber(labObj, "l", `${where}.lab`),
    a: requireNumber(labObj, "a", `${where}.lab`),
    b: requireNumber(labObj, "b", `${where}.lab`),
  };
  if (lab.l < 0 || lab.l > 100) {
    throw new CatalogError(`${where}: lab.l must be between 0 and 100.`);
  }
  if (lab.a < -128 || lab.a > 127 || lab.b < -128 || lab.b > 127) {
    throw new CatalogError(`${where}: lab.a and lab.b must be between -128 and 127.`);
  }

  return {
    id: requireString(obj, "id", where),
    brand: requireString(obj, "brand", where),
    product: requireString(obj, "product", where),
    shadeId: requireString(obj, "shadeId", where),
    shadeName: requireString(obj, "shadeName", where),
    hex,
    lab,
    finish: requireString(obj, "finish", where),
    source: requireString(obj, "source", where),
    sourceDate,
    reliability: requireString(obj, "reliability", where),
    license: requireString(obj, "license", where),
    fixture: obj.fixture === true,
  };
}

export function parseCatalog(raw: unknown): Catalog {
  if (!raw || typeof raw !== "object") {
    throw new CatalogError("Catalog must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== "number") {
    throw new CatalogError('Catalog "version" must be a number.');
  }
  if (!Array.isArray(obj.shades)) {
    throw new CatalogError('Catalog "shades" must be an array.');
  }
  const shades = obj.shades.map((entry, i) => validateShadeEntry(entry, i));
  const seen = new Set<string>();
  for (const shade of shades) {
    if (seen.has(shade.id)) {
      throw new CatalogError(`Catalog has a duplicate shade id: ${shade.id}`);
    }
    seen.add(shade.id);
  }
  return { version: obj.version, shades };
}
