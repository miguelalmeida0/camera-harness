import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
  buildHuggingFaceVlmRequestBody,
  buildMovementRecognitionPrompt,
  classifyProviderFailure,
  describeHuggingFaceVlmRequestBody,
  movementRecognitionResponseForRequest,
  normalizeMovementRecognitionOutput
} from "../server/movement-recognition-provider.mjs";

const ROUTER_URL = "https://router.huggingface.co/v1/chat/completions";
const VLM_CANDIDATES = [
  "google/gemma-4-31B-it:cerebras",
  "meta-llama/Llama-4-Scout-17B-16E-Instruct:groq",
  "CohereLabs/aya-vision-32b:cohere",
  "zai-org/GLM-4.5V:zai-org",
  "MiniMaxAI/MiniMax-M3:together"
];
const CONTROL_MODEL = VLM_CANDIDATES[0];
const FIXTURE_PATH = "packages/perception/browser-local-capture/test/fixtures/vlm-control-image.jpg";

if (!process.env.HF_TOKEN) {
  console.log("SKIP live movement recognition: HF_TOKEN is not set; live provider proof was not run.");
  process.exit(0);
}

const fixture = loadControlFixture();
const bare = await runBareHuggingFaceControlCall(fixture);
if (bare.status === "pass") await runMovementPromptControlCall(fixture, bare.requestedModel);
mkdirSync(resolve(".darkquest"), { recursive: true });
const helperUsageRoot = mkdtempSync(resolve(".darkquest/live-hf-usage-"));
let helper;
try {
  helper = await runProviderHelperEquivalenceCheck(fixture, resolve(helperUsageRoot, "usage.json"));
} finally {
  rmSync(helperUsageRoot, { recursive: true, force: true });
}
if (helper.status === "busy") {
  console.log(`LIVE_REACHABLE_BUT_BUSY candidates=${VLM_CANDIDATES.length}`);
  process.exit(0);
}

console.log(`LIVE_OK provider=huggingface model=${helper.model} control_latency_ms=${bare.latencyMs ?? 0}`);

function loadControlFixture() {
  const path = resolve(FIXTURE_PATH);
  const buffer = readFileSync(path);
  const first8Hex = buffer.subarray(0, 8).toString("hex");
  const jpegMagic = buffer[0] === 0xff && buffer[1] === 0xd8;
  assert.equal(buffer.length > 1000, true, "control fixture must be a real image");
  assert.equal(jpegMagic, true, "control fixture must be JPEG");
  return {
    path,
    byteLength: buffer.length,
    first8Hex,
    jpegMagic,
    dataUri: `data:image/jpeg;base64,${buffer.toString("base64")}`
  };
}

async function runBareHuggingFaceControlCall(fixture) {
  const startedAt = Date.now();
  const payload = barePayload("Describe this image in one short sentence.", fixture.dataUri, CONTROL_MODEL);
  assert.deepEqual(Object.keys(payload).sort(), ["messages", "model", "stream"]);
  try {
    const response = await fetch(ROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    if (!response.ok) {
      const classification = classifyProviderFailure({ httpStatus: response.status, hfResponseBody: text });
      if (classification === "PROVIDER_REACHABLE_BUT_BUSY") {
        printBareFailure("BARE_CONTROL_REACHABLE_BUT_BUSY", response.status, text, fixture);
        return { status: "busy", classification, latencyMs: Date.now() - startedAt };
      }
      if (classification === "PROVIDER_MODEL_UNSUPPORTED") {
        printBareFailure("BARE_CONTROL_PROVIDER_UNAVAILABLE", response.status, text, fixture);
        return { status: "unavailable", classification, latencyMs: Date.now() - startedAt };
      }
      printBareFailure("BARE_CONTROL_FAIL", response.status, text, fixture);
      process.exit(1);
    }
    const json = JSON.parse(text);
    const content = json.choices?.[0]?.message?.content ?? "";
    const latencyMs = Math.round((json.time_info?.total_time ?? ((Date.now() - startedAt) / 1000)) * 1000);
    console.log(`BARE_CONTROL_PASS requested_model=${CONTROL_MODEL} returned_model=${json.model ?? "unknown"} latency_ms=${latencyMs} response=${JSON.stringify(content)}`);
    return { status: "pass", requestedModel: CONTROL_MODEL, returnedModel: json.model ?? "", latencyMs, content };
  } catch (error) {
    printBareFailure("BARE_CONTROL_EXCEPTION", 0, error?.message ?? "unknown error", fixture);
    process.exit(1);
  }
}

async function runMovementPromptControlCall(fixture, requestedModel = CONTROL_MODEL) {
  const prompt = buildMovementRecognitionPrompt(MOVEMENT_RECOGNITION_ALLOWED_ACTIONS, "smoke_test", {});
  const startedAt = Date.now();
  const response = await fetch(ROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(barePayload(prompt, fixture.dataUri, requestedModel))
  });
  const text = await response.text();
  if (!response.ok) {
    const classification = classifyProviderFailure({ httpStatus: response.status, hfResponseBody: text });
    if (classification === "PROVIDER_REACHABLE_BUT_BUSY" || classification === "PROVIDER_MODEL_UNSUPPORTED") {
      printBareFailure(classification === "PROVIDER_REACHABLE_BUT_BUSY" ? "MOVEMENT_PROMPT_REACHABLE_BUT_BUSY" : "MOVEMENT_PROMPT_PROVIDER_UNAVAILABLE", response.status, text, fixture);
      return { status: "busy", classification };
    }
    printBareFailure("MOVEMENT_PROMPT_FAIL", response.status, text, fixture);
    process.exit(1);
  }
  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonFromText(content);
  const latencyMs = Math.round((json.time_info?.total_time ?? ((Date.now() - startedAt) / 1000)) * 1000);
  const normalized = {
    ...normalizeMovementRecognitionOutput(parsed, MOVEMENT_RECOGNITION_ALLOWED_ACTIONS),
    provider: "huggingface",
    model: requestedModel,
    requested_model: requestedModel,
    returned_model: json.model ?? "",
    provider_model: json.model ?? "",
    latency_ms: latencyMs,
    requires_confirmation: true
  };
  console.log(`MOVEMENT_PROMPT_PASS ${JSON.stringify(normalized)}`);
  return normalized;
}

async function runProviderHelperEquivalenceCheck(fixture, usageStatePath) {
  const response = await movementRecognitionResponseForRequest({
    frames: [{ data_uri: fixture.dataUri, captured_at_ms: Date.now() }],
    allowed_actions: MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
    current_step: "smoke_test",
    zone_metadata: {}
  }, {
    ...process.env,
    MOVEMENT_RECOGNITION_MODEL_CANDIDATES: VLM_CANDIDATES.join(","),
    HF_USAGE_STATE_PATH: usageStatePath
  });

  if (response.status === 200 && response.json.movement === "AI provider is busy — try again in a moment.") {
    console.log(`PROVIDER_LADDER_REACHABLE_BUT_BUSY ${JSON.stringify({
      failed_candidates: response.json.failed_candidates?.map((item) => ({
        model: item.model,
        classification: item.classification,
        http_status: item.http_status,
        hf_response_body: item.hf_response_body
      })) ?? []
    })}`);
    return { status: "busy" };
  }

  if (response.status !== 200) {
    const helperBody = buildHuggingFaceVlmRequestBody({
      model: CONTROL_MODEL,
      prompt: buildMovementRecognitionPrompt(MOVEMENT_RECOGNITION_ALLOWED_ACTIONS, "smoke_test", {}),
      frames: [{ data_uri: fixture.dataUri }]
    });
    console.error("PROVIDER_HELPER_CORRUPTS_IMAGE_PAYLOAD");
    console.error(JSON.stringify({
      response: response.json,
      diagnostics: describeHuggingFaceVlmRequestBody(helperBody)
    }, null, 2));
    process.exit(1);
  }

  assert.equal(typeof response.json.movement, "string");
  assert.equal(response.json.movement.length > 0, true);
  assert.equal(response.json.requires_confirmation, true);
  console.log(`PROVIDER_HELPER_PASS provider=${response.json.provider} requested_model=${response.json.requested_model} returned_model=${response.json.returned_model || "unknown"} latency_ms=${response.json.latency_ms} movement=${JSON.stringify(response.json.movement)}`);
  return { status: "pass", model: response.json.requested_model, latencyMs: response.json.latency_ms };
}

function barePayload(prompt, dataUri, model = CONTROL_MODEL) {
  return {
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUri } }
      ]
    }],
    stream: false
  };
}

function parseJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        action_type: "uncertain",
        movement: "Uncertain — try again.",
        short_label: "Uncertain",
        confidence: 0.2,
        reason: "The image does not clearly show a movement.",
        evidence: ["static image", "no clear movement visible"],
        requires_confirmation: true
      };
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return {
        action_type: "uncertain",
        movement: "Uncertain — try again.",
        short_label: "Uncertain",
        confidence: 0.2,
        reason: "The provider returned text that was not safely parseable as movement JSON.",
        evidence: ["invalid movement JSON"],
        requires_confirmation: true
      };
    }
  }
}

function printBareFailure(label, status, body, fixture) {
  console.error(label);
  console.error(JSON.stringify({
    http_status: status,
    hf_response_body: body,
    fixture_path: fixture.path,
    byte_length: fixture.byteLength,
    first8Hex: fixture.first8Hex,
    data_uri_prefix: fixture.dataUri.startsWith("data:image/jpeg;base64,"),
    token_loaded: Boolean(process.env.HF_TOKEN)
  }, null, 2));
}
