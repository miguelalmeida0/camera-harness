import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createInitialState,
  endInteractionSession,
  handleRealtimeUserSpeechTurn,
  queueMovementRecognitionResult,
  scheduleRealtimeVisualEvent,
  setInteractionModeInState,
  speakVisualResponse,
  startRealtimeConversation,
  startRealtimeObserving
} from "../prototype/local-capture.js";
import { createEmergencyRuntimeController } from "../prototype/emergency-runtime-controller.js";
import { createNeuralVoiceHarness } from "./neural-voice-fixture.mjs";

const html = readFileSync(new URL("../prototype/index.html", import.meta.url), "utf8");
const voice = createNeuralVoiceHarness();

const recognitionInstances = [];
class Recognition {
  constructor() {
    this.startCount = 0;
    this.stopped = false;
    recognitionInstances.push(this);
  }
  start() {
    this.startCount += 1;
    this.onstart?.();
  }
  abort() {
    this.stopped = true;
  }
  stop() {
    this.stopped = true;
  }
}

function fakeTrack(kind) {
  return { kind, readyState: "live", stopCount: 0, stop() { this.stopCount += 1; this.readyState = "ended"; } };
}

function fakeStream({ audio = true, video = true } = {}) {
  const tracks = [video && fakeTrack("video"), audio && fakeTrack("audio")].filter(Boolean);
  return {
    tracks,
    getTracks() { return this.tracks; },
    getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); },
    getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); },
    addTrack(track) { this.tracks.push(track); }
  };
}

async function conversationTurn(runtime, question, answer, id) {
  const result = await handleRealtimeUserSpeechTurn(runtime, question, {
    runRealtimeInference: async (target) => {
      queueMovementRecognitionResult(target, {
        observation_id: id,
        movement: answer,
        spoken_response: answer,
        response_type: "narrate",
        confidence: 0.82,
        uncertainty: false,
        provider: "provider-adapter",
        model: "lifecycle-test-model",
        response_source: "local_vlm"
      }, Date.now(), { recordMovementHistory: false, queueSuggestion: false });
      await speakVisualResponse({ observationId: id, text: answer }, { target, ...voice.options });
    }
  });
  assert.equal(result.ok, true);
  await waitFor(() => runtime.interactionState.inferenceInFlight === false && runtime.appState.currentTurn.speechStatus === "complete");
}

async function observationEvent(runtime, label, answer, id) {
  const accepted = scheduleRealtimeVisualEvent(runtime, { event_id: id, fingerprint: label, score: 0.9 }, {
    runRealtimeInference: async (target) => {
      queueMovementRecognitionResult(target, {
        observation_id: id,
        movement: answer,
        spoken_response: answer,
        response_type: "narrate",
        meaningful_change: true,
        movement_label: label,
        evidence_frames: [1, 3, 5],
        confidence: 0.91,
        uncertainty: false,
        provider: "provider-adapter",
        model: "lifecycle-test-model",
        response_source: "local_vlm"
      }, Date.now(), { recordMovementHistory: true, queueSuggestion: false });
      await speakVisualResponse({ observationId: id, text: answer }, { target, ...voice.options });
    }
  });
  assert.equal(accepted, true);
  await waitFor(() => runtime.interactionState.inferenceInFlight === false && runtime.appState.currentTurn.speechStatus === "complete");
}

const runtime = createInitialState();

  const conversationStream = fakeStream();
  await startRealtimeConversation(runtime, { mediaStream: conversationStream, SpeechRecognition: Recognition });
  await conversationTurn(runtime, "Can you hear me?", "Yes, I can hear you.", "conversation_1");
  await conversationTurn(runtime, "What can you see?", "I can see the current camera view.", "conversation_2");
  assert.equal(runtime.appState.persistentMemory.conversationMoments.length, 4, "two complete turns are historical moments");
  await endInteractionSession(runtime, voice.options);
  assert.equal(runtime.appState.session.status, "inactive");
  assert.deepEqual(runtime.appState.currentTurn, emptyTurn(), "ending clears the live response");
  assert.equal(runtime.appState.persistentMemory.conversationMoments.length, 4, "ending preserves Recent Moments");
  assert.equal(conversationStream.tracks.every((track) => track.readyState === "ended"), true, "ending stops camera and microphone");
  assertNoLocks(runtime);

  await setInteractionModeInState(runtime, "observing");
  const observingStream = fakeStream({ audio: false });
  await startRealtimeObserving(runtime, { mediaStream: observingStream });
  assert.equal(runtime.interactionState.microphoneActive, false, "observing does not start STT");
  await observationEvent(runtime, "peace_sign", "You raised your hand and made a peace sign.", "observation_1");
  await observationEvent(runtime, "thumbs_up", "You raised your hand and gave a thumbs up.", "observation_2");
  assert.equal(runtime.appState.persistentMemory.observationMoments.length, 2, "two distinct observations remain in history");
  await endInteractionSession(runtime, voice.options);
  assert.deepEqual(runtime.appState.currentTurn, emptyTurn(), "ending observing clears the live observation");
  assert.equal(runtime.appState.persistentMemory.observationMoments.length, 2);
  assertNoLocks(runtime);

  await setInteractionModeInState(runtime, "conversation");
  const freshStream = fakeStream();
  await startRealtimeConversation(runtime, { mediaStream: freshStream, SpeechRecognition: Recognition });
  assert.deepEqual(runtime.appState.currentTurn, emptyTurn(), "fresh Conversation does not restore an old answer or movement");
  await conversationTurn(runtime, "Are we in a fresh session?", "Yes, this is a fresh conversation.", "conversation_3");
  await endInteractionSession(runtime, voice.options);

  const controller = createEmergencyRuntimeController();
  controller.beginStart("conversation");
  controller.activate("conversation", { cameraActive: true, microphoneActive: true });
  controller.queueFinalTranscript("Tell me about the view.");
  const staleTask = controller.takeNextTask();
  controller.beginEnd();
  controller.finishEnd();
  assert.equal(controller.setCurrentResponse({ text: "Old SpaceX answer" }), false, "ended session rejects a late response");
  assert.equal(controller.finishInference(staleTask), false, "old request cannot release a newer lock");
  controller.selectMode("observing");
  assert.equal(controller.snapshot().currentTurn.assistantText, "", "stale Conversation callback cannot overwrite Observing");

  const selectorIndex = html.indexOf('id="interactionModeSelector"');
  const responseBodyIndex = html.indexOf('id="cameraSuggestions"');
  assert.ok(selectorIndex >= 0 && selectorIndex < responseBodyIndex, "mode selector is structurally above the response body");
  assert.match(html, /\.sf-response-body\s*\{[\s\S]*?max-height:\s*min\(34vh, 320px\);[\s\S]*?overflow-y:\s*auto;/, "long responses use a bounded internal scroller");
  assert.match(html, /\.sf-response-card \.dq-movement-sentence\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/, "long response text remains contained");

  const cycleRuntime = createInitialState();
  for (let index = 0; index < 5; index += 1) {
    const stream = fakeStream();
    await startRealtimeConversation(cycleRuntime, { mediaStream: stream, SpeechRecognition: Recognition });
    await endInteractionSession(cycleRuntime, voice.options);
    assert.equal(stream.tracks.every((track) => track.stopCount === 1), true, `cycle ${index + 1} stops each media track once`);
    assert.equal(cycleRuntime.realtimeSession.speechRestartTimer, null, `cycle ${index + 1} clears speech timer`);
    assertNoLocks(cycleRuntime);
  }
  assert.equal(recognitionInstances.every((instance) => instance.stopped), true, "five cycles stop every recognition instance");
  assert.equal(voice.requests.filter((request) => request.pathname.endsWith("/speak")).length, 5, "each response starts neural speech once");
  assert.equal(voice.maxActiveCount, 1, "only one Audio playback is active at a time");

console.log("ok core lifecycle");

function emptyTurn() {
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

function assertNoLocks(runtime) {
  const state = runtime.appState;
  assert.equal(state.runtime.inferenceInFlight, false);
  assert.equal(state.runtime.speechInFlight, false);
  assert.equal(state.runtime.processingTranscript, false);
  assert.equal(state.runtime.activeRequestId, null);
  assert.equal(state.runtime.activeSpeechId, null);
  assert.equal(state.runtime.queuedUserTurn, null);
  assert.equal(state.runtime.queuedVisualEvent, null);
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for lifecycle transition");
}
