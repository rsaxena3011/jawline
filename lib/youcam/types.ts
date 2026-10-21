/**
 * Typed shapes for the YouCam tasks Jawline uses, following the
 * documented schemas recorded in MERGED_PLAN_V2 (2026-10-21).
 *
 * Facts the plan settled, encoded here on purpose:
 * - Skin Tone (Facial Color Tones) returns a skin_color hex plus other
 *   facial colour values. It returns NO undertone field, so this type
 *   has none. Undertone, when we state one, is our own inference and
 *   must be labelled as such wherever it surfaces.
 * - Skin Analysis returns per-concern scores. raw_score is NOT a
 *   confidence value: a low score means the concern is more visible.
 *   The API reports no confidence, so this type has no such field.
 * - Makeup VTO returns a rendered image URL. A render is a preview
 *   (and, for the jawline test, a measurement input), never proof.
 */

export interface SkinToneResult {
  /** Detected facial skin colour, "#RRGGBB". */
  skinColorHex: string;
  /** Other facial colours when the response carries them. */
  facialColors: {
    eye?: string;
    lip?: string;
    brow?: string;
    hair?: string;
  };
}

export interface SkinConcernScore {
  /** Concern identifier, e.g. "oiliness", "redness", "moisture". */
  action: string;
  /** Raw concern score. Higher means healthier-looking for that concern. */
  rawScore: number;
  /** Adjusted display score when the response carries one, else null. */
  uiScore: number | null;
}

export interface SkinAnalysisResult {
  scores: SkinConcernScore[];
  /**
   * Segmentation mask image URLs by concern. These URLs expire fast;
   * mirror them locally at capture time (lib/fixtures) instead of
   * storing the URL.
   */
  maskUrls: Record<string, string>;
}

export interface MakeupVtoResult {
  /** Rendered try-on image URL. Expires; mirror at capture time. */
  imageUrl: string;
}

/**
 * Fixed Makeup VTO settings for foundation checks (MERGED_PLAN_V2):
 * smoothing is explicitly OFF because the API default of 50 is a
 * beauty filter; coverage, glow, and intensity stay identical across
 * candidate shades so renders are comparable. Only the colour varies.
 */
export const FOUNDATION_VTO_FIXED_SETTINGS = {
  smoothing: 0,
  coverage: 70,
  glow: 0,
  intensity: 100,
} as const;

export interface MakeupVtoParams {
  /** Foundation colour to render, "#RRGGBB". */
  colorHex: string;
  smoothing: number;
  coverage: number;
  glow: number;
  intensity: number;
}

export function foundationVtoParams(colorHex: string): MakeupVtoParams {
  return { colorHex, ...FOUNDATION_VTO_FIXED_SETTINGS };
}
