import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createUsageLimiter } from "../server/hf-usage-limiter.mjs";
import {
  DEFAULT_MOVEMENT_RECOGNITION_CONFIG,
  MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES,
  MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
  buildHuggingFaceVlmRequestBody,
  buildMovementRecognitionPrompt,
  buildVisualConversationPrompt,
  classifyProviderFailure,
  describeHuggingFaceVlmRequestBody,
  isRetryableProviderFailure,
  isProviderCapacityError,
  loadMovementRecognitionConfig,
  movementRecognitionHealth,
  movementRecognitionResponseForRequest,
  movementRecognitionUsageForRequest,
  normalizeMovementRecognitionOutput
} from "../server/movement-recognition-provider.mjs";

const source = readFileSync(resolve("packages/perception/browser-local-capture/prototype/local-capture.js"), "utf8");
const html = readFileSync(resolve("packages/perception/browser-local-capture/prototype/index.html"), "utf8");
const providerSource = readFileSync(resolve("packages/perception/browser-local-capture/server/movement-recognition-provider.mjs"), "utf8");
const serverSource = readFileSync(resolve("packages/perception/browser-local-capture/server/movement-recognition-server.mjs"), "utf8");
const launcherSource = readFileSync(resolve("packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs"), "utf8");
const limiterSource = readFileSync(resolve("packages/perception/browser-local-capture/server/hf-usage-limiter.mjs"), "utf8");
const liveSource = readFileSync(resolve("packages/perception/browser-local-capture/test/movement-recognition-live.test.mjs"), "utf8");
const envExample = readFileSync(resolve(".env.example"), "utf8");
const gitignore = readFileSync(resolve(".gitignore"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const correctionMemoryContract = readFileSync(resolve("docs/contracts/movement-correction-memory.v0.md"), "utf8");
const promptV2Contract = readFileSync(resolve("docs/contracts/movement-narration-prompt.v2.md"), "utf8");
const fixtureBuffer = readFileSync(resolve("packages/perception/browser-local-capture/test/fixtures/vlm-control-image.jpg"));
const fixtureBase64 = fixtureBuffer.toString("base64");
const fixtureDataUri = `data:image/jpeg;base64,${fixtureBase64}`;
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const advancedTemplateStart = bodyHtml.indexOf('<template id="advancedViewTemplate">');
const primaryHtml = advancedTemplateStart >= 0 ? bodyHtml.slice(0, advancedTemplateStart) : bodyHtml;
const advancedHtml = advancedTemplateStart >= 0 ? bodyHtml.slice(advancedTemplateStart) : "";
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const defaultMainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;
mkdirSync(resolve(".darkquest"), { recursive: true });
const testRunRoot = mkdtempSync(resolve(".darkquest/test-hf-usage-"));

function testUsageLimiter(overrides = {}) {
  const limiter = createUsageLimiter({
    usageStatePath: resolve(testRunRoot, `usage-${Math.random().toString(16).slice(2)}.json`),
    requestCooldownMs: 0,
    maxRequestsPerSession: 1000,
    maxRequestsPerDay: 1000,
    maxRequestsPerMonth: 1000,
    maxConcurrentRequests: 10,
    ...overrides
  });
  limiter.resetUsageForTests();
  return limiter;
}

function testOptions(options = {}, overrides = {}) {
  return { usageLimiter: testUsageLimiter(overrides), ...options };
}

assert.equal(html.includes("Sensefield"), true, "main UI names the Sensefield product");
assert.equal(html.includes("Show an action, object, or change. Let the local model respond."), true, "main UI has visual companion subtitle");
assert.equal(html.includes('id="analyzeMovement"'), true, "movement capture action is wired");
assert.equal(primaryHtml.includes("Start conversation"), true, "primary visual button starts a persistent conversation");
assert.equal(defaultMainUi.includes("Describe my next movement"), false, "old movement narrator copy is not primary UI");
assert.equal(defaultMainUi.includes("Analyze Movement"), false, "primary UI does not use Analyze Movement copy");
assert.equal(source.includes("Get ready..."), true, "get-ready state exists");
assert.equal(source.includes("Watching…"), true, "capture state shows watching copy");
assert.equal(source.includes("Thinking"), true, "analyzing state is exposed as thinking in the primary session");
assert.equal(primaryHtml.includes("Observe again"), false, "primary UI has no Observe again control");
assert.equal(html.includes("Visual Response"), true, "main UI has Visual Response card");
assert.equal(primaryHtml.includes("Speak again"), false, "primary UI has no manual speech replay button");
assert.equal(primaryHtml.includes("Auto-speak on"), false, "primary UI has no manual auto-speak toggle");
assert.equal(advancedHtml.includes("Auto-speak on"), true, "advanced mode retains the mute preference control");
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
assert.equal(health.cloud_enabled, true, "cloud usage flag defaults enabled unless explicitly disabled");
assert.equal(serverSource.includes('/api/movement-recognition/health'), true, "health endpoint route exists");
assert.equal(serverSource.includes('/api/movement-recognition/usage'), true, "usage endpoint route exists");
assert.equal(launcherSource.includes('const movementHealthRoute = "/api/movement-recognition/health"'), true, "physical:capture exposes movement health route");
assert.equal(launcherSource.includes('const movementAnalyzeRoute = "/api/movement-recognition/analyze"'), true, "physical:capture exposes movement analyze route");
assert.equal(launcherSource.includes('const movementUsageRoute = "/api/movement-recognition/usage"'), true, "physical:capture exposes movement usage route");
assert.equal(launcherSource.includes("maybeHandleMovementRecognitionApi(request, response, url)"), true, "physical:capture mounts movement API before static files");
assert.equal(launcherSource.includes("movementRecognitionResponseForRequest(body, process.env"), true, "physical:capture analyze route uses provider helper");
assert.equal(launcherSource.includes("loadProjectRootEnv(root)"), true, "physical:capture loads project-root .env automatically");
assert.equal(launcherSource.includes("process.env[parsed.key] !== undefined"), true, "existing process environment values take precedence over .env");
assert.equal(launcherSource.includes("HF token loaded:"), true, "launcher reports token loaded state without printing token");
assert.equal(launcherSource.includes('const automationExecuteRoute = "/api/automation/execute"'), true, "physical:capture mounts automation execution route");
assert.equal(serverSource.includes("automationExecutionResponseForRequest"), true, "movement server mounts automation execution helper");

const requiredCloudEnv = {
  HF_CLOUD_INFERENCE_ENABLED: "true",
  HF_MAX_REQUESTS_PER_SESSION: "20",
  HF_MAX_REQUESTS_PER_DAY: "50",
  HF_MAX_REQUESTS_PER_MONTH: "100",
  HF_MAX_CONCURRENT_REQUESTS: "1",
  HF_MAX_PROVIDER_RETRIES: "1",
  HF_REQUEST_COOLDOWN_MS: "5000",
  HF_MAX_FRAMES_PER_REQUEST: "6",
  HF_MAX_WINDOW_MS: "4000",
  HF_MAX_FRAME_WIDTH: "768",
  HF_MAX_FRAME_HEIGHT: "768",
  HF_MAX_REQUEST_BODY_BYTES: "5000000",
  HF_USAGE_STATE_PATH: ".darkquest/hf-usage.json"
};
const requiredConfiguredEnv = {
  ...requiredCloudEnv,
  HF_MAX_REQUESTS_PER_SESSION: "200",
  HF_MAX_REQUESTS_PER_DAY: "1000",
  HF_MAX_REQUESTS_PER_MONTH: "5000"
};
const realEnvText = readFileSync(resolve(".env"), "utf8");
assert.equal((realEnvText.match(/^HF_TOKEN=/gm) || []).length, 1, "real .env keeps exactly one HF_TOKEN key");
for (const [key, value] of Object.entries(requiredCloudEnv)) {
  assert.equal((realEnvText.match(new RegExp(`^${key}=`, "gm")) || []).length, 1, `real .env has one ${key}`);
  assert.equal(realEnvText.includes(`${key}=${requiredConfiguredEnv[key]}`), true, `real .env configures ${key}`);
  assert.equal(envExample.includes(`${key}=${value}`), true, `.env.example documents ${key}`);
}
assert.equal(envExample.includes("HF_TOKEN=\n"), true, ".env.example keeps HF_TOKEN empty");
assert.equal(gitignore.includes(".env\n"), true, ".gitignore ignores .env");
assert.equal(gitignore.includes(".env.*"), true, ".gitignore ignores env variants");
assert.equal(gitignore.includes("!.env.example"), true, ".gitignore allows .env.example");
assert.equal(gitignore.includes(".darkquest/"), true, ".gitignore ignores local usage state");
assert.equal(packageJson.scripts.typecheck.includes("server/hf-usage-limiter.mjs"), true, "typecheck covers usage limiter");
assert.equal(/HF_TOKEN|Authorization|Bearer|data:image|base64|encoded_frame|prompt/i.test(limiterSource), false, "usage limiter source does not persist secrets, prompts, or media fields");

const sessionId = "darkquest_session_testaaaa";
const now = Date.UTC(2026, 0, 31, 23, 59, 0);
const limiter = createUsageLimiter({ usageStatePath: resolve(testRunRoot, "direct-limiter.json"), requestCooldownMs: 0, maxRequestsPerSession: 1, maxRequestsPerDay: 1, maxRequestsPerMonth: 2, maxConcurrentRequests: 1 });
limiter.resetUsageForTests();
assert.equal(limiter.checkRequestAllowed({ sessionId, now }).ok, true, "first logical request is allowed");
assert.equal(limiter.beginRequest({ sessionId, now }).ok, true, "begin marks one request in flight");
assert.equal(limiter.beginRequest({ sessionId: "darkquest_session_testbbbb", now }).code, "hf_concurrency_limit", "concurrency limit blocks second in-flight request");
limiter.recordLogicalRequest({ sessionId, now, provider: "huggingface", model: "model:test" });
limiter.finishRequest({ sessionId, now });
assert.equal(limiter.checkRequestAllowed({ sessionId, now: now + 1 }).code, "hf_session_limit_reached", "session limit is enforced");
assert.equal(limiter.checkRequestAllowed({ sessionId: "darkquest_session_testcccc", now: now + 1 }).code, "hf_daily_limit_reached", "UTC daily limit is enforced");
assert.equal(limiter.checkRequestAllowed({ sessionId: "darkquest_session_testcccc", now: now + 90_000 }).ok, true, "UTC daily rollover allows the next day");

const monthLimiter = createUsageLimiter({ usageStatePath: resolve(testRunRoot, "month-limiter.json"), requestCooldownMs: 0, maxRequestsPerMonth: 1 });
monthLimiter.resetUsageForTests();
monthLimiter.recordLogicalRequest({ sessionId, now });
assert.equal(monthLimiter.checkRequestAllowed({ sessionId: "darkquest_session_monthbb", now: now + 1 }).code, "hf_monthly_limit_reached", "monthly limit is enforced");
assert.equal(monthLimiter.checkRequestAllowed({ sessionId: "darkquest_session_monthbb", now: Date.UTC(2026, 1, 1, 0, 1, 0) }).ok, true, "UTC monthly rollover allows the next month");

const cooldownLimiter = createUsageLimiter({ usageStatePath: resolve(testRunRoot, "cooldown-limiter.json"), requestCooldownMs: 5000 });
cooldownLimiter.resetUsageForTests();
cooldownLimiter.recordLogicalRequest({ sessionId, now });
assert.equal(cooldownLimiter.checkRequestAllowed({ sessionId, now: now + 1000 }).code, "hf_request_cooldown", "request cooldown is enforced");

const validationLimiter = createUsageLimiter({ usageStatePath: resolve(testRunRoot, "validation-limiter.json"), requestCooldownMs: 0, maxFramesPerRequest: 2, maxWindowMs: 1000, maxFrameWidth: 10, maxFrameHeight: 10, maxRequestBodyBytes: 40, maxProviderRetries: 1, cloudEnabled: false });
assert.equal(validationLimiter.checkRequestAllowed({ sessionId, now }).code, "hf_cloud_disabled", "cloud-disabled mode blocks cloud calls");
const requestLimiter = createUsageLimiter({ usageStatePath: resolve(testRunRoot, "request-limiter.json"), requestCooldownMs: 0, maxFramesPerRequest: 2, maxWindowMs: 1000, maxFrameWidth: 10, maxFrameHeight: 10, maxRequestBodyBytes: 40, maxProviderRetries: 1 });
assert.equal(requestLimiter.checkRequestAllowed({ sessionId, now, frames: [{}, {}, {}] }).code, "hf_frame_limit_exceeded", "frame-count limit is enforced");
assert.equal(requestLimiter.checkRequestAllowed({ sessionId, now, frames: [{ captured_at_ms: 0 }, { captured_at_ms: 2000 }] }).code, "hf_window_limit_exceeded", "observation-window limit is enforced");
assert.equal(requestLimiter.checkRequestAllowed({ sessionId, now, frames: [{ width: 11, height: 10 }] }).code, "hf_frame_dimensions_exceeded", "frame-dimension limit is enforced");
assert.equal(requestLimiter.checkRequestAllowed({ sessionId, now, bodyBytes: 41 }).code, "hf_request_too_large", "request body-size limit is enforced");
assert.equal(requestLimiter.checkRequestAllowed({ sessionId, now, retryCount: 2 }).code, "hf_retry_limit_reached", "retry cap is enforced");

const corruptPath = resolve(testRunRoot, "corrupt-usage.json");
writeFileSync(corruptPath, "{not json", "utf8");
const corruptLimiter = createUsageLimiter({ usageStatePath: corruptPath, requestCooldownMs: 0 });
assert.equal(corruptLimiter.getUsageSummary({ sessionId, now }).session.used, 0, "corrupted usage state recovers safely");
corruptLimiter.recordLogicalRequest({ sessionId, now, provider: "huggingface", model: "model:test" });
const persistedUsage = readFileSync(corruptPath, "utf8");
assert.equal(persistedUsage.includes("hf_test"), false, "usage persistence never stores token-like test values");
assert.equal(/data:image|base64|encoded_frame|prompt|Authorization|Bearer/i.test(persistedUsage), false, "usage persistence never stores media, prompts, or auth headers");

const usageEndpointLimiter = createUsageLimiter({ usageStatePath: resolve(testRunRoot, "usage-endpoint.json"), requestCooldownMs: 0 });
usageEndpointLimiter.resetUsageForTests();
usageEndpointLimiter.recordLogicalRequest({ sessionId, now });
const usageEndpoint = movementRecognitionUsageForRequest({ HF_TOKEN: "hf_test" }, { usageLimiter: usageEndpointLimiter, sessionId, now });
assert.equal(usageEndpoint.status, 200);
assert.equal(usageEndpoint.json.session.used, 1);
assert.equal(JSON.stringify(usageEndpoint.json).includes("hf_test"), false, "usage endpoint never returns token");
assert.equal(/data:image|base64|prompt|Authorization|Bearer|\/Users\/.*\.env/i.test(JSON.stringify(usageEndpoint.json)), false, "usage endpoint returns only safe usage metadata");

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
  "movement_key",
  "gesture_tags",
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

const conversationPrompt = buildVisualConversationPrompt({
  userQuestion: "What am I holding?",
  previousContext: {
    recent_user_turns: ["What color is it?"],
    recent_assistant_turns: ["It looked dark."],
    visual_summary: "An object is near the camera."
  }
});
for (const required of [
  "Conversation mode",
  "Answer the user's question directly",
  "User question: What am I holding?",
  "answer the question, not a movement narration",
  "Do not proactively narrate unrelated movement",
  "Return only JSON"
]) {
  assert.equal(conversationPrompt.includes(required), true, `conversation prompt contains ${required}`);
}

const canonicalMovement = normalizeMovementRecognitionOutput({
  movement: "You raised your hand and made a peace sign.",
  short_label: "Peace sign",
  movement_key: "peace_sign",
  gesture_tags: ["hand_gesture", "two_fingers_raised"],
  confidence: 0.87
});
assert.equal(canonicalMovement.movement_key, "peace_sign");
assert.deepEqual(canonicalMovement.gesture_tags, ["hand_gesture", "two_fingers_raised"]);
const canonicalFallback = normalizeMovementRecognitionOutput({ movement: "You waved.", short_label: "Hand wave", confidence: 0.8 });
assert.equal(canonicalFallback.movement_key, "hand_wave", "missing movement key derives conservatively from short label");
assert.deepEqual(canonicalFallback.gesture_tags, [], "missing gesture tags default empty without a second AI call");
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
}, testOptions({
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
}));
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

let conversationCalled = false;
const conversationResponse = await movementRecognitionResponseForRequest({
  frames: [{ mime_type: "image/jpeg", encoded_frame: "abc", captured_at_ms: 1 }],
  allowed_actions: MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
  current_step: "visual_conversation",
  previous_context: { recent_user_turns: ["What color is it?"], visual_summary: "A mug is visible." },
  user_question: "What am I holding?",
  requested_response_mode: "conversation",
  interaction_mode: "conversation",
  mode_generation_id: 7
}, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL: "Qwen/Qwen2.5-VL-7B-Instruct:together",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "Qwen/Qwen2.5-VL-7B-Instruct:together"
}, testOptions({
  fetch: async (_url, init) => {
    conversationCalled = true;
    const request = JSON.parse(init.body);
    const text = request.messages[0].content[0].text;
    assert.equal(text.includes("Conversation mode"), true, "conversation fallback uses conversation prompt");
    assert.equal(text.includes("User question: What am I holding?"), true, "conversation fallback forwards user question");
    assert.equal(text.includes("movement narration"), true, "conversation prompt explicitly rejects movement narration");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          model: "gemma-4-31b",
          choices: [{
            message: {
              content: JSON.stringify({
                movement: "You're holding a dark mug.",
                short_label: "Answer",
                movement_key: "conversation_answer",
                confidence: 0.78,
                reason: "The mug is visible in the current frame.",
                evidence: ["current frame"],
                requires_confirmation: true
              })
            }
          }]
        };
      }
    };
  }
}));
assert.equal(conversationCalled, true, "mock conversation provider was called");
assert.equal(conversationResponse.status, 200);
assert.equal(conversationResponse.json.movement, "You're holding a dark mug.");
assert.equal(conversationResponse.json.prompt_version, "visual-conversation-prompt.v1");

const returnedModelReuseCalls = [];
const returnedModelReuse = await movementRecognitionResponseForRequest({
  frames: [{ mime_type: "image/jpeg", encoded_frame: "abc", captured_at_ms: 1 }],
  allowed_actions: MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
  current_step: "movement_narration"
}, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "google/gemma-4-31B-it:cerebras,next-model:groq"
}, testOptions({
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
}));
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
}, testOptions({
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
}));
assert.deepEqual(ladderCalls, ["bad-model:fastest"], "non-temporary model config failure is not retried");
assert.equal(ladder.status, 502);
assert.equal(ladder.json.model, "unused");
assert.equal(ladder.json.movement.startsWith("AI unavailable"), true);
assert.equal(ladder.json.action_type, "uncertain", "hard provider failure returns uncertain compatibility metadata");
assert.equal(ladder.json.failed_candidates[0].model, "bad-model:fastest");
assert.equal(ladder.json.failed_candidates[0].hf_response_body, "{\"error\":\"model unavailable\"}", "exact HF error body is surfaced");
assert.equal(ladder.json.failed_candidates[0].image_input_count, 1);
assert.equal(ladder.json.failed_candidates[0].any_image_input_starts_with_data_image, true);
assert.equal(ladder.json.failed_candidates[0].response_format_sent, false);
assert.deepEqual(ladder.json.failed_candidates[0].custom_top_level_fields_sent, []);

const unsupported = await movementRecognitionResponseForRequest({ frames: [] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "bad-model:fastest"
}, testOptions({
  fetch: async () => ({ ok: false, status: 422, async text() { return "{\"error\":\"unsupported image input\"}"; } })
}));
assert.equal(unsupported.status, 502, "unsupported model/provider is not retried as a temporary failure");
assert.equal(unsupported.json.action_type, "uncertain");
assert.equal(unsupported.json.movement.startsWith("AI unavailable"), true);
assert.equal(unsupported.json.failed_candidates[0].classification, "PROVIDER_MODEL_UNSUPPORTED");
assert.equal(unsupported.json.failed_candidates[0].hf_response_body, "{\"error\":\"unsupported image input\"}");

const queueExceeded = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "queued-model:cerebras,queue-fallback:together"
}, testOptions({
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
}));
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
  HF_MAX_PROVIDER_RETRIES: "4",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "busy-a:cerebras,busy-b:groq"
}, testOptions({
  fetch: async () => ({ ok: false, status: 429, async text() { return "{\"message\":\"We're experiencing high traffic right now! Please try again soon.\",\"type\":\"too_many_requests_error\",\"param\":\"queue\",\"code\":\"queue_exceeded\"}"; } })
}, { maxProviderRetries: 4 }));
assert.equal(allBusy.status, 200, "all busy providers return a user-visible busy result");
assert.equal(allBusy.json.movement, "AI provider is busy — try again in a moment.");
assert.equal(allBusy.json.failed_candidates.length, 2);
assert.equal(JSON.stringify(allBusy.json).includes("hf_test"), false, "failed candidate diagnostics do not print token");

const logicalLimiter = testUsageLimiter();
const logicalCalls = [];
const logical = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  HF_MAX_PROVIDER_RETRIES: "1",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "logical-busy:cerebras,logical-good:groq"
}, {
  usageLimiter: logicalLimiter,
  fetch: async (_url, init) => {
    const request = JSON.parse(init.body);
    logicalCalls.push(request.model);
    if (request.model.startsWith("logical-busy")) {
      return { ok: false, status: 429, async text() { return "{\"code\":\"queue_exceeded\"}"; } };
    }
    return { ok: true, status: 200, async json() { return { choices: [{ message: { content: JSON.stringify({ movement: "You moved your hand.", short_label: "Hand movement", confidence: 0.6, reason: "mock", evidence: ["mock"], requires_confirmation: true }) } }] }; } };
  }
});
assert.equal(logical.status, 200);
assert.deepEqual(logicalCalls, ["logical-busy:cerebras", "logical-good:groq"], "temporary provider failure can use one fallback attempt");
assert.equal(logicalLimiter.getUsageSummary({ sessionId: "darkquest_session_anonymous" }).session.used, 1, "fallback attempts count as one logical request");

const retryCapCalls = [];
const retryCap = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  HF_MAX_PROVIDER_RETRIES: "0",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "retry-busy:cerebras,retry-good:groq"
}, testOptions({
  fetch: async (_url, init) => {
    retryCapCalls.push(JSON.parse(init.body).model);
    return { ok: false, status: 429, async text() { return "{\"code\":\"queue_exceeded\"}"; } };
  }
}, { maxProviderRetries: 0 }));
assert.equal(retryCap.status, 429);
assert.equal(retryCap.json.code, "hf_retry_limit_reached");
assert.deepEqual(retryCapCalls, ["retry-busy:cerebras"], "retry cap stops fallback loop");

let cloudDisabledFetchCalled = false;
const cloudDisabled = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  HF_CLOUD_INFERENCE_ENABLED: "false"
}, testOptions({
  fetch: async () => {
    cloudDisabledFetchCalled = true;
    return { ok: true, status: 200, async json() { return {}; } };
  }
}, { cloudEnabled: false }));
assert.equal(cloudDisabled.status, 503);
assert.equal(cloudDisabled.json.code, "hf_cloud_disabled");
assert.equal(cloudDisabledFetchCalled, false, "cloud-disabled mode makes zero router calls");

const invalidImageCalls = [];
const invalidImage = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "invalid-image:cerebras,next-model:groq"
}, testOptions({
  fetch: async (_url, init) => {
    invalidImageCalls.push(JSON.parse(init.body).model);
    return { ok: false, status: 400, async text() { return "{\"error\":\"invalid_image\",\"message\":\"invalid image\"}"; } };
  }
}));
assert.equal(invalidImage.status, 502, "invalid_image remains a hard payload failure");
assert.deepEqual(invalidImageCalls, ["invalid-image:cerebras"], "payload/image failure does not continue ladder");
assert.equal(invalidImage.json.failed_candidates[0].classification, "PAYLOAD_OR_IMAGE_FAILURE");
assert.equal(invalidImage.json.failed_candidates[0].hf_response_body, "{\"error\":\"invalid_image\",\"message\":\"invalid image\"}", "exact invalid image body is logged");

const invalidTokenCalls = [];
const invalidToken = await movementRecognitionResponseForRequest({ frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL_CANDIDATES: "auth-model:cerebras,next-model:groq"
}, testOptions({
  fetch: async (_url, init) => {
    invalidTokenCalls.push(JSON.parse(init.body).model);
    return { ok: false, status: 401, async text() { return "{\"error\":\"Invalid token\"}"; } };
  }
}));
assert.equal(invalidToken.status, 502, "invalid token remains auth failure");
assert.deepEqual(invalidTokenCalls, ["auth-model:cerebras"], "auth failure does not continue ladder");
assert.equal(invalidToken.json.failed_candidates[0].classification, "AUTH_FAILURE");
assert.equal(JSON.stringify(invalidToken.json).includes("hf_test"), false, "auth diagnostics do not print token");

const invalidJson = await movementRecognitionResponseForRequest({ frames: [] }, {
  HF_TOKEN: "hf_test",
  MOVEMENT_RECOGNITION_MODEL: "json-test:fastest"
}, testOptions({
  fetch: async () => ({
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { content: "not structured json" } }] };
    }
  })
}));
assert.equal(invalidJson.status, 200);
assert.equal(invalidJson.json.action_type, "uncertain", "invalid model JSON becomes uncertain");
assert.equal(invalidJson.json.movement, "Uncertain — try again.", "invalid model JSON becomes uncertain movement");

const missingToken = await movementRecognitionResponseForRequest({ frames: [] }, {}, testOptions());
assert.equal(missingToken.status, 503, "missing HF_TOKEN returns unavailable");
assert.equal(missingToken.json.action_type, "uncertain");
assert.equal(missingToken.json.movement, "HF_TOKEN is not loaded. Restart the app; the launcher loads .env automatically.");

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
  "selectMovementAnalysisBackend",
  "runLiveAiSmokeTestInState",
  "queueMovementRecognitionFallback",
  "safeMovementRecognitionErrorMessage",
  "visual_companion_observation",
  "local_motion_proxy"
]) {
  assert.equal(source.includes(marker) || serverSource.includes(marker) || providerSource.includes(marker), true, `missing movement recognition marker: ${marker}`);
}
assert.equal(source.includes('endpoint: "/api/movement-recognition/analyze"'), true, "frontend calls the mounted analyze endpoint");
assert.equal(source.includes("requestMovementRecognitionHealth"), true, "frontend has in-app health check");
assert.equal(source.includes('kind: "hf_cloud"'), true, "Observe can fall back from local visual service to HF cloud");
assert.equal(source.includes("requestMovementRecognition({"), true, "Observe routes cloud fallback through movement recognition API");
assert.equal(source.includes("const localFallback = false"), true, "a local detector cannot masquerade as model interpretation");
assert.equal(source.includes('["HF", "TOKEN"].join("_")'), true, "frontend constructs token label without exposing token value");
assert.equal(source.includes("HF_TOKEN is not loaded. Restart the app; the launcher loads .env automatically."), true, "UI distinguishes missing token");
assert.equal(source.includes("Movement recognition endpoint unavailable."), true, "UI distinguishes missing endpoint");
assert.equal(source.includes("AI provider is busy — try again in a moment."), true, "UI distinguishes provider busy");
assert.equal(source.includes("Camera frame could not be read. Try again."), true, "UI distinguishes invalid image payload");
assert.equal(source.includes("Network error while contacting movement recognition."), true, "UI distinguishes network errors");
assert.equal(source.includes("AI response was unclear — try again."), true, "UI distinguishes malformed provider responses");
assert.equal(source.includes("target.movementRecognition.requestInFlight ||"), true, "double-click one-shot cost guard exists");
assert.equal(source.includes("document.hidden"), true, "hidden tabs cannot start a new movement call");
assert.equal(source.includes("dom.analyzeMovement.disabled = !state.cameraReady || analyzing || cloudBlocked"), true, "button is disabled while capturing/analyzing or hard cloud-blocked without local model");
assert.equal(source.includes('boundDom.analyzeMovement?.addEventListener("click", () => handlePrimaryAction())'), true, "primary session starts from explicit button click");
assert.equal(source.includes("if (state.cameraReady) await analyzeMovementInState(state)"), false, "Try another movement does not auto-repeat the AI call");
assert.equal(/setInterval\([^)]*analyzeMovementInState/i.test(source), false, "no timer loop repeatedly calls analyze");
assert.equal(source.includes("Math.min(config.maxFrames ?? 4, 8)"), true, "one capture window frame count is capped");
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

assert.equal(/WebSocket|navigator\.sendBeacon|MediaRecorder|toDataURL|readAsDataURL|indexedDB/i.test(source), false, "no continuous stream upload or local raw media persistence hooks");
assert.equal(source.includes("VISUAL_CONTEXT_STORAGE_KEY"), true, "persistent opt-in memory uses text-only visual context storage");
assert.equal(html.includes("Suggestion Trace Campaign") && html.indexOf("Suggestion Trace Campaign") > html.indexOf('id="developerTools"'), true, "trace campaign remains developer-only");
assert.equal(defaultMainUi.includes("Focus Ritual"), false, "main UI no longer shows Focus Ritual");
for (const removedMainUiText of ["Suggestion Trace Campaign", "Gate", "trace", "fixture", "neutral_zone", "off_desk_zone", "notebook_zone", "keyboard_zone", "pen_zone", "phone_zone", "hand.left_zone", "hand.entered_zone", "zone.activated"]) {
  assert.equal(defaultMainUi.toLowerCase().includes(removedMainUiText.toLowerCase()), false, `main UI should not show ${removedMainUiText}`);
}
for (const removedMainWord of ["phone", "notebook", "keyboard"]) {
  assert.equal(new RegExp(`\\b${removedMainWord}\\b`, "i").test(defaultMainUi), false, `main UI should not show ${removedMainWord}`);
}
assert.equal(/\bpen\b/i.test(defaultMainUi), false, "main UI should not show pen as a standalone ritual object");
assert.equal(html.includes("Observe sends a short temporary frame window only after you click."), true, "advanced privacy copy is truthful for visual mode");
assert.equal(html.includes("No continuous upload."), true, "no continuous upload disclosure exists");
assert.equal(html.includes("No raw media is saved by this app."), true, "raw media disclosure exists");
assert.equal(html.includes("Uses a local open-source visual model service when running."), true, "local model disclosure exists");
assert.equal(html.includes("dq-movement-sentence"), true, "main movement sentence has a non-truncated hero class");
assert.equal(html.includes("-webkit-line-clamp"), true, "legacy CSS may clamp old debug rows");
assert.equal(html.includes(".dq-movement-sentence") && html.slice(html.indexOf(".dq-movement-sentence"), html.indexOf(".dq-movement-hint")).includes("-webkit-line-clamp"), false, "main movement sentence is not line-clamped");
const movementSentenceCss = html.slice(html.indexOf(".dq-movement-sentence"), html.indexOf(".dq-movement-hint"));
assert.equal(movementSentenceCss.includes("ellipsis"), false, "movement sentence has no ellipsis");
assert.equal(movementSentenceCss.includes("overflow-wrap: anywhere"), true, "movement sentence supports multi-line wrapping");
const resultBlock = primaryHtml.slice(primaryHtml.indexOf('id="movementResultTitle"'), primaryHtml.indexOf('id="savedActionsCard"'));
assert.equal(resultBlock.includes("Provider"), false, "provider is not primary hero content");
assert.equal(resultBlock.includes("Model"), false, "model is not primary hero content");
assert.equal(resultBlock.includes("Latency"), false, "latency is not primary hero content");
assert.equal(source.includes("items.slice(0, 3)"), true, "evidence is capped in result details");
assert.equal(html.includes("result-card-stable"), true, "result card stable layout marker exists");
assert.equal(html.includes('id="instantGestures"'), true, "instant local gestures remain secondary to the narrator result");
assert.equal(source.includes("runStableGestureRecipes"), true, "stable local gestures use the local automation path");
assert.equal(source.includes("instantGesturesEnabled: runtime.userEnabled"), true, "instant path has an explicit opt-in guard");
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
assert.equal(source.includes("previous_context: visualContextForRequest(target)"), true, "text-only visual context is sent on the next provider request");
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
assert.equal(source.includes("visualResponseNeedsConfirmation"), true, "plain narration is separate from consequential confirmation");
assert.equal(source.includes('data-suggestion-action="reject"'), true, "Not this path remains available");
assert.equal(source.includes("VISUAL_COMPANION_CLIENT_CONFIG.speakEndpoint"), true, "contextual speech uses the neural voice endpoint");
assert.equal(source.includes("playAudioBlob(blob"), true, "neural audio is played through one owned Audio element");
assert.equal(/body:\s*JSON\.stringify\(\{[\s\S]*?text,[\s\S]*?observation_id:/m.test(source), true, "voice sends only contextual response identity and text");
assert.equal(source.includes("UNCERTAIN_SPOKEN_RESPONSE"), true, "uncertain results still have a useful spoken response");
assert.equal(source.includes("cancelVisualSpeech(target, options)"), true, "new speech cancels previous owned playback");
assert.equal(source.includes("speakWithBrowserSpeech"), false, "legacy browser/system narration is absent");
assert.equal(source.includes('voiceStatus: "Ready"'), true, "voice idle state is truthful and does not imply playback");
assert.equal(source.includes("Speaking…"), true, "voice speaking state exists");
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

rmSync(testRunRoot, { recursive: true, force: true });
console.log("ok movement recognition provider");
