import { createNeuralFieldRenderer } from "./neural-field-renderer.js";
import { LocalReplayCompositor } from "./replay-compositor.js";

const TOOLS = Object.freeze(["airscript", "spatial-lasso"]);
const FIXTURES = new Set(["airscript", "lasso-selected", "relation", "ambiguous", "uncertain", "reduced-motion"]);
const STATUS_LABELS = Object.freeze({
  ready: "Ready",
  "tracking-hand": "Tracking hand",
  tracking: "Tracking hand",
  "pinch-to-draw": "Pinch to draw",
  drawing: "Drawing",
  "stroke-complete": "Stroke complete",
  "grounding-object": "Grounding object",
  "object-selected": "Object selected",
  "relation-found": "Relation found",
  "tracking-uncertain": "Tracking uncertain",
  uncertain: "Tracking uncertain",
  unavailable: "Neural Field unavailable",
  "neural-field-unavailable": "Neural Field unavailable"
});
const SUPPORTED_RELATIONS = Object.freeze({
  left_of: "left of",
  right_of: "right of",
  above: "above",
  below: "below",
  in_front_of: "in front of",
  behind: "behind",
  closer_than: "closer than",
  farther_than: "farther than",
  closest_to_camera: "closest to camera",
  approaching: "approaching",
  moving_away: "moving away from",
  near: "near",
  far: "far from",
  inside: "inside",
  contains: "around"
});

function statusLabel(value, fallback = "Ready") {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/\s+/g, "-");
  return STATUS_LABELS[key] || fallback;
}

function stateSlug(value) {
  return String(value || "ready").trim().toLowerCase().replaceAll(" ", "-");
}

function safeUserMessage(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!text) return "";
  if (/[{}\[\]]|\b(stack|schema|model name|object[_ ]id|landmark array|coordinates?|error[_ ]code)\b/i.test(text)) return "";
  return text;
}

function safeLabel(value, fallback) {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 48);
  if (!text || /[_{}\[\]]/.test(text)) return fallback;
  return text;
}

function firstHandLandmarks(frame) {
  const fallback = Array.isArray(frame?.landmarks)
    ? (Array.isArray(frame.landmarks[0]) ? frame.landmarks[0] : frame.landmarks)
    : null;
  const supplied = Array.isArray(frame?.hands) ? frame.hands[0]?.landmarks : fallback;
  return Array.isArray(supplied) && supplied.length >= 9 ? supplied : null;
}

function frameHasHand(frame) {
  return Boolean(firstHandLandmarks(frame) || (Array.isArray(frame?.hands) && frame.hands.length > 0));
}

function frameConfidence(frame) {
  const values = [frame?.confidence, frame?.trackingConfidence, frame?.hands?.[0]?.confidence, frame?.hands?.[0]?.score]
    .map(Number)
    .filter(Number.isFinite);
  return values.length ? Math.max(0, Math.min(1, values[0])) : null;
}

function distance(a, b) {
  return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0), Number(a?.y || 0) - Number(b?.y || 0));
}

function frameIsPinching(frame) {
  const explicit = frame?.pinching ?? frame?.pinch?.active ?? frame?.gesture?.pinching;
  if (typeof explicit === "boolean") return explicit;
  const points = firstHandLandmarks(frame);
  if (!points) return false;
  const palmScale = Math.max(distance(points[0], points[9]), 0.04);
  return distance(points[4], points[8]) / palmScale < 0.46;
}

function relationTextForResult(result) {
  const entityLabels = new Map(
    [...(Array.isArray(result?.objects) ? result.objects : []), ...(Array.isArray(result?.hands) ? result.hands : [])]
      .map((item) => [String(item?.id || item?.track_id || item?.hand_id || item?.handedness || ""), safeLabel(item?.label || (item?.handedness ? `${item.handedness} Hand` : ""), "")])
      .filter(([id, label]) => id && label)
  );
  const relations = Array.isArray(result?.relations) ? result.relations : [];
  for (const relation of relations) {
    const type = String(relation?.predicate || relation?.type || relation?.relation || "").toLowerCase();
    const copy = SUPPORTED_RELATIONS[type];
    if (!copy) continue;
    const subjectId = String(relation?.subject_id || relation?.subject?.id || "");
    const subject = safeLabel(relation?.subject_label || relation?.subject?.label || entityLabels.get(subjectId), "Object");
    if (type === "closest_to_camera") return `${subject} — ${copy}`;
    const referenceId = String(relation?.object_id || relation?.reference_id || relation?.object?.id || relation?.reference?.id || "");
    const reference = safeLabel(relation?.reference_label || relation?.object_label || relation?.reference?.label || relation?.object?.label || entityLabels.get(referenceId), "object");
    return `${subject} — ${copy} — ${reference}`;
  }
  const interactions = Array.isArray(result?.interactions) ? result.interactions : [];
  const approaching = interactions.find((item) => ["hand_approaches_object", "hand_approaching_object"].includes(String(item?.predicate || item?.type || "")));
  if (!approaching) return "";
  const subject = safeLabel(approaching.subject_label || entityLabels.get(String(approaching.subject_id || "")), "Hand");
  const reference = safeLabel(approaching.reference_label || entityLabels.get(String(approaching.object_id || approaching.reference_id || "")), "object");
  return `${subject} — approaching — ${reference}`;
}

function callSafely(callback, ...args) {
  try {
    return callback?.(...args);
  } catch {
    return undefined;
  }
}

function isRendererSnapshot(value) {
  return Boolean(value && typeof value === "object" && (
    typeof value.status === "string" ||
    typeof value.active === "boolean" ||
    value.paths ||
    value.lasso
  ));
}

export function mountNeuralField(options = {}) {
  const root = options.root || globalThis.document?.querySelector?.("[data-primary-view]") || null;
  const canvas = options.canvas || root?.querySelector?.("#neuralFieldCanvas") || null;
  const video = options.video || root?.querySelector?.("#preview") || null;
  const stage = options.stage || root?.querySelector?.(".sf-camera-frame") || null;
  const launcher = options.launcher || root?.querySelector?.("#neuralFieldLauncher") || null;
  const controls = options.controls || root?.querySelector?.("#neuralFieldControls") || null;
  const statusNode = options.statusNode || root?.querySelector?.("#neuralFieldStatus") || null;
  const statusText = statusNode?.querySelector?.("#neuralFieldStatusText") || null;
  const evidenceNode = options.evidenceNode || root?.querySelector?.("#neuralFieldEvidence") || null;
  const evidenceText = options.evidenceText || root?.querySelector?.("#neuralFieldEvidenceText") || null;
  const dismissEvidence = options.dismissEvidence || root?.querySelector?.("#dismissNeuralFieldEvidence") || null;
  const relationText = options.relationText || root?.querySelector?.("#neuralFieldRelationText") || null;
  const toolButtons = Array.from(controls?.querySelectorAll?.("[data-neural-field-tool]") || []);
  const testMode = options.testMode === true;
  const requestedFixture = testMode && FIXTURES.has(String(options.fixture || "")) ? String(options.fixture) : "";
  const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") || null;

  let active = false;
  let disposed = false;
  let cameraActive = Boolean(callSafely(options.isCameraActive) ?? options.cameraActive);
  let tool = TOOLS.includes(options.initialTool) ? options.initialTool : "airscript";
  let status = "Ready";
  let fixture = requestedFixture;
  let renderer = null;
  let compositor = null;
  let lastRendererSnapshot = null;
  let lastRendererMetrics = null;
  let reducedMotion = motionQuery?.matches === true;
  let trackingAvailability = { available: true, status: "ready", reason: "" };
  let rendererStateRevision = 0;
  let hadTrackedHand = false;
  let wasPinching = false;
  let strokeHadPoints = false;
  let feedbackTimer = null;

  function setStatus(nextStatus) {
    const next = statusLabel(nextStatus, status);
    status = next;
    if (statusText && statusText.textContent !== next) statusText.textContent = next;
    if (statusNode) statusNode.dataset.state = stateSlug(next);
    if (active && globalThis.document?.body) globalThis.document.body.dataset.neuralFieldStatus = stateSlug(next);
  }

  function hideEvidence() {
    if (evidenceNode) evidenceNode.hidden = true;
    if (evidenceText) evidenceText.textContent = "";
  }

  function showEvidence(message) {
    const safeMessage = safeUserMessage(message);
    if (!safeMessage) {
      hideEvidence();
      return;
    }
    if (evidenceText) evidenceText.textContent = safeMessage;
    if (evidenceNode) evidenceNode.hidden = false;
  }

  function setRelationText(message) {
    if (relationText) relationText.textContent = safeUserMessage(message);
  }

  function applyRendererState(snapshot = {}) {
    rendererStateRevision += 1;
    lastRendererSnapshot = {
      ...(lastRendererSnapshot || {}),
      ...snapshot,
      paths: snapshot.paths ? { ...(lastRendererSnapshot?.paths || {}), ...snapshot.paths } : lastRendererSnapshot?.paths,
      lasso: snapshot.lasso ? { ...(lastRendererSnapshot?.lasso || {}), ...snapshot.lasso } : lastRendererSnapshot?.lasso
    };
    if (typeof snapshot.reducedMotion === "boolean") reducedMotion = snapshot.reducedMotion;
    if (snapshot.tool && TOOLS.includes(snapshot.tool) && snapshot.tool !== tool) selectTool(snapshot.tool, false);
    if (snapshot.status) setStatus(snapshot.status);
    const message = safeUserMessage(snapshot.message || snapshot.evidence?.message || snapshot.evidenceText);
    if (message) showEvidence(message);
    else if (Object.hasOwn(snapshot, "message") || Object.hasOwn(snapshot, "evidenceText")) hideEvidence();
    if (snapshot.dismissed === true || snapshot.evidence?.visible === false) hideEvidence();
    const relation = Array.isArray(snapshot.relations)
      ? snapshot.relations.map((item) => safeUserMessage(typeof item === "string" ? item : item?.label || item?.text || item?.description)).filter(Boolean).join(". ")
      : safeUserMessage(snapshot.relationText || snapshot.relation);
    if (relation || Array.isArray(snapshot.relations)) setRelationText(relation);
  }

  function clearFeedbackTimer() {
    if (feedbackTimer != null) globalThis.clearTimeout?.(feedbackTimer);
    feedbackTimer = null;
  }

  function showCameraRequiredFeedback() {
    clearFeedbackTimer();
    setStatus("Neural Field unavailable");
    showEvidence("Start the camera to use Neural Field.");
    if (controls) {
      controls.hidden = false;
      controls.dataset.feedbackOnly = "true";
    }
    feedbackTimer = globalThis.setTimeout?.(() => {
      if (active) return;
      if (controls) controls.hidden = true;
      hideEvidence();
    }, 5000) || null;
  }

  function ensureRenderer() {
    if (renderer) return true;
    if (!canvas) return false;
    try {
      renderer = createNeuralFieldRenderer(canvas, {
        reducedMotion,
        onStateChange: applyRendererState
      });
      renderer.setTool(tool);
      renderer.setTrackingAvailability(trackingAvailability);
      renderer.start();
      renderer.setActive(true);
      lastRendererSnapshot = callSafely(renderer.getSnapshot?.bind(renderer)) || lastRendererSnapshot;
      try {
        compositor = new LocalReplayCompositor({ video, canvas, renderer });
      } catch {
        compositor = null;
      }
      return true;
    } catch {
      callSafely(renderer?.dispose?.bind(renderer));
      renderer = null;
      compositor = null;
      return false;
    }
  }

  function releaseResources() {
    const rendererBeforeDispose = renderer;
    const releasedSnapshot = callSafely(rendererBeforeDispose?.getSnapshot?.bind(rendererBeforeDispose)) || lastRendererSnapshot || {};
    lastRendererMetrics = callSafely(rendererBeforeDispose?.getMetrics?.bind(rendererBeforeDispose)) || lastRendererMetrics;
    if (compositor) {
      const disposedCompositor = callSafely(compositor.dispose?.bind(compositor));
      if (disposedCompositor && typeof disposedCompositor.catch === "function") disposedCompositor.catch(() => {});
    }
    if (renderer) {
      callSafely(renderer.setActive?.bind(renderer), false);
      callSafely(renderer.stop?.bind(renderer));
      callSafely(renderer.dispose?.bind(renderer));
    }
    const disposedSnapshot = callSafely(rendererBeforeDispose?.getSnapshot?.bind(rendererBeforeDispose)) || releasedSnapshot;
    lastRendererSnapshot = {
      ...disposedSnapshot,
      active: false,
      running: false,
      disposed: true,
      width: 0,
      height: 0,
      paths: { liveEvidence: [], liveStabilized: [], completed: [] },
      lasso: { points: [], valid: false, feedback: null },
      anchors: [],
      relations: [],
      faceBounds: [],
      labelLayouts: []
    };
    compositor = null;
    renderer = null;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.hidden = true;
    }
  }

  function selectTool(nextTool, announce = true) {
    if (!TOOLS.includes(nextTool)) return false;
    tool = nextTool;
    for (const button of toolButtons) {
      button.setAttribute("aria-pressed", button.dataset.neuralFieldTool === tool ? "true" : "false");
    }
    if (canvas) canvas.dataset.tool = tool;
    if (active && globalThis.document?.body) globalThis.document.body.dataset.neuralFieldTool = tool;
    callSafely(renderer?.setTool?.bind(renderer), tool);
    hadTrackedHand = false;
    wasPinching = false;
    strokeHadPoints = false;
    setRelationText("");
    hideEvidence();
    if (announce) setStatus("Ready");
    return true;
  }

  function activate() {
    if (disposed || active || !canvas || !controls) return active;
    cameraActive = Boolean(callSafely(options.isCameraActive) ?? cameraActive);
    const fixtureAllowed = testMode && Boolean(fixture);
    if (!cameraActive && !fixtureAllowed) {
      showCameraRequiredFeedback();
      return false;
    }
    clearFeedbackTimer();
    delete controls.dataset.feedbackOnly;
    hideEvidence();
    if (!ensureRenderer()) {
      setStatus("Neural Field unavailable");
      showEvidence("Neural Field is unavailable right now.");
      controls.hidden = false;
      controls.dataset.feedbackOnly = "true";
      return false;
    }
    active = true;
    controls.hidden = false;
    canvas.hidden = false;
    launcher?.setAttribute("aria-pressed", "true");
    globalThis.document?.body?.classList?.add("sf-neural-field-active");
    if (globalThis.document?.body) {
      globalThis.document.body.dataset.neuralFieldTool = tool;
      globalThis.document.body.dataset.neuralFieldStatus = stateSlug(status);
      if (testMode && fixture) globalThis.document.body.dataset.neuralFieldFixture = fixture;
    }
    setStatus(trackingAvailability.available === false ? "Neural Field unavailable" : "Ready");
    callSafely(options.onActiveChange, true);
    return true;
  }

  function exit(exitOptions = {}) {
    const wasActive = active;
    active = false;
    clearFeedbackTimer();
    releaseResources();
    controls?.removeAttribute("data-feedback-only");
    if (controls) controls.hidden = true;
    hideEvidence();
    setRelationText("");
    launcher?.setAttribute("aria-pressed", "false");
    globalThis.document?.body?.classList?.remove("sf-neural-field-active");
    if (globalThis.document?.body) {
      delete globalThis.document.body.dataset.neuralFieldTool;
      delete globalThis.document.body.dataset.neuralFieldStatus;
      delete globalThis.document.body.dataset.neuralFieldFixture;
    }
    hadTrackedHand = false;
    wasPinching = false;
    strokeHadPoints = false;
    status = "Ready";
    if (statusText) statusText.textContent = status;
    if (statusNode) statusNode.dataset.state = "ready";
    if (wasActive) callSafely(options.onActiveChange, false);
    if (exitOptions.restoreFocus !== false && launcher) {
      globalThis.requestAnimationFrame?.(() => callSafely(launcher.focus?.bind(launcher), { preventScroll: true }));
    }
    return wasActive;
  }

  function setCameraActive(nextCameraActive) {
    cameraActive = nextCameraActive === true;
    if (!active) {
      if (cameraActive && controls?.dataset.feedbackOnly === "true") {
        clearFeedbackTimer();
        controls.hidden = true;
        controls.removeAttribute("data-feedback-only");
        hideEvidence();
        setStatus("Ready");
      }
      return cameraActive;
    }
    if (testMode && fixture) return cameraActive;
    if (!cameraActive) {
      trackingAvailability = { available: false, status: "unavailable", reason: "Camera unavailable" };
      callSafely(renderer?.setTrackingAvailability?.bind(renderer), trackingAvailability);
      setStatus("Neural Field unavailable");
      showEvidence("The camera stopped. Start it again to continue.");
      return false;
    }
    trackingAvailability = { available: true, status: "ready", reason: "" };
    callSafely(renderer?.setTrackingAvailability?.bind(renderer), trackingAvailability);
    hideEvidence();
    setStatus("Ready");
    return true;
  }

  function ingestHandFrame(frame) {
    if (!active || !renderer || !frame) return false;
    const revision = rendererStateRevision;
    const rendererSnapshot = callSafely(renderer.ingestHandFrame?.bind(renderer), frame);
    if (isRendererSnapshot(rendererSnapshot)) applyRendererState(rendererSnapshot);
    if (rendererStateRevision !== revision) return true;
    const confidence = frameConfidence(frame);
    if (confidence != null && confidence < 0.35) {
      setStatus("Tracking uncertain");
      return true;
    }
    if (!frameHasHand(frame)) {
      hadTrackedHand = false;
      wasPinching = false;
      setStatus("Ready");
      return true;
    }
    const pinching = frameIsPinching(frame);
    if (!hadTrackedHand) {
      hadTrackedHand = true;
      setStatus("Tracking hand");
    } else if (pinching) {
      strokeHadPoints = true;
      setStatus("Drawing");
    } else if (wasPinching && strokeHadPoints) {
      setStatus(tool === "airscript" ? "Stroke complete" : "Grounding object");
      strokeHadPoints = false;
    } else {
      setStatus(tool === "airscript" ? "Pinch to draw" : "Tracking hand");
    }
    wasPinching = pinching;
    return true;
  }

  function ingestSpatialResult(result) {
    if (!active || !renderer || !result) return false;
    const revision = rendererStateRevision;
    const rendererSnapshot = callSafely(renderer.ingestSpatialResult?.bind(renderer), result);
    if (isRendererSnapshot(rendererSnapshot)) applyRendererState(rendererSnapshot);
    const relation = relationTextForResult(result);
    setRelationText(relation);
    const outcome = String(result?.selection?.status || result?.lasso?.status || result?.code || "").toLowerCase();
    if (/ambiguous/.test(outcome)) {
      setStatus("Tracking uncertain");
      showEvidence("Tighten the loop around one object.");
      return true;
    }
    if (/unsupported|no[_-]?object|not[_-]?grounded/.test(outcome)) {
      setStatus("Tracking uncertain");
      showEvidence("No visible object could be grounded there.");
      return true;
    }
    if (result.ok === false) {
      setStatus("Neural Field unavailable");
      showEvidence("Neural Field is unavailable right now.");
      return true;
    }
    if (String(result?.uncertainty?.level || "").toLowerCase() === "high") {
      setStatus("Tracking uncertain");
      const suggestion = safeUserMessage(result?.uncertainty?.suggested_view || result?.partial_observation?.suggested_view);
      if (suggestion) showEvidence(suggestion);
      return true;
    }
    if (relation) {
      setStatus("Relation found");
      return true;
    }
    const explicitlySelected = result.selected_object_id != null
      || result.selection?.object_id != null
      || result.selection?.selected_object_id != null
      || /selected|grounded/.test(String(result.selection?.status || result.lasso?.status || "").toLowerCase())
      || [...(Array.isArray(result.objects) ? result.objects : []), ...(Array.isArray(result.hands) ? result.hands : [])]
        .some((item) => String(item?.state || item?.status || "").toLowerCase() === "selected");
    if (explicitlySelected) {
      setStatus("Object selected");
      return true;
    }
    if (rendererStateRevision === revision && tool === "spatial-lasso") setStatus("Grounding object");
    return true;
  }

  function setTrackingAvailability(value = {}) {
    const normalized = typeof value === "boolean" ? { available: value } : { ...value };
    normalized.available = normalized.available !== false && normalized.status !== "unavailable";
    trackingAvailability = normalized;
    callSafely(renderer?.setTrackingAvailability?.bind(renderer), normalized);
    if (!active) return normalized.available;
    const availabilityStatus = String(normalized.status || "").toLowerCase();
    if (!normalized.available) {
      setStatus("Neural Field unavailable");
      showEvidence(safeUserMessage(normalized.reason) || "Hand tracking is unavailable.");
    } else if (["stalled", "uncertain", "tracking_uncertain"].includes(availabilityStatus)) {
      setStatus("Tracking uncertain");
    } else if (status === "Neural Field unavailable") {
      hideEvidence();
      setStatus("Ready");
    }
    return normalized.available;
  }

  function loadFixture(name = fixture) {
    const nextFixture = String(name || "");
    if (!testMode || !FIXTURES.has(nextFixture)) return false;
    fixture = nextFixture;
    if (!active && !activate()) return false;
    if (globalThis.document?.body) globalThis.document.body.dataset.neuralFieldFixture = fixture;
    const revision = rendererStateRevision;
    const rendererSnapshot = callSafely(renderer?.loadFixture?.bind(renderer), fixture);
    if (isRendererSnapshot(rendererSnapshot)) applyRendererState(rendererSnapshot);
    if (rendererStateRevision === revision) {
      const fallbackStatus = {
        airscript: "Stroke complete",
        "lasso-selected": "Object selected",
        relation: "Relation found",
        ambiguous: "Tracking uncertain",
        uncertain: "Tracking uncertain",
        "reduced-motion": "Ready"
      }[fixture];
      setStatus(fallbackStatus);
      if (fixture === "ambiguous") showEvidence("Tighten the loop around one object.");
    }
    return true;
  }

  function getSnapshot() {
    const currentRendererSnapshot = active ? callSafely(renderer?.getSnapshot?.bind(renderer)) : null;
    if (currentRendererSnapshot) lastRendererSnapshot = currentRendererSnapshot;
    const rendererSnapshot = currentRendererSnapshot || lastRendererSnapshot || {};
    const emptyPaths = { liveEvidence: [], liveStabilized: [], completed: [] };
    const emptyLasso = { points: [], valid: false, feedback: null };
    return {
      ...rendererSnapshot,
      active,
      running: active && rendererSnapshot.running !== false,
      disposed: active ? rendererSnapshot.disposed === true : true,
      loopStarts: Number(rendererSnapshot.loopStarts || 0),
      dpr: Number(rendererSnapshot.dpr || globalThis.devicePixelRatio || 1),
      width: active ? Number(rendererSnapshot.width ?? canvas?.width ?? 0) : 0,
      height: active ? Number(rendererSnapshot.height ?? canvas?.height ?? 0) : 0,
      tool,
      status,
      message: safeUserMessage(rendererSnapshot.message || evidenceText?.textContent),
      reducedMotion: typeof rendererSnapshot.reducedMotion === "boolean" ? rendererSnapshot.reducedMotion : reducedMotion,
      paths: active ? rendererSnapshot.paths || emptyPaths : emptyPaths,
      lasso: active ? rendererSnapshot.lasso || emptyLasso : emptyLasso,
      anchors: active && Array.isArray(rendererSnapshot.anchors) ? rendererSnapshot.anchors : [],
      relations: active && Array.isArray(rendererSnapshot.relations) ? rendererSnapshot.relations : [],
      faceBounds: active && Array.isArray(rendererSnapshot.faceBounds) ? rendererSnapshot.faceBounds : [],
      labelLayouts: active && Array.isArray(rendererSnapshot.labelLayouts) ? rendererSnapshot.labelLayouts : [],
      cameraActive,
      fixture: fixture || null,
      testMode,
      evidenceVisible: evidenceNode?.hidden === false,
      relationText: safeUserMessage(relationText?.textContent),
      compositor: active ? callSafely(compositor?.getState?.bind(compositor)) || null : null,
      containsRawMedia: false
    };
  }

  function getMetrics() {
    const currentMetrics = active ? callSafely(renderer?.getMetrics?.bind(renderer)) : null;
    if (currentMetrics) lastRendererMetrics = currentMetrics;
    const metrics = currentMetrics || lastRendererMetrics || {};
    return {
      fps: active ? Number(metrics.fps || 0) : 0,
      p95RenderMs: active ? Number(metrics.p95RenderMs || 0) : 0,
      pathPointCount: active ? Number(metrics.pathPointCount || 0) : 0,
      canvasMemoryBytes: active ? Number(metrics.canvasMemoryBytes || 0) : 0,
      labelLayoutMs: active ? Number(metrics.labelLayoutMs || 0) : 0,
      relationUpdateMs: active ? Number(metrics.relationUpdateMs || 0) : 0,
      disposed: !active || metrics.disposed === true,
      active,
      width: Number(canvas?.width || 0),
      height: Number(canvas?.height || 0),
      compositor: active ? callSafely(compositor?.getState?.bind(compositor)) || null : null,
      containsRawMedia: false
    };
  }

  function dispose() {
    if (disposed) return;
    exit({ restoreFocus: false });
    disposed = true;
    launcher?.removeEventListener("click", activate);
    dismissEvidence?.removeEventListener("click", dismissEvidenceOverlay);
    for (const button of toolButtons) button.removeEventListener("click", handleToolClick);
    motionQuery?.removeEventListener?.("change", handleMotionChange);
  }

  function dismissEvidenceOverlay() {
    hideEvidence();
    callSafely(renderer?.dismissOverlay?.bind(renderer));
    if (!active && controls) controls.hidden = true;
  }

  function handleToolClick(event) {
    selectTool(event.currentTarget?.dataset?.neuralFieldTool);
  }

  function handleMotionChange(event) {
    reducedMotion = event.matches === true;
    callSafely(renderer?.setReducedMotion?.bind(renderer), reducedMotion);
  }

  launcher?.addEventListener("click", activate);
  dismissEvidence?.addEventListener("click", dismissEvidenceOverlay);
  for (const button of toolButtons) button.addEventListener("click", handleToolClick);
  motionQuery?.addEventListener?.("change", handleMotionChange);
  selectTool(tool, false);
  setStatus("Ready");
  if (controls) controls.hidden = true;
  if (canvas) canvas.hidden = true;

  const api = Object.freeze({
    activate,
    exit,
    isActive: () => active,
    setCameraActive,
    ingestHandFrame,
    ingestSpatialResult,
    setTrackingAvailability,
    dispose,
    getRenderer: () => active ? renderer : null,
    loadFixture,
    getSnapshot,
    getMetrics
  });

  if (testMode && requestedFixture) globalThis.queueMicrotask?.(() => loadFixture(requestedFixture));
  return api;
}
