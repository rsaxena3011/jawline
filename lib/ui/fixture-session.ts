/**
 * Fixture session: turns the check screen's selections into a
 * DecisionInput for the engine. This module builds INPUTS only. It
 * runs no verdict logic of its own; the capture gate, the owned
 * check and the ranking all happen inside runDecision.
 *
 * The framing scenarios are the study's own numbers (see
 * lib/decision/capture.ts): a tight crop at 68% of photo width
 * passed Skin Analysis, a head-and-shoulders portrait at 45%
 * failed, and exactly 60% fails because the rule is exceed, not
 * reach. Offering them as scenarios lets the demo show the gate
 * working, in the gate's own words, without inventing measurements
 * for faces the study never framed those ways.
 */

import {
  validateShadeEntry,
  type ShadeEntry,
} from "../catalog/types.ts";
import type { CaptureMeasurement } from "../decision/capture.ts";
import { hexToLab, isHexColor } from "../decision/color.ts";
import type { DecisionInput } from "../decision/decision.ts";
import { studyFixtureCatalog, studyTone } from "../decision/fixtures.ts";

export interface FixtureFraming {
  id: string;
  label: string;
  measurement: CaptureMeasurement;
}

export const FIXTURE_FRAMINGS: readonly FixtureFraming[] = [
  {
    id: "study-crop",
    label: "Tight crop, the framing that passed in the study",
    measurement: { faceDetected: true, faceWidthPx: 680, imageWidthPx: 1000 },
  },
  {
    id: "at-limit",
    label: "Exactly at the limit",
    measurement: { faceDetected: true, faceWidthPx: 600, imageWidthPx: 1000 },
  },
  {
    id: "portrait",
    label: "Head-and-shoulders portrait",
    measurement: { faceDetected: true, faceWidthPx: 450, imageWidthPx: 1000 },
  },
];

export function fixtureFraming(id: string): FixtureFraming {
  const found = FIXTURE_FRAMINGS.find((f) => f.id === id);
  if (!found) throw new Error(`Unknown fixture framing: ${id}`);
  return found;
}

/** Display text for the measurement being fed to the gate. */
export function faceShareText(measurement: CaptureMeasurement): string {
  if (!measurement.faceDetected || measurement.faceWidthPx === 0) {
    return "No face detected in this framing.";
  }
  const pct = Math.round(
    (measurement.faceWidthPx / measurement.imageWidthPx) * 100,
  );
  return `Face fills ${pct}% of the photo width (${measurement.faceWidthPx} of ${measurement.imageWidthPx} px).`;
}

export type OwnedShadeResult =
  | { shade: ShadeEntry }
  | { error: string };

/**
 * Build the owned-bottle entry from what the user typed. The entry
 * is validated through the catalog schema like any other shade, so
 * the owned-bottle check compares a real ShadeEntry, not form text.
 */
export function buildOwnedShade(
  hexRaw: string,
  nameRaw: string,
): OwnedShadeResult {
  const trimmed = hexRaw.trim();
  const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (!isHexColor(hex)) {
    return {
      error:
        "That shade does not read as a hex colour. Use the form #RRGGBB, for example #A77D60, or clear the field to skip the owned-bottle check.",
    };
  }
  const name = nameRaw.trim();
  const lab = hexToLab(hex);
  const shade = validateShadeEntry(
    {
      id: "owned-by-user",
      brand: "Your bottle",
      product: "A foundation you already own",
      shadeId: "OWNED",
      shadeName: name.length > 0 ? name : "Unnamed shade",
      hex,
      lab: { l: lab.l, a: lab.a, b: lab.b },
      finish: "Not specified",
      source: "Entered by the user in this session",
      sourceDate: new Date().toISOString().slice(0, 10),
      reliability:
        "User-entered shade colour, taken as given for the owned-bottle check.",
      license: "User-provided",
      fixture: false,
    },
    0,
  );
  return { shade };
}

export interface FixtureSelection {
  toneId: string;
  framingId: string;
  ownedHex: string;
  ownedName: string;
}

export type FixtureInputResult =
  | { input: DecisionInput }
  | { error: string };

export function buildFixtureInput(
  selection: FixtureSelection,
): FixtureInputResult {
  const tone = studyTone(selection.toneId);
  const framing = fixtureFraming(selection.framingId);

  let ownedShades: ShadeEntry[] = [];
  if (selection.ownedHex.trim().length > 0) {
    const owned = buildOwnedShade(selection.ownedHex, selection.ownedName);
    if ("error" in owned) return { error: owned.error };
    ownedShades = [owned.shade];
  }

  return {
    input: {
      capture: framing.measurement,
      skinTone: tone.result,
      catalog: studyFixtureCatalog(),
      ownedShades,
    },
  };
}
