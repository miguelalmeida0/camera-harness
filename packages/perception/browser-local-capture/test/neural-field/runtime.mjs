import {
  assertNoMediaPayload,
  assertTestOnlyActivation,
  cloneSafe,
  createHandWorkerContract,
  createNeuralFieldStateContract,
  createObjectGroundingContract,
  createPerceptionEventContract,
  createRelationContract,
  createRendererEventContract
} from "./contract-stubs.mjs";

const MAX_POINTS = 256;
const MAX_STROKES = 64;
const MAX_OBJECTS = 32;
const MAX_RELATIONS = 32;
const MAX_TIMELINE = 2_048;

export function createNeuralFieldRuntime(options = {}) {
  assertTestOnlyActivation();
  const clock = options.clock || (() => performance.now());
  const stateContract = createNeuralFieldStateContract();
  const handWorker = createHandWorkerContract(options.handWorker);
  const perceptionContract = createPerceptionEventContract();
  const rendererContract = createRendererEventContract();
  const groundingContract = createObjectGroundingContract();
  const relationContract = createRelationContract();
  const events = [];
  const renders = [];
  const strokeHistory = [];
  const relationHistory = [];
  const pendingRequests = new Map();
  let eventSequence = 0;
  let renderSequence = 0;
  let entitySequence = 0;
  let requestSequence = 0;
  let state = initialState();
  const resources = initialResources();

  function enter({ returnMode = "ask" } = {}) {
    if (!['ask', 'watch'].includes(returnMode)) throw new Error("invalid_neural_field_return_mode");
    cleanupSession();
    state.generation += 1;
    state.mode = "neural_field";
    state.returnMode = returnMode;
    state.active = true;
    state.tool = null;
    state.viewport = { width: 1000, height: 600, orientation: "landscape" };
    activateResources();
    emitEvent("neural_field_entered", { returnMode });
    emitRender("scene.rendered", { objectCount: 0 });
    validateState();
    return snapshot();
  }

  function exit({ returnMode = state.returnMode || "ask" } = {}) {
    if (!['ask', 'watch'].includes(returnMode)) throw new Error("invalid_neural_field_return_mode");
    const priorGeneration = state.generation;
    if (resources.activeRecorders > 0) stopReplay({ reason: "mode_exit" });
    cleanupSession();
    state.generation = priorGeneration + 1;
    state.mode = returnMode;
    state.returnMode = returnMode;
    state.active = false;
    state.tool = null;
    emitEvent("neural_field_exited", { returnMode });
    emitRender("renderer.cleared", { returnMode });
    validateState();
    return snapshot();
  }

  function selectTool(tool) {
    assertActive();
    if (!stateContract.tools.includes(tool)) throw new Error("invalid_neural_field_tool");
    if (state.tool === tool) return snapshot();
    state.generation += 1;
    clearPendingRequests();
    clearTransientVisuals();
    state.tool = tool;
    state.classification = null;
    emitEvent("tool_selected", { tool });
    emitRender("renderer.cleared", { reason: "tool_switch", tool });
    validateState();
    return snapshot();
  }

  function feedLandmarkFrame(frame) {
    assertActive();
    if (!state.tool) throw new Error("neural_field_tool_required");
    assertNoMediaPayload(frame);
    resources.workerQueueDepth += 1;
    resources.peakWorkerQueueDepth = Math.max(resources.peakWorkerQueueDepth, resources.workerQueueDepth);
    let workerResult;
    try {
      workerResult = handWorker.process(frame);
    } finally {
      resources.workerQueueDepth = Math.max(0, resources.workerQueueDepth - 1);
    }
    resources.handInferenceCount += 1;
    state.hand = safeHand(workerResult);
    emitEvent("hand.frame", state.hand);

    if (["low_confidence", "sudden_hand_jump"].includes(workerResult.reason) || workerResult.occluded) {
      emitEvent("tracking.uncertain", { reason: workerResult.reason, occlusionFrames: workerResult.occlusionFrames });
      emitRender("tracking.uncertain", { reason: workerResult.reason });
    } else if (workerResult.reason === "hand_left_frame") {
      emitEvent("tracking.lost", { reason: "hand_left_frame" });
      emitRender("tracking.lost", { reason: "hand_left_frame" });
    }

    if (workerResult.transition === "pinch_start") startTrajectory(workerResult.pointer, frame.fixtureId);
    if (workerResult.pinched && workerResult.accepted) appendTrajectoryPoint(workerResult.pointer, frame.fixtureId);
    if (workerResult.transition === "pinch_end") commitTrajectory(workerResult.reason || "release");
    return snapshot();
  }

  function setScene(input) {
    assertActive();
    const scene = input?.scene || input;
    assertNoMediaPayload(scene);
    if (!scene || !Array.isArray(scene.objects)) throw new Error("invalid_neural_field_scene");
    state.sceneId = String(scene.id || "synthetic_scene");
    state.objects = cloneSafe(scene.objects).slice(0, MAX_OBJECTS).map(normalizeObject);
    state.sceneRelations = cloneSafe(scene.relations || []).slice(0, MAX_RELATIONS);
    state.relations = [];
    state.selection = emptySelection();
    state.viewport = normalizeViewport(scene.viewport || state.viewport);
    emitEvent("scene_set", { sceneId: state.sceneId, objectCount: state.objects.length });
    emitRender("scene.rendered", { sceneId: state.sceneId, objectCount: state.objects.length });
    return snapshot();
  }

  function moveObject(id, patch = {}) {
    assertActive();
    assertNoMediaPayload(patch);
    const index = state.objects.findIndex((object) => object.id === id);
    if (index < 0) throw new Error("neural_field_object_not_found");
    const current = state.objects[index];
    const next = normalizeObject({
      ...current,
      ...cloneSafe(patch),
      bbox: patch.bbox ? { ...current.bbox, ...cloneSafe(patch.bbox) } : current.bbox
    });
    state.objects[index] = next;
    const isSelected = [state.selection.anchorId, state.selection.targetId].includes(id);
    if (["lost", "out_of_frame"].includes(next.tracking)) {
      emitEvent("tracking.lost", { objectId: id, tracking: next.tracking });
      emitRender("tracking.lost", { objectId: id });
      if (isSelected) clearAnchor("tracking_loss");
    } else if (next.tracking === "uncertain") {
      state.selection.status = "tracking_uncertain";
      emitEvent("tracking.uncertain", { objectId: id });
      emitRender("tracking.uncertain", { objectId: id });
      updateRelation("tracking_uncertainty");
    } else {
      emitEvent("object_tracking_update", { objectId: id, tracking: next.tracking });
      emitRender("scene.rendered", { sceneId: state.sceneId, objectCount: state.objects.length });
      updateRelation("object_moved");
    }
    return snapshot();
  }

  function requestSemantic(requestType, payload = {}) {
    assertActive();
    assertNoMediaPayload(requestType, "semantic_request.requestType");
    assertNoMediaPayload(payload, "semantic_request.payload");
    if (payload.commit !== true) throw new Error("explicit_semantic_commit_required");
    const normalizedRequestType = String(requestType).slice(0, 80);
    const existing = [...pendingRequests.values()].find((request) => request.requestType === normalizedRequestType && request.generation === state.generation);
    if (existing) return cloneSafe(existing);
    const request = {
      requestId: `nf_request_${++requestSequence}`,
      requestType: normalizedRequestType,
      generation: state.generation,
      createdAtMs: now(),
      explicitCommit: true
    };
    pendingRequests.set(request.requestId, request);
    resources.activeRequests = pendingRequests.size;
    resources.semanticRequestCount += 1;
    emitEvent("semantic_request_committed", { requestId: request.requestId, requestType: request.requestType });
    return cloneSafe(request);
  }

  function dispatch(input = {}) {
    if (!state.active || state.mode !== "neural_field") {
      emitEvent("stale_ignored", { ignoredType: input?.type || "unknown", reason: "inactive_session" });
      return { accepted: false, reason: "inactive_session" };
    }
    assertNoMediaPayload(input, "external_event");
    assertNoRawLandmarkEvent(input);
    const event = cloneSafe(input);
    const eventGeneration = Number.isInteger(event.generation) ? event.generation : state.generation;
    const pending = event.requestId ? pendingRequests.get(event.requestId) : null;
    if (eventGeneration !== state.generation || (event.requestId && (!pending || pending.generation !== state.generation))) {
      emitEvent("stale_ignored", { ignoredType: event.type || "unknown", eventGeneration });
      return { accepted: false, reason: "stale_generation" };
    }

    if (event.type === "speech_started") {
      if (resources.activeSpeech > 0) {
        emitEvent("voice_overlap_rejected", {});
        return { accepted: false, reason: "voice_overlap" };
      }
      resources.activeSpeech = 1;
      resources.audioElements = 1;
      emitEvent("speech_started", {});
      return { accepted: true };
    }
    if (event.type === "speech_stopped") {
      resources.activeSpeech = 0;
      resources.audioElements = 0;
      emitEvent("speech_stopped", {});
      return { accepted: true };
    }

    if (event.requestId) {
      pendingRequests.delete(event.requestId);
      resources.activeRequests = pendingRequests.size;
    }
    if (event.type === "semantic_resolved") {
      const classification = normalizeClassification(event.payload?.classification, event.payload?.confidence);
      state.classification = classification;
      if (state.stroke) state.stroke.classification = classification;
      emitEvent("gesture.classified", classification);
      emitRender("classification.rendered", classification);
      return { accepted: true };
    }
    if (event.type === "lasso_resolved") {
      const object = event.payload?.object || state.objects.find((candidate) => candidate.id === event.payload?.objectId);
      if (!object) return { accepted: false, reason: "object_unavailable" };
      groundSelection([normalizeObject(object)]);
      return { accepted: true };
    }
    if (event.type === "relation_update") {
      const incoming = event.payload?.relations || (event.payload?.relation ? [event.payload.relation] : []);
      state.relations = cloneSafe(incoming).slice(0, MAX_RELATIONS).map(normalizeRelation);
      emitEvent("relation.updated", { relationCount: state.relations.length });
      emitRender("relation.updated", { relationCount: state.relations.length });
      return { accepted: true };
    }
    if (event.type === "object_tracking_update") {
      return { accepted: true, snapshot: moveObject(event.payload?.objectId, event.payload?.object || { tracking: event.payload?.status }) };
    }
    emitEvent(event.type || "external_event", event.payload || {});
    return { accepted: true };
  }

  function injectFailure(kind) {
    const failure = String(kind);
    if (failure === "camera_track_ended") {
      resources.activeMediaStreams = 0;
      resources.mediaTracks = 0;
      resources.animationFrames = 0;
    } else if (failure === "worker_crash") {
      resources.activeWorkers = 0;
      resources.workerQueueDepth = 0;
    } else if (failure === "renderer_initialization_failed") {
      resources.rendererResourceCount = 0;
      resources.animationFrames = 0;
    } else if (["spatial_timeout", "cloud_limit"].includes(failure)) {
      clearPendingRequests();
    } else if (failure === "voice_failure") {
      resources.activeSpeech = 0;
      resources.audioElements = 0;
    } else if (failure === "replay_stopped") {
      resources.activeRecorders = 0;
      resources.objectUrls = 0;
    }
    state.lastFailure = failure;
    emitEvent(failure, { recovered: true });
    return snapshot();
  }

  function handleVisibilityChange(visibility) {
    assertActive();
    if (visibility === "hidden") {
      state.generation += 1;
      state.stroke = null;
      state.lasso = null;
      state.classification = null;
      handWorker.reset();
      resources.animationFrames = 0;
      clearPendingRequests();
      emitEvent("tab_hidden", {});
      emitRender("renderer.cleared", { reason: "tab_hidden" });
    } else {
      resources.animationFrames = resources.rendererResourceCount > 0 ? 1 : 0;
      emitEvent("tab_resumed", {});
    }
    return snapshot();
  }

  function resizeViewport(viewport) {
    assertActive();
    state.viewport = normalizeViewport(viewport);
    emitEvent("viewport_resized", state.viewport);
    emitRender("scene.rendered", { viewport: state.viewport });
    return snapshot();
  }

  function startReplay({ consent = false, explicitUserAction = true } = {}) {
    assertActive();
    if (!consent || !explicitUserAction) throw new Error("explicit_replay_consent_required");
    if (resources.activeRecorders > 0) return { accepted: false, reason: "replay_already_recording" };
    resources.activeRecorders = 1;
    state.replay = { recording: true, consented: true, localOnly: true, startedAtMs: now(), containsRawMedia: false };
    emitEvent("replay_started", { localOnly: true, containsRawMedia: false });
    return { accepted: true };
  }

  function stopReplay({ unexpected = false, reason = unexpected ? "recorder_stopped_unexpectedly" : "explicit_stop" } = {}) {
    if (resources.activeRecorders === 0) return false;
    resources.activeRecorders = 0;
    resources.objectUrls = 0;
    state.replay = { recording: false, consented: false, localOnly: true, discarded: true, containsRawMedia: false, stopReason: reason };
    emitEvent(unexpected ? "replay_stopped" : "replay_stopped_explicitly", { reason });
    return true;
  }

  function snapshot() {
    return cloneSafe({
      mode: state.mode,
      returnMode: state.returnMode,
      active: state.active,
      tool: state.tool,
      generation: state.generation,
      viewport: state.viewport,
      hand: state.hand,
      stroke: state.stroke,
      lasso: state.lasso,
      classification: state.classification,
      selection: state.selection,
      objects: state.objects,
      relations: state.relations,
      pendingRequests: [...pendingRequests.values()],
      replay: state.replay,
      lastFailure: state.lastFailure,
      persistedState: getPersistedState(),
      resources: getResourceSnapshot()
    });
  }

  function getPersistedState() {
    return cloneSafe({
      schemaVersion: "sensefield.neural-field.session.v1",
      containsRawMedia: false,
      returnMode: state.returnMode,
      objectMemory: state.objects.slice(0, MAX_OBJECTS).map(({ id, label, bbox, depth, confidence, tracking }) => ({ id, label, bbox, depth, confidence, tracking })),
      strokeHistory: strokeHistory.slice(-MAX_STROKES),
      relationHistory: relationHistory.slice(-MAX_RELATIONS),
      replay: null
    });
  }

  function getResourceSnapshot() {
    return cloneSafe({
      ...resources,
      semanticRequests: resources.semanticRequestCount,
      workers: resources.activeWorkers,
      activeRenderers: resources.rendererResourceCount,
      activeMediaTracks: resources.mediaTracks,
      activeAnimationFrames: resources.animationFrames,
      activeAudioElements: resources.audioElements,
      speechInFlight: resources.activeSpeech,
      recorders: resources.activeRecorders,
      activeObjectUrls: resources.objectUrls,
      strokeObjects: (state.stroke ? 1 : 0) + strokeHistory.length,
      relationObjects: state.relations.length + relationHistory.length
    });
  }

  return Object.freeze({
    enter,
    exit,
    selectTool,
    feedLandmarkFrame,
    setScene,
    moveObject,
    requestSemantic,
    dispatch,
    injectFailure,
    handleVisibilityChange,
    resizeViewport,
    startReplay,
    stopReplay,
    snapshot,
    getPersistedState,
    getEventTimeline: () => cloneSafe(events),
    getRenderTimeline: () => cloneSafe(renders),
    getResourceSnapshot
  });

  function startTrajectory(pointer, fixtureId) {
    if (!pointer) return;
    state.classification = null;
    const trajectory = { id: `nf_${state.tool}_${++entitySequence}`, active: true, status: "active", points: [cloneSafe(pointer)], fixtureIds: fixtureId ? [fixtureId] : [] };
    if (state.tool === "airscript") {
      state.stroke = trajectory;
      emitEvent("pinch.started", { tool: state.tool });
      emitEvent("stroke.started", { strokeId: trajectory.id });
      emitRender("stroke.started", { strokeId: trajectory.id, pointCount: 1 });
    } else {
      state.lasso = trajectory;
      emitEvent("pinch.started", { tool: state.tool });
      emitEvent("lasso.started", { lassoId: trajectory.id });
      emitRender("lasso.started", { lassoId: trajectory.id, pointCount: 1 });
    }
  }

  function appendTrajectoryPoint(pointer, fixtureId) {
    const trajectory = state.tool === "airscript" ? state.stroke : state.lasso;
    if (!trajectory?.active || !pointer) return;
    const previous = trajectory.points.at(-1);
    if (previous && Math.hypot(pointer.x - previous.x, pointer.y - previous.y) < 0.0005) return;
    trajectory.points.push(cloneSafe(pointer));
    if (trajectory.points.length > MAX_POINTS) trajectory.points.splice(0, trajectory.points.length - MAX_POINTS);
    if (fixtureId && !trajectory.fixtureIds.includes(fixtureId)) trajectory.fixtureIds.push(fixtureId);
    if (state.tool === "airscript") {
      emitEvent("stroke.point", { strokeId: trajectory.id, point: pointer });
      emitRender("stroke.updated", { strokeId: trajectory.id, pointCount: trajectory.points.length });
    } else {
      emitEvent("lasso.point", { lassoId: trajectory.id, point: pointer });
      emitRender("lasso.updated", { lassoId: trajectory.id, pointCount: trajectory.points.length });
    }
  }

  function commitTrajectory(reason) {
    if (state.tool === "airscript" && state.stroke?.active) {
      state.stroke.active = false;
      state.stroke.status = "stable";
      emitEvent("pinch.ended", { reason });
      emitEvent("stroke.committed", { strokeId: state.stroke.id, pointCount: state.stroke.points.length });
      emitRender("stroke.stabilized", { strokeId: state.stroke.id, pointCount: state.stroke.points.length });
      const classification = classifyStroke(state.stroke.points);
      state.stroke.classification = classification;
      state.classification = classification;
      strokeHistory.push({ id: state.stroke.id, pointCount: state.stroke.points.length, classification: classification.label, confidence: classification.confidence });
      bound(strokeHistory, MAX_STROKES);
      emitEvent("gesture.classified", classification);
      emitRender("classification.rendered", classification);
    } else if (state.tool === "spatial_lasso" && state.lasso?.active) {
      state.lasso.active = false;
      state.lasso.status = "completed";
      emitEvent("pinch.ended", { reason });
      emitEvent("lasso.completed", { lassoId: state.lasso.id, pointCount: state.lasso.points.length });
      emitRender("lasso.completed", { lassoId: state.lasso.id, pointCount: state.lasso.points.length });
      const grounding = groundingContract.ground(state.objects, state.lasso.points);
      state.lasso.grounding = grounding.status;
      if (grounding.status === "grounded") groundSelection(grounding.candidates.map((id) => state.objects.find((object) => object.id === id)).filter(Boolean));
      else if (grounding.status === "ambiguous") {
        state.selection = { status: "ambiguous", anchorId: state.selection.anchorId, targetId: null, candidates: grounding.candidates.map((id) => ({ id })) };
        emitEvent("selection.ambiguous", { candidates: grounding.candidates });
        emitRender("selection.ambiguous", { candidates: grounding.candidates });
      } else {
        state.selection = { ...emptySelection(), status: grounding.status === "empty" ? "unsupported_empty" : `invalid_${grounding.status}` };
        emitEvent("lasso_rejected", { status: grounding.status });
      }
    }
  }

  function groundSelection(candidates) {
    const object = candidates[0];
    if (!object) return;
    if (!state.selection.anchorId) {
      state.selection = { status: "anchored", anchorId: object.id, targetId: null, candidates: [] };
    } else if (state.selection.anchorId !== object.id) {
      state.selection = { status: "related", anchorId: state.selection.anchorId, targetId: object.id, candidates: [] };
    }
    emitEvent("object.grounded", { objectId: object.id, role: state.selection.targetId === object.id ? "target" : "anchor" });
    emitRender("object.grounded", { objectId: object.id });
    updateRelation("selection_grounded");
  }

  function updateRelation(reason) {
    if (!state.selection.anchorId || !state.selection.targetId) return;
    const subject = state.objects.find((object) => object.id === state.selection.anchorId);
    const object = state.objects.find((candidate) => candidate.id === state.selection.targetId);
    const relation = relationContract.infer(subject, object);
    if (!relation) {
      state.relations = [];
      return;
    }
    const prior = state.relations[0];
    state.relations = [relation];
    relationHistory.push({ id: relation.id, type: relation.type, subjectId: relation.subjectId, objectId: relation.objectId, reason });
    bound(relationHistory, MAX_RELATIONS);
    emitEvent(prior ? "relation.updated" : "relation.updated", { relationId: relation.id, type: relation.type, reason });
    emitRender(prior ? "relation.updated" : "relation.rendered", { relationId: relation.id, type: relation.type, reason });
  }

  function clearAnchor(reason) {
    state.selection = { ...emptySelection(), status: "tracking_lost" };
    state.relations = [];
    emitEvent("anchor.cleared", { reason });
    emitRender("anchor.cleared", { reason });
  }

  function emitEvent(type, payload) {
    const event = { type, sequence: ++eventSequence, timestampMs: now(), generation: state.generation, payload: cloneSafe(payload ?? {}) };
    if (perceptionContract.types.includes(type) && !perceptionContract.validate(event)) throw new Error(`invalid_perception_event:${type}`);
    events.push(event);
    bound(events, MAX_TIMELINE);
    return event;
  }

  function emitRender(type, payload) {
    const event = { type, sequence: ++renderSequence, timestampMs: now(), generation: state.generation, payload: cloneSafe(payload ?? {}) };
    if (rendererContract.types.includes(type) && !rendererContract.validate(event)) throw new Error(`invalid_renderer_event:${type}`);
    renders.push(event);
    resources.renderEventCount += 1;
    bound(renders, MAX_TIMELINE);
    return event;
  }

  function clearTransientVisuals() {
    state.stroke = null;
    state.lasso = null;
    state.classification = null;
    state.selection = emptySelection();
    state.relations = [];
  }

  function cleanupSession() {
    clearPendingRequests();
    handWorker.reset();
    clearTransientVisuals();
    state.hand = { present: false, accepted: false, pinched: false, status: "absent" };
    state.objects = [];
    state.sceneRelations = [];
    state.sceneId = null;
    state.replay = null;
    state.lastFailure = null;
    strokeHistory.length = 0;
    relationHistory.length = 0;
    deactivateResources();
  }

  function clearPendingRequests() {
    pendingRequests.clear();
    resources.activeRequests = 0;
  }

  function activateResources() {
    Object.assign(resources, {
      activeWorkers: 1,
      rendererResourceCount: 1,
      activeMediaStreams: 1,
      mediaTracks: 1,
      microphoneTracks: 0,
      animationFrames: 1,
      workerQueueDepth: 0,
      activeRequests: 0,
      activeSpeech: 0,
      audioElements: 0,
      activeRecorders: 0,
      objectUrls: 0
    });
  }

  function deactivateResources() {
    Object.assign(resources, {
      activeWorkers: 0,
      rendererResourceCount: 0,
      activeMediaStreams: 0,
      mediaTracks: 0,
      microphoneTracks: 0,
      animationFrames: 0,
      workerQueueDepth: 0,
      activeRequests: 0,
      activeSpeech: 0,
      audioElements: 0,
      activeRecorders: 0,
      objectUrls: 0
    });
  }

  function validateState() {
    if (!stateContract.validate(state)) throw new Error("invalid_neural_field_state");
  }

  function assertActive() {
    if (!state.active || state.mode !== "neural_field") throw new Error("neural_field_session_inactive");
  }

  function now() {
    const value = Number(clock());
    if (!Number.isFinite(value)) throw new Error("invalid_neural_field_clock");
    return value;
  }
}

function initialState() {
  return {
    mode: "ask",
    returnMode: "ask",
    active: false,
    tool: null,
    generation: 0,
    viewport: { width: 1000, height: 600, orientation: "landscape" },
    hand: { present: false, accepted: false, pinched: false, status: "absent" },
    stroke: null,
    lasso: null,
    classification: null,
    selection: emptySelection(),
    objects: [],
    relations: [],
    sceneRelations: [],
    sceneId: null,
    replay: null,
    lastFailure: null
  };
}

function initialResources() {
  return {
    activeWorkers: 0,
    rendererResourceCount: 0,
    activeMediaStreams: 0,
    mediaTracks: 0,
    microphoneTracks: 0,
    animationFrames: 0,
    eventListeners: 0,
    canvases: 0,
    workerQueueDepth: 0,
    peakWorkerQueueDepth: 0,
    activeRequests: 0,
    semanticRequestCount: 0,
    renderEventCount: 0,
    handInferenceCount: 0,
    activeSpeech: 0,
    audioElements: 0,
    activeRecorders: 0,
    objectUrls: 0
  };
}

function emptySelection() {
  return { status: "none", anchorId: null, targetId: null, candidates: [] };
}

function safeHand(result) {
  return {
    present: Boolean(result.present),
    accepted: Boolean(result.accepted),
    occluded: Boolean(result.occluded),
    occlusionFrames: result.occlusionFrames || 0,
    handedness: result.handedness || null,
    confidence: Number.isFinite(result.confidence) ? result.confidence : 0,
    pointer: result.pointer ? cloneSafe(result.pointer) : null,
    pinched: Boolean(result.pinched),
    transition: result.transition || null,
    status: result.accepted ? "tracked" : result.reason || (result.present ? "uncertain" : "absent")
  };
}

function normalizeObject(object) {
  const bbox = object.bbox || {};
  return {
    id: String(object.id),
    label: String(object.label || object.id || "object"),
    bbox: { x: Number(bbox.x || 0), y: Number(bbox.y || 0), width: Number(bbox.width || 0), height: Number(bbox.height || 0) },
    depth: Number.isFinite(object.depth) ? object.depth : 0.5,
    confidence: Number.isFinite(object.confidence) ? object.confidence : 0.8,
    tracking: String(object.tracking || object.status || "tracked")
  };
}

function normalizeRelation(relation) {
  return {
    id: String(relation.id || `relation_${relation.subjectId}_${relation.type || relation.relation}_${relation.objectId || relation.referenceId}`),
    subjectId: String(relation.subjectId || relation.subject_id),
    objectId: String(relation.objectId || relation.referenceId || relation.reference_id),
    referenceId: String(relation.referenceId || relation.objectId || relation.reference_id),
    type: String(relation.type || relation.relation),
    confidence: Number.isFinite(relation.confidence) ? relation.confidence : 0.8,
    status: String(relation.status || "tracked")
  };
}

function normalizeViewport(viewport) {
  const width = Math.max(1, Number(viewport.width) || 1000);
  const height = Math.max(1, Number(viewport.height) || 600);
  return { width, height, orientation: viewport.orientation || (width >= height ? "landscape" : "portrait") };
}

function classifyStroke(points) {
  if (!Array.isArray(points) || points.length < 8) return { label: "uncertain_freeform", confidence: 0.32, source: "local_geometry" };
  const box = bounds(points);
  const diagonal = Math.hypot(box.width, box.height) || 1;
  const closed = distance(points[0], points.at(-1)) <= diagonal * 0.25;
  if (closed) {
    const area = polygonArea(points);
    const perimeter = pathLength(points) + distance(points.at(-1), points[0]);
    const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
    const aspect = box.height > 0 ? box.width / box.height : 1;
    if (circularity >= 0.86 && aspect >= 0.78 && aspect <= 1.28) return { label: "circle", confidence: clamp01(0.76 + circularity * 0.2), source: "local_geometry" };
    if (circularity >= 0.7 && (aspect < 0.78 || aspect > 1.28)) return { label: "ellipse", confidence: clamp01(0.72 + circularity * 0.16), source: "local_geometry" };
    if (circularity >= 0.66) return { label: "rectangle", confidence: 0.76, source: "local_geometry" };
    return { label: "triangle", confidence: 0.72, source: "local_geometry" };
  }
  const normalized = points.map((point) => ({ x: (point.x - box.x) / (box.width || 1), y: (point.y - box.y) / (box.height || 1) }));
  const apexIndex = normalized.reduce((best, point, index) => point.y < normalized[best].y ? index : best, 0);
  const horizontalTravel = normalized.reduce((sum, point, index) => index ? sum + Math.abs(point.x - normalized[index - 1].x) : sum, 0);
  const verticalTravel = normalized.reduce((sum, point, index) => index ? sum + Math.abs(point.y - normalized[index - 1].y) : sum, 0);
  if (box.width > box.height * 1.4 && normalized.at(-1).x < 0.85 && horizontalTravel > 1.2) return { label: "arrow", confidence: 0.78, source: "local_geometry" };
  if (apexIndex > normalized.length * 0.1 && apexIndex < normalized.length * 0.55 && normalized.at(-1).y > 0.3 && horizontalTravel > 1.2) return { label: "A", confidence: 0.72, source: "local_geometry" };
  if (verticalTravel >= 0.9 && horizontalTravel > 2.5 && box.height > box.width) return { label: "I", confidence: 0.7, source: "local_geometry" };
  return { label: "uncertain_freeform", confidence: 0.42, source: "local_geometry" };
}

function normalizeClassification(value, confidence) {
  if (value && typeof value === "object") return { label: String(value.label || value.type || "uncertain_freeform"), confidence: Number(value.confidence ?? confidence ?? 0.5), source: String(value.source || "explicit_contract") };
  return { label: String(value || "uncertain_freeform"), confidence: Number(confidence ?? 0.5), source: "explicit_contract" };
}

function bounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function pathLength(points) {
  return points.reduce((sum, point, index) => index ? sum + distance(points[index - 1], point) : sum, 0);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function bound(array, limit) {
  if (array.length > limit) array.splice(0, array.length - limit);
}

function assertNoRawLandmarkEvent(value, path = "external_event", seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (/(?:landmarks?|thumb[_-]?tip|index[_-]?tip)/i.test(key) && item != null) throw new Error(`raw_landmark_payload_rejected:${path}.${key}`);
    assertNoRawLandmarkEvent(item, `${path}.${key}`, seen);
  }
}
