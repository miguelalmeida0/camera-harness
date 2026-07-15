import {
  GESTURE_MODEL_URL,
  MEDIAPIPE_ESM_URL,
  MEDIAPIPE_WASM_ROOT,
  classifyThumbsUpFromLandmarks,
  extractGestureCandidates,
  mapMediaPipeGestureLabel
} from "./local-gesture-engine.js";
import { createHandGeometryTracker } from "./neural-field-perception.js";

let recognizer = null;
let stopped = false;
let neuralFieldFrameInFlight = false;
let lastNeuralFieldTimestamp = -Infinity;
const geometryTracker = createHandGeometryTracker();

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  if (message.type === "init") await initializeRecognizer();
  if (message.type === "frame") await recognizeFrame(message);
  if (message.type === "process_frame") processNeuralFieldFrame(message);
  if (message.type === "stop") stopRecognizer();
});

async function initializeRecognizer() {
  if (recognizer || stopped) return;
  self.postMessage({ type: "gesture_engine_loading" });
  try {
    const { FilesetResolver, GestureRecognizer } = await import(MEDIAPIPE_ESM_URL);
    if (stopped) return;
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
    if (stopped) return;
    const nextRecognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: GESTURE_MODEL_URL },
      runningMode: "VIDEO",
      numHands: 2,
      cannedGesturesClassifierOptions: {
        scoreThreshold: 0.65,
        maxResults: 1
      }
    });
    if (stopped) {
      nextRecognizer?.close?.();
      return;
    }
    recognizer = nextRecognizer;
    self.postMessage({ type: "gesture_engine_initialized" });
    self.postMessage({
      type: "gesture_engine_ready",
      engine: "mediapipe_gesture_recognizer"
    });
  } catch (error) {
    const mismatchText = String(error?.message || error);
    const mismatch = mismatchText.includes(["import", "Scripts"].join("")) || /module scripts?/i.test(mismatchText);
    self.postMessage({
      type: "gesture_engine_error",
      code: mismatch ? "gesture_worker_import_mode_mismatch" : "gesture_worker_initialization_failed",
      safe_message: mismatch ? "Gesture worker import mode mismatch." : "Local gesture worker could not start."
    });
  }
}

async function recognizeFrame(message) {
  const image = message.image;
  try {
    if (!recognizer || stopped || !image) return;
    const timestampMs = Number(message.timestamp_ms || performance.now());
    const result = recognizer.recognizeForVideo(image, timestampMs);
    const gestures = extractGestureCandidates(result);
    const hasCannedGesture = extractGestureCandidates({ gestures: result?.gestures || [] })
      .some((candidate) => mapMediaPipeGestureLabel(candidate.label));
    const landmarkGroups = result?.landmarks ?? result?.handLandmarks ?? [];
    const handednessGroups = result?.handedness ?? result?.handednesses ?? [];
    const landmarkFallback = hasCannedGesture ? null : (Array.isArray(landmarkGroups) ? landmarkGroups : [])
      .map((group) => classifyThumbsUpFromLandmarks(group))
      .filter(Boolean)
      .sort((a, b) => b.confidence - a.confidence)[0] || null;
    self.postMessage({
      type: "gesture_result",
      timestamp_ms: timestampMs,
      gestures,
      landmarks: Array.isArray(landmarkGroups) ? landmarkGroups.slice(0, 2) : [],
      handedness: Array.isArray(handednessGroups) ? handednessGroups.slice(0, 2) : [],
      hand_count: Math.min(2, Math.max(0, Array.isArray(landmarkGroups) ? landmarkGroups.length : 0)),
      fallback_classifier_used: Boolean(landmarkFallback),
      landmark_fallback: landmarkFallback
    });
  } catch {
    self.postMessage({
      type: "gesture_engine_error",
      code: "gesture_worker_inference_failed",
      safe_message: "Local gesture inference failed."
    });
  } finally {
    image?.close?.();
    self.postMessage({ type: "gesture_frame_complete" });
  }
}

function processNeuralFieldFrame(message) {
  const frame = message.frame;
  const timestamp = Number(message.timestamp);
  const startedAt = performance.now();
  try {
    if (!frame) {
      postNeuralFieldDrop(timestamp, "missing_frame", startedAt);
      return;
    }
    if (!recognizer || stopped) {
      postNeuralFieldDrop(timestamp, "worker_unready", startedAt);
      return;
    }
    if (!Number.isFinite(timestamp) || timestamp <= lastNeuralFieldTimestamp) {
      postNeuralFieldDrop(timestamp, "stale_timestamp", startedAt);
      return;
    }
    if (neuralFieldFrameInFlight) {
      postNeuralFieldDrop(timestamp, "worker_busy", startedAt);
      return;
    }

    neuralFieldFrameInFlight = true;
    lastNeuralFieldTimestamp = timestamp;
    const result = recognizer.recognizeForVideo(frame, timestamp);
    const normalize = geometryTracker?.process
      || geometryTracker?.processFrame
      || geometryTracker?.normalize
      || geometryTracker?.normalizeFrame;
    if (typeof normalize !== "function") throw new Error("Hand geometry tracker is unavailable.");
    const normalized = normalize.call(geometryTracker, result, {
      timestamp,
      frameWidth: positiveDimension(message.frameWidth),
      frameHeight: positiveDimension(message.frameHeight),
      mirrored: message.mirrored === true
    }) || {};
    self.postMessage({
      ...normalized,
      type: "hand_frame",
      timestamp,
      hands: Array.isArray(normalized.hands) ? normalized.hands.slice(0, 2) : [],
      processingMs: Math.max(0, performance.now() - startedAt)
    });
  } catch {
    postNeuralFieldDrop(timestamp, "inference_failed", startedAt);
  } finally {
    neuralFieldFrameInFlight = false;
    frame?.close?.();
  }
}

function postNeuralFieldDrop(timestamp, reason, startedAt) {
  self.postMessage({
    type: "hand_frame_dropped",
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    reason,
    processingMs: Math.max(0, performance.now() - startedAt)
  });
}

function positiveDimension(value) {
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : 1;
}

function stopRecognizer() {
  stopped = true;
  try { recognizer?.close?.(); } catch {}
  recognizer = null;
  neuralFieldFrameInFlight = false;
  try { geometryTracker?.dispose?.(); } catch {}
  self.postMessage({ type: "gesture_engine_stopped" });
}
