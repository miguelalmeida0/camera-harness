const TEST_RUNTIME_FLAG = "SENSEFIELD_NEURAL_FIELD_TEST";

export function createReplaySafetyController(options = {}) {
  assertTestOnlyRuntime(options.testOnly === true);
  const maxDurationMs = boundedInteger(options.maxDurationMs, 30_000, 30_000);
  const maxEvents = boundedInteger(options.maxEvents, 512, 512);
  const now = options.now || (() => performance.now());
  const createObjectURL = options.createObjectURL || ((blob) => URL.createObjectURL(blob));
  const revokeObjectURL = options.revokeObjectURL || ((url) => URL.revokeObjectURL(url));
  let consentSequence = 0;
  let consent = null;
  let recording = null;
  let lastStopped = null;
  let lastStopReason = null;
  const objectUrls = new Set();
  const revokedUrls = [];

  function requestConsent() {
    consent = Object.freeze({ id: `replay_consent_${++consentSequence}`, granted: false });
    return consent.id;
  }

  function grantConsent(consentId, explicitUserAction) {
    if (!explicitUserAction || consent?.id !== consentId) throw new Error("explicit_replay_consent_required");
    consent = Object.freeze({ ...consent, granted: true });
    return consent.id;
  }

  function start(consentId, explicitUserAction) {
    if (!explicitUserAction || !consent?.granted || consent.id !== consentId) throw new Error("explicit_replay_consent_required");
    if (recording) throw new Error("replay_already_recording");
    recording = { consentId, startedAt: readNow(), events: [], stoppedAt: null, stopReason: null };
    lastStopped = null;
    lastStopReason = null;
  }

  function append(event) {
    if (!recording) return false;
    enforceDuration();
    if (!recording) return false;
    const safeEvent = sanitizeReplayEvent(event);
    if (recording.events.length >= maxEvents) recording.events.shift();
    recording.events.push(safeEvent);
    return true;
  }

  function enforceDuration() {
    if (recording && readNow() - recording.startedAt >= maxDurationMs) stop("duration_limit");
  }

  function stop(reason = "explicit_stop") {
    if (!recording) return false;
    recording.stoppedAt = readNow();
    recording.stopReason = safeReason(reason);
    lastStopped = recording;
    lastStopReason = recording.stopReason;
    recording = null;
    return true;
  }

  function save(explicitUserAction) {
    if (!explicitUserAction) throw new Error("explicit_replay_save_required");
    if (!lastStopped) throw new Error("replay_must_be_stopped_before_save");
    const payload = JSON.stringify({
      schema_version: "sensefield.neural-field.replay.v1",
      local_only: true,
      contains_raw_media: false,
      duration_ms: Math.min(maxDurationMs, Math.max(0, lastStopped.stoppedAt - lastStopped.startedAt)),
      stop_reason: lastStopped.stopReason,
      events: lastStopped.events
    });
    const blob = new Blob([payload], { type: "application/x-sensefield-replay+json" });
    revokeObjectUrls();
    const objectUrl = String(createObjectURL(blob));
    if (!objectUrl.startsWith("blob:")) throw new Error("local_replay_object_url_required");
    objectUrls.add(objectUrl);
    return Object.freeze({ objectUrl, bytes: blob.size, localOnly: true, containsRawMedia: false });
  }

  function discard() {
    stop("discarded");
    lastStopped = null;
    consent = null;
    lastStopReason = "discarded";
    revokeObjectUrls();
  }

  function stopForLifecycle(reason) {
    const stopped = stop(reason);
    lastStopped = null;
    lastStopReason = reason;
    consent = null;
    revokeObjectUrls();
    return stopped;
  }

  function revokeObjectUrls() {
    for (const objectUrl of objectUrls) {
      revokeObjectURL(objectUrl);
      revokedUrls.push(objectUrl);
    }
    objectUrls.clear();
  }

  function snapshot() {
    enforceDuration();
    return Object.freeze({
      consentRequested: Boolean(consent),
      consentGranted: Boolean(consent?.granted),
      recording: Boolean(recording),
      eventCount: recording?.events.length || lastStopped?.events.length || 0,
      stopReason: lastStopReason,
      activeObjectUrls: objectUrls.size,
      revokedObjectUrls: revokedUrls.length,
      maxDurationMs,
      localOnly: true,
      uploadRequests: 0,
      backgroundRecording: false
    });
  }

  return Object.freeze({
    requestConsent,
    grantConsent,
    start,
    append,
    tick: enforceDuration,
    stop,
    save,
    discard,
    onExit: () => stopForLifecycle("mode_exit"),
    onModeSwitch: () => stopForLifecycle("mode_switch"),
    onRecorderError: () => stopForLifecycle("recorder_stopped_unexpectedly"),
    snapshot
  });

  function readNow() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new Error("invalid_replay_clock");
    return value;
  }
}

function sanitizeReplayEvent(event) {
  const source = event && typeof event === "object" ? event : {};
  const eventType = String(source.event_type || "unknown").slice(0, 80);
  const safe = {
    event_type: isSensitiveString(eventType) ? "redacted" : eventType,
    timestamp_ms: Number.isFinite(source.timestamp_ms) ? source.timestamp_ms : 0,
    metadata: {}
  };
  for (const [key, value] of Object.entries(source.metadata || {})) {
    if (/frame|image|video|audio|microphone|camera|blob|buffer|base64|token|secret|model.*path/i.test(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    const safeValue = typeof value === "string" ? value.slice(0, 240) : value;
    if (typeof safeValue === "string" && isSensitiveString(safeValue)) continue;
    safe.metadata[key.slice(0, 80)] = safeValue;
  }
  safe.metadata = Object.freeze(safe.metadata);
  return Object.freeze(safe);
}

function isSensitiveString(value) {
  return /^(?:data:(?:image|video|audio)|blob:|[A-Za-z0-9+/]{512,}={0,2}$)|(?:Bearer\s+[A-Za-z0-9._~-]+|sk-[A-Za-z0-9_-]{8,}|api[_ -]?key|model[_ -]?path|\/Users\/|[A-Za-z]:\\)/i.test(value);
}

function safeReason(value) {
  const reason = String(value);
  return /^[a-z0-9_.-]{1,80}$/i.test(reason) ? reason : "safety_stop";
}

function boundedInteger(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.trunc(numeric), maximum));
}

function assertTestOnlyRuntime(explicitTestOnly) {
  const nodeTest = typeof process !== "undefined" && process.env?.[TEST_RUNTIME_FLAG] === "1";
  const browserTest = typeof location !== "undefined"
    && ["127.0.0.1", "localhost", "::1"].includes(location.hostname)
    && new URLSearchParams(location.search).get("sensefield-neural-field-test") === "1";
  if (!explicitTestOnly || (!nodeTest && !browserTest)) throw new Error("neural_field_test_contract_unavailable_in_production");
}
