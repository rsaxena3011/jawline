/**
 * Study fixtures: the six canonical synthetic faces from the C088
 * measurement study (study/STUDY_LOG.md), as recorded Skin Tone
 * results. Every value here is copied from the saved API payloads in
 * study/results/; nothing is invented, and a fixture replay costs 0
 * units because no API call happens.
 *
 * The pixel hex is the study's own ground truth (Doom-measured
 * forehead and cheek medians from the generated face). It is kept on
 * the fixture so tests can measure how far the API reading sits from
 * the face it read, which is where the decision thresholds come
 * from. Product code never treats the pixel hex as the reading.
 *
 * hairColorHex is recorded because the payload carries it, and it is
 * WRONG on these faces (the study found hair_color wrong on 6 of 6).
 * It exists in the fixture so a test can prove the decision engine
 * ignores it: only skinColorHex is load-bearing, ever.
 */

import type { SkinToneResult } from "../youcam/types.ts";

export interface StudyToneFixture {
  /** Study id, e.g. "tone2". */
  id: string;
  /** Short study label, e.g. "warm medium". */
  label: string;
  /** File under study/results/ the reading was copied from. */
  sourceFile: string;
  /** The Skin Tone result as the client would parse the payload. */
  result: SkinToneResult;
  /** Study ground truth: pixel medians of the generated face. */
  pixelHex: string;
}

function tone(
  id: string,
  label: string,
  sourceFile: string,
  skinColorHex: string,
  hairColorHex: string,
  pixelHex: string,
): StudyToneFixture {
  return {
    id,
    label,
    sourceFile,
    result: { skinColorHex, facialColors: { hair: hairColorHex } },
    pixelHex,
  };
}

export const STUDY_TONES: readonly StudyToneFixture[] = [
  tone(
    "tone1",
    "deep espresso",
    "tone1_deep_espresso_skin_tone.json",
    "#6e4c37",
    "#B56637",
    "#663d2c",
  ),
  tone(
    "tone2",
    "warm medium",
    "tone2_warm_medium_skin_tone.json",
    "#a77d60",
    "#FAF0BE",
    "#bc7d58",
  ),
  tone(
    "tone3",
    "golden tan",
    "tone3_golden_tan_skin_tone.json",
    "#af8569",
    "#FAF0BE",
    "#d39c77",
  ),
  tone(
    "tone4",
    "olive tan",
    "tone4_olive_tan_skin_tone.json",
    "#af8e73",
    "#B56637",
    "#b58669",
  ),
  tone(
    "tone5",
    "light beige",
    "tone5_light_beige_skin_tone.json",
    "#b29078",
    "#B56637",
    "#d4a58c",
  ),
  tone(
    "tone6",
    "natural porcelain",
    "tone6_skin_tone.json",
    "#b7937d",
    "#FAF0BE",
    "#e4b7af",
  ),
];

export function studyTone(id: string): StudyToneFixture {
  const found = STUDY_TONES.find((t) => t.id === id);
  if (!found) throw new Error(`Unknown study tone fixture: ${id}`);
  return found;
}
