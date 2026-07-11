import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createInitialState,
  endInteractionSession,
  setInteractionModeInState,
  speakVisualResponse,
  startRealtimeObserving
} from "../prototype/local-capture.js";
import { createNeuralVoiceHarness } from "./neural-voice-fixture.mjs";

const source = readFileSync(new URL("../prototype/local-capture.js", import.meta.url), "utf8");
const ttsSource = readFileSync(new URL("../../../../services/visual-companion/tts.mjs", import.meta.url), "utf8");
assert.equal(source.includes("speakWithBrowserSpeech"), false, "narration has no browser/system voice fallback");
assert.equal(ttsSource.includes("speechSynthesis"), false, "voice runtime has no browser/system voice fallback");

const runtime = createInitialState();
const voice = createNeuralVoiceHarness({ autoEnd: false });
await setInteractionModeInState(runtime, "observing");
await startRealtimeObserving(runtime, { mediaStream: fakeStream() });

const firstPromise = speakVisualResponse(
  { observationId: "observation_first", text: "First response." },
  { target: runtime, ...voice.options }
);
await waitFor(() => voice.instances.length === 1 && runtime.movementRecognition.activeSpeechOwnership?.playing === true);
const firstAudio = voice.instances[0];
const staleEnded = firstAudio.onended;
const firstOwner = runtime.movementRecognition.activeSpeechOwnership;

const secondPromise = speakVisualResponse(
  { observationId: "observation_second", text: "Second response." },
  { target: runtime, ...voice.options }
);
assert.deepEqual(await firstPromise, { ok: false, code: "visual_speech_cancelled" }, "cancellation does not masquerade as completion");
await waitFor(() => voice.instances.length === 2 && runtime.movementRecognition.activeSpeechOwnership?.playing === true);
const secondAudio = voice.instances[1];
const secondOwner = runtime.movementRecognition.activeSpeechOwnership;

staleEnded?.();
assert.equal(runtime.movementRecognition.activeSpeechOwnership, secondOwner, "stale callback cannot release newer speech ownership");
assert.equal(runtime.emergencyRuntimeController.snapshot().currentTurn.speechStatus, "speaking", "stale callback cannot complete newer speech");
assert.equal(firstOwner.cancelled, true);
assert.equal(firstOwner.completed, false);

secondAudio.end();
const secondResult = await secondPromise;
assert.equal(secondResult.ok, true);
assert.equal(secondResult.path, "local_tts");
assert.equal(secondOwner.responseId, "observation_second");
assert.match(secondOwner.speechId, /^speech_/);
assert.equal(secondOwner.sessionGeneration, runtime.interactionState.sessionGenerationId);
assert.equal(secondOwner.modeGeneration, runtime.interactionState.modeGenerationId);
assert.equal(secondOwner.completed, true, "real Audio ended emits one completion");
assert.equal(runtime.appState.currentTurn.speechStatus, "complete");
assert.equal(voice.maxActiveCount, 1, "only one Audio playback is active at a time");
assert.equal(voice.requests.filter((request) => request.pathname.endsWith("/speak")).length, 2);

await endInteractionSession(runtime, voice.options);
console.log("single neural voice lifecycle tests passed");

function fakeStream() {
  const track = { kind: "video", readyState: "live", stop() { this.readyState = "ended"; } };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [],
    getVideoTracks: () => [track]
  };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for neural voice lifecycle state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
