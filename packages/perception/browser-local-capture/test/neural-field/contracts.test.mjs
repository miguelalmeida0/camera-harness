import assert from "node:assert/strict";
import test from "node:test";
import { LANDMARK_FIXTURES, SCENE_FIXTURES } from "../../../../../fixtures/neural-field/fixture-library.mjs";
import {
  assertNoMediaPayload,
  assertTestOnlyActivation,
  createHandWorkerContract,
  createNeuralFieldStateContract,
  createObjectGroundingContract,
  createPerceptionEventContract,
  createRelationContract,
  createRendererEventContract
} from "./contract-stubs.mjs";

test("test contracts require an explicit non-production test runtime", () => {
  const previousFlag = process.env.SENSEFIELD_NEURAL_FIELD_TEST;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.SENSEFIELD_NEURAL_FIELD_TEST = "1";
    delete process.env.NODE_ENV;
    assert.doesNotThrow(() => assertTestOnlyActivation());
    delete process.env.SENSEFIELD_NEURAL_FIELD_TEST;
    assert.throws(() => assertTestOnlyActivation(), /test_only/);
    process.env.SENSEFIELD_NEURAL_FIELD_TEST = "1";
    process.env.NODE_ENV = "production";
    assert.throws(() => assertTestOnlyActivation(), /test_only/);
  } finally {
    if (previousFlag === undefined) delete process.env.SENSEFIELD_NEURAL_FIELD_TEST;
    else process.env.SENSEFIELD_NEURAL_FIELD_TEST = previousFlag;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("state, perception, and renderer contracts reject malformed events", () => {
  const state = createNeuralFieldStateContract();
  assert.equal(state.validate({ mode: "neural_field", active: true, tool: "airscript", generation: 1 }), true);
  assert.equal(state.validate({ mode: "neural_field", active: true, tool: "production_override", generation: 1 }), false);

  const perception = createPerceptionEventContract();
  const renderer = createRendererEventContract();
  const valid = { type: "stroke.started", sequence: 1, timestampMs: 2, generation: 1, payload: {} };
  assert.equal(perception.validate(valid), true);
  assert.equal(renderer.validate(valid), true);
  assert.equal(perception.validate({ ...valid, payload: undefined }), false);
  assert.equal(renderer.validate({ ...valid, type: "final_ui_success" }), false);
});

test("hand worker derives pinch transitions only from landmark geometry", () => {
  const worker = createHandWorkerContract();
  const start = worker.process(structuredClone(LANDMARK_FIXTURES.stable_pinch.frames[0]));
  assert.equal(start.transition, "pinch_start");
  assert.equal(start.pinched, true);
  assert.ok(start.pinchDistance <= 0.045);
  const release = worker.process(structuredClone(LANDMARK_FIXTURES.release.frames[0]));
  assert.equal(release.transition, "pinch_end");
  assert.equal(release.pinched, false);
  const low = worker.process(structuredClone(LANDMARK_FIXTURES.low_confidence.frames[0]));
  assert.equal(low.accepted, false);
  assert.equal(low.reason, "low_confidence");
});

test("grounding and relation contracts use geometry and tracked objects", () => {
  const grounding = createObjectGroundingContract();
  const relation = createRelationContract();
  const scene = SCENE_FIXTURES.mug_left_of_laptop.scene;
  const lasso = LANDMARK_FIXTURES.valid_lasso_around_one_object.frames
    .slice(0, -1)
    .map((frame) => frame.hands[0].landmarks[8]);
  const result = grounding.ground(scene.objects, lasso);
  assert.deepEqual(result.candidates, ["mug"]);
  assert.equal(result.status, "grounded");
  assert.equal(relation.infer(scene.objects[0], scene.objects[1]).type, "left_of");
  assert.equal(relation.infer({ ...scene.objects[0], tracking: "lost" }, scene.objects[1]), null);
});

test("contracts reject raw media and sensitive payloads", () => {
  assert.doesNotThrow(() => assertNoMediaPayload({ containsRawMedia: false, point: { x: 0.1, y: 0.2 } }));
  assert.throws(() => assertNoMediaPayload({ rawFrame: "data:image/png;base64,AAAA" }), /payload/);
  assert.throws(() => assertNoMediaPayload({ token: "sk-not-allowed" }), /sensitive_payload/);
  assert.throws(() => assertNoMediaPayload(new Uint8Array([1, 2, 3])), /raw_media_payload/);
});
