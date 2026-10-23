/**
 * Colour math for the decision engine: sRGB hex to CIELAB, and the
 * CIEDE2000 difference (delta E 2000) between two Lab colours.
 *
 * Why CIEDE2000 and not a plain RGB or Lab distance: the study
 * (study/STUDY_LOG.md) showed the YouCam skin_color reading and a
 * pixel median of the same face disagree by RGB distances of 14 to
 * 76, which says nothing about how different the colours look.
 * CIEDE2000 is the perceptual metric the plan (MERGED_PLAN_V2) names
 * for catalog ranking, and every threshold in the decision engine is
 * stated in its units so the receipt can show numbers a colour
 * scientist would recognise.
 */

import type { LabColor } from "../catalog/types.ts";

export type { LabColor };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

/** Convert "#RRGGBB" (sRGB, D65) to CIELAB. Throws on a bad hex. */
export function hexToLab(hex: string): LabColor {
  if (!isHexColor(hex)) {
    throw new Error(`Not a "#RRGGBB" colour: ${hex}`);
  }
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = srgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  const [r, g, b] = linear;
  // sRGB to XYZ, then normalise by the D65 white point.
  const xyz: [number, number, number] = [
    (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047,
    (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0,
    (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883,
  ];
  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const [fx, fy, fz] = xyz.map(f);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * CIEDE2000 colour difference between two Lab colours.
 * Reference implementation shape: Sharma, Wu and Dalal (2005),
 * whose 34 published test pairs the unit tests check against.
 */
export function deltaE2000(lab1: LabColor, lab2: LabColor): number {
  const rad = Math.PI / 180;
  const c1 = Math.hypot(lab1.a, lab1.b);
  const c2 = Math.hypot(lab2.a, lab2.b);
  const cBar = (c1 + c2) / 2;
  const g =
    0.5 *
    (1 - Math.sqrt(Math.pow(cBar, 7) / (Math.pow(cBar, 7) + Math.pow(25, 7))));
  const a1p = lab1.a * (1 + g);
  const a2p = lab2.a * (1 + g);
  const c1p = Math.hypot(a1p, lab1.b);
  const c2p = Math.hypot(a2p, lab2.b);
  const hueAngle = (ap: number, b: number): number => {
    if (ap === 0 && b === 0) return 0;
    const h = Math.atan2(b, ap) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hueAngle(a1p, lab1.b);
  const h2p = hueAngle(a2p, lab2.b);
  const dLp = lab2.l - lab1.l;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * rad) / 2);
  const lBar = (lab1.l + lab2.l) / 2;
  const cBarp = (c1p + c2p) / 2;
  let hBarp: number;
  if (c1p * c2p === 0) {
    hBarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarp = (h1p + h2p) / 2;
  } else {
    hBarp = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBarp - 30) * rad) +
    0.24 * Math.cos(2 * hBarp * rad) +
    0.32 * Math.cos((3 * hBarp + 6) * rad) -
    0.2 * Math.cos((4 * hBarp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hBarp - 275) / 25, 2));
  const rc =
    2 * Math.sqrt(Math.pow(cBarp, 7) / (Math.pow(cBarp, 7) + Math.pow(25, 7)));
  const sl =
    1 + (0.015 * Math.pow(lBar - 50, 2)) / Math.sqrt(20 + Math.pow(lBar - 50, 2));
  const sc = 1 + 0.045 * cBarp;
  const sh = 1 + 0.015 * cBarp * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt(
    Math.pow(dLp / sl, 2) +
      Math.pow(dCp / sc, 2) +
      Math.pow(dHp / sh, 2) +
      rt * (dCp / sc) * (dHp / sh),
  );
}

/** CIEDE2000 difference straight from two hex colours. */
export function deltaE2000Hex(hex1: string, hex2: string): number {
  return deltaE2000(hexToLab(hex1), hexToLab(hex2));
}
