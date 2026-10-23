import { NextResponse } from "next/server";

// Liveness probe. Reports configuration as booleans only; secret
// values are never returned. Live mode's API credential comes from
// the connected YouCam connector at request time, so there is no
// key env var to report; what gates live mode here is the judge
// passcode.
export function GET() {
  return NextResponse.json({
    ok: true,
    service: "jawline",
    phase: "live-mode",
    judgePasscodeConfigured: Boolean(process.env.JUDGE_PASSCODE),
    time: new Date().toISOString(),
  });
}
