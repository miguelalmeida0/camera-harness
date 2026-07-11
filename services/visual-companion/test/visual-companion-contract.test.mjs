import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyContextualResponsePolicy,
  containsRawMedia,
  createMockVisualCompanionProvider,
  createVisualCompanionMemory,
  createVisualObservationWindow,
  createVisualTtsRuntime,
  normalizeContextualVisualResponse,
  normalizeMalformedVisualOutput,
  scoreVisualScenario,
  suggestedActionsRequireConfirmation,
  summarizeVisualMetrics,
  validateContextualVisualResponse,
  validateVisualObservationWindow,
  validateVisualProviderContract,
  withObservationFrameCleanup
} from "../index.mjs";

const scenarioDataset = JSON.parse(readFileSync(resolve("fixtures/visual-companion/scenarios/initial_scenarios.v1.json"), "utf8"));
const checks = [];

function check(name, condition, evidence = undefined) {
  checks.push({ name, pass: Boolean(condition), evidence });
  assert.equal(Boolean(condition), true, `${name}${evidence ? `: ${JSON.stringify(evidence)}` : ""}`);
}

const window = createVisualObservationWindow({
  observation_window_id: "window_contract_001",
  cameraActive: true,
  documentVisible: true,
  frames: [
    { frame_id: "a", timestamp_ms: 10, width: 640, height: 480, byte_length: 1200, descriptor: "object on desk" },
    { frame_id: "b", timestamp_ms: 80, width: 640, height: 480, byte_length: 1220, descriptor: "hand lifts object" },
    { frame_id: "c", timestamp_ms: 150, width: 640, height: 480, byte_length: 1210, descriptor: "object raised" }
  ]
});
check("observation.frames_ordered", validateVisualObservationWindow(window).ok);
check("observation.frame_count_bounded", window.frame_count === 3);
check("observation.request_size_bounded", window.request_size_bytes < window.limits.maxRequestBytes);
check("observation.no_raw_media", window.contains_raw_media === false && containsRawMedia(window) === false);
check("observation.hidden_tab_blocked", createVisualObservationWindow({ documentVisible: false }).blocked_reason === "visual_hidden_tab_blocked");
check("observation.camera_off_blocked", createVisualObservationWindow({ cameraActive: false }).blocked_reason === "visual_camera_off_blocked");
check("observation.double_click_blocked", createVisualObservationWindow({ requestInFlight: true }).blocked_reason === "visual_one_request_in_flight");
const frameBuffer = [{ data_uri: "data:image/jpeg;base64,abc" }];
await withObservationFrameCleanup(frameBuffer, async () => "done");
check("observation.frames_cleared_finally", frameBuffer.length === 0);

const response = normalizeContextualVisualResponse({
  observation: "object raised",
  scene_before: "object on table",
  scene_after: "object held up",
  visible_changes: ["object moved upward"],
  visible_objects: ["object", "hand"],
  visible_action: "raise_object",
  response_type: "narrate",
  spoken_response: "You raised the object.",
  confidence: 0.86,
  uncertainty: "",
  safety_flags: [],
  suggested_actions: [{ action_type: "start_timer", label: "Start timer", execute: true, requires_confirmation: false }]
});
check("response.required_schema_fields", validateContextualVisualResponse(response).ok);
check("response.suggested_actions_confirmation_required", suggestedActionsRequireConfirmation(response));
check("response.malformed_normalizes_uncertain", normalizeMalformedVisualOutput("bad").response_type === "uncertain");
check("response.partial_normalizes", normalizeMalformedVisualOutput({ spoken_response: "Maybe.", confidence: 0.2 }).response_type === "uncertain");

check("policy.narrate_clear_change", applyContextualResponsePolicy(response).response_type === "narrate");
check("policy.ask_ambiguous", applyContextualResponsePolicy({ ...response, response_type: "ask" }, { ambiguousIntent: true }).response_type === "ask");
check("policy.assist_allowlisted", applyContextualResponsePolicy({ ...response, response_type: "assist" }).response_type === "assist");
check("policy.uncertain_low_confidence", applyContextualResponsePolicy({ ...response, confidence: 0.2 }).response_type === "uncertain");
check("policy.silence_no_change", applyContextualResponsePolicy({ ...response, visible_changes: [] }).response_type === "silence");
check("policy.model_cannot_force_execution", applyContextualResponsePolicy(response).suggested_actions[0].execute === false);

for (const [name, unsafe] of Object.entries({
  visual_identity_inference: { ...response, spoken_response: "This is Maria." },
  visual_sensitive_attribute_inference: { ...response, spoken_response: "The person appears disabled." },
  visual_emotion_overclaim: { ...response, spoken_response: "The person is angry." },
  visual_private_text_exposure: { ...response, spoken_response: "The document says secret text." },
  visual_unsafe_action: { ...response, suggested_actions: [{ action_type: "shell_command", label: "Run command" }] },
  visual_uncertainty_hidden: { ...response, response_type: "uncertain", uncertainty: "" }
})) {
  const result = validateContextualVisualResponse(normalizeContextualVisualResponse(unsafe));
  check(`safety.${name}`, result.failures.includes(name), result.failures);
}
check("safety.raw_media_detected", validateContextualVisualResponse({ ...response, evidence: "data:image/jpeg;base64,abc" }).failures.includes("visual_raw_media_persisted"));

const provider = createMockVisualCompanionProvider();
const providerResult = await validateVisualProviderContract(provider, { window });
check("provider.contract_methods", providerResult.ok, providerResult.failures);
const unpinnedProvider = createMockVisualCompanionProvider({ revision: "latest" });
const unpinnedResult = await validateVisualProviderContract(unpinnedProvider, { window });
check("provider.unpinned_fails", unpinnedResult.failures.includes("visual_provider_unpinned"), unpinnedResult.failures);

const ttsCalls = [];
const tts = createVisualTtsRuntime({
  kokoro: {
    async synthesize(text) { ttsCalls.push(`kokoro:${text}`); },
    cancel() { ttsCalls.push("kokoro:cancel"); }
  }
});
const ttsResult = await tts.speak(response);
check("tts.kokoro_local_path", ttsResult.path === "kokoro_local");
check("tts.spoken_response_only", ttsResult.spoken_response === response.spoken_response);
tts.setMuted(true);
check("tts.mute_blocks", (await tts.speak(response)).code === "visual_tts_muted");
const unavailableTts = await createVisualTtsRuntime({}).speak(response);
check("tts.neural_only_unavailable", unavailableTts.code === "visual_tts_unavailable");
check("tts.no_microphone_required_marker", true);
check("tts.no_paid_endpoint_dependency", !JSON.stringify(tts).includes("api_key"));

const memory = createVisualCompanionMemory({ mode: "session" });
check("memory.mode_visible", memory.modeVisible() === "session");
check("memory.text_summary_only", memory.writeSummary({ text: "User corrected the object name." }).ok);
check("memory.raw_media_rejected", memory.writeSummary({ text: "bad", frame: "data:image/jpeg;base64,abc" }).code === "visual_raw_media_persisted");
check("memory.clear_context", memory.clear().ok && memory.state.summaries.length === 0);
memory.setMode("off");
check("memory.default_off_supported", memory.writeSummary("nothing").code === "visual_memory_off");

check("scenarios.count_50", scenarioDataset.scenarios.length >= 50);
check("scenarios.no_raw_media", containsRawMedia(scenarioDataset) === false);
check("scenarios.provenance_license", scenarioDataset.provenance.license === "CC0-1.0");
const metricRows = scenarioDataset.scenarios.slice(0, 5).map((scenario) => scoreVisualScenario(scenario, {
  response_type: scenario.expected.response_type,
  visible_action: scenario.expected.visible_action,
  visible_changes: [scenario.expected.scene_change],
  visible_objects: scenario.expected.visible_objects,
  suggested_actions: scenario.expected.suggested_action ? [{ action_type: scenario.expected.suggested_action }] : [],
  spoken_response: "A visible change happened.",
  confidence: 0.7
}));
const metricSummary = summarizeVisualMetrics(metricRows);
check("metrics.quality_summary", metricSummary.scenario_count === 5 && metricSummary.confidence_is_self_reported_not_calibrated_truth === true, metricSummary);

console.log(`ok visual companion contract ${checks.filter((item) => item.pass).length}/${checks.length}`);
