import { NextResponse } from "next/server";

// Liveness probe. Reports configuration as booleans only; secret
// values are never returned.
export function GET() {
  return NextResponse.json({
    ok: true,
    service: "jawline",
    phase: "scaffold",
    youcamKeyConfigured: Boolean(process.env.YOUCAM_API_KEY),
    judgePasscodeConfigured: Boolean(process.env.JUDGE_PASSCODE),
    time: new Date().toISOString(),
  });
}
