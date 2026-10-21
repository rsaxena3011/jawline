import {
  createTask,
  createYouCamClient,
  pollTask,
  runSkinTone,
  uploadFile,
  YouCamTaskError,
} from "../client.ts";
import {
  parseMakeupVtoResult,
  parseSkinAnalysisResult,
} from "../client.ts";
import { foundationVtoParams } from "../types.ts";

/**
 * YouCam client behaviour against a scripted fake fetch. The load
 * bearing assertions: upload is two-step (POST ticket, then PUT
 * binary), a failed task creation is attempted EXACTLY ONCE (a retry
 * could double-charge units), polling waits through "running" and
 * surfaces task failures, and result parsers produce the typed shapes.
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

interface Call {
  url: string;
  method: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function scriptedFetch(
  handler: (call: Call, index: number) => Response,
): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: unknown, init?: { method?: string }) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

async function main() {
  // 1. Two-step upload: POST ticket, then PUT binary, file id returned.
  {
    const { fetchFn, calls } = scriptedFetch((call) => {
      if (call.method === "POST") {
        return jsonResponse({
          data: { file_id: "file-123", upload_url: "https://up.example/put" },
        });
      }
      return new Response(null, { status: 200 });
    });
    const client = createYouCamClient({
      apiKey: "test-key",
      baseUrl: "https://api.example",
      fetchFn,
      pollIntervalMs: 1,
    });
    const fileId = await uploadFile(
      client,
      new Uint8Array([1, 2, 3]),
      "image/jpeg",
    );
    check(fileId === "file-123", "upload returns the file id");
    check(
      calls.length === 2 && calls[0].method === "POST" && calls[1].method === "PUT",
      "upload is two-step: POST ticket then PUT binary",
    );
    check(
      calls[1].url === "https://up.example/put",
      "binary goes to the presigned URL from the ticket",
    );
  }

  // 2. Failed task creation: exactly one attempt, error surfaces.
  {
    const { fetchFn, calls } = scriptedFetch(() =>
      jsonResponse({ error: "boom" }, 500),
    );
    const client = createYouCamClient({
      apiKey: "test-key",
      baseUrl: "https://api.example",
      fetchFn,
      pollIntervalMs: 1,
    });
    let threw = false;
    try {
      await createTask(client, "skin-tone", { file_id: "f" });
    } catch {
      threw = true;
    }
    check(threw, "failed task creation throws");
    check(
      calls.length === 1,
      "task creation is attempted exactly once (never auto-retried)",
    );
  }

  // 3. End to end skin tone: create, poll running, poll success, parse.
  {
    let polls = 0;
    const { fetchFn } = scriptedFetch((call) => {
      if (call.method === "POST") return jsonResponse({ task_id: "t-1" });
      polls += 1;
      if (polls === 1) return jsonResponse({ status: "running" });
      return jsonResponse({
        status: "success",
        result: {
          skin_color: "#C68863",
          facial_colors: { eye_color: "#3B2F2F", lip_color: "#B4656F" },
        },
      });
    });
    const client = createYouCamClient({
      apiKey: "test-key",
      baseUrl: "https://api.example",
      fetchFn,
      pollIntervalMs: 1,
    });
    const result = await runSkinTone(client, "file-123");
    check(result.skinColorHex === "#C68863", "skin tone parses skin_color hex");
    check(
      result.facialColors.eye === "#3B2F2F" &&
        result.facialColors.lip === "#B4656F",
      "skin tone parses facial colours",
    );
    check(polls === 2, "polling waits through a running state");
  }

  // 4. Task-level failure surfaces as YouCamTaskError.
  {
    const { fetchFn } = scriptedFetch((call) => {
      if (call.method === "POST") return jsonResponse({ task_id: "t-2" });
      return jsonResponse({ status: "error", message: "no face found" });
    });
    const client = createYouCamClient({
      apiKey: "test-key",
      baseUrl: "https://api.example",
      fetchFn,
      pollIntervalMs: 1,
    });
    let caught: unknown = null;
    try {
      await pollTask(client, "skin-tone", "t-2");
    } catch (err) {
      caught = err;
    }
    check(
      caught instanceof YouCamTaskError &&
        caught.message.includes("no face found"),
      "task failure surfaces with the API message",
    );
  }

  // 5. Parsers for skin analysis and makeup VTO.
  {
    const analysis = parseSkinAnalysisResult({
      actions: [
        { action: "oiliness", raw_score: 41, ui_score: 55 },
        { action: "redness", raw_score: 63 },
      ],
      masks: { oiliness: "https://cdn.example/mask.png" },
    });
    check(
      analysis.scores.length === 2 &&
        analysis.scores[0].rawScore === 41 &&
        analysis.scores[1].uiScore === null,
      "skin analysis parses concern raw scores",
    );
    check(
      analysis.maskUrls.oiliness === "https://cdn.example/mask.png",
      "skin analysis parses mask URLs",
    );
    const vto = parseMakeupVtoResult({ image_url: "https://cdn.example/r.png" });
    check(vto.imageUrl.endsWith("r.png"), "makeup VTO parses the render URL");
  }

  // 6. Foundation VTO params pin smoothing off.
  {
    const params = foundationVtoParams("#C68863");
    check(params.smoothing === 0, "foundation VTO params set smoothing to 0");
    check(params.colorHex === "#C68863", "foundation VTO params carry the colour");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
