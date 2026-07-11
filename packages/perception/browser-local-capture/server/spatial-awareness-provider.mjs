import { createUsageLimiter } from "./hf-usage-limiter.mjs";
import { analyzeSpatialWindow } from "../../../../services/visual-companion/spatial-engine.mjs";
import {
  SPATIAL_CAPABILITIES,
  SPATIAL_LIMITS,
  sanitizeTextNumericData,
  spatialFailure,
  validateSpatialInput
} from "../../../../services/visual-companion/spatial-contract.mjs";

export const SPATIAL_ANALYZE_ROUTE = "/api/spatial-awareness/analyze";
export const SPATIAL_HEALTH_ROUTE = "/api/spatial-awareness/health";
const limiterCache = new Map();
const activeSessions = new Set();

export function loadSpatialAwarenessConfig(env = process.env) {
  return {
    serviceUrl: String(env.SPATIAL_SERVICE_URL || "http://127.0.0.1:8790/spatial-observations"),
    healthUrl: String(env.SPATIAL_HEALTH_URL || "http://127.0.0.1:8790/spatial-health"),
    timeoutMs: boundedInt(env.SPATIAL_TIMEOUT_MS, 500, 120000, 30000),
    maxFrames: boundedInt(env.HF_MAX_FRAMES_PER_REQUEST, 1, SPATIAL_LIMITS.maxFrames, 6),
    maxWindowMs: boundedInt(env.HF_MAX_WINDOW_MS, 250, 10000, 4000),
    maxFrameWidth: boundedInt(env.HF_MAX_FRAME_WIDTH, 64, 4096, 768),
    maxFrameHeight: boundedInt(env.HF_MAX_FRAME_HEIGHT, 64, 4096, 768),
    maxRequestBodyBytes: boundedInt(env.HF_MAX_REQUEST_BODY_BYTES, 1024, 16_000_000, SPATIAL_LIMITS.maxBodyBytes),
    maxRequestsPerSession: boundedInt(env.HF_MAX_REQUESTS_PER_SESSION, 1, 10000, 20),
    maxRequestsPerDay: boundedInt(env.HF_MAX_REQUESTS_PER_DAY, 1, 100000, 50),
    maxRequestsPerMonth: boundedInt(env.HF_MAX_REQUESTS_PER_MONTH, 1, 1000000, 100),
    requestCooldownMs: boundedInt(env.HF_REQUEST_COOLDOWN_MS, 0, 60000, 5000),
    usageStatePath: String(env.HF_USAGE_STATE_PATH || ".darkquest/hf-usage.json")
  };
}

export async function spatialAwarenessHealth(env = process.env, options = {}) {
  if (typeof options.healthResult === "object") return safeHealth(options.healthResult);
  const config = loadSpatialAwarenessConfig(env);
  const send = options.fetch || globalThis.fetch;
  if (typeof send !== "function") return safeHealth({ ready: false });
  try {
    const response = await send(config.healthUrl, { signal: timeoutSignal(Math.min(config.timeoutMs, 3000)) });
    const body = await response.json().catch(() => ({}));
    return safeHealth({ ready: response.ok && body?.ready === true, metric_scale_available: body?.metric_scale_available === true });
  } catch {
    return safeHealth({ ready: false });
  }
}

export async function spatialAwarenessResponseForRequest(body = {}, env = process.env, options = {}) {
  const config = loadSpatialAwarenessConfig(env);
  const sessionId = safeSessionId(options.sessionId || body.session_id || body.sessionId);
  if (!sessionId) return response(400, spatialFailure("spatial_session_invalid", "A valid session is required."));
  if (activeSessions.has(sessionId)) return response(409, spatialFailure("spatial_request_in_flight", "A spatial analysis is already running."));
  const normalizedInput = {
    frames: body.frames,
    timestamps: body.timestamps || body.frame_timestamps_ms,
    query: body.query ?? body.user_question ?? null,
    mode: body.mode || body.interaction_mode,
    calibration: body.calibration,
    previousScene: body.previousScene || body.previous_scene,
    bodyBytes: options.bodyBytes ?? body.__body_bytes
  };
  const limits = {
    ...SPATIAL_LIMITS,
    maxFrames: config.maxFrames,
    maxWidth: config.maxFrameWidth,
    maxHeight: config.maxFrameHeight,
    maxBodyBytes: config.maxRequestBodyBytes
  };
  const validation = validateSpatialInput(normalizedInput, limits);
  if (!validation.ok) return response(statusForFailure(validation.code), validation);

  const limiter = usageLimiter(config, options);
  const limiterInput = {
    sessionId,
    frames: validation.frames,
    windowMs: validation.timestamps.at(-1) - validation.timestamps[0],
    bodyBytes: validation.bodyBytes
  };
  const allowed = limiter.beginRequest(limiterInput);
  if (!allowed.ok) return response(allowed.status || 429, spatialFailure(allowed.code || "spatial_request_limited", "Spatial request limits are active."));

  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort("client_abort");
  externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  const timer = setTimeout(() => controller.abort("timeout"), config.timeoutMs);
  activeSessions.add(sessionId);
  try {
    const result = await analyzeSpatialWindow(validation, {
      limits,
      signal: controller.signal,
      observationProvider: options.observationProvider || ((providerInput) => requestSpatialObservations(providerInput, config, options, controller.signal))
    });
    if (result.ok) limiter.recordLogicalRequest({ sessionId });
    else limiter.recordFailure({ errorCode: result.code });
    return response(result.ok ? 200 : statusForFailure(result.code), result);
  } catch {
    limiter.recordFailure({ errorCode: "spatial_model_unavailable" });
    return response(503, spatialFailure());
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
    activeSessions.delete(sessionId);
    limiter.finishRequest();
    clearFramePayloads(body.frames);
  }
}

export function resetSpatialProviderStateForTests() {
  activeSessions.clear();
  limiterCache.clear();
}

async function requestSpatialObservations(input, config, options, signal) {
  const send = options.fetch || globalThis.fetch;
  if (typeof send !== "function") throw new Error("spatial service unavailable");
  const response = await send(config.serviceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      frames: input.frames,
      timestamps: input.timestamps,
      query: input.query,
      mode: input.mode,
      contains_raw_media: true
    }),
    signal
  });
  if (!response.ok) throw new Error("spatial service unavailable");
  const body = await response.json();
  if (!Array.isArray(body?.frame_observations)) throw new Error("spatial observations unavailable");
  return body.frame_observations;
}

function usageLimiter(config, options) {
  if (options.usageLimiter) return options.usageLimiter;
  if ((options.fetch || options.observationProvider) && options.enforceUsageLimits !== true) return noOpLimiter();
  const limiterConfig = {
    projectRoot: options.projectRoot || process.cwd(),
    cloudEnabled: true,
    maxRequestsPerSession: config.maxRequestsPerSession,
    maxRequestsPerDay: config.maxRequestsPerDay,
    maxRequestsPerMonth: config.maxRequestsPerMonth,
    maxConcurrentRequests: 1,
    maxProviderRetries: 0,
    requestCooldownMs: config.requestCooldownMs,
    maxFramesPerRequest: config.maxFrames,
    maxWindowMs: config.maxWindowMs,
    maxFrameWidth: config.maxFrameWidth,
    maxFrameHeight: config.maxFrameHeight,
    maxRequestBodyBytes: config.maxRequestBodyBytes,
    usageStatePath: config.usageStatePath
  };
  const key = JSON.stringify(limiterConfig);
  if (!limiterCache.has(key)) limiterCache.set(key, createUsageLimiter(limiterConfig));
  return limiterCache.get(key);
}

function noOpLimiter() {
  return { beginRequest: () => ({ ok: true }), recordLogicalRequest() {}, recordFailure() {}, finishRequest() {} };
}

function safeHealth(input) {
  return {
    ready: input?.ready === true,
    source: "local_spatial",
    capabilities: [...SPATIAL_CAPABILITIES],
    metric_scale_available: input?.metric_scale_available === true,
    contains_raw_media: false
  };
}

function clearFramePayloads(frames) {
  if (!Array.isArray(frames)) return;
  for (const frame of frames) {
    if (!frame || typeof frame !== "object") continue;
    for (const key of ["encoded_frame", "data_uri", "base64", "frame_bytes", "image_data"]) {
      if (key in frame) frame[key] = "";
    }
  }
  frames.length = 0;
}

function response(status, json) {
  return { status, json: sanitizeTextNumericData(json) };
}

function safeSessionId(value) {
  const clean = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(clean) ? clean : "";
}

function statusForFailure(code) {
  if (["spatial_timeout", "spatial_cancelled"].includes(code)) return 408;
  if (code === "spatial_request_in_flight") return 409;
  if (/limit|too_large|exceeded/.test(code)) return 413;
  if (/unavailable/.test(code)) return 503;
  return 400;
}

function boundedInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function timeoutSignal(ms) {
  return typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}
