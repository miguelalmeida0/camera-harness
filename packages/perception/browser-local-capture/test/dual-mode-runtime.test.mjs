import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertInteractionStateInvariant,
  createInitialState,
  endInteractionSession,
  handleRealtimeUserSpeechTurn,
  scheduleRealtimeVisualEvent,
  setInteractionModeInState,
  startRealtimeConversation,
  startRealtimeObserving,
  visualContextForRequest
} from "../prototype/local-capture.js";

const html = readFileSync(resolve("packages/perception/browser-local-capture/prototype/index.html"), "utf8");
const source = readFileSync(resolve("packages/perception/browser-local-capture/prototype/local-capture.js"), "utf8");
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const advancedTemplateStart = bodyHtml.indexOf('<template id="advancedViewTemplate">');
const primaryHtml = advancedTemplateStart >= 0 ? bodyHtml.slice(0, advancedTemplateStart) : bodyHtml;

function fakeTrack(kind) {
  return {
    kind,
    readyState: "live",
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    }
  };
}

function fakeStream({ audio = true, video = true } = {}) {
  const tracks = [];
  if (video) tracks.push(fakeTrack("video"));
  if (audio) tracks.push(fakeTrack("audio"));
  return {
    tracks,
    getTracks() {
      return this.tracks;
    },
    getAudioTracks() {
      return this.tracks.filter((track) => track.kind === "audio");
    },
    addTrack(track) {
      this.tracks.push(track);
    }
  };
}

class FakeSpeechRecognition {
  static instances = [];
  constructor() {
    FakeSpeechRecognition.instances.push(this);
    this.continuous = false;
    this.interimResults = false;
    this.started = false;
    this.aborted = false;
    this.stopped = false;
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  abort() {
    this.aborted = true;
  }
  stop() {
    this.stopped = true;
  }
}

const conversation = createInitialState();
await startRealtimeConversation(conversation, {
  mediaStream: fakeStream({ audio: true, video: true }),
  SpeechRecognition: FakeSpeechRecognition
});
assert.equal(conversation.interactionState.sessionActive, true, "conversation session starts");
assert.equal(conversation.interactionState.mode, "conversation");
assert.equal(conversation.interactionState.listeningActive, true, "conversation activates listening");
assert.equal(conversation.interactionState.proactiveObservationActive, false, "conversation disables proactive observation");
assert.equal(conversation.interactionState.microphoneActive, true, "conversation activates microphone");
assertInteractionStateInvariant(conversation);

let inferenceCount = 0;
let firstTask = null;
await handleRealtimeUserSpeechTurn(conversation, "What am I holding?", {
  runRealtimeInference: async (target, task) => {
    inferenceCount += 1;
    firstTask = task;
    assert.equal(target.interactionState.mode, "conversation");
    assert.equal(task.type, "user_turn");
    assert.equal(task.userTurn.text, "What am I holding?");
  }
});
assert.equal(inferenceCount, 1, "conversation user question schedules one inference");
assert.equal(firstTask.userTurn.interactionMode, "conversation", "user turn is mode tagged");
assert.deepEqual(visualContextForRequest(conversation).recent_user_turns, ["What am I holding?"], "conversation context includes user turn");
assert.equal(scheduleRealtimeVisualEvent(conversation, { fingerprint: "silent_cup:0.8" }), false, "camera movement alone does not narrate in conversation");

conversation.movementRecognition.latestSpokenResponse = "You are holding a mug.";
conversation.interactionState.assistantSpeaking = true;
conversation.movementRecognition.activeSpeechAudio = { pause() {}, removeAttribute() {}, load() {} };
await handleRealtimeUserSpeechTurn(conversation, "What color is it?", {
  runRealtimeInference: async () => {}
});
assert.equal(conversation.interactionState.assistantSpeaking, false, "barge-in clears assistant speech");
assert.equal(conversation.conversationMemory.interruptedResponses.length, 1, "interrupted assistant response is preserved");
const rejectedTranscript = await handleRealtimeUserSpeechTurn({ ...conversation, interactionState: { ...conversation.interactionState, mode: "observing" } }, "ignored");
assert.equal(rejectedTranscript.ok, false, "observing transcript is not processed");

await setInteractionModeInState(conversation, "observing", { fetch: async () => ({ ok: true }) });
assert.equal(conversation.interactionState.mode, "observing", "mode switches to observing");
assert.equal(conversation.interactionState.listeningActive, false, "conversation to observing stops listening");
assert.equal(conversation.interactionState.proactiveObservationActive, true, "observing starts proactive observation");
assert.equal(conversation.cameraReady, true, "camera remains active across conversation to observing");
assert.equal(FakeSpeechRecognition.instances.at(-1).aborted, true, "mode switch aborts STT");
assert.equal(conversation.stream.getAudioTracks().every((track) => track.readyState === "ended"), true, "mode switch stops microphone tracks");
assertInteractionStateInvariant(conversation);

let observedTasks = 0;
assert.equal(scheduleRealtimeVisualEvent(conversation, { fingerprint: "thumb_up:0.9", score: 0.9 }, {
  runRealtimeInference: async (_target, task) => {
    observedTasks += 1;
    assert.equal(task.type, "visual_event");
    assert.equal(task.visualEvent.interactionMode, "observing");
  }
}), true, "observing accepts a visual event");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(observedTasks, 1, "observing movement produces one narration task");
assert.equal(await handleRealtimeUserSpeechTurn(conversation, "What am I holding?").then((result) => result.ok), false, "observing rejects transcripts");

await setInteractionModeInState(conversation, "conversation", {
  audioStream: fakeStream({ audio: true, video: false }),
  SpeechRecognition: FakeSpeechRecognition,
  fetch: async () => ({ ok: true })
});
assert.equal(conversation.interactionState.mode, "conversation", "observing switches back to conversation");
assert.equal(conversation.interactionState.listeningActive, true, "switch back starts listening");
assert.equal(conversation.interactionState.proactiveObservationActive, false, "switch back stops detector");
assert.equal(conversation.cameraReady, true, "camera remains active across observing to conversation");
assertInteractionStateInvariant(conversation);

await endInteractionSession(conversation, { fetch: async () => ({ ok: true }) });
assert.equal(conversation.interactionState.sessionActive, false, "ending clears active session");
assert.equal(conversation.interactionState.listeningActive, false);
assert.equal(conversation.interactionState.proactiveObservationActive, false);
assert.equal(conversation.cameraReady, false, "ending stops camera");

const noSpeechConversation = createInitialState();
await startRealtimeConversation(noSpeechConversation, {
  mediaStream: fakeStream({ audio: true, video: true }),
  SpeechRecognition: null
});
assert.equal(noSpeechConversation.interactionState.sessionActive, false, "conversation does not fake an active session without STT");
assert.equal(noSpeechConversation.interactionState.listeningActive, false, "conversation does not fake listening without STT");
assert.equal(noSpeechConversation.realtimeSession.state, "error", "missing STT is surfaced as a safe error");

const observing = createInitialState();
await startRealtimeObserving(observing, {
  mediaStream: fakeStream({ audio: false, video: true }),
  SpeechRecognition: FakeSpeechRecognition
});
assert.equal(observing.interactionState.mode, "observing");
assert.equal(observing.interactionState.proactiveObservationActive, true, "observing activates proactive observation");
assert.equal(observing.interactionState.listeningActive, false, "observing does not activate listening");
assert.equal(observing.interactionState.microphoneActive, false, "observing does not request microphone");
assert.equal(observing.realtimeSession.memory, observing.observationMemory, "observing owns observation memory, not conversation memory");
assertInteractionStateInvariant(observing);
await endInteractionSession(observing, { fetch: async () => ({ ok: true }) });

assert.throws(() => assertInteractionStateInvariant({
  interactionState: {
    sessionActive: true,
    mode: "conversation",
    listeningActive: true,
    proactiveObservationActive: true
  }
}), /Invalid interaction state/, "listening plus proactive observation is impossible");

assert.equal(primaryHtml.includes('id="interactionModeSelector"'), true, "primary mode selector is present");
assert.equal(primaryHtml.includes(">Conversation<"), true, "conversation selector label is present");
assert.equal(primaryHtml.includes(">Observing<"), true, "observing selector label is present");
assert.equal(primaryHtml.includes("dq-product-header"), false, "primary UI has no top header");
assert.equal((primaryHtml.match(/id="analyzeMovement"/g) || []).length, 1, "primary UI has one primary button");
assert.equal(primaryHtml.includes("Auto-speak"), false, "primary UI has no Auto-speak control");
assert.equal(primaryHtml.includes("Open voice controls"), false, "primary UI has no microphone control");
assert.equal(primaryHtml.includes("Observe again"), false, "primary UI has no Observe again control");
assert.equal(source.includes("interaction_mode: requestMode"), true, "visual requests are mode-tagged");
assert.equal(source.includes("mode_generation_id: requestGenerationId"), true, "visual requests are generation-tagged");
assert.equal(source.includes("queueVisualReasoningUnavailable"), true, "quota/provider failures surface as visual reasoning unavailable");
assert.equal(source.includes('"hf_daily_limit_reached"'), true, "daily cloud limit is handled explicitly");
assert.equal(/process\.env\.HF_TOKEN|Authorization:\s*`Bearer|hf_[A-Za-z0-9]{12,}/.test(source), false, "frontend does not expose provider tokens");
assert.equal(/MediaRecorder|indexedDB|navigator\.sendBeacon|WebSocket/i.test(source), false, "runtime does not persist or stream raw media");

console.log("ok dual-mode runtime");
