import { createCoverTransform, sourceBoxToViewport } from "./live-object-tracker.js";
import { createPerceptionImageRuntime } from "./perception-image-runtime.js";
import { createPerceptionServiceClient } from "./perception-service-client.js";

const INPUT_WIDTH = 416;
const HIDDEN_GRACE_MS = 2_000;
const STATIC_MOTION_THRESHOLD = 0.018;
const PRESENTATION_DWELL_MS = 600;
const MAX_SEMANTIC_REQUESTS_PER_MINUTE = 3;
const MAX_SEMANTIC_ATTEMPTS_PER_PRESENTATION = 2;
const SERVICE_STOP_TIMEOUT_MS = 1_500;

export function mountMicroscope(options = {}) {
  const video = options.video;
  const stage = options.stage;
  const objectLayer = options.objectLayer;
  if (!video || !stage || !objectLayer) throw new Error("AI Microscope Live requires the camera video, stage, and object layer.");

  const doc = options.document || globalThis.document;
  const nodes = bindMicroscopeDom(options.root || doc);
  const service = options.service || createPerceptionServiceClient(options.serviceOptions);
  const imageRuntime = options.imageRuntime || createPerceptionImageRuntime({ document: doc });
  const now = options.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const setTimer = options.setTimeout || globalThis.setTimeout?.bind(globalThis);
  const clearTimer = options.clearTimeout || globalThis.clearTimeout?.bind(globalThis);
  const runtime = {
    generation: 0,
    disposed: false,
    startPromise: null,
    stopPromise: null,
    sessionId: null,
    sessionStarted: false,
    loopActive: false,
    loopTimer: null,
    hiddenTimer: null,
    inferenceInFlight: false,
    detectionAbortController: null,
    consecutiveDetectionFailures: 0,
    inspectionAbortController: null,
    verificationInFlight: null,
    lastBestFrameError: "",
    semanticRequestTimes: [],
    trackMetadata: new Map(),
    automaticVisionEnabled: true,
    labelsEnabled: true,
    pausedByUser: false,
    listeners: [],
    objectNodes: new Map(),
    resizeObserver: null,
    frameCanvas: null,
    frameContext: null,
    motionCanvas: null,
    motionContext: null,
    previousMotionPixels: null,
    staticStreak: 0,
    motionBoostUntil: 0,
    energyMode: "efficient",
    serviceDiagnostics: {},
    metrics: {
      starts: 0,
      stops: 0,
      loopsStarted: 0,
      loopsStopped: 0,
      inferenceFrames: 0,
      detectionUpdates: 0,
      providerRequestsStarted: 0,
      providerRequestsCompleted: 0,
      providerRequestsFailed: 0,
      bestFrameFailures: 0,
      staleFramesDropped: 0,
      hiddenPauses: 0,
      sessionStarts: 0,
      sessionStops: 0,
      maxConcurrentInference: 0
    }
  };
  let state = initialState(service.capability);

  bindEvents();
  bindResize();
  render();

  async function start() {
    if (runtime.disposed) return failure("microscope_disposed");
    if (state.active && runtime.loopActive) return { ok: true, reused: true, state: snapshot() };
    if (runtime.startPromise) return runtime.startPromise;
    if (runtime.stopPromise) await runtime.stopPromise;
    const generation = ++runtime.generation;
    runtime.sessionId = `microscope-${Date.now().toString(36)}-${generation}`;
    runtime.automaticVisionEnabled = true;
    runtime.pausedByUser = false;
    runtime.consecutiveDetectionFailures = 0;
    state = { ...initialState(service.capability), status: "starting", active: true, notice: "Starting local vision…" };
    stage.classList.add("is-microscope-active");
    render();
    runtime.startPromise = (async () => {
      try {
        await waitForVideo(video, () => generation === runtime.generation);
        const capability = await service.refreshCapability();
        if (!capability.ready) throw codedError(capability.error || "local_perception_unavailable");
        const session = await service.startSession(runtime.sessionId, runtime.energyMode);
        if (generation !== runtime.generation) return failure("microscope_start_superseded");
        runtime.sessionStarted = true;
        runtime.metrics.sessionStarts += 1;
        runtime.serviceDiagnostics = session.diagnostics || {};
        state = {
          ...initialState(capability),
          status: "live",
          active: true,
          notice: "Scanning scene."
        };
        runtime.metrics.starts += 1;
        startFrameLoop();
        render();
        emit("microscope_started", {
          mode: "live_local_yolo_world",
          sessionId: runtime.sessionId,
          detector: capability.models?.detector?.name,
          tracker: capability.models?.tracker?.name,
          semantic: capability.models?.semantic?.name,
          remoteRequests: 0
        });
        return { ok: true, state: snapshot() };
      } catch (error) {
        if (generation !== runtime.generation) return failure("microscope_start_superseded");
        state = { ...state, status: "error", error: safeError(error), notice: "Local object detection could not start." };
        render();
        return failure("microscope_start_failed", error);
      } finally {
        runtime.startPromise = null;
      }
    })();
    return runtime.startPromise;
  }

  async function stop(reason = "user_exit", stopOptions = {}) {
    const waitForService = stopOptions.waitForService !== false;
    if (runtime.stopPromise) {
      if (waitForService) return runtime.stopPromise;
      return { ok: true, state: snapshot(), cleanupPending: true };
    }
    ++runtime.generation;
    const stoppedSessionId = runtime.sessionId;
    stopFrameLoop();
    cancelHiddenPause();
    runtime.detectionAbortController?.abort?.();
    runtime.detectionAbortController = null;
    runtime.inspectionAbortController?.abort?.();
    runtime.inspectionAbortController = null;
    runtime.verificationInFlight = null;
    runtime.sessionStarted = false;
    runtime.sessionId = null;
    runtime.consecutiveDetectionFailures = 0;
    imageRuntime.clear();
    runtime.trackMetadata.clear();
    runtime.semanticRequestTimes = [];
    releaseFrameBuffers(runtime);
    clearObjectNodes();
    state = { ...initialState(service.capability), lastStopReason: String(reason || "stopped") };
    runtime.metrics.stops += 1;
    stage.classList.remove("is-microscope-active");
    render();
    emit("microscope_stopped", { reason, rawFrameRetained: false, remoteRequests: 0 });
    runtime.stopPromise = (async () => {
      if (stoppedSessionId) {
        try {
          const stopSignal = globalThis.AbortSignal?.timeout?.(SERVICE_STOP_TIMEOUT_MS);
          const stopped = await service.stopSession(
            stoppedSessionId,
            runtime.energyMode,
            stopSignal ? { signal: stopSignal } : undefined
          );
          runtime.serviceDiagnostics = stopped.diagnostics || runtime.serviceDiagnostics;
        } catch {
          // Page teardown remains safe if the local process exits first.
        }
        runtime.metrics.sessionStops += 1;
      }
      return { ok: true, state: snapshot() };
    })().finally(() => {
      runtime.stopPromise = null;
    });
    if (waitForService) return runtime.stopPromise;
    void runtime.stopPromise;
    return { ok: true, state: snapshot(), cleanupPending: Boolean(stoppedSessionId) };
  }

  function startFrameLoop() {
    if (runtime.loopActive || !state.active || doc.visibilityState === "hidden") return;
    runtime.loopActive = true;
    runtime.metrics.loopsStarted += 1;
    scheduleNextFrame(0);
  }

  function scheduleNextFrame(delay) {
    if (!runtime.loopActive || runtime.loopTimer != null) return;
    runtime.loopTimer = setTimer(() => void processFrame(), Math.max(0, Math.round(delay)));
  }

  async function processFrame() {
    runtime.loopTimer = null;
    if (!runtime.loopActive || !state.active || !runtime.sessionStarted) return;
    if (runtime.inferenceInFlight || !videoIsReady(video)) {
      scheduleNextFrame(100);
      return;
    }
    const motionScore = measureMotion(video, doc, runtime);
    updateCadence(motionScore);
    const frame = captureDetectionFrame(video, doc, runtime);
    const generation = runtime.generation;
    const detectionAbortController = new AbortController();
    runtime.detectionAbortController = detectionAbortController;
    runtime.inferenceInFlight = true;
    runtime.metrics.maxConcurrentInference = Math.max(runtime.metrics.maxConcurrentInference, 1);
    let retryDelayMs = 0;
    try {
      const result = await service.detect({
        sessionId: runtime.sessionId,
        timestampMs: Date.now(),
        image: frame.dataUrl,
        motionScore,
        energyMode: runtime.energyMode
      }, { signal: detectionAbortController.signal });
      if (generation !== runtime.generation || !runtime.loopActive || !state.active) return;
      runtime.metrics.inferenceFrames += 1;
      runtime.consecutiveDetectionFailures = 0;
      runtime.serviceDiagnostics = result.diagnostics || runtime.serviceDiagnostics;
      if (result.stale) {
        runtime.metrics.staleFramesDropped += 1;
      } else {
        applyTrackStore(result.tracks);
        runtime.metrics.detectionUpdates += 1;
        emit("microscope_tracks_updated", {
          objectCount: state.objects.length,
          objectIds: state.objects.map((object) => object.id),
          primaryObjectId: state.primaryObjectId,
          yoloLatencyMs: runtime.serviceDiagnostics.yoloLatencyMs,
          remoteRequests: 0
        });
        void maybeVerifyPrimaryObject();
      }
    } catch (error) {
      if (error?.name === "AbortError" || generation !== runtime.generation || !state.active) return;
      runtime.consecutiveDetectionFailures += 1;
      if (runtime.consecutiveDetectionFailures < 3 && runtime.loopActive && state.active) {
        retryDelayMs = runtime.consecutiveDetectionFailures * 1_000;
        state = {
          ...state,
          status: "live",
          error: null,
          notice: "Local vision is warming up. Retrying."
        };
        render();
        emit("microscope_detection_retry", {
          attempt: runtime.consecutiveDetectionFailures,
          error: safeError(error)
        });
      } else {
        state = {
          ...state,
          status: "error",
          error: safeError(error),
          notice: "Live local object detection stopped."
        };
        stopFrameLoop();
        render();
        emit("microscope_detection_failed", { error: safeError(error) });
      }
    } finally {
      frame.clear();
      if (runtime.detectionAbortController === detectionAbortController) runtime.detectionAbortController = null;
      runtime.inferenceInFlight = false;
    }
    if (!runtime.loopActive || state.status === "error") return;
    if (retryDelayMs > 0) {
      scheduleNextFrame(retryDelayMs);
      return;
    }
    scheduleNextFrame(nextInferenceDelay());
  }

  function updateCadence(motionScore) {
    if (motionScore < STATIC_MOTION_THRESHOLD) runtime.staticStreak += 1;
    else {
      runtime.staticStreak = 0;
      runtime.motionBoostUntil = now() + 1_500;
    }
  }

  function nextInferenceDelay() {
    return detectorDelayForState({
      energyMode: runtime.energyMode,
      motionBoostActive: now() < runtime.motionBoostUntil,
      staticStreak: runtime.staticStreak
    });
  }

  function stopFrameLoop() {
    if (!runtime.loopActive && runtime.loopTimer == null) return;
    runtime.loopActive = false;
    if (runtime.loopTimer != null) clearTimer(runtime.loopTimer);
    runtime.loopTimer = null;
    runtime.metrics.loopsStopped += 1;
  }

  function applyTrackStore(tracks) {
    const timestamp = now();
    const previousObjects = new Map(state.objects.map((object) => [object.id, object]));
    const provisional = (Array.isArray(tracks) ? tracks : []).map((incoming) => {
      const previous = previousObjects.get(incoming.id);
      const priorMetadata = runtime.trackMetadata.get(incoming.id) || {};
      const semantic = incoming.semantic || previous?.semantic || null;
      const currentArea = boxArea(incoming.box);
      const priorArea = Number(priorMetadata.area) || currentArea;
      const center = boxCenter(incoming.box);
      const priorCenter = priorMetadata.center || center;
      const movement = Math.hypot(center.x - priorCenter.x, center.y - priorCenter.y)
        + Math.abs(currentArea - priorArea);
      const growth = priorArea > 0 ? (currentArea - priorArea) / priorArea : 0;
      const stableSince = movement <= 0.025 ? (priorMetadata.stableSince ?? timestamp) : timestamp;
      const recentGrowth = growth > 0.045
        ? Math.min(1, growth * 3)
        : Math.max(0, Number(priorMetadata.recentGrowth || 0) - 0.12);
      const metadata = {
        ...priorMetadata,
        firstSeenAt: priorMetadata.firstSeenAt ?? timestamp,
        lastSeenAt: timestamp,
        stableSince,
        lastMotionAt: movement > 0.025 ? timestamp : priorMetadata.lastMotionAt,
        area: currentArea,
        center,
        dx: center.x - priorCenter.x,
        dy: center.y - priorCenter.y,
        movement,
        recentGrowth,
        semanticAttempts: Math.max(Number(priorMetadata.semanticAttempts) || 0, Number(incoming.semanticAttempts) || 0)
      };
      runtime.trackMetadata.set(incoming.id, metadata);
      return {
        ...incoming,
        label: semantic?.label || incoming.label,
        confidence: semantic?.confidence ?? incoming.confidence,
        source: semantic?.source || incoming.source,
        semantic,
        locallyVerified: Boolean(semantic),
        semanticAttempts: metadata.semanticAttempts,
        presentation: {
          area: currentArea,
          centrality: centralityForBox(incoming.box),
          durationMs: timestamp - metadata.firstSeenAt,
          stableMs: timestamp - stableSince,
          recentGrowth,
          movement
        }
      };
    });

    const handTracks = provisional.filter((object) => /\bhand\b/i.test(object.localLabel || object.label));
    const personTracks = provisional.filter((object) => /\bperson\b/i.test(object.localLabel || object.label));
    let objects = provisional.map((object) => {
      const metadata = runtime.trackMetadata.get(object.id);
      const handProximity = nearestTrackProximity(object, handTracks);
      const personCoMotion = strongestCoMotion(metadata, personTracks.map((track) => runtime.trackMetadata.get(track.id)));
      const conflict = localCandidatesConflict(object.localCandidates);
      const uncertainty = 1 - Number(object.semantic ? object.semantic.confidence : object.confidence);
      const stability = Math.min(1, object.presentation.stableMs / PRESENTATION_DWELL_MS);
      const foreground = Math.min(1, object.presentation.area / 0.18);
      const novelty = Math.max(0, 1 - object.presentation.durationMs / 5_000);
      const duration = Math.min(1, object.presentation.durationMs / 1_200);
      const presentationScore = clamp01(
        object.presentation.centrality * 0.22
        + foreground * 0.19
        + object.presentation.recentGrowth * 0.15
        + handProximity * 0.12
        + personCoMotion * 0.06
        + stability * 0.12
        + novelty * 0.06
        + uncertainty * 0.04
        + duration * 0.04
      );
      const canVerify = isDeepCandidate(object);
      let attentionState = "peripheral";
      if (object.semantic && object.semantic.uncertain !== true) attentionState = "identified";
      else if (object.semantic) attentionState = "presented";
      else if (canVerify && object.presentation.stableMs >= PRESENTATION_DWELL_MS && presentationScore >= 0.45) attentionState = "presented";
      else if (canVerify && presentationScore >= 0.38) attentionState = "attention_candidate";
      if (runtime.verificationInFlight === object.id) attentionState = "verifying";
      return Object.freeze({
        ...object,
        presentation: Object.freeze({ ...object.presentation, handProximity, personCoMotion, conflict, score: presentationScore }),
        attentionState
      });
    });

    const liveIds = new Set(objects.map((object) => object.id));
    for (const objectId of runtime.trackMetadata.keys()) {
      if (!liveIds.has(objectId)) runtime.trackMetadata.delete(objectId);
    }
    const candidates = objects
      .filter((object) => isDeepCandidate(object) && object.state !== "occluded")
      .sort((left, right) => presentationPriority(right) - presentationPriority(left));
    const primaryObject = candidates[0] || objects.find((object) => object.semantic) || null;
    const primaryObjectId = primaryObject?.id || null;
    objects = objects.map((object) => Object.freeze({ ...object, primary: object.id === primaryObjectId }));
    for (const object of candidates.slice(0, 2)) {
      try {
        imageRuntime.considerBestFrame(video, { ...object, motion: { velocity: object.presentation.movement } }, null, timestamp);
      } catch (error) {
        const safe = safeError(error);
        runtime.metrics.bestFrameFailures += 1;
        runtime.lastBestFrameError = safe.message;
        emit("microscope_best_frame_failed", { code: safe.code, message: safe.message, rawFrameRetained: false });
      }
    }
    state = {
      ...state,
      objects,
      primaryObjectId,
      primaryObject,
      status: runtime.verificationInFlight ? "verifying" : "live",
      notice: cognitionNotice(objects, primaryObject, runtime.verificationInFlight)
    };
    render();
  }

  async function maybeVerifyPrimaryObject() {
    if (!runtime.automaticVisionEnabled || runtime.pausedByUser || runtime.verificationInFlight || !runtime.sessionStarted) return;
    if (state.provider.semanticEnrichment !== "ready") return;
    const selected = state.objects.find((object) => object.id === state.primaryObjectId);
    if (!selected || selected.attentionState !== "presented") return;
    const metadata = runtime.trackMetadata.get(selected.id);
    if (!metadata) return;
    const attempts = Math.max(Number(selected.semanticAttempts) || 0, Number(metadata.semanticAttempts) || 0);
    if (attempts >= MAX_SEMANTIC_ATTEMPTS_PER_PRESENTATION) return;
    const needsSecondView = Boolean(selected.semantic)
      && (selected.semantic.uncertain === true || selected.presentation.conflict === true);
    if (selected.semantic && !needsSecondView) return;
    const frame = needsSecondView
      ? imageRuntime.bestDifferentFrame(selected.id, metadata.lastRequestFingerprint, 8)
      : imageRuntime.bestFrame(selected.id);
    if (!frame || Number(frame.quality) < 0.2) {
      state = { ...state, notice: "Choosing a clearer view." };
      render();
      return;
    }
    const timestamp = now();
    runtime.semanticRequestTimes = runtime.semanticRequestTimes.filter((value) => timestamp - value < 60_000);
    if (runtime.semanticRequestTimes.length >= MAX_SEMANTIC_REQUESTS_PER_MINUTE) return;
    const generation = runtime.generation;
    const reason = selected.semantic
      ? "automatic_changed"
      : selected.presentation.conflict || selected.confidence < 0.7
        ? "automatic_uncertain"
        : "automatic_presented";
    const abortController = new AbortController();
    runtime.inspectionAbortController = abortController;
    runtime.verificationInFlight = selected.id;
    runtime.semanticRequestTimes.push(timestamp);
    metadata.lastRequestFingerprint = frame.fingerprint;
    metadata.semanticAttempts = attempts + 1;
    runtime.metrics.providerRequestsStarted += 1;
    state = {
      ...state,
      status: "verifying",
      objects: state.objects.map((object) => object.id === selected.id ? Object.freeze({ ...object, attentionState: "verifying" }) : object),
      notice: "Identifying locally.",
      error: null
    };
    render();
    try {
      const response = await service.inspect({
        sessionId: runtime.sessionId,
        objectId: selected.id,
        image: `data:${frame.mimeType};base64,${frame.encodedFrame}`,
        reason,
        ocrRequested: true,
        cropQuality: frame.quality
      }, { signal: abortController.signal });
      if (runtime.inspectionAbortController !== abortController
        || generation !== runtime.generation
        || !state.objects.some((object) => object.id === selected.id)) return failure("microscope_request_superseded");
      runtime.metrics.providerRequestsCompleted += 1;
      const updatedObjects = state.objects.map((object) => object.id === selected.id ? Object.freeze({
        ...object,
        ...(response.track || {}),
        label: response.result.label,
        confidence: response.result.confidence,
        source: response.result.source,
        semantic: response.result,
        locallyVerified: true,
        semanticAttempts: response.attempts || metadata.semanticAttempts,
        attentionState: response.result.uncertain ? "presented" : response.cached ? "cached" : "identified",
        primary: true
      }) : object);
      metadata.semanticAttempts = response.attempts || metadata.semanticAttempts;
      metadata.verifiedFingerprint = frame.fingerprint;
      state = {
        ...state,
        objects: updatedObjects,
        primaryObject: updatedObjects.find((object) => object.id === selected.id) || null,
        primaryObjectId: selected.id,
        status: "live",
        notice: `${semanticTitle(response.result)} identified.`
      };
      render();
      emit("microscope_object_automatically_verified", {
        objectId: selected.id,
        label: response.result.label,
        cached: response.cached,
        attempt: metadata.semanticAttempts,
        cropQuality: frame.quality,
        source: "local_semantic_verification",
        remoteRequests: 0
      });
      return { ok: true, result: response.result, cached: response.cached };
    } catch (error) {
      if (error?.name === "AbortError") return failure("microscope_request_cancelled");
      runtime.metrics.providerRequestsFailed += 1;
      state = {
        ...state,
        status: "live",
        error: safeError(error),
        notice: "Local identification was uncertain. Tracking remains active."
      };
      render();
      return failure(error?.code || "microscope_local_inspection_failed", error);
    } finally {
      if (runtime.inspectionAbortController === abortController) runtime.inspectionAbortController = null;
      if (runtime.verificationInFlight === selected.id) runtime.verificationInFlight = null;
    }
  }

  function render() {
    renderObjects();
    renderPanel();
    options.onStateChange?.(snapshot());
  }

  function renderObjects() {
    const visibleObjects = runtime.labelsEnabled ? labelCandidates(state.objects) : [];
    const liveIds = new Set(visibleObjects.map((object) => object.id));
    for (const [objectId, node] of runtime.objectNodes) {
      if (liveIds.has(objectId)) continue;
      node.remove();
      runtime.objectNodes.delete(objectId);
    }
    if (!state.active || !visibleObjects.length || !video.videoWidth || !video.videoHeight) {
      objectLayer.hidden = true;
      return;
    }
    const rect = stage.getBoundingClientRect();
    const transform = createCoverTransform({
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      mirrored: video.dataset?.analysisMirror !== "off"
    });
    const occupied = [];
    for (const object of visibleObjects) {
      let node = runtime.objectNodes.get(object.id);
      if (!node) {
        node = doc.createElement("div");
        node.className = "am-live-object";
        node.setAttribute("role", "status");
        const label = doc.createElement("span");
        label.className = "am-live-object-label";
        node.append(label);
        objectLayer.append(node);
        runtime.objectNodes.set(object.id, node);
      }
      const box = sourceBoxToViewport(object.box, transform);
      const placeRight = box.x + box.width + 148 < rect.width;
      const anchorX = placeRight
        ? clampNumber(box.x + box.width + 10, 8, Math.max(8, rect.width - 8))
        : clampNumber(box.x - 10, 8, Math.max(8, rect.width - 8));
      let anchorY = clampNumber(box.y + Math.min(28, box.height * 0.22), 24, Math.max(24, rect.height - 24));
      for (let attempt = 0; attempt < 4 && occupied.some((point) => Math.abs(point.x - anchorX) < 112 && Math.abs(point.y - anchorY) < 26); attempt += 1) {
        anchorY = clampNumber(anchorY + 28, 30, Math.max(30, rect.height - 12));
      }
      occupied.push({ x: anchorX, y: anchorY });
      const copy = floatingLabelText(object);
      node.classList.toggle("is-primary", object.primary === true);
      node.classList.toggle("is-predicted", object.state === "occluded");
      node.classList.toggle("is-verified", object.locallyVerified === true && object.semantic?.uncertain !== true);
      node.classList.toggle("is-uncertain", object.semantic?.uncertain === true || (!object.semantic && object.confidence < 0.7));
      node.classList.toggle("is-verifying", object.attentionState === "verifying");
      node.classList.toggle("is-edge-right", placeRight);
      node.classList.toggle("is-edge-left", !placeRight);
      node.style.left = `${anchorX}px`;
      node.style.top = `${anchorY}px`;
      node.style.zIndex = object.primary ? "3" : object.locallyVerified ? "2" : "1";
      node.setAttribute("aria-label", copy);
      node.firstElementChild.textContent = copy;
    }
    objectLayer.hidden = false;
  }

  function renderPanel() {
    if (nodes.panel) nodes.panel.dataset.phase = state.status;
    if (nodes.state) nodes.state.textContent = stateLabel(state);
    if (nodes.notice) nodes.notice.textContent = state.notice || "Scanning scene.";
    if (nodes.objectCount) {
      nodes.objectCount.textContent = String(state.objects.length);
      nodes.objectCount.dataset.inferenceFrames = String(runtime.metrics.inferenceFrames);
      nodes.objectCount.dataset.yoloLatencyMs = String(runtime.serviceDiagnostics.yoloLatencyMs || 0);
      nodes.objectCount.dataset.yoloAverageLatencyMs = String(runtime.serviceDiagnostics.yoloAverageLatencyMs || 0);
      nodes.objectCount.dataset.activeModelInstances = String(runtime.serviceDiagnostics.yoloModelInstances || 0);
      nodes.objectCount.dataset.queueDepth = String(runtime.serviceDiagnostics.inferenceQueueDepth || 0);
      nodes.objectCount.dataset.bestFrameFailures = String(runtime.metrics.bestFrameFailures);
      nodes.objectCount.dataset.bestFrameError = runtime.lastBestFrameError;
      nodes.objectCount.dataset.errorCode = String(state.error?.code || "");
    }
    if (nodes.energyMode) nodes.energyMode.value = runtime.energyMode;
    if (nodes.automaticVision) nodes.automaticVision.checked = runtime.automaticVisionEnabled;
    if (nodes.labels) nodes.labels.checked = runtime.labelsEnabled;
    if (nodes.pause) {
      nodes.pause.textContent = runtime.pausedByUser ? "Resume" : "Pause";
      nodes.pause.disabled = !runtime.automaticVisionEnabled;
    }
    renderDiagnostics();
  }

  function renderDiagnostics() {
    if (!nodes.diagnostics) return;
    const developerVisible = ["localhost", "127.0.0.1", "::1"].includes(String(globalThis.location?.hostname || ""))
      && ["1", "true"].includes(new URLSearchParams(String(globalThis.location?.search || "")).get("sensefield-test") || "");
    nodes.diagnostics.hidden = !developerVisible;
    setText(nodes.diagEnergy, runtime.energyMode);
    setText(nodes.diagFps, runtime.staticStreak >= 4 ? "1 Hz static" : runtime.energyMode === "balanced" && now() < runtime.motionBoostUntil ? "5 Hz motion" : "3 Hz");
    setText(nodes.diagResolution, `${INPUT_WIDTH} px`);
    setText(nodes.diagLatency, `${Number(runtime.serviceDiagnostics.yoloLatencyMs || 0).toFixed(1)} ms`);
    setText(nodes.diagTracks, String(state.objects.length));
    setText(nodes.diagFlorence, String(runtime.serviceDiagnostics.florenceState || "unloaded"));
    setText(nodes.diagFlorenceRequests, String(runtime.serviceDiagnostics.florenceRequestCount || 0));
    setText(nodes.diagQueue, String(runtime.serviceDiagnostics.inferenceQueueDepth || 0));
    setText(nodes.diagHidden, doc.visibilityState === "hidden" ? "paused" : "active");
    setText(nodes.diagProcesses, String(runtime.serviceDiagnostics.activeInferenceProcesses || (runtime.sessionStarted ? 1 : 0)));
  }

  function clearObjectNodes() {
    runtime.objectNodes.clear();
    objectLayer.replaceChildren();
    objectLayer.hidden = true;
  }

  function bindEvents() {
    listen(nodes.exit, "click", () => options.onExit?.());
    listen(nodes.automaticVision, "change", () => void toggleAutomaticVision(nodes.automaticVision.checked));
    listen(nodes.labels, "change", () => {
      runtime.labelsEnabled = nodes.labels.checked;
      render();
    });
    listen(nodes.pause, "click", () => void toggleUserPause());
    listen(doc, "visibilitychange", handleVisibilityChange);
  }

  function bindResize() {
    const ResizeObserverClass = options.ResizeObserver || globalThis.ResizeObserver;
    if (typeof ResizeObserverClass !== "function") return;
    runtime.resizeObserver = new ResizeObserverClass(() => renderObjects());
    runtime.resizeObserver.observe(stage);
  }

  function handleVisibilityChange() {
    if (!state.active || !runtime.sessionId) return;
    if (doc.visibilityState === "hidden") {
      stopFrameLoop();
      cancelHiddenPause();
      runtime.hiddenTimer = setTimer(() => void pauseForHiddenTab(), HIDDEN_GRACE_MS);
    } else {
      cancelHiddenPause();
      void resumeFromHiddenTab();
    }
    render();
  }

  async function pauseForHiddenTab() {
    runtime.hiddenTimer = null;
    if (doc.visibilityState !== "hidden" || !state.active || !runtime.sessionStarted) return;
    runtime.metrics.hiddenPauses += 1;
    await suspendPerception("Local vision paused while this tab is hidden.");
  }

  async function resumeFromHiddenTab() {
    if (!state.active || runtime.sessionStarted || !runtime.sessionId || !runtime.automaticVisionEnabled || runtime.pausedByUser) return;
    state = { ...state, status: "starting", notice: "Resuming local vision…" };
    render();
    try {
      const result = await service.startSession(runtime.sessionId, runtime.energyMode);
      runtime.serviceDiagnostics = result.diagnostics || runtime.serviceDiagnostics;
      runtime.sessionStarted = true;
      state = { ...state, status: "live", notice: "Scanning scene." };
      startFrameLoop();
      render();
    } catch (error) {
      state = { ...state, status: "error", error: safeError(error), notice: "Local object detection could not resume." };
      render();
    }
  }

  async function suspendPerception(notice) {
    stopFrameLoop();
    runtime.inspectionAbortController?.abort?.();
    runtime.inspectionAbortController = null;
    runtime.verificationInFlight = null;
    if (runtime.sessionStarted && runtime.sessionId) {
      try {
        const result = await service.pauseSession(runtime.sessionId, runtime.energyMode);
        runtime.serviceDiagnostics = result.diagnostics || runtime.serviceDiagnostics;
      } catch (error) {
        state = { ...state, error: safeError(error) };
      }
    }
    runtime.sessionStarted = false;
    imageRuntime.clear();
    runtime.trackMetadata.clear();
    clearObjectNodes();
    state = { ...state, status: "paused", objects: [], primaryObjectId: null, primaryObject: null, notice };
    render();
  }

  async function toggleAutomaticVision(enabled) {
    runtime.automaticVisionEnabled = enabled === true;
    if (!runtime.automaticVisionEnabled) {
      runtime.pausedByUser = false;
      await suspendPerception("Automatic vision is off.");
    } else if (doc.visibilityState !== "hidden") {
      await resumeFromHiddenTab();
    }
    render();
  }

  async function toggleUserPause() {
    runtime.pausedByUser = !runtime.pausedByUser;
    if (runtime.pausedByUser) await suspendPerception("Local vision paused.");
    else if (runtime.automaticVisionEnabled && doc.visibilityState !== "hidden") await resumeFromHiddenTab();
    render();
  }

  function cancelHiddenPause() {
    if (runtime.hiddenTimer != null) clearTimer(runtime.hiddenTimer);
    runtime.hiddenTimer = null;
  }

  function listen(node, type, handler) {
    if (!node?.addEventListener) return;
    node.addEventListener(type, handler);
    runtime.listeners.push(() => node.removeEventListener(type, handler));
  }

  function emit(type, metadata = {}) {
    options.onEvent?.(type, metadata);
  }

  function snapshot() {
    return Object.freeze({
      ...state,
      objects: Object.freeze(state.objects.map((object) => Object.freeze({ ...object, box: Object.freeze({ ...object.box }) }))),
      primaryObject: state.primaryObject ? Object.freeze({ ...state.primaryObject, box: Object.freeze({ ...state.primaryObject.box }) }) : null,
      provider: Object.freeze({ ...state.provider }),
      capabilityState: Object.freeze({
        localDetection: state.provider.localDetection || (state.status === "error" ? "unavailable" : "inactive"),
        tracking: state.provider.tracking || (state.status === "error" ? "unavailable" : "inactive"),
        semanticEnrichment: state.provider.semanticEnrichment || "unconfigured"
      }),
      energyMode: runtime.energyMode,
      automaticVisionEnabled: runtime.automaticVisionEnabled,
      labelsEnabled: runtime.labelsEnabled,
      pausedByUser: runtime.pausedByUser,
      bestFrameMemory: imageRuntime.stats(),
      inferenceMirrored: false,
      rawFrameRetained: false,
      remoteRequests: 0
    });
  }

  function diagnostics() {
    return Object.freeze({
      ...runtime.metrics,
      ...runtime.serviceDiagnostics,
      activeMicroscopeRuntimes: state.active ? 1 : 0,
      activeFrameLoops: runtime.loopActive ? 1 : 0,
      activeDetectorInstances: Number(runtime.serviceDiagnostics.yoloModelInstances || 0),
      activeInference: runtime.inferenceInFlight ? 1 : 0,
      detectedObjects: state.objects.length,
      primaryObjectId: state.primaryObjectId,
      providerRequests: runtime.metrics.providerRequestsStarted,
      backgroundRequests: 0,
      maxInferenceQueueLength: 1,
      continuousSegmentation: false,
      florenceAutomaticMode: true,
      automaticVisionEnabled: runtime.automaticVisionEnabled,
      labelsEnabled: runtime.labelsEnabled,
      bufferedBestFrames: imageRuntime.stats().frames,
      inferenceMirrored: false,
      remoteRequests: 0
    });
  }

  async function dispose() {
    if (runtime.disposed) return;
    await stop("dispose");
    runtime.disposed = true;
    runtime.resizeObserver?.disconnect?.();
    runtime.resizeObserver = null;
    for (const remove of runtime.listeners.splice(0)) remove();
  }

  return Object.freeze({
    diagnostics,
    dispose,
    handlePrimaryAction: async () => ({ ok: true, state: snapshot() }),
    isActive: () => state.active,
    primaryActionDisabled: () => true,
    primaryActionLabel: () => "Automatic local vision",
    setAutomaticVision: toggleAutomaticVision,
    setLabels: (enabled) => {
      runtime.labelsEnabled = enabled === true;
      render();
    },
    togglePause: toggleUserPause,
    snapshot,
    start,
    stop
  });
}

export function detectorDelayForState(input = {}) {
  if (input.energyMode === "balanced" && input.motionBoostActive === true) return 200;
  if (Number(input.staticStreak) >= 4) return 1_000;
  return 333;
}

function bindMicroscopeDom(root) {
  const byId = (id) => root?.querySelector?.(`#${id}`) || null;
  return {
    panel: byId("microscopePanel"),
    state: byId("microscopeState"),
    notice: byId("microscopeNotice"),
    objectCount: byId("microscopeObjectCount"),
    exit: byId("exitMicroscope"),
    automaticVision: byId("microscopeAutomaticVision"),
    energyMode: byId("microscopeEnergyMode"),
    labels: byId("microscopeLabels"),
    pause: byId("microscopePause"),
    diagnostics: byId("microscopeDiagnostics"),
    diagEnergy: byId("microscopeDiagEnergy"),
    diagFps: byId("microscopeDiagFps"),
    diagResolution: byId("microscopeDiagResolution"),
    diagLatency: byId("microscopeDiagLatency"),
    diagTracks: byId("microscopeDiagTracks"),
    diagFlorence: byId("microscopeDiagFlorence"),
    diagFlorenceRequests: byId("microscopeDiagFlorenceRequests"),
    diagQueue: byId("microscopeDiagQueue"),
    diagHidden: byId("microscopeDiagHidden"),
    diagProcesses: byId("microscopeDiagProcesses")
  };
}

function initialState(capability = {}) {
  return {
    status: "inactive",
    active: false,
    objects: [],
    primaryObjectId: null,
    primaryObject: null,
    provider: capability || {},
    error: null,
    notice: "",
    lastStopReason: null
  };
}

function stateLabel(state) {
  if (state.status === "starting") return "Starting local vision";
  if (state.status === "paused") return "Local vision paused";
  if (state.status === "verifying") return "Identifying presented object";
  if (state.status === "error") return "Local vision unavailable";
  if (state.status === "live") return state.objects.length
    ? `${state.objects.length} object${state.objects.length === 1 ? "" : "s"} understood`
    : "Local vision active";
  return "Inactive";
}

async function waitForVideo(video, isCurrent) {
  if (!video.srcObject) throw codedError("camera_stream_unavailable");
  await video.play?.();
  if (videoIsReady(video)) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(codedError("camera_metadata_timeout")), 10_000);
    const check = () => {
      if (!isCurrent()) return finish(codedError("microscope_start_superseded"));
      if (videoIsReady(video)) finish();
    };
    const finish = (error) => {
      clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", check);
      video.removeEventListener("playing", check);
      error ? reject(error) : resolve();
    };
    video.addEventListener("loadedmetadata", check);
    video.addEventListener("playing", check);
    check();
  });
}

function videoIsReady(video) {
  return Number(video.videoWidth) > 0
    && Number(video.videoHeight) > 0
    && Number(video.readyState) >= 2
    && video.paused !== true;
}

function captureDetectionFrame(video, doc, runtime) {
  const sourceWidth = Math.max(1, Number(video.videoWidth) || 1);
  const sourceHeight = Math.max(1, Number(video.videoHeight) || 1);
  const outputHeight = Math.max(1, Math.round(INPUT_WIDTH * sourceHeight / sourceWidth));
  if (!runtime.frameCanvas) {
    runtime.frameCanvas = doc.createElement("canvas");
    runtime.frameContext = runtime.frameCanvas.getContext("2d", { alpha: false, desynchronized: true });
  }
  runtime.frameCanvas.width = INPUT_WIDTH;
  runtime.frameCanvas.height = outputHeight;
  runtime.frameContext.drawImage(video, 0, 0, INPUT_WIDTH, outputHeight);
  const dataUrl = runtime.frameCanvas.toDataURL("image/jpeg", 0.72);
  return {
    dataUrl,
    clear: () => runtime.frameContext?.clearRect?.(0, 0, INPUT_WIDTH, outputHeight)
  };
}

function measureMotion(video, doc, runtime) {
  if (!runtime.motionCanvas) {
    runtime.motionCanvas = doc.createElement("canvas");
    runtime.motionCanvas.width = 32;
    runtime.motionCanvas.height = 24;
    runtime.motionContext = runtime.motionCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  }
  runtime.motionContext.drawImage(video, 0, 0, 32, 24);
  const rgba = runtime.motionContext.getImageData(0, 0, 32, 24).data;
  const pixels = new Uint8Array(32 * 24);
  for (let source = 0, target = 0; target < pixels.length; source += 4, target += 1) {
    pixels[target] = Math.round(rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114);
  }
  if (!runtime.previousMotionPixels) {
    runtime.previousMotionPixels = pixels;
    return 1;
  }
  let difference = 0;
  for (let index = 0; index < pixels.length; index += 1) difference += Math.abs(pixels[index] - runtime.previousMotionPixels[index]);
  runtime.previousMotionPixels = pixels;
  return Math.min(1, difference / pixels.length / 255);
}

function releaseFrameBuffers(runtime) {
  for (const key of ["frameCanvas", "motionCanvas"]) {
    const canvas = runtime[key];
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
    runtime[key] = null;
  }
  runtime.frameContext = null;
  runtime.motionContext = null;
  runtime.previousMotionPixels = null;
  runtime.staticStreak = 0;
  runtime.motionBoostUntil = 0;
}

function boxArea(box = {}) {
  return Math.max(0, Number(box.width) || 0) * Math.max(0, Number(box.height) || 0);
}

function boxCenter(box = {}) {
  return {
    x: (Number(box.x) || 0) + (Number(box.width) || 0) / 2,
    y: (Number(box.y) || 0) + (Number(box.height) || 0) / 2
  };
}

function centralityForBox(box) {
  const center = boxCenter(box);
  return clamp01(1 - Math.hypot(center.x - 0.5, center.y - 0.5) / 0.71);
}

function nearestTrackProximity(object, tracks) {
  const center = boxCenter(object.box);
  let strongest = 0;
  for (const track of tracks) {
    if (track.id === object.id) continue;
    const other = boxCenter(track.box);
    strongest = Math.max(strongest, clamp01(1 - Math.hypot(center.x - other.x, center.y - other.y) / 0.42));
  }
  return strongest;
}

function strongestCoMotion(metadata, personMetadata) {
  if (!metadata || Math.hypot(metadata.dx || 0, metadata.dy || 0) < 0.003) return 0;
  let strongest = 0;
  for (const person of personMetadata) {
    if (!person || person === metadata) continue;
    const leftMagnitude = Math.hypot(metadata.dx || 0, metadata.dy || 0);
    const rightMagnitude = Math.hypot(person.dx || 0, person.dy || 0);
    if (rightMagnitude < 0.003) continue;
    const cosine = ((metadata.dx || 0) * (person.dx || 0) + (metadata.dy || 0) * (person.dy || 0))
      / (leftMagnitude * rightMagnitude);
    strongest = Math.max(strongest, clamp01((cosine + 1) / 2));
  }
  return strongest;
}

function localCandidatesConflict(candidates) {
  const usable = (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate?.label).slice(0, 2);
  if (usable.length < 2 || usable[0].label === usable[1].label) return false;
  return Math.abs(Number(usable[0].confidence) - Number(usable[1].confidence)) <= 0.18;
}

function isDeepCandidate(object) {
  const label = String(object.localLabel || object.label || "").toLowerCase();
  const area = boxArea(object.box);
  return object.state !== "occluded"
    && area >= 0.008
    && area <= 0.68
    && !/\b(person|hand|face)\b/.test(label);
}

function presentationPriority(object) {
  return Number(object.presentation?.score || 0)
    + (object.attentionState === "presented" ? 0.5 : 0)
    + (object.semantic ? 0.35 : 0);
}

function cognitionNotice(objects, primaryObject, verificationInFlight) {
  if (verificationInFlight) return "Identifying locally.";
  if (primaryObject?.semantic) return `${semanticTitle(primaryObject.semantic)} identified.`;
  if (primaryObject?.attentionState === "presented") return "Choosing a clearer view.";
  if (primaryObject?.attentionState === "attention_candidate") return "Object presented.";
  if (objects.some((object) => object.state === "reacquired")) return "Object reacquired.";
  return "Scanning scene.";
}

function labelCandidates(objects) {
  return [...objects]
    .filter((object) => {
      if (boxArea(object.box) > 0.68) return false;
      if (object.state === "occluded" && !object.semantic) return false;
      return object.semantic
        || object.attentionState === "verifying"
        || object.attentionState === "presented"
        || object.attentionState === "attention_candidate"
        || (object.confidence >= 0.76 && boxArea(object.box) >= 0.012);
    })
    .sort((left, right) => presentationPriority(right) - presentationPriority(left))
    .slice(0, 4);
}

function floatingLabelText(object) {
  if (object.attentionState === "verifying") return "Identifying…";
  const title = semanticTitle(object.semantic || object);
  if (!title || /^unknown object$/i.test(title)) return "Identifying…";
  if (object.semantic?.uncertain === true || (!object.semantic && object.confidence < 0.7)) return `Possible ${title}`;
  return object.semantic ? `${title} ✓` : title;
}

function semanticTitle(value = {}) {
  const text = String(value.title || value.label || "").replace(/\s+/g, " ").trim().slice(0, 72);
  return text.replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function clamp01(value) {
  return clampNumber(value, 0, 1);
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function setText(node, value) {
  if (node) node.textContent = String(value);
}

function safeError(error) {
  return Object.freeze({
    code: String(error?.code || "microscope_runtime_error"),
    message: String(error?.message || "Unknown microscope runtime error").slice(0, 500)
  });
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function failure(code, error) {
  return Object.freeze({ ok: false, code, error: error?.message || undefined });
}
