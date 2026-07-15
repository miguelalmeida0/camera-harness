import assert from "node:assert/strict";
import test from "node:test";
import { LANDMARK_FIXTURES, SCENE_FIXTURES } from "../../../../../fixtures/neural-field/fixture-library.mjs";
import { createNeuralFieldRuntime } from "./runtime.mjs";

test("renderer timeline follows live stroke, stabilization, classification, and cleanup", () => {
  const runtime = createNeuralFieldRuntime();
  runtime.enter({ returnMode: "ask" });
  runtime.selectTool("airscript");
  feed(runtime, LANDMARK_FIXTURES.stable_pinch);
  feed(runtime, LANDMARK_FIXTURES.slow_circle);
  const liveTypes = runtime.getRenderTimeline().map((event) => event.type);
  assert.ok(liveTypes.includes("stroke.started"));
  assert.ok(liveTypes.includes("stroke.updated"));
  feed(runtime, LANDMARK_FIXTURES.release);
  const types = runtime.getRenderTimeline().map((event) => event.type);
  assert.ok(types.indexOf("stroke.stabilized") > types.indexOf("stroke.started"));
  assert.ok(types.indexOf("classification.rendered") > types.indexOf("stroke.stabilized"));
  assert.equal(runtime.snapshot().classification.label, "circle");
  runtime.exit({ returnMode: "ask" });
  assert.equal(runtime.getRenderTimeline().at(-1).type, "renderer.cleared");
  assert.equal(runtime.getResourceSnapshot().rendererResourceCount, 0);
});

test("renderer grounding and relation events come from two lasso commits and tracking updates", () => {
  const runtime = createNeuralFieldRuntime();
  runtime.enter({ returnMode: "watch" });
  runtime.selectTool("spatial_lasso");
  runtime.setScene(SCENE_FIXTURES.mug_left_of_laptop.scene);
  feed(runtime, LANDMARK_FIXTURES.valid_lasso_around_one_object);
  feed(runtime, translate(LANDMARK_FIXTURES.valid_lasso_around_one_object, 0.45));
  assert.equal(runtime.snapshot().selection.anchorId, "mug");
  assert.equal(runtime.snapshot().selection.targetId, "laptop");
  assert.equal(runtime.snapshot().relations[0].type, "left_of");
  const beforeMove = runtime.getRenderTimeline().length;
  runtime.moveObject("mug", { bbox: { x: 0.22 } });
  assert.ok(runtime.getRenderTimeline().length > beforeMove);
  assert.equal(runtime.getRenderTimeline().at(-1).type, "relation.updated");
  runtime.moveObject("mug", { tracking: "out_of_frame", bbox: { x: 1.05 } });
  assert.equal(runtime.snapshot().selection.anchorId, null);
  assert.equal(runtime.snapshot().relations.length, 0);
  assert.equal(runtime.getRenderTimeline().at(-1).type, "anchor.cleared");
});

test("stale renderer work is rejected after exit without another render", () => {
  const runtime = createNeuralFieldRuntime();
  runtime.enter({ returnMode: "ask" });
  runtime.selectTool("airscript");
  const request = runtime.requestSemantic("classification", { commit: true });
  runtime.exit({ returnMode: "ask" });
  const renders = runtime.getRenderTimeline().length;
  const result = runtime.dispatch({ type: "semantic_resolved", requestId: request.requestId, generation: request.generation, payload: { classification: "circle" } });
  assert.equal(result.accepted, false);
  assert.equal(runtime.getRenderTimeline().length, renders);
  assert.equal(runtime.getEventTimeline().at(-1).type, "stale_ignored");
});

function feed(runtime, fixture) {
  for (const frame of fixture.frames) runtime.feedLandmarkFrame(structuredClone(frame));
}

function translate(fixture, dx) {
  return {
    frames: fixture.frames.map((frame) => ({
      ...structuredClone(frame),
      hands: frame.hands.map((hand) => ({
        ...structuredClone(hand),
        landmarks: hand.landmarks.map((point) => ({ ...point, x: point.x + dx })),
        thumb_tip: hand.thumb_tip ? { ...hand.thumb_tip, x: hand.thumb_tip.x + dx } : hand.thumb_tip,
        index_tip: hand.index_tip ? { ...hand.index_tip, x: hand.index_tip.x + dx } : hand.index_tip
      }))
    }))
  };
}
