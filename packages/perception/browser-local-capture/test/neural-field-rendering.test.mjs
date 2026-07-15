import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  classifyStroke,
  createNeuralFieldRenderer,
  depthVisual,
  lassoClosure,
  normalizeRelations,
  placeLabel,
  velocityWidth
} from "../prototype/neural-field/neural-field-renderer.js";
import { LocalReplayCompositor } from "../prototype/neural-field/replay-compositor.js";

const originalDevicePixelRatio = globalThis.devicePixelRatio;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const originalMatchMedia = globalThis.matchMedia;
const rafCallbacks = new Map();
let rafSequence = 0;

Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
globalThis.requestAnimationFrame = (callback) => {
  const id = ++rafSequence;
  rafCallbacks.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (id) => rafCallbacks.delete(id);
globalThis.matchMedia = (query) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {}
});

function verifyPureRenderingMath() {
  const slowWidth = velocityWidth(0.02, 0.95, { min: 1.5, max: 12, base: 7 });
  const fastWidth = velocityWidth(1.4, 0.95, { min: 1.5, max: 12, base: 7 });
  const uncertainWidth = velocityWidth(0.02, 0.25, { min: 1.5, max: 12, base: 7 });
  assert.ok(Number.isFinite(slowWidth) && Number.isFinite(fastWidth), "velocity widths must be finite");
  assert.notEqual(slowWidth, fastWidth, "ribbon width must react to point velocity");
  assert.ok(uncertainWidth <= slowWidth, "low confidence must not exaggerate ribbon width");

  const near = depthVisual(0.15, 0.95);
  const far = depthVisual(0.85, 0.95);
  const weakNear = depthVisual(0.15, 0.15);
  const weakFar = depthVisual(0.85, 0.15);
  for (const visual of [near, far, weakNear, weakFar]) {
    assert.ok(Number.isFinite(visual.scale) && Number.isFinite(visual.opacity) && Number.isFinite(visual.glow));
    assert.ok(visual.opacity >= 0 && visual.opacity <= 1, "depth opacity must be bounded");
  }
  assert.notEqual(near.opacity, far.opacity, "confident relative depth must affect fade");
  assert.ok(
    Math.abs(weakNear.scale - weakFar.scale) < Math.abs(near.scale - far.scale),
    "weak depth confidence must flatten perspective instead of fabricating precision"
  );
  assert.equal(weakNear.flattened, true, "weak depth confidence must report flattened rendering");

  const circle = classifyStroke(circlePoints());
  const arrow = classifyStroke(arrowPoints());
  const freeform = classifyStroke([
    point(0.1, 0.2), point(0.24, 0.58), point(0.42, 0.3), point(0.58, 0.78), point(0.84, 0.38)
  ]);
  assert.deepEqual([circle.label, arrow.label, freeform.label], ["CIRCLE", "ARROW", "FREEFORM STROKE"]);
  assert.equal(circle.supported, true);
  assert.equal(arrow.supported, true);
  assert.equal(freeform.supported, true);

  const closed = lassoClosure(circlePoints());
  const open = lassoClosure([point(0.1, 0.2), point(0.35, 0.2), point(0.65, 0.55), point(0.9, 0.7)]);
  const tiny = lassoClosure([point(0.5, 0.5), point(0.505, 0.5), point(0.505, 0.505), point(0.5, 0.5)]);
  assert.equal(closed.valid, true, "closed lasso with useful area must be valid");
  assert.equal(closed.closed, true);
  assert.equal(open.valid, false, "open lasso must be invalid");
  assert.equal(tiny.valid, false, "tiny accidental loop must be invalid");
  assert.ok(typeof open.feedback === "string" && open.feedback.length > 0, "invalid lasso needs restrained text feedback");
}

function verifyRendererLifecycleAndTrajectories() {
  const canvas = new FakeCanvas(640, 360);
  const renderer = createNeuralFieldRenderer(canvas, { maxPathPoints: 256, now: () => 1_000 });
  renderer.setActive(true);
  renderer.start();
  renderer.start();
  let snapshot = renderer.getSnapshot();
  assert.equal(snapshot.loopStarts, 1, "one renderer instance must schedule exactly one loop");
  assert.equal(snapshot.running, true);
  assert.equal(rafCallbacks.size, 1, "duplicate starts must not retain duplicate animation frames");
  renderer.stop();
  assert.equal(rafCallbacks.size, 0, "stop must cancel the owned animation frame");

  renderer.renderOnce(1_000);
  snapshot = renderer.getSnapshot();
  assert.equal(snapshot.dpr, 2, "renderer must retain the effective device pixel ratio");
  assert.equal(canvas.width, 1_280, "canvas backing width must be DPR aware");
  assert.equal(canvas.height, 720, "canvas backing height must be DPR aware");

  renderer.setTool("airscript");
  const expected = [
    point(0.18, 0.28, 0.28),
    point(0.31, 0.36, 0.3),
    point(0.49, 0.43, 0.34),
    point(0.68, 0.51, 0.39)
  ];
  renderer.ingestHandFrame(handFrame(expected[0], 1_000, false));
  expected.forEach((sample, index) => renderer.ingestHandFrame(handFrame(sample, 1_016 + index * 16, true)));
  snapshot = renderer.getSnapshot();
  assert.ok(snapshot.paths.liveEvidence.length >= expected.length, "raw evidence trajectory must remain visible");
  assert.ok(snapshot.paths.liveStabilized.length >= 2, "stabilized polished trajectory must render beside evidence");
  assertPointNear(snapshot.paths.liveEvidence.at(-1), expected.at(-1), 0.035, "live trail must follow the hand trajectory");
  assert.notStrictEqual(snapshot.paths.liveEvidence, snapshot.paths.liveStabilized, "evidence and polished paths must be distinct arrays");
  renderer.renderOnce(1_100);
  assert.ok(canvas.context.count("lineTo") + canvas.context.count("quadraticCurveTo") > 0, "trajectory must issue path drawing commands");

  renderer.ingestHandFrame(handFrame(expected.at(-1), 1_120, false));
  renderer.renderOnce(1_140);
  snapshot = renderer.getSnapshot();
  assert.ok(snapshot.paths.completed.length >= 1, "pinch release must retain a completed stroke summary");
  assert.match(snapshot.status, /Stroke complete|Ready/i);
  assert.ok(snapshot.paths.completed[0].evidence || snapshot.paths.completed[0].points || Array.isArray(snapshot.paths.completed[0]), "completed stroke preserves original evidence");

  renderer.dispose();
  snapshot = renderer.getSnapshot();
  const metrics = renderer.getMetrics();
  assert.equal(snapshot.disposed, true);
  assert.equal(snapshot.running, false);
  assert.equal(metrics.disposed, true);
  assert.equal(rafCallbacks.size, 0, "dispose must leave no renderer frame retained");
}

function verifyInputFallbacksAndConsumerIsolation() {
  const renderer = createNeuralFieldRenderer(new FakeCanvas(640, 360), { now: () => 1_500 });
  renderer.setActive(true);
  const directLandmarks = handFrame(point(0.4, 0.4, -0.2), 1_500, true).hands[0].landmarks;
  renderer.ingestHandFrame({ landmarks: directLandmarks, timestamp_ms: 1_500, pinching: true, confidence: 0.9 });
  let snapshot = renderer.getSnapshot();
  assert.ok(snapshot.paths.liveEvidence.length > 0, "direct landmark arrays must feed the same live trail");
  assert.equal(snapshot.paths.liveEvidence.at(-1).depth, 0.5, "non-normalized relative hand depth must flatten to the neutral plane");
  assert.equal(snapshot.paths.liveEvidence.at(-1).depthConfidence, 0, "non-normalized relative hand depth must not fabricate depth confidence");

  const unregister = renderer.registerFrameConsumer(() => { throw new Error("optional consumer failed"); });
  assert.doesNotThrow(() => renderer.renderOnce(1_516), "an optional replay consumer must not interrupt the renderer loop");
  unregister();
  renderer.dispose();
}

function verifyLassoStates() {
  const renderer = createNeuralFieldRenderer(new FakeCanvas(720, 480), { now: () => 2_000 });
  renderer.setActive(true);
  renderer.setTool("spatial-lasso");
  renderer.loadFixture("lasso-selected");
  renderer.renderOnce(2_000);
  let snapshot = renderer.getSnapshot();
  assert.equal(snapshot.lasso.valid, true, "valid lasso fixture must show closure feedback");
  assert.ok(snapshot.lasso.points.length >= 4);
  assert.ok(snapshot.anchors.some((anchor) => anchor.state === "selected"), "valid lasso must resolve toward a real selected anchor");
  assert.equal(snapshot.lasso.resolvedAnchorId, "mug", "valid lasso must resolve its freehand loop toward the grounded anchor");

  renderer.loadFixture("ambiguous");
  renderer.renderOnce(2_040);
  snapshot = renderer.getSnapshot();
  assert.match(`${snapshot.lasso.feedback} ${snapshot.message}`, /Tighten the loop around one object\./i);
  assert.ok(snapshot.lasso.points.length >= 4, "ambiguous lasso must preserve its candidate region");

  renderer.ingestSpatialResult({
    objects: [],
    hands: [],
    relations: [],
    interactions: [],
    selection_status: "unsupported",
    lasso: {
      points: circlePoints(),
      valid: false,
      feedback: "No visible object could be grounded there."
    },
    uncertainty: { level: "high" }
  });
  renderer.renderOnce(2_080);
  snapshot = renderer.getSnapshot();
  assert.equal(snapshot.anchors.length, 0, "unsupported selection must never fabricate an object anchor");
  assert.match(`${snapshot.lasso.feedback} ${snapshot.message}`, /No visible object could be grounded there\./i);

  renderer.ingestSpatialResult({
    objects: spatialScene({}).objects,
    hands: [],
    relations: [],
    interactions: [],
    selection: { status: "unsupported" },
    lasso: { points: circlePoints(), valid: false }
  });
  assert.equal(renderer.getSnapshot().anchors.length, 0, "nested unsupported selection must clear candidate anchors");

  renderer.dismissOverlay();
  snapshot = renderer.getSnapshot();
  assert.equal(snapshot.message, "", "temporary evidence overlay must be dismissible");
  renderer.dispose();
}

function verifyAnchorsAndRelations() {
  const renderer = createNeuralFieldRenderer(new FakeCanvas(800, 500), { now: () => 3_000, anchorSmoothing: 0.45 });
  renderer.setActive(true);
  renderer.ingestSpatialResult(spatialScene({ mugBox: [0.1, 0.25, 0.3, 0.58] }));
  renderer.renderOnce(3_000);
  let snapshot = renderer.getSnapshot();
  const firstMug = snapshot.anchors.find((anchor) => anchor.label === "Mug" || anchor.label === "mug");
  assert.ok(firstMug, "grounded object must render an anchor");
  assert.equal(firstMug.state, "selected");

  renderer.ingestSpatialResult(spatialScene({ mugBox: [0.24, 0.25, 0.44, 0.58] }));
  renderer.renderOnce(3_032);
  snapshot = renderer.getSnapshot();
  const movedMug = snapshot.anchors.find((anchor) => anchor.label.toLowerCase() === "mug");
  assert.ok(movedMug.bounds.x > firstMug.bounds.x, "anchor must follow bounded tracking updates");
  assert.ok(movedMug.bounds.x < 0.45, "anchor smoothing must avoid an unbounded tracking jump");

  renderer.loadFixture("uncertain");
  renderer.renderOnce(3_064);
  snapshot = renderer.getSnapshot();
  assert.ok(
    snapshot.anchors.some((anchor) => anchor.state === "tracking uncertain") || /Tracking uncertain/i.test(snapshot.status),
    "uncertain tracking must have a non-color textual state"
  );

  renderer.loadFixture("relation");
  renderer.renderOnce(3_096);
  snapshot = renderer.getSnapshot();
  assert.ok(snapshot.relations.length >= 1, "supported spatial relation must render a connector");
  assert.ok(snapshot.relations.some((relation) => /left of|approaching|closest/i.test(relation.label)));
  assert.ok(snapshot.relations.some((relation) => relation.directional), "directional relation must render an arrow");

  const normalized = normalizeRelations({
    relations: [
      { subject_id: "mug", subject_label: "Mug", relation: "left_of", reference_id: "laptop", reference_label: "Laptop", confidence: 0.92 },
      { subject_id: "mug", subject_label: "Mug", relation: "emotionally_attached_to", reference_id: "laptop", reference_label: "Laptop", confidence: 1 }
    ],
    interactions: [
      { type: "hand_approaches_object", subject_id: "hand", subject_label: "Hand", reference_id: "mug", reference_label: "Mug", confidence: 0.88 }
    ]
  }, [
    { id: "mug", label: "Mug" }, { id: "laptop", label: "Laptop" }, { id: "hand", label: "Hand" }
  ]);
  assert.ok(normalized.some((relation) => relation.predicate === "left_of"));
  assert.ok(normalized.some((relation) => relation.predicate === "approaching" || /approach/i.test(relation.label)));
  assert.ok(normalized.filter((relation) => relation.directional).length >= 1);
  assert.equal(normalized.some((relation) => /emotion/i.test(relation.predicate)), false, "unsupported relation must be omitted");

  renderer.ingestSpatialResult({
    objects: spatialScene({}).objects,
    hands: [],
    relations: [{ subject_id: "mug", relation: "emotionally_attached_to", reference_id: "laptop", confidence: 1 }],
    interactions: [],
    uncertainty: { level: "low" }
  });
  renderer.renderOnce(3_128);
  assert.equal(renderer.getSnapshot().relations.length, 0, "renderer must not display unsupported relations");

  renderer.setTrackingAvailability(false);
  renderer.renderOnce(3_160);
  snapshot = renderer.getSnapshot();
  assert.ok(snapshot.anchors.length === 0 || snapshot.anchors.every((anchor) => anchor.state === "lost"), "tracking loss must be explicit or cleaned up");
  renderer.renderOnce(8_500);
  assert.equal(renderer.getSnapshot().anchors.length, 0, "lost anchors must be released after their bounded grace period");
  renderer.dispose();
}

function verifyLabelPlacementAndFaceSafety() {
  const viewport = { width: 800, height: 500 };
  const face = { x: 310, y: 90, width: 180, height: 220 };
  const occupied = { x: 500, y: 205, width: 150, height: 40 };
  const layout = placeLabel({ x: 400, y: 220 }, { width: 150, height: 36 }, [face, occupied], viewport);
  assert.equal(layout.collides, false, "label placement must avoid occupied and face regions");
  assert.equal(rectsOverlap(layout, face), false, "label must stay outside the central face region");
  assert.ok(layout.x >= 0 && layout.y >= 0 && layout.x + layout.width <= viewport.width && layout.y + layout.height <= viewport.height);

  const renderer = createNeuralFieldRenderer(new FakeCanvas(800, 500), { now: () => 4_000 });
  renderer.setActive(true);
  renderer.setFaceBounds(face);
  renderer.ingestSpatialResult(spatialScene({ mugBox: [0.38, 0.25, 0.58, 0.6] }));
  renderer.renderOnce(4_000);
  const snapshot = renderer.getSnapshot();
  assert.deepEqual(snapshot.faceBounds, [face]);
  assert.ok(snapshot.labelLayouts.length >= 1);
  assert.equal(snapshot.labelLayouts.some((item) => rectsOverlap(item, face)), false, "renderer labels must be face-safe");
  assert.equal(hasAnyOverlap(snapshot.labelLayouts), false, "renderer label layouts must avoid each other");
  renderer.dispose();

  const normalizedRenderer = createNeuralFieldRenderer(new FakeCanvas(800, 500), { now: () => 4_100 });
  normalizedRenderer.setActive(true);
  normalizedRenderer.ingestSpatialResult({
    ...spatialScene({ mugBox: [0.38, 0.25, 0.58, 0.6] }),
    faces: [{ label: "Person", bbox: [0.34, 0.12, 0.66, 0.64] }]
  });
  normalizedRenderer.renderOnce(4_100);
  const normalizedSnapshot = normalizedRenderer.getSnapshot();
  const facePixels = { x: 272, y: 60, width: 256, height: 260 };
  assert.equal(normalizedSnapshot.labelLayouts.some((item) => rectsOverlap(item, facePixels)), false, "normalized live face bounds must be converted before collision avoidance");
  normalizedRenderer.dispose();
}

function verifyReducedMotionAndResponsiveSizing() {
  const canvas = new FakeCanvas(640, 360);
  const renderer = createNeuralFieldRenderer(canvas, { now: () => 5_000 });
  renderer.setActive(true);
  renderer.loadFixture("airscript");
  renderer.setReducedMotion(false);
  renderer.renderOnce(5_000);
  const normalEffects = canvas.context.effectCount();
  canvas.context.reset();
  renderer.setReducedMotion(true);
  renderer.renderOnce(5_016);
  const reducedEffects = canvas.context.effectCount();
  assert.equal(renderer.getSnapshot().reducedMotion, true);
  assert.ok(reducedEffects <= normalEffects, "reduced motion must not add animated bloom or pulse work");

  const viewports = [
    [1_728, 1_117], [1_440, 900], [1_024, 768], [768, 1_024], [412, 915], [390, 844]
  ];
  for (const [width, height] of viewports) {
    canvas.resize(width, Math.max(220, Math.round(height * 0.52)));
    renderer.renderOnce(5_100 + width);
    const snapshot = renderer.getSnapshot();
    assert.equal(canvas.width, width * 2, `${width}px canvas backing width is not DPR aware`);
    assert.equal(snapshot.width, width, `${width}px renderer CSS width is stale after resize`);
    assert.ok(snapshot.labelLayouts.every((item) => item.x >= 0 && item.x + item.width <= width + 1), `${width}px labels leave the viewport`);
  }
  renderer.dispose();
}

async function verifyReplayConsentAndPrivacy() {
  FakeMediaRecorder.instances.length = 0;
  const renderer = createNeuralFieldRenderer(new FakeCanvas(640, 360), { now: () => 6_000 });
  renderer.setActive(true);
  renderer.loadFixture("airscript");
  const outputCanvas = new FakeCanvas(640, 360);
  const compositor = new LocalReplayCompositor({
    renderer,
    canvas: outputCanvas,
    video: new FakeVideo(),
    MediaRecorderClass: FakeMediaRecorder,
    maxDurationMs: 2_000
  });
  assert.equal(FakeMediaRecorder.instances.length, 0, "replay compositor must never record automatically");
  assert.equal(outputCanvas.captureStreamCalls, 0, "replay stream must not exist before explicit consent");
  await assert.rejects(async () => compositor.start(), /consent/i, "replay start without consent must fail safely");
  assert.equal(FakeMediaRecorder.instances.length, 0);

  const started = await compositor.start({ consent: true, durationMs: 900 });
  assert.notEqual(started, false, "consented replay should start when MediaRecorder is available");
  assert.equal(outputCanvas.captureStreamCalls, 1);
  assert.equal(FakeMediaRecorder.instances.length, 1);
  assert.equal(FakeMediaRecorder.instances[0].startCalls, 1);
  const recordingSnapshot = compositor.getState();
  assert.equal(recordingSnapshot.recording, true);
  assert.ok(recordingSnapshot.durationMs <= 2_000 || recordingSnapshot.maxDurationMs <= 2_000, "recording duration must be bounded");

  const discardedResult = await compositor.stop();
  assert.ok(discardedResult == null || discardedResult.discarded === true, "stop must discard by default");
  const discarded = compositor.getState();
  assert.equal(discarded.recording, false);
  assert.equal(discarded.hasRecording ?? discarded.hasBlob ?? false, false, "replay must discard locally by default");

  const retainedStart = await compositor.start({ consent: true, durationMs: 900 });
  assert.notEqual(retainedStart, false);
  const localResult = await compositor.stop({ discard: false });
  assert.ok(localResult instanceof Blob || localResult?.blob instanceof Blob, "explicitly retained replay must remain a local Blob");
  await compositor.dispose();
  assert.equal(compositor.getState().disposed, true);
  assert.equal(FakeMediaRecorder.instances.every((instance) => instance.stream.getTracks().every((track) => track.stopped)), true, "replay tracks must be cleaned up");

  const racingCompositor = new LocalReplayCompositor({
    renderer,
    canvas: new FakeCanvas(640, 360),
    video: new FakeVideo(),
    MediaRecorderClass: FakeMediaRecorder,
    maxDurationMs: 2_000
  });
  await racingCompositor.start({ consent: true, durationMs: 900 });
  await racingCompositor.dispose();
  await racingCompositor.dispose();
  assert.deepEqual(racingCompositor.chunks, [], "dispose must ignore late recorder data and discard chunks");
  assert.equal(racingCompositor.getState().hasRecording, false, "dispose must not recreate a replay blob after discard");

  const sourcePath = fileURLToPath(new URL("../prototype/neural-field/replay-compositor.js", import.meta.url));
  const source = await readFile(sourcePath, "utf8");
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB|caches\.)\b/, "replay compositor must not persist raw media");
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/, "replay compositor must not upload recordings");
  renderer.dispose();
}

function handFrame(sample, timestamp, pinching) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: sample.x, y: sample.y, z: sample.depth ?? 0.4, visibility: sample.confidence ?? 0.95 }));
  landmarks[4] = { x: sample.x - (pinching ? 0.005 : 0.08), y: sample.y, z: sample.depth ?? 0.4, visibility: sample.confidence ?? 0.95 };
  landmarks[8] = { x: sample.x, y: sample.y, z: sample.depth ?? 0.4, visibility: sample.confidence ?? 0.95 };
  return {
    timestamp_ms: timestamp,
    hands: [{ handedness: "Right", confidence: sample.confidence ?? 0.95, landmarks }],
    mirrored: false,
    confidence: sample.confidence ?? 0.95,
    pinching
  };
}

function spatialScene(options = {}) {
  const mugBox = options.mugBox || [0.12, 0.25, 0.32, 0.58];
  return {
    objects: [
      { id: "mug", label: "Mug", confidence: 0.93, bbox: mugBox },
      { id: "laptop", label: "Laptop", confidence: 0.9, bbox: [0.58, 0.32, 0.88, 0.7] }
    ],
    hands: [],
    relations: [{ subject_id: "mug", subject_label: "Mug", relation: "left_of", reference_id: "laptop", reference_label: "Laptop", confidence: 0.92 }],
    interactions: [],
    selected_object_id: "mug",
    selection_status: "selected",
    uncertainty: { level: "low" }
  };
}

function circlePoints(count = 36) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return point(0.5 + Math.cos(angle) * 0.22, 0.5 + Math.sin(angle) * 0.22, 0.42);
  });
}

function arrowPoints() {
  return [
    point(0.12, 0.5), point(0.26, 0.5), point(0.42, 0.5), point(0.58, 0.5), point(0.74, 0.5),
    point(0.62, 0.39), point(0.74, 0.5), point(0.62, 0.61)
  ];
}

function point(x, y, depth = 0.4, confidence = 0.95) {
  return { x, y, depth, confidence };
}

function assertPointNear(actual, expected, tolerance, message) {
  assert.ok(actual && Number.isFinite(actual.x) && Number.isFinite(actual.y), `${message}: missing normalized point`);
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance, `${message}: x ${actual.x} differs from ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= tolerance, `${message}: y ${actual.y} differs from ${expected.y}`);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function hasAnyOverlap(rects) {
  return rects.some((rect, index) => rects.slice(index + 1).some((candidate) => rectsOverlap(rect, candidate)));
}

class FakeCanvas {
  constructor(width, height) {
    this.clientWidth = width;
    this.clientHeight = height;
    this.width = width;
    this.height = height;
    this.style = {};
    this.context = new FakeCanvasContext();
    this.captureStreamCalls = 0;
  }

  getContext(type) {
    return type === "2d" ? this.context : null;
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
  }

  resize(width, height) {
    this.clientWidth = width;
    this.clientHeight = height;
  }

  captureStream() {
    this.captureStreamCalls += 1;
    return new FakeMediaStream();
  }
}

class FakeCanvasContext {
  constructor() {
    this.operations = [];
    this.globalAlpha = 1;
    this.globalCompositeOperation = "source-over";
    this.filter = "none";
    this.shadowBlur = 0;
    this.shadowColor = "transparent";
    this.lineWidth = 1;
    this.lineCap = "butt";
    this.lineJoin = "miter";
    this.strokeStyle = "#000";
    this.fillStyle = "#000";
    this.font = "12px sans-serif";
    this.textAlign = "left";
    this.textBaseline = "alphabetic";
  }

  record(name, args) { this.operations.push({ name, args: [...args] }); }
  count(name) { return this.operations.filter((operation) => operation.name === name).length; }
  effectCount() { return this.operations.filter((operation) => ["stroke", "fill", "arc", "ellipse", "quadraticCurveTo", "bezierCurveTo"].includes(operation.name)).length; }
  reset() { this.operations.length = 0; }
  save(...args) { this.record("save", args); }
  restore(...args) { this.record("restore", args); }
  setTransform(...args) { this.record("setTransform", args); }
  resetTransform(...args) { this.record("resetTransform", args); }
  scale(...args) { this.record("scale", args); }
  translate(...args) { this.record("translate", args); }
  rotate(...args) { this.record("rotate", args); }
  clearRect(...args) { this.record("clearRect", args); }
  fillRect(...args) { this.record("fillRect", args); }
  strokeRect(...args) { this.record("strokeRect", args); }
  beginPath(...args) { this.record("beginPath", args); }
  closePath(...args) { this.record("closePath", args); }
  moveTo(...args) { this.record("moveTo", args); }
  lineTo(...args) { this.record("lineTo", args); }
  quadraticCurveTo(...args) { this.record("quadraticCurveTo", args); }
  bezierCurveTo(...args) { this.record("bezierCurveTo", args); }
  arc(...args) { this.record("arc", args); }
  ellipse(...args) { this.record("ellipse", args); }
  rect(...args) { this.record("rect", args); }
  roundRect(...args) { this.record("roundRect", args); }
  clip(...args) { this.record("clip", args); }
  stroke(...args) { this.record("stroke", args); }
  fill(...args) { this.record("fill", args); }
  fillText(...args) { this.record("fillText", args); }
  strokeText(...args) { this.record("strokeText", args); }
  drawImage(...args) { this.record("drawImage", args); }
  setLineDash(...args) { this.record("setLineDash", args); }
  measureText(text) { return { width: String(text).length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }; }
  createLinearGradient(...args) { this.record("createLinearGradient", args); return new FakeGradient(); }
  createRadialGradient(...args) { this.record("createRadialGradient", args); return new FakeGradient(); }
}

class FakeGradient {
  addColorStop() {}
}

class FakeVideo {
  constructor() {
    this.readyState = 4;
    this.videoWidth = 640;
    this.videoHeight = 360;
  }
}

class FakeMediaStream {
  constructor() {
    this.tracks = [{ kind: "video", stopped: false, stop() { this.stopped = true; } }];
  }
  getTracks() { return this.tracks; }
}

class FakeMediaRecorder {
  static instances = [];
  static isTypeSupported() { return true; }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.options = options;
    this.state = "inactive";
    this.startCalls = 0;
    this.listeners = new Map();
    FakeMediaRecorder.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  start() {
    this.startCalls += 1;
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    queueMicrotask(() => {
      const data = new Blob(["local replay"], { type: "video/webm" });
      this.ondataavailable?.({ data });
      for (const listener of this.listeners.get("dataavailable") || []) listener({ data });
      this.onstop?.();
      for (const listener of this.listeners.get("stop") || []) listener();
    });
  }
}

function restoreGlobal(name, value) {
  if (value === undefined) delete globalThis[name];
  else Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

try {
  verifyPureRenderingMath();
  verifyRendererLifecycleAndTrajectories();
  verifyInputFallbacksAndConsumerIsolation();
  verifyLassoStates();
  verifyAnchorsAndRelations();
  verifyLabelPlacementAndFaceSafety();
  verifyReducedMotionAndResponsiveSizing();
  await verifyReplayConsentAndPrivacy();
  process.stdout.write("neural field rendering unit tests passed\n");
} finally {
  restoreGlobal("devicePixelRatio", originalDevicePixelRatio);
  restoreGlobal("requestAnimationFrame", originalRequestAnimationFrame);
  restoreGlobal("cancelAnimationFrame", originalCancelAnimationFrame);
  restoreGlobal("matchMedia", originalMatchMedia);
}
