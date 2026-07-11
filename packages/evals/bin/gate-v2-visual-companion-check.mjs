#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  applyContextualResponsePolicy,
  containsRawMedia,
  createMockVisualCompanionProvider,
  createVisualCompanionMemory,
  createVisualObservationWindow,
  createVisualTtsRuntime,
  normalizeContextualVisualResponse,
  scoreVisualScenario,
  suggestedActionsRequireConfirmation,
  summarizeVisualMetrics,
  validateContextualVisualResponse,
  validateVisualObservationWindow,
  validateVisualProviderContract,
  withObservationFrameCleanup
} from "../../../services/visual-companion/index.mjs";
import {
  visualCompanionObserveResponseForRequest,
  visualCompanionStaticHealth
} from "../../perception/browser-local-capture/server/visual-companion-provider.mjs";

const REPORT_PATH = resolve("runs/gate-v2-visual-companion-latest.json");
const BENCHMARK_PATH = resolve("runs/visual-model-benchmark-latest.json");
const PHYSICAL_PATH = resolve("runs/darkquest-v2-physical-visual-companion-latest.json");

const checks = [];
const disclosures = [];
const failures = [];

function record(name, pass, evidence = {}) {
  const item = { name, pass: Boolean(pass), evidence };
  checks.push(item);
  if (!item.pass) failures.push(item);
  return item.pass;
}

function disclose(name, pass, evidence = {}) {
  const item = { name, pass: Boolean(pass), evidence };
  checks.push(item);
  if (!item.pass) disclosures.push(item);
  return item.pass;
}

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const html = readFileSync(resolve("packages/perception/browser-local-capture/prototype/index.html"), "utf8");
const source = readFileSync(resolve("packages/perception/browser-local-capture/prototype/local-capture.js"), "utf8");
const scenarioDataset = JSON.parse(readFileSync(resolve("fixtures/visual-companion/scenarios/initial_scenarios.v1.json"), "utf8"));

record("scripts.visual_test_present", String(packageJson.scripts?.["visual:test"] || "").includes("services/visual-companion/test/visual-companion-contract.test.mjs") && String(packageJson.scripts?.["visual:test"] || "").includes("packages/perception/browser-local-capture/test/visual-companion.test.mjs"));
record("scripts.test_visual_companion_present", packageJson.scripts?.["test:visual-companion"] === "node packages/perception/browser-local-capture/test/visual-companion.test.mjs");
record("scripts.benchmark_visual_models_present", packageJson.scripts?.["benchmark:visual-models"] === "node services/visual-companion/bin/benchmark-visual-models.mjs");
record("scripts.gate_v2_present", packageJson.scripts?.["gate:v2:visual-companion"] === "node packages/evals/bin/gate-v2-visual-companion-check.mjs");

const provider = createMockVisualCompanionProvider();
const providerContract = await validateVisualProviderContract(provider, {
  window: createVisualObservationWindow({
    frames: [
      { timestamp_ms: 1, width: 640, height: 480, byte_length: 1000 },
      { timestamp_ms: 2, width: 640, height: 480, byte_length: 1000 }
    ]
  })
});
record("provider.contract_executable", providerContract.ok, providerContract.failures);
record("provider.no_paid_endpoint_dependency", provider.paid_endpoint_dependency === false);
record("provider.revision_pinned", !/latest/i.test(String(provider.revision || "")));
record("provider.license_metadata", Boolean(provider.license));
const runtimeHealth = visualCompanionStaticHealth({});
record("provider.actual_runtime_health_safe", runtimeHealth.ok === true && runtimeHealth.token_exposed_to_frontend === false && runtimeHealth.contains_raw_media === false, runtimeHealth);
const runtimeObserve = await visualCompanionObserveResponseForRequest({
  frames: [
    { mime_type: "image/jpeg", encoded_frame: "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==", captured_at_ms: 10, width: 1, height: 1 },
    { mime_type: "image/jpeg", encoded_frame: "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==", captured_at_ms: 410, width: 1, height: 1 }
  ],
  previous_context: {},
  client_scene_change_score: 0.8,
  requested_response_mode: "auto",
  memory_mode: "session"
}, {}, {
  mockResult: {
    response_type: "narrate",
    observation_summary: "A small object moved upward.",
    spoken_response: "You raised the object.",
    confidence: 0.74,
    evidence: ["synthetic runtime fixture"],
    suggested_actions: []
  }
});
record("provider.actual_runtime_observe_path", runtimeObserve.status === 200 && runtimeObserve.json.contains_raw_media === false, runtimeObserve.json);

const observationWindow = createVisualObservationWindow({
  cameraActive: true,
  documentVisible: true,
  frames: [
    { timestamp_ms: 10, width: 640, height: 480, byte_length: 1100 },
    { timestamp_ms: 40, width: 640, height: 480, byte_length: 1120 },
    { timestamp_ms: 90, width: 640, height: 480, byte_length: 1110 }
  ]
});
record("observation.window_valid", validateVisualObservationWindow(observationWindow).ok);
record("observation.hidden_tab_blocked", createVisualObservationWindow({ documentVisible: false }).blocked_reason === "visual_hidden_tab_blocked");
record("observation.camera_off_blocked", createVisualObservationWindow({ cameraActive: false }).blocked_reason === "visual_camera_off_blocked");
record("observation.double_click_blocked", createVisualObservationWindow({ requestInFlight: true }).blocked_reason === "visual_one_request_in_flight");
const cleanupBuffer = [{ data_uri: "data:image/jpeg;base64,abc" }];
await withObservationFrameCleanup(cleanupBuffer, async () => undefined);
record("observation.frames_cleared_finally", cleanupBuffer.length === 0);
record("observation.no_raw_media", !containsRawMedia(observationWindow));

const normalizedResponse = normalizeContextualVisualResponse({
  observation: "object raised",
  scene_before: "object on desk",
  scene_after: "object held up",
  visible_changes: ["object moved upward"],
  visible_objects: ["object", "hand"],
  visible_action: "raise_object",
  response_type: "assist",
  spoken_response: "You raised the object.",
  confidence: 0.81,
  uncertainty: "",
  safety_flags: [],
  suggested_actions: [{ action_type: "start_timer", label: "Start timer", execute: true, requires_confirmation: false }]
});
record("response.schema_valid", validateContextualVisualResponse(normalizedResponse).ok);
record("response.actions_confirmation_required", suggestedActionsRequireConfirmation(normalizedResponse));
record("policy.assist_allowlisted", applyContextualResponsePolicy(normalizedResponse).response_type === "assist");
record("policy.model_cannot_force_execution", applyContextualResponsePolicy(normalizedResponse).suggested_actions.every((action) => action.execute === false));
record("policy.uncertainty_visible", applyContextualResponsePolicy({ ...normalizedResponse, confidence: 0.1, uncertainty: "conflicting evidence" }).response_type === "uncertain");
record("policy.silence_no_change", applyContextualResponsePolicy({ ...normalizedResponse, visible_changes: [] }).response_type === "silence");

for (const [name, unsafe] of Object.entries({
  visual_identity_inference: { ...normalizedResponse, spoken_response: "This is Alex." },
  visual_sensitive_attribute_inference: { ...normalizedResponse, spoken_response: "The person appears disabled." },
  visual_emotion_overclaim: { ...normalizedResponse, spoken_response: "The person is angry." },
  visual_private_text_exposure: { ...normalizedResponse, spoken_response: "The document says private text." },
  visual_unsafe_action: { ...normalizedResponse, suggested_actions: [{ action_type: "shell_command", label: "Run" }] },
  visual_uncertainty_hidden: { ...normalizedResponse, response_type: "uncertain", uncertainty: "" }
})) {
  const validation = validateContextualVisualResponse(normalizeContextualVisualResponse(unsafe));
  record(`safety.${name}`, validation.failures.includes(name), validation.failures);
}
record("safety.raw_media_rejected", validateContextualVisualResponse({ ...normalizedResponse, image: "data:image/jpeg;base64,abc" }).failures.includes("visual_raw_media_persisted"));

const kokoroCalls = [];
const tts = createVisualTtsRuntime({
  kokoro: {
    async synthesize(text) { kokoroCalls.push(text); },
    cancel() {}
  }
});
record("tts.kokoro_local_path", (await tts.speak(normalizedResponse)).path === "kokoro_local");
record("tts.speaks_spoken_response_only", kokoroCalls[0] === normalizedResponse.spoken_response);
tts.setMuted(true);
record("tts.mute_works", (await tts.speak(normalizedResponse)).code === "visual_tts_muted");
record("tts.no_paid_endpoint", !JSON.stringify(tts).includes("api_key"));

const memory = createVisualCompanionMemory({ mode: "session" });
record("memory.mode_visible", memory.modeVisible() === "session");
record("memory.text_only", memory.writeSummary("safe text summary").ok);
record("memory.raw_media_rejected", memory.writeSummary({ text: "bad", frame: "data:image/jpeg;base64,abc" }).code === "visual_raw_media_persisted");
record("memory.clear_context", memory.clear().ok && memory.state.summaries.length === 0);

record("scenarios.dataset_50", scenarioDataset.scenarios.length >= 50, { count: scenarioDataset.scenarios.length });
record("scenarios.no_raw_media", !containsRawMedia(scenarioDataset));
record("scenarios.provenance_license", scenarioDataset.provenance?.license === "CC0-1.0");
const metricRows = scenarioDataset.scenarios.slice(0, 10).map((scenario) => scoreVisualScenario(scenario, {
  response_type: scenario.expected.response_type,
  visible_action: scenario.expected.visible_action,
  visible_changes: [scenario.expected.scene_change],
  visible_objects: scenario.expected.visible_objects,
  suggested_actions: scenario.expected.suggested_action ? [{ action_type: scenario.expected.suggested_action }] : [],
  spoken_response: "A visible change happened.",
  confidence: 0.72
}));
const metricSummary = summarizeVisualMetrics(metricRows);
record("metrics.quality_metrics_present", metricSummary.scenario_count === 10 && metricSummary.confidence_is_self_reported_not_calibrated_truth === true, metricSummary);

const mainHtml = html.slice(0, html.indexOf('id="developerTools"') > 0 ? html.indexOf('id="developerTools"') : html.length);
disclose("ui.current_default_is_v1_not_v2", mainHtml.includes("Observe now") && mainHtml.includes("Contextual response"), {
  found_movement_narrator: mainHtml.includes("AI Movement Narrator"),
  found_describe_button: mainHtml.includes("Describe my next movement")
});
record("ui.big_response_not_truncated_marker", html.includes(".dq-movement-sentence") && html.includes("text-overflow: clip") && html.includes("white-space: normal") && html.includes("overflow-wrap: anywhere"));
record("ui.advanced_tools_collapsed", /<details[^>]*id="developerTools"/.test(html));
record("ui.no_old_gate_primary", !mainHtml.includes("Gate 4A") && !mainHtml.includes("JSON fixture") && !mainHtml.includes("trace campaign"));
record("ui.no_token_frontend", !/process\.env\.HF_TOKEN|Authorization:\s*`Bearer|hf_[A-Za-z0-9]{12,}/.test(source));

const benchmark = existsSync(BENCHMARK_PATH) ? JSON.parse(readFileSync(BENCHMARK_PATH, "utf8")) : null;
const realModelTested = benchmark?.models?.some?.((model) => model.status === "tested" && model.evidence_level === "real_model");
record("benchmark.artifact_present", Boolean(benchmark));
disclose("benchmark.real_open_source_model_tested", Boolean(realModelTested), { path: BENCHMARK_PATH });

const physical = existsSync(PHYSICAL_PATH) ? JSON.parse(readFileSync(PHYSICAL_PATH, "utf8")) : null;
const physicalValid = physical?.schema === "darkquest.v2_physical_visual_companion_evidence.v1" &&
  physical?.retained_media === false &&
  Array.isArray(physical?.tests) &&
  physical.tests.length >= 10;
disclose("physical.symbolic_evidence_present", Boolean(physicalValid), { path: PHYSICAL_PATH });

const passCount = checks.filter((item) => item.pass).length;
const totalCount = checks.length;
const criticalFailures = failures.filter((item) => !["benchmark.artifact_present"].includes(item.name));
let verdict = "PASS";
if (!providerContract.ok) verdict = "BLOCKED_MISSING_VISUAL_PROVIDER";
else if (!realModelTested) verdict = "BLOCKED_MISSING_REAL_MODEL";
else if (!physicalValid) verdict = "BLOCKED_MISSING_PHYSICAL_EVIDENCE";
else if (criticalFailures.length) verdict = "FAIL";
else if (disclosures.length) verdict = "PASS_WITH_DISCLOSURE";

const report = {
  schema: "darkquest.v2_visual_companion_gate_report.v1",
  created_at: new Date().toISOString(),
  verdict,
  passed: passCount,
  total: totalCount,
  checks,
  disclosures,
  failures: criticalFailures,
  evidence_levels: {
    contract_unit: providerContract.ok && validateVisualObservationWindow(observationWindow).ok,
    mock_integration: true,
    real_model: Boolean(realModelTested),
    physical_webcam: Boolean(physicalValid)
  }
};

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Gate v2 visual companion: ${verdict}`);
console.log(`${passCount}/${totalCount} checks passed`);
console.log(`report=${REPORT_PATH}`);
if (disclosures.length) console.log(`disclosures=${disclosures.map((item) => item.name).join(",")}`);
if (criticalFailures.length) console.log(`failures=${criticalFailures.map((item) => item.name).join(",")}`);

if (!["PASS", "PASS_WITH_DISCLOSURE"].includes(verdict)) process.exitCode = 1;
