#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import {
  DEFAULT_TRAJECTORY_OPTIONS,
  createHandGeometryTracker,
  createNeuralFieldPerceptionPipeline,
  filterTrajectory
} from "../prototype/perception/neural-field-perception.js";
import { createNeuralFieldWorkerClient } from "../prototype/perception/neural-field-worker-client.js";
import { makeRawHandFrame, makeTrajectoryFromVertices, NEURAL_FIELD_FIXTURES as FIXTURES } from "../test/fixtures/neural-field-landmarks.mjs";

class BenchmarkWorker {
  constructor() { this.listeners = new Set(); }
  addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === "message") this.listeners.delete(listener); }
  postMessage(message) {
    if (message.type === "init") return this.emit({ type: "gesture_engine_ready" });
    if (message.type === "process_frame") return this.emit({ type: "hand_frame", timestamp: message.timestamp, hands: [], processingMs: 0.2 });
    if (message.type === "stop") return this.emit({ type: "gesture_engine_stopped" });
  }
  terminate() {}
  emit(data) { for (const listener of this.listeners) listener({ data }); }
}

const memoryBefore = process.memoryUsage();
const cpuBefore = process.cpuUsage();
const tracker = createHandGeometryTracker();
const pipeline = createNeuralFieldPerceptionPipeline({
  pinch: { minimumStableFrames: 2, debounceMs: 20 },
  stroke: { maximumPointCount: 512 }
});
const processingSamples = [];
const strokePointSamples = [];
const frameCount = 2400;
const replayStarted = performance.now();

for (let index = 0; index < frameCount; index += 1) {
  const angle = (index / 90) * Math.PI * 2;
  const fixture = makeRawHandFrame({
    timestamp: index * (1000 / 30),
    hands: [{
      handedness: "right",
      indexTip: { x: 0.5 + Math.cos(angle) * 0.18, y: 0.48 + Math.sin(angle) * 0.18, z: -0.03 },
      pinchRatio: index % 180 < 120 ? 0.2 : 0.7,
      confidence: 0.96
    }]
  });
  const started = performance.now();
  const handFrame = tracker.process(fixture.result, fixture);
  const handReady = performance.now();
  pipeline.processFrame(handFrame);
  const finished = performance.now();
  processingSamples.push(finished - started);
  strokePointSamples.push(finished - handReady);
}

const replayElapsedMs = performance.now() - replayStarted;
const postInferenceFps = frameCount / (replayElapsedMs / 1000);
const workerMetrics = measureWorkerProtocol(360);
const pinchMetrics = measurePinchStart();
const filterMetrics = measureFilters();
const filterSelection = selectFilter(filterMetrics);
const memoryAfter = process.memoryUsage();
const cpuAfter = process.cpuUsage(cpuBefore);
const longTaskCount = processingSamples.filter((sample) => sample >= 50).length;

const report = {
  schema_version: "sensefield.neural_field_perception_benchmark.v1",
  measurement_scope: "synthetic_landmark_replay_post_mediapipe",
  hand_inference_fps: null,
  synthetic_hand_frame_fps: round(postInferenceFps),
  target_24_fps_met_for_post_inference_pipeline: postInferenceFps > 24,
  median_processing_latency_ms: round(percentile(processingSamples, 0.5)),
  p95_processing_latency_ms: round(percentile(processingSamples, 0.95)),
  frame_drop_rate: round(workerMetrics.frameDropRate),
  worker_queue_depth: workerMetrics.maxQueueDepth,
  hand_to_event_latency_ms: round(workerMetrics.medianEventLatencyMs),
  pinch_start_latency_ms: pinchMetrics.startLatencyMs,
  stroke_point_latency_ms: round(percentile(strokePointSamples, 0.5)),
  memory_use: {
    heap_used_bytes: memoryAfter.heapUsed,
    heap_delta_bytes: Math.max(0, memoryAfter.heapUsed - memoryBefore.heapUsed),
    rss_bytes: memoryAfter.rss
  },
  cpu_use: {
    user_ms: round(cpuAfter.user / 1000),
    system_ms: round(cpuAfter.system / 1000),
    cpu_to_wall_ratio: round((cpuAfter.user + cpuAfter.system) / 1000 / Math.max(replayElapsedMs, 0.001))
  },
  main_thread_long_tasks_over_50ms: longTaskCount,
  main_thread_hand_inference: false,
  filters: filterMetrics,
  filter_selection_scores: filterSelection.scores,
  configured_default_filter: DEFAULT_TRAJECTORY_OPTIONS.filter,
  selected_default_filter: filterSelection.selected,
  privacy: {
    local_processing_only: true,
    synthetic_landmarks_only: true,
    raw_media_persisted: false,
    cloud_inference_calls: 0
  },
  limitations: [
    "This headless run measures deterministic landmark normalization, event processing, trajectory filtering, and the bounded worker protocol.",
    "MediaPipe WASM/model inference FPS and camera-to-worker transfer cost require a physical browser/device session and are not represented by hand_inference_fps.",
    "CPU figures are process-level samples and may include Node.js runtime overhead."
  ]
};

console.log(JSON.stringify(report, null, 2));
if (!(report.synthetic_hand_frame_fps > 24)) throw new Error("Post-inference hand pipeline did not sustain 24 FPS.");
if (report.worker_queue_depth > 1) throw new Error("Worker message queue exceeded one in-flight frame in the benchmark.");
if (report.p95_processing_latency_ms >= 80) throw new Error("Post-inference p95 latency exceeded 80 ms.");
if (report.main_thread_long_tasks_over_50ms > 0) throw new Error("Post-inference processing created a long task.");
if (report.selected_default_filter !== report.configured_default_filter) throw new Error("Measured filter balance no longer supports the configured default.");
console.log("SENSEFIELD_NEURAL_FIELD_PERCEPTION_BENCHMARK_OK");

function measureWorkerProtocol(count) {
  const worker = new BenchmarkWorker();
  const client = createNeuralFieldWorkerClient({ createWorker: () => worker });
  client.start();
  for (let index = 0; index < count; index += 1) {
    client.processFrame({ frame: { close() {} }, timestamp: index + 1, frameWidth: 640, frameHeight: 360, mirrored: true });
  }
  const diagnostics = client.getDiagnostics();
  client.dispose();
  return diagnostics;
}

function measurePinchStart() {
  const localTracker = createHandGeometryTracker();
  const localPipeline = createNeuralFieldPerceptionPipeline({ pinch: { minimumStableFrames: 2, debounceMs: 20 } });
  const firstEvidenceAt = FIXTURES.stablePinch[0].timestamp;
  let startedAt = null;
  for (const fixture of FIXTURES.stablePinch) {
    const handFrame = localTracker.process(fixture.result, fixture);
    const started = localPipeline.processFrame(handFrame).events.find((event) => event.type === "pinch_started");
    if (started) { startedAt = started.timestamp; break; }
  }
  return { startLatencyMs: startedAt == null ? null : startedAt - firstEvidenceAt };
}

function measureFilters() {
  const truth = Array.from({ length: 120 }, (_, index) => ({
    x: 0.18 + index / 119 * 0.64,
    y: 0.5 + Math.sin(index / 119 * Math.PI * 2) * 0.16,
    z: 0,
    timestamp: index * 16,
    confidence: 0.96,
    velocity: 0
  }));
  const noisy = truth.map((point, index) => ({
    ...point,
    x: point.x + Math.sin(index * 5.31) * 0.008,
    y: point.y + Math.cos(index * 4.73) * 0.009
  }));
  const cornerTruth = makeTrajectoryFromVertices([
    { x: 0.2, y: 0.75 }, { x: 0.52, y: 0.24 }, { x: 0.84, y: 0.75 }
  ], { samplesPerSegment: 24, intervalMs: 16 });
  const inputJitter = highFrequencyError(noisy, truth);
  return Object.fromEntries(["one_euro", "exponential", "kalman"].map((mode) => {
    const started = performance.now();
    let output;
    for (let iteration = 0; iteration < 80; iteration += 1) output = filterTrajectory(noisy, { filter: mode, minimumPointDistance: 0 });
    const cpuMs = (performance.now() - started) / 80;
    const cornerOutput = filterTrajectory(cornerTruth, { filter: mode, minimumPointDistance: 0, rdpEpsilon: 0.004 });
    const corner = { x: 0.52, y: 0.24 };
    const cornerError = Math.min(...cornerOutput.simplifiedPoints.map((point) => distance(point, corner)));
    const outputError = highFrequencyError(output.smoothedPoints, truth);
    return [mode, {
      jitter_reduction_ratio: round(1 - outputError / inputJitter),
      latency_proxy_ms: round(lagProxyMs(output.smoothedPoints, truth)),
      overshoot: round(overshoot(output.smoothedPoints, truth)),
      corner_preservation_ratio: round(Math.max(0, 1 - cornerError / 0.2)),
      cpu_ms_per_trajectory: round(cpuMs)
    }];
  }));
}

function highFrequencyError(actual, expected) {
  const count = Math.min(actual.length, expected.length);
  const errors = actual.slice(0, count).map((point, index) => ({ x: point.x - expected[index].x, y: point.y - expected[index].y }));
  return Math.sqrt(errors.reduce((sum, error, index) => {
    const start = Math.max(0, index - 3);
    const end = Math.min(errors.length, index + 4);
    const local = errors.slice(start, end);
    const meanX = local.reduce((total, item) => total + item.x, 0) / local.length;
    const meanY = local.reduce((total, item) => total + item.y, 0) / local.length;
    return sum + (error.x - meanX) ** 2 + (error.y - meanY) ** 2;
  }, 0) / Math.max(1, count));
}

function selectFilter(metrics) {
  const scores = Object.fromEntries(Object.entries(metrics).map(([name, values]) => [name, round(
    values.jitter_reduction_ratio * 0.5
      + values.corner_preservation_ratio * 0.35
      - Math.min(1, values.latency_proxy_ms / 80) * 0.1
      - Math.min(1, values.overshoot / 0.02) * 0.03
      - Math.min(1, values.cpu_ms_per_trajectory) * 0.02
  )]));
  const selected = Object.entries(scores).sort((first, second) => second[1] - first[1])[0]?.[0] || "one_euro";
  return { selected, scores };
}

function lagProxyMs(actual, expected) {
  const count = Math.min(actual.length, expected.length);
  const averageSpeed = expected.slice(1, count).reduce((sum, point, index) => sum + distance(point, expected[index]) / 0.016, 0) / Math.max(1, count - 1);
  const displacement = actual.slice(0, count).reduce((sum, point, index) => sum + distance(point, expected[index]), 0) / Math.max(1, count);
  return averageSpeed > 0 ? displacement / averageSpeed * 1000 : 0;
}

function overshoot(actual, expected) {
  const minX = Math.min(...expected.map((point) => point.x));
  const maxX = Math.max(...expected.map((point) => point.x));
  const minY = Math.min(...expected.map((point) => point.y));
  const maxY = Math.max(...expected.map((point) => point.y));
  return Math.max(0, ...actual.map((point) => Math.max(minX - point.x, point.x - maxX, minY - point.y, point.y - maxY)));
}

function percentile(values, proportion) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * proportion) - 1))] || 0;
}

function distance(first, second) { return Math.hypot(first.x - second.x, first.y - second.y); }
function round(value) { return Number(Number(value || 0).toFixed(4)); }
