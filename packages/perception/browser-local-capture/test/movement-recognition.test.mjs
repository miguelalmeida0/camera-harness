import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_MOVEMENT_RECOGNITION_CONFIG,
  MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES,
  MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
  buildHuggingFaceVlmRequestBody,
  buildMovementRecognitionPrompt,
  classifyProviderFailure,
  describeHuggingFaceVlmRequestBody,
  isRetryableProviderFailure,
  isProviderCapacityError,
  loadMovementRecognitionConfig,
  movementRecognitionHealth,
  movementRecognitionResponseForRequest,
  normalizeMovementRecognitionOutput
} from "../server/movement-recognition-provider.mjs";

const source = readFileSync(resolve("packages/perception/browser-local-capture/prototype/local-capture.js"), "utf8");
const html = readFileSync(resolve("packages/perception/browser-local-capture/prototype/index.html"), "utf8");
const providerSource = readFileSync(resolve("packages/perception/browser-local-capture/server/movement-recognition-provider.mjs"), "utf8");
const serverSource = readFileSync(resolve("packages/perception/browser-local-capture/server/movement-recognition-server.mjs"), "utf8");
const launcherSource = readFileSync(resolve("packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs"), "utf8");
const liveSource = readFileSync(resolve("packages/perception/browser-local-capture/test/movement-recognition-live.test.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const correctionMemoryContract = readFileSync(resolve("docs/contracts/movement-correction-memory.v0.md"), "utf8");
const promptV2Contract = readFileSync(resolve("docs/contracts/movement-narration-prompt.v2.md"), "utf8");
const fixtureBuffer = readFileSync(resolve("packages/perception/browser-local-capture/test/fixtures/vlm-control-image.jpg"));
const fixtureBase64 = fixtureBuffer.toString("base64");
const fixtureDataUri = `data:image/jpeg;base64,${fixtureBase64}`;
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const defaultMainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;

assert.equal(html.includes("AI Movement Narrator"), true, "main UI names the Movement Narrator product");
assert.equal(html.includes("Show a movement. Let AI describe what happened."), true, "main UI has narrator subtitle");
assert.equal(html.includes('id="analyzeMovement"'), true, "movement capture action is wired");
assert.equal(html.includes("Describe my next movement"), true, "primary movement button uses one-shot copy");
assert.equal(defaultMainUi.includes("Analyze Movement"), false, "primary UI does not use Analyze Movement copy");
assert.equal(source.includes("Get ready..."), true, "get-ready state exists");
assert.equal(source.includes("Move now."), true, "capture state instructs user when to move");
assert.equal(source.includes("Understanding movement..."), true, "analyzing state is explicit");
assert.equal(html.includes("Try another movement"), true, "result-ready retry action is clear");
assert.equal(html.includes("Movement Result"), true, "main UI has Movement Result card");
assert.equal(html.includes("Speak result"), true, "main UI has speech button");
assert.equal(html.includes("Auto-speak off"), true, "auto-speak is off by default");
assert.equal(defaultMainUi.indexOf('id="cameraTitle"') < defaultMainUi.indexOf('id="analyzeMovement"'), true, "camera appears before movement control");
assert.equal(defaultMainUi.indexOf('id="analyzeMovement"') < defaultMainUi.indexOf('id="movementResultTitle"'), true, "movement control appears before result");
assert.equal(source.includes("MOVEMENT_RECOGNITION_CLIENT_CONFIG"), true, "movement recognition client config exists");
assert.equal(providerSource.includes("HF_TOKEN"), true, "HF_TOKEN is server-side provider config");
assert.equal(/process\.env\.HF_TOKEN|Authorization:\s*`Bearer|hf_secret|hf_test|hf_[A-Za-z0-9]{12,}/.test(source), false, "frontend does not read or expose HF_TOKEN value");
assert.equal(DEFAULT_MOVEMENT_RECOGNITION_CONFIG.provider, "huggingface");
assert.equal(DEFAULT_MOVEMENT_RECOGNITION_CONFIG.model, "google/gemma-4-31B-it:cerebras");
assert.equal(DEFAULT_MOVEMENT_RECOGNITION_CONFIG.mode, "vlm_frames");
assert.equal(DEFAULT_MOVEMENT_RECOGNITION_CONFIG.maxFrames, 4);
assert.equal(MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES, 5, "provider candidate count is capped");
assert.equal(DEFAULT_MOVEMENT_RECOGNITION_CONFIG.windowMs, 1500);
assert.deepEqual(MOVEMENT_RECOGNITION_ALLOWED_ACTIONS, ["uncertain"], "provider exposes only the uncertain fallback label");
const health = movementRecognitionHealth({ HF_TOKEN: "hf_secret", MOVEMENT_RECOGNITION_MODEL: "model:test" });
assert.equal(health.ok, true);
assert.equal(health.has_token, true);
assert.equal(health.token_exposed_to_frontend, false);
assert.equal(health.analyze_endpoint_ready, true);
assert.equal(JSON.stringify(health).includes("hf_secret"), false, "health endpoint does not expose token");
assert.equal(serverSource.includes('/api/movement-recognition/health'), true, "health endpoint route exists");
assert.equal(launcherSource.includes('const movementHealthRoute = "/api/movement-recognition/health"'), true, "physical:capture exposes movement health route");
assert.equal(launcherSource.includes('const movementAnalyzeRoute = "/api/movement-recognition/analyze"'), true, "physical:capture exposes movement analyze route");
assert.equal(launcherSource.includes("maybeHandleMovementRecognitionApi(request, response, url)"), true, "physical:capture mounts movement API before static files");
assert.equal(launcherSource.includes("movementRecognitionResponseForRequest(body, process.env)"), true, "physical:capture analyze route uses provider helper");

const config = loadMovementRecognitionConfig({
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_PROVIDER: "huggingface",
  MOVEMENT_RECOGNITION_MODEL: "Qwen/Qwen2.5-VL-7B-Instruct:cerebras",
  MOVEMENT_RECOGNITION_MODE: "vlm_frames",
  MOVEMENT_RECOGNITION_MAX_FRAMES: "4",
  MOVEMENT_RECOGNITION_WINDOW_MS: "1500"
});
assert.equal(config.token, "hf_test");
assert.equal(config.model.endsWith(":cerebras"), true, "provider suffix pinning is configurable");
assert.deepEqual(loadMovementRecognitionConfig({
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "m1:fastest,m1:together,m1:cerebras"
}).modelCandidates, ["m1:fastest", "m1:together", "m1:cerebras"]);
assert.deepEqual(loadMovementRecognitionConfig({}).modelCandidates, [
  "google/gemma-4-31B-it:cerebras",
  "meta-llama/Llama-4-Scout-17B-16E-Instruct:groq",
  "CohereLabs/aya-vision-32b:cohere",
  "zai-org/GLM-4.5V:zai-org",
  "MiniMaxAI/MiniMax-M3:together"
]);
assert.equal(packageJson.movementRecognitionRecommendedEnv.MOVEMENT_RECOGNITION_MODEL, "google/gemma-4-31B-it:cerebras");
assert.equal(packageJson.movementRecognitionRecommendedEnv.MOVEMENT_RECOGNITION_MODEL_CANDIDATES.includes("meta-llama/Llama-4-Scout-17B-16E-Instruct:groq"), true);

const prompt = buildMovementRecognitionPrompt(MOVEMENT_RECOGNITION_ALLOWED_ACTIONS, "movement_narration", { neutral_zone: {} }, [{
  original_movement: "You moved your hand closer to your face.",
  corrected_movement: "I made a shaka sign."
}]);
for (const required of [
  "Return only JSON",
  "short sequence of webcam frames in order",
  "Compare Frame 1, Frame 2, Frame 3, and Frame 4",
  "Describe what changed over time",
  "compare frames over time",
  "Allowed fallback type: uncertain",
  "Recent user corrections, text only",
  "I made a shaka sign.",
  "movement",
  "short_label",
  "uncertainty",
  "You raised your hand.",
  "You opened your mouth.",
  "describe the movement, not the person",
  "do not identify the person",
  "do not describe sensitive attributes",
  "do not judge appearance",
  "avoid clothing/body judgments",
  "frames look static"
]) {
  assert.equal(prompt.includes(required), true, `prompt contains ${required}`);
}
for (const removedFixedLabel of ["phone_moved", "notebook_opened", "pen_picked_up", "writing_motion", "typing_motion"]) {
  assert.equal(prompt.includes(removedFixedLabel), false, `prompt should not require fixed action label: ${removedFixedLabel}`);
}

const routerBody = buildHuggingFaceVlmRequestBody({
  model: "google/gemma-4-31B-it:cerebras",
  prompt,
  frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }]
});
assert.equal(Array.isArray(routerBody.messages), true, "provider request body has messages array");
assert.equal(routerBody.messages[0].content.some((item) => item.type === "text"), true, "provider content includes text");
assert.equal(routerBody.messages[0].content.some((item) => item.type === "image_url"), true, "provider content includes image_url");
assert.equal(routerBody.messages[0].content.find((item) => item.type === "image_url").image_url.url.startsWith("data:image/"), true, "image_url is a data image URI");
assert.equal(routerBody.messages[0].content.find((item) => item.type === "image_url").image_url.url.startsWith("data:image/jpeg;base64,"), true, "live app frames use jpeg data URIs");
assert.equal(Object.prototype.hasOwnProperty.call(routerBody, "frames"), false, "no custom top-level frames field is sent to router");
assert.equal(Object.prototype.hasOwnProperty.call(routerBody, "allowed_labels"), false, "no custom top-level allowed labels field is sent to router");
assert.equal(Object.prototype.hasOwnProperty.call(routerBody, "current_step"), false, "no custom top-level current_step field is sent to router");
assert.equal(Object.prototype.hasOwnProperty.call(routerBody, "response_format"), false, "no response_format in live VLM first pass");
assert.equal(Object.prototype.hasOwnProperty.call(routerBody, "tools"), false, "no tools in live VLM first pass");
const preservedDataUriBody = buildHuggingFaceVlmRequestBody({
  model: "google/gemma-4-31B-it:cerebras",
  prompt,
  frames: [{ data_uri: fixtureDataUri }]
});
const preservedUrl = preservedDataUriBody.messages[0].content.find((item) => item.type === "image_url").image_url.url;
assert.equal(preservedUrl, fixtureDataUri, "helper does not strip data URI prefix");
assert.equal(preservedUrl.split(",")[1], fixtureBase64, "helper does not mutate base64");
const preservedDiagnostics = describeHuggingFaceVlmRequestBody(preservedDataUriBody);
assert.equal(preservedDiagnostics.image_url_is_string, true);
assert.equal(preservedDiagnostics.first_image_mime, "image/jpeg");
assert.equal(preservedDiagnostics.first_image_decoded_byte_length, fixtureBuffer.length);
assert.equal(preservedDiagnostics.first_8_bytes_hex, "ffd8ffdb00430006");

let called = false;
const response = await movementRecognitionResponseForRequest({
  frames: [{ mime_type: "image/jpeg", encoded_frame: "abc", captured_at_ms: 1 }],
  allowed_actions: MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
  current_step: "movement_narration",
  zone_metadata: { neutral_zone: { x: 0, y: 0, w: 1, h: 1 } },
  recent_corrections: [{
    original_movement: "You moved your hand closer to your face.",
    corrected_movement: "I made a shaka sign."
  }]
}, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL: "Qwen/Qwen2.5-VL-7B-Instruct:together",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "Qwen/Qwen2.5-VL-7B-Instruct:together"
}, {
  fetch: async (url, init) => {
    called = true;
    assert.equal(String(url).startsWith("https://router.huggingface.co/"), true);
    assert.equal(init.headers.Authorization, "Bearer hf_test");
    const request = JSON.parse(init.body);
    assert.equal(request.model.endsWith(":together"), true, "Together suffix is passed to HF router");
    assert.deepEqual(Object.keys(request).sort(), ["messages", "model", "stream"], "router request has only OpenAI-compatible top-level fields");
    assert.equal(request.messages[0].content.some((item) => item.type === "image_url"), true, "sampled frame is forwarded transiently");
    assert.equal(request.messages[0].content[0].text.includes("I made a shaka sign."), true, "recent correction context is included as text only");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          model: "gemma-4-31b",
          choices: [{
            message: {
              content: JSON.stringify({
                movement: "You waved your right hand.",
                short_label: "Hand wave",
                confidence: 0.82,
                reason: "The hand moved side to side across sampled frames.",
                evidence: ["hand visible in multiple sampled frames", "side-to-side motion pattern"],
                requires_confirmation: true
              })
            }
          }]
        };
      }
    };
  }
});
assert.equal(called, true, "mock provider was called");
assert.equal(response.status, 200);
assert.equal(response.json.movement, "You waved your right hand.");
assert.equal(response.json.short_label, "Hand wave");
assert.equal(response.json.confidence, 0.82);
assert.equal(response.json.provider, "huggingface");
assert.equal(response.json.model, "Qwen/Qwen2.5-VL-7B-Instruct:together");
assert.equal(response.json.requested_model, "Qwen/Qwen2.5-VL-7B-Instruct:together");
assert.equal(response.json.returned_model, "gemma-4-31b");
assert.equal(response.json.provider_model, "gemma-4-31b");
assert.equal(response.json.prompt_version, "movement-narration-prompt.v2");
assert.equal(response.json.image_tokens, 0);
assert.equal(response.json.requires_confirmation, true);
assert.equal(/\b(named|identity|identified as)\b/i.test(response.json.movement), false, "movement result does not identify a person");

const returnedModelReuseCalls = [];
const returnedModelReuse = await movementRecognitionResponseForRequest({
  frames: [{ mime_type: "image/jpeg", encoded_frame: "abc", captured_at_ms: 1 }],
  allowed_actions: MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
  current_step: "movement_narration"
}, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "google/gemma-4-31B-it:cerebras,next-model:groq"
}, {
  fetch: async (_url, init) => {
    const request = JSON.parse(init.body);
    returnedModelReuseCalls.push(request.model);
    assert.notEqual(request.model, "gemma-4-31b", "provider-internal returned model must not be reused as request model");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          model: "gemma-4-31b",
          choices: [{ message: { content: JSON.stringify({ movement: "You moved your hand.", short_label: "Hand movement", confidence: 0.71, reason: "synthetic visual response", evidence: ["mock"], requires_confirmation: true }) } }]
        };
      }
    };
  }
});
assert.deepEqual(returnedModelReuseCalls, ["google/gemma-4-31B-it:cerebras"], "candidate ladder is not mutated by response.model");
assert.equal(returnedModelReuse.json.model, "google/gemma-4-31B-it:cerebras");
assert.equal(returnedModelReuse.json.requested_model, "google/gemma-4-31B-it:cerebras");
assert.equal(returnedModelReuse.json.returned_model, "gemma-4-31b");

const ladderCalls = [];
const ladder = await movementRecognitionResponseForRequest({
  frames: [{ mime_type: "image/jpeg", encoded_frame: "abc", captured_at_ms: 1 }],
  allowed_actions: MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
  current_step: "movement_narration"
}, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL: "unused",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "bad-model:fastest,good-model:together"
}, {
  fetch: async (_url, init) => {
    const request = JSON.parse(init.body);
    ladderCalls.push(request.model);
    if (request.model.startsWith("bad-model")) {
      return { ok: false, status: 404, async text() { return "{\"error\":\"model unavailable\"}"; } };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: JSON.stringify({ movement: "You typed on a keyboard.", short_label: "Typing", confidence: 0.7, reason: "synthetic visual response", evidence: ["mock"], requires_confirmation: true }) } }] };
      }
    };
  }
});
assert.deepEqual(ladderCalls, ["bad-model:fastest", "good-model:together"], "candidate ladder tries the next model");
assert.equal(ladder.status, 200);
assert.equal(ladder.json.model, "good-model:together");
assert.equal(ladder.json.movement, "You typed on a keyboard.");
assert.equal(ladder.json.action_type, "typing_motion", "legacy action type is hidden compatibility metadata");
assert.equal(ladder.json.failed_candidates[0].model, "bad-model:fastest");
assert.equal(ladder.json.failed_candidates[0].hf_response_body, "{\"error\":\"model unavailable\"}", "exact HF error body is surfaced");
assert.equal(ladder.json.failed_candidates[0].image_input_count, 1);
assert.equal(ladder.json.failed_candidates[0].any_image_input_starts_with_data_image, true);
assert.equal(ladder.json.failed_candidates[0].response_format_sent, false);
assert.deepEqual(ladder.json.failed_candidates[0].custom_top_level_fields_sent, []);

const unsupported = await movementRecognitionResponseForRequest({ frames: [] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "bad-model:fastest"
}, {
  fetch: async () => ({ ok: false, status: 422, async text() { return "{\"error\":\"unsupported image input\"}"; } })
});
assert.equal(unsupported.status, 200, "unsupported model/provider becomes a user-visible unavailable result");
assert.equal(unsupported.json.action_type, "uncertain");
assert.equal(unsupported.json.movement, "AI provider is busy — try again in a moment.");
assert.equal(unsupported.json.failed_candidates[0].classification, "PROVIDER_MODEL_UNSUPPORTED");
assert.equal(unsupported.json.failed_candidates[0].hf_response_body, "{\"error\":\"unsupported image input\"}");

const queueExceeded = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "queued-model:cerebras,queue-fallback:together"
}, {
  fetch: async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.model.startsWith("queued-model")) {
      return { ok: false, status: 400, async text() { return "{\"code\":\"queue_exceeded\",\"message\":\"queue full\"}"; } };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: JSON.stringify({ movement: "Uncertain — try again.", short_label: "Uncertain", confidence: 0.4, reason: "fallback candidate reached", evidence: ["mock"], requires_confirmation: true }) } }] };
      }
    };
  }
});
assert.equal(queueExceeded.status, 200, "queue_exceeded is retryable");
assert.deepEqual(queueExceeded.json.failed_candidates.map((item) => item.model), ["queued-model:cerebras"], "busy candidate does not stop ladder");
assert.equal(queueExceeded.json.failed_candidates[0].classification, "PROVIDER_REACHABLE_BUT_BUSY");
assert.equal(queueExceeded.json.failed_candidates[0].hf_response_body.includes("queue_exceeded"), true);
assert.equal(isProviderCapacityError({ hfResponseBody: "{\"code\":\"queue_exceeded\"}" }), true, "queue_exceeded is provider capacity");
assert.equal(classifyProviderFailure({ httpStatus: 429, hfResponseBody: "{\"type\":\"too_many_requests_error\",\"param\":\"queue\",\"code\":\"queue_exceeded\"}" }), "PROVIDER_REACHABLE_BUT_BUSY");
assert.equal(isRetryableProviderFailure({ httpStatus: 429, hfResponseBody: "{\"code\":\"queue_exceeded\"}" }), true, "HTTP 429 is retryable");
assert.equal(classifyProviderFailure({ httpStatus: 404, hfResponseBody: "{\"error\":{\"code\":\"model_not_found\",\"message\":\"The requested model does not exist\"}}" }), "PROVIDER_MODEL_UNSUPPORTED", "model_not_found is model config error");
assert.equal(classifyProviderFailure({ httpStatus: 401, hfResponseBody: "{\"error\":\"invalid token\"}" }), "AUTH_FAILURE", "missing token / invalid token is config error");
assert.equal(classifyProviderFailure({ httpStatus: 400, hfResponseBody: "{\"error\":\"invalid_image\"}" }), "PAYLOAD_OR_IMAGE_FAILURE", "invalid_image is payload error");

const allBusy = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "busy-a:cerebras,busy-b:groq"
}, {
  fetch: async () => ({ ok: false, status: 429, async text() { return "{\"message\":\"We're experiencing high traffic right now! Please try again soon.\",\"type\":\"too_many_requests_error\",\"param\":\"queue\",\"code\":\"queue_exceeded\"}"; } })
});
assert.equal(allBusy.status, 200, "all busy providers return a user-visible busy result");
assert.equal(allBusy.json.movement, "AI provider is busy — try again in a moment.");
assert.equal(allBusy.json.failed_candidates.length, 2);
assert.equal(JSON.stringify(allBusy.json).includes("hf_test"), false, "failed candidate diagnostics do not print token");

const invalidImageCalls = [];
const invalidImage = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "invalid-image:cerebras,next-model:groq"
}, {
  fetch: async (_url, init) => {
    invalidImageCalls.push(JSON.parse(init.body).model);
    return { ok: false, status: 400, async text() { return "{\"error\":\"invalid_image\",\"message\":\"invalid image\"}"; } };
  }
});
assert.equal(invalidImage.status, 502, "invalid_image remains a hard payload failure");
assert.deepEqual(invalidImageCalls, ["invalid-image:cerebras"], "payload/image failure does not continue ladder");
assert.equal(invalidImage.json.failed_candidates[0].classification, "PAYLOAD_OR_IMAGE_FAILURE");
assert.equal(invalidImage.json.failed_candidates[0].hf_response_body, "{\"error\":\"invalid_image\",\"message\":\"invalid image\"}", "exact invalid image body is logged");

const invalidTokenCalls = [];
const invalidToken = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "auth-model:cerebras,next-model:groq"
}, {
  fetch: async (_url, init) => {
    invalidTokenCalls.push(JSON.parse(init.body).model);
    return { ok: false, status: 401, async text() { return "{\"error\":\"Invalid token\"}"; } };
  }
});
assert.equal(invalidToken.status, 502, "invalid token remains auth failure");
assert.deepEqual(invalidTokenCalls, ["auth-model:cerebras"], "auth failure does not continue ladder");
assert.equal(invalidToken.json.failed_candidates[0].classification, "AUTH_FAILURE");
assert.equal(JSON.stringify(invalidToken.json).includes("hf_test"), false, "auth diagnostics do not print token");

const invalidJson = await movementRecognitionResponseForRequest({ frames: [] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL: "json-test:fastest"
}, {
  fetch: async () => ({
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { content: "not structured json" } }] };
    }
  })
});
assert.equal(invalidJson.status, 200);
assert.equal(invalidJson.json.action_type, "uncertain", "invalid model JSON becomes uncertain");
assert.equal(invalidJson.json.movement, "Uncertain — try again.", "invalid model JSON becomes uncertain movement");

const missingToken = await movementRecognitionResponseForRequest({ frames: [] }, {}, {});
assert.equal(missingToken.status, 503, "missing HF_TOKEN returns unavailable");
assert.equal(missingToken.json.action_type, "uncertain");
assert.equal(missingToken.json.movement, "HF_TOKEN is not loaded. Restart the app after sourcing .env.");

const normalized = normalizeMovementRecognitionOutput({ movement: "This is a person named Sam.", confidence: 4 }, MOVEMENT_RECOGNITION_ALLOWED_ACTIONS);
assert.equal(normalized.action_type, "uncertain", "unsafe identity output becomes uncertain");
assert.equal(normalized.movement, "Uncertain — try again.");
assert.equal(normalized.confidence, 1);

for (const marker of [
  "/api/movement-recognition/analyze",
  "/api/movement-recognition/health",
  "captureMovementFrameWindow",
  "clearMovementFrameBuffer",
  "requestMovementRecognitionHealth",
  "runLiveAiSmokeTestInState",
  "queueMovementRecognitionFallback",
  "safeMovementRecognitionErrorMessage",
  "ai_movement_recognition",
  "local_motion_proxy"
]) {
  assert.equal(source.includes(marker) || serverSource.includes(marker) || providerSource.includes(marker), true, `missing movement recognition marker: ${marker}`);
}
assert.equal(source.includes('endpoint: "/api/movement-recognition/analyze"'), true, "frontend calls the mounted analyze endpoint");
assert.equal(source.includes("requestMovementRecognitionHealth"), true, "frontend has in-app health check");
assert.equal(source.includes('["HF", "TOKEN"].join("_")'), true, "frontend constructs token label without exposing token value");
assert.equal(source.includes("HF_TOKEN is not loaded. Restart the app after sourcing .env."), true, "UI distinguishes missing token");
assert.equal(source.includes("Movement recognition endpoint unavailable."), true, "UI distinguishes missing endpoint");
assert.equal(source.includes("AI provider is busy — try again in a moment."), true, "UI distinguishes provider busy");
assert.equal(source.includes("Camera frame could not be read. Try again."), true, "UI distinguishes invalid image payload");
assert.equal(source.includes("Network error while contacting movement recognition."), true, "UI distinguishes network errors");
assert.equal(source.includes("AI response was unclear — try again."), true, "UI distinguishes malformed provider responses");
assert.equal(source.includes("target.movementRecognition.requestInFlight ||"), true, "double-click one-shot cost guard exists");
assert.equal(source.includes("document.hidden"), true, "hidden tabs cannot start a new movement call");
assert.equal(source.includes("dom.analyzeMovement.disabled = !state.cameraReady || analyzing"), true, "button is disabled while capturing/analyzing");
assert.equal(source.includes('boundDom.analyzeMovement?.addEventListener("click", () => analyzeMovementInState(state))'), true, "AI call starts from explicit button click");
assert.equal(source.includes("if (state.cameraReady) await analyzeMovementInState(state)"), false, "Try another movement does not auto-repeat the AI call");
assert.equal(/setInterval\([^)]*analyzeMovementInState|requestAnimationFrame\([^)]*analyzeMovementInState/i.test(source), false, "no interval/loop repeatedly calls analyze in one-shot mode");
assert.equal(source.includes("Math.min(config.maxFrames ?? 4, 4)"), true, "one capture window frame count is capped");
assert.equal(providerSource.includes(".slice(0, MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES)"), true, "provider candidate ladder is capped");
assert.equal(html.includes('id="liveNarratorMode" name="movementNarratorMode" type="radio" value="live" disabled'), true, "live narrator is disabled by default");
assert.equal(source.includes("mirrorFramesToPreview: true"), true, "capture frames are explicitly mirrored to match preview");
assert.equal(html.includes('data-mirror-default="on"'), true, "mirror policy marker exists");
assert.equal(html.includes('data-analysis-mirror="on"'), true, "analysis mirror policy marker exists");
assert.equal(html.includes("transform: scaleX(-1)"), true, "preview is mirrored by default");
assert.equal(source.includes("context.translate(width, 0)") && source.includes("context.scale(-1, 1)"), true, "canvas mirror transform is explicit and transient");
assert.equal(source.includes("data_uri:"), true, "movement capture sends JPEG data URI frames to backend");
assert.equal(source.includes("frame.data_uri = \"\""), true, "transient frame data URIs are cleared after request");
assert.equal(source.includes("mock endpoint"), false, "movement capture does not use a mock-only endpoint");

assert.equal(/WebSocket|navigator\.sendBeacon|MediaRecorder|toDataURL|readAsDataURL|localStorage|sessionStorage|indexedDB/i.test(source), false, "no continuous stream upload or local raw media persistence hooks");
assert.equal(html.includes("Suggestion Trace Campaign") && html.indexOf("Suggestion Trace Campaign") > html.indexOf('id="developerTools"'), true, "trace campaign remains developer-only");
assert.equal(defaultMainUi.includes("Focus Ritual"), false, "main UI no longer shows Focus Ritual");
for (const removedMainUiText of ["Suggestion Trace Campaign", "Gate", "trace", "fixture", "neutral_zone", "off_desk_zone", "notebook_zone", "keyboard_zone", "pen_zone", "phone_zone", "hand.left_zone", "hand.entered_zone", "zone.activated"]) {
  assert.equal(defaultMainUi.toLowerCase().includes(removedMainUiText.toLowerCase()), false, `main UI should not show ${removedMainUiText}`);
}
for (const removedMainWord of ["phone", "notebook", "keyboard"]) {
  assert.equal(new RegExp(`\\b${removedMainWord}\\b`, "i").test(defaultMainUi), false, `main UI should not show ${removedMainWord}`);
}
assert.equal(/\bpen\b/i.test(defaultMainUi), false, "main UI should not show pen as a standalone ritual object");
assert.equal(html.includes("Describe my next movement sends a short temporary frame window only after you click."), true, "privacy copy is truthful for AI mode");
assert.equal(html.includes("No continuous upload."), true, "no continuous upload disclosure exists");
assert.equal(html.includes("No raw media is saved by this app."), true, "raw media disclosure exists");
assert.equal(html.includes("Requires HF_TOKEN for live Hugging Face/Cerebras recognition."), true, "live provider token disclosure exists");
assert.equal(html.includes("dq-movement-sentence"), true, "main movement sentence has a non-truncated hero class");
assert.equal(html.includes("-webkit-line-clamp"), true, "legacy CSS may clamp old debug rows");
assert.equal(html.includes(".dq-movement-sentence") && html.slice(html.indexOf(".dq-movement-sentence"), html.indexOf(".dq-movement-hint")).includes("-webkit-line-clamp"), false, "main movement sentence is not line-clamped");
const movementSentenceCss = html.slice(html.indexOf(".dq-movement-sentence"), html.indexOf(".dq-movement-hint"));
assert.equal(movementSentenceCss.includes("ellipsis"), false, "movement sentence has no ellipsis");
assert.equal(movementSentenceCss.includes("overflow-wrap: anywhere"), true, "movement sentence supports multi-line wrapping");
const resultBlock = defaultMainUi.slice(defaultMainUi.indexOf('id="movementResultTitle"'), defaultMainUi.indexOf('id="currentManualAction"'));
assert.equal(resultBlock.indexOf("Provider") > resultBlock.indexOf("Why?"), true, "provider/model/latency are not hero content");
assert.equal(resultBlock.indexOf("Model") > resultBlock.indexOf("Why?"), true, "provider/model/latency are not hero content");
assert.equal(resultBlock.indexOf("Latency") > resultBlock.indexOf("Why?"), true, "provider/model/latency are not hero content");
assert.equal(source.includes("items.slice(0, 3)"), true, "evidence is capped in result details");
assert.equal(html.includes("result-card-stable"), true, "result card stable layout marker exists");
assert.equal(source.includes("result-card-stable result-hero"), true, "result hero stable class exists");
assert.equal(source.includes("result-reveal"), true, "result reveal class exists");
assert.equal(source.includes("movement-sentence"), true, "movement sentence class marker exists");
assert.equal(html.includes("dq-result-ready"), true, "result animation marker exists");
assert.equal(html.includes(".dq-movement-result.result-reveal"), true, "result animation is not on every base result render");
assert.equal(html.includes("prefers-reduced-motion: reduce"), true, "reduced-motion guard exists");
assert.equal(html.includes('data-collapsed-default="true"'), true, "Why details are collapsed by default");
assert.equal(source.includes("snapshot.result_id !== lastMovementRevealResultId"), true, "result animation is keyed to result_id");
assert.equal(source.includes("movementResultSnapshotFrom"), true, "movement result snapshot factory exists");
assert.equal(source.includes("movementResultRenderKey"), true, "result card render key exists");
assert.equal(source.includes("movementResultDetailKey"), true, "result details render key exists");
assert.equal(source.includes("liveCameraState"), true, "live camera state is separated");
assert.equal(source.includes("movementCaptureState"), true, "movement capture state is separated");
assert.equal(source.includes("movementResultSnapshot"), true, "movement result snapshot state is separated");
assert.equal(source.includes("renderLiveCameraState(state)"), true, "camera frame loop uses isolated live-camera render");
const localMotionBlock = source.slice(source.indexOf("function applyLocalMotionObservations"), source.indexOf("export function updateMotionHistory"));
assert.equal(localMotionBlock.includes("movementResultSnapshot"), false, "camera/motion updates do not mutate movementResultSnapshot");
const renderDetectedActionBlock = source.slice(source.indexOf("function renderDetectedAction"), source.indexOf("function renderMovementResultDetails"));
assert.equal(renderDetectedActionBlock.includes("movementResultRenderKey"), true, "result card render is keyed");
assert.equal(renderDetectedActionBlock.includes("lastMovementResultRenderKey"), true, "unchanged result card renders are skipped");
const resultRenderKeyBlock = source.slice(source.indexOf("function movementResultRenderKey"), source.indexOf("function movementResultDetailKey"));
assert.equal(resultRenderKeyBlock.includes("liveCameraState"), false, "camera movement does not reset result animation");
const resultDetailKeyBlock = source.slice(source.indexOf("function movementResultDetailKey"), source.indexOf("function readableDetailHtml"));
assert.equal(resultDetailKeyBlock.includes("voiceStatus"), false, "voice state changes do not resize the result card");
assert.equal(source.includes("MOVEMENT_HISTORY_MAX_ITEMS"), true, "movement history has a max length cap");
assert.equal(source.includes("CORRECTION_MEMORY_MAX_ITEMS"), true, "correction memory has a max length cap");
assert.equal(source.includes("MOVEMENT_HISTORY_MAX_ITEMS = 10"), true, "movement history is capped at 10");
assert.equal(source.includes("CORRECTION_MEMORY_MAX_ITEMS = 10"), true, "correction memory is capped at 10");
assert.equal(source.includes("movementHistory"), true, "movement history state exists");
assert.equal(source.includes("correctionMemory"), true, "correction memory state exists");
assert.equal(source.includes("confidenceCalibration"), true, "confidence calibration counters exist");
assert.equal(source.includes('format: "text_only"'), true, "movement history and correction memory are text-only");
assert.equal(source.includes('storage: "session_only"'), true, "correction memory is session-only");
assert.equal(source.includes("clearMovementHistory"), true, "movement history can be cleared");
assert.equal(source.includes("clearCorrectionMemory"), true, "corrections are clearable");
assert.equal(source.includes("sanitizeMemoryText"), true, "corrections sanitize sensitive text");
assert.equal(source.includes("recent_corrections: recentCorrectionContextForPrompt(target)"), true, "correction context is sent on the next provider request");
assert.equal(html.includes('id="movementCorrectionInput"'), true, "correction input exists");
assert.equal(html.includes("What did you actually do?"), true, "correction input asks for the actual movement");
assert.equal(html.includes('id="movementHistoryPanel"'), true, "movement history section exists");
const movementHistoryBlock = source.slice(source.indexOf("function appendMovementHistory"), source.indexOf("function appendCorrectionMemory"));
assert.equal(/frame|screenshot|base64|data:image/i.test(movementHistoryBlock), false, "movement history stores no frames/screenshots/base64");
assert.equal(movementHistoryBlock.includes("provider"), false, "movement history does not store provider metadata");
assert.equal(movementHistoryBlock.includes("model"), false, "movement history does not store model metadata");
assert.equal(movementHistoryBlock.includes("confidence"), false, "movement history stores movement text only");
const correctionMemoryBlock = source.slice(source.indexOf("function appendCorrectionMemory"), source.indexOf("export function clearMovementHistory"));
assert.equal(/\b(age|gender|race|ethnicity|private text|frame|screenshot|base64|data:image)\b/i.test(correctionMemoryBlock), false, "correction memory stores no sensitive attributes or media");
assert.equal(correctionMemoryBlock.includes("contains_biometric_identity: false"), true, "correction memory explicitly stores no biometric identity");
assert.equal(correctionMemoryBlock.includes("session_only: true"), true, "correction memory is session-only");
assert.equal(correctionMemoryContract.includes("Correction memory is text-only"), true, "correction memory contract requires text-only storage");
assert.equal(correctionMemoryContract.includes("session-only"), true, "correction memory contract is session-only");
assert.equal(correctionMemoryContract.includes("contains_biometric_identity: false"), true, "correction memory contract requires no biometric identity");
assert.equal(correctionMemoryContract.includes("clearCorrectionMemory"), true, "correction memory contract requires clearing");
assert.equal(promptV2Contract.includes("Movement Narration Prompt v2"), true, "prompt v2 contract exists");
assert.equal(promptV2Contract.includes("Compare frames over time"), true, "prompt v2 asks for temporal movement across frames");
assert.equal(promptV2Contract.includes("Do not identify a person"), true, "prompt v2 forbids identity descriptions");
assert.equal(promptV2Contract.includes("sensitive attributes"), true, "prompt v2 forbids sensitive attributes");
assert.equal(promptV2Contract.includes("Allow uncertainty"), true, "prompt v2 allows uncertainty");
assert.equal(html.indexOf('id="researchLabPanel"') > html.indexOf('id="developerTools"'), true, "Research Lab is under Developer Tools");
assert.equal(defaultMainUi.includes("Research Lab"), false, "Research Lab is hidden from main UI");
assert.equal(html.includes('<details id="researchLabPanel" class="dq-card dq-technical-card" open'), false, "Research Lab is collapsed by default");
const researchLabBlock = html.slice(html.indexOf('id="researchLabPanel"'), html.indexOf('id="diagnosticsCard"'));
assert.equal(/hf_[A-Za-z0-9]{12,}|Authorization|Bearer|raw frame|raw video|screenshot|base64|data:image/i.test(researchLabBlock), false, "Research Lab shows no token/raw frames/base64");
assert.equal(researchLabBlock.includes("Safe provider metadata only"), true, "Research Lab shows only safe provider metadata");
for (const safeResearchField of ["researchPromptVersion", "researchImageTokens", "researchRetries", "researchCandidateFailures", "researchLastSafeError", "researchHistoryCount", "researchCorrectionCount", "researchOneShotGuard"]) {
  assert.equal(researchLabBlock.includes(safeResearchField), true, `Research Lab includes ${safeResearchField}`);
}
assert.equal(html.includes('id="showTrackingOverlay" type="checkbox"'), true, "tracking overlay toggle exists");
assert.equal(html.includes('id="showTrackingOverlay" type="checkbox" checked'), false, "tracking overlay defaults off");
assert.equal(html.includes('id="oneMovementMode" name="movementNarratorMode" type="radio" value="one" checked'), true, "one-movement mode defaults on");
assert.equal(html.includes('id="liveNarratorMode" name="movementNarratorMode" type="radio" value="live" disabled'), true, "live narrator is off by default");
assert.equal(html.includes("Live narrator is disabled in this version. No background movement calls run."), true, "live narrator remains a disabled placeholder");
assert.equal(defaultMainUi.includes("Recent events"), false, "Recent Events is hidden from main product");
assert.equal(html.indexOf("Recent events") > html.indexOf('id="developerTools"'), true, "Recent Events moved under Developer Tools");
for (const zoneLabel of ["neutral_zone", "off_desk_zone", "notebook_zone", "keyboard_zone", "pen_zone", "phone_zone"]) {
  assert.equal(defaultMainUi.includes(zoneLabel), false, `main result hides ${zoneLabel}`);
}
assert.equal(source.includes("naturalizeMovementText"), true, "main result naturalizes internal zone labels");
assert.equal(source.includes("center of the frame"), true, "zone copy has natural language replacement");
assert.equal(source.includes("movementBadgeText"), true, "pending badge is replaced by clear movement states");
assert.equal(source.includes("requires_confirmation: true"), true, "AI result still requires confirmation");
assert.equal(source.includes('data-suggestion-action="reject"'), true, "Not this path remains available");
assert.equal(source.includes("speechSynthesis.speak"), true, "Web Speech output uses browser-native speech synthesis");
assert.equal(source.includes("new Utterance(movement)"), true, "voice speaks only movement sentence");
assert.equal(/new Utterance\([^)]*(provider|model|confidence|evidence)/i.test(source), false, "voice does not speak provider/model/confidence/evidence");
assert.equal(source.includes("!isUncertainMovement(result.movement)"), true, "auto-speak skips uncertain results");
assert.equal(source.includes("speechSynthesis.cancel?.()"), true, "new speech cancels previous speech");
assert.equal(source.includes("Voice ready"), true, "voice ready state exists");
assert.equal(source.includes("Speaking..."), true, "voice speaking state exists");
assert.equal(source.includes("Voice unavailable"), true, "voice unavailable state exists");
assert.equal(liveSource.includes("HF_TOKEN"), true, "live test requires HF_TOKEN");
assert.equal(liveSource.includes("SKIP live movement recognition"), true, "live test skips clearly without token");
assert.equal(liveSource.includes("vlm-control-image.jpg"), true, "live test reads fixture from disk");
assert.equal(liveSource.includes("readFileSync"), true, "live test uses the disk fixture bytes");
assert.equal(/iVBORw0|encoded_frame:\s*["']\/9j/.test(liveSource), false, "live test has no inline image data");
assert.equal(liveSource.includes("runBareHuggingFaceControlCall"), true, "live test starts with bare control call");
assert.equal(liveSource.includes("runProviderHelperEquivalenceCheck"), true, "live test checks provider helper equivalence after bare pass");
assert.equal(liveSource.includes("runMovementPromptControlCall(fixture, bare.returnedModel)"), false, "live test must not reuse returned model as request model");
assert.equal(liveSource.includes("runMovementPromptControlCall(fixture, bare.requestedModel)"), true, "live test keeps requested model for movement prompt");
assert.equal(liveSource.includes("requested_model"), true, "live test reports requested model separately");
assert.equal(liveSource.includes("returned_model"), true, "live test reports returned model separately");
assert.equal(providerSource.includes("Hugging Face router returned ${response.status}`"), false, "generic 400-only reporting is forbidden");
assert.equal(providerSource.includes("hfResponseBody"), true, "HF response body is preserved");

console.log("ok movement recognition provider");
