const MODES = new Set(["conversation", "observing"]);

export function createEmergencyRuntimeController(options = {}) {
  let sequence = 0;
  let state = initialState(normalizeMode(options.selectedMode));

  function nextId(prefix) {
    sequence += 1;
    return `${prefix}_${Date.now()}_${sequence}`;
  }

  function snapshot() {
    return structuredCopy(state);
  }

  function beginStart(mode = state.selectedMode) {
    const selectedMode = normalizeMode(mode);
    state = {
      ...state,
      selectedMode,
      session: {
        status: "starting",
        sessionId: nextId("session"),
        sessionGeneration: state.session.sessionGeneration + 1,
        modeGeneration: state.session.modeGeneration + 1
      },
      media: { cameraActive: false, microphoneActive: false },
      runtime: initialRuntime(),
      currentTurn: initialCurrentTurn(),
      safeError: null
    };
    assertInvariants(state);
    return snapshot();
  }

  function activate(mode = state.selectedMode, capabilities = {}) {
    const selectedMode = normalizeMode(mode);
    if (state.session.status !== "starting" || state.selectedMode !== selectedMode) beginStart(selectedMode);
    const cameraActive = capabilities.cameraActive === true;
    const microphoneActive = selectedMode === "conversation" && capabilities.microphoneActive === true;
    state = {
      ...state,
      selectedMode,
      session: { ...state.session, status: "active" },
      media: { cameraActive, microphoneActive },
      runtime: {
        ...initialRuntime(),
        listening: selectedMode === "conversation" && microphoneActive,
        watching: selectedMode === "observing" && cameraActive,
        proactiveObservationActive: selectedMode === "observing" && cameraActive
      },
      safeError: null
    };
    assertInvariants(state);
    return snapshot();
  }

  function beginEnd() {
    state = {
      ...state,
      session: {
        ...state.session,
        status: "ending",
        sessionGeneration: state.session.sessionGeneration + 1,
        modeGeneration: state.session.modeGeneration + 1
      },
      runtime: initialRuntime(),
      currentTurn: initialCurrentTurn(),
      safeError: null
    };
    return snapshot();
  }

  function finishEnd() {
    state = {
      ...state,
      session: { ...state.session, status: "inactive", sessionId: null },
      media: { cameraActive: false, microphoneActive: false },
      runtime: initialRuntime(),
      currentTurn: initialCurrentTurn(),
      safeError: null
    };
    assertInvariants(state);
    return snapshot();
  }

  function endSession() {
    beginEnd();
    return finishEnd();
  }

  function failSession(error = "") {
    state = {
      ...state,
      session: {
        ...state.session,
        status: "error",
        sessionId: null,
        sessionGeneration: state.session.sessionGeneration + 1,
        modeGeneration: state.session.modeGeneration + 1
      },
      media: { cameraActive: false, microphoneActive: false },
      runtime: initialRuntime(),
      currentTurn: initialCurrentTurn(),
      safeError: safeError(error || "Runtime unavailable")
    };
    assertInvariants(state);
    return snapshot();
  }

  function deactivate(error = "") {
    return error ? failSession(error) : endSession();
  }

  function selectMode(mode) {
    const selectedMode = normalizeMode(mode);
    if (["active", "starting", "ending"].includes(state.session.status)) return switchMode(selectedMode);
    state = {
      ...state,
      selectedMode,
      session: { ...state.session, modeGeneration: state.session.modeGeneration + 1 },
      runtime: initialRuntime(),
      currentTurn: initialCurrentTurn(),
      safeError: null
    };
    return snapshot();
  }

  function switchMode(mode, capabilities = {}) {
    const selectedMode = normalizeMode(mode);
    if (!state.session.sessionId || !["active", "starting"].includes(state.session.status)) return selectMode(selectedMode);
    const cameraActive = capabilities.cameraActive === true || state.media.cameraActive;
    const microphoneActive = selectedMode === "conversation" && capabilities.microphoneActive === true;
    state = {
      ...state,
      selectedMode,
      session: { ...state.session, status: "starting", modeGeneration: state.session.modeGeneration + 1 },
      media: { cameraActive, microphoneActive },
      runtime: {
        ...initialRuntime(),
        listening: false,
        watching: false,
        proactiveObservationActive: false
      },
      currentTurn: initialCurrentTurn(),
      safeError: null
    };
    assertInvariants(state);
    return snapshot();
  }

  function setActiveCapabilities(capabilities = {}) {
    if (!["starting", "active"].includes(state.session.status)) return snapshot();
    const cameraActive = capabilities.cameraActive === true;
    const microphoneActive = state.selectedMode === "conversation" && capabilities.microphoneActive === true;
    state.session.status = "active";
    state.media = { cameraActive, microphoneActive };
    state.runtime.listening = state.selectedMode === "conversation" && microphoneActive && !state.runtime.speechInFlight;
    state.runtime.watching = state.selectedMode === "observing" && cameraActive;
    state.runtime.proactiveObservationActive = state.runtime.watching;
    assertInvariants(state);
    return snapshot();
  }

  function queueFinalTranscript(text, nowMs = Date.now()) {
    const clean = normalizeText(text);
    if (state.session.status !== "active" || state.selectedMode !== "conversation") return rejection("conversation_inactive");
    if (!clean) return rejection("empty_transcript");
    if (state.runtime.processingTranscript) return rejection("transcript_processing");
    if (state.runtime.lastFinalTranscript === clean.toLowerCase() && nowMs - state.runtime.lastFinalTranscriptAtMs < 1500) return rejection("duplicate_transcript");
    state.runtime.processingTranscript = true;
    try {
      const turn = token("user_turn", { text: clean, createdAtMs: nowMs });
      state.runtime.lastFinalTranscript = clean.toLowerCase();
      state.runtime.lastFinalTranscriptAtMs = nowMs;
      state.runtime.queuedUserTurn = turn;
      state.runtime.queuedVisualEvent = null;
      state.currentTurn = {
        ...initialCurrentTurn(),
        userText: clean,
        responseType: "conversation",
        createdAt: nowMs
      };
      state.safeError = null;
      return { ok: true, turn: structuredCopy(turn) };
    } finally {
      state.runtime.processingTranscript = false;
    }
  }

  function queueVisualEvent(event = {}) {
    if (state.session.status !== "active" || state.selectedMode !== "observing" || !state.runtime.proactiveObservationActive) return rejection("observing_inactive");
    if (state.runtime.queuedVisualEvent) return rejection("visual_event_already_queued");
    state.runtime.queuedVisualEvent = token("visual_event", { ...event });
    state.runtime.queuedUserTurn = null;
    state.safeError = null;
    return { ok: true, event: structuredCopy(state.runtime.queuedVisualEvent) };
  }

  function takeNextTask() {
    if (state.session.status !== "active" || state.runtime.inferenceInFlight || state.runtime.speechInFlight) return null;
    const task = state.selectedMode === "conversation" ? state.runtime.queuedUserTurn : state.runtime.queuedVisualEvent;
    if (!task) return null;
    state.runtime.queuedUserTurn = null;
    state.runtime.queuedVisualEvent = null;
    state.runtime.inferenceInFlight = true;
    state.runtime.thinking = true;
    state.runtime.activeRequestId = nextId("request");
    return structuredCopy({ ...task, requestId: state.runtime.activeRequestId });
  }

  function finishInference(task, error = "") {
    if (!isCurrent(task, "requestId", state.runtime.activeRequestId)) return false;
    state.runtime.inferenceInFlight = false;
    state.runtime.thinking = false;
    state.runtime.activeRequestId = null;
    state.safeError = error ? safeError(error) : null;
    assertInvariants(state);
    return true;
  }

  function setCurrentResponse(response = {}) {
    if (state.session.status !== "active") return false;
    const isObservation = state.selectedMode === "observing";
    state.currentTurn = {
      ...state.currentTurn,
      assistantText: isObservation ? "" : normalizeResponseText(response.text),
      observationText: isObservation ? normalizeResponseText(response.text) : "",
      responseType: isObservation ? "observation" : "conversation",
      confidence: Number.isFinite(Number(response.confidence)) ? Number(response.confidence) : null,
      createdAt: response.createdAt || Date.now(),
      speechStatus: "idle"
    };
    state.safeError = null;
    return true;
  }

  function clearCurrentTurn() {
    state.currentTurn = initialCurrentTurn();
    return snapshot();
  }

  function recordMoment(mode, entry = {}) {
    const selectedMode = normalizeMode(mode);
    const text = normalizeResponseText(entry.text);
    if (!text) return false;
    const key = selectedMode === "conversation" ? "conversationMoments" : "observationMoments";
    const id = String(entry.id || `${entry.role || "moment"}_${entry.createdAt || Date.now()}_${text}`);
    if (state.persistentMemory[key].some((item) => item.id === id)) return false;
    const createdAt = Number(entry.createdAt || Date.now());
    if (selectedMode === "observing" && state.persistentMemory[key].some((item) => (
      item.text.toLocaleLowerCase() === text.toLocaleLowerCase()
      && Math.abs(createdAt - item.createdAt) <= 15000
    ))) return false;
    state.persistentMemory[key].push({
      id,
      role: String(entry.role || (selectedMode === "conversation" ? "SENSEFIELD" : "MOVEMENT")),
      text,
      createdAt
    });
    state.persistentMemory[key] = state.persistentMemory[key].slice(-20);
    return true;
  }

  function beginSpeech() {
    if (state.session.status !== "active" || state.runtime.speechInFlight) return null;
    state.runtime.speechInFlight = true;
    state.runtime.speechStarted = false;
    state.runtime.activeSpeechId = nextId("speech");
    state.currentTurn.speechStatus = "preparing";
    return token("speech", { speechId: state.runtime.activeSpeechId });
  }

  function markSpeechStarted(tokenValue) {
    if (!isCurrent(tokenValue, "speechId", state.runtime.activeSpeechId)) return false;
    state.runtime.speechStarted = true;
    state.runtime.listening = false;
    state.currentTurn.speechStatus = "speaking";
    assertInvariants(state);
    return true;
  }

  function finishSpeech(tokenValue, outcome = {}) {
    if (!isCurrent(tokenValue, "speechId", state.runtime.activeSpeechId)) return false;
    const completed = outcome.completed === true && state.runtime.speechStarted === true;
    state.runtime.speechInFlight = false;
    state.runtime.speechStarted = false;
    state.runtime.activeSpeechId = null;
    state.runtime.listening = state.selectedMode === "conversation" && state.media.microphoneActive;
    state.currentTurn.speechStatus = completed ? "complete" : "unavailable";
    state.safeError = completed || state.selectedMode === "observing"
      ? null
      : safeError(outcome.error || "Voice unavailable");
    assertInvariants(state);
    return completed;
  }

  function cancelSpeech(error = "") {
    const ownedSpeech = state.runtime.speechInFlight || state.runtime.activeSpeechId;
    state.runtime.speechInFlight = false;
    state.runtime.speechStarted = false;
    state.runtime.activeSpeechId = null;
    state.runtime.listening = state.session.status === "active" && state.selectedMode === "conversation" && state.media.microphoneActive;
    if (ownedSpeech) {
      state.currentTurn.speechStatus = error ? "unavailable" : "idle";
      state.safeError = error && state.selectedMode !== "observing" ? safeError(error) : null;
    }
    assertInvariants(state);
    return snapshot();
  }

  function heartbeat(timestampMs = Date.now()) {
    state.runtime.detectorHeartbeatAtMs = Number(timestampMs) || Date.now();
    return state.runtime.detectorHeartbeatAtMs;
  }

  function isCurrent(value, idKey, activeId) {
    return Boolean(value && value[idKey] === activeId &&
      value.sessionGeneration === state.session.sessionGeneration &&
      value.modeGeneration === state.session.modeGeneration &&
      value.mode === state.selectedMode);
  }

  function token(type, payload) {
    return {
      type,
      ...payload,
      sessionGeneration: state.session.sessionGeneration,
      modeGeneration: state.session.modeGeneration,
      mode: state.selectedMode
    };
  }

  return Object.freeze({
    activate,
    beginEnd,
    beginSpeech,
    beginStart,
    cancelSpeech,
    clearCurrentTurn,
    deactivate,
    endSession,
    failSession,
    finishEnd,
    finishInference,
    finishSpeech,
    heartbeat,
    isCurrent,
    markSpeechStarted,
    queueFinalTranscript,
    queueVisualEvent,
    recordMoment,
    selectMode,
    setActiveCapabilities,
    setCurrentResponse,
    snapshot,
    switchMode,
    takeNextTask
  });
}

export function assertEmergencyRuntimeInvariants(state) {
  return assertInvariants(state);
}

function initialState(selectedMode = "conversation") {
  return {
    selectedMode,
    session: { status: "inactive", sessionId: null, sessionGeneration: 0, modeGeneration: 0 },
    media: { cameraActive: false, microphoneActive: false },
    runtime: initialRuntime(),
    currentTurn: initialCurrentTurn(),
    persistentMemory: { conversationMoments: [], observationMoments: [] },
    safeError: null
  };
}

function initialRuntime() {
  return {
    listening: false,
    watching: false,
    thinking: false,
    proactiveObservationActive: false,
    inferenceInFlight: false,
    speechInFlight: false,
    speechStarted: false,
    processingTranscript: false,
    activeRequestId: null,
    activeSpeechId: null,
    queuedUserTurn: null,
    queuedVisualEvent: null,
    lastFinalTranscript: "",
    lastFinalTranscriptAtMs: 0,
    detectorHeartbeatAtMs: 0
  };
}

function initialCurrentTurn() {
  return {
    userText: "",
    assistantText: "",
    observationText: "",
    responseType: null,
    confidence: null,
    createdAt: null,
    speechStatus: "idle"
  };
}

function assertInvariants(value) {
  if (!value?.session || !value?.runtime || !value?.media) throw new Error("runtime_state_shape_invalid");
  if (value.runtime.listening && value.runtime.proactiveObservationActive) throw new Error("runtime_listening_observing_conflict");
  if (value.selectedMode === "conversation" && value.runtime.proactiveObservationActive) throw new Error("runtime_conversation_observer_conflict");
  if (value.selectedMode === "observing" && (value.media.microphoneActive || value.runtime.listening)) throw new Error("runtime_observing_microphone_conflict");
  if (!value.runtime.inferenceInFlight && value.runtime.activeRequestId) throw new Error("runtime_request_owner_conflict");
  if (!value.runtime.speechInFlight && value.runtime.activeSpeechId) throw new Error("runtime_speech_owner_conflict");
  return true;
}

function normalizeMode(mode) {
  return MODES.has(String(mode)) ? String(mode) : "conversation";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function normalizeResponseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 4000);
}

function safeError(value) {
  return String(value || "").replace(/(?:hf_|sk-)[a-z0-9_-]+/gi, "[redacted]").slice(0, 240);
}

function rejection(code) {
  return { ok: false, code };
}

function structuredCopy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
