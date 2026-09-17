export const LIVE_CONVERSATION_STATES = Object.freeze([
  "idle",
  "requesting_permissions",
  "listening",
  "finalizing_question",
  "thinking",
  "streaming_answer",
  "speaking",
  "complete",
  "interrupted",
  "error"
]);

const VALID_STATES = new Set(LIVE_CONVERSATION_STATES);
const MAX_TURNS = 40;

export function createLiveConversationState(options = {}) {
  return {
    status: VALID_STATES.has(options.status) ? options.status : "idle",
    turns: [],
    interimText: "",
    activeAssistant: null,
    error: null,
    voiceMuted: options.voiceMuted === true,
    listeningPaused: false,
    cameraContextActive: options.cameraContextActive === true,
    sessionGenerationId: Number(options.sessionGenerationId || 0),
    sequence: 0,
    revision: 0,
    announcement: "",
    lastFinalText: "",
    lastFinalAtMs: 0,
    metrics: {
      recognitionEventAtMs: 0,
      interimUpdatedAtMs: 0,
      userFinalizedAtMs: 0,
      thinkingStartedAtMs: 0,
      firstAssistantChunkAtMs: 0,
      assistantCompletedAtMs: 0
    }
  };
}

export function beginLiveConversation(target, options = {}) {
  Object.assign(target, createLiveConversationState({
    status: "requesting_permissions",
    voiceMuted: options.voiceMuted === true,
    cameraContextActive: false,
    sessionGenerationId: options.sessionGenerationId
  }));
  target.announcement = "Requesting microphone access.";
  touch(target);
  return target;
}

export function setLiveConversationListening(target, options = {}) {
  target.status = options.paused === true ? "idle" : "listening";
  target.listeningPaused = options.paused === true;
  target.cameraContextActive = options.cameraContextActive ?? target.cameraContextActive;
  target.error = null;
  target.announcement = options.paused === true ? "Listening paused." : "Listening.";
  touch(target);
  return target;
}

export function updateLiveInterim(target, text, atMs = Date.now()) {
  const clean = normalizeText(text);
  target.interimText = clean;
  target.status = "listening";
  target.error = null;
  target.metrics.recognitionEventAtMs = Number(atMs);
  target.metrics.interimUpdatedAtMs = Number(atMs);
  touch(target);
  return target;
}

export function finalizeLiveUserTurn(target, text, options = {}) {
  const clean = normalizeText(text);
  if (!clean) return null;
  const createdAtMs = Number(options.createdAtMs || Date.now());
  if (target.lastFinalText.toLowerCase() === clean.toLowerCase() && createdAtMs - target.lastFinalAtMs < 1500) {
    target.interimText = "";
    touch(target);
    return null;
  }
  const turn = {
    id: String(options.id || nextId(target, "user")),
    role: "user",
    text: clean,
    status: "complete",
    createdAtMs,
    cameraContext: options.cameraContext !== false
  };
  target.turns.push(turn);
  trimTurns(target);
  target.interimText = "";
  target.lastFinalText = clean;
  target.lastFinalAtMs = createdAtMs;
  target.status = "finalizing_question";
  target.error = null;
  target.metrics.userFinalizedAtMs = createdAtMs;
  target.announcement = `You said: ${clean}`;
  touch(target);
  return turn;
}

export function setLiveConversationThinking(target, options = {}) {
  target.status = "thinking";
  target.error = null;
  target.activeAssistant = {
    id: String(options.id || nextId(target, "assistant")),
    requestId: String(options.requestId || ""),
    text: "",
    createdAtMs: Number(options.createdAtMs || Date.now())
  };
  target.metrics.thinkingStartedAtMs = target.activeAssistant.createdAtMs;
  target.announcement = "Sensefield is thinking.";
  touch(target);
  return target.activeAssistant.id;
}

export function appendLiveAssistantChunk(target, chunk, options = {}) {
  const value = String(chunk || "");
  if (!value) return false;
  if (!target.activeAssistant) {
    setLiveConversationThinking(target, options);
  }
  if (options.requestId && target.activeAssistant.requestId &&
      String(options.requestId) !== target.activeAssistant.requestId) return false;
  target.activeAssistant.text += value;
  target.status = "streaming_answer";
  if (!target.metrics.firstAssistantChunkAtMs) {
    target.metrics.firstAssistantChunkAtMs = Number(options.atMs || Date.now());
  }
  touch(target);
  return true;
}

export function completeLiveAssistantTurn(target, text, options = {}) {
  const clean = normalizeText(text || target.activeAssistant?.text);
  if (!clean) return null;
  if (options.requestId && target.activeAssistant?.requestId &&
      String(options.requestId) !== target.activeAssistant.requestId) return null;
  const turn = {
    id: String(options.id || target.activeAssistant?.id || nextId(target, "assistant")),
    role: "assistant",
    text: clean,
    status: "complete",
    createdAtMs: Number(options.createdAtMs || Date.now()),
    cameraContext: options.cameraContext !== false,
    responseSource: String(options.responseSource || "")
  };
  const existing = target.turns.find((item) => item.id === turn.id);
  if (existing) Object.assign(existing, turn);
  else target.turns.push(turn);
  trimTurns(target);
  target.activeAssistant = null;
  target.status = options.willSpeak === true && !target.voiceMuted ? "speaking" : "complete";
  target.error = null;
  target.metrics.assistantCompletedAtMs = turn.createdAtMs;
  target.announcement = `Sensefield answered: ${clean}`;
  touch(target);
  return turn;
}

export function setLiveConversationSpeaking(target, speaking) {
  const hasCompletedAnswer = target.turns.some((turn) => turn.role === "assistant" && turn.status !== "interrupted");
  target.status = speaking ? "speaking" : hasCompletedAnswer ? "complete" : target.listeningPaused ? "idle" : "listening";
  target.announcement = speaking
    ? "Sensefield is speaking."
    : hasCompletedAnswer
      ? "Response complete."
      : target.listeningPaused
        ? "Listening paused."
        : "Listening.";
  touch(target);
  return target;
}

export function interruptLiveConversation(target, reason = "user_interruption") {
  const lastAssistant = [...target.turns].reverse().find((turn) => turn.role === "assistant");
  if (lastAssistant) {
    lastAssistant.status = "interrupted";
    lastAssistant.interruptionReason = String(reason);
  }
  target.activeAssistant = null;
  target.status = "interrupted";
  target.announcement = "Response stopped.";
  touch(target);
  return target;
}

export function failLiveConversation(target, error, options = {}) {
  target.status = "error";
  target.activeAssistant = null;
  target.error = {
    code: String(options.code || error?.code || "conversation_error"),
    message: normalizeText(typeof error === "string" ? error : error?.message) || "The conversation paused. Try again.",
    recoverable: options.recoverable !== false
  };
  target.announcement = target.error.message;
  touch(target);
  return target;
}

export function setLiveConversationMuted(target, muted) {
  target.voiceMuted = muted === true;
  if (target.voiceMuted && target.status === "speaking") target.status = target.listeningPaused ? "idle" : "listening";
  target.announcement = target.voiceMuted ? "Voice output muted." : "Voice output on.";
  touch(target);
  return target;
}

export function clearLiveConversation(target) {
  const status = target.listeningPaused ? "idle" : "listening";
  Object.assign(target, createLiveConversationState({
    status,
    voiceMuted: target.voiceMuted,
    cameraContextActive: target.cameraContextActive,
    sessionGenerationId: target.sessionGenerationId
  }));
  target.announcement = "Conversation cleared.";
  touch(target);
  return target;
}

export function recognitionUpdateFromEvent(event) {
  let interimText = "";
  let finalText = "";
  for (let index = Math.max(0, Number(event?.resultIndex || 0)); index < Number(event?.results?.length || 0); index += 1) {
    const result = event.results[index];
    const text = normalizeText(result?.[0]?.transcript || "");
    if (!text) continue;
    if (result?.isFinal) finalText += `${finalText ? " " : ""}${text}`;
    else interimText += `${interimText ? " " : ""}${text}`;
  }
  return { interimText: normalizeText(interimText), finalText: normalizeText(finalText) };
}

export function liveConversationStatusLabel(target) {
  return {
    idle: target.listeningPaused ? "Listening paused" : "Ready",
    requesting_permissions: "Requesting permission",
    listening: "Listening",
    finalizing_question: "Question received",
    thinking: "Thinking",
    streaming_answer: "Answering",
    speaking: "Speaking",
    complete: "Complete",
    interrupted: "Response stopped",
    error: "Needs attention"
  }[target.status] || "Ready";
}

export function chunkLiveAnswerText(value, maximumWords = 5) {
  const clean = normalizeText(value);
  if (!clean) return [];
  const limit = Math.max(3, Math.min(7, Number(maximumWords) || 5));
  const words = clean.split(" ");
  const chunks = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    const sentenceBoundary = /[.!?][”"')\]]?$/.test(word);
    const phraseBoundary = /[,;:][”"')\]]?$/.test(word) && current.length >= 3;
    if (sentenceBoundary || phraseBoundary || current.length >= limit) {
      chunks.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

function nextId(target, prefix) {
  target.sequence += 1;
  return `${prefix}-${target.sessionGenerationId || 0}-${target.sequence}`;
}

function trimTurns(target) {
  if (target.turns.length > MAX_TURNS) target.turns.splice(0, target.turns.length - MAX_TURNS);
}

function touch(target) {
  target.revision += 1;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
