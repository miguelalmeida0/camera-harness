import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_FIXTURES, LANDMARK_FIXTURES, SCENE_FIXTURES } from "../../../../../fixtures/neural-field/fixture-library.mjs";
import { createHandWorkerContract } from "./contract-stubs.mjs";
import { createNeuralFieldRuntime } from "./runtime.mjs";

const REQUIRED_LANDMARKS = [
  "no_hand", "left_hand", "right_hand", "two_hands", "stable_pinch", "pinch_flicker", "release",
  "temporary_occlusion", "long_occlusion", "slow_circle", "fast_circle", "ellipse", "rectangle", "triangle",
  "arrow", "letter_a", "letter_i", "letters_a_and_i", "open_lasso", "valid_lasso_around_one_object",
  "valid_lasso_around_two_objects", "tiny_lasso", "self_intersecting_lasso", "lasso_at_viewport_edge",
  "lasso_on_mobile_aspect_ratio", "jitter", "low_confidence", "sudden_hand_jump", "hand_leaves_frame"
];
const REQUIRED_SCENES = [
  "mug_and_laptop", "mug_left_of_laptop", "mug_in_front_of_laptop", "mug_moving_toward_camera",
  "hand_approaching_mug", "two_overlapping_objects", "ambiguous_lasso_region", "unsupported_empty_lasso",
  "object_leaves_frame", "object_tracking_loss", "face_in_central_region", "low_light_hand", "cluttered_desk"
];

test("fixture catalogs contain every required synthetic case and no private recording", () => {
  for (const id of REQUIRED_LANDMARKS) {
    const fixture = LANDMARK_FIXTURES[id];
    assert.ok(fixture, `missing landmark fixture: ${id}`);
    assert.equal(fixture.synthetic, true);
    assert.equal(fixture.containsRawMedia, false);
    assert.ok(fixture.frames.length > 0);
  }
  for (const id of REQUIRED_SCENES) {
    assert.ok(SCENE_FIXTURES[id], `missing scene fixture: ${id}`);
    assert.ok(CAMERA_FIXTURES[id], `missing camera fixture: ${id}`);
    assert.equal(CAMERA_FIXTURES[id].containsPrivateUserRecording, false);
    assert.equal(CAMERA_FIXTURES[id].containsRawMedia, false);
  }
});

test("hand presence, handedness, occlusion, confidence, jump, and leave-frame sequences are deterministic", () => {
  const worker = createHandWorkerContract();
  assert.equal(worker.process(structuredClone(LANDMARK_FIXTURES.no_hand.frames[0])).present, false);
  assert.equal(worker.process(structuredClone(LANDMARK_FIXTURES.left_hand.frames[0])).handedness, "left");
  assert.equal(worker.process(structuredClone(LANDMARK_FIXTURES.right_hand.frames[0])).handedness, "right");
  assert.equal(LANDMARK_FIXTURES.two_hands.frames[0].hands.length, 2);
  assert.equal(worker.process(structuredClone(LANDMARK_FIXTURES.low_confidence.frames[0])).accepted, false);

  worker.reset();
  for (const frame of LANDMARK_FIXTURES.stable_pinch.frames) worker.process(structuredClone(frame));
  const jump = LANDMARK_FIXTURES.sudden_hand_jump.frames.map((frame) => worker.process(structuredClone(frame)));
  assert.ok(jump.some((result) => result.reason === "sudden_hand_jump"));

  worker.reset();
  const leaves = LANDMARK_FIXTURES.hand_leaves_frame.frames.map((frame) => worker.process(structuredClone(frame)));
  assert.ok(leaves.some((result) => result.transition === "pinch_end" && result.reason === "long_occlusion"));
});

test("AirScript trajectories produce local geometry classifications without semantic requests", () => {
  const expected = {
    slow_circle: "circle",
    fast_circle: "circle",
    ellipse: "ellipse",
    rectangle: "rectangle",
    triangle: "triangle",
    arrow: "arrow",
    letter_a: "A",
    letter_i: "I",
    jitter: "uncertain_freeform"
  };
  for (const [id, label] of Object.entries(expected)) {
    const runtime = createNeuralFieldRuntime();
    runtime.enter({ returnMode: "ask" });
    runtime.selectTool("airscript");
    feed(runtime, LANDMARK_FIXTURES[id]);
    feed(runtime, LANDMARK_FIXTURES.release);
    assert.equal(runtime.snapshot().classification?.label, label, `${id} classification`);
    assert.equal(runtime.snapshot().classification?.source, "local_geometry");
    assert.equal(runtime.getResourceSnapshot().semanticRequestCount, 0);
  }
});

test("lasso fixtures exercise grounded, ambiguous, open, tiny, self-intersecting, edge, and mobile outcomes", () => {
  assert.equal(lassoOutcome("mug_left_of_laptop", "valid_lasso_around_one_object"), "anchored");
  assert.equal(lassoOutcome("ambiguous_lasso_region", "valid_lasso_around_two_objects"), "ambiguous");
  assert.equal(lassoOutcome("mug_left_of_laptop", "open_lasso"), "invalid_open");
  assert.equal(lassoOutcome("mug_left_of_laptop", "tiny_lasso"), "invalid_too_small");
  assert.equal(lassoOutcome("mug_left_of_laptop", "self_intersecting_lasso"), "invalid_self_intersecting");
  assert.match(lassoOutcome("unsupported_empty_lasso", "valid_lasso_around_one_object"), /unsupported_empty/);
  assert.match(lassoOutcome("mug_left_of_laptop", "lasso_at_viewport_edge"), /unsupported_empty|anchored/);
  assert.match(lassoOutcome("mug_left_of_laptop", "lasso_on_mobile_aspect_ratio"), /anchored|ambiguous|unsupported_empty/);
});

function lassoOutcome(sceneId, fixtureId) {
  const runtime = createNeuralFieldRuntime();
  runtime.enter({ returnMode: "watch" });
  runtime.selectTool("spatial_lasso");
  runtime.setScene(SCENE_FIXTURES[sceneId].scene);
  feed(runtime, LANDMARK_FIXTURES[fixtureId]);
  return runtime.snapshot().selection.status;
}

function feed(runtime, fixture) {
  for (const frame of fixture.frames) runtime.feedLandmarkFrame(structuredClone(frame));
}
