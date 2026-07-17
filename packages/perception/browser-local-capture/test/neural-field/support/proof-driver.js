import {
  startNeuralField
} from "/local-capture.js";
import { LANDMARK_FIXTURES } from "/fixtures/neural-field/landmarks/index.mjs";

const scenario = new URLSearchParams(location.search).get("qa-scenario") || "";
const spatialScenarios = new Set(["lasso-active", "grounded", "relation", "tracking-loss", "exit-watch"]);
const fixtureIds = [];
let pushHandFrame = null;
let nextTimestamp = Math.max(1_000, performance.now() + 100);
let spatialMode = "tracked";
let spatialCalls = 0;

document.body.dataset.qaProofScenario = scenario;
document.body.dataset.qaProofReady = "false";

void run().catch((error) => {
  const message = String(error?.message || "proof_failed").replace(/[^a-z0-9 _:-]/gi, "").slice(0, 180);
  document.body.dataset.qaProofError = message || "proof_failed";
  const bridge = globalThis.__SENSEFIELD_TEST__;
  document.body.dataset.qaProofDiagnostics = JSON.stringify({
    spatial_calls: spatialCalls,
    neural_field: bridge?.getNeuralFieldState?.() || null,
    renderer: bridge?.getNeuralFieldSnapshot?.() || null
  }).slice(0, 2_000);
  console.error("[Neural Field proof]", message || "proof_failed");
});

async function run() {
  if (!scenario) throw new Error("qa_scenario_required");
  await waitFor(() => document.querySelector("[data-interaction-mode='neural_field']"));
  if (scenario === "exit-watch") {
    document.querySelector("[data-interaction-mode='observing']")?.click();
    await waitFor(() => document.querySelector("[data-interaction-mode='observing']")?.getAttribute("aria-pressed") === "true");
  }
  document.querySelector("[data-interaction-mode='neural_field']")?.click();
  await waitFor(() => !document.querySelector("#neuralFieldPanel")?.hidden);

  const tool = spatialScenarios.has(scenario) ? "spatial_lasso" : "airscript";
  document.querySelector(`[data-neural-field-tool='${tool}']`)?.click();
  const camera = createSyntheticCamera(tool);
  const spatialAdapter = {
    async analyzeSpatialWindow() {
      spatialCalls += 1;
      return spatialMode === "lost" ? trackingLossScene() : trackedScene();
    }
  };
  const started = await startNeuralField({ tool }, {
    mediaStream: camera.stream,
    spatialAdapter,
    spatialTestMode: true,
    handWorkerFactory({ onHandFrame }) {
      pushHandFrame = onHandFrame;
      return { start() {}, stop() {}, isReady: () => true };
    }
  });
  if (!started.ok || typeof pushHandFrame !== "function") throw new Error(`neural_field_start_failed:${started.code || "worker"}`);
  await waitFor(() => document.querySelector("#neuralFieldCameraState")?.textContent?.includes("Camera active"));

  if (scenario === "airscript-live") await proveAirScriptLive();
  else if (scenario === "airscript-complete") await proveAirScriptComplete();
  else if (scenario === "lasso-active") await proveLassoActive();
  else if (scenario === "grounded") await proveGroundedObject();
  else if (scenario === "relation") await proveRelation();
  else if (scenario === "tracking-loss") await proveTrackingLoss();
  else if (scenario === "exit-ask" || scenario === "exit-watch") await proveExit(scenario === "exit-watch" ? "observing" : "conversation");
  else throw new Error(`unknown_qa_scenario:${scenario}`);

  const bridge = globalThis.__SENSEFIELD_TEST__;
  globalThis.__NEURAL_FIELD_PROOF__ = Object.freeze({
    scenario,
    fixture_ids: fixtureIds,
    contains_raw_media: false,
    microphone_tracks: camera.stream.getAudioTracks().length,
    neural_field: bridge?.getNeuralFieldState?.() || null,
    renderer: bridge?.getNeuralFieldSnapshot?.() || null,
    resources: bridge?.getResourceCounts?.() || null,
    media: bridge?.getMediaTrackState?.() || null
  });
  const renderer = bridge?.getNeuralFieldSnapshot?.() || null;
  document.body.dataset.qaProofDiagnostics = JSON.stringify({
    renderer_status: renderer?.status || null,
    live_points: renderer?.paths?.liveStabilized?.length || 0,
    completed_paths: renderer?.paths?.completed?.length || 0,
    anchors: renderer?.anchors?.map((anchor) => ({ id: anchor.id, state: anchor.state })) || [],
    relations: renderer?.relations?.map((relation) => relation.predicate) || []
  }).slice(0, 2_000);
  document.body.dataset.qaProofReady = "true";
}

async function proveAirScriptLive() {
  const frames = LANDMARK_FIXTURES.slow_circle.frames.slice(0, 23).map((frame) => scaleFrameY(frame, 5 / 3));
  fixtureIds.push("slow_circle:camera_aspect_mapped");
  await feedFrames(frames);
  await waitFor(() => /Drawing/.test(document.querySelector("#neuralFieldStrokeState")?.textContent || ""));
  await delay(120);
}

async function proveAirScriptComplete() {
  fixtureIds.push("slow_circle:camera_aspect_mapped", "release");
  await feedFrames(LANDMARK_FIXTURES.slow_circle.frames.map((frame) => scaleFrameY(frame, 5 / 3)));
  await feedFrames([LANDMARK_FIXTURES.release.frames[0], LANDMARK_FIXTURES.release.frames[0]]);
  await waitFor(() => /Recognized: Circle/.test(document.querySelector("#neuralFieldResultState")?.textContent || ""), 8_000);
  await delay(160);
}

async function proveLassoActive() {
  fixtureIds.push("valid_lasso_around_one_object");
  const frames = LANDMARK_FIXTURES.valid_lasso_around_one_object.frames.slice(0, -1).map((frame) => shiftFrameX(frame, 0.41));
  await feedFrames(frames);
  await waitFor(() => /Drawing/.test(document.querySelector("#neuralFieldStrokeState")?.textContent || ""));
  await delay(120);
}

async function proveGroundedObject() {
  await drawCompletedLasso("mug");
  await waitFor(() => /Object grounded: mug/i.test(document.querySelector("#neuralFieldGroundingState")?.textContent || ""), 8_000);
  await delay(160);
}

async function proveRelation() {
  await drawCompletedLasso("mug");
  await drawCompletedLasso("laptop");
  await waitFor(() => /Relation detected:.*left/i.test(document.querySelector("#neuralFieldRelationState")?.textContent || ""), 8_000);
  await delay(180);
}

async function proveTrackingLoss() {
  await proveRelation();
  spatialMode = "lost";
  document.querySelector("#refreshNeuralFieldTracking")?.click();
  await waitFor(() => /Tracking lost: mug/i.test(document.querySelector("#neuralFieldGroundingState")?.textContent || ""), 8_000);
  await waitFor(() => (document.querySelector("#neuralFieldRelationState")?.textContent || "") === "No relation", 8_000);
  await delay(180);
}

async function proveExit(expectedMode) {
  document.querySelector("#exitNeuralField")?.click();
  await waitFor(() => document.querySelector(`[data-interaction-mode='${expectedMode}']`)?.getAttribute("aria-pressed") === "true", 8_000);
  await waitFor(() => globalThis.__SENSEFIELD_TEST__?.getResourceCounts?.().neural_field_worker_count === 0, 8_000);
  await waitFor(() => globalThis.__SENSEFIELD_TEST__?.getResourceCounts?.().neural_field_renderer_loop_count === 0, 8_000);
}

async function drawCompletedLasso(target) {
  const fixture = LANDMARK_FIXTURES.valid_lasso_around_one_object.frames;
  const source = [fixture[0], ...fixture];
  const offset = target === "laptop" ? -0.04 : 0.41;
  const transformed = source.map((frame) => shiftFrameX(frame, offset));
  fixtureIds.push(`valid_lasso_around_one_object:preview_${target}`);
  await feedFrames(transformed);
  await feedFrames([shiftFrameX(LANDMARK_FIXTURES.release.frames[0], offset)]);
  if (target === "mug") {
    await waitFor(() => /Object grounded: mug/i.test(document.querySelector("#neuralFieldGroundingState")?.textContent || ""), 8_000);
  } else {
    await waitFor(() => /mug.*laptop|laptop.*mug/i.test(document.querySelector("#neuralFieldGroundingState")?.textContent || ""), 8_000);
  }
}

async function feedFrames(frames) {
  for (const source of frames) {
    const frame = structuredClone(source);
    stabilizePalmGeometry(frame);
    frame.timestamp_ms = nextTimestamp;
    frame.timestampMs = nextTimestamp;
    frame.contains_raw_media = false;
    nextTimestamp += 34;
    pushHandFrame(frame);
    await delay(7);
  }
}

function stabilizePalmGeometry(frame) {
  for (const hand of frame.hands || []) {
    const landmarks = hand.landmarks || [];
    const tip = landmarks[8];
    if (!tip || landmarks.length < 21) continue;
    const palmY = clamp(tip.y + 0.17);
    for (const [index, offset] of [[0, 0], [5, -0.06], [9, -0.02], [13, 0.02], [17, 0.06]]) {
      landmarks[index] = { ...landmarks[index], x: clamp(tip.x + offset), y: palmY, z: 0 };
    }
  }
}

function shiftFrameX(source, offset) {
  const frame = structuredClone(source);
  for (const hand of frame.hands || []) {
    for (const point of hand.landmarks || []) point.x = clamp(point.x + offset);
    for (const key of ["thumb_tip", "index_tip"]) if (hand[key]) hand[key].x = clamp(hand[key].x + offset);
  }
  return frame;
}

function scaleFrameY(source, factor) {
  const frame = structuredClone(source);
  for (const hand of frame.hands || []) {
    for (const point of hand.landmarks || []) point.y = clamp(0.5 + (point.y - 0.5) * factor);
    for (const key of ["thumb_tip", "index_tip"]) if (hand[key]) hand[key].y = clamp(0.5 + (hand[key].y - 0.5) * factor);
  }
  return frame;
}

function createSyntheticCamera(tool) {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 600;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 1000, 600);
  gradient.addColorStop(0, "#121526");
  gradient.addColorStop(1, "#20243b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,.035)";
  for (let x = 40; x < 1000; x += 80) context.fillRect(x, 0, 1, 600);
  if (tool === "spatial_lasso") drawSyntheticDesk(context);
  const stream = canvas.captureStream(5);
  stream.getVideoTracks()[0]?.requestFrame?.();
  return { canvas, stream };
}

function drawSyntheticDesk(context) {
  context.fillStyle = "#313750";
  context.fillRect(0, 420, 1000, 180);
  context.fillStyle = "#9f8eea";
  context.beginPath();
  context.roundRect(590, 215, 230, 205, 30);
  context.fill();
  context.strokeStyle = "#c8bfff";
  context.lineWidth = 12;
  context.beginPath();
  context.arc(810, 315, 55, -Math.PI / 2, Math.PI / 2);
  context.stroke();
  context.fillStyle = "#59617f";
  context.beginPath();
  context.roundRect(100, 175, 320, 230, 18);
  context.fill();
  context.fillStyle = "#252a42";
  context.fillRect(130, 205, 260, 160);
}

function trackedScene() {
  return spatialScene({
    scene_id: "qa_mug_left_of_laptop",
    objects: [
      { id: "mug", label: "mug", bbox: { x: 0.17, y: 0.32, width: 0.24, height: 0.34 }, relative_depth: 0.56, confidence: 0.94 },
      { id: "laptop", label: "laptop", bbox: { x: 0.58, y: 0.29, width: 0.32, height: 0.38 }, relative_depth: 0.62, confidence: 0.95 }
    ],
    relations: [{ subjectId: "mug", subject_label: "Mug", predicate: "left_of", objectId: "laptop", referenceId: "laptop", reference_label: "Laptop", confidence: 0.91 }],
    evidence: [
      { label: "mug", frame_index: 0, confidence: 0.94, normalized_region: { x: 0.17, y: 0.32, width: 0.24, height: 0.34 } },
      { label: "laptop", frame_index: 1, confidence: 0.95, normalized_region: { x: 0.58, y: 0.29, width: 0.32, height: 0.38 } }
    ]
  });
}

function trackingLossScene() {
  return spatialScene({
    scene_id: "qa_mug_left_frame",
    objects: [{ id: "laptop", label: "laptop", bbox: { x: 0.58, y: 0.29, width: 0.32, height: 0.38 }, relative_depth: 0.62, confidence: 0.95 }],
    movements: [{ subject_id: "mug", subject_label: "mug", direction: "out of frame", confidence: 0.92 }],
    evidence: [{ label: "laptop", frame_index: 1, confidence: 0.95, normalized_region: { x: 0.58, y: 0.29, width: 0.32, height: 0.38 } }]
  });
}

function spatialScene(patch) {
  return {
    ok: true,
    source: "local_spatial",
    scene_id: patch.scene_id,
    scale: { type: "relative", unit: null, confidence: 0.9 },
    objects: patch.objects || [],
    hands: [],
    relations: patch.relations || [],
    movements: patch.movements || [],
    interactions: [],
    metric_estimates: [],
    evidence: patch.evidence || [],
    partial_observation: null,
    uncertainty: { level: "low", missing_evidence: [], suggested_view: null }
  };
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (predicate()) return true;
    await delay(25);
  }
  throw new Error("proof_timeout");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
