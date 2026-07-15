import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyNeuralFieldToolEvent,
  cancelNeuralFieldOperation,
  commitNeuralFieldGesture,
  createInitialState,
  discardNeuralFieldReplay,
  endInteractionSession,
  endNeuralField,
  neuralFieldResourceSummary,
  requestReplayConsent,
  saveNeuralFieldReplay,
  setInteractionModeInState,
  startNeuralField,
  startNeuralFieldReplay,
  startRealtimeConversation,
  startRealtimeObserving,
  stopNeuralFieldReplay,
  switchNeuralFieldTool
} from "../prototype/local-capture.js";
import {
  AIRSCRIPT_INPUT_EVENTS,
  AIRSCRIPT_OUTPUT_EVENTS,
  NEURAL_FIELD_RELATIONS,
  NEURAL_FIELD_TOOLS,
  SPATIAL_LASSO_INPUT_EVENTS,
  SPATIAL_LASSO_OUTPUT_EVENTS,
  assertNeuralFieldStateInvariants,
  containsProhibitedNeuralFieldData,
  createNeuralFieldEvent,
  createNeuralFieldState,
  formatSpatialRelationForUser,
  groundSpatialLasso,
  normalizeSpatialRelation,
  shouldEscalateNeuralFieldEvent
} from "../prototype/neural-field/neural-field-systems.js";
import { createNeuralVoiceHarness } from "./neural-voice-fixture.mjs";

const neuralFieldSource = readFileSync(new URL("../prototype/neural-field/neural-field-systems.js", import.meta.url), "utf8");
const localCaptureSource = readFileSync(new URL("../prototype/local-capture.js", import.meta.url), "utf8");

assert.deepEqual(NEURAL_FIELD_TOOLS, ["airscript", "spatial_lasso"]);
assert.deepEqual(AIRSCRIPT_INPUT_EVENTS, ["hand_frame", "pinch_started", "pinch_updated", "pinch_ended", "stroke_cancelled"]);
assert.deepEqual(AIRSCRIPT_OUTPUT_EVENTS, [
  "stroke_started",
  "stroke_point_added",
  "stroke_completed",
  "stroke_classified",
  "stroke_render_ready",
  "stroke_expired",
  "stroke_error"
]);
assert.deepEqual(SPATIAL_LASSO_INPUT_EVENTS, [
  "lasso_started",
  "lasso_updated",
  "lasso_completed",
  "lasso_cancelled",
  "object_candidate_received",
  "object_grounded",
  "object_tracking_updated",
  "relation_requested"
]);
assert.deepEqual(SPATIAL_LASSO_OUTPUT_EVENTS, [
  "lasso_candidate",
  "lasso_invalid",
  "selection_ambiguous",
  "selection_grounded",
  "selection_lost",
  "relation_grounded",
  "relation_changed",
  "relation_unavailable"
]);
assert.deepEqual(NEURAL_FIELD_RELATIONS, [
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

const canonical = createNeuralFieldState();
assert.equal(canonical.status, "inactive");
assert.equal(canonical.tool, null);
assert.equal(canonical.generation, 0);
assert.equal(canonical.handTracking.active, false);
assert.equal(canonical.gesture.activeStroke, null);
assert.deepEqual(canonical.lasso.groundedObjectIds, []);
assert.equal(canonical.rendering.active, false);
assert.equal(canonical.semantic.requestInFlight, false);
assert.equal(canonical.replay.consentGranted, false);
assert.equal(assertNeuralFieldStateInvariants(canonical), true);

const safeEvent = createNeuralFieldEvent("hand_frame", {
  eventId: "event_safe",
  neuralFieldGeneration: 3,
  tool: "airscript",
  timestamp: 1234,
  metadata: {
    confidence: 0.91,
    raw_video: "not-retained",
    token: "not-retained",
    nested: { base64: "not-retained" }
  }
});
assert.deepEqual(Object.keys(safeEvent).sort(), [
  "eventId",
  "metadata",
  "neuralFieldGeneration",
  "timestamp",
  "tool",
  "type"
]);
assert.equal(safeEvent.eventId, "event_safe");
assert.equal(containsProhibitedNeuralFieldData(safeEvent), false);
assert.doesNotMatch(JSON.stringify(safeEvent), /not-retained|raw_video|base64|token/i);
assert.equal(containsProhibitedNeuralFieldData({ encoded_frame: "raw" }), true);

const unknownStroke = createNeuralFieldEvent("stroke_completed", {
  eventId: "event_unknown_stroke",
  neuralFieldGeneration: 4,
  tool: "airscript",
  timestamp: 2000,
  metadata: {
    unknown: true,
    requiresInterpretation: true,
    evidenceFrameIndices: [3, 1, 3]
  }
});
const unknownPolicy = shouldEscalateNeuralFieldEvent(unknownStroke, {
  neuralFieldGeneration: 4,
  maximumFrames: 2,
  maximumBodyBytes: 4096
});
assert.equal(unknownPolicy.shouldEscalate, true);
assert.equal(unknownPolicy.reason, "unknown_stroke");
assert.deepEqual(unknownPolicy.requiredFrames, [1, 3]);
assert.equal(unknownPolicy.maximumFrames <= 2, true);
assert.equal(unknownPolicy.maximumBodyBytes <= 4096, true);
assert.equal(shouldEscalateNeuralFieldEvent(unknownStroke, { cloudEnabled: false }).shouldEscalate, false);
assert.equal(shouldEscalateNeuralFieldEvent(unknownStroke, { requestInFlight: true }).shouldEscalate, false);
assert.equal(shouldEscalateNeuralFieldEvent(createNeuralFieldEvent("pinch_updated", {
  eventId: "event_local_point",
  neuralFieldGeneration: 4,
  tool: "airscript",
  timestamp: 2001,
  metadata: { point: { x: 0.2, y: 0.3 } }
})).shouldEscalate, false);

const ambiguousPolicy = shouldEscalateNeuralFieldEvent(createNeuralFieldEvent("lasso_completed", {
  eventId: "event_ambiguous",
  neuralFieldGeneration: 5,
  tool: "spatial_lasso",
  timestamp: 2100,
  metadata: { requiresObjectIdentity: true, ambiguity: "ambiguous_selection" }
}));
assert.equal(ambiguousPolicy.reason, "ambiguous_object");
const relationPolicy = shouldEscalateNeuralFieldEvent(createNeuralFieldEvent("relation_requested", {
  eventId: "event_relation",
  neuralFieldGeneration: 5,
  tool: "spatial_lasso",
  timestamp: 2200,
  metadata: {}
}));
assert.equal(relationPolicy.reason, "relation_explanation");

const mug = {
  id: "mug",
  label: "Mug",
  bbox: [0.2, 0.2, 0.4, 0.4],
  center: [0.3, 0.3],
  relativeDepth: 0.4,
  confidence: 0.93,
  evidenceFrameIndices: [1, 2]
};
const grounded = groundSpatialLasso({
  lassoPolygon: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]],
  frameTimestamp: 2300,
  viewport: { width: 100, height: 100 },
  candidateScene: { objects: [mug] },
  selectedObjectIds: []
});
assert.equal(grounded.ok, true);
assert.equal(grounded.selectedObject.id, "mug");
assert.equal(grounded.ambiguity, null);
const ambiguousGrounding = groundSpatialLasso({
  lassoPolygon: [[0.1, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8]],
  frameTimestamp: 2301,
  viewport: { width: 100, height: 100 },
  candidateScene: {
    objects: [
      mug,
      { id: "phone", label: "Phone", bbox: [0.5, 0.5, 0.7, 0.7], confidence: 0.9 }
    ]
  }
});
assert.equal(ambiguousGrounding.ok, false);
assert.equal(ambiguousGrounding.code, "ambiguous_selection");
assert.equal(ambiguousGrounding.suggestedAction, "Tighten the loop around one object.");
assert.deepEqual(groundSpatialLasso({
  lassoPolygon: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]],
  candidateScene: { objects: [{ id: "unknown", label: "Unknown object", bbox: [0.2, 0.2, 0.3, 0.3] }] }
}), {
  ok: false,
  code: "no_grounded_object",
  message: "I could not ground that region to a visible object."
});

const relationObjects = [
  { id: "mug", label: "Mug" },
  { id: "laptop", label: "laptop" },
  { id: "hand", label: "your hand" },
  { id: "phone", label: "phone" }
];
assert.equal(formatSpatialRelationForUser({
  subjectId: "mug",
  predicate: "left_of",
  objectId: "laptop",
  confidence: 0.9,
  evidenceFrameIndices: [1],
  scaleType: "relative",
  metricEstimate: null
}, relationObjects), "Mug is left of laptop.");
assert.equal(formatSpatialRelationForUser({
  subjectId: "hand",
  predicate: "approaching",
  objectId: "mug",
  confidence: 0.88,
  evidenceFrameIndices: [2],
  scaleType: "relative",
  metricEstimate: null
}, relationObjects), "Your hand is approaching the mug.");
assert.equal(formatSpatialRelationForUser({
  subjectId: "phone",
  predicate: "closest_to_camera",
  objectId: null,
  confidence: 0.86,
  evidenceFrameIndices: [2],
  scaleType: "relative",
  metricEstimate: null
}, relationObjects), "The phone appears closest to the camera.");
assert.deepEqual(normalizeSpatialRelation({
  subjectId: "mug",
  predicate: "near",
  objectId: "laptop",
  confidence: 0.8,
  scaleType: "calibrated_metric",
  metricEstimate: null
}), {
  subjectId: "mug",
  predicate: "near",
  objectId: "laptop",
  confidence: 0.8,
  evidenceFrameIndices: [],
  scaleType: "relative",
  metricEstimate: null
});

const askOrder = [];
const AskRecognition = recognitionClass(askOrder);
const askRuntime = createInitialState();
const askStream = fakeStream({ audio: true, video: true });
await startRealtimeConversation(askRuntime, { mediaStream: askStream, SpeechRecognition: AskRecognition });
assert.equal(askRuntime.interactionState.listeningActive, true);
const askResources = resourceHarness({
  onWorkerFactory() {
    askOrder.push("worker_factory");
  }
});
let neuralCameraRequests = 0;
const askNeuralStart = await startNeuralField({ tool: "airscript" }, {
  target: askRuntime,
  ...askResources.options,
  mediaDevices: {
    async getUserMedia() {
      neuralCameraRequests += 1;
      return fakeStream({ audio: false, video: true });
    }
  }
});
assert.equal(askNeuralStart.ok, true);
assert.equal(askOrder.indexOf("stt_abort") >= 0, true, "Ask STT stops");
assert.equal(askOrder.indexOf("stt_abort") < askOrder.indexOf("worker_factory"), true, "Ask stops before the hand worker starts");
assertMutuallyExclusive(askRuntime);
assert.equal(askRuntime.interactionState.listeningActive, false);
assert.equal(askRuntime.interactionState.microphoneActive, false);
assert.equal(activeTracks(askStream, "audio").length, 0, "Neural Field has no active microphone");
assert.equal(askRuntime.stream, askStream, "Neural Field reuses the camera stream");
assert.equal(neuralCameraRequests, 0, "Neural Field does not acquire a duplicate camera stream");
await endNeuralField("return_to_ask", { target: askRuntime });
assertInactiveNeuralField(askRuntime);
assert.equal(activeTracks(askStream, "video").length, 1, "camera is preserved for the previous mode");
askStream.addTrack(fakeTrack("audio"));
await startRealtimeConversation(askRuntime, { mediaStream: askStream, SpeechRecognition: recognitionClass([]) });
assert.equal(askRuntime.interactionState.listeningActive, true, "returning to Ask works");
assert.equal(askRuntime.neuralField.status, "inactive");
await endInteractionSession(askRuntime);

const staleMicrophoneRuntime = createInitialState();
const staleMicrophoneVideo = fakeStream({ audio: false, video: true });
const staleMicrophoneGate = deferred();
let staleMicrophoneRequested = false;
const staleConversationStart = startRealtimeConversation(staleMicrophoneRuntime, {
  mediaStream: staleMicrophoneVideo,
  SpeechRecognition: recognitionClass([]),
  mediaDevices: {
    async getUserMedia() {
      staleMicrophoneRequested = true;
      return staleMicrophoneGate.promise;
    }
  }
});
await Promise.resolve();
await Promise.resolve();
assert.equal(staleMicrophoneRequested, true);
const staleMicrophoneResources = resourceHarness();
await startNeuralField({ tool: "airscript" }, {
  target: staleMicrophoneRuntime,
  ...staleMicrophoneResources.options
});
const lateAudioStream = fakeStream({ audio: true, video: false });
staleMicrophoneGate.resolve(lateAudioStream);
await staleConversationStart;
assert.equal(staleMicrophoneRuntime.neuralField.status, "active", "stale Ask startup cannot replace Neural Field");
assert.equal(activeTracks(lateAudioStream, "audio").length, 0, "late Ask microphone is stopped after Neural Field owns the mode");
await endNeuralField("stale_microphone_complete", { target: staleMicrophoneRuntime, preserveCamera: false });

const staleFailureRuntime = createInitialState();
const staleMediaGate = deferred();
const staleFailedConversation = startRealtimeConversation(staleFailureRuntime, {
  SpeechRecognition: recognitionClass([]),
  mediaDevices: { getUserMedia: () => staleMediaGate.promise }
});
await Promise.resolve();
const staleFailureResources = resourceHarness();
await startNeuralField({ tool: "spatial_lasso" }, {
  target: staleFailureRuntime,
  mediaStream: fakeStream({ audio: false, video: true }),
  ...staleFailureResources.options
});
staleMediaGate.reject(new Error("superseded media failure"));
await staleFailedConversation;
assert.equal(staleFailureRuntime.neuralField.status, "active", "stale Ask failure cannot fail a newer Neural Field session");
await endNeuralField("stale_failure_complete", { target: staleFailureRuntime, preserveCamera: false });

const watchRuntime = createInitialState();
await setInteractionModeInState(watchRuntime, "observing");
const watchStream = fakeStream({ audio: false, video: true });
await startRealtimeObserving(watchRuntime, { mediaStream: watchStream });
assert.equal(watchRuntime.interactionState.proactiveObservationActive, true);
let watchStoppedBeforeWorker = false;
const watchResources = resourceHarness({
  onWorkerFactory() {
    watchStoppedBeforeWorker =
      watchRuntime.interactionState.proactiveObservationActive === false &&
      watchRuntime.movementRecognition.persistent.active === false &&
      watchRuntime.interactionState.queuedVisualEvent === null;
  }
});
await startNeuralField({ tool: "spatial_lasso" }, {
  target: watchRuntime,
  ...watchResources.options
});
assert.equal(watchStoppedBeforeWorker, true, "Watch stops before Neural Field starts");
assertMutuallyExclusive(watchRuntime);
assert.equal(watchRuntime.stream, watchStream);
assert.equal(activeTracks(watchStream, "audio").length, 0);
await endNeuralField("return_to_watch", { target: watchRuntime });
await startRealtimeObserving(watchRuntime, { mediaStream: watchStream });
assert.equal(watchRuntime.interactionState.proactiveObservationActive, true, "returning to Watch works");
assert.equal(watchRuntime.neuralField.status, "inactive");
await endInteractionSession(watchRuntime);

const toolRuntime = createInitialState();
const toolStream = fakeStream({ audio: false, video: true });
const toolResources = resourceHarness();
await startNeuralField({ tool: "airscript" }, {
  target: toolRuntime,
  mediaStream: toolStream,
  ...toolResources.options
});
const reusedStart = await startNeuralField({ tool: "airscript" }, {
  target: toolRuntime,
  mediaStream: toolStream,
  ...toolResources.options
});
assert.equal(reusedStart.reused, true);
assert.equal(toolResources.metrics.workerStarts, 1, "one hand worker");
assert.equal(toolResources.metrics.rendererStarts, 1, "one renderer loop");
assert.equal(toolResources.metrics.maximumWorkers, 1);
assert.equal(toolResources.metrics.maximumRenderers, 1);
const firstToolGeneration = toolRuntime.neuralField.generation;
const firstWorkerContext = toolResources.metrics.workerContexts[0];
assert.equal(firstWorkerContext.onEvent(toolEvent("pinch_started", "airscript", firstToolGeneration, {
  strokeId: "stroke_cancelled",
  point: { x: 0.2, y: 0.2 }
})).ok, true);
assert.equal(toolRuntime.neuralField.gesture.activeStrokeId, "stroke_cancelled");
await cancelNeuralFieldOperation("operator_cancelled", { target: toolRuntime });
assert.equal(toolRuntime.neuralField.gesture.activeStrokeId, null);
assert.equal(toolRuntime.neuralField.generation > firstToolGeneration, true);
const staleToolResult = firstWorkerContext.onEvent(toolEvent("pinch_updated", "airscript", firstToolGeneration, {
  strokeId: "stroke_cancelled",
  point: { x: 0.3, y: 0.3 }
}));
assert.equal(staleToolResult.ok, false, "stale tool callback is rejected");
assert.equal(staleToolResult.code, "neural_field_event_stale");

const airscriptGeneration = toolRuntime.neuralField.generation;
applyNeuralFieldToolEvent(toolEvent("pinch_started", "airscript", airscriptGeneration, {
  strokeId: "stroke_before_lasso",
  point: { x: 0.1, y: 0.1 }
}), { target: toolRuntime });
await switchNeuralFieldTool("spatial_lasso", { target: toolRuntime });
assert.equal(toolRuntime.neuralField.tool, "spatial_lasso");
assert.equal(toolRuntime.neuralField.gesture.activeStroke, null);
assert.equal(toolResources.metrics.workerStarts, 1, "AirScript to Spatial Lasso preserves the worker");
assert.equal(toolResources.metrics.rendererStarts, 1, "AirScript to Spatial Lasso preserves the renderer");
const lassoGeneration = toolRuntime.neuralField.generation;
applyNeuralFieldToolEvent(toolEvent("lasso_started", "spatial_lasso", lassoGeneration, {
  strokeId: "lasso_before_airscript",
  point: { x: 0.1, y: 0.1 }
}), { target: toolRuntime });
applyNeuralFieldToolEvent(toolEvent("selection_grounded", "spatial_lasso", lassoGeneration, {
  objectId: "mug"
}), { target: toolRuntime });
applyNeuralFieldToolEvent(toolEvent("relation_grounded", "spatial_lasso", lassoGeneration, {
  relation: {
    subjectId: "mug",
    predicate: "left_of",
    objectId: "laptop",
    confidence: 0.9,
    evidenceFrameIndices: [1],
    scaleType: "relative",
    metricEstimate: null
  }
}), { target: toolRuntime });
assert.deepEqual(toolRuntime.neuralField.lasso.groundedObjectIds, ["mug"]);
await switchNeuralFieldTool("airscript", { target: toolRuntime });
assert.equal(toolRuntime.neuralField.tool, "airscript");
assert.equal(toolRuntime.neuralField.gesture.activeStroke, null);
assert.deepEqual(toolRuntime.neuralField.lasso.groundedObjectIds, []);
assert.equal(toolRuntime.neuralField.lasso.activeRelation, null);
assert.deepEqual(toolResources.metrics.setTools, ["spatial_lasso", "airscript"]);
await endNeuralField("tool_test_complete", { target: toolRuntime, preserveCamera: false });
assert.equal(toolResources.metrics.workerStops, 1);
assert.equal(toolResources.metrics.rendererStops, 1);

const semanticRuntime = createInitialState();
const semanticStream = fakeStream({ audio: false, video: true });
const semanticResources = resourceHarness();
await startNeuralField({ tool: "airscript" }, {
  target: semanticRuntime,
  mediaStream: semanticStream,
  ...semanticResources.options
});
const semanticGeneration = semanticRuntime.neuralField.generation;
let semanticCalls = 0;
const neverCalledAdapter = async () => {
  semanticCalls += 1;
  return {};
};
for (let index = 0; index < 8; index += 1) {
  applyNeuralFieldToolEvent(toolEvent("hand_frame", "airscript", semanticGeneration, {
    dominantHand: "right",
    confidence: 0.9
  }, 4000 + index), { target: semanticRuntime });
}
applyNeuralFieldToolEvent(toolEvent("pinch_started", "airscript", semanticGeneration, {
  strokeId: "stroke_local",
  point: { x: 0.1, y: 0.2 }
}), { target: semanticRuntime });
applyNeuralFieldToolEvent(toolEvent("pinch_updated", "airscript", semanticGeneration, {
  strokeId: "stroke_local",
  point: { x: 0.2, y: 0.3 }
}), { target: semanticRuntime });
const incomplete = await commitNeuralFieldGesture({
  eventId: "incomplete_stroke",
  unknown: true,
  requiresInterpretation: true
}, {
  target: semanticRuntime,
  semanticAdapter: neverCalledAdapter
});
assert.equal(incomplete.code, "neural_field_completion_required");
assert.equal(semanticCalls, 0, "hand frames, points, and incomplete gestures make no cloud calls");

const voice = createNeuralVoiceHarness();
const localCompletion = await commitNeuralFieldGesture({
  eventId: "moment_once",
  completed: true,
  classification: "circle",
  closed: true
}, {
  target: semanticRuntime,
  speak: true,
  ...voice.options
});
assert.equal(localCompletion.ok, true);
assert.equal(localCompletion.local, true);
assert.equal(semanticCalls, 0, "known completed strokes remain local");
assert.equal(voice.requests.filter((request) => request.pathname.endsWith("/speak")).length, 1);
assert.equal(voice.maxActiveCount, 1, "the canonical neural voice remains exclusive");
await commitNeuralFieldGesture({
  eventId: "moment_once",
  completed: true,
  classification: "circle",
  closed: true
}, { target: semanticRuntime });
const storedMoments = semanticRuntime.emergencyRuntimeController.snapshot().persistentMemory.neuralFieldMoments;
assert.equal(storedMoments.length, 1, "Recent Moments stores a completed gesture once");
assert.equal(storedMoments[0].role, "AIRSCRIPT");
assert.equal(storedMoments[0].text, "Drew a closed circular stroke.");
assert.equal(containsProhibitedNeuralFieldData(storedMoments), false);

const pendingSemantic = deferred();
const semanticLimiter = requestLimiterHarness();
let capturedSemanticPayload = null;
let capturedSemanticSignal = null;
const semanticAdapter = async (payload, { signal } = {}) => {
  semanticCalls += 1;
  capturedSemanticPayload = payload;
  capturedSemanticSignal = signal;
  return pendingSemantic.promise;
};
const firstSemantic = commitNeuralFieldGesture({
  eventId: "semantic_first",
  completed: true,
  unknown: true,
  requiresInterpretation: true,
  evidenceFrameIndices: [0, 1, 2, 3, 4],
  evidenceFrames: [
    { index: 0, timestamp: 1 },
    { index: 1, timestamp: 2 },
    { index: 2, timestamp: 3 },
    { index: 3, timestamp: 4 },
    { index: 4, timestamp: 5 }
  ]
}, {
  target: semanticRuntime,
  semanticAdapter,
  requestLimiter: semanticLimiter,
  maximumFrames: 2,
  maximumBodyBytes: 4096
});
assert.equal(semanticCalls, 1);
assert.equal(semanticRuntime.neuralField.semantic.requestInFlight, true);
const secondSemantic = await commitNeuralFieldGesture({
  eventId: "semantic_second",
  completed: true,
  unknown: true,
  requiresInterpretation: true
}, {
  target: semanticRuntime,
  semanticAdapter,
  requestLimiter: semanticLimiter
});
assert.equal(secondSemantic.code, "semantic_request_in_flight");
assert.equal(semanticCalls, 1, "one semantic request maximum");
assert.equal(capturedSemanticPayload.evidenceFrames.length <= 2, true);
assert.equal(capturedSemanticPayload.maximumFrames <= 2, true);
assert.equal(capturedSemanticPayload.maximumBodyBytes <= 4096, true);
assert.equal(containsProhibitedNeuralFieldData(capturedSemanticPayload), false);
await switchNeuralFieldTool("spatial_lasso", { target: semanticRuntime });
assert.equal(capturedSemanticSignal.aborted, true);
pendingSemantic.resolve({ classification: "triangle", summary: "Drew a triangle." });
const staleSemantic = await firstSemantic;
assert.equal(staleSemantic.ok, false);
assert.equal(staleSemantic.code, "stale_semantic_response");
assert.equal(
  semanticRuntime.emergencyRuntimeController.snapshot().persistentMemory.neuralFieldMoments.length,
  1,
  "stale semantic response cannot add a moment"
);
const semanticSummary = neuralFieldResourceSummary(semanticRuntime);
assert.equal(semanticSummary.neural_field_semantic_request_count, 1);
assert.equal(semanticSummary.neural_field_active_semantic_requests, 0);
assert.equal(semanticSummary.neural_field_maximum_semantic_requests, 1);

await switchNeuralFieldTool("airscript", { target: semanticRuntime });
let blockedAdapterCalls = 0;
const blockedAdapter = async () => {
  blockedAdapterCalls += 1;
  return { classification: "square" };
};
const cloudDisabled = await commitNeuralFieldGesture({
  eventId: "cloud_disabled",
  completed: true,
  unknown: true,
  requiresInterpretation: true
}, {
  target: semanticRuntime,
  cloudEnabled: false,
  semanticAdapter: blockedAdapter
});
assert.equal(cloudDisabled.code, "hf_cloud_disabled");
assert.equal(blockedAdapterCalls, 0, "cloud-disabled mode makes no semantic call");
const requestLimited = await commitNeuralFieldGesture({
  eventId: "request_limited",
  completed: true,
  unknown: true,
  requiresInterpretation: true
}, {
  target: semanticRuntime,
  semanticAdapter: blockedAdapter,
  requestLimiter: requestLimiterHarness({ ok: false, code: "hf_session_limit_reached" })
});
assert.equal(requestLimited.code, "hf_session_limit_reached");
assert.equal(blockedAdapterCalls, 0, "request limits are never bypassed");
const momentsBeforeAccountingFailure = semanticRuntime.emergencyRuntimeController.snapshot().persistentMemory.neuralFieldMoments.length;
const accountingFailure = await commitNeuralFieldGesture({
  eventId: "accounting_failure",
  completed: true,
  unknown: true,
  requiresInterpretation: true
}, {
  target: semanticRuntime,
  semanticAdapter: async () => ({ classification: "square", summary: "Drew a square." }),
  requestLimiter: {
    ...requestLimiterHarness(),
    recordLogicalRequest() {
      return { ok: false, code: "semantic_accounting_failed" };
    }
  }
});
assert.equal(accountingFailure.code, "semantic_accounting_failed");
assert.equal(
  semanticRuntime.emergencyRuntimeController.snapshot().persistentMemory.neuralFieldMoments.length,
  momentsBeforeAccountingFailure,
  "semantic results are not committed when durable request accounting fails"
);
const throwingFinishLimiter = requestLimiterHarness();
throwingFinishLimiter.finishRequest = () => { throw new Error("finish failed"); };
const finishFailureResult = await commitNeuralFieldGesture({
  eventId: "finish_failure",
  completed: true,
  unknown: true,
  requiresInterpretation: true
}, {
  target: semanticRuntime,
  semanticAdapter: async () => ({ classification: "square", summary: "Drew a square." }),
  requestLimiter: throwingFinishLimiter
});
assert.equal(finishFailureResult.ok, true, "limiter finalization failure cannot leak semantic ownership");
assert.equal(neuralFieldResourceSummary(semanticRuntime).neural_field_active_semantic_requests, 0);
assert.equal(
  JSON.stringify(semanticRuntime.emergencyRuntimeController.snapshot().persistentMemory).includes("encoded_frame"),
  false,
  "persistent memory contains no raw frames"
);
await endNeuralField("semantic_test_complete", { target: semanticRuntime, preserveCamera: false });

const replayRuntime = createInitialState();
const replayStream = fakeStream({ audio: false, video: true });
const replayResources = resourceHarness();
await startNeuralField({ tool: "spatial_lasso" }, {
  target: replayRuntime,
  mediaStream: replayStream,
  ...replayResources.options
});
assert.equal((await startNeuralFieldReplay({ target: replayRuntime })).code, "replay_consent_required");
assert.equal((await requestReplayConsent({
  target: replayRuntime,
  requestConsent: async () => false
})).code, "replay_consent_required");
await requestReplayConsent({ target: replayRuntime, consentGranted: true });
const savedRecorder = replayRecorderHarness();
await startNeuralFieldReplay({
  target: replayRuntime,
  replayRecorderFactory: savedRecorder.factory
});
assert.equal(savedRecorder.context.localOnly, true);
assert.equal(savedRecorder.context.maximumDurationMs > 0, true);
const replayGeneration = replayRuntime.neuralField.generation;
applyNeuralFieldToolEvent(toolEvent("lasso_started", "spatial_lasso", replayGeneration, {
  strokeId: "replay_lasso",
  point: { x: 0.1, y: 0.1 }
}), { target: replayRuntime });
applyNeuralFieldToolEvent(toolEvent("selection_grounded", "spatial_lasso", replayGeneration, {
  objectId: "mug"
}), { target: replayRuntime });
applyNeuralFieldToolEvent(toolEvent("relation_grounded", "spatial_lasso", replayGeneration, {
  relation: {
    subjectId: "mug",
    predicate: "left_of",
    objectId: "laptop",
    confidence: 0.9,
    evidenceFrameIndices: [1],
    scaleType: "relative",
    metricEstimate: null
  }
}), { target: replayRuntime });
assert.equal(savedRecorder.recorded.length, 3);
await stopNeuralFieldReplay({ target: replayRuntime });
let savedArtifact = null;
const saveResult = await saveNeuralFieldReplay({
  target: replayRuntime,
  async save(artifact) {
    savedArtifact = artifact;
  }
});
assert.equal(saveResult.ok, true);
assert.equal(savedArtifact.localOnly, true);
assert.equal(savedArtifact.containsRawMedia, false);
assert.equal(savedArtifact.events.length, 3);
assert.equal(containsProhibitedNeuralFieldData(savedArtifact), false);
assert.equal(savedRecorder.metrics.discards, 0, "explicitly saved replay is not discarded");
assert.equal(savedRecorder.metrics.releases, 1);
assert.equal(neuralFieldResourceSummary(replayRuntime).neural_field_replay_count, 0);

await requestReplayConsent({ target: replayRuntime, consentGranted: true });
const discardedRecorder = replayRecorderHarness();
await startNeuralFieldReplay({
  target: replayRuntime,
  replayRecorderFactory: discardedRecorder.factory
});
applyNeuralFieldToolEvent(toolEvent("lasso_updated", "spatial_lasso", replayRuntime.neuralField.generation, {
  strokeId: "replay_lasso",
  point: { x: 0.2, y: 0.2 }
}), { target: replayRuntime });
assert.equal(replayRuntime.neuralField.replay.recording, true);
await endNeuralField("replay_exit", { target: replayRuntime, preserveCamera: false });
assertInactiveNeuralField(replayRuntime);
assert.equal(discardedRecorder.metrics.stops, 1);
assert.equal(discardedRecorder.metrics.discards, 1, "unsaved replay is discarded on exit");
assert.equal(discardedRecorder.metrics.releases, 1);
assert.equal(neuralFieldResourceSummary(replayRuntime).neural_field_replay_count, 0);
assert.equal(replayStream.getVideoTracks()[0].stopCount, 1);
await discardNeuralFieldReplay({ target: replayRuntime });

const replayRaceRuntime = createInitialState();
const replayRaceResources = resourceHarness();
await startNeuralField({ tool: "airscript" }, {
  target: replayRaceRuntime,
  mediaStream: fakeStream({ audio: false, video: true }),
  ...replayRaceResources.options
});
await requestReplayConsent({ target: replayRaceRuntime, consentGranted: true });
const replayStartGate = deferred();
const replayLifecycleOrder = [];
const replayStart = startNeuralFieldReplay({
  target: replayRaceRuntime,
  replayRecorderFactory() {
    return {
      async start() {
        replayLifecycleOrder.push("start");
        await replayStartGate.promise;
        replayLifecycleOrder.push("started");
      },
      async stop() { replayLifecycleOrder.push("stop"); },
      async discard() { replayLifecycleOrder.push("discard"); },
      async release() { replayLifecycleOrder.push("release"); }
    };
  }
});
await Promise.resolve();
const replayRaceEnd = endNeuralField("end_during_replay_start", { target: replayRaceRuntime, preserveCamera: false });
replayStartGate.resolve();
const [staleReplayStart, replayRaceEnded] = await Promise.all([replayStart, replayRaceEnd]);
assert.equal(staleReplayStart.code, "stale_replay_start");
assert.equal(replayRaceEnded.ok, true);
assert.deepEqual(replayLifecycleOrder, ["start", "started", "stop", "discard", "release"], "replay teardown is ordered after pending start settles");
assertInactiveNeuralField(replayRaceRuntime);

const replayTimeoutRuntime = createInitialState();
const replayTimeoutResources = resourceHarness();
await startNeuralField({ tool: "airscript" }, {
  target: replayTimeoutRuntime,
  mediaStream: fakeStream({ audio: false, video: true }),
  ...replayTimeoutResources.options
});
await requestReplayConsent({ target: replayTimeoutRuntime, consentGranted: true });
const replayTimeoutResult = await startNeuralFieldReplay({
  target: replayTimeoutRuntime,
  replayStartTimeoutMs: 50,
  replayStartTeardownWaitMs: 0,
  replayTeardownTimeoutMs: 50,
  replayRecorderFactory() {
    return {
      start: () => new Promise(() => {}),
      stop() {},
      discard() {},
      release() {}
    };
  }
});
assert.equal(replayTimeoutResult.code, "replay_start_timeout");
assert.equal(neuralFieldResourceSummary(replayTimeoutRuntime).neural_field_replay_count, 0, "timed-out replay start releases ownership");
await endNeuralField("replay_timeout_complete", { target: replayTimeoutRuntime, preserveCamera: false });

const cycleRuntime = createInitialState();
const cycleResources = resourceHarness();
for (let cycle = 0; cycle < 5; cycle += 1) {
  const cycleStream = fakeStream({ audio: false, video: true });
  const started = await startNeuralField({ tool: cycle % 2 === 0 ? "airscript" : "spatial_lasso" }, {
    target: cycleRuntime,
    mediaStream: cycleStream,
    ...cycleResources.options
  });
  assert.equal(started.ok, true);
  assert.equal(neuralFieldResourceSummary(cycleRuntime).neural_field_worker_count, 1);
  assert.equal(neuralFieldResourceSummary(cycleRuntime).neural_field_renderer_loop_count, 1);
  await endNeuralField("cycle_" + cycle, { target: cycleRuntime, preserveCamera: false });
  assertInactiveNeuralField(cycleRuntime);
  const resources = neuralFieldResourceSummary(cycleRuntime);
  assert.equal(resources.neural_field_worker_count, 0);
  assert.equal(resources.neural_field_renderer_loop_count, 0);
  assert.equal(resources.neural_field_active_semantic_requests, 0);
  assert.equal(resources.neural_field_replay_count, 0);
  assert.equal(cycleStream.getVideoTracks()[0].stopCount, 1);
}
assert.equal(cycleResources.metrics.workerStarts, 5);
assert.equal(cycleResources.metrics.workerStops, 5);
assert.equal(cycleResources.metrics.rendererStarts, 5);
assert.equal(cycleResources.metrics.rendererStops, 5);
assert.equal(cycleResources.metrics.maximumWorkers, 1);
assert.equal(cycleResources.metrics.maximumRenderers, 1);

assert.equal(
  /MediaRecorder|toDataURL|readAsDataURL|indexedDB|navigator\.sendBeacon/i.test(neuralFieldSource),
  false,
  "Neural Field contracts do not persist raw media"
);
assert.equal(
  /MediaRecorder|toDataURL|readAsDataURL|indexedDB|navigator\.sendBeacon/i.test(localCaptureSource),
  false,
  "Neural Field runtime adds no raw-media persistence path"
);
assert.equal(containsProhibitedNeuralFieldData(neuralFieldResourceSummary(cycleRuntime)), false);

console.log("ok neural field systems");

function toolEvent(type, tool, generation, metadata = {}, timestamp = Date.now()) {
  return {
    type,
    eventId: type + "_" + generation + "_" + timestamp,
    neuralFieldGeneration: generation,
    tool,
    timestamp,
    metadata
  };
}

function fakeTrack(kind) {
  return {
    kind,
    enabled: true,
    readyState: "live",
    stopCount: 0,
    stop() {
      if (this.readyState === "ended") return;
      this.stopCount += 1;
      this.readyState = "ended";
    }
  };
}

function fakeStream({ audio, video }) {
  const tracks = [
    ...(video ? [fakeTrack("video")] : []),
    ...(audio ? [fakeTrack("audio")] : [])
  ];
  return {
    get tracks() {
      return tracks;
    },
    addTrack(track) {
      tracks.push(track);
    },
    getTracks() {
      return tracks;
    },
    getAudioTracks() {
      return tracks.filter((track) => track.kind === "audio");
    },
    getVideoTracks() {
      return tracks.filter((track) => track.kind === "video");
    }
  };
}

function activeTracks(stream, kind) {
  return stream.getTracks().filter((track) => track.kind === kind && track.readyState !== "ended");
}

function recognitionClass(order) {
  return class FakeSpeechRecognition {
    start() {
      order.push("stt_start");
      this.onstart?.();
    }
    abort() {
      order.push("stt_abort");
      this.onend?.();
    }
    stop() {
      order.push("stt_stop");
      this.onend?.();
    }
  };
}

function resourceHarness(hooks = {}) {
  const metrics = {
    activeWorkers: 0,
    maximumWorkers: 0,
    workerStarts: 0,
    workerStops: 0,
    activeRenderers: 0,
    maximumRenderers: 0,
    rendererStarts: 0,
    rendererStops: 0,
    workerContexts: [],
    rendererContexts: [],
    clearedTools: [],
    setTools: []
  };

  return {
    metrics,
    options: {
      handWorkerFactory(context) {
        metrics.workerContexts.push(context);
        hooks.onWorkerFactory?.(context);
        let active = false;
        return {
          start({ stream }) {
            assert.ok(stream);
            if (active) return;
            active = true;
            metrics.activeWorkers += 1;
            metrics.workerStarts += 1;
            metrics.maximumWorkers = Math.max(metrics.maximumWorkers, metrics.activeWorkers);
          },
          stop() {
            if (!active) return;
            active = false;
            metrics.activeWorkers -= 1;
            metrics.workerStops += 1;
          },
          isReady() {
            return true;
          }
        };
      },
      rendererFactory(context) {
        metrics.rendererContexts.push(context);
        hooks.onRendererFactory?.(context);
        let active = false;
        return {
          start() {
            if (active) return;
            active = true;
            metrics.activeRenderers += 1;
            metrics.rendererStarts += 1;
            metrics.maximumRenderers = Math.max(metrics.maximumRenderers, metrics.activeRenderers);
          },
          stop() {
            if (!active) return;
            active = false;
            metrics.activeRenderers -= 1;
            metrics.rendererStops += 1;
          },
          clearTool(tool) {
            metrics.clearedTools.push(tool);
          },
          setTool(tool) {
            metrics.setTools.push(tool);
          }
        };
      }
    }
  };
}

function replayRecorderHarness() {
  const metrics = { starts: 0, stops: 0, discards: 0, releases: 0 };
  const recorded = [];
  let context = null;
  return {
    metrics,
    recorded,
    get context() {
      return context;
    },
    factory(input) {
      context = input;
      return {
        start() {
          metrics.starts += 1;
        },
        stop() {
          metrics.stops += 1;
        },
        record(event) {
          recorded.push(event);
        },
        discard() {
          metrics.discards += 1;
        },
        release() {
          metrics.releases += 1;
        }
      };
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function requestLimiterHarness(allowed = { ok: true }) {
  const metrics = { checks: 0, begins: 0, finishes: 0, logicalRequests: 0, failures: 0 };
  return {
    metrics,
    checkRequestAllowed() {
      metrics.checks += 1;
      return allowed;
    },
    beginRequest() {
      metrics.begins += 1;
      return { ok: true };
    },
    finishRequest() {
      metrics.finishes += 1;
    },
    recordLogicalRequest() {
      metrics.logicalRequests += 1;
    },
    recordFailure() {
      metrics.failures += 1;
    }
  };
}

function assertMutuallyExclusive(runtime) {
  assert.equal(runtime.neuralField.status, "active");
  assert.equal(runtime.interactionState.sessionActive, false);
  assert.equal(runtime.interactionState.listeningActive, false);
  assert.equal(runtime.interactionState.proactiveObservationActive, false);
}

function assertInactiveNeuralField(runtime) {
  assert.equal(runtime.neuralField.status, "inactive");
  assert.equal(runtime.neuralField.tool, null);
  assert.equal(runtime.neuralField.sessionId, null);
  assert.equal(runtime.neuralField.handTracking.active, false);
  assert.equal(runtime.neuralField.handTracking.workerReady, false);
  assert.equal(runtime.neuralField.gesture.pinchActive, false);
  assert.equal(runtime.neuralField.gesture.activeStrokeId, null);
  assert.equal(runtime.neuralField.gesture.activeStroke, null);
  assert.deepEqual(runtime.neuralField.gesture.completedStrokeIds, []);
  assert.equal(runtime.neuralField.lasso.candidateStrokeId, null);
  assert.deepEqual(runtime.neuralField.lasso.groundedObjectIds, []);
  assert.equal(runtime.neuralField.lasso.pendingSelection, null);
  assert.equal(runtime.neuralField.lasso.activeRelation, null);
  assert.equal(runtime.neuralField.rendering.active, false);
  assert.equal(runtime.neuralField.semantic.requestInFlight, false);
  assert.equal(runtime.neuralField.semantic.activeRequestId, null);
  assert.equal(runtime.neuralField.semantic.queuedCommit, null);
  assert.equal(runtime.neuralField.replay.recording, false);
  assert.equal(runtime.neuralField.replay.consentGranted, false);
  assert.equal(runtime.neuralField.replay.recorderId, null);
  assert.equal(runtime.neuralField.safeError, null);
  assert.equal(assertNeuralFieldStateInvariants(runtime.neuralField), true);
}
