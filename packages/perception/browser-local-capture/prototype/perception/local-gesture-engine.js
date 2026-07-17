export const MEDIAPIPE_VERSION = "0.10.22-rc.20250304";
export const MEDIAPIPE_ESM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
export const MEDIAPIPE_WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
export const GESTURE_MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";

const READY_INFERENCE_COUNT = 5;
const INFERENCE_STALE_MS = 1500;
const WATCHDOG_INTERVAL_MS = 500;
const MAX_COMPATIBILITY_INFERENCE_FAILURES = 8;

export const MEDIAPIPE_GESTURE_MAP = Object.freeze({
  Thumb_Up: "thumbs_up",
  Thumb_Down: "thumbs_down",
  Victory: "peace_sign",
  Open_Palm: "open_palm",
  Closed_Fist: "closed_fist",
  Pointing_Up: "pointing_up",
  ILoveYou: "i_love_you"
});

export function mapMediaPipeGestureLabel(label) {
  return MEDIAPIPE_GESTURE_MAP[String(label || "")] || null;
}

export function isLocalGestureEngineReady(diagnostics = {}) {
  const successfulInferences = Number(diagnostics.successful_inferences || 0);
  const inferenceRecent = diagnostics.inference_recent === true
    || (Number.isFinite(Number(diagnostics.last_inference_age_ms)) && Number(diagnostics.last_inference_age_ms) < INFERENCE_STALE_MS);
  return diagnostics.recognizer_initialized === true
    && diagnostics.video_ready === true
    && diagnostics.loop_running === true
    && successfulInferences >= READY_INFERENCE_COUNT
    && (diagnostics.successful_inference_exists === true || successfulInferences > 0)
    && inferenceRecent
    && !diagnostics.last_error_code;
}

export function createLocalGestureEngine(options = {}) {
  const workerFrameIntervalMs = Math.max(33, Math.round(1000 / Math.min(30, Math.max(1, Number(options.maxFps || 12)))));
  const directMainThread = options.directMainThread === true;
  const compatibilityFrameIntervalMs = Math.max(100, Math.round(1000 / Math.min(directMainThread ? 6 : 10, Math.max(1, Number(options.compatibilityMaxFps || (directMainThread ? 6 : 9))))));
  const WorkerApi = options.Worker || globalThis.Worker;
  const createBitmap = options.createImageBitmap || globalThis.createImageBitmap;
  const requestFrame = options.requestAnimationFrame || globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame = options.cancelAnimationFrame || globalThis.cancelAnimationFrame?.bind(globalThis);
  const setTimer = options.setTimeout || globalThis.setTimeout?.bind(globalThis);
  const clearTimer = options.clearTimeout || globalThis.clearTimeout?.bind(globalThis);
  const monotonicNow = options.now || (() => Number(globalThis.performance?.now?.() ?? Date.now()));
  const loadMediaPipe = options.loadMediaPipe || (() => import(MEDIAPIPE_ESM_URL));
  const createCanvas = options.createCanvas || (() => globalThis.document?.createElement?.("canvas"));
  let worker = null;
  let compatibilityRecognizer = null;
  let compatibilityCanvas = null;
  let compatibilityCanvasContext = null;
  let compatibilityStarting = false;
  let video = null;
  let scheduledFrameId = null;
  let scheduledFrameKind = "none";
  let watchdogTimer = null;
  let running = false;
  let frameInFlight = false;
  let lastFrameAt = -Infinity;
  let status = "off";
  let mode = "off";
  let framesProcessed = 0;
  let successfulInferences = 0;
  let recognizerReady = false;
  let firstInferenceCompleted = false;
  let lastInferenceAtMs = 0;
  let lastInferenceTimestampMs = -1;
  let recognizerInitializedAtMs = 0;
  let lastRawLabel = "None";
  let lastRawConfidence = 0;
  let lastMappedGesture = null;
  let fallbackClassifierUsed = false;
  let lastOutcomeCode = "loop_not_running";
  let lastErrorCode = "";
  let lastErrorMessage = "";
  let watchdogRestarted = false;
  let watchdogRestartedAtMs = 0;
  let watchdogRestarts = 0;
  let schedulerFallback = false;
  let compatibilityInferenceFailures = 0;

  const publishLifecycle = (type, details = {}) => options.onLifecycleEvent?.({ type, mode, ...details });
  const loopScheduled = () => running && (scheduledFrameId != null || frameInFlight);

  const diagnostics = () => {
    const inferenceAge = lastInferenceAtMs > 0 ? Math.max(0, finiteTimestamp(monotonicNow()) - lastInferenceAtMs) : null;
    return {
      engine_mode: mode,
      recognizer_initialized: recognizerReady,
      loop_running: loopScheduled(),
      frames_processed: framesProcessed,
      successful_inferences: successfulInferences,
      successful_inference_exists: successfulInferences > 0,
      frame_in_flight: frameInFlight,
      recognizer_ready: recognizerReady,
      video_ready: Number(video?.readyState || 0) >= 2,
      scheduler: scheduledFrameKind,
      mode,
      status,
      first_inference_completed: firstInferenceCompleted,
      last_inference_at_ms: lastInferenceAtMs,
      last_inference_age_ms: inferenceAge,
      inference_recent: inferenceAge != null && inferenceAge < INFERENCE_STALE_MS,
      last_raw_label: lastRawLabel,
      last_raw_confidence: lastRawConfidence,
      mapped_gesture: lastMappedGesture,
      fallback_classifier_used: fallbackClassifierUsed,
      watchdog_restarts: watchdogRestarts,
      compatibility_inference_failures: compatibilityInferenceFailures,
      last_outcome_code: lastOutcomeCode,
      last_error_code: lastErrorCode,
      last_error_message: lastErrorMessage,
      contains_raw_media: false
    };
  };

  const publishDiagnostics = () => options.onDiagnosticsChange?.(diagnostics());

  const publishStatus = (next, reason = "", code = "") => {
    if (status === next && !reason && !code) {
      publishDiagnostics();
      return;
    }
    status = next;
    if (next === "unavailable") {
      lastErrorCode = code || "instant_engine_unavailable";
      lastErrorMessage = reason || "Local gesture engine unavailable.";
      lastOutcomeCode = lastErrorCode;
    }
    options.onStatusChange?.({ status: next, reason, code, mode });
    publishDiagnostics();
  };

  const refreshStatus = () => {
    if (!running) return publishStatus("off", "Off");
    if (!recognizerReady) return publishStatus("loading_model", "Loading model");
    if (Number(video?.readyState || 0) < 2) return publishStatus("waiting_camera_frames", "Waiting for camera frames");
    const snapshot = diagnostics();
    if (!isLocalGestureEngineReady(snapshot)) return publishStatus("starting_inference", "Starting inference");
    lastErrorCode = "";
    lastErrorMessage = "";
    return publishStatus(mode === "compatibility" ? "ready_compatibility" : "ready", "Ready — scanning");
  };

  const failUnavailable = (reason, code) => {
    running = false;
    cancelScheduledFrame();
    stopWatchdog();
    frameInFlight = false;
    mode = "unavailable";
    publishStatus("unavailable", reason, code);
  };

  const markSuccessfulInference = () => {
    framesProcessed += 1;
    successfulInferences += 1;
    firstInferenceCompleted = true;
    lastInferenceAtMs = finiteTimestamp(monotonicNow());
    compatibilityInferenceFailures = 0;
    watchdogRestarted = false;
    watchdogRestartedAtMs = 0;
    lastErrorCode = "";
    lastErrorMessage = "";
  };

  const emitGestureResult = async (result, timestampMs, metadata = {}) => {
    const canned = extractCannedGestureCandidates(result);
    const landmarkFallback = canned.length ? null : metadata.landmarkFallback || bestLandmarkFallback(result);
    const builtIn = canned[0] || (landmarkFallback ? { label: "Thumb_Up", confidence: landmarkFallback.confidence } : null);
    const groups = landmarkGroups(result);
    const handedness = handednessGroups(result);
    const hands = groups.map((landmarks, index) => ({
      handedness: handednessLabel(handedness[index], index),
      landmarks
    }));
    const customClassification = groups.length && typeof options.onLandmarks === "function"
      ? await options.onLandmarks({
        timestamp_ms: Number(timestampMs),
        hands,
        mirrored: options.mirrored !== false,
        contains_raw_media: false
      })
      : null;
    const customCandidate = customClassification?.candidate || (customClassification?.source === "custom_local_skill" ? customClassification : null);
    const useCustom = Boolean(customCandidate)
      && (!builtIn || Number(customCandidate.confidence || 0) > Number(builtIn.confidence || 0) + 0.05);
    const selected = useCustom
      ? { label: customCandidate.label || customCandidate.gesture_key, confidence: customCandidate.confidence }
      : builtIn;
    const gestureKey = useCustom ? customCandidate.gesture_key : mapMediaPipeGestureLabel(selected?.label);
    const usedFallback = Boolean(!useCustom && gestureKey && (metadata.fallbackClassifierUsed || landmarkFallback));
    const source = useCustom ? "custom_local_skill" : usedFallback ? "mediapipe_landmark_fallback" : "mediapipe_gesture";
    const handCount = boundedHandCount(useCustom ? customCandidate.hand_count : metadata.handCount ?? landmarkGroupCount(result), gestureKey);
    lastRawLabel = selected?.label || "None";
    lastRawConfidence = Number(selected?.confidence || 0);
    lastMappedGesture = gestureKey;
    fallbackClassifierUsed = usedFallback;
    lastOutcomeCode = gestureKey ? "gesture_candidate_observed" : "no_gesture";
    const outcome = await options.onObservation?.({
      gesture_key: gestureKey,
      custom_skill_id: useCustom ? customCandidate.custom_skill_id : undefined,
      skill_name: useCustom ? customCandidate.label : undefined,
      skill_type: useCustom ? "custom_hand_pose" : undefined,
      match_score: useCustom ? Number(customCandidate.match_score ?? customCandidate.confidence ?? 0) : undefined,
      second_best_score: useCustom ? Number(customCandidate.second_best_score || 0) : undefined,
      score_margin: useCustom ? Number(customCandidate.score_margin || 0) : undefined,
      confidence: Number(selected?.confidence || 0),
      hand_count: handCount,
      timestamp_ms: strictlyMonotonicTimestamp(timestampMs),
      raw_label: selected?.label || "None",
      source,
      detection_method: useCustom ? "normalized_landmark_template" : usedFallback ? "mediapipe_landmark_fallback" : "mediapipe_gesture",
      contains_raw_media: false
    });
    if (gestureKey && outcome?.code) lastOutcomeCode = outcome.code;
    publishDiagnostics();
    if (gestureKey) {
      globalThis.console?.debug?.("DarkQuest local gesture candidate", {
        label: selected?.label || "None",
        confidence: Number(selected?.confidence || 0),
        mapped_gesture: gestureKey,
        source
      });
    }
    return outcome;
  };

  const onWorkerMessage = async (event) => {
    const message = event.data || {};
    publishLifecycle(message.type);
    if (message.type === "gesture_engine_loading") publishStatus("loading_model", "Loading model");
    if (message.type === "gesture_engine_ready") {
      mode = "worker";
      recognizerReady = true;
      recognizerInitializedAtMs = finiteTimestamp(monotonicNow());
      refreshStatus();
    }
    if (message.type === "gesture_result") {
      markSuccessfulInference();
      refreshStatus();
      return emitGestureResult({
        gestures: message.gestures,
        landmarks: message.landmarks || [],
        handedness: message.handedness || []
      }, message.timestamp_ms, {
        fallbackClassifierUsed: message.fallback_classifier_used === true,
        landmarkFallback: message.landmark_fallback || null,
        handCount: message.hand_count
      });
    }
    if (message.type === "gesture_frame_complete") {
      frameInFlight = false;
      schedule();
      refreshStatus();
      publishDiagnostics();
    }
    if (message.type === "gesture_engine_error") {
      frameInFlight = false;
      void startCompatibilityFallback(message.safe_message, message.code);
    }
    return undefined;
  };

  function schedule() {
    if (!running || !video || scheduledFrameId != null) return;
    if (!schedulerFallback && typeof video.requestVideoFrameCallback === "function") {
      scheduledFrameKind = "video_frame_callback";
      scheduledFrameId = video.requestVideoFrameCallback((timestampMs) => {
        scheduledFrameId = null;
        void processFrame(timestampMs);
      });
    } else if (typeof requestFrame === "function") {
      scheduledFrameKind = "animation_frame";
      scheduledFrameId = requestFrame((timestampMs) => {
        scheduledFrameId = null;
        void processFrame(timestampMs);
      });
    } else if (typeof setTimer === "function") {
      scheduledFrameKind = "timer";
      scheduledFrameId = setTimer(() => {
        scheduledFrameId = null;
        void processFrame(monotonicNow());
      }, mode === "compatibility" ? compatibilityFrameIntervalMs : workerFrameIntervalMs);
    }
    publishDiagnostics();
  }

  function cancelScheduledFrame() {
    if (scheduledFrameId == null) return;
    if (scheduledFrameKind === "video_frame_callback") video?.cancelVideoFrameCallback?.(scheduledFrameId);
    else if (scheduledFrameKind === "animation_frame") cancelFrame?.(scheduledFrameId);
    else if (scheduledFrameKind === "timer") clearTimer?.(scheduledFrameId);
    scheduledFrameId = null;
    scheduledFrameKind = "none";
  }

  async function processFrame(callbackTimestampMs) {
    if (!running || !video) return;
    if (globalThis.document?.hidden === true) {
      stop();
      return;
    }
    if (video.readyState < 2) {
      refreshStatus();
      schedule();
      return;
    }
    const frameTimestamp = finiteTimestamp(callbackTimestampMs);
    const interval = mode === "compatibility" ? compatibilityFrameIntervalMs : workerFrameIntervalMs;
    const engineReady = mode === "worker" || mode === "compatibility" || mode === "direct_main_thread";
    if (!engineReady || frameInFlight || frameTimestamp - lastFrameAt < interval) {
      schedule();
      refreshStatus();
      return;
    }
    frameInFlight = true;
    lastFrameAt = frameTimestamp;
    const inferenceTimestamp = strictlyMonotonicTimestamp(frameTimestamp);
    try {
      if (mode === "worker" && worker && typeof createBitmap === "function") {
        let bitmap;
        try {
          bitmap = await createBitmap(video);
        } catch (error) {
          frameInFlight = false;
          void startCompatibilityFallback(safeDiagnosticMessage(error, "Worker video frame could not be captured."), "gesture_worker_frame_capture_failed");
          return;
        }
        if (!running) {
          bitmap.close?.();
          frameInFlight = false;
        } else {
          worker.postMessage({ type: "frame", image: bitmap, timestamp_ms: inferenceTimestamp }, [bitmap]);
        }
      } else if ((mode === "compatibility" || mode === "direct_main_thread") && compatibilityRecognizer) {
        await processCompatibilityFrame(compatibilityFrameSource(video), inferenceTimestamp);
      } else {
        frameInFlight = false;
      }
    } catch (error) {
      failUnavailable(error?.message || "Camera frame could not be read.", "gesture_frame_capture_failed");
      return;
    }
    schedule();
    refreshStatus();
  }

  async function processCompatibilityFrame(videoElement, timestampMs) {
    try {
      const result = compatibilityRecognizer.recognizeForVideo(videoElement, timestampMs);
      markSuccessfulInference();
      refreshStatus();
      await emitGestureResult(result, timestampMs);
    } catch (error) {
      compatibilityInferenceFailures += 1;
      const safeReason = safeDiagnosticMessage(error, "Local gesture compatibility inference failed.");
      lastOutcomeCode = compatibilityInferenceFailures >= MAX_COMPATIBILITY_INFERENCE_FAILURES
        ? "gesture_compatibility_inference_failed"
        : "gesture_compatibility_inference_retry";
      lastErrorCode = lastOutcomeCode;
      lastErrorMessage = safeReason;
      if (compatibilityInferenceFailures >= MAX_COMPATIBILITY_INFERENCE_FAILURES) {
        failUnavailable(safeReason, "gesture_compatibility_inference_failed");
      } else {
        publishStatus("starting_inference", "Starting inference", "gesture_compatibility_inference_retry");
      }
    } finally {
      frameInFlight = false;
    }
  }

  async function startCompatibilityFallback(reason = "", code = "") {
    if (!running || compatibilityStarting || compatibilityRecognizer) return;
    compatibilityStarting = true;
    mode = "compatibility_loading";
    recognizerReady = false;
    publishLifecycle("gesture_compatibility_loading", { reason, code });
    worker?.terminate?.();
    worker = null;
    publishStatus("loading_model", reason || "Loading model", code);
    try {
      const { FilesetResolver, GestureRecognizer } = await loadMediaPipe();
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
      const recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: Math.max(1, Math.min(2, Number(options.numHands || (directMainThread ? 1 : 2)))),
        cannedGesturesClassifierOptions: {
          scoreThreshold: directMainThread ? 0.50 : 0.65,
          maxResults: 1
        }
      });
      if (!running) {
        recognizer.close?.();
        return;
      }
      compatibilityRecognizer = recognizer;
      recognizerReady = true;
      recognizerInitializedAtMs = finiteTimestamp(monotonicNow());
      mode = directMainThread ? "direct_main_thread" : "compatibility";
      framesProcessed = 0;
      successfulInferences = 0;
      firstInferenceCompleted = false;
      lastInferenceAtMs = 0;
      lastInferenceTimestampMs = -1;
      lastOutcomeCode = "zero_frames";
      lastErrorCode = "";
      lastErrorMessage = "";
      compatibilityInferenceFailures = 0;
      publishLifecycle("gesture_engine_initialized");
      schedule();
      refreshStatus();
    } catch (error) {
      const safeReason = safeDiagnosticMessage(error, "Instant local gestures are unavailable. One-shot AI narration still works.");
      publishLifecycle("gesture_engine_error", { reason: safeReason });
      failUnavailable(safeReason, "gesture_compatibility_initialization_failed");
    } finally {
      compatibilityStarting = false;
    }
  }

  function startWatchdog() {
    if (!running || typeof setTimer !== "function" || watchdogTimer != null) return;
    watchdogTimer = setTimer(runWatchdog, WATCHDOG_INTERVAL_MS);
  }

  function stopWatchdog() {
    if (watchdogTimer != null) clearTimer?.(watchdogTimer);
    watchdogTimer = null;
  }

  function runWatchdog() {
    watchdogTimer = null;
    if (!running) return;
    const current = finiteTimestamp(monotonicNow());
    const reference = lastInferenceAtMs || recognizerInitializedAtMs || current;
    const stale = recognizerReady && Number(video?.readyState || 0) >= 2 && current - reference >= INFERENCE_STALE_MS;
    if (stale && !watchdogRestarted) {
      watchdogRestarted = true;
      watchdogRestartedAtMs = current;
      watchdogRestarts += 1;
      schedulerFallback = true;
      lastOutcomeCode = "gesture_engine_stalled_restarting";
      publishStatus("stalled", "Gesture engine stalled — restarting", "gesture_engine_stalled_restarting");
      cancelScheduledFrame();
      frameInFlight = false;
      schedule();
    } else if (stale && watchdogRestarted && current - watchdogRestartedAtMs >= INFERENCE_STALE_MS) {
      failUnavailable("Gesture engine stalled after one restart.", "gesture_engine_stalled_after_restart");
      return;
    }
    startWatchdog();
  }

  function start(nextVideo) {
    if (running) return;
    if (!nextVideo || (typeof nextVideo.requestVideoFrameCallback !== "function" && typeof requestFrame !== "function" && typeof setTimer !== "function")) {
      publishStatus("unavailable", "Local gesture recognition is not supported in this browser.", "gesture_browser_unsupported");
      return;
    }
    video = nextVideo;
    running = true;
    framesProcessed = 0;
    successfulInferences = 0;
    recognizerReady = false;
    firstInferenceCompleted = false;
    lastInferenceAtMs = 0;
    lastInferenceTimestampMs = -1;
    recognizerInitializedAtMs = finiteTimestamp(monotonicNow());
    lastRawLabel = "None";
    lastRawConfidence = 0;
    lastMappedGesture = null;
    fallbackClassifierUsed = false;
    lastFrameAt = -Infinity;
    lastOutcomeCode = "zero_frames";
    lastErrorCode = "";
    lastErrorMessage = "";
    watchdogRestarted = false;
    watchdogRestarts = 0;
    schedulerFallback = false;
    compatibilityInferenceFailures = 0;
    mode = "worker_loading";
    publishStatus("loading_model", "Loading model");
    publishLifecycle("gesture_worker_constructing");
    if (directMainThread) {
      void startCompatibilityFallback("Starting direct browser recognizer.", "gesture_direct_main_thread");
      startWatchdog();
      return;
    }
    if (typeof WorkerApi !== "function" || typeof createBitmap !== "function") {
      void startCompatibilityFallback("Module workers are unavailable in this browser.", "gesture_module_worker_unavailable");
      schedule();
      startWatchdog();
      return;
    }
    try {
      worker = new WorkerApi(new URL("./gesture-recognizer-worker.js", import.meta.url), {
        type: "module",
        name: "darkquest-gesture-recognizer"
      });
      publishLifecycle("gesture_worker_constructed");
      worker.addEventListener?.("message", onWorkerMessage);
      worker.addEventListener?.("error", () => {
        frameInFlight = false;
        publishLifecycle("gesture_worker_error", { reason: "Gesture worker import mode mismatch." });
        void startCompatibilityFallback("Gesture worker import mode mismatch.", "gesture_worker_import_mode_mismatch");
      });
      worker.postMessage({ type: "init" });
    } catch {
      void startCompatibilityFallback("Gesture worker import mode mismatch.", "gesture_worker_import_mode_mismatch");
    }
    schedule();
    startWatchdog();
  }

  function stop() {
    running = false;
    cancelScheduledFrame();
    stopWatchdog();
    frameInFlight = false;
    worker?.postMessage?.({ type: "stop" });
    worker?.terminate?.();
    worker = null;
    compatibilityRecognizer?.close?.();
    compatibilityRecognizer = null;
    compatibilityCanvas = null;
    compatibilityCanvasContext = null;
    recognizerReady = false;
    firstInferenceCompleted = false;
    video = null;
    mode = "off";
    lastOutcomeCode = "loop_not_running";
    compatibilityInferenceFailures = 0;
    publishStatus("off");
  }

  function strictlyMonotonicTimestamp(value) {
    const timestamp = Math.max(finiteTimestamp(value), finiteTimestamp(monotonicNow()));
    lastInferenceTimestampMs = Math.max(lastInferenceTimestampMs + 0.001, timestamp);
    return lastInferenceTimestampMs;
  }

  function compatibilityFrameSource(videoElement) {
    const width = Math.max(1, Math.round(Number(videoElement?.videoWidth || videoElement?.width || 640)));
    const height = Math.max(1, Math.round(Number(videoElement?.videoHeight || videoElement?.height || 480)));
    try {
      compatibilityCanvas ??= createCanvas?.();
      if (!compatibilityCanvas) return videoElement;
      if (compatibilityCanvas.width !== width) compatibilityCanvas.width = width;
      if (compatibilityCanvas.height !== height) compatibilityCanvas.height = height;
      compatibilityCanvasContext ??= compatibilityCanvas.getContext?.("2d", { alpha: false });
      if (!compatibilityCanvasContext?.drawImage) return videoElement;
      compatibilityCanvasContext.drawImage(videoElement, 0, 0, width, height);
      return compatibilityCanvas;
    } catch {
      return videoElement;
    }
  }

  function safeDiagnosticMessage(error, fallback) {
    const raw = String(error?.message || error || fallback || "Local gesture processing failed.");
    return raw
      .replace(/(?:hf_|sk-)[a-z0-9_-]+/gi, "[redacted]")
      .replace(/([?&](?:token|key|secret|signature|credential)=)[^&\s]+/gi, "$1[redacted]")
      .slice(0, 220);
  }

  return {
    start,
    stop,
    getStatus: () => status,
    getMode: () => mode,
    isRunning: () => running,
    isFrameInFlight: () => frameInFlight,
    getDiagnostics: diagnostics
  };
}

export function extractGestureCandidates(result = {}) {
  const canned = extractCannedGestureCandidates(result);
  if (canned.length) return canned;
  const fallback = bestLandmarkFallback(result);
  return fallback ? [{ label: "Thumb_Up", confidence: fallback.confidence }] : [];
}

export function classifyThumbsUpFromLandmarks(landmarks) {
  const points = normalizedLandmarkSet(landmarks);
  if (!points) return null;
  const wrist = points[0];
  const thumbMcp = points[2];
  const thumbIp = points[3];
  const thumbTip = points[4];
  const scale = landmarkScale(points);
  if (scale < 0.1) return null;
  const thumbExtended = thumbTip.y < thumbIp.y - scale * 0.035
    && thumbIp.y < thumbMcp.y - scale * 0.025
    && thumbMcp.y < wrist.y - scale * 0.035
    && distance(thumbTip, thumbMcp) >= scale * 0.2;
  const foldedFingerCount = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]].filter(([mcp, pip, tip]) => {
    const tipPoint = points[tip];
    const pipPoint = points[pip];
    const mcpPoint = points[mcp];
    return tipPoint.y >= pipPoint.y - scale * 0.025
      && distance(tipPoint, mcpPoint) <= scale * 0.48;
  }).length;
  if (!thumbExtended || foldedFingerCount < 3) return null;
  return {
    gesture_key: "thumbs_up",
    source: "mediapipe_landmark_fallback",
    confidence: 0.72,
    contains_raw_media: false
  };
}

export function inferGestureCandidateFromLandmarks(landmarks) {
  const classified = classifyThumbsUpFromLandmarks(landmarks);
  return classified ? { label: "Thumb_Up", confidence: classified.confidence } : null;
}

function extractCannedGestureCandidates(result) {
  const gestureGroups = Array.isArray(result) ? result : Array.isArray(result?.gestures) ? result.gestures : [];
  return gestureGroups.map((group) => flattenGestureCategories(group)
    .filter((candidate) => mapMediaPipeGestureLabel(gestureLabel(candidate)))
    .sort((a, b) => gestureConfidence(b) - gestureConfidence(a))[0])
    .filter(Boolean)
    .map((candidate) => ({ label: gestureLabel(candidate), confidence: gestureConfidence(candidate) }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2);
}

function flattenGestureCategories(value) {
  if (Array.isArray(value)) return value.flatMap(flattenGestureCategories);
  if (!value || typeof value !== "object") return [];
  if (["categoryName", "category_name", "displayName", "label"].some((key) => key in value)) return [value];
  return Object.values(value).flatMap(flattenGestureCategories);
}

function gestureLabel(candidate) {
  return [candidate?.categoryName, candidate?.category_name, candidate?.displayName, candidate?.label]
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";
}

function gestureConfidence(candidate) {
  const confidence = [candidate?.score, candidate?.confidence]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value)) ?? 0;
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
}

function bestLandmarkFallback(result) {
  return landmarkGroups(result)
    .map(classifyThumbsUpFromLandmarks)
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)[0] || null;
}

function landmarkGroups(result) {
  const groups = result?.landmarks ?? result?.handLandmarks ?? [];
  if (!Array.isArray(groups) || !groups.length) return [];
  return Array.isArray(groups[0]) ? groups : [groups];
}

function landmarkGroupCount(result) {
  return landmarkGroups(result).length || (Array.isArray(result?.gestures) ? result.gestures.length : 0);
}

function handednessGroups(result) {
  const groups = result?.handedness ?? result?.handednesses ?? [];
  return Array.isArray(groups) ? groups.slice(0, 2) : [];
}

function handednessLabel(value, index) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return String(candidate?.categoryName || candidate?.displayName || candidate?.label || candidate || `hand_${index + 1}`);
}

function normalizedLandmarkSet(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;
  const points = landmarks.slice(0, 21).map((point) => ({
    x: Number(point?.x),
    y: Number(point?.y),
    z: Number(point?.z || 0),
    visibility: point?.visibility == null ? 1 : Number(point.visibility),
    presence: point?.presence == null ? 1 : Number(point.presence)
  }));
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)
    || !Number.isFinite(point.visibility) || !Number.isFinite(point.presence)
    || point.visibility < 0.5 || point.presence < 0.5)) return null;
  return points;
}

function landmarkScale(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function boundedHandCount(value, hasGesture) {
  const count = Number(value);
  if (count >= 2) return 2;
  if (count >= 1 || hasGesture) return 1;
  return 0;
}

function finiteTimestamp(value) {
  const timestamp = Number(value);
  if (Number.isFinite(timestamp)) return timestamp;
  return Number(globalThis.performance?.now?.() ?? Date.now());
}
