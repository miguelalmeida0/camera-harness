export const NEURAL_FIELD_TOOLS = Object.freeze(["airscript", "spatial_lasso"]);

export const NEURAL_FIELD_LIMITS = Object.freeze({
  maxStrokePoints: 512,
  maxCompletedStrokeIds: 24,
  maxSelectedObjects: 16,
  maxReplayEvents: 256,
  maxReplayDurationMs: 30000,
  maximumFrames: 6,
  maximumBodyBytes: 5000000
});

export const AIRSCRIPT_INPUT_EVENTS = Object.freeze([
  "hand_frame",
  "pinch_started",
  "pinch_updated",
  "pinch_ended",
  "stroke_cancelled"
]);

export const AIRSCRIPT_OUTPUT_EVENTS = Object.freeze([
  "stroke_started",
  "stroke_point_added",
  "stroke_completed",
  "stroke_classified",
  "stroke_render_ready",
  "stroke_expired",
  "stroke_error"
]);

export const SPATIAL_LASSO_INPUT_EVENTS = Object.freeze([
  "lasso_started",
  "lasso_updated",
  "lasso_completed",
  "lasso_cancelled",
  "object_candidate_received",
  "object_grounded",
  "object_tracking_updated",
  "relation_requested"
]);

export const SPATIAL_LASSO_OUTPUT_EVENTS = Object.freeze([
  "lasso_candidate",
  "lasso_invalid",
  "selection_ambiguous",
  "selection_grounded",
  "selection_lost",
  "relation_grounded",
  "relation_changed",
  "relation_unavailable"
]);

export const NEURAL_FIELD_RELATIONS = Object.freeze([
  "left_of",
  "right_of",
  "above",
  "below",
  "in_front_of",
  "behind",
  "near",
  "far",
  "overlapping",
  "inside",
  "contains",
  "touching",
  "approaching",
  "moving_away",
  "closest_to_camera",
  "farther_from_camera"
]);

const NEURAL_FIELD_STATUSES = new Set(["inactive", "starting", "active", "ending", "error"]);
const TOOL_SET = new Set(NEURAL_FIELD_TOOLS);
const RELATION_SET = new Set(NEURAL_FIELD_RELATIONS);
const AIRSCRIPT_EVENT_SET = new Set([...AIRSCRIPT_INPUT_EVENTS, ...AIRSCRIPT_OUTPUT_EVENTS]);
const SPATIAL_LASSO_EVENT_SET = new Set([...SPATIAL_LASSO_INPUT_EVENTS, ...SPATIAL_LASSO_OUTPUT_EVENTS]);
const EVENT_SET = new Set([...AIRSCRIPT_EVENT_SET, ...SPATIAL_LASSO_EVENT_SET]);
const STATE_KEYS = Object.freeze([
  "status", "tool", "generation", "sessionId", "handTracking", "gesture", "lasso",
  "rendering", "semantic", "replay", "safeError"
]);
const HAND_TRACKING_KEYS = Object.freeze([
  "active", "workerReady", "dominantHand", "latestFrameTimestamp", "confidence"
]);
const GESTURE_KEYS = Object.freeze([
  "pinchActive", "activeStrokeId", "activeStroke", "completedStrokeIds"
]);
const LASSO_KEYS = Object.freeze([
  "candidateStrokeId", "groundedObjectIds", "pendingSelection", "activeRelation"
]);
const RENDERING_KEYS = Object.freeze([
  "active", "rendererGeneration", "overlayGeneration"
]);
const SEMANTIC_KEYS = Object.freeze([
  "requestInFlight", "activeRequestId", "queuedCommit"
]);
const REPLAY_KEYS = Object.freeze([
  "recording", "consentGranted", "recorderId"
]);
let idSequence = 0;

export function createNeuralFieldState() {
  return {
    status: "inactive",
    tool: null,
    generation: 0,
    sessionId: null,
    handTracking: {
      active: false,
      workerReady: false,
      dominantHand: null,
      latestFrameTimestamp: null,
      confidence: null
    },
    gesture: {
      pinchActive: false,
      activeStrokeId: null,
      activeStroke: null,
      completedStrokeIds: []
    },
    lasso: {
      candidateStrokeId: null,
      groundedObjectIds: [],
      pendingSelection: null,
      activeRelation: null
    },
    rendering: {
      active: false,
      rendererGeneration: 0,
      overlayGeneration: 0
    },
    semantic: {
      requestInFlight: false,
      activeRequestId: null,
      queuedCommit: null
    },
    replay: {
      recording: false,
      consentGranted: false,
      recorderId: null
    },
    safeError: null
  };
}

export function beginNeuralFieldState(current, { tool, sessionId } = {}) {
  const previous = canonicalState(current);
  const nextTool = requireTool(tool);
  const next = createNeuralFieldState();
  next.status = "starting";
  next.tool = nextTool;
  next.generation = previous.generation + 1;
  next.sessionId = sanitizeIdentifier(sessionId, 128) || nextGeneratedId("neural_field_session");
  next.rendering.rendererGeneration = previous.rendering.rendererGeneration + 1;
  next.rendering.overlayGeneration = previous.rendering.overlayGeneration + 1;
  return checked(next);
}

export function activateNeuralFieldState(current, patch = {}) {
  const previous = canonicalState(current);
  if (previous.status !== "starting" || !previous.tool || !previous.sessionId) {
    throw new Error("neural_field_start_not_owned");
  }
  return patchNeuralFieldState(previous, {
    ...patch,
    status: "active",
    handTracking: {
      ...(patch?.handTracking || {}),
      active: true,
      workerReady: patch?.handTracking?.workerReady !== false
    },
    rendering: { ...(patch?.rendering || {}), active: true },
    safeError: null
  });
}

export function switchNeuralFieldToolState(current, tool) {
  const previous = canonicalState(current);
  if (previous.status !== "active") throw new Error("neural_field_inactive");
  const nextTool = requireTool(tool);
  if (nextTool === previous.tool) return previous;
  const next = cloneState(previous);
  next.tool = nextTool;
  next.generation += 1;
  next.gesture = createNeuralFieldState().gesture;
  next.lasso = createNeuralFieldState().lasso;
  next.semantic = createNeuralFieldState().semantic;
  next.rendering.overlayGeneration += 1;
  next.safeError = null;
  return checked(next);
}

export function cancelNeuralFieldOperationState(current, reason = "") {
  const previous = canonicalState(current);
  if (!["starting", "active"].includes(previous.status)) return previous;
  const next = cloneState(previous);
  next.generation += 1;
  next.gesture = createNeuralFieldState().gesture;
  next.lasso = createNeuralFieldState().lasso;
  next.semantic = createNeuralFieldState().semantic;
  next.rendering.overlayGeneration += 1;
  next.safeError = null;
  void sanitizeNeuralFieldText(reason, 240);
  return checked(next);
}

export function beginNeuralFieldEndState(current, reason = "") {
  const previous = canonicalState(current);
  if (previous.status === "inactive" || previous.status === "ending") return previous;
  const next = createNeuralFieldState();
  next.status = "ending";
  next.generation = previous.generation + 1;
  next.sessionId = previous.sessionId;
  next.rendering.rendererGeneration = previous.rendering.rendererGeneration + 1;
  next.rendering.overlayGeneration = previous.rendering.overlayGeneration + 1;
  void sanitizeNeuralFieldText(reason, 240);
  return checked(next);
}

export function finishNeuralFieldEndState(current) {
  const previous = canonicalState(current);
  if (previous.status === "inactive") return previous;
  if (!["ending", "error"].includes(previous.status)) throw new Error("neural_field_end_not_started");
  const next = createNeuralFieldState();
  next.generation = previous.generation;
  next.rendering.rendererGeneration = previous.rendering.rendererGeneration;
  next.rendering.overlayGeneration = previous.rendering.overlayGeneration;
  return checked(next);
}

export function failNeuralFieldState(current, error = "Neural Field is unavailable.") {
  const previous = canonicalState(current);
  const next = createNeuralFieldState();
  next.status = "error";
  next.generation = previous.generation + 1;
  next.rendering.rendererGeneration = previous.rendering.rendererGeneration + 1;
  next.rendering.overlayGeneration = previous.rendering.overlayGeneration + 1;
  next.safeError = sanitizeNeuralFieldText(error, 240) || "Neural Field is unavailable.";
  return checked(next);
}

export function patchNeuralFieldState(current, patch = {}) {
  const previous = canonicalState(current);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return previous;
  const next = cloneState(previous);

  if (NEURAL_FIELD_STATUSES.has(String(patch.status))) next.status = String(patch.status);
  if (patch.tool === null || TOOL_SET.has(String(patch.tool))) next.tool = patch.tool == null ? null : String(patch.tool);
  if (patch.generation != null) next.generation = nonNegativeInteger(patch.generation, previous.generation);
  if (patch.sessionId !== undefined) next.sessionId = patch.sessionId == null ? null : sanitizeIdentifier(patch.sessionId, 128) || null;

  if (patch.handTracking && typeof patch.handTracking === "object") {
    const value = patch.handTracking;
    if (value.active != null) next.handTracking.active = value.active === true;
    if (value.workerReady != null) next.handTracking.workerReady = value.workerReady === true;
    if (value.dominantHand !== undefined) next.handTracking.dominantHand = normalizeHand(value.dominantHand);
    if (value.latestFrameTimestamp !== undefined) next.handTracking.latestFrameTimestamp = nullableTimestamp(value.latestFrameTimestamp);
    if (value.confidence !== undefined) next.handTracking.confidence = nullableConfidence(value.confidence);
  }

  if (patch.gesture && typeof patch.gesture === "object") {
    const value = patch.gesture;
    if (value.pinchActive != null) next.gesture.pinchActive = value.pinchActive === true;
    if (value.activeStrokeId !== undefined) next.gesture.activeStrokeId = value.activeStrokeId == null ? null : sanitizeIdentifier(value.activeStrokeId, 128) || null;
    if (value.activeStroke !== undefined) next.gesture.activeStroke = sanitizeStroke(value.activeStroke);
    if (value.completedStrokeIds !== undefined) next.gesture.completedStrokeIds = boundedIdentifierList(value.completedStrokeIds, NEURAL_FIELD_LIMITS.maxCompletedStrokeIds);
    if (value.activeStroke !== undefined && value.activeStrokeId === undefined) {
      next.gesture.activeStrokeId = sanitizeIdentifier(next.gesture.activeStroke?.id, 128) || null;
    }
    if (!next.gesture.activeStrokeId) next.gesture.activeStroke = null;
  }

  if (patch.lasso && typeof patch.lasso === "object") {
    const value = patch.lasso;
    if (value.candidateStrokeId !== undefined) next.lasso.candidateStrokeId = value.candidateStrokeId == null ? null : sanitizeIdentifier(value.candidateStrokeId, 128) || null;
    if (value.groundedObjectIds !== undefined) next.lasso.groundedObjectIds = boundedIdentifierList(value.groundedObjectIds, NEURAL_FIELD_LIMITS.maxSelectedObjects);
    if (value.pendingSelection !== undefined) next.lasso.pendingSelection = sanitizeMetadataObject(value.pendingSelection);
    if (value.activeRelation !== undefined) next.lasso.activeRelation = value.activeRelation == null ? null : normalizeSpatialRelation(value.activeRelation);
  }

  if (patch.rendering && typeof patch.rendering === "object") {
    const value = patch.rendering;
    if (value.active != null) next.rendering.active = value.active === true;
    if (value.rendererGeneration != null) next.rendering.rendererGeneration = nonNegativeInteger(value.rendererGeneration, previous.rendering.rendererGeneration);
    if (value.overlayGeneration != null) next.rendering.overlayGeneration = nonNegativeInteger(value.overlayGeneration, previous.rendering.overlayGeneration);
  }

  if (patch.semantic && typeof patch.semantic === "object") {
    const value = patch.semantic;
    if (value.activeRequestId !== undefined) next.semantic.activeRequestId = value.activeRequestId == null ? null : sanitizeIdentifier(value.activeRequestId, 128) || null;
    if (value.requestInFlight != null) next.semantic.requestInFlight = value.requestInFlight === true;
    if (next.semantic.requestInFlight && !next.semantic.activeRequestId) next.semantic.activeRequestId = nextGeneratedId("neural_field_request");
    if (!next.semantic.requestInFlight) next.semantic.activeRequestId = null;
    if (value.queuedCommit !== undefined) next.semantic.queuedCommit = sanitizeMetadataObject(value.queuedCommit);
  }

  if (patch.replay && typeof patch.replay === "object") {
    const value = patch.replay;
    if (value.consentGranted != null) next.replay.consentGranted = value.consentGranted === true;
    if (value.recorderId !== undefined) next.replay.recorderId = value.recorderId == null ? null : sanitizeIdentifier(value.recorderId, 128) || null;
    if (value.recording != null) next.replay.recording = value.recording === true;
    if (!next.replay.consentGranted) {
      next.replay.recording = false;
      next.replay.recorderId = null;
    }
    if (next.replay.recording && !next.replay.recorderId) next.replay.recorderId = nextGeneratedId("neural_field_replay");
    if (!next.replay.recorderId) next.replay.recording = false;
  }

  if (patch.safeError !== undefined) next.safeError = patch.safeError == null ? null : sanitizeNeuralFieldText(patch.safeError, 240) || null;
  return checked(next);
}

export function assertNeuralFieldStateInvariants(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("neural_field_state_invalid");
  assertExactKeys(state, STATE_KEYS, "neural_field_state_shape_invalid");
  assertExactKeys(state.handTracking, HAND_TRACKING_KEYS, "neural_field_hand_state_shape_invalid");
  assertExactKeys(state.gesture, GESTURE_KEYS, "neural_field_gesture_state_shape_invalid");
  assertExactKeys(state.lasso, LASSO_KEYS, "neural_field_lasso_state_shape_invalid");
  assertExactKeys(state.rendering, RENDERING_KEYS, "neural_field_rendering_state_shape_invalid");
  assertExactKeys(state.semantic, SEMANTIC_KEYS, "neural_field_semantic_state_shape_invalid");
  assertExactKeys(state.replay, REPLAY_KEYS, "neural_field_replay_state_shape_invalid");
  if (!NEURAL_FIELD_STATUSES.has(state.status)) throw new Error("neural_field_status_invalid");
  if (state.tool !== null && !TOOL_SET.has(state.tool)) throw new Error("neural_field_tool_invalid");
  if (!Number.isInteger(state.generation) || state.generation < 0) throw new Error("neural_field_generation_invalid");
  if (["starting", "active"].includes(state.status) && (!state.tool || !state.sessionId)) throw new Error("neural_field_session_owner_missing");
  if (["inactive", "ending", "error"].includes(state.status) && state.tool !== null) throw new Error("neural_field_inactive_tool_conflict");
  if (state.status === "inactive" && state.sessionId !== null) throw new Error("neural_field_inactive_session_conflict");
  if (state.status !== "active" && (state.handTracking.active || state.handTracking.workerReady || state.rendering.active)) {
    throw new Error("neural_field_resource_state_conflict");
  }
  if (state.status === "active" && (!state.handTracking.active || !state.rendering.active)) throw new Error("neural_field_active_resource_missing");
  if (state.handTracking.workerReady && !state.handTracking.active) throw new Error("neural_field_worker_owner_conflict");
  if (!Array.isArray(state.gesture.completedStrokeIds) || state.gesture.completedStrokeIds.length > NEURAL_FIELD_LIMITS.maxCompletedStrokeIds) {
    throw new Error("neural_field_completed_strokes_unbounded");
  }
  if (!Array.isArray(state.lasso.groundedObjectIds) || state.lasso.groundedObjectIds.length > NEURAL_FIELD_LIMITS.maxSelectedObjects) {
    throw new Error("neural_field_grounded_objects_unbounded");
  }
  if ((state.gesture.activeStrokeId === null) !== (state.gesture.activeStroke === null)) throw new Error("neural_field_stroke_owner_conflict");
  if (state.gesture.activeStroke?.points?.length > NEURAL_FIELD_LIMITS.maxStrokePoints) throw new Error("neural_field_stroke_unbounded");
  if (state.lasso.activeRelation && state.tool !== "spatial_lasso") throw new Error("neural_field_relation_tool_conflict");
  if (state.semantic.requestInFlight !== Boolean(state.semantic.activeRequestId)) throw new Error("neural_field_semantic_owner_conflict");
  if (state.semantic.requestInFlight && state.status !== "active") throw new Error("neural_field_semantic_lifecycle_conflict");
  if (state.replay.recording && (!state.replay.consentGranted || !state.replay.recorderId || state.status !== "active")) {
    throw new Error("neural_field_replay_consent_conflict");
  }
  if (["inactive", "ending", "error"].includes(state.status) && !transientStateCleared(state)) {
    throw new Error("neural_field_transient_state_conflict");
  }
  if (!Number.isInteger(state.rendering.rendererGeneration) || state.rendering.rendererGeneration < 0 ||
      !Number.isInteger(state.rendering.overlayGeneration) || state.rendering.overlayGeneration < 0) {
    throw new Error("neural_field_render_generation_invalid");
  }
  if (containsProhibitedNeuralFieldData(state)) throw new Error("neural_field_prohibited_data");
  return true;
}

export function createNeuralFieldEvent(type, {
  eventId,
  neuralFieldGeneration,
  tool,
  timestamp,
  metadata = {}
} = {}) {
  const eventType = String(type || "");
  const eventTool = requireTool(tool);
  if (!EVENT_SET.has(eventType)) throw new Error("neural_field_event_type_invalid");
  if ((eventTool === "airscript" && !AIRSCRIPT_EVENT_SET.has(eventType)) ||
      (eventTool === "spatial_lasso" && !SPATIAL_LASSO_EVENT_SET.has(eventType))) {
    throw new Error("neural_field_event_tool_mismatch");
  }
  const event = {
    type: eventType,
    eventId: sanitizeIdentifier(eventId, 160) || nextGeneratedId("neural_field_event"),
    neuralFieldGeneration: nonNegativeInteger(neuralFieldGeneration, 0),
    tool: eventTool,
    timestamp: finiteTimestamp(timestamp, Date.now()),
    metadata: sanitizeMetadataObject(metadata) || {}
  };
  return deepFreeze(event);
}

export function shouldEscalateNeuralFieldEvent(event, options = {}) {
  const maximumFrames = boundedPositiveLimit(options.maximumFrames, NEURAL_FIELD_LIMITS.maximumFrames);
  const maximumBodyBytes = boundedPositiveLimit(options.maximumBodyBytes, NEURAL_FIELD_LIMITS.maximumBodyBytes);
  const noEscalation = () => ({
    shouldEscalate: false,
    reason: null,
    requiredFrames: [],
    maximumFrames,
    maximumBodyBytes
  });
  if (!event || typeof event !== "object" || containsProhibitedNeuralFieldData(event)) return noEscalation();
  const type = String(event.type || event.eventType || "");
  const tool = String(event.tool || "");
  const metadata = sanitizeMetadataObject(event.metadata) || {};
  if (options.cloudEnabled === false || options.cloudDisabled === true || metadata.cloudEnabled === false ||
      metadata.cloudDisabled === true || options.requestInFlight === true || options.requestAllowed === false ||
      options.requestLimitReached === true || metadata.requestLimitReached === true) {
    return noEscalation();
  }
  if (options.neuralFieldGeneration != null &&
      Number(event.neuralFieldGeneration) !== Number(options.neuralFieldGeneration)) return noEscalation();

  let reason = null;
  if (tool === "airscript" && type === "stroke_completed" && unknownStrokeRequiresInterpretation(metadata)) {
    reason = "unknown_stroke";
  } else if (tool === "spatial_lasso" && type === "lasso_completed" && completedLassoRequiresIdentity(metadata)) {
    reason = "ambiguous_object";
  } else if (tool === "spatial_lasso" && type === "relation_requested") {
    reason = "relation_explanation";
  }
  if (!reason) return noEscalation();
  return {
    shouldEscalate: true,
    reason,
    requiredFrames: requiredFrameIndices(metadata).slice(0, maximumFrames),
    maximumFrames,
    maximumBodyBytes
  };
}

export function groundSpatialLasso({
  lassoPolygon,
  frameTimestamp,
  viewport,
  candidateScene,
  selectedObjectIds
} = {}) {
  void finiteTimestamp(frameTimestamp, 0);
  const polygon = normalizePolygon(lassoPolygon, viewport);
  if (polygon.length < 3) return noGroundedObject();
  const selected = new Set(boundedIdentifierList(selectedObjectIds, NEURAL_FIELD_LIMITS.maxSelectedObjects));
  const objects = candidateObjects(candidateScene, viewport)
    .filter((object) => !selected.has(object.id));
  const candidates = objects.map((object) => {
    const centerInside = pointInPolygon(object.center, polygon);
    const overlap = polygonBboxOverlap(polygon, object.bbox);
    return { ...object, centerInside, overlap, score: (centerInside ? 2 : 0) + overlap + object.confidence * 0.1 };
  }).filter((object) => object.centerInside || object.overlap >= 0.2);
  const centerCandidates = candidates.filter((object) => object.centerInside);
  const pool = (centerCandidates.length ? centerCandidates : candidates)
    .sort((first, second) => second.score - first.score || second.confidence - first.confidence || first.id.localeCompare(second.id));
  if (!pool.length) return noGroundedObject();
  if (pool.length > 1) {
    return {
      ok: false,
      code: "ambiguous_selection",
      candidates: pool.slice(0, NEURAL_FIELD_LIMITS.maxSelectedObjects).map((object) => ({
        id: object.id,
        label: object.label,
        confidence: object.confidence
      })),
      suggestedAction: "Tighten the loop around one object."
    };
  }
  const object = pool[0];
  return {
    ok: true,
    selectedObject: {
      id: object.id,
      label: object.label,
      bbox: [...object.bbox],
      center: [...object.center],
      relativeDepth: object.relativeDepth,
      confidence: object.confidence
    },
    candidates: [],
    evidenceFrameIndices: evidenceFramesForObject(candidateScene, object),
    ambiguity: null
  };
}

export function normalizeSpatialRelation(relation = {}) {
  if (!relation || typeof relation !== "object" || Array.isArray(relation) || containsProhibitedNeuralFieldData(relation)) return null;
  const rawPredicate = sanitizeIdentifier(relation.predicate ?? relation.relation ?? relation.type, 80).toLowerCase();
  const predicate = ({
    hand_approaching_object: "approaching",
    hand_approaches_object: "approaching",
    hand_moving_away_from_object: "moving_away",
    hand_moves_away: "moving_away"
  })[rawPredicate] || rawPredicate;
  if (!RELATION_SET.has(predicate)) return null;
  const subjectId = sanitizeIdentifier(relation.subjectId ?? relation.subject_id ?? relation.handId ?? relation.hand_id, 128);
  const objectId = sanitizeIdentifier(relation.objectId ?? relation.object_id ?? relation.referenceId ?? relation.reference_id, 128) || null;
  if (!subjectId) return null;
  if (!objectId && !["closest_to_camera", "farther_from_camera"].includes(predicate)) return null;
  const rawScaleType = String(relation.scaleType ?? relation.scale_type ?? relation.scale?.type ?? "relative");
  const metricEstimate = normalizeMetricEstimate(relation.metricEstimate ?? relation.metric_estimate);
  const calibratedMetric = ["calibrated_metric", "metric"].includes(rawScaleType) && metricEstimate !== null;
  return {
    subjectId,
    predicate,
    objectId,
    confidence: clamp01(relation.confidence),
    evidenceFrameIndices: uniqueFrameIndices(relation.evidenceFrameIndices ?? relation.evidence_frames),
    scaleType: calibratedMetric ? "calibrated_metric" : "relative",
    metricEstimate: calibratedMetric ? metricEstimate : null
  };
}

export function formatSpatialRelationForUser(relation, objects) {
  const normalized = normalizeSpatialRelation(relation);
  if (!normalized) return "";
  const subject = objectLabel(objects, normalized.subjectId);
  if (!subject) return "";
  if (normalized.predicate === "closest_to_camera") {
    return `The ${lowerInitial(stripLeadingArticle(subject))} appears closest to the camera.`;
  }
  if (normalized.predicate === "farther_from_camera") {
    return `The ${lowerInitial(stripLeadingArticle(subject))} appears farther from the camera.`;
  }
  const object = objectLabel(objects, normalized.objectId);
  if (!object) return "";
  if (normalized.predicate === "approaching") {
    return `${capitalize(subject)} is approaching ${withDefiniteArticle(object)}.`;
  }
  if (normalized.predicate === "moving_away") {
    return `${capitalize(subject)} is moving away from ${withDefiniteArticle(object)}.`;
  }
  const phrase = ({
    left_of: "left of",
    right_of: "right of",
    above: "above",
    below: "below",
    in_front_of: "in front of",
    behind: "behind",
    near: "near",
    far: "far from",
    overlapping: "overlapping",
    inside: "inside",
    contains: "contains",
    touching: "touching"
  })[normalized.predicate];
  if (!phrase) return "";
  const verb = normalized.predicate === "contains" ? "" : "is ";
  return `${capitalize(subject)} ${verb}${phrase} ${lowerInitial(object)}.`;
}

export function sanitizeNeuralFieldText(value, maxLength = 500) {
  const limit = Math.max(1, Math.min(4000, Math.round(Number(maxLength) || 500)));
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|hf)[-_][A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/data:(?:image|video|audio)\/[^\s;,]+;base64,[A-Za-z0-9+/=]+/gi, "[redacted]")
    .replace(/(?:^|\s)(?:\/[\w .-]+)+(?:\.(?:gguf|safetensors|onnx|bin|pt|pth))\b/gi, " [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, limit);
}

export function containsProhibitedNeuralFieldData(value, key = "", depth = 0) {
  if (depth > 8 || value == null) return false;
  if (binaryOrMediaObject(value)) return true;
  if (isSafeNegativePrivacyAssertion(key, value)) return false;
  if (key && prohibitedKey(key) && hasPayload(value)) return true;
  if (typeof value === "string") {
    return /^data:(?:image|video|audio)\//i.test(value) || /;base64,/i.test(value) ||
      /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i.test(value) || /\b(?:sk|hf)[-_][A-Za-z0-9_-]{8,}\b/i.test(value) ||
      /(?:^|\/)[^\s]+\.(?:gguf|safetensors|onnx|bin|pt|pth)\b/i.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsProhibitedNeuralFieldData(item, key, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value).some(([nestedKey, nested]) => containsProhibitedNeuralFieldData(nested, nestedKey, depth + 1));
}

function canonicalState(value) {
  if (value == null) return createNeuralFieldState();
  assertNeuralFieldStateInvariants(value);
  return cloneState(value);
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function checked(value) {
  assertNeuralFieldStateInvariants(value);
  return value;
}

function requireTool(value) {
  const tool = String(value || "");
  if (!TOOL_SET.has(tool)) throw new Error("neural_field_tool_invalid");
  return tool;
}

function nextGeneratedId(prefix) {
  idSequence += 1;
  return `${prefix}_${Date.now()}_${idSequence}`;
}

function normalizeHand(value) {
  const hand = sanitizeNeuralFieldText(value, 24).toLowerCase();
  return ["left", "right"].includes(hand) ? hand : null;
}

function nullableTimestamp(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function finiteTimestamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function nullableConfidence(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return clamp01(value);
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function boundedPositiveLimit(value, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(maximum, number) : maximum;
}

function sanitizeIdentifier(value, maxLength = 128) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9_.:-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
}

function boundedIdentifierList(value, maximum) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => sanitizeIdentifier(item, 128)).filter(Boolean))].slice(-maximum);
}

function sanitizeStroke(value) {
  const safe = sanitizeMetadataObject(value);
  if (!safe || typeof safe !== "object") return null;
  if (Array.isArray(safe.points)) safe.points = safe.points.slice(0, NEURAL_FIELD_LIMITS.maxStrokePoints);
  return Object.keys(safe).length ? safe : null;
}

function sanitizeMetadataObject(value) {
  const safe = sanitizeMetadataValue(value, "", 0);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? safe : null;
}

function sanitizeMetadataValue(value, key, depth) {
  if (depth > 6 || value == null) return value == null ? null : undefined;
  if (binaryOrMediaObject(value)) return undefined;
  if (isSafeNegativePrivacyAssertion(key, value)) return false;
  if (key && prohibitedKey(key)) return undefined;
  if (typeof value === "string") {
    if (containsProhibitedNeuralFieldData(value)) return undefined;
    return sanitizeNeuralFieldText(value, 500);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const limit = /points?$/i.test(key) ? NEURAL_FIELD_LIMITS.maxStrokePoints : 128;
    return value.slice(0, limit).map((item) => sanitizeMetadataValue(item, key, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const safe = {};
  for (const [nestedKey, nested] of Object.entries(value).slice(0, 64)) {
    const sanitized = sanitizeMetadataValue(nested, nestedKey, depth + 1);
    if (sanitized !== undefined) safe[nestedKey] = sanitized;
  }
  return safe;
}

function prohibitedKey(key) {
  const normalized = String(key || "").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return /^(?:frame|frames|raw_frames?|camera_frames?|video_frames?|full_frames?|encoded_frames?|frame_bytes|frame_data|frame_payload|pixel_data|rgba|yuv|canvas|data_uri|base64|image|images|image_data|image_payload|contains_raw_media|raw_media|raw_media_persisted|raw_video|video|video_data|contains_video|audio|audio_data|audio_bytes|contains_audio|blob|file|screenshot|token|tokens|access_token|api_key|authorization|secret|credential|model_path|model_file|model_filesystem_path|filesystem_path|weights|weights_path|landmark|landmarks|landmark_history|hand_landmarks|face_landmarks|biometric|biometric_identity|biometric_template|face_descriptor|person_identity)$/.test(normalized);
}

function isSafeNegativePrivacyAssertion(key, value) {
  return value === false && /^(?:contains_raw_media|raw_media_persisted|contains_audio|contains_video)$/i.test(String(key || ""));
}

function hasPayload(value) {
  if (value == null || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function transientStateCleared(state) {
  return state.handTracking.active === false && state.handTracking.workerReady === false &&
    state.handTracking.dominantHand === null && state.handTracking.latestFrameTimestamp === null &&
    state.handTracking.confidence === null && state.gesture.pinchActive === false &&
    state.gesture.activeStrokeId === null && state.gesture.activeStroke === null &&
    state.gesture.completedStrokeIds.length === 0 && state.lasso.candidateStrokeId === null &&
    state.lasso.groundedObjectIds.length === 0 && state.lasso.pendingSelection === null &&
    state.lasso.activeRelation === null && state.semantic.requestInFlight === false &&
    state.semantic.activeRequestId === null && state.semantic.queuedCommit === null &&
    state.replay.recording === false && state.replay.consentGranted === false && state.replay.recorderId === null;
}

function binaryOrMediaObject(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof ArrayBuffer !== "undefined" && (value instanceof ArrayBuffer || ArrayBuffer.isView?.(value))) return true;
  return ["Blob", "File", "ImageBitmap", "ImageData", "MediaStream", "VideoFrame"]
    .includes(String(value.constructor?.name || ""));
}

function assertExactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(code);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function unknownStrokeRequiresInterpretation(metadata) {
  const classification = String(metadata.classification ?? metadata.strokeClassification ?? metadata.localClassification ?? "").toLowerCase();
  return classification === "unknown" || metadata.unknown === true || metadata.requiresInterpretation === true ||
    metadata.requiresSemanticInterpretation === true;
}

function completedLassoRequiresIdentity(metadata) {
  const ambiguity = String(metadata.ambiguity ?? metadata.code ?? metadata.groundingStatus ?? metadata.grounding ?? metadata.selection ?? "").toLowerCase();
  return metadata.requiresObjectIdentity === true || metadata.objectIdentityRequired === true ||
    metadata.requires_identity === true || metadata.ambiguous === true || ambiguity === "ambiguous" ||
    ambiguity === "ambiguous_selection" || ambiguity === "ambiguous_object" || ambiguity === "unknown_object";
}

function requiredFrameIndices(metadata) {
  return uniqueFrameIndices(metadata.requiredFrames ?? metadata.evidenceFrameIndices ?? metadata.evidence_frame_indices ?? metadata.frameIndices);
}

function uniqueFrameIndices(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((item) => Number.isInteger(item) && item >= 0))]
    .sort((first, second) => first - second)
    .slice(0, NEURAL_FIELD_LIMITS.maximumFrames);
}

function normalizePolygon(value, viewport) {
  if (!Array.isArray(value)) return [];
  const points = value.slice(0, NEURAL_FIELD_LIMITS.maxStrokePoints).map(normalizePoint).filter(Boolean);
  if (!points.length) return [];
  const pixelCoordinates = points.some((point) => point[0] > 1 || point[1] > 1);
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  if (pixelCoordinates && (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)) return [];
  const normalized = points.map(([x, y]) => [
    clamp01(pixelCoordinates ? x / width : x),
    clamp01(pixelCoordinates ? y / height : y)
  ]);
  if (normalized.length > 1 && samePoint(normalized[0], normalized.at(-1))) normalized.pop();
  return normalized;
}

function normalizePoint(value) {
  const x = Number(Array.isArray(value) ? value[0] : value?.x);
  const y = Number(Array.isArray(value) ? value[1] : value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function normalizeBbox(value, viewport) {
  const raw = Array.isArray(value)
    ? value.slice(0, 4).map(Number)
    : [Number(value?.x), Number(value?.y), Number(value?.x) + Number(value?.width), Number(value?.y) + Number(value?.height)];
  if (raw.length !== 4 || raw.some((item) => !Number.isFinite(item))) return null;
  const pixelCoordinates = raw.some((item) => item > 1);
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  if (pixelCoordinates && (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)) return null;
  const bbox = pixelCoordinates
    ? [raw[0] / width, raw[1] / height, raw[2] / width, raw[3] / height]
    : raw;
  const normalized = bbox.map(clamp01);
  return normalized[2] > normalized[0] && normalized[3] > normalized[1] ? normalized : null;
}

function candidateObjects(scene, viewport) {
  const values = Array.isArray(scene) ? scene : Array.isArray(scene?.objects) ? scene.objects : [];
  const candidates = [];
  const seen = new Set();
  for (const value of values.slice(0, 64)) {
    if (!value || typeof value !== "object" || containsProhibitedNeuralFieldData(value)) continue;
    const id = sanitizeIdentifier(value.id ?? value.object_id, 128);
    const label = sanitizeNeuralFieldText(value.label ?? value.object_label, 80);
    const bbox = normalizeBbox(value.bbox ?? value.boundingBox ?? value.bounding_box, viewport);
    if (!id || seen.has(id) || !supportedObjectLabel(label) || !bbox) continue;
    const suppliedCenter = normalizePoint(value.center);
    const pixelCenter = suppliedCenter && suppliedCenter.some((item) => item > 1);
    const width = Number(viewport?.width);
    const height = Number(viewport?.height);
    const center = suppliedCenter
      ? pixelCenter && width > 0 && height > 0
        ? [clamp01(suppliedCenter[0] / width), clamp01(suppliedCenter[1] / height)]
        : suppliedCenter.map(clamp01)
      : [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    seen.add(id);
    candidates.push({
      id,
      label,
      bbox,
      center,
      relativeDepth: clamp01(value.relativeDepth ?? value.relative_depth ?? value.depth ?? 0.5),
      confidence: clamp01(value.confidence),
      source: value
    });
  }
  return candidates.slice(0, NEURAL_FIELD_LIMITS.maxSelectedObjects);
}

function supportedObjectLabel(value) {
  return Boolean(value) && !/^(?:unknown|unknown object|unidentified|unidentified object|object|item)$/i.test(value);
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const first = polygon[current];
    const second = polygon[previous];
    if (pointOnSegment(point, first, second)) return true;
    const intersects = (first[1] > point[1]) !== (second[1] > point[1]) &&
      point[0] < ((second[0] - first[0]) * (point[1] - first[1])) / (second[1] - first[1]) + first[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnSegment(point, first, second) {
  const cross = (point[1] - first[1]) * (second[0] - first[0]) - (point[0] - first[0]) * (second[1] - first[1]);
  if (Math.abs(cross) > 1e-8) return false;
  return point[0] >= Math.min(first[0], second[0]) - 1e-8 && point[0] <= Math.max(first[0], second[0]) + 1e-8 &&
    point[1] >= Math.min(first[1], second[1]) - 1e-8 && point[1] <= Math.max(first[1], second[1]) + 1e-8;
}

function polygonBboxOverlap(polygon, bbox) {
  let clipped = polygon.map((point) => [...point]);
  clipped = clipPolygon(clipped, (point) => point[0] >= bbox[0], (first, second) => verticalIntersection(first, second, bbox[0]));
  clipped = clipPolygon(clipped, (point) => point[0] <= bbox[2], (first, second) => verticalIntersection(first, second, bbox[2]));
  clipped = clipPolygon(clipped, (point) => point[1] >= bbox[1], (first, second) => horizontalIntersection(first, second, bbox[1]));
  clipped = clipPolygon(clipped, (point) => point[1] <= bbox[3], (first, second) => horizontalIntersection(first, second, bbox[3]));
  const bboxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
  return bboxArea > 0 ? Math.min(1, polygonArea(clipped) / bboxArea) : 0;
}

function clipPolygon(points, inside, intersect) {
  if (!points.length) return [];
  const output = [];
  let previous = points.at(-1);
  for (const current of points) {
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside) {
      if (!previousInside) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousInside) {
      output.push(intersect(previous, current));
    }
    previous = current;
  }
  return output.filter((point) => point.every(Number.isFinite));
}

function verticalIntersection(first, second, x) {
  const delta = second[0] - first[0];
  const ratio = Math.abs(delta) < 1e-12 ? 0 : (x - first[0]) / delta;
  return [x, first[1] + (second[1] - first[1]) * ratio];
}

function horizontalIntersection(first, second, y) {
  const delta = second[1] - first[1];
  const ratio = Math.abs(delta) < 1e-12 ? 0 : (y - first[1]) / delta;
  return [first[0] + (second[0] - first[0]) * ratio, y];
}

function polygonArea(points) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return Math.abs(area) / 2;
}

function samePoint(first, second) {
  return Math.abs(first[0] - second[0]) < 1e-9 && Math.abs(first[1] - second[1]) < 1e-9;
}

function evidenceFramesForObject(scene, object) {
  const values = [
    ...(Array.isArray(object.source?.evidenceFrameIndices) ? object.source.evidenceFrameIndices : []),
    ...(Array.isArray(object.source?.evidence_frames) ? object.source.evidence_frames : [])
  ];
  for (const evidence of Array.isArray(scene?.evidence) ? scene.evidence : []) {
    const objectIds = Array.isArray(evidence?.object_ids) ? evidence.object_ids.map((item) => sanitizeIdentifier(item, 128)) : [];
    if (objectIds.includes(object.id) || sanitizeIdentifier(evidence?.object_id, 128) === object.id) values.push(evidence.frame_index);
  }
  return uniqueFrameIndices(values);
}

function noGroundedObject() {
  return {
    ok: false,
    code: "no_grounded_object",
    message: "I could not ground that region to a visible object."
  };
}

function normalizeMetricEstimate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || containsProhibitedNeuralFieldData(value)) return null;
  const amount = Number(value.value ?? value.distance ?? value.estimate);
  const unit = sanitizeNeuralFieldText(value.unit, 24).toLowerCase();
  if (!Number.isFinite(amount) || amount < 0 || !["cm", "m"].includes(unit)) return null;
  return {
    value: amount,
    unit,
    confidence: clamp01(value.confidence),
    approximate: value.approximate !== false
  };
}

function objectLabel(objects, id) {
  const values = Array.isArray(objects)
    ? objects
    : [...(Array.isArray(objects?.objects) ? objects.objects : []), ...(Array.isArray(objects?.hands) ? objects.hands : [])];
  const wanted = sanitizeIdentifier(id, 128);
  const object = values.find((item) => sanitizeIdentifier(item?.id ?? item?.object_id, 128) === wanted);
  let label = sanitizeNeuralFieldText(object?.label ?? object?.object_label, 80);
  if (!label && /(?:^|_)hand(?:_|$)/i.test(wanted)) label = "your hand";
  if (/^(?:left|right|your) hand$/i.test(label)) return "your hand";
  return label;
}

function capitalize(value) {
  const text = sanitizeNeuralFieldText(value, 80);
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function lowerInitial(value) {
  const text = sanitizeNeuralFieldText(value, 80);
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : "";
}

function stripLeadingArticle(value) {
  return sanitizeNeuralFieldText(value, 80).replace(/^(?:a|an|the)\s+/i, "");
}

function withDefiniteArticle(value) {
  const text = sanitizeNeuralFieldText(value, 80);
  return /^(?:a|an|the|your|this|that)\b/i.test(text) ? lowerInitial(text) : `the ${lowerInitial(text)}`;
}
