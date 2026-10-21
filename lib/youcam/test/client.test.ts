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
        // Real V2 shape, verified by live probe 2026-10-22.
        return jsonResponse({
          data: {
            files: [
              {
                file_id: "file-123",
                requests: [
                  { method: "PUT", url: "https://up.example/put", headers: {} },
                ],
              },
            ],
          },
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
      "skin-tone",
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
      await createTask(client, "skin-tone", { src_file_id: "f" });
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
      if (call.method === "POST")
        return jsonResponse({ data: { task_id: "t-1" } });
      polls += 1;
      if (polls === 1)
        return jsonResponse({ data: { task_status: "running" } });
      // Real V2 shape, verified against the docs 2026-10-22.
      return jsonResponse({
        data: {
          task_status: "success",
          results: {
            color: {
              skin_color: "#C68863",
              eye_color: "#3B2F2F",
              lip_color: "#B4656F",
            },
          },
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
      if (call.method === "POST")
        return jsonResponse({ data: { task_id: "t-2" } });
      return jsonResponse({
        data: { task_status: "error", error_message: "no face found" },
      });
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
    // Real score_info.json shape, captured from a live run 2026-10-22.
    const analysis = parseSkinAnalysisResult({
      texture: {
        raw_score: 75.09869933128357,
        ui_score: 78,
        output_mask_name: "texture_output.png",
      },
      wrinkle: {
        raw_score: 92.88226366043091,
        ui_score: 85,
        output_mask_name: "wrinkle_output.png",
      },
      all: { score: 78.5 },
      skin_age: 36,
      resize_image: { image_name: "resize_image.jpg" },
    });
    check(
      analysis.scores.length === 2 &&
        analysis.scores[1].action === "wrinkle" &&
        analysis.scores[1].rawScore > 92.88 &&
        analysis.scores[0].uiScore === 78,
      "skin analysis parses the keyed score_info shape",
    );
    check(
      analysis.maskNames.wrinkle === "wrinkle_output.png" &&
        analysis.overallScore === 78.5 &&
        analysis.skinAge === 36,
      "skin analysis parses mask names, overall score and skin age",
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
