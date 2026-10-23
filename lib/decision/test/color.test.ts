import { deltaE2000, deltaE2000Hex, hexToLab } from "../color.ts";
import { STUDY_TONES } from "../fixtures.ts";

/**
 * Colour math. The load-bearing assertion: CIEDE2000 reproduces
 * the published Sharma, Wu and Dalal (2005) test pairs, because
 * every threshold in the decision engine is stated in delta E 2000
 * units and a wrong metric would quietly corrupt all of them.
 * The study checks then pin the numbers the thresholds came from.
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
const near = (x: number, y: number, tol: number) => Math.abs(x - y) <= tol;

function main() {
  // Published CIEDE2000 test pairs (Sharma et al. 2005), tolerance
  // covers the paper's 4-decimal rounding.
  // Published CIEDE2000 test pairs (Sharma et al. 2005), tolerance
  // covers the paper's 4-decimal rounding.
  const pairs: Array<[number[], number[], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  ];
  pairs.forEach(([p1, p2, want], i) => {
    const got = deltaE2000(
      { l: p1[0], a: p1[1], b: p1[2] },
      { l: p2[0], a: p2[1], b: p2[2] },
    );
    check(near(got, want, 0.001), `Sharma pair ${i + 1}: got ${got.toFixed(4)}, want ${want}`);
  });

  // Regression pairs: expected values cross-checked against an
  // independent second implementation on 2026-10-23 (both agreed to
  // 4 decimals, and both reproduce the three paper pairs above).
  const regression: Array<[number[], number[], number]> = [
    [[50, 1.8634, -81.0466], [50, 0, -82.7485], 1.3305],
    [[60.2574, 34.0099, 3.2679], [60.4626, 34.1751, 39.4387], 21.1723],
  ];
  regression.forEach(([p1, p2, want], i) => {
    const got = deltaE2000(
      { l: p1[0], a: p1[1], b: p1[2] },
      { l: p2[0], a: p2[1], b: p2[2] },
    );
    check(near(got, want, 0.001), `regression pair ${i + 1}: got ${got.toFixed(4)}, want ${want}`);
  });

  // Hex conversion sanity.
  const white = hexToLab("#FFFFFF");
  check(
    near(white.l, 100, 0.1) && near(white.a, 0, 0.1) && near(white.b, 0, 0.1),
    "white hex converts to Lab 100, 0, 0",
  );
  const black = hexToLab("#000000");
  check(near(black.l, 0, 0.1), "black hex converts to Lab lightness 0");
  const red = hexToLab("#FF0000");
  check(
    near(red.l, 53.24, 0.5) && near(red.a, 80.09, 0.5) && near(red.b, 67.2, 0.5),
    "pure red converts to its known Lab value",
  );

  // Metric behaviour.
  check(deltaE2000Hex("#a77d60", "#a77d60") === 0, "identical colours differ by 0");
  check(
    near(
      deltaE2000Hex("#a77d60", "#6e4c37"),
      deltaE2000Hex("#6e4c37", "#a77d60"),
      1e-9,
    ),
    "delta E 2000 is symmetric",
  );

  // Study numbers the decision thresholds are derived from.
  const byId = new Map(STUDY_TONES.map((t) => [t.id, t]));
  const disagreement = (id: string) =>
    deltaE2000Hex(byId.get(id)!.result.skinColorHex, byId.get(id)!.pixelHex);
  check(
    disagreement("tone6") > disagreement("tone4"),
    "study pattern holds: pale-end reading disagrees with its face most",
  );
  check(
    disagreement("tone2") > 4 && disagreement("tone2") < 7,
    "mid-cluster method disagreement sits in the 4 to 7 band the match threshold respects",
  );
  check(
    deltaE2000Hex(
      byId.get("tone5")!.result.skinColorHex,
      byId.get("tone6")!.result.skinColorHex,
    ) < 2,
    "tone5 and tone6 readings sit under 2 apart (the pale compression)",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
