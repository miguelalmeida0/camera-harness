import assert from "node:assert/strict";
import {
  analyzeSpatialExperienceForWindow,
  createInitialState,
  endInteractionSession,
  queueMovementRecognitionResult,
  setInteractionModeInState,
  startRealtimeConversation
} from "../prototype/local-capture.js";
import {
  resolveSpatialQuery,
  spatialNarration,
  updateSpatialMemory
} from "../prototype/spatial/spatial-experience.js";
import { SPATIAL_TEST_SCENARIOS } from "./spatial-test-adapter.mjs";

class FakeSpeechRecognition {
  start() { this.onstart?.(); }
  abort() {}
  stop() {}
}

const runtime = createInitialState();
const frames = [
  { captured_at_ms: 1000, width: 320, height: 180, encoded_frame: "dGVzdC1mcmFtZS0x" },
  { captured_at_ms: 1100, width: 320, height: 180, encoded_frame: "dGVzdC1mcmFtZS0y" }
];
let activeSpatialRequests = 0;
let maximumSpatialRequests = 0;
let adapterCalls = 0;

for (let cycle = 0; cycle < 10; cycle += 1) {
  const sessionStream = fakeStream({ audio: true, video: true });
  await startRealtimeConversation(runtime, {
    mediaStream: sessionStream,
    SpeechRecognition: FakeSpeechRecognition
  });
  assert.equal(runtime.interactionState.sessionActive, true, `cycle ${cycle}: Conversation starts`);
  assert.equal(runtime.interactionState.mode, "conversation");

  const first = await spatialTurn("mug_left_of_laptop", "What is to the left of the laptop?", "conversation");
  updateSpatialMemory(runtime.spatialExperience, first.result, spatialNarration(first.result));
  assert.match(spatialNarration(first.result), /mug.*left.*laptop/i);

  const followUpQuery = resolveSpatialQuery("Did I move it closer?", runtime.spatialExperience.memory);
  assert.match(followUpQuery, /Referenced object.*mug/i, `cycle ${cycle}: bounded reference retained`);
  const followUp = await spatialTurn("mug_in_front_of_laptop", followUpQuery, "conversation");
  updateSpatialMemory(runtime.spatialExperience, followUp.result, spatialNarration(followUp.result));

  const callsBeforeOrdinary = adapterCalls;
  const ordinary = await analyzeSpatialExperienceForWindow(runtime, frames, {
    mode: "conversation",
    query: "Can you hear me?",
    spatialAdapter: adapterFor("mug_left_of_laptop"),
    spatialTestMode: true
  });
  assert.equal(ordinary.requested, false, `cycle ${cycle}: ordinary question bypasses spatial inference`);
  assert.equal(adapterCalls, callsBeforeOrdinary);

  await setInteractionModeInState(runtime, "observing", { fetch: okFetch });
  assert.equal(runtime.interactionState.mode, "observing");
  assert.equal(runtime.interactionState.listeningActive, false);
  assert.equal(runtime.interactionState.proactiveObservationActive, true);

  await observingMoment("mug_in_front_of_laptop", `cycle_${cycle}_event_1`);
  await observingMoment("hand_toward_camera", `cycle_${cycle}_event_2`);
  const partial = await observingMoment("partial_unknown_object", `cycle_${cycle}_partial`);
  assert.match(partial, /part of a metallic body/i);
  assert.doesNotMatch(partial, /\b\d+(?:\.\d+)?\s*(?:cm|centimet|meter|metre)\b/i);

  await setInteractionModeInState(runtime, "conversation", {
    audioStream: fakeStream({ audio: true, video: false }),
    SpeechRecognition: FakeSpeechRecognition,
    fetch: okFetch
  });
  assert.equal(runtime.interactionState.mode, "conversation");
  assert.equal(runtime.spatialExperience.overlay.visible, false, `cycle ${cycle}: stale overlay cleared`);
  assert.equal(runtime.spatialExperience.memory.lastReferencedLabels.length, 0, `cycle ${cycle}: transient reference cleared`);

  const freshOrdinary = await analyzeSpatialExperienceForWindow(runtime, frames, {
    mode: "conversation",
    query: "Tell me a joke.",
    spatialAdapter: adapterFor("mug_left_of_laptop"),
    spatialTestMode: true
  });
  assert.equal(freshOrdinary.requested, false);
  assert.equal(runtime.emergencyRuntimeController.snapshot().runtime.speechInFlight, false);

  await endInteractionSession(runtime, { fetch: okFetch });
  const ended = runtime.emergencyRuntimeController.snapshot();
  assert.equal(ended.session.status, "inactive", `cycle ${cycle}: session ends cleanly`);
  assert.equal(runtime.spatialExperience.activeAbortController, null);
  assert.equal(runtime.spatialExperience.overlay.timer, null);
  assert.equal(runtime.realtimeSession.speechRecognition, null);
  assert.equal(sessionStream.getTracks().every((track) => track.readyState === "ended"), true);
}

const persistent = runtime.emergencyRuntimeController.snapshot().persistentMemory;
assert.equal(maximumSpatialRequests, 1, "maximum one spatial inference is in flight");
assert.equal(new Set(persistent.observationMoments.map((item) => item.id)).size, persistent.observationMoments.length, "Recent Moments remain deduplicated");
assert.equal(persistent.observationMoments.length <= 20, true, "existing Recent Moments cap is preserved");
assert.equal(JSON.stringify(persistent).includes("encoded_frame"), false, "persistent memory contains no raw frames");
assert.equal(runtime.emergencyRuntimeController.snapshot().runtime.inferenceInFlight, false);
assert.equal(runtime.emergencyRuntimeController.snapshot().runtime.speechInFlight, false);

console.log("spatial lifecycle stress passed: 10 cycles");

async function spatialTurn(scenario, query, mode) {
  return analyzeSpatialExperienceForWindow(runtime, frames, {
    mode,
    query,
    spatialAdapter: adapterFor(scenario),
    spatialTestMode: true
  });
}

async function observingMoment(scenario, observationId) {
  const outcome = await spatialTurn(scenario, "", "observing");
  const text = spatialNarration(outcome.result, { mode: "observing" });
  queueMovementRecognitionResult(runtime, {
    observation_id: observationId,
    movement: text,
    spoken_response: text,
    response_type: "narrate",
    meaningful_change: true,
    confidence: 0.82,
    uncertainty: outcome.result.uncertainty.level === "high",
    provider: "local_spatial",
    model: "deterministic-spatial-test",
    response_source: "deterministic_test_fixture"
  }, Date.now(), { recordMovementHistory: true, queueSuggestion: false });
  return text;
}

function adapterFor(scenario) {
  return {
    async analyzeSpatialWindow() {
      adapterCalls += 1;
      activeSpatialRequests += 1;
      maximumSpatialRequests = Math.max(maximumSpatialRequests, activeSpatialRequests);
      try {
        await Promise.resolve();
        return structuredClone(SPATIAL_TEST_SCENARIOS[scenario]);
      } finally {
        activeSpatialRequests -= 1;
      }
    }
  };
}

function fakeStream({ audio, video }) {
  const tracks = [
    ...(video ? [fakeTrack("video")] : []),
    ...(audio ? [fakeTrack("audio")] : [])
  ];
  return {
    addTrack(track) { tracks.push(track); },
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video")
  };
}

function fakeTrack(kind) {
  return { kind, readyState: "live", stop() { this.readyState = "ended"; } };
}

async function okFetch() {
  return { ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true }; } };
}
