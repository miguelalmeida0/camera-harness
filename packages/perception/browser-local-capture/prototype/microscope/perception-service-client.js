const ENDPOINTS = Object.freeze({
  capability: "/api/microscope/perception/capability",
  session: "/api/microscope/perception/session",
  detect: "/api/microscope/perception/detect",
  inspect: "/api/microscope/perception/inspect"
});

export function createPerceptionServiceClient(options = {}) {
  const send = options.fetch || globalThis.fetch?.bind(globalThis);
  const endpoints = { ...ENDPOINTS, ...(options.endpoints || {}) };
  let capability = unavailableCapability();
  const telemetry = {
    sessionStarts: 0,
    sessionPauses: 0,
    sessionStops: 0,
    detectionRequests: 0,
    inspectionRequests: 0,
    inspectionCacheHits: 0,
    failures: 0,
    remoteRequests: 0,
    lastLatencyMs: 0,
    lastDiagnostics: null
  };

  async function refreshCapability() {
    try {
      capability = normalizeCapability(await sendJson(endpoints.capability, null));
    } catch (error) {
      capability = unavailableCapability(error?.code);
    }
    return capability;
  }

  async function setSession(action, sessionId, energyMode = "efficient", requestOptions = {}) {
    if (!["start", "pause", "stop"].includes(action) || !safeSessionId(sessionId)) throw codedError("perception_session_invalid");
    const result = await sendJson(endpoints.session, { action, sessionId, energyMode }, requestOptions.signal);
    if (action === "start") telemetry.sessionStarts += 1;
    if (action === "pause") telemetry.sessionPauses += 1;
    if (action === "stop") telemetry.sessionStops += 1;
    telemetry.lastDiagnostics = result.diagnostics || telemetry.lastDiagnostics;
    return result;
  }

  async function detect(input = {}, requestOptions = {}) {
    if (!safeSessionId(input.sessionId) || !safeLocalImage(input.image)) throw codedError("local_frame_invalid");
    telemetry.detectionRequests += 1;
    const started = performanceNow();
    try {
      const result = await sendJson(endpoints.detect, {
        sessionId: input.sessionId,
        timestampMs: Math.max(0, Math.round(Number(input.timestampMs) || Date.now())),
        image: input.image,
        motionScore: clamp(input.motionScore, 0, 1),
        energyMode: input.energyMode === "balanced" ? "balanced" : "efficient"
      }, requestOptions.signal);
      telemetry.lastLatencyMs = performanceNow() - started;
      telemetry.lastDiagnostics = result.diagnostics || telemetry.lastDiagnostics;
      return Object.freeze({
        ok: result.ok === true,
        stale: result.stale === true,
        tracks: Object.freeze((Array.isArray(result.tracks) ? result.tracks : []).map(normalizeTrack).filter(Boolean)),
        diagnostics: Object.freeze({ ...(result.diagnostics || {}) })
      });
    } catch (error) {
      telemetry.failures += 1;
      throw error;
    }
  }

  async function inspect(input = {}, requestOptions = {}) {
    if (!safeSessionId(input.sessionId) || !/^object-[1-9][0-9]*$/.test(String(input.objectId || "")) || !safeLocalImage(input.image)) {
      throw codedError("local_inspection_invalid");
    }
    telemetry.inspectionRequests += 1;
    const started = performanceNow();
    try {
      const result = await sendJson(endpoints.inspect, {
        sessionId: input.sessionId,
        objectId: input.objectId,
        image: input.image,
        reason: automaticReason(input.reason),
        ocrRequested: input.ocrRequested === true,
        cropQuality: clamp(input.cropQuality, 0, 1)
      }, requestOptions.signal);
      telemetry.lastLatencyMs = performanceNow() - started;
      if (result.cached === true) telemetry.inspectionCacheHits += 1;
      return Object.freeze({
        ok: result.ok === true,
        cached: result.cached === true,
        attempts: Math.max(0, Number(result.attempts) || 0),
        result: Object.freeze({ ...(result.result || {}) }),
        track: normalizeTrack(result.track)
      });
    } catch (error) {
      telemetry.failures += 1;
      throw error;
    }
  }

  async function sendJson(url, body, signal) {
    if (typeof send !== "function") throw codedError("local_service_unreachable");
    if (!String(url).startsWith("/api/microscope/perception/")) throw codedError("remote_inference_blocked");
    const response = await send(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal
    });
    const payload = await safeJson(response);
    if (!response.ok) throw codedError(String(payload?.code || "local_perception_unavailable"));
    return payload;
  }

  return Object.freeze({
    get capability() { return capability; },
    detect,
    inspect,
    pauseSession: (sessionId, energyMode, options) => setSession("pause", sessionId, energyMode, options),
    refreshCapability,
    snapshotTelemetry: () => Object.freeze({ ...telemetry, remoteRequests: 0 }),
    startSession: (sessionId, energyMode, options) => setSession("start", sessionId, energyMode, options),
    stopSession: (sessionId, energyMode, options) => setSession("stop", sessionId, energyMode, options)
  });
}

function normalizeCapability(body = {}) {
  const state = body.capabilityState || {};
  return Object.freeze({
    ready: body.ready === true && state.localDetection === "ready" && state.tracking === "ready",
    localDetection: String(state.localDetection || "unavailable"),
    tracking: String(state.tracking || "unavailable"),
    semanticEnrichment: String(state.semanticEnrichment || "unconfigured"),
    models: Object.freeze({ ...(body.models || {}) }),
    vocabulary: Object.freeze(Array.isArray(body.vocabulary) ? body.vocabulary.map(String) : []),
    energy: Object.freeze({ ...(body.energy || {}) }),
    network: Object.freeze({ ...(body.network || {}), remoteRequests: 0 }),
    error: body.error || null
  });
}

function unavailableCapability(error = "local_service_unreachable") {
  return Object.freeze({
    ready: false,
    localDetection: "unavailable",
    tracking: "unavailable",
    semanticEnrichment: "unconfigured",
    models: Object.freeze({}),
    vocabulary: Object.freeze([]),
    energy: Object.freeze({}),
    network: Object.freeze({ localOnly: true, remoteInference: false, remoteRequests: 0 }),
    error
  });
}

function normalizeTrack(value) {
  if (!value || !/^object-[1-9][0-9]*$/.test(String(value.id || ""))) return null;
  const box = value.box || {};
  const normalizedBox = {
    x: clamp(box.x, 0, 1),
    y: clamp(box.y, 0, 1),
    width: clamp(box.width, 0, 1),
    height: clamp(box.height, 0, 1)
  };
  if (normalizedBox.width <= 0 || normalizedBox.height <= 0) return null;
  return Object.freeze({
    id: String(value.id),
    trackerId: Number(value.trackerId),
    label: clean(value.label, 80) || "unknown object",
    localLabel: clean(value.localLabel, 80) || "unknown object",
    confidence: clamp(value.confidence, 0, 1),
    source: clean(value.source, 80) || "yolo_world",
    box: Object.freeze(normalizedBox),
    state: ["new", "stable", "reacquired", "occluded"].includes(value.state) ? value.state : "stable",
    missedMs: Math.max(0, Number(value.missedMs) || 0),
    observations: Math.max(0, Number(value.observations) || 0),
    localCandidates: Object.freeze(Array.isArray(value.localCandidates) ? value.localCandidates.slice(0, 5).map((candidate) => Object.freeze({
      label: clean(candidate?.label, 80),
      confidence: clamp(candidate?.confidence, 0, 1),
      source: clean(candidate?.source, 80)
    })) : []),
    semantic: value.semantic ? Object.freeze({ ...value.semantic }) : null,
    locallyVerified: value.locallyVerified === true,
    semanticAttempts: Math.max(0, Number(value.semanticAttempts) || 0)
  });
}

function automaticReason(value) {
  const reason = String(value || "");
  return ["automatic_presented", "automatic_uncertain", "automatic_changed"].includes(reason)
    ? reason
    : "automatic_presented";
}

function safeLocalImage(value) {
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(value || ""));
}

function safeSessionId(value) {
  return /^microscope-[A-Za-z0-9_-]{6,80}$/.test(String(value || ""));
}

async function safeJson(response) {
  try { return await response.json(); } catch { return {}; }
}

function clean(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function performanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}
