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
  /** Concern identifier, e.g. "wrinkle", "pore", "texture", "acne". */
  action: string;
  /**
   * Raw concern score from score_info.json. NOT a confidence score and
   * carries no verdict authority (MERGED_PLAN_V2 standing rule).
   */
  rawScore: number;
  /** Adjusted display score when the response carries one, else null. */
  uiScore: number | null;
  /** Mask PNG filename inside the result archive, else null. */
  maskName: string | null;
}

export interface SkinAnalysisResult {
  scores: SkinConcernScore[];
  /** Mask PNG filenames by concern, as stored inside the result archive. */
  maskNames: Record<string, string>;
  /** The archive's own "all.score" aggregate, else null. Display only. */
  overallScore: number | null;
  /** The archive's skin_age estimate, else null. Display only. */
  skinAge: number | null;
  /**
   * VERIFIED 2026-10-22: a Skin Analysis task result is an archive URL
   * (results.url, a ZIP holding score_info.json + mask PNGs), not inline
   * scores. The URL expires in about 2 hours; mirror the archive locally
   * at capture time instead of storing the URL.
   */
  archiveUrl: string | null;
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
