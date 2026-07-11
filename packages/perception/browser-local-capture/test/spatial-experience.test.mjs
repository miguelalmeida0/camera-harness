import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analyzeSpatialWindow,
  createSpatialExperienceState,
  detectSpatialIntent,
  resolveSpatialQuery,
  spatialContextForRequest,
  spatialFactsBlock,
  spatialMetadata,
  spatialNarration,
  spatialOverlayModel,
  updateSpatialMemory,
  validateSpatialPredicateDefinition,
  validateSpatialResult
} from "../prototype/spatial/spatial-experience.js";
import { analyzeSpatialExperienceForWindow, createInitialState, queueMovementRecognitionResult } from "../prototype/local-capture.js";
import { createDeterministicSpatialAdapter, SPATIAL_TEST_SCENARIOS } from "./spatial-test-adapter.mjs";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("prototype/local-capture.js", root), "utf8");
const html = readFileSync(new URL("prototype/index.html", root), "utf8");
const spatialSource = readFileSync(new URL("prototype/spatial/spatial-experience.js", root), "utf8");

const spatialQueries = new Map([
  ["What is to the left of the laptop?", "relative_position"],
  ["Which object is closest to me?", "relative_distance"],
  ["Is the mug behind the phone?", "relative_position"],
  ["Did I move the bottle closer?", "movement_direction"],
  ["Where was the cup before?", "movement_direction"],
  ["What changed on the desk?", "scene_change"],
  ["How far apart are these objects?", "metric_distance"],
  ["Is my right hand closer than my left?", "hand_object_relation"],
  ["Did the bottle move toward the camera?", "movement_direction"],
  ["What left the frame?", "movement_direction"]
]);
for (const [query, intent] of spatialQueries) {
  assert.deepEqual(detectSpatialIntent(query), {
    isSpatial: true,
    intent,
    requiredCapabilities: detectSpatialIntent(query).requiredCapabilities
  }, query);
}

for (const query of ["Tell me a joke.", "What is Starship?", "Explain React.", "What color is the mug?", "Can you hear me?", "What do you think about this design?"]) {
  assert.equal(detectSpatialIntent(query).isSpatial, false, `ordinary query stays on the ordinary path: ${query}`);
}

for (const [name, scenario] of Object.entries(SPATIAL_TEST_SCENARIOS)) {
  if (name === "service_unavailable") continue;
  const validated = validateSpatialResult(scenario);
  assert.equal(validated.ok, true, `${name} matches the production contract`);
  assert.equal(validated.source, "local_spatial");
  assert.equal(Array.isArray(validated.evidence), true);
}
assert.throws(() => createDeterministicSpatialAdapter(), /requires_test_mode/, "deterministic adapter cannot activate without test mode");

const frames = [
  { captured_at_ms: 1000, width: 320, height: 180, encoded_frame: "YQ==" },
  { captured_at_ms: 1100, width: 320, height: 180, encoded_frame: "Yg==" }
];
const adapter = createDeterministicSpatialAdapter({ testMode: true, scenario: "mug_left_of_laptop" });
const runtime = createInitialState();
const ordinary = await analyzeSpatialExperienceForWindow(runtime, frames, {
  mode: "conversation",
  query: "Tell me a joke.",
  spatialAdapter: adapter,
  spatialTestMode: true
});
assert.equal(ordinary.requested, false);
assert.equal(adapter.calls.length, 0, "ordinary query does not invoke spatial adapter");

const spatial = await analyzeSpatialExperienceForWindow(runtime, frames, {
  mode: "conversation",
  query: "What is to the left of the laptop?",
  spatialAdapter: adapter,
  spatialTestMode: true
});
assert.equal(spatial.requested, true);
assert.equal(adapter.calls.length, 1);
assert.equal(spatialNarration(spatial.result), "The mug is to the left of the laptop.");
assert.ok(spatialFactsBlock(spatial.result).some((fact) => fact.includes("mug left_of laptop")));
assert.equal(spatialContextForRequest(spatial.result, { requested: true, intent: "relative_position" }).available, true);

updateSpatialMemory(runtime.spatialExperience, spatial.result, "The mug is to the left of the laptop.");
assert.match(resolveSpatialQuery("Did I move it closer?", runtime.spatialExperience.memory), /Referenced object.*mug/i, "bounded follow-up resolves the last object label");

assert.equal(spatialNarration(SPATIAL_TEST_SCENARIOS.mug_in_front_of_laptop), "You moved the mug from the left side of the laptop to the area in front of it.");
assert.equal(spatialNarration(SPATIAL_TEST_SCENARIOS.bottle_behind_keyboard), "You placed the bottle behind the keyboard.");
assert.equal(spatialNarration(SPATIAL_TEST_SCENARIOS.hand_approaching_mug), "Your right hand moved closer to the mug.");
assert.equal(spatialNarration(SPATIAL_TEST_SCENARIOS.hand_toward_camera), "Your right hand moved closer to the camera.");
assert.equal(spatialNarration(SPATIAL_TEST_SCENARIOS.object_leaves_frame_right), "The object moved out of view toward the right.");

const partial = spatialNarration(SPATIAL_TEST_SCENARIOS.partial_unknown_object);
assert.match(partial, /dark handle and part of a metallic body/i);
assert.match(partial, /Rotate the object slightly/i);
assert.equal(spatialMetadata(SPATIAL_TEST_SCENARIOS.suggested_additional_view), "Additional view needed");

const repeatedViewRuntime = createInitialState();
const viewAdapter = createDeterministicSpatialAdapter({ testMode: true, scenario: "suggested_additional_view" });
const firstView = await analyzeSpatialExperienceForWindow(repeatedViewRuntime, frames, { mode: "observing", query: "", spatialAdapter: viewAdapter, spatialTestMode: true });
const secondView = await analyzeSpatialExperienceForWindow(repeatedViewRuntime, frames, { mode: "observing", query: "", spatialAdapter: viewAdapter, spatialTestMode: true });
assert.match(spatialNarration(firstView.result), /Turn the object toward the camera/i);
assert.doesNotMatch(spatialNarration(secondView.result), /Turn the object toward the camera/i, "same suggested view is not repeated");

const uncalibrated = spatialNarration(SPATIAL_TEST_SCENARIOS.uncalibrated_relative_distance);
assert.doesNotMatch(uncalibrated, /\b\d+(?:\.\d+)?\s*(?:cm|centimet|meter|metre|inch|feet)\b/i, "relative scale never fabricates metric distance");
assert.match(spatialFactsBlock(SPATIAL_TEST_SCENARIOS.uncalibrated_relative_distance).join(" "), /no metric calibration available/);
assert.match(spatialNarration(SPATIAL_TEST_SCENARIOS.calibrated_metric_distance), /fifteen centimetres/i, "metric narration requires metric scale");

const unavailableRuntime = createInitialState();
const unavailableAdapter = createDeterministicSpatialAdapter({ testMode: true, scenario: "service_unavailable" });
const unavailable = await analyzeSpatialExperienceForWindow(unavailableRuntime, frames, {
  mode: "conversation",
  query: "What is left of the laptop?",
  spatialAdapter: unavailableAdapter,
  spatialTestMode: true
});
assert.equal(unavailable.unavailable, true);
assert.equal(unavailableRuntime.spatialExperience.status, "unavailable");
assert.equal(unavailableRuntime.interactionState.sessionActive, false, "spatial failure does not mutate application lifecycle");

let productionFetchCalls = 0;
await assert.rejects(() => analyzeSpatialWindow({ frames, timestamps: [1000, 1100], query: "left", mode: "conversation" }, {
  fetch: async (url, request) => {
    productionFetchCalls += 1;
    assert.equal(url, "/api/spatial-awareness/analyze");
    const payload = JSON.parse(request.body);
    assert.deepEqual(Object.keys(payload).sort(), ["calibration", "frames", "mode", "previousScene", "query", "timestamps"].sort());
    return { ok: false, async json() { return {}; } };
  }
}), /unavailable/);
assert.equal(productionFetchCalls, 1, "production adapter calls the exact spatial endpoint");

const predicate = validateSpatialPredicateDefinition({ type: "spatial_predicate", predicate: "object_moves_closer", subject_label: "mug", reference_label: "camera", minimum_confidence: 0.8 });
assert.equal(predicate.ok, true);
assert.equal(predicate.value.minimum_confidence, 0.8);
assert.equal(validateSpatialPredicateDefinition({ type: "spatial_predicate", predicate: "javascript", subject_label: "mug", reference_label: "camera", minimum_confidence: 0.8 }).ok, false);
assert.equal(validateSpatialPredicateDefinition({ type: "spatial_predicate", predicate: "object_moves_closer", subject_label: "mug", reference_label: "camera", minimum_confidence: 0.1 }).ok, false);

const overlay = spatialOverlayModel(SPATIAL_TEST_SCENARIOS.mug_left_of_laptop);
assert.equal(overlay.label, "mug");
assert.equal(/mug_1|laptop_1|\d+\.\d+,\d+\.\d+/.test(JSON.stringify(overlay)), false, "overlay exposes no IDs or debug coordinates");
assert.match(html, /id="spatialEvidenceOverlay"/);
assert.match(html, /prefers-reduced-motion: no-preference/);
assert.equal((html.match(/data-interaction-mode=/g) || []).length >= 2, true);
assert.equal(html.includes('data-interaction-mode="spatial"'), false, "no third mode exists");
assert.equal(html.includes("Spatial dashboard"), false);
assert.equal(/SpeechSynthesisUtterance|speechSynthesis|speakVisualResponse/.test(spatialSource), false, "spatial layer adds no voice engine or speech owner");
assert.equal(/MediaRecorder|indexedDB|navigator\.sendBeacon|WebSocket/i.test(spatialSource), false, "spatial layer does not persist or stream raw media");

const momentRuntime = createInitialState();
momentRuntime.emergencyRuntimeController.beginStart("observing");
momentRuntime.emergencyRuntimeController.activate("observing", { cameraActive: true, microphoneActive: false });
momentRuntime.interactionState.sessionActive = true;
momentRuntime.interactionState.mode = "observing";
const movementResult = {
  observation_id: "spatial_scene_once",
  movement: "The object moved out of view toward the right.",
  spoken_response: "The object moved out of view toward the right.",
  response_type: "narrate",
  meaningful_change: true,
  movement_label: "object_leaves_frame",
  evidence_frames: [1, 2],
  confidence: 0.86,
  uncertainty: false,
  provider: "local_spatial",
  model: "spatial-adapter",
  response_source: "local_vlm"
};
queueMovementRecognitionResult(momentRuntime, movementResult, 2000, { recordMovementHistory: true, queueSuggestion: false });
queueMovementRecognitionResult(momentRuntime, movementResult, 2000, { recordMovementHistory: true, queueSuggestion: false });
assert.equal(momentRuntime.emergencyRuntimeController.snapshot().persistentMemory.observationMoments.length, 1, "duplicate scene does not duplicate Recent Moments");

console.log("ok spatial experience");
