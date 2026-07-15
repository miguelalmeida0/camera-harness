import assert from "node:assert/strict";
import test from "node:test";
import { LANDMARK_FIXTURES, SCENE_FIXTURES } from "../../../../../fixtures/neural-field/fixture-library.mjs";
import { createNeuralFieldRuntime } from "./runtime.mjs";

test("ordinary drawing keeps camera data transient and makes no semantic or microphone request", () => {
  const runtime = createNeuralFieldRuntime();
  runtime.enter({ returnMode: "ask" });
  runtime.selectTool("airscript");
  feed(runtime, LANDMARK_FIXTURES.stable_pinch);
  feed(runtime, LANDMARK_FIXTURES.slow_circle);
  feed(runtime, LANDMARK_FIXTURES.release);

  const resources = runtime.getResourceSnapshot();
  assert.equal(resources.microphoneTracks, 0, "Neural Field never owns a microphone track");
  assert.equal(resources.activeRecorders, 0, "replay is never automatic");
  assert.equal(resources.semanticRequestCount, 0, "ordinary drawing stays local");
  assert.equal(runtime.snapshot().classification?.source, "local_geometry");
  assertSafePersistedState(runtime.getPersistedState());
  assertNoSecretsOrModelPaths(runtime.getEventTimeline());

  runtime.exit({ returnMode: "ask" });
  assert.equal(runtime.getResourceSnapshot().mediaTracks, 0);
  assert.equal(runtime.snapshot().replay, null, "replay is discarded by default");
});

test("object, stroke, relation, and raw-landmark session memory stays bounded", () => {
  const runtime = createNeuralFieldRuntime();
  runtime.enter({ returnMode: "watch" });
  runtime.selectTool("airscript");
  for (let index = 0; index < 72; index += 1) {
    feed(runtime, LANDMARK_FIXTURES.stable_pinch);
    feed(runtime, { frames: LANDMARK_FIXTURES.slow_circle.frames.slice(0, 8) });
    feed(runtime, LANDMARK_FIXTURES.release);
  }
  assert.ok(runtime.getPersistedState().strokeHistory.length <= 64);

  runtime.selectTool("spatial_lasso");
  const baseScene = structuredClone(SCENE_FIXTURES.mug_left_of_laptop.scene);
  baseScene.objects.push(...Array.from({ length: 40 }, (_, index) => ({
    id: `synthetic_${index}`,
    label: `synthetic object ${index}`,
    bbox: { x: 0.01 * (index % 10), y: 0.75, width: 0.02, height: 0.02 },
    depth: 0.7,
    confidence: 0.8,
    tracking: "tracked"
  })));
  runtime.setScene(baseScene);
  assert.ok(runtime.snapshot().objects.length <= 32);

  feed(runtime, LANDMARK_FIXTURES.valid_lasso_around_one_object);
  feed(runtime, translatedFixture(LANDMARK_FIXTURES.valid_lasso_around_one_object, 0.4, 0));
  assert.equal(runtime.snapshot().relations[0]?.type, "left_of");
  for (let index = 0; index < 40; index += 1) {
    runtime.moveObject("mug", { bbox: { x: 0.16 + (index % 2) * 0.02 } });
  }
  const persisted = runtime.getPersistedState();
  assert.ok(persisted.objectMemory.length <= 32);
  assert.ok(persisted.relationHistory.length <= 32);
  assertSafePersistedState(persisted);
  assert.equal(runtime.getResourceSnapshot().semanticRequestCount, 0);

  runtime.exit({ returnMode: "watch" });
  runtime.enter({ returnMode: "ask" });
  assert.equal(runtime.getPersistedState().strokeHistory.length, 0, "stroke history is session bounded");
  assert.equal(runtime.getPersistedState().relationHistory.length, 0, "relation history is session bounded");
  runtime.exit({ returnMode: "ask" });
});

test("persisted-state scan rejects media, biometric identity, token, and model-path payloads", () => {
  const runtime = createNeuralFieldRuntime();
  runtime.enter({ returnMode: "ask" });
  runtime.selectTool("spatial_lasso");
  runtime.setScene(SCENE_FIXTURES.face_in_central_region.scene);
  const persisted = runtime.getPersistedState();
  assertSafePersistedState(persisted);
  const serialized = JSON.stringify(persisted);
  assert.doesNotMatch(serialized, /biometric|face[_-]?(embedding|identity|template)/i);
  assert.doesNotMatch(serialized, /(?:Bearer\s+|sk-[A-Za-z0-9_-]{8,}|api[_-]?key)/i);
  assert.doesNotMatch(serialized, /model[_-]?path|\/Users\/|[A-Za-z]:\\/i);
  assert.throws(() => runtime.dispatch({ type: "relation_update", payload: { frameData: "data:image/png;base64,forbidden" } }), /payload.*rejected/);
  assert.throws(() => runtime.dispatch({ type: "relation_update", payload: { landmarks: [{ x: 0.1, y: 0.2 }] } }), /raw_landmark_payload_rejected/);

  runtime.exit({ returnMode: "ask" });
  assert.deepEqual(runtime.dispatch({ type: "speech_started" }), { accepted: false, reason: "inactive_session" });
  assert.equal(runtime.getResourceSnapshot().activeAudioElements, 0);
});

function feed(runtime, fixture) {
  for (const frame of fixture.frames) runtime.feedLandmarkFrame(structuredClone(frame));
}

function translatedFixture(fixture, offsetX, offsetY) {
  return {
    frames: fixture.frames.map((frame) => ({
      ...structuredClone(frame),
      hands: frame.hands.map((hand) => ({
        ...structuredClone(hand),
        landmarks: hand.landmarks.map((landmark) => ({ ...landmark, x: landmark.x + offsetX, y: landmark.y + offsetY }))
      }))
    }))
  };
}

function assertSafePersistedState(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /(?:data:(?:image|video|audio)\/|blob:|base64,)/i);
  assert.doesNotMatch(serialized, /"(?:rawFrame|frameData|landmarks|thumb_tip|index_tip|mediaPayload|audioPayload|videoPayload|microphone)"\s*:/i);
  assert.equal(value.containsRawMedia, false);
  assert.equal(value.replay, null);
}

function assertNoSecretsOrModelPaths(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /(?:Bearer\s+|sk-[A-Za-z0-9_-]{8,}|api[_-]?key)/i);
  assert.doesNotMatch(serialized, /model[_-]?path|\/Users\/|[A-Za-z]:\\/i);
}
