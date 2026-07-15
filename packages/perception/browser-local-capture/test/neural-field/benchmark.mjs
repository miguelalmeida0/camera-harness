import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";
import {
  LANDMARK_FIXTURES,
  SCENE_FIXTURES
} from "../../../../../fixtures/neural-field/fixture-library.mjs";
import { createNeuralFieldRuntime } from "./runtime.mjs";
import { startNeuralFieldTestServer } from "./support/static-server.mjs";

const TARGETS = Object.freeze({
  handToLineMs: envNumber("NEURAL_FIELD_MAX_HAND_TO_LINE_MS", 80),
  rendererFps: envNumber("NEURAL_FIELD_MIN_RENDERER_FPS", 30),
  perceptionFps: envNumber("NEURAL_FIELD_MIN_PERCEPTION_FPS", 24),
  memoryGrowthBytes: envNumber("NEURAL_FIELD_MAX_MEMORY_GROWTH_BYTES", 32 * 1024 * 1024),
  workerQueueDepth: envNumber("NEURAL_FIELD_MAX_WORKER_QUEUE_DEPTH", 4)
});

const samples = {
  eventLatencyMs: [],
  renderTimeMs: [],
  frameCount: 0,
  renderEventCount: 0,
  processingTimeMs: 0,
  resources: []
};

const memoryBefore = process.memoryUsage().heapUsed;
const runtime = createNeuralFieldRuntime();
await runtime.enter({ returnMode: "ask" });
await runtime.selectTool("airscript");

const stablePinch = frames(requiredFixture(LANDMARK_FIXTURES, "stable pinch"));
const slowCircle = frames(requiredFixture(LANDMARK_FIXTURES, "slow circle"));
const release = frames(requiredFixture(LANDMARK_FIXTURES, "release"));

const pinchStartedAt = performance.now();
let pinchToLineMs = null;
for (const frame of [...stablePinch, ...slowCircle]) {
  await feedMeasured(runtime, frame, samples);
  if (pinchToLineMs === null && strokePointCount(runtime.snapshot()) > 1) {
    pinchToLineMs = performance.now() - pinchStartedAt;
  }
}
for (const frame of release) await feedMeasured(runtime, frame, samples);

assert.ok(Number.isFinite(pinchToLineMs), "pinch must produce a measured stroke segment");
assert.ok(runtime.snapshot().classification, "release must run stroke classification");

const lassoRuntime = createNeuralFieldRuntime();
await lassoRuntime.enter({ returnMode: "watch" });
await lassoRuntime.selectTool("spatial_lasso");

const sceneFixture = requiredFixture(SCENE_FIXTURES, "mug left of laptop");
const scene = sceneFixture.scene ?? sceneFixture;
await lassoRuntime.setScene(structuredClone(scene));

const lassoFrames = frames(requiredFixture(LANDMARK_FIXTURES, "valid lasso around one object"));
assert.ok(lassoFrames.length >= 2, "lasso benchmark requires drawing and commit frames");

const semanticBeforeDrawing = semanticRequestCount(lassoRuntime.getResourceSnapshot());
const lassoStartedAt = performance.now();
for (const frame of lassoFrames.slice(0, -1)) {
  await feedMeasured(lassoRuntime, frame, samples);
}
assert.equal(
  semanticRequestCount(lassoRuntime.getResourceSnapshot()),
  semanticBeforeDrawing,
  "ordinary drawing must not issue semantic requests"
);

const grounding = await feedMeasured(lassoRuntime, lassoFrames.at(-1), samples);
const lassoCompletionLatencyMs = performance.now() - lassoStartedAt;
const semanticAfterCommit = semanticRequestCount(lassoRuntime.getResourceSnapshot());
assert.ok(
  semanticAfterCommit - semanticBeforeDrawing <= 1,
  "an explicit lasso commit may issue at most one semantic request"
);

const mug = requiredObject(scene, "mug");
const objectGroundingLatencyMs = grounding.durationMs;
assert.equal(selectedObjectId(lassoRuntime.snapshot()), mug.id, "lasso resolution must ground the mug");

const relation = requiredRelation(scene, "left_of");
assert.equal(relation.type ?? relation.relation, "left_of", "scene relation contract must expose left_of");
const laptop = requiredObject(scene, "laptop");
const laptopLasso = translateFrames(lassoFrames, centerX(laptop) - centerX(mug));
const semanticBeforeSecondCommit = semanticRequestCount(lassoRuntime.getResourceSnapshot());
for (const frame of laptopLasso.slice(0, -1)) await feedMeasured(lassoRuntime, frame, samples);
assert.equal(
  semanticRequestCount(lassoRuntime.getResourceSnapshot()),
  semanticBeforeSecondCommit,
  "relation drawing must not issue continuous semantic requests"
);
await feedMeasured(lassoRuntime, laptopLasso.at(-1), samples);
const semanticAfterSecondCommit = semanticRequestCount(lassoRuntime.getResourceSnapshot());
const semanticRequestsPerCommit = [
  semanticAfterCommit - semanticBeforeDrawing,
  semanticAfterSecondCommit - semanticBeforeSecondCommit
];
assert.ok(semanticRequestsPerCommit.every((count) => count <= 1), "each explicit commit may issue at most one semantic request");
assert.ok(relationTypes(lassoRuntime.snapshot()).includes("left_of"), "two-object lasso must derive the scene relation");
const renderCountBeforeMove = lassoRuntime.getRenderTimeline().length;
const relationRender = await timed(() => lassoRuntime.moveObject(mug.id, movementPatch(mug)));
const relationRenderLatencyMs = relationRender.durationMs;
assert.ok(lassoRuntime.getRenderTimeline().length > renderCountBeforeMove, "object tracking must emit a relation render event");
assert.ok(
  relationTypes(lassoRuntime.snapshot()).includes("left_of"),
  "object tracking must preserve the derived relation"
);

await runtime.exit({ returnMode: "ask" });
await lassoRuntime.exit({ returnMode: "watch" });
samples.resources.push(runtime.getResourceSnapshot(), lassoRuntime.getResourceSnapshot());

const memoryAfter = process.memoryUsage().heapUsed;
const memoryGrowthBytes = Math.max(0, memoryAfter - memoryBefore);
const eventTimeline = runtime.getEventTimeline();
const renderTimeline = runtime.getRenderTimeline();
assertInstrumentedTimeline(eventTimeline, "event");
assertInstrumentedTimeline(renderTimeline, "render");
const browserRenderer = await measureBrowserRenderer();

const handInferenceFps = rate(samples.frameCount, samples.processingTimeMs);
const rendererEventThroughputFps = rate(samples.renderEventCount, samples.processingTimeMs);
const metrics = {
  environment: {
    ci: Boolean(process.env.CI),
    platform: process.platform,
    rendererMeasurement: "headless Chrome DOM updates paced by requestAnimationFrame"
  },
  handInferenceFps: round(handInferenceFps),
  eventLatencyMs: distribution(samples.eventLatencyMs),
  rendererFps: round(browserRenderer.fps),
  rendererEventThroughputFps: round(rendererEventThroughputFps),
  renderTimeMs: browserRenderer.renderTimeMs,
  pinchToLineLatencyMs: round(pinchToLineMs),
  lassoCompletionLatencyMs: round(lassoCompletionLatencyMs),
  objectGroundingLatencyMs: round(objectGroundingLatencyMs),
  relationRenderLatencyMs: round(relationRenderLatencyMs),
  memoryGrowthBytes,
  workerQueueDepth: peakResource(samples.resources, ["peakWorkerQueueDepth", "workerQueueDepth", "queuedWorkerEvents"]),
  rendererResourceCount: peakResource(samples.resources, ["rendererResourceCount", "activeRenderers"]),
  semanticRequestCount: semanticAfterSecondCommit - semanticBeforeDrawing,
  maxSemanticRequestsPerCommit: Math.max(...semanticRequestsPerCommit)
};

assert.ok(metrics.handInferenceFps > TARGETS.perceptionFps, `perception throughput must exceed ${TARGETS.perceptionFps} FPS`);
assert.ok(metrics.rendererFps > TARGETS.rendererFps, `renderer throughput must exceed ${TARGETS.rendererFps} FPS`);
assert.ok(metrics.pinchToLineLatencyMs <= TARGETS.handToLineMs, `pinch-to-line latency must be at most ${TARGETS.handToLineMs} ms`);
assert.ok(metrics.memoryGrowthBytes <= TARGETS.memoryGrowthBytes, "benchmark memory growth must remain bounded");
assert.ok(metrics.workerQueueDepth <= TARGETS.workerQueueDepth, "worker queue depth must remain bounded");
assert.ok(metrics.rendererResourceCount <= 1, "only one renderer resource may be active");
assert.ok(metrics.maxSemanticRequestsPerCommit <= 1, "one explicit commit may issue at most one semantic request");

console.log(JSON.stringify({
  benchmark: "sensefield-neural-field",
  targets: TARGETS,
  metrics
}, null, 2));

async function feedMeasured(target, frame, targetSamples) {
  const renderBefore = target.getRenderTimeline().length;
  const sample = await timed(() => target.feedLandmarkFrame(structuredClone(frame)));
  const rendered = target.getRenderTimeline().length - renderBefore;

  targetSamples.frameCount += 1;
  targetSamples.processingTimeMs += sample.durationMs;
  targetSamples.eventLatencyMs.push(sample.durationMs);
  if (rendered > 0) {
    targetSamples.renderEventCount += rendered;
    targetSamples.renderTimeMs.push(sample.durationMs);
  }
  targetSamples.resources.push(target.getResourceSnapshot());
  return sample;
}

async function timed(action) {
  const startedAt = performance.now();
  const result = await action();
  const durationMs = performance.now() - startedAt;
  assert.ok(Number.isFinite(durationMs) && durationMs >= 0, "measured operation must expose a finite duration");
  return { result, durationMs };
}

function requiredFixture(catalog, requestedId) {
  const requested = normalize(requestedId);
  for (const [key, value] of Object.entries(catalog)) {
    const ids = [key, value?.id, value?.name, value?.scenario].filter(Boolean).map(normalize);
    if (ids.includes(requested)) return value;
  }
  assert.fail(`required fixture unavailable: ${requestedId}`);
}

function frames(fixture) {
  const value = Array.isArray(fixture)
    ? fixture
    : fixture?.frames ?? fixture?.landmarkFrames ?? fixture?.sequence;
  assert.ok(Array.isArray(value) && value.length > 0, `fixture ${fixture?.id ?? "unknown"} must contain frames`);
  return value;
}

function requiredObject(scene, label) {
  const object = (scene.objects ?? []).find((candidate) => normalize(candidate.label ?? candidate.name ?? candidate.id) === normalize(label));
  assert.ok(object?.id, `scene must contain object: ${label}`);
  return object;
}

function requiredRelation(scene, type) {
  const relation = (scene.relations ?? []).find((candidate) => (candidate.type ?? candidate.relation) === type);
  assert.ok(relation, `scene must contain relation: ${type}`);
  return relation;
}

function strokePointCount(snapshot) {
  return snapshot.stroke?.points?.length
    ?? snapshot.stroke?.segments?.length
    ?? snapshot.state?.stroke?.points?.length
    ?? 0;
}

function selectedObjectId(snapshot) {
  return snapshot.selection?.objectId
    ?? snapshot.selection?.selectedObjectId
    ?? snapshot.selection?.targetId
    ?? snapshot.selection?.anchorId
    ?? snapshot.state?.selection?.objectId
    ?? null;
}

function relationTypes(snapshot) {
  return (snapshot.relations ?? snapshot.state?.relations ?? []).map((relation) => relation.type ?? relation.relation);
}

function movementPatch(object) {
  if (object.bounds) {
    return { bounds: { ...object.bounds, x: Number(object.bounds.x ?? 0) + 0.05 } };
  }
  if (object.bbox) {
    return { bbox: { ...object.bbox, x: Number(object.bbox.x ?? 0) + 0.05 } };
  }
  return { x: Number(object.x ?? 0) + 0.05 };
}

function translateFrames(sourceFrames, dx) {
  return sourceFrames.map((frame) => ({
    ...structuredClone(frame),
    hands: (frame.hands ?? []).map((hand) => ({
      ...structuredClone(hand),
      landmarks: hand.landmarks.map((point) => ({ ...point, x: point.x + dx })),
      thumb_tip: hand.thumb_tip ? { ...hand.thumb_tip, x: hand.thumb_tip.x + dx } : hand.thumb_tip,
      index_tip: hand.index_tip ? { ...hand.index_tip, x: hand.index_tip.x + dx } : hand.index_tip
    }))
  }));
}

function centerX(object) {
  const box = object.bbox ?? object.bounds;
  assert.ok(box && Number.isFinite(box.x) && Number.isFinite(box.width), `object ${object.id} requires a bounding box`);
  return box.x + box.width / 2;
}

function semanticRequestCount(resources) {
  return requiredResource(resources, ["semanticRequestCount", "semanticRequests"]);
}

function peakResource(resources, names) {
  return Math.max(0, ...resources.map((snapshot) => requiredResource(snapshot, names)));
}

function requiredResource(resources, names) {
  for (const name of names) {
    if (Number.isFinite(resources?.[name])) return resources[name];
  }
  const unavailable = new Set(resources?.unavailable ?? resources?.unavailableResources ?? []);
  if (names.some((name) => unavailable.has(name))) return 0;
  assert.fail(`resource instrumentation unavailable: ${names.join("|")}`);
}

function assertInstrumentedTimeline(timeline, label) {
  assert.ok(Array.isArray(timeline) && timeline.length > 0, `${label} timeline must not be empty`);
  for (const event of timeline) {
    assert.equal(typeof event.type, "string", `${label} event type is required`);
    assert.ok(Number.isFinite(event.timestampMs ?? event.atMs ?? event.timeMs), `${label} event timestamp is required`);
  }
}

function distribution(values) {
  assert.ok(values.length > 0, "metric distribution requires measured samples");
  return {
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    max: round(Math.max(...values))
  };
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index];
}

function rate(count, elapsedMs) {
  assert.ok(count > 0, "throughput requires processed events");
  assert.ok(elapsedMs > 0, "throughput requires measured elapsed time");
  return count / (elapsedMs / 1000);
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function envNumber(name, fallback) {
  if (process.env[name] === undefined) return fallback;
  const value = Number(process.env[name]);
  assert.ok(Number.isFinite(value) && value >= 0, `${name} must be a non-negative number`);
  return value;
}

async function measureBrowserRenderer() {
  const server = await startNeuralFieldTestServer({ port: 0 });
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--enable-precise-memory-info"]
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === server.origin) return route.continue();
      return route.abort("blockedbyclient");
    });
    await page.goto(`${server.origin}/neural-field/harness/`);
    await page.waitForFunction(() => window.__NEURAL_FIELD_TEST__?.ready === true);
    const measured = await page.evaluate(async () => {
      const proof = window.__NEURAL_FIELD_TEST__;
      await proof.enter("ask");
      await proof.selectTool("airscript");
      const before = proof.getMetrics().feed.count;
      const startedAt = performance.now();
      await proof.feedLandmarkFixture("slow_circle", { animate: true });
      const elapsedMs = performance.now() - startedAt;
      const after = proof.getMetrics();
      const updateCount = after.feed.count - before;
      await proof.feedLandmarkFixture("release", { animate: true });
      await proof.exit("ask");
      return { elapsedMs, updateCount, render: after.render };
    });
    assert.ok(measured.updateCount >= 24, "browser benchmark must render a meaningful trajectory sample");
    assert.ok(measured.elapsedMs > 0, "browser renderer elapsed time must be measured");
    return {
      fps: measured.updateCount / (measured.elapsedMs / 1000),
      renderTimeMs: {
        p50: round(measured.render.p50Ms),
        p95: round(measured.render.p95Ms),
        max: round(measured.render.maxMs)
      }
    };
  } finally {
    await browser?.close();
    await server.close();
  }
}
