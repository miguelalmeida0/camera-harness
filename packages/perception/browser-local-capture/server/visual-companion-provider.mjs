export const VISUAL_COMPANION_SCHEMA_VERSION = "contextual-visual-response.v1";
export const VISUAL_OBSERVATION_WINDOW_SCHEMA_VERSION = "visual-observation-window.v1";
export const VISUAL_COMPANION_PROVIDER_VERSION = "visual-companion-provider.v1";
export const DEFAULT_VISUAL_COMPANION_MODEL = "HuggingFaceTB/SmolVLM2-500M-Video-Instruct";
export const DEFAULT_VISUAL_COMPANION_MODEL_REVISION = "main";
export const DEFAULT_VISUAL_COMPANION_SERVICE_URL = "http://127.0.0.1:8766";
export const MAX_VISUAL_FRAMES = 8;
export const MAX_VISUAL_FRAME_BYTES = 512 * 1024;
export const MAX_VISUAL_REQUEST_BYTES = 5 * 1024 * 1024;
export const ALLOWED_VISUAL_SUGGESTED_ACTIONS = new Set([
  "start_timer",
  "speak_phrase",
  "browser_notification",
  "increment_counter",
  "append_activity_log"
]);

const DEFAULT_UNCERTAIN_RESPONSE = {
  schema_version: VISUAL_COMPANION_SCHEMA_VERSION,
  response_type: "uncertain",
  observation_summary: "The visual change was unclear.",
  spoken_response: "I'm not sure what changed. Try showing me again.",
  confidence: 0,
  uncertainty: true,
  question: "",
  suggested_actions: [],
  evidence: ["uncertain"],
  policy_decision: "uncertain",
  provider: "local_visual_companion",
  model: DEFAULT_VISUAL_COMPANION_MODEL,
  model_revision: DEFAULT_VISUAL_COMPANION_MODEL_REVISION,
  device: "unknown",
  latency_ms: 0,
  time_to_first_token_ms: 0,
  time_to_first_audio_ms: 0,
  contains_raw_media: false
};

export function loadVisualCompanionConfig(env = process.env) {
  return {
    provider: "local_visual_companion",
    serviceUrl: env.VISUAL_COMPANION_URL || DEFAULT_VISUAL_COMPANION_SERVICE_URL,
    model: env.VISUAL_COMPANION_MODEL || DEFAULT_VISUAL_COMPANION_MODEL,
    modelRevision: env.VISUAL_COMPANION_MODEL_REVISION || DEFAULT_VISUAL_COMPANION_MODEL_REVISION,
    mode: env.VISUAL_COMPANION_MODE || "local_smolvlm_frames",
    maxFrames: clampInt(env.VISUAL_COMPANION_MAX_FRAMES, 4, MAX_VISUAL_FRAMES, 6),
    windowMs: clampInt(env.VISUAL_COMPANION_WINDOW_MS, 2000, 4000, 2600),
    timeoutMs: clampInt(env.VISUAL_COMPANION_TIMEOUT_MS, 1000, 180000, 120000)
  };
}

export function visualCompanionStaticHealth(env = process.env) {
  const config = loadVisualCompanionConfig(env);
  return {
    ok: true,
    provider: config.provider,
    service_url: config.serviceUrl,
    model: config.model,
    model_revision: config.modelRevision,
    mode: config.mode,
    status: "configured",
    token_required: false,
    token_exposed_to_frontend: false,
    production_path_uses_hf_router: false,
    observe_endpoint_ready: true,
    contains_raw_media: false,
    voice_ready: false,
    voice_status: "not_checked",
    voice_engine: env.SENSEFIELD_VOICE_MODEL || "kokoro_82m",
    voice_model: env.SENSEFIELD_VOICE_MODEL || "kokoro_82m",
    voice_license: "Apache-2.0",
    voice_fallback_chain: ["kokoro_82m", "browser_speechSynthesis"]
  };
}

export async function visualCompanionHealth(env = process.env, options = {}) {
  const config = loadVisualCompanionConfig(env);
  const send = options.fetch || globalThis.fetch;
  if (typeof send !== "function") {
    return {
      ...visualCompanionStaticHealth(env),
      ok: false,
      status: "model_not_installed",
      safe_error: "Visual companion service is not reachable."
    };
  }
  try {
    const response = await send(`${config.serviceUrl.replace(/\/$/, "")}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: timeoutSignal(Math.min(config.timeoutMs, 8000))
    });
    const body = await safeJson(response);
    return {
      ...visualCompanionStaticHealth(env),
      ...safeServiceMetadata(body),
      ok: response.ok && body?.ok !== false,
      status: body?.status || (response.ok ? "ready" : "error"),
      observe_endpoint_ready: response.ok,
      token_exposed_to_frontend: false,
      production_path_uses_hf_router: false,
      contains_raw_media: false
    };
  } catch (error) {
    return {
      ...visualCompanionStaticHealth(env),
      ok: false,
      status: "model_not_installed",
      safe_error: "Visual companion service is not running.",
      observe_endpoint_ready: false,
      reason: error?.name === "TimeoutError" ? "timeout" : "service_unreachable"
    };
  }
}

export async function visualCompanionObserveResponseForRequest(body = {}, env = process.env, options = {}) {
  const startedAt = Date.now();
  const config = loadVisualCompanionConfig(env);
  try {
    const window = validateVisualObservationWindow(body, config);
    if (options.mockResult && options.testMode === true) {
      return {
        status: 200,
        json: normalizeContextualVisualResponse(options.mockResult, {
          provider: config.provider,
          model: config.model,
          modelRevision: config.modelRevision,
          latencyMs: Date.now() - startedAt,
          responseSource: "deterministic_test_fixture"
        })
      };
    }
    const send = options.fetch || globalThis.fetch;
    if (typeof send !== "function") throw new Error("Visual companion service fetch is unavailable.");
    const response = await send(`${config.serviceUrl.replace(/\/$/, "")}/observe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(window),
      signal: timeoutSignal(config.timeoutMs)
    });
    const payload = await safeJson(response);
    if (!response.ok) {
      return {
        status: response.status,
        json: normalizeContextualVisualResponse({
          ...DEFAULT_UNCERTAIN_RESPONSE,
          spoken_response: safeServiceError(payload) || "The local visual model is unavailable.",
          observation_summary: "The local visual model did not complete.",
          evidence: ["local_service_error"],
          confidence: 0,
          uncertainty: true,
          policy_decision: "uncertain"
        }, { provider: config.provider, model: config.model, modelRevision: config.modelRevision, latencyMs: Date.now() - startedAt })
      };
    }
    return {
      status: 200,
      json: normalizeContextualVisualResponse(payload, {
        provider: config.provider,
        model: payload?.model || config.model,
        modelRevision: payload?.model_revision || config.modelRevision,
        latencyMs: Date.now() - startedAt
      })
    };
  } catch (error) {
    return {
      status: error?.visual_companion_code === "request_too_large" ? 413 : 400,
      json: normalizeContextualVisualResponse({
        ...DEFAULT_UNCERTAIN_RESPONSE,
        spoken_response: safeVisualErrorMessage(error),
        observation_summary: "The observation window could not be analyzed.",
        evidence: [error?.visual_companion_code || "bad_request"],
        confidence: 0,
        uncertainty: true
      }, { provider: config.provider, model: config.model, modelRevision: config.modelRevision, latencyMs: Date.now() - startedAt })
    };
  } finally {
    clearVisualFramePayloads(body.frames);
  }
}

export async function visualCompanionSpeakResponseForRequest(body = {}, env = process.env, options = {}) {
  const startedAt = Date.now();
  const config = loadVisualCompanionConfig(env);
  const text = sanitizeText(body.text || body.spoken_response, 500);
  if (containsTtsRawMediaMarker(body)) {
    return {
      status: 400,
      json: localSpeechFallback("Voice synthesis accepts text only.", startedAt)
    };
  }
  if (!text) {
    return {
      status: 400,
      json: localSpeechFallback("No speakable text supplied.", startedAt, "visual_tts_empty")
    };
  }
  const send = options.fetch || globalThis.fetch;
  if (typeof send !== "function") {
    return { status: 200, json: localSpeechFallback("Visual voice service is not reachable.", startedAt) };
  }
  try {
    const response = await send(`${config.serviceUrl.replace(/\/$/, "")}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/wav, application/json" },
      body: JSON.stringify({
        text,
        observation_id: sanitizeText(body.observation_id, 120),
        voice: sanitizeText(body.voice || "sensefield_default", 80),
        style: sanitizeText(body.style || "warm_conversational", 80),
        contains_raw_media: false
      }),
      signal: timeoutSignal(config.timeoutMs)
    });
    const contentType = String(response.headers?.get?.("content-type") || "");
    if (response.ok && /^audio\//i.test(contentType)) {
      const audio = Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        contentType,
        body: audio,
        headers: {
          "cache-control": "no-store",
          "x-sensefield-voice-engine": response.headers?.get?.("x-sensefield-voice-engine") || "local_tts",
          "x-sensefield-voice-model": response.headers?.get?.("x-sensefield-voice-model") || "",
          "x-sensefield-voice-license": response.headers?.get?.("x-sensefield-voice-license") || "",
          "x-sensefield-time-to-first-audio-ms": response.headers?.get?.("x-sensefield-time-to-first-audio-ms") || "0",
          "x-sensefield-audio-duration-ms": response.headers?.get?.("x-sensefield-audio-duration-ms") || "0"
        }
      };
    }
    const payload = await safeJson(response);
    return {
      status: response.status,
      json: {
        ...localSpeechFallback(safeServiceError(payload) || "Natural voice unavailable — using system voice", startedAt),
        ...payload,
        contains_raw_media: false
      }
    };
  } catch (error) {
    return {
      status: 200,
      json: localSpeechFallback(error?.name === "TimeoutError" ? "Voice synthesis timed out." : "Visual voice service is not running.", startedAt)
    };
  }
}

export async function visualCompanionCancelResponseForRequest(env = process.env, options = {}) {
  const config = loadVisualCompanionConfig(env);
  const send = options.fetch || globalThis.fetch;
  if (typeof send !== "function") return { status: 200, json: { ok: true, cancelled: true, contains_raw_media: false } };
  try {
    const response = await send(`${config.serviceUrl.replace(/\/$/, "")}/cancel`, {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: timeoutSignal(2500)
    });
    const payload = await safeJson(response);
    return { status: response.status, json: { ok: response.ok, cancelled: true, ...payload, contains_raw_media: false } };
  } catch {
    return { status: 200, json: { ok: true, cancelled: true, contains_raw_media: false } };
  }
}

export function validateVisualObservationWindow(body = {}, config = loadVisualCompanionConfig()) {
  const frames = Array.isArray(body.frames) ? body.frames.slice(0, config.maxFrames) : [];
  if (frames.length < 1) throw visualCompanionError("No visual frames were captured.", "zero_frames");
  if (frames.length > MAX_VISUAL_FRAMES) throw visualCompanionError("Too many visual frames.", "too_many_frames");
  const normalizedFrames = frames.map((frame, index) => normalizeVisualFrame(frame, index));
  const serialized = JSON.stringify({ ...body, frames: normalizedFrames });
  if (Buffer.byteLength(serialized, "utf8") > MAX_VISUAL_REQUEST_BYTES) {
    throw visualCompanionError("Observation window is too large.", "request_too_large");
  }
  return {
    schema_version: VISUAL_OBSERVATION_WINDOW_SCHEMA_VERSION,
    frames: normalizedFrames,
    frame_timestamps_ms: normalizedFrames.map((frame) => frame.captured_at_ms),
    previous_context: sanitizeTextContext(body.previous_context),
    user_question: sanitizeText(body.user_question, 240),
    requested_response_mode: sanitizeResponseMode(body.requested_response_mode),
    interaction_mode: ["conversation", "observing"].includes(String(body.interaction_mode)) ? String(body.interaction_mode) : "observing",
    mode_generation_id: Math.max(0, Math.round(Number(body.mode_generation_id || 0))),
    client_scene_change_score: clamp01(body.client_scene_change_score),
    memory_mode: sanitizeMemoryMode(body.memory_mode),
    allowed_suggested_actions: [...ALLOWED_VISUAL_SUGGESTED_ACTIONS],
    contains_raw_media: false
  };
}

export function normalizeContextualVisualResponse(input = {}, defaults = {}) {
  const extracted = typeof input === "string" ? extractJsonObject(input) : input;
  const raw = extracted && typeof extracted === "object" ? extracted : {};
  const policy = applyContextualResponsePolicy(raw);
  return {
    schema_version: VISUAL_COMPANION_SCHEMA_VERSION,
    response_type: policy.response_type,
    observation_summary: sanitizeText(raw.observation_summary || raw.summary || DEFAULT_UNCERTAIN_RESPONSE.observation_summary, 500),
    spoken_response: sanitizeSpokenResponse(policy.spoken_response),
    confidence: clamp01(raw.confidence ?? policy.confidence),
    uncertainty: Boolean(policy.uncertainty),
    question: policy.response_type === "ask" ? sanitizeText(raw.question, 240) : "",
    suggested_actions: policy.response_type === "assist" ? sanitizeSuggestedActions(raw.suggested_actions) : [],
    evidence: sanitizeEvidence(raw.evidence),
    meaningful_change: raw.meaningful_change === true,
    movement_label: sanitizeMovementLabel(raw.movement_label),
    movement_key: sanitizeMovementLabel(raw.movement_key || raw.movement_label),
    gesture_tags: sanitizeGestureTags(raw.gesture_tags),
    evidence_frames: sanitizeEvidenceFrames(raw.evidence_frames),
    policy_decision: policy.response_type,
    provider: sanitizeText(raw.provider || defaults.provider || "local_visual_companion", 80),
    model: sanitizeText(raw.model || defaults.model || DEFAULT_VISUAL_COMPANION_MODEL, 160),
    model_revision: sanitizeText(raw.model_revision || defaults.modelRevision || DEFAULT_VISUAL_COMPANION_MODEL_REVISION, 80),
    device: sanitizeText(raw.device || defaults.device || "unknown", 80),
    latency_ms: Math.max(0, Math.round(raw.latency_ms ?? defaults.latencyMs ?? 0)),
    time_to_first_token_ms: Math.max(0, Math.round(raw.time_to_first_token_ms ?? 0)),
    time_to_first_audio_ms: Math.max(0, Math.round(raw.time_to_first_audio_ms ?? 0)),
    response_source: sanitizeResponseSource(raw.response_source || defaults.responseSource || "local_vlm"),
    contains_raw_media: false
  };
}

export function applyContextualResponsePolicy(raw = {}) {
  const confidence = clamp01(raw.confidence ?? 0);
  const spoken = sanitizeText(raw.spoken_response || raw.response || raw.movement || "", 500);
  const unsafe = containsUnsafeVisualInference(spoken) || containsUnsafeVisualInference(raw.observation_summary);
  if (unsafe) {
    return {
      response_type: "uncertain",
      spoken_response: "I'm not sure what changed. Try showing me again.",
      confidence: 0,
      uncertainty: true
    };
  }
  if (raw.no_meaningful_change === true || raw.response_type === "silent") {
    return {
      response_type: spoken ? "uncertain" : "silent",
      spoken_response: spoken || "The sampled frames looked similar, so I could not identify a completed movement.",
      confidence,
      uncertainty: true
    };
  }
  if (raw.uncertainty === true || confidence < 0.35 || raw.response_type === "uncertain") {
    return {
      response_type: "uncertain",
      spoken_response: spoken || "I could not confidently identify the completed movement.",
      confidence,
      uncertainty: true
    };
  }
  if (raw.response_type === "ask" && sanitizeText(raw.question, 240)) {
    return {
      response_type: "ask",
      spoken_response: spoken || sanitizeText(raw.question, 240),
      confidence,
      uncertainty: false
    };
  }
  if (Array.isArray(raw.suggested_actions) && sanitizeSuggestedActions(raw.suggested_actions).length > 0) {
    return {
      response_type: "assist",
      spoken_response: spoken || "I found a possible action. Confirm it if you want me to help.",
      confidence,
      uncertainty: false
    };
  }
  return {
    response_type: "narrate",
    spoken_response: spoken || "I saw a visible change.",
    confidence: confidence || 0.5,
    uncertainty: false
  };
}

export function extractJsonObject(text = "") {
  if (text && typeof text === "object") return text;
  const value = String(text || "").trim();
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function clearVisualFramePayloads(frames = []) {
  if (!Array.isArray(frames)) return [];
  for (const frame of frames) {
    if (frame && typeof frame === "object") {
      frame.encoded_frame = "";
      frame.data_uri = "";
    }
  }
  frames.length = 0;
  return frames;
}

function normalizeVisualFrame(frame = {}, index) {
  const dataUri = typeof frame.data_uri === "string" ? frame.data_uri : "";
  const encoded = typeof frame.encoded_frame === "string" ? frame.encoded_frame : dataUri.split(",")[1] || "";
  const mime = sanitizeMime(frame.mime_type || mimeFromDataUri(dataUri));
  if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) throw visualCompanionError("Camera frame could not be read.", "invalid_frame");
  const decodedBytes = Math.floor(encoded.length * 0.75);
  if (decodedBytes > MAX_VISUAL_FRAME_BYTES) throw visualCompanionError("Camera frame is too large.", "frame_too_large");
  return {
    frame_index: index,
    mime_type: mime,
    encoded_frame: encoded,
    captured_at_ms: Math.max(0, Math.round(frame.captured_at_ms ?? Date.now())),
    width: Math.max(0, Math.round(frame.width ?? 0)),
    height: Math.max(0, Math.round(frame.height ?? 0)),
    contains_raw_media: false
  };
}

function sanitizeSuggestedActions(actions = []) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((item) => item && typeof item === "object" && ALLOWED_VISUAL_SUGGESTED_ACTIONS.has(String(item.action || "")))
    .slice(0, 3)
    .map((item) => ({
      action: String(item.action),
      label: sanitizeText(item.label || item.action, 120),
      parameters: sanitizeActionParameters(item.parameters),
      requires_confirmation: true
    }));
}

function sanitizeActionParameters(parameters = {}) {
  const clean = {};
  if (!parameters || typeof parameters !== "object") return clean;
  if (Number.isFinite(Number(parameters.duration_seconds))) clean.duration_seconds = Math.max(1, Math.min(86400, Math.round(Number(parameters.duration_seconds))));
  if (typeof parameters.text === "string") clean.text = sanitizeText(parameters.text, 200);
  if (typeof parameters.counter_name === "string") clean.counter_name = sanitizeText(parameters.counter_name, 80);
  if (typeof parameters.category === "string") clean.category = sanitizeText(parameters.category, 80);
  if (typeof parameters.title === "string") clean.title = sanitizeText(parameters.title, 80);
  if (typeof parameters.body === "string") clean.body = sanitizeText(parameters.body, 200);
  return clean;
}

function containsUnsafeVisualInference(value = "") {
  return /\b(identity|identified as|age|race|ethnicity|religion|diagnos|depressed|angry|attractive|gender)\b/i.test(String(value || ""));
}

function isSafeOperationalVisualMessage(value = "") {
  return /\b(local visual model|visual reasoning|visual companion|cloud ai limit|daily cloud ai limit|model is not installed|model not installed|temporarily unavailable|local features remain available)\b/i.test(String(value || ""));
}

function sanitizeEvidence(evidence = []) {
  return Array.isArray(evidence)
    ? evidence.map((item) => sanitizeText(item, 180)).filter(Boolean).slice(0, 5)
    : [];
}

function sanitizeEvidenceFrames(value = []) {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter((item) => Number.isInteger(item) && item >= 1 && item <= MAX_VISUAL_FRAMES))].slice(0, MAX_VISUAL_FRAMES)
    : [];
}

function sanitizeMovementLabel(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 80) || null;
}

function sanitizeGestureTags(value = []) {
  const allowed = new Set(["thumbs_up", "thumbs_down", "peace_sign", "pointing_up", "open_palm", "closed_fist", "i_love_you", "heart"]);
  return Array.isArray(value)
    ? [...new Set(value.map(sanitizeMovementLabel).filter((item) => allowed.has(item)))].slice(0, 4)
    : [];
}

function sanitizeResponseSource(value = "") {
  const allowed = new Set(["local_detector", "local_vlm", "cloud_vlm", "deterministic_test_fixture", "unavailable"]);
  return allowed.has(String(value)) ? String(value) : "unavailable";
}

function sanitizeTextContext(context = {}) {
  const clean = {};
  if (!context || typeof context !== "object") return clean;
  for (const key of ["last_observation_summary", "last_response", "user_correction", "follow_up_answer", "approved_preferences"]) {
    if (context[key]) clean[key] = sanitizeText(context[key], 500);
  }
  return clean;
}

function safeServiceMetadata(body = {}) {
  return {
    model: sanitizeText(body.model, 160) || DEFAULT_VISUAL_COMPANION_MODEL,
    model_revision: sanitizeText(body.model_revision, 80) || DEFAULT_VISUAL_COMPANION_MODEL_REVISION,
    device: sanitizeText(body.device, 80) || "unknown",
    quantization: sanitizeText(body.quantization, 80) || "none",
    load_time_ms: Math.max(0, Math.round(body.load_time_ms || 0)),
    peak_memory_mb: Math.max(0, Math.round(body.peak_memory_mb || 0)),
    safe_error: sanitizeText(body.safe_error, 240),
    voice_ready: body.voice_ready === true,
    voice_status: sanitizeText(body.voice_status, 120),
    voice_engine: sanitizeText(body.voice_engine, 120),
    voice_model: sanitizeText(body.voice_model, 160),
    voice_license: sanitizeText(body.voice_license, 80),
    voice_safe_error: sanitizeText(body.voice_safe_error, 240),
    voice_fallback_chain: Array.isArray(body.voice_fallback_chain) ? body.voice_fallback_chain.map((item) => sanitizeText(item, 120)).filter(Boolean).slice(0, 4) : []
  };
}

function safeServiceError(body = {}) {
  return sanitizeText(body?.safe_error || body?.detail || body?.error, 240);
}

function safeVisualErrorMessage(error) {
  if (error?.visual_companion_code === "zero_frames") return "Camera frame could not be read. Try again.";
  if (error?.visual_companion_code === "request_too_large") return "The observation window was too large. Try again.";
  return error?.message || "The local visual model is unavailable.";
}

function visualCompanionError(message, code) {
  const error = new Error(message);
  error.visual_companion_code = code;
  return error;
}

function sanitizeResponseMode(value) {
  return ["narrate", "ask", "assist", "auto"].includes(String(value)) ? String(value) : "auto";
}

function sanitizeMemoryMode(value) {
  return ["off", "session", "persistent"].includes(String(value)) ? String(value) : "session";
}

function sanitizeMime(value) {
  return String(value || "").toLowerCase() === "image/png" ? "image/png" : "image/jpeg";
}

function mimeFromDataUri(value = "") {
  const match = String(value).match(/^data:([^;,]+);base64,/i);
  return match?.[1] || "image/jpeg";
}

function sanitizeText(value = "", maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeSpokenResponse(value = "") {
  return sanitizeText(value || DEFAULT_UNCERTAIN_RESPONSE.spoken_response, 500);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function clamp01(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function timeoutSignal(ms) {
  if (typeof AbortSignal?.timeout === "function") return AbortSignal.timeout(ms);
  return undefined;
}

function localSpeechFallback(message, startedAt, code = "local_voice_unavailable") {
  return {
    ok: false,
    engine: "browser_speech_fallback",
    code,
    voice_status: "Natural voice unavailable — using system voice",
    safe_error: sanitizeText(message, 240),
    audio_duration_ms: 0,
    time_to_first_audio_ms: 0,
    latency_ms: Date.now() - startedAt,
    contains_raw_media: false
  };
}

function containsTtsRawMediaMarker(value) {
  if (!value || typeof value !== "object") return typeof value === "string" && /data:(?:image|video|audio)\/|base64,/i.test(value);
  if (Array.isArray(value)) return value.some((item) => containsTtsRawMediaMarker(item));
  return Object.entries(value).some(([key, item]) => (
    /(encoded_frame|data_uri|frame|image|video|audio_blob|base64)/i.test(key) || containsTtsRawMediaMarker(item)
  ));
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
