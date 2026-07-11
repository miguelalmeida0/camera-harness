import {
  GESTURE_MODEL_URL,
  MEDIAPIPE_ESM_URL,
  MEDIAPIPE_WASM_ROOT,
  classifyThumbsUpFromLandmarks,
  extractGestureCandidates,
  mapMediaPipeGestureLabel
} from "./local-gesture-engine.js";

let recognizer = null;
let stopped = false;

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  if (message.type === "init") await initializeRecognizer();
  if (message.type === "frame") await recognizeFrame(message);
  if (message.type === "stop") stopRecognizer();
});

async function initializeRecognizer() {
  if (recognizer || stopped) return;
  self.postMessage({ type: "gesture_engine_loading" });
  try {
    const { FilesetResolver, GestureRecognizer } = await import(MEDIAPIPE_ESM_URL);
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
    recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: GESTURE_MODEL_URL },
      runningMode: "VIDEO",
      numHands: 2,
      cannedGesturesClassifierOptions: {
        scoreThreshold: 0.65,
        maxResults: 1
      }
    });
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

function stopRecognizer() {
  stopped = true;
  recognizer?.close?.();
  recognizer = null;
}
