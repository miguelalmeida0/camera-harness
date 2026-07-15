#!/usr/bin/env node
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createNeuralFieldRenderer } from "../prototype/neural-field/neural-field-renderer.js";

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
globalThis.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });

async function runBenchmark() {
try {
  const canvas = new BenchmarkCanvas(960, 540);
  const renderer = createNeuralFieldRenderer(canvas, {
    maxPathPoints: 512,
    maxCompletedStrokes: 8,
    now: () => performance.now()
  });
  renderer.setActive(true);
  renderer.setTool("airscript");

  const renderDurations = [];
  const workloadStart = performance.now();
  for (let index = 0; index < 1_600; index += 1) {
    const phase = index / 1_600;
    const x = 0.08 + phase * 0.84;
    const y = 0.5 + Math.sin(phase * Math.PI * 12) * 0.22;
    const depth = 0.48 + Math.sin(phase * Math.PI * 4) * 0.2;
    renderer.ingestHandFrame(handFrame(x, y, depth, index * 16, true));
    const started = performance.now();
    renderer.renderOnce(index * 16);
    renderDurations.push(performance.now() - started);
  }
  renderer.ingestHandFrame(handFrame(0.92, 0.5, 0.48, 25_616, false));

  renderer.setFaceBounds({ x: 360, y: 48, width: 240, height: 280 });
  const relationUpdateStarted = performance.now();
  renderer.ingestSpatialResult({
    objects: [
      { id: "mug", label: "Mug", confidence: 0.93, bbox: [0.12, 0.38, 0.32, 0.74] },
      { id: "laptop", label: "Laptop", confidence: 0.91, bbox: [0.62, 0.42, 0.9, 0.76] }
    ],
    hands: [],
    relations: [{ subject_id: "mug", subject_label: "Mug", relation: "left_of", reference_id: "laptop", reference_label: "Laptop", confidence: 0.92 }],
    interactions: [],
    selected_object_id: "mug",
    selection_status: "selected",
    uncertainty: { level: "low" }
  });
  renderer.renderOnce(25_632);
  const measuredRelationUpdateMs = performance.now() - relationUpdateStarted;

  let consumerFrames = 0;
  const unregister = renderer.registerFrameConsumer(() => { consumerFrames += 1; });
  renderer.renderOnce(25_648);
  assert.equal(consumerFrames, 1, "registered replay consumer did not receive the composite frame");
  unregister();
  renderer.renderOnce(25_664);
  assert.equal(consumerFrames, 1, "removed replay consumer remained retained");

  const workloadMs = performance.now() - workloadStart;
  const measuredP95Ms = percentile(renderDurations, 0.95);
  const measuredMaxMs = Math.max(...renderDurations);
  const measuredFps = renderDurations.length / Math.max(workloadMs / 1_000, 0.001);
  const metrics = renderer.getMetrics();

  assert.ok(measuredFps > 30, `fake-canvas renderer throughput fell below 30 FPS (${measuredFps.toFixed(2)})`);
  assert.ok(measuredP95Ms < 33.34, `p95 render time exceeds a 30 FPS frame budget (${measuredP95Ms.toFixed(2)}ms)`);
  assert.ok(measuredMaxMs < 50, `renderer caused a main-thread long task (${measuredMaxMs.toFixed(2)}ms)`);
  assert.ok(Number.isFinite(metrics.fps) && Number.isFinite(metrics.p95RenderMs));
  assert.ok(metrics.fps > 30, `renderer-reported FPS fell below target (${metrics.fps.toFixed(2)})`);
  assert.ok(metrics.p95RenderMs < 33.34, `renderer-reported p95 exceeds frame budget (${metrics.p95RenderMs.toFixed(2)}ms)`);
  assert.ok(metrics.pathPointCount <= 2_048, `path geometry grew without a safe bound (${metrics.pathPointCount})`);
  assert.ok(metrics.canvasMemoryBytes > 0 && metrics.canvasMemoryBytes <= 64 * 1024 * 1024, `canvas memory is missing or excessive (${metrics.canvasMemoryBytes})`);
  assert.ok(Number.isFinite(metrics.labelLayoutMs) && metrics.labelLayoutMs >= 0, "label-layout time is not measured");
  assert.ok(Number.isFinite(metrics.relationUpdateMs) && metrics.relationUpdateMs >= 0, "relation-update time is not measured");
  assert.ok(measuredRelationUpdateMs < 50, `relation update caused a long task (${measuredRelationUpdateMs.toFixed(2)}ms)`);

  renderer.dispose();
  const disposedMetrics = renderer.getMetrics();
  const disposedSnapshot = renderer.getSnapshot();
  assert.equal(disposedMetrics.disposed, true);
  assert.equal(disposedSnapshot.disposed, true);
  assert.equal(disposedSnapshot.running, false);
  assert.equal(rafCallbacks.size, 0, "renderer loop remained retained after disposal");

  process.stdout.write([
    "Neural Field render benchmark",
    `renderer FPS: ${metrics.fps.toFixed(2)} (wall throughput ${measuredFps.toFixed(2)})`,
    `p95 render time: ${metrics.p95RenderMs.toFixed(2)} ms (wall p95 ${measuredP95Ms.toFixed(2)} ms)`,
    `max render time: ${measuredMaxMs.toFixed(2)} ms`,
    `path point count: ${metrics.pathPointCount}`,
    `canvas memory: ${metrics.canvasMemoryBytes} bytes`,
    `label layout: ${metrics.labelLayoutMs.toFixed(2)} ms`,
    `relation update: ${metrics.relationUpdateMs.toFixed(2)} ms`,
    `benchmark relation wall time: ${measuredRelationUpdateMs.toFixed(2)} ms`,
    `cleanup after exit: ${disposedMetrics.disposed && rafCallbacks.size === 0 ? "PASS" : "FAIL"}`,
    ""
  ].join("\n"));
} finally {
  restoreGlobal("devicePixelRatio", originalDevicePixelRatio);
  restoreGlobal("requestAnimationFrame", originalRequestAnimationFrame);
  restoreGlobal("cancelAnimationFrame", originalCancelAnimationFrame);
  restoreGlobal("matchMedia", originalMatchMedia);
}
}

function handFrame(x, y, depth, timestamp, pinching) {
  const landmarks = Array.from({ length: 21 }, () => ({ x, y, z: depth, visibility: 0.94 }));
  landmarks[4] = { x: x - (pinching ? 0.004 : 0.08), y, z: depth, visibility: 0.94 };
  landmarks[8] = { x, y, z: depth, visibility: 0.94 };
  return {
    timestamp_ms: timestamp,
    hands: [{ handedness: "Right", confidence: 0.94, landmarks }],
    mirrored: false,
    confidence: 0.94,
    pinching
  };
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))] || 0;
}

class BenchmarkCanvas {
  constructor(width, height) {
    this.clientWidth = width;
    this.clientHeight = height;
    this.width = width;
    this.height = height;
    this.style = {};
    this.context = new BenchmarkContext();
  }

  getContext(type) { return type === "2d" ? this.context : null; }
  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
  }
}

class BenchmarkContext {
  constructor() {
    this.globalAlpha = 1;
    this.globalCompositeOperation = "source-over";
    this.filter = "none";
    this.shadowBlur = 0;
    this.shadowColor = "transparent";
    this.lineWidth = 1;
    this.lineCap = "round";
    this.lineJoin = "round";
    this.strokeStyle = "#000";
    this.fillStyle = "#000";
    this.font = "12px sans-serif";
    this.textAlign = "left";
    this.textBaseline = "alphabetic";
  }
  save() {}
  restore() {}
  setTransform() {}
  resetTransform() {}
  scale() {}
  translate() {}
  rotate() {}
  clearRect() {}
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  arc() {}
  ellipse() {}
  rect() {}
  roundRect() {}
  clip() {}
  stroke() {}
  fill() {}
  fillText() {}
  strokeText() {}
  drawImage() {}
  setLineDash() {}
  measureText(text) { return { width: String(text).length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }; }
  createLinearGradient() { return new BenchmarkGradient(); }
  createRadialGradient() { return new BenchmarkGradient(); }
}

class BenchmarkGradient {
  addColorStop() {}
}

function restoreGlobal(name, value) {
  if (value === undefined) delete globalThis[name];
  else Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

await runBenchmark();
