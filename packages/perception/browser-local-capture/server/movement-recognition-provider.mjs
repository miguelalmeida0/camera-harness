import { createUsageLimiter, HF_USAGE_LIMIT_MESSAGES } from "./hf-usage-limiter.mjs";

export const MOVEMENT_RECOGNITION_ALLOWED_ACTIONS = ["uncertain"];
const LEGACY_MOVEMENT_ACTION_TYPES = ["phone_moved", "notebook_opened", "pen_picked_up", "writing_motion", "typing_motion", "uncertain"];
export const MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES = 5;
export const MOVEMENT_NARRATION_PROMPT_VERSION = "movement-narration-prompt.v2";
export const VISUAL_CONVERSATION_PROMPT_VERSION = "visual-conversation-prompt.v1";

export const DEFAULT_MOVEMENT_RECOGNITION_CONFIG = {
  provider: "huggingface",
  model: "google/gemma-4-31B-it:cerebras",
  modelCandidates: [
    "google/gemma-4-31B-it:cerebras",
    "meta-llama/Llama-4-Scout-17B-16E-Instruct:groq",
    "CohereLabs/aya-vision-32b:cohere",
    "zai-org/GLM-4.5V:zai-org",
    "MiniMaxAI/MiniMax-M3:together"
  ],
  mode: "vlm_frames",
  maxFrames: 4,
  windowMs: 1500,
  endpoint: "/api/movement-recognition/analyze"
};

const ROUTER_URL = "https://router.huggingface.co/v1/chat/completions";
let selectedMovementRecognitionModel = null;
let failedMovementRecognitionCandidates = [];
const usageLimiterCache = new Map();

// Hugging Face Inference Providers use a single router with HF_TOKEN auth.
// Codex can point at the same router with HF_TOKEN, and models may be pinned
// with suffixes such as :cerebras, :together, :fastest, or :cheapest where
// supported. Video classification/action recognition is a real Hugging Face
// task; this MVP prefers VLM sampled frames. Cerebras is useful for fast
// reasoning/VLM routing where the selected model/provider supports it.
export function loadMovementRecognitionConfig(env = process.env) {
  const candidates = String(env.MOVEMENT_RECOGNITION_MODEL_CANDIDATES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    provider: env.MOVEMENT_RECOGNITION_PROVIDER || DEFAULT_MOVEMENT_RECOGNITION_CONFIG.provider,
    model: env.MOVEMENT_RECOGNITION_MODEL || DEFAULT_MOVEMENT_RECOGNITION_CONFIG.model,
    modelCandidates: candidates.length ? candidates : DEFAULT_MOVEMENT_RECOGNITION_CONFIG.modelCandidates,
    mode: env.MOVEMENT_RECOGNITION_MODE || DEFAULT_MOVEMENT_RECOGNITION_CONFIG.mode,
    maxFrames: clampInt(env.MOVEMENT_RECOGNITION_MAX_FRAMES, 1, 4, DEFAULT_MOVEMENT_RECOGNITION_CONFIG.maxFrames),
    windowMs: clampInt(env.MOVEMENT_RECOGNITION_WINDOW_MS, 500, 2200, DEFAULT_MOVEMENT_RECOGNITION_CONFIG.windowMs),
    token: env.HF_TOKEN || "",
    cloudEnabled: String(env.HF_CLOUD_INFERENCE_ENABLED ?? "true").toLowerCase() !== "false",
    maxRequestsPerSession: positiveInt(env.HF_MAX_REQUESTS_PER_SESSION, 20),
    maxRequestsPerDay: positiveInt(env.HF_MAX_REQUESTS_PER_DAY, 50),
    maxRequestsPerMonth: positiveInt(env.HF_MAX_REQUESTS_PER_MONTH, 100),
    maxConcurrentRequests: positiveInt(env.HF_MAX_CONCURRENT_REQUESTS, 1),
    maxProviderRetries: nonNegativeInt(env.HF_MAX_PROVIDER_RETRIES, 1),
    requestCooldownMs: nonNegativeInt(env.HF_REQUEST_COOLDOWN_MS, 5000),
    maxFramesPerRequest: positiveInt(env.HF_MAX_FRAMES_PER_REQUEST, 6),
    maxWindowMs: positiveInt(env.HF_MAX_WINDOW_MS, 4000),
    maxFrameWidth: positiveInt(env.HF_MAX_FRAME_WIDTH, 768),
    maxFrameHeight: positiveInt(env.HF_MAX_FRAME_HEIGHT, 768),
    maxRequestBodyBytes: positiveInt(env.HF_MAX_REQUEST_BODY_BYTES, 5000000),
    usageStatePath: env.HF_USAGE_STATE_PATH || ".darkquest/hf-usage.json"
  };
}

export function movementRecognitionHealth(env = process.env) {
  const config = loadMovementRecognitionConfig(env);
  return {
    ok: true,
    provider: config.provider,
    model: selectedMovementRecognitionModel || config.model,
    mode: config.mode,
    has_token: Boolean(config.token),
    cloud_enabled: config.cloudEnabled,
    token_exposed_to_frontend: false,
    analyze_endpoint_ready: true,
    live_call_enabled: Boolean(config.token && config.cloudEnabled),
    limits: {
      session: config.maxRequestsPerSession,
      day: config.maxRequestsPerDay,
      month: config.maxRequestsPerMonth,
      concurrent: config.maxConcurrentRequests,
      retries: config.maxProviderRetries
    },
    failed_candidates: [...failedMovementRecognitionCandidates]
  };
}

export function movementRecognitionUsageForRequest(env = process.env, options = {}) {
  const config = loadMovementRecognitionConfig(env);
  const limiter = usageLimiterForConfig(config, options);
  return {
    status: 200,
    json: limiter.getUsageSummary({
      sessionId: options.sessionId,
      now: options.now
    })
  };
}

export async function movementRecognitionResponseForRequest(body = {}, env = process.env, options = {}) {
  const startedAt = Date.now();
  const config = loadMovementRecognitionConfig(env);
  const allowedActions = sanitizeAllowedActions(body.allowed_actions);
  const limiter = usageLimiterForConfig(config, options);
  const limiterInput = {
    sessionId: options.sessionId || body.session_id || body.sessionId,
    now: startedAt,
    frames: Array.isArray(body.frames) ? body.frames : [],
    windowMs: body.window_ms ?? body.windowMs,
    bodyBytes: options.bodyBytes ?? body.__body_bytes ?? estimateRequestBodyBytes(body)
  };
  if (!options.mockResult) {
    const allowed = limiter.checkRequestAllowed(limiterInput);
    if (!allowed.ok) return limitResponseForRequest(allowed, startedAt, config);
  }
  if (!config.token && !options.mockResult) {
    return {
      status: 503,
      json: {
        schema_version: "canonical-movement-result.v1",
        movement_result_id: `movement_${startedAt}`,
        action_type: "uncertain",
        movement: "HF_TOKEN is not loaded. Restart the app; the launcher loads .env automatically.",
        short_label: "Uncertain",
        movement_key: "uncertain",
        gesture_tags: [],
        confidence: 0,
        reason: "HF_TOKEN is not configured on the server.",
        evidence: ["cloud recognition unavailable"],
        provider: config.provider,
        model: config.model,
        requested_model: config.model,
        returned_model: "",
        provider_model: "",
        prompt_version: MOVEMENT_NARRATION_PROMPT_VERSION,
        image_tokens: 0,
        retries: 0,
        latency_ms: Date.now() - startedAt,
        requires_confirmation: true
      }
    };
  }
  let requestBegun = false;
  try {
    if (!options.mockResult) {
      const begun = limiter.beginRequest(limiterInput);
      if (!begun.ok) return limitResponseForRequest(begun, startedAt, config);
      requestBegun = true;
      limiter.recordLogicalRequest(limiterInput);
    }
    const result = await analyzeMovementRecognition({
      frames: Array.isArray(body.frames) ? body.frames.slice(0, config.maxFrames) : [],
      allowedActions,
      currentStep: String(body.current_step || ""),
      zoneMetadata: body.zone_metadata || {},
      recentCorrections: sanitizeRecentCorrections(body.recent_corrections),
      previousContext: body.previous_context || {},
      userQuestion: safePromptText(body.user_question || body.question || ""),
      requestedResponseMode: normalizeRequestedResponseMode(body.requested_response_mode),
      interactionMode: normalizeInteractionMode(body.interaction_mode),
      modeGenerationId: Math.max(0, Math.round(Number(body.mode_generation_id || 0)))
    }, config, options);
    const requestedModel = result.requested_model || result.model || config.model;
    const returnedModel = result.returned_model || result.provider_model || "";
    return {
      status: 200,
      json: {
        schema_version: "canonical-movement-result.v1",
        movement_result_id: `movement_${startedAt}`,
        ...normalizeMovementRecognitionOutput(result, allowedActions),
        provider: result.provider || config.provider,
        model: requestedModel,
        requested_model: requestedModel,
        returned_model: returnedModel,
        provider_model: returnedModel,
        prompt_version: result.prompt_version || MOVEMENT_NARRATION_PROMPT_VERSION,
        image_tokens: result.image_tokens || 0,
        retries: result.retries ?? (result.failed_candidates?.length || 0),
        latency_ms: Date.now() - startedAt,
        requires_confirmation: true,
        failed_candidates: result.failed_candidates || []
      }
    };
  } catch (error) {
    if (error?.usageLimitCode === "hf_retry_limit_reached") {
      limiter.recordFailure({ sessionId: limiterInput.sessionId, now: startedAt, provider: config.provider, model: config.model, errorCode: error.usageLimitCode });
      const summary = limiter.getUsageSummary(limiterInput);
      return limitResponseForRequest({
        ok: false,
        status: 429,
        code: "hf_retry_limit_reached",
        message: HF_USAGE_LIMIT_MESSAGES.hf_retry_limit_reached,
        usage: {
          session_used: summary.session.used,
          session_limit: summary.session.limit,
          daily_used: summary.day.used,
          daily_limit: summary.day.limit,
          monthly_used: summary.month.used,
          monthly_limit: summary.month.limit
        },
        summary
      }, startedAt, config, error.failedCandidates || []);
    }
    const failedCandidates = error?.failedCandidates || [...failedMovementRecognitionCandidates];
    if (failedCandidates.length) {
      limiter.recordFailure({ sessionId: limiterInput.sessionId, now: startedAt, provider: config.provider, model: config.model, errorCode: failedCandidates[0]?.classification || "provider_error" });
    }
    const reachableButUnavailable = allFailuresReachableButUnavailable(failedCandidates);
    return {
      status: reachableButUnavailable ? 200 : 502,
      json: {
        schema_version: "canonical-movement-result.v1",
        movement_result_id: `movement_${startedAt}`,
        action_type: "uncertain",
        movement: reachableButUnavailable
          ? "AI provider is busy — try again in a moment."
          : `AI unavailable — try again or use local fallback. Reason: ${error?.message || "Movement recognition provider failed."}`,
        short_label: "Uncertain",
        movement_key: "uncertain",
        gesture_tags: [],
        confidence: reachableButUnavailable ? 0.25 : 0.35,
        reason: reachableButUnavailable
          ? "All configured VLM providers were busy or unavailable."
          : error?.message || "Movement recognition provider failed.",
        evidence: [reachableButUnavailable ? "provider_capacity_or_availability" : "provider_error"],
        provider: config.provider,
        model: config.model,
        requested_model: config.model,
        returned_model: "",
        provider_model: "",
        prompt_version: MOVEMENT_NARRATION_PROMPT_VERSION,
        image_tokens: 0,
        retries: failedCandidates.length,
        latency_ms: Date.now() - startedAt,
        requires_confirmation: true,
        failed_candidates: failedCandidates
      }
    };
  } finally {
    if (requestBegun) limiter.finishRequest({ sessionId: limiterInput.sessionId, now: Date.now() });
  }
}

export async function analyzeMovementRecognition(input, config = loadMovementRecognitionConfig(), options = {}) {
  if (options.mockResult) return options.mockResult;
  if (config.mode !== "vlm_frames") {
    throw new Error("Only vlm_frames mode is wired in this MVP; video_classification remains configurable for the next backend adapter.");
  }
  const candidates = modelCandidatesFor(config);
  const maxProviderRetries = config.maxProviderRetries ?? 1;
  const failures = [];
  for (const model of candidates) {
    try {
      const response = await callHuggingFaceVlmFrames(input, { ...config, model }, options);
      selectedMovementRecognitionModel = model;
      failedMovementRecognitionCandidates = failures;
      return {
        ...normalizeMovementRecognitionOutput(response, input.allowedActions),
        provider: config.provider,
        model,
        requested_model: model,
        returned_model: response.returned_model || response.provider_model || "",
        provider_model: response.provider_model || response.returned_model || "",
        prompt_version: response.prompt_version || MOVEMENT_NARRATION_PROMPT_VERSION,
        image_tokens: response.image_tokens || 0,
        retries: failures.length,
        failed_candidates: failures
      };
    } catch (error) {
      const failure = providerFailureFor(model, error);
      failures.push(failure);
      if (!isRetryableProviderFailure(error)) {
        failedMovementRecognitionCandidates = failures;
        error.failedCandidates = failures;
        throw error;
      }
      if (failures.length > maxProviderRetries) {
        failedMovementRecognitionCandidates = failures;
        const retryError = new Error(HF_USAGE_LIMIT_MESSAGES.hf_retry_limit_reached);
        retryError.usageLimitCode = "hf_retry_limit_reached";
        retryError.failedCandidates = failures;
        throw retryError;
      }
    }
  }
  failedMovementRecognitionCandidates = failures;
  const error = new Error(`No movement recognition model candidate worked: ${failures.map((item) => `${item.model}: ${item.reason}`).join("; ")}`);
  error.failedCandidates = failures;
  throw error;
}

export async function callHuggingFaceVlmFrames(input, config, options = {}) {
  const prompt = input.interactionMode === "conversation" || input.requestedResponseMode === "conversation" || input.userQuestion
    ? buildVisualConversationPrompt(input)
    : buildMovementRecognitionPrompt(input.allowedActions, input.currentStep, input.zoneMetadata, input.recentCorrections);
  const response = await callHuggingFaceRouter({
    model: config.model,
    token: config.token,
    cloudEnabled: config.cloudEnabled,
    prompt,
    frames: input.frames,
    mode: config.mode,
    fetch: options.fetch
  });
  const promptVersion = input.interactionMode === "conversation" || input.requestedResponseMode === "conversation" || input.userQuestion
    ? VISUAL_CONVERSATION_PROMPT_VERSION
    : MOVEMENT_NARRATION_PROMPT_VERSION;
  const parsed = parseProviderJson(response?.choices?.[0]?.message?.content ?? response);
  const returnedModel = typeof response?.model === "string" ? response.model : "";
  return {
    ...parsed,
    requested_model: config.model,
    returned_model: returnedModel,
    provider_model: returnedModel,
    prompt_version: promptVersion,
    image_tokens: imageTokensFromProviderResponse(response)
  };
}

export async function callHuggingFaceRouter({ model, token, cloudEnabled = true, prompt, frames = [], mode = "vlm_frames", fetch: fetchImpl } = {}) {
  if (cloudEnabled === false) {
    const error = new Error(HF_USAGE_LIMIT_MESSAGES.hf_cloud_disabled);
    error.usageLimitCode = "hf_cloud_disabled";
    throw error;
  }
  const send = fetchImpl || globalThis.fetch;
  if (typeof send !== "function") throw new Error("No server fetch implementation is available.");
  const body = buildHuggingFaceVlmRequestBody({ model, prompt, frames });
  const response = await send(ROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const hfResponseBody = await readResponseBody(response);
    throw hfRouterError({
      message: `Hugging Face router returned ${response.status}: ${hfResponseBody}`,
      status: response.status,
      body: hfResponseBody,
      diagnostics: routerRequestDiagnostics(body, { mode, tokenPresent: Boolean(token) })
    });
  }
  const payload = await response.json();
  if (payload?.code || payload?.error) {
    const hfResponseBody = JSON.stringify(payload);
    throw hfRouterError({
      message: `Hugging Face router returned provider error: ${hfResponseBody}`,
      status: response.status,
      body: hfResponseBody,
      diagnostics: routerRequestDiagnostics(body, { mode, tokenPresent: Boolean(token) })
    });
  }
  return payload;
}

export function buildHuggingFaceVlmRequestBody({ model, prompt, frames = [] } = {}) {
  return {
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: String(prompt || "") },
        ...frames.map((frame) => ({
          type: "image_url",
          image_url: {
            url: frameDataUri(frame)
          }
        }))
      ]
    }],
    stream: false
  };
}

export function describeHuggingFaceVlmRequestBody(body) {
  const content = body?.messages?.[0]?.content ?? [];
  const imageUrls = content
    .filter((item) => item?.type === "image_url")
    .map((item) => item.image_url?.url);
  const firstUrl = imageUrls[0];
  const firstBase64 = typeof firstUrl === "string" ? firstUrl.split(",")[1] ?? "" : "";
  const decoded = firstBase64 ? Buffer.from(firstBase64, "base64") : Buffer.alloc(0);
  const allowedTopLevelFields = new Set(["model", "messages", "stream"]);
  return {
    image_input_count: imageUrls.length,
    data_uri_prefix: typeof firstUrl === "string" && firstUrl.startsWith("data:image/"),
    first_image_mime: typeof firstUrl === "string" ? firstUrl.match(/^data:([^;]+);base64,/)?.[1] ?? "" : "",
    first_image_decoded_byte_length: decoded.length,
    first_8_bytes_hex: decoded.subarray(0, 8).toString("hex"),
    response_format_sent: Object.prototype.hasOwnProperty.call(body ?? {}, "response_format"),
    custom_top_level_fields: Object.keys(body ?? {}).filter((key) => !allowedTopLevelFields.has(key)),
    image_url_is_string: typeof firstUrl === "string"
  };
}

function sanitizeRecentCorrections(corrections = []) {
  if (!Array.isArray(corrections)) return [];
  return corrections.slice(-3).map((item) => ({
    original_movement: safePromptText(item?.original_movement),
    corrected_movement: safePromptText(item?.corrected_movement)
  })).filter((item) => item.original_movement || item.corrected_movement);
}

function safePromptText(value) {
  return String(value ?? "")
    .replace(/\b(named|identity|identified as|recognize(d)? as|male|female|man|woman|boy|girl|race|ethnicity|age)\b/gi, "[redacted]")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[media omitted]")
    .slice(0, 180);
}

function safePromptBlock(value, maxLength = 700) {
  let text = "";
  try {
    text = typeof value === "string" ? value : JSON.stringify(value || {});
  } catch {
    text = "";
  }
  return String(text)
    .replace(/\b(named|identity|identified as|recognize(d)? as|male|female|man|woman|boy|girl|race|ethnicity|age)\b/gi, "[redacted]")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[media omitted]")
    .slice(0, maxLength);
}

function normalizeInteractionMode(value) {
  return String(value || "") === "conversation" ? "conversation" : "observing";
}

function normalizeRequestedResponseMode(value) {
  return String(value || "") === "conversation" ? "conversation" : "movement_observation";
}

function recentCorrectionsPrompt(corrections = []) {
  const safeCorrections = sanitizeRecentCorrections(corrections);
  if (!safeCorrections.length) return "Recent user corrections, text only: none.";
  return [
    "Recent user corrections, text only:",
    ...safeCorrections.map((item) => `- Model said: '${item.original_movement || "Unspecified movement."}' User corrected: '${item.corrected_movement || "Unspecified correction."}'`),
    "Use these corrections only to improve movement wording. Do not identify the person."
  ].join("\n");
}

function imageTokensFromProviderResponse(response = {}) {
  return Number(response?.usage?.image_tokens ?? response?.usage?.prompt_tokens_details?.image_tokens ?? 0) || 0;
}

export function buildMovementRecognitionPrompt(allowedActions = MOVEMENT_RECOGNITION_ALLOWED_ACTIONS, currentStep = "", zoneMetadata = {}, recentCorrections = []) {
  return [
    "You are given a short sequence of webcam frames in order.",
    "Compare Frame 1, Frame 2, Frame 3, and Frame 4.",
    "Describe what changed over time.",
    "Focus only on visible movement/action.",
    "",
    "Output is open-ended movement narration, not a fixed action label.",
    "Allowed fallback type: uncertain.",
    `Context: ${currentStep || "movement_narration"}.`,
    `Zone metadata keys: ${Object.keys(zoneMetadata || {}).join(", ") || "none"}.`,
    recentCorrectionsPrompt(recentCorrections),
    "",
    "Return only JSON:",
    JSON.stringify({
      meaningful_change: true,
      movement_label: "shaka_sign",
      movement: "You raised your hand and made a shaka sign.",
      spoken_response: "You raised your hand and made a shaka sign.",
      short_label: "Shaka sign",
      movement_key: "shaka_sign",
      gesture_tags: ["hand_gesture", "thumb_extended", "pinky_extended", "hand_raised"],
      confidence: 0.84,
      reason: "The hand moved near the face and thumb/pinky were extended.",
      evidence: [
        "hand position changed across frames",
        "gesture formed near the face",
        "movement happened during capture window"
      ],
      evidence_frames: [1, 3, 4],
      uncertainty: false,
      requires_confirmation: true
    }),
    "",
    "Rules:",
    "- compare frames over time",
    "- identify which visible body part moved and whether a recognizable hand gesture occurred",
    "- identify whether an object was raised, lowered, picked up, placed down, or moved",
    "- evidence_frames must contain the one-based ordered frame numbers supporting the conclusion",
    "- when uncertain, report partial visible evidence in spoken_response instead of a generic failure sentence",
    "- prefer natural movement sentences such as \"You raised your hand.\", \"You opened your mouth.\", \"You moved closer to the camera.\", \"You pointed at the camera.\", or \"You picked up an object.\"",
    "- describe the movement, not the person",
    "- do not identify the person",
    "- do not describe sensitive attributes",
    "- do not judge appearance",
    "- avoid clothing/body judgments",
    "- focus only on movement/action",
    "- movement_key must be a conservative lowercase snake_case label for the observed movement",
    "- gesture_tags must contain only visible movement or gesture descriptors, never identity or sensitive attributes",
    "- if the frames look static or unclear, return movement as \"Uncertain — try again.\" and short_label as \"Uncertain\"",
    "- return concise JSON only",
    "- return confidence conservatively"
  ].join("\n");
}

export function buildVisualConversationPrompt(input = {}) {
  const question = safePromptText(input.userQuestion || "What do you see?");
  const context = safePromptBlock(input.previousContext);
  return [
    "You are Sensefield in Conversation mode.",
    "You are given current webcam frames as visual context and a spoken user question.",
    "Answer the user's question directly and naturally.",
    "Use the frames as supporting context; preserve recent textual references when helpful.",
    "Do not proactively narrate unrelated movement.",
    "Do not identify the person or infer sensitive attributes.",
    "If the answer is not visible or uncertain, say that briefly and ask the user to show it again.",
    "",
    `User question: ${question || "What do you see?"}`,
    `Recent conversation context, text only: ${context || "none"}`,
    "",
    "Return only JSON:",
    JSON.stringify({
      movement: "You're holding a dark-colored mug.",
      short_label: "Answer",
      movement_key: "conversation_answer",
      gesture_tags: [],
      confidence: 0.78,
      reason: "The object is visible in the current frames.",
      evidence: ["current frames support the answer"],
      uncertainty: false,
      requires_confirmation: true
    }),
    "",
    "Rules:",
    "- default to 1-4 conversational sentences and about 20-90 words",
    "- put the direct answer first and avoid unnecessary detail or markdown headings",
    "- longer answers are allowed only when the user explicitly asks for detail",
    "- answer the question, not a movement narration",
    "- use words like this, it, or before only when recent text context makes the reference clear",
    "- do not invent objects, colors, or actions that are not visible",
    "- do not describe identity, age, race, gender, or other sensitive attributes",
    "- if unsure, set uncertainty true and movement to \"I'm not completely sure. Try showing me again.\"",
    "- return concise JSON only",
    "- return confidence conservatively"
  ].join("\n");
}

export function normalizeMovementRecognitionOutput(raw = {}, allowedActions = MOVEMENT_RECOGNITION_ALLOWED_ACTIONS) {
  const movement = safeMovementSentence(raw.movement ?? raw.label ?? "");
  const actionType = LEGACY_MOVEMENT_ACTION_TYPES.includes(raw.action_type) ? raw.action_type : legacyActionTypeForMovement(movement);
  const shortLabel = safeShortLabel(raw.short_label ?? raw.label ?? labelForAction(actionType));
  return {
    schema_version: "canonical-movement-result.v1",
    action_type: actionType,
    movement,
    spoken_response: safeMovementSentence(raw.spoken_response || movement),
    meaningful_change: raw.meaningful_change === true,
    short_label: shortLabel,
    movement_key: safeMovementKey(raw.movement_key || shortLabel),
    movement_label: safeMovementKey(raw.movement_label || raw.movement_key || shortLabel),
    gesture_tags: safeGestureTags(raw.gesture_tags),
    confidence: clampNumber(raw.confidence, 0, 1, movement.startsWith("Uncertain") ? 0.35 : 0.5),
    reason: String(raw.reason || "No provider reason returned."),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String).slice(0, 5) : [],
    evidence_frames: Array.isArray(raw.evidence_frames) ? [...new Set(raw.evidence_frames.map(Number).filter((item) => Number.isInteger(item) && item >= 1 && item <= 8))].slice(0, 8) : [],
    uncertainty: Boolean(raw.uncertainty ?? movement.startsWith("Uncertain")),
    requires_confirmation: true
  };
}

function parseProviderJson(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        action_type: "uncertain",
        movement: "Uncertain — try again.",
        short_label: "Uncertain",
        confidence: 0.25,
        reason: "Provider did not return structured JSON.",
        evidence: ["invalid_provider_json"],
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
        confidence: 0.25,
        reason: "Provider JSON was not safely repairable.",
        evidence: ["invalid_provider_json"],
        requires_confirmation: true
      };
    }
  }
}

function modelCandidatesFor(config) {
  const candidates = config.modelCandidates?.length ? config.modelCandidates : [config.model];
  const unique = [...new Set(candidates.filter(Boolean))].slice(0, MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES);
  if (selectedMovementRecognitionModel && unique.includes(selectedMovementRecognitionModel)) {
    return [
      selectedMovementRecognitionModel,
      ...unique.filter((item) => item !== selectedMovementRecognitionModel)
    ];
  }
  return unique;
}

export function isRetryableProviderFailure(error) {
  return classifyProviderFailure(error) === "PROVIDER_REACHABLE_BUT_BUSY";
}

export function isProviderCapacityError(error) {
  return classifyProviderFailure(error) === "PROVIDER_REACHABLE_BUT_BUSY";
}

export function classifyProviderFailure(error) {
  const status = Number(error?.httpStatus ?? error?.status ?? 0);
  const message = providerFailureText(error);
  if (status === 401 || status === 403 || /invalid token|unauthorized|forbidden|authentication|auth/i.test(message)) {
    return "AUTH_FAILURE";
  }
  if (status >= 500) return "PROVIDER_REACHABLE_BUT_BUSY";
  if (
    status === 429 ||
    /queue_exceeded|too_many_requests_error|\bqueue\b|high traffic|temporarily unavailable|model loading|provider overloaded/i.test(message)
  ) {
    return "PROVIDER_REACHABLE_BUT_BUSY";
  }
  if (/invalid_image|invalid image|malformed image|corrupt image|bad image|invalid base64|bad base64|invalid data uri|payload mismatch/i.test(message)) {
    return "PAYLOAD_OR_IMAGE_FAILURE";
  }
  if (status === 404 || status === 422 || /unsupported|not found|model unavailable|provider unavailable|does not support|not currently available|unavailable/i.test(message)) {
    return "PROVIDER_MODEL_UNSUPPORTED";
  }
  if (status === 400) return "PAYLOAD_OR_IMAGE_FAILURE";
  return "PROVIDER_FAILURE";
}

function usageLimiterForConfig(config, options = {}) {
  if (options.usageLimiter) return options.usageLimiter;
  if ((options.fetch || options.mockResult) && options.enforceUsageLimits !== true) return {
    checkRequestAllowed: () => ({ ok: true }),
    beginRequest: () => ({ ok: true }),
    finishRequest: () => {},
    recordLogicalRequest: () => {},
    recordStart: () => {},
    recordSuccess: () => {},
    recordFailure: () => {},
    getUsageSummary: () => ({
      session: { used: 0, limit: Infinity },
      day: { used: 0, limit: Infinity },
      month: { used: 0, limit: Infinity }
    })
  };
  const limiterConfig = {
    projectRoot: options.projectRoot || process.cwd(),
    cloudEnabled: config.cloudEnabled,
    maxRequestsPerSession: config.maxRequestsPerSession,
    maxRequestsPerDay: config.maxRequestsPerDay,
    maxRequestsPerMonth: config.maxRequestsPerMonth,
    maxConcurrentRequests: config.maxConcurrentRequests,
    maxProviderRetries: config.maxProviderRetries,
    requestCooldownMs: config.requestCooldownMs,
    maxFramesPerRequest: config.maxFramesPerRequest,
    maxWindowMs: config.maxWindowMs,
    maxFrameWidth: config.maxFrameWidth,
    maxFrameHeight: config.maxFrameHeight,
    maxRequestBodyBytes: config.maxRequestBodyBytes,
    usageStatePath: config.usageStatePath
  };
  const cacheKey = JSON.stringify(limiterConfig);
  if (!usageLimiterCache.has(cacheKey)) usageLimiterCache.set(cacheKey, createUsageLimiter(limiterConfig));
  return usageLimiterCache.get(cacheKey);
}

function limitResponseForRequest(limit, startedAt, config, failedCandidates = []) {
  return {
    status: limit.status,
    json: {
      ok: false,
      code: limit.code,
      message: limit.message,
      usage: limit.usage,
      schema_version: "canonical-movement-result.v1",
      movement_result_id: `movement_${startedAt}`,
      action_type: "uncertain",
      movement: limit.message,
      short_label: "Uncertain",
      movement_key: "uncertain",
      gesture_tags: [],
      confidence: 0,
      reason: limit.message,
      evidence: [limit.code],
      provider: config.provider,
      model: config.model,
      requested_model: config.model,
      returned_model: "",
      provider_model: "",
      prompt_version: MOVEMENT_NARRATION_PROMPT_VERSION,
      image_tokens: 0,
      retries: failedCandidates.length,
      latency_ms: Date.now() - startedAt,
      requires_confirmation: true,
      failed_candidates: failedCandidates
    }
  };
}

function estimateRequestBodyBytes(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body || {}), "utf8");
  } catch {
    return 0;
  }
}

function providerFailureFor(model, error) {
  return {
    model,
    classification: classifyProviderFailure(error),
    reason: error?.message || "provider unavailable",
    http_status: error?.httpStatus ?? null,
    hf_response_body: error?.hfResponseBody ?? "",
    request_mode: error?.requestDiagnostics?.request_mode ?? "",
    image_input_count: error?.requestDiagnostics?.image_input_count ?? 0,
    any_image_input_starts_with_data_image: error?.requestDiagnostics?.any_image_input_starts_with_data_image ?? false,
    response_format_sent: error?.requestDiagnostics?.response_format_sent ?? false,
    custom_top_level_fields_sent: error?.requestDiagnostics?.custom_top_level_fields_sent ?? [],
    token_present: error?.requestDiagnostics?.token_present ?? false
  };
}

function providerFailureText(error) {
  return `${error?.message || ""} ${error?.hfResponseBody || ""} ${error?.body || ""}`.toLowerCase();
}

function allFailuresReachableButUnavailable(failures = []) {
  const reachable = new Set(["PROVIDER_REACHABLE_BUT_BUSY"]);
  return failures.length > 0 && failures.every((failure) => reachable.has(failure.classification));
}

function hfRouterError({ message, status, body, diagnostics }) {
  const error = new Error(message);
  error.httpStatus = status;
  error.hfResponseBody = body;
  error.requestDiagnostics = diagnostics;
  return error;
}

function routerRequestDiagnostics(body, { mode, tokenPresent }) {
  const content = body?.messages?.[0]?.content ?? [];
  const imageUrls = content
    .filter((item) => item?.type === "image_url")
    .map((item) => item.image_url?.url ?? "");
  const allowedTopLevelFields = new Set(["model", "messages", "stream"]);
  return {
    request_mode: mode,
    image_input_count: imageUrls.length,
    any_image_input_starts_with_data_image: imageUrls.some((url) => String(url).startsWith("data:image/")),
    response_format_sent: Object.prototype.hasOwnProperty.call(body ?? {}, "response_format"),
    custom_top_level_fields_sent: Object.keys(body ?? {}).filter((key) => !allowedTopLevelFields.has(key)),
    token_present: Boolean(tokenPresent)
  };
}

function frameDataUri(frame = {}) {
  const providedUrl = frame.data_uri ?? frame.dataUri ?? frame.url ?? frame.image_url?.url;
  if (typeof providedUrl === "string" && providedUrl.startsWith("data:image/")) return providedUrl;
  return `data:${frame.mime_type || "image/jpeg"};base64,${frame.encoded_frame || ""}`;
}

async function readResponseBody(response) {
  if (typeof response.text === "function") return response.text();
  if (typeof response.json === "function") return JSON.stringify(await response.json());
  return "";
}

function sanitizeAllowedActions(actions) {
  const filtered = Array.isArray(actions) ? actions.filter((action) => MOVEMENT_RECOGNITION_ALLOWED_ACTIONS.includes(action)) : [];
  return filtered.length ? filtered : MOVEMENT_RECOGNITION_ALLOWED_ACTIONS;
}

function labelForAction(actionType) {
  return {
    phone_moved: "Possible phone moved",
    notebook_opened: "Possible notebook opened",
    pen_picked_up: "Possible pen picked up",
    writing_motion: "Possible writing motion",
    typing_motion: "Possible typing motion",
    uncertain: "Uncertain"
  }[actionType] || "Uncertain";
}

function safeMovementSentence(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const unsafeIdentity = /\b(named|identity|identified as|recognize(d)? as|looks like|male|female|man|woman|boy|girl|race|ethnicity|age|clothing|shirt|pants|dress)\b/i;
  if (!text || unsafeIdentity.test(text)) return "Uncertain — try again.";
  if (/^uncertain\b/i.test(text)) return "Uncertain — try again.";
  const sentence = text.endsWith(".") || text.endsWith("!") || text.endsWith("?") ? text : `${text}.`;
  return sentence.length > 180 ? `${sentence.slice(0, 177).trim()}...` : sentence;
}

function safeShortLabel(value) {
  const text = String(value || "Movement").trim().replace(/\s+/g, " ");
  if (!text || /\b(named|identity|race|ethnicity|age)\b/i.test(text)) return "Uncertain";
  return text.length > 48 ? text.slice(0, 45).trim() : text;
}

function safeMovementKey(value) {
  return String(value || "movement")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "movement";
}

function safeGestureTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(safeMovementKey).filter((tag) => tag && !/identity|person|gender|race|ethnicity|age/.test(tag)))].slice(0, 12);
}

function legacyActionTypeForMovement(movement) {
  const text = String(movement || "").toLowerCase();
  if (/\b(type|typing|keyboard|keys)\b/.test(text)) return "typing_motion";
  if (/\b(write|writing|draw|drawing)\b/.test(text)) return "writing_motion";
  if (/\bpen|stylus\b/.test(text)) return "pen_picked_up";
  if (/\bnotebook|book|page\b/.test(text)) return "notebook_opened";
  if (/\bphone\b/.test(text)) return "phone_moved";
  return "uncertain";
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

function nonNegativeInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
