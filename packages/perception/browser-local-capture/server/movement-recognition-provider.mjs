export const MOVEMENT_RECOGNITION_ALLOWED_ACTIONS = ["uncertain"];
const LEGACY_MOVEMENT_ACTION_TYPES = ["phone_moved", "notebook_opened", "pen_picked_up", "writing_motion", "typing_motion", "uncertain"];
export const MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES = 5;
export const MOVEMENT_NARRATION_PROMPT_VERSION = "movement-narration-prompt.v2";

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
    token: env.HF_TOKEN || ""
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
    token_exposed_to_frontend: false,
    analyze_endpoint_ready: true,
    live_call_enabled: Boolean(config.token),
    failed_candidates: [...failedMovementRecognitionCandidates]
  };
}

export async function movementRecognitionResponseForRequest(body = {}, env = process.env, options = {}) {
  const startedAt = Date.now();
  const config = loadMovementRecognitionConfig(env);
  const allowedActions = sanitizeAllowedActions(body.allowed_actions);
  if (!config.token && !options.mockResult) {
    return {
      status: 503,
      json: {
        action_type: "uncertain",
        movement: "HF_TOKEN is not loaded. Restart the app after sourcing .env.",
        short_label: "Uncertain",
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
  try {
    const result = await analyzeMovementRecognition({
      frames: Array.isArray(body.frames) ? body.frames.slice(0, config.maxFrames) : [],
      allowedActions,
      currentStep: String(body.current_step || ""),
      zoneMetadata: body.zone_metadata || {},
      recentCorrections: sanitizeRecentCorrections(body.recent_corrections)
    }, config, options);
    const requestedModel = result.requested_model || result.model || config.model;
    const returnedModel = result.returned_model || result.provider_model || "";
    return {
      status: 200,
      json: {
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
    const failedCandidates = error?.failedCandidates || [...failedMovementRecognitionCandidates];
    const reachableButUnavailable = allFailuresReachableButUnavailable(failedCandidates);
    return {
      status: reachableButUnavailable ? 200 : 502,
      json: {
        action_type: "uncertain",
        movement: reachableButUnavailable
          ? "AI provider is busy — try again in a moment."
          : `AI unavailable — try again or use local fallback. Reason: ${error?.message || "Movement recognition provider failed."}`,
        short_label: "Uncertain",
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
  }
}

export async function analyzeMovementRecognition(input, config = loadMovementRecognitionConfig(), options = {}) {
  if (options.mockResult) return options.mockResult;
  if (config.mode !== "vlm_frames") {
    throw new Error("Only vlm_frames mode is wired in this MVP; video_classification remains configurable for the next backend adapter.");
  }
  const candidates = modelCandidatesFor(config);
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
    }
  }
  failedMovementRecognitionCandidates = failures;
  const error = new Error(`No movement recognition model candidate worked: ${failures.map((item) => `${item.model}: ${item.reason}`).join("; ")}`);
  error.failedCandidates = failures;
  throw error;
}

export async function callHuggingFaceVlmFrames(input, config, options = {}) {
  const response = await callHuggingFaceRouter({
    model: config.model,
    token: config.token,
    prompt: buildMovementRecognitionPrompt(input.allowedActions, input.currentStep, input.zoneMetadata, input.recentCorrections),
    frames: input.frames,
    mode: config.mode,
    fetch: options.fetch
  });
  const parsed = parseProviderJson(response?.choices?.[0]?.message?.content ?? response);
  const returnedModel = typeof response?.model === "string" ? response.model : "";
  return {
    ...parsed,
    requested_model: config.model,
    returned_model: returnedModel,
    provider_model: returnedModel,
    prompt_version: MOVEMENT_NARRATION_PROMPT_VERSION,
    image_tokens: imageTokensFromProviderResponse(response)
  };
}

export async function callHuggingFaceRouter({ model, token, prompt, frames = [], mode = "vlm_frames", fetch: fetchImpl } = {}) {
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
      movement: "You raised your hand and made a shaka sign.",
      short_label: "Shaka sign",
      confidence: 0.84,
      reason: "The hand moved near the face and thumb/pinky were extended.",
      evidence: [
        "hand position changed across frames",
        "gesture formed near the face",
        "movement happened during capture window"
      ],
      uncertainty: false,
      requires_confirmation: true
    }),
    "",
    "Rules:",
    "- compare frames over time",
    "- prefer natural movement sentences such as \"You raised your hand.\", \"You opened your mouth.\", \"You moved closer to the camera.\", \"You pointed at the camera.\", or \"You picked up an object.\"",
    "- describe the movement, not the person",
    "- do not identify the person",
    "- do not describe sensitive attributes",
    "- do not judge appearance",
    "- avoid clothing/body judgments",
    "- focus only on movement/action",
    "- if the frames look static or unclear, return movement as \"Uncertain — try again.\" and short_label as \"Uncertain\"",
    "- return concise JSON only",
    "- return confidence conservatively"
  ].join("\n");
}

export function normalizeMovementRecognitionOutput(raw = {}, allowedActions = MOVEMENT_RECOGNITION_ALLOWED_ACTIONS) {
  const movement = safeMovementSentence(raw.movement ?? raw.label ?? "");
  const actionType = LEGACY_MOVEMENT_ACTION_TYPES.includes(raw.action_type) ? raw.action_type : legacyActionTypeForMovement(movement);
  return {
    action_type: actionType,
    movement,
    short_label: safeShortLabel(raw.short_label ?? raw.label ?? labelForAction(actionType)),
    confidence: clampNumber(raw.confidence, 0, 1, movement.startsWith("Uncertain") ? 0.35 : 0.5),
    reason: String(raw.reason || "No provider reason returned."),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String).slice(0, 5) : [],
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
  return ["PROVIDER_REACHABLE_BUT_BUSY", "PROVIDER_MODEL_UNSUPPORTED"].includes(classifyProviderFailure(error));
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
  if (
    status === 429 ||
    /queue_exceeded|too_many_requests_error|\bqueue\b|high traffic|temporarily unavailable|model loading|provider overloaded/i.test(message)
  ) {
    return "PROVIDER_REACHABLE_BUT_BUSY";
  }
  if (/invalid_image|invalid image|malformed image|corrupt image|bad image|invalid base64|bad base64|invalid data uri|payload mismatch/i.test(message)) {
    return "PAYLOAD_OR_IMAGE_FAILURE";
  }
  if (
    status === 404 ||
    status === 422 ||
    status === 503 ||
    /unsupported|not found|model unavailable|provider unavailable|does not support|not currently available|unavailable/i.test(message)
  ) {
    return "PROVIDER_MODEL_UNSUPPORTED";
  }
  if (status === 400) return "PAYLOAD_OR_IMAGE_FAILURE";
  if (status >= 500) return "PROVIDER_REACHABLE_BUT_BUSY";
  return "PROVIDER_FAILURE";
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
  const reachable = new Set(["PROVIDER_REACHABLE_BUT_BUSY", "PROVIDER_MODEL_UNSUPPORTED"]);
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

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
