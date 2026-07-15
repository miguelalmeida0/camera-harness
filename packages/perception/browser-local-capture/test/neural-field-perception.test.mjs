import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bboxPolygonOverlap,
  classifyStroke,
  createHandGeometryTracker,
  createNeuralFieldPerceptionPipeline,
  createPinchDetector,
  detectClosedLasso,
  extractStrokeFeatures,
  filterTrajectory,
  mapTrajectoryToViewport,
  mapViewportPolygonToSourceFrame,
  pointInPolygon,
  polygonIoU,
  ramerDouglasPeucker
} from "../prototype/perception/neural-field-perception.js";
import { createNeuralFieldWorkerClient } from "../prototype/perception/neural-field-worker-client.js";
import {
  makeRawHandFrame,
  makeRadialTrajectory,
  makeTrajectoryFromVertices,
  NEURAL_FIELD_FIXTURES as FIXTURES
} from "./fixtures/neural-field-landmarks.mjs";

const completed = [];
const registered = [];

test("normalized hand frame", () => {
  const tracker = createHandGeometryTracker();
  const frame = normalize(tracker, FIXTURES.oneStableHand);
  assert.equal(frame.hands.length, 1);
  const hand = frame.hands[0];
  assert.equal(hand.landmarks.length, 21);
  assert.equal(hand.worldLandmarks.length, 21);
  assert.equal(hand.handedness, "right");
  assert.ok(hand.palmWidth > 0.08);
  assert.ok(Number.isFinite(hand.palmNormal.z));
  assert.ok(Number.isFinite(hand.relativeDepth));
  assert.equal(frame.containsRawMedia, false);
  const moved = makeRawHandFrame({ timestamp: 40, hands: [{ handedness: "right", indexTip: { x: 0.54, y: 0.35, z: -0.03 } }] });
  assert.ok(normalize(tracker, moved).hands[0].velocity.magnitude > 0);
});

test("correct mirrored handedness", () => {
  const tracker = createHandGeometryTracker();
  const frame = normalize(tracker, FIXTURES.mirroredCamera);
  assert.equal(frame.mirrored, true);
  assert.equal(frame.hands[0].handedness, "right", "display mirroring must not swap anatomical handedness");
  assert.ok(Math.abs(frame.hands[0].indexTip.x - 0.25) < 1e-6, "source-normalized landmarks stay unmirrored");
});

test("pinch hysteresis", () => {
  const detector = createPinchDetector({ minimumStableFrames: 2, debounceMs: 20 });
  const frames = normalizeSequence(FIXTURES.pinchRelease);
  const events = frames.flatMap((frame) => detector.update(frame));
  assert.equal(events.filter((event) => event.type === "pinch_started").length, 1);
  assert.equal(events.filter((event) => event.type === "pinch_ended").length, 1);
  assert.ok(events.some((event) => event.type === "pinch_updated"));
});

test("pinch debounce", () => {
  const flickerDetector = createPinchDetector({ minimumStableFrames: 2, debounceMs: 20 });
  assert.equal(normalizeSequence(FIXTURES.pinchFlicker).flatMap((frame) => flickerDetector.update(frame)).length, 0);
  const heldDetector = createPinchDetector({ minimumStableFrames: 2, debounceMs: 100 });
  const events = normalizeSequence(FIXTURES.stablePinch).flatMap((frame) => heldDetector.update(frame));
  assert.ok(events.find((event) => event.type === "pinch_started")?.timestamp >= 120);
});

test("pinch debounce is hand-specific", () => {
  const detector = createPinchDetector({ minimumStableFrames: 2, debounceMs: 20, dominantHand: "auto" });
  const raw = Array.from({ length: 5 }, (_, index) => makeRawHandFrame({
    timestamp: index * 40,
    hands: [
      { handedness: "left", confidence: index % 2 === 0 ? 0.99 : 0.75, pinchRatio: 0.2, indexTip: { x: 0.3, y: 0.35, z: -0.03 } },
      { handedness: "right", confidence: index % 2 === 0 ? 0.75 : 0.99, pinchRatio: 0.2, indexTip: { x: 0.7, y: 0.35, z: -0.03 } }
    ]
  }));
  assert.equal(normalizeSequence(raw).flatMap((frame) => detector.update(frame)).length, 0);
});

test("pinch missing-hand grace", () => {
  const detector = createPinchDetector({ minimumStableFrames: 2, debounceMs: 20, missingHandGraceMs: 100, maximumOcclusionMs: 240 });
  const [first, second, third] = normalizeSequence(FIXTURES.stablePinch.slice(0, 3));
  detector.update(first); detector.update(second); detector.update(third);
  assert.deepEqual(detector.update({ timestamp: 150, hands: [] }), []);
  assert.equal(detector.getState().active, true);
});

test("pinch cancellation", () => {
  const detector = createPinchDetector({ minimumStableFrames: 2, debounceMs: 20, maximumOcclusionMs: 200 });
  const started = normalizeSequence(FIXTURES.stablePinch.slice(0, 3));
  started.forEach((frame) => detector.update(frame));
  const events = detector.update({ timestamp: 400, hands: [] });
  assert.equal(events[0]?.type, "pinch_cancelled");
  assert.equal(detector.getState().active, false);
});

test("pinch cancellation on late reappearance", () => {
  const detector = createPinchDetector({ minimumStableFrames: 2, debounceMs: 20, maximumOcclusionMs: 200 });
  normalizeSequence(FIXTURES.stablePinch.slice(0, 3)).forEach((frame) => detector.update(frame));
  const late = makeRawHandFrame({ timestamp: 400, hands: [{ handedness: "right", pinchRatio: 0.2 }] });
  const event = detector.update(normalize(createHandGeometryTracker(), late))[0];
  assert.equal(event?.type, "pinch_cancelled");
  assert.equal(detector.getState().active, false);
});

test("maximum one active stroke", () => {
  const pipeline = createNeuralFieldPerceptionPipeline({ pinch: { minimumStableFrames: 2, debounceMs: 20 } });
  const results = normalizeSequence(FIXTURES.stablePinch.slice(0, 3)).map((frame) => pipeline.processFrame(frame));
  assert.equal(results.at(-1).activeStroke?.id, "stroke_1");
  assert.equal(typeof results.at(-1).activeStroke?.pointCount, "number");
});

test("ordered and bounded trajectory points", () => {
  const pipeline = createNeuralFieldPerceptionPipeline({
    pinch: { minimumStableFrames: 2, debounceMs: 0 },
    stroke: { maximumPointCount: 5, minimumPointDistance: 0 }
  });
  const rawFrames = Array.from({ length: 10 }, (_, index) => makeRawHandFrame({
    timestamp: index * 40,
    hands: [{ handedness: "right", indexTip: { x: 0.3 + index * 0.02, y: 0.4, z: -0.03 }, pinchRatio: 0.2 }]
  }));
  const outputs = normalizeSequence(rawFrames).flatMap((frame) => pipeline.processFrame(frame).events);
  const cancelled = outputs.find((event) => event.type === "stroke_cancelled" && event.reason === "maximum_points");
  assert.ok(cancelled);
  assert.ok(cancelled.rawPoints.length <= 5);
  assert.deepEqual(cancelled.rawPoints.map((point) => point.timestamp), [...cancelled.rawPoints.map((point) => point.timestamp)].sort((a, b) => a - b));
});

test("low-confidence rejection", () => {
  const tracker = createHandGeometryTracker();
  const frame = normalize(tracker, FIXTURES.lowConfidenceLandmarks);
  const detector = createPinchDetector({ minimumStableFrames: 1, debounceMs: 0, minimumConfidence: 0.6 });
  assert.equal(detector.update(frame).length, 0);
});

test("jitter reduction", () => {
  const raw = Array.from({ length: 80 }, (_, index) => ({
    x: 0.5 + Math.sin(index * 3.7) * 0.012,
    y: 0.5 + Math.cos(index * 4.1) * 0.011,
    z: 0,
    timestamp: index * 16,
    confidence: 0.95,
    velocity: 0
  }));
  const filtered = filterTrajectory(raw, { minimumPointDistance: 0, filter: "one_euro" });
  assert.ok(rmsRadius(filtered.smoothedPoints, { x: 0.5, y: 0.5 }) < rmsRadius(raw, { x: 0.5, y: 0.5 }));
  assert.equal(filtered.rawPoints.length, raw.length, "original evidence is retained");
});

test("corner preservation", () => {
  const corner = { x: 0.6, y: 0.25 };
  const raw = makeTrajectoryFromVertices([{ x: 0.2, y: 0.7 }, corner, { x: 0.85, y: 0.7 }], { samplesPerSegment: 18, intervalMs: 16 });
  const filtered = filterTrajectory(raw, { minimumPointDistance: 0, rdpEpsilon: 0.005 });
  assert.ok(filtered.simplifiedPoints.length >= 3);
  assert.ok(Math.min(...filtered.simplifiedPoints.map((point) => distance(point, corner))) < 0.11);
});

test("RDP simplification", () => {
  const simplified = ramerDouglasPeucker(FIXTURES.roughRectangle, 0.01);
  assert.ok(simplified.length < FIXTURES.roughRectangle.length / 2);
  assert.ok(simplified.length >= 4);
});

test("circle classification", () => assert.equal(classifyStroke(FIXTURES.slowCircle).classification, "circle"));
test("ellipse classification", () => assert.equal(classifyStroke(FIXTURES.ellipse).classification, "ellipse"));
test("arrow classification", () => assert.equal(classifyStroke(FIXTURES.sharpArrow).classification, "arrow"));
test("rectangle classification", () => assert.equal(classifyStroke(FIXTURES.roughRectangle).classification, "rectangle"));
test("triangle classification", () => assert.equal(classifyStroke(FIXTURES.triangle).classification, "triangle"));

test("rotated rectangle classification", () => {
  const rotated = makeTrajectoryFromVertices([
    { x: 0.5, y: 0.2 }, { x: 0.78, y: 0.5 }, { x: 0.5, y: 0.8 }, { x: 0.22, y: 0.5 }, { x: 0.5, y: 0.2 }
  ], { samplesPerSegment: 10 });
  assert.equal(classifyStroke(rotated).classification, "rectangle");
});

test("aspect-correct circle classification", () => {
  const sourceEllipse = makeRadialTrajectory({ radiusX: 0.1, radiusY: 0.1 / 0.5625, samples: 64 }).map((point) => ({
    ...point,
    metricScaleX: 1,
    metricScaleY: 0.5625,
    metricScaleZ: 1
  }));
  assert.equal(classifyStroke(sourceEllipse).classification, "circle");
});

test("classifier rejects low-confidence geometry", () => {
  const weakCircle = FIXTURES.slowCircle.map((point) => ({ ...point, confidence: 0.2 }));
  const result = classifyStroke(weakCircle);
  assert.equal(result.classification, "freeform");
  assert.deepEqual(result.evidence.matched, ["low_confidence"]);
});

test("uncertain text is not fabricated", () => {
  for (const stroke of FIXTURES.aiLikeCharacterStrokes) {
    const result = classifyStroke(stroke);
    assert.ok(["short_letter_candidate", "short_word_candidate", "freeform", "line"].includes(result.classification));
    assert.equal(result.evidence.content, null);
    assert.equal("text" in result, false);
  }
});

test("stroke feature vector", () => {
  const features = extractStrokeFeatures(FIXTURES.roughRectangle);
  assert.equal(features.featureVector.length, features.featureVectorLabels.length);
  assert.ok(features.totalPathLength > 1);
  assert.ok(features.cornerCount >= 3);
  assert.equal(features.turningAngleHistogram.length, 8);
});

test("valid lasso", () => {
  const result = detectClosedLasso(FIXTURES.validLasso);
  assert.equal(result.valid, true);
  assert.ok(result.polygon.length >= 5);
  assert.ok(result.area > 0.05);
});

test("invalid open lasso", () => {
  const result = detectClosedLasso(FIXTURES.openLasso);
  assert.equal(result.valid, false);
  assert.equal(result.rejectionReason, "open_path");
});

test("tiny lasso rejected", () => {
  const result = detectClosedLasso(FIXTURES.tinyLasso);
  assert.equal(result.valid, false);
  assert.equal(result.rejectionReason, "area_too_small");
});

test("self-intersection rejection", () => {
  const result = detectClosedLasso(FIXTURES.selfIntersectingLasso);
  assert.equal(result.valid, false);
  assert.equal(result.rejectionReason, "excessive_self_intersection");
});

test("lasso enforces absolute closure and closing-edge intersections", () => {
  const visiblyOpen = FIXTURES.validLasso.map((point) => ({ ...point }));
  visiblyOpen.at(-1).x += 0.08;
  assert.equal(detectClosedLasso(visiblyOpen).rejectionReason, "open_path");
  const closingEdgeCrosses = makeTrajectoryFromVertices([
    { x: 0.5, y: 0.5 }, { x: 0.52, y: 0.48 }, { x: 0.52, y: 0.52 },
    { x: 0.8, y: 0.72 }, { x: 0.2, y: 0.72 }, { x: 0.54, y: 0.5 }
  ], { samplesPerSegment: 8 });
  assert.equal(detectClosedLasso(closingEdgeCrosses).rejectionReason, "excessive_self_intersection");
});

test("viewport mapping and inverse", () => {
  const options = { frameWidth: 640, frameHeight: 480, viewport: { x: 10, y: 20, width: 640, height: 480 }, mirrored: true };
  const mapped = mapTrajectoryToViewport([{ x: 0.25, y: 0.5, z: 0 }], options)[0];
  assert.ok(Math.abs(mapped.x - 490) < 1e-6);
  assert.ok(Math.abs(mapped.y - 260) < 1e-6);
  const source = mapViewportPolygonToSourceFrame([mapped], options)[0];
  assert.ok(Math.abs(source.x - 160) < 1e-6);
  assert.ok(Math.abs(source.y - 240) < 1e-6);
});

test("point-in-polygon", () => {
  const polygon = square(0, 0, 10, 10);
  assert.equal(pointInPolygon({ x: 5, y: 5 }, polygon), true);
  assert.equal(pointInPolygon({ x: 12, y: 5 }, polygon), false);
});

test("polygon overlap and IoU", () => {
  const first = square(0, 0, 10, 10);
  const second = square(5, 0, 10, 10);
  assert.ok(Math.abs(bboxPolygonOverlap({ x: 0, y: 0, width: 10, height: 10 }, second) - 0.5) < 1e-6);
  assert.ok(Math.abs(polygonIoU(first, second) - 1 / 3) < 1e-6);
});

test("object-fit cover mapping", () => {
  const options = { frameWidth: 1920, frameHeight: 1080, viewport: { width: 390, height: 844 }, mirrored: false, objectFit: "cover" };
  const center = mapTrajectoryToViewport([{ x: 0.5, y: 0.5 }], options)[0];
  assert.ok(Math.abs(center.x - 195) < 1e-6);
  assert.ok(Math.abs(center.y - 422) < 1e-6);
  const mobile = FIXTURES.mobileAspectRatio;
  const point = { x: 0.34, y: 0.63 };
  const mapped = mapTrajectoryToViewport([point], mobile)[0];
  const source = mapViewportPolygonToSourceFrame([mapped], { ...mobile, inputSpace: "css", normalized: true })[0];
  assert.ok(distance(point, source) < 1e-6, "rotation, mirror, crop, and CSS scale round-trip");
});

test("occlusion recovery", () => {
  const pipeline = createNeuralFieldPerceptionPipeline({
    pinch: { minimumStableFrames: 2, debounceMs: 20, missingHandGraceMs: 80, maximumOcclusionMs: 240 },
    stroke: { minimumPathLength: 0.005, minimumDurationMs: 80, maximumGapMs: 60, maximumOcclusionGapMs: 220 }
  });
  const raw = [
    makeRawHandFrame({ timestamp: 0, hands: [{ handedness: "right", indexTip: { x: 0.4, y: 0.4, z: -0.03 }, pinchRatio: 0.2 }] }),
    makeRawHandFrame({ timestamp: 40, hands: [{ handedness: "right", indexTip: { x: 0.42, y: 0.4, z: -0.03 }, pinchRatio: 0.2 }] }),
    makeRawHandFrame({ timestamp: 100, hands: [] }),
    makeRawHandFrame({ timestamp: 150, hands: [{ handedness: "right", indexTip: { x: 0.45, y: 0.4, z: -0.03 }, pinchRatio: 0.2 }] }),
    makeRawHandFrame({ timestamp: 190, hands: [{ handedness: "right", indexTip: { x: 0.47, y: 0.4, z: -0.03 }, pinchRatio: 0.7 }] }),
    makeRawHandFrame({ timestamp: 230, hands: [{ handedness: "right", indexTip: { x: 0.47, y: 0.4, z: -0.03 }, pinchRatio: 0.7 }] })
  ];
  const events = normalizeSequence(raw).flatMap((frame) => pipeline.processFrame(frame).events);
  const completedStroke = events.find((event) => event.type === "stroke_completed");
  assert.ok(completedStroke, "bounded occlusion preserves the active stroke");
  assert.ok(completedStroke.smoothedPoints.some((point) => point.interpolated === true));

  const cancellationPipeline = createNeuralFieldPerceptionPipeline({ pinch: { minimumStableFrames: 2, debounceMs: 20, maximumOcclusionMs: 200 } });
  const cancellationEvents = normalizeSequence(FIXTURES.handOcclusion).flatMap((frame) => cancellationPipeline.processFrame(frame).events);
  assert.ok(cancellationEvents.some((event) => event.type === "pinch_cancelled"));
  assert.ok(cancellationEvents.some((event) => event.type === "stroke_cancelled"));
});

test("worker queue bound", () => {
  const worker = new MockWorker({ autoRespond: false });
  const client = createNeuralFieldWorkerClient({ createWorker: () => worker, ImageBitmapApi: TestFrame });
  client.start();
  const frames = [new TestFrame(), new TestFrame(), new TestFrame()];
  frames.forEach((frame, index) => client.processFrame({ frame, timestamp: index + 1, frameWidth: 640, frameHeight: 480, mirrored: true }));
  assert.ok(client.getDiagnostics().maxQueueDepth <= 2, "one active plus one replaceable pending frame");
  assert.equal(client.getDiagnostics().replacedFrames, 1);
  assert.equal(frames[1].closed, true);
  worker.respondNext();
  worker.respondNext();
  assert.equal(client.getDiagnostics().completedFrames, 2);
  client.dispose();
});

test("worker callback reentrancy keeps newest frame", () => {
  const worker = new MockWorker({ autoRespond: false });
  const delivered = [];
  const frames = [new TestFrame(), new TestFrame(), new TestFrame()];
  let client;
  client = createNeuralFieldWorkerClient({
    createWorker: () => worker,
    ImageBitmapApi: TestFrame,
    onHandFrame(message) {
      delivered.push(message.timestamp);
      if (message.timestamp === 1) client.processFrame({ frame: frames[2], timestamp: 3 });
    }
  });
  client.start();
  client.processFrame({ frame: frames[0], timestamp: 1 });
  client.processFrame({ frame: frames[1], timestamp: 2 });
  worker.respondNext();
  worker.respondNext();
  assert.deepEqual(delivered, [1, 3]);
  assert.equal(frames[1].closed, true, "older detached pending frame is released");
  assert.equal(client.getDiagnostics().replacedFrames, 1);
  client.dispose();
});

test("worker disposal", () => {
  const worker = new MockWorker({ autoRespond: false });
  const client = createNeuralFieldWorkerClient({ createWorker: () => worker, ImageBitmapApi: TestFrame });
  client.start();
  const active = new TestFrame();
  const pending = new TestFrame();
  client.processFrame({ frame: active, timestamp: 1 });
  client.processFrame({ frame: pending, timestamp: 2 });
  client.dispose();
  assert.equal(worker.terminated, true);
  assert.equal(pending.closed, true);
  assert.equal(active.closed, true);
  assert.equal(client.getDiagnostics().workerActive, false);
});

test("no frame persistence and no cloud call", async () => {
  const workerSource = await readFile(new URL("../prototype/perception/gesture-recognizer-worker.js", import.meta.url), "utf8");
  const clientSource = await readFile(new URL("../prototype/perception/neural-field-worker-client.js", import.meta.url), "utf8");
  assert.match(workerSource, /type:\s*["']process_frame["']|message\.type === ["']process_frame["']/);
  assert.match(workerSource, /type:\s*["']hand_frame["']/);
  assert.match(workerSource, /frame\?\.close\?\.\(\)/);
  assert.doesNotMatch(workerSource + clientSource, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|indexedDB)\s*[.(]/);
  const client = createNeuralFieldWorkerClient({ createWorker: () => new MockWorker() });
  client.start();
  assert.equal(Object.hasOwn(client.getDiagnostics(), "frame"), false);
  assert.equal(Object.hasOwn(client.getDiagnostics(), "image"), false);
  client.dispose();
});

test("five start/stop cycles leak-free", () => {
  MockWorker.activeCount = 0;
  const frames = [];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const worker = new MockWorker({ autoRespond: true });
    const client = createNeuralFieldWorkerClient({ createWorker: () => worker, ImageBitmapApi: TestFrame });
    client.start();
    const frame = new TestFrame();
    frames.push(frame);
    client.processFrame({ frame, timestamp: cycle + 1, frameWidth: 640, frameHeight: 480 });
    client.dispose();
  }
  assert.equal(MockWorker.activeCount, 0);
  assert.equal(frames.every((frame) => frame.closed), true);
});

function test(name, callback) {
  registered.push({ name, callback });
}

function normalize(tracker, fixture) {
  return tracker.process(fixture.result, fixture);
}

function normalizeSequence(fixtures) {
  const tracker = createHandGeometryTracker();
  return fixtures.map((fixture) => normalize(tracker, fixture));
}

function rmsRadius(points, center) {
  return Math.sqrt(points.reduce((sum, point) => sum + (point.x - center.x) ** 2 + (point.y - center.y) ** 2, 0) / Math.max(1, points.length));
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function square(x, y, width, height) {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

class TestFrame {
  constructor() { this.closed = false; }
  close() { this.closed = true; }
}

class MockWorker {
  static activeCount = 0;

  constructor({ autoRespond = true } = {}) {
    this.autoRespond = autoRespond;
    this.listeners = { message: new Set(), error: new Set() };
    this.pendingFrames = [];
    this.terminated = false;
    MockWorker.activeCount += 1;
  }

  addEventListener(type, listener) { this.listeners[type]?.add(listener); }
  removeEventListener(type, listener) { this.listeners[type]?.delete(listener); }

  postMessage(message) {
    if (message.type === "init") {
      this.emit({ type: "gesture_engine_ready", engine: "synthetic_local_worker" });
      return;
    }
    if (message.type === "process_frame") {
      this.pendingFrames.push(message);
      if (this.autoRespond) this.respondNext();
      return;
    }
    if (message.type === "stop") {
      this.pendingFrames.splice(0).forEach((pending) => pending.frame?.close?.());
      this.emit({ type: "gesture_engine_stopped" });
    }
  }

  respondNext() {
    const message = this.pendingFrames.shift();
    if (!message) return;
    message.frame?.close?.();
    this.emit({ type: "hand_frame", timestamp: message.timestamp, hands: [], processingMs: 2.5 });
  }

  terminate() {
    if (this.terminated) return;
    this.pendingFrames.splice(0).forEach((pending) => pending.frame?.close?.());
    this.terminated = true;
    MockWorker.activeCount -= 1;
  }

  emit(data) {
    for (const listener of this.listeners.message) listener({ data });
  }
}

for (const { name, callback } of registered) {
  try {
    await callback();
    completed.push(name);
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

console.log(JSON.stringify({ schema_version: "sensefield.neural_field_perception.test.v1", tests: completed.length, synthetic_landmarks_only: true, raw_media_persisted: false }));
console.log("SENSEFIELD_NEURAL_FIELD_PERCEPTION_TEST_OK");
