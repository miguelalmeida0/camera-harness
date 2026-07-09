#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PATHS = {
  html: "packages/perception/browser-local-capture/prototype/index.html",
  js: "packages/perception/browser-local-capture/prototype/local-capture.js",
  launcher: "packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs",
  exporter: "packages/replay/live-trace-recorder/scripts/export-physical-trace.mjs",
  validator: "packages/replay/live-trace-recorder/scripts/validate-physical-trace.mjs",
  packageJson: "package.json",
  devValidator: "packages/evals/bin/dev-trace-validate.mjs"
};

const REQUIRED_STAGES = [
  "Camera",
  "Calibration",
  "Quest Setup",
  "Recording",
  "Complete Actions",
  "Stop Recording",
  "Export",
  "Validation"
];

const REQUIRED_CONTROLS = [
  "Start Camera",
  "Stop Camera",
  "Calibrate Zones",
  "Save Calibration",
  "Start Focus Ritual",
  "Start Recording",
  "Confirm Phone Moved",
  "Confirm Notebook Opened",
  "Confirm Pen Picked Up",
  "Confirm Writing Motion",
  "Confirm Typing Motion",
  "Mark Uncertain",
  "Mark Camera Reset",
  "Stop Recording",
  "Export Physical Trace",
  "Reset Session",
  "Copy Validation Commands",
  "Copy All Commands",
  "Copy Save Path",
  "Copy macOS Save Command",
  "Export Bug Report",
  "Copy gate:1e"
];

const REQUIRED_PANELS = [
  ["camera preview", /<video[^>]+id="preview"/i],
  ["operator mode", /Operator Mode/],
  ["operator readiness", /Current Readiness/],
  ["calibration panel", /Calibration Panel/],
  ["quest state panel", /Quest State Panel/],
  ["current objective", /Current Objective/],
  ["active zone", /Active Zone/],
  ["last 10 symbolic events", /Last 10 Symbolic Events/],
  ["confidence panel", /Confidence Panel/],
  ["recording status", /Recording Status/],
  ["privacy status", /Privacy Status/],
  ["model-call status", /Model-Call Status/],
  ["latency panel", /Latency Panel/],
  ["export status", /Export & save/],
  ["event sequence inspector", /Event Sequence Inspector/],
  ["dry-run physical separation", /Dry-Run \/ Physical Separation/],
  ["export save-path assistant", /Export Save-Path Assistant/],
  ["bug report", /Bug Report/],
  ["operator artifact checklist", /Operator Run Artifact Checklist/],
  ["what to do if stuck", /What To Do If Stuck/],
  ["validation", /id="validationCard"/],
  ["troubleshooting panel", /Troubleshooting Panel/]
];

const REQUIRED_SCRIPTS = [
  "gate:1d",
  "gate:1e",
  "gate:1f",
  "dev:trace:validate",
  "physical:capture",
  "physical:validate",
  "gate:1c",
  "test:adapter",
  "test:recorder",
  "typecheck"
];

const ALLOWED_EVIDENCE_KINDS = new Set(["human_correction", "local_signal", "derived_state"]);
const DEV_DRY_RUN_PATH = "runs/dev/gate-1d-dry-run-export.json";
const PHYSICAL_SOURCE_PATH = "runs/gate-1e-source-fixture.v0.json";
const PHYSICAL_FIXTURE_PATH = "fixtures/replay/live/live_physical_focus_ritual_001.v0.json";

const report = {
  schema: "darkquest.gate_1e_report.v0",
  gate: "1E",
  claim: "Local browser prototype has strict operator flow guards, validation UX, privacy/model visibility, and dev dry-run checks needed before a real physical trace attempt.",
  generated_at: new Date().toISOString(),
  checks: [],
  artifacts: [],
  source_readiness: "unknown",
  dev_dry_run_status: "unknown",
  physical_trace_status: "unknown",
  gate_1c_status: "BLOCKED_UNCHECKED",
  final_verdict: "FAIL"
};

const files = {};
for (const [key, path] of Object.entries(PATHS)) {
  const fullPath = resolve(path);
  const exists = existsSync(fullPath);
  addCheck("source_files", "file_exists", path, exists, exists ? "present" : "missing", "critical");
  files[key] = exists && key !== "physicalFixture" ? readFileSync(fullPath, "utf8") : "";
}

const html = files.html;
const js = files.js;
const combined = `${html}\n${js}`;
const packageJson = files.packageJson ? JSON.parse(files.packageJson) : { scripts: {} };

for (const label of REQUIRED_CONTROLS) {
  addCheck("controls", "required_control", label, includesText(html, label), `control text: ${label}`, "critical");
}

for (const [label, pattern] of REQUIRED_PANELS) {
  addCheck("panels", "required_panel", label, pattern.test(html), `panel marker: ${label}`, "critical");
}

for (const script of REQUIRED_SCRIPTS) {
  addCheck("source_files", "required_script", script, typeof packageJson.scripts?.[script] === "string", `package script: ${script}`, "critical");
}

addCheck("wizard", "wizard_stage_source", "wizardStagesForState", /wizardStagesForState/.test(js), "wizard state function exists", "critical");
addCheck("wizard", "next_step_guidance", "Next action guidance", /function nextStepText/.test(js) && /objectiveForQuestState/.test(js), "next-step guidance is rendered", "critical");
addCheck("wizard", "disabled_reason_text", "disabled because", /disabled because/.test(js), "disabled reason strings exist", "critical");
addCheck("wizard", "error_banner", "error banner", /class="error"/.test(js) && /errorMessage/.test(js), "error banner renders state.errorMessage", "critical");
addCheck("wizard", "troubleshooting_panel", "troubleshooting", /Troubleshooting Panel/.test(html) && /function troubleshootingText/.test(js), "troubleshooting panel and text generator exist", "critical");

addCheck("privacy_model", "raw_media_visible_false", "raw media status", /Raw media/.test(html) && /Off · Protected/.test(html), "raw media persistence is visible and false", "critical");
addCheck("privacy_model", "cloud_fallback_disabled", "cloud fallback status", /Cloud fallback/.test(html) && />Disabled</.test(html), "cloud fallback is visible and disabled", "critical");
addCheck("privacy_model", "llm_visible_zero", "LLM status", /LLM calls/.test(html) && /id="llm">0/.test(html), "LLM calls are visible and zero", "critical");
addCheck("privacy_model", "vlm_visible_zero", "VLM status", /VLM calls/.test(html) && /id="vlm">0/.test(html), "VLM calls are visible and zero", "critical");
addCheck("privacy_model", "cost_visible_zero", "model cost status", />Cost</.test(html) && /id="cost">\$0/.test(html), "model cost is visible and zero", "critical");
addCheck("privacy_model", "no_model_hooks", "prototype source scan", noModelHooks(js), "no model-call hooks in prototype source", "critical");
addCheck("privacy_model", "no_raw_media_export_hooks", "prototype source scan", noRawMediaExportHooks(combined), "no raw media export APIs in prototype source", "critical");

addCheck("export_preflight", "export_preflight_source", "exportDisabledReason/updateExportReadiness", /function exportDisabledReason/.test(js) && /function updateExportReadiness/.test(js), "export preflight functions exist", "critical");
addCheck("export_preflight", "physical_confirmation_checkbox", "confirmPhysical", /id="confirmPhysical"/.test(html) && /real physical webcam session/.test(html), "physical confirmation checkbox exists", "critical");
addCheck("export_preflight", "trace_origin_source", "trace_origin", /trace_origin/.test(js) && /browser-local-capture/.test(js), "trace_origin generation exists", "critical");
addCheck("export_preflight", "latency_records_source", "browser latency records", /browser_latency_records/.test(js) && /latencyRecordFor/.test(js), "browser latency records are generated", "critical");
addCheck("export_preflight", "validation_commands_after_export", "validation commands", /validationCommands\.hidden = !state\.exported/.test(js) && /npm run physical:validate/.test(combined), "validation commands are shown after export", "critical");
addCheck("operator_mode", "operator_readiness_states", "Operator Mode readiness", /TRACE_EXPORT_READY/.test(js) && /NEEDS_CAMERA/.test(js) && /READY_TO_VALIDATE/.test(js), "operator readiness states exist", "critical");
addCheck("operator_mode", "save_path_assistant", "save path assistant", combined.includes(PHYSICAL_FIXTURE_PATH) && /Copy Save Path/.test(html) && /Downloads/.test(combined), "save-path assistant exists", "critical");
addCheck("operator_mode", "bug_report_export", "bug report export", /buildOperatorBugReport/.test(js) && /darkquest_operator_bug_report\.json/.test(combined), "operator bug report export exists", "critical");
addCheck("operator_mode", "event_sequence_inspector", "event sequence inspector", /inspectEventSequence/.test(js) && /quest_complete/.test(js), "event sequence inspector exists", "critical");
addCheck("operator_mode", "stuck_guide_cases", "stuck guide", /Camera does not start/.test(js) && /physical:validate says wrong provenance/.test(js) && /port 4177 is unavailable/.test(js), "stuck guide covers operator failures", "critical");

addCheck("manual_confirmation", "manual_label", "manual local confirmation label", /Manual local confirmation - not automatic vision/i.test(html), "manual confirmation is visibly disclosed", "critical");
addCheck("manual_confirmation", "manual_not_autonomous_vision", "automatic vision wording", !/(autonomous vision (enabled|active|ready|confirmed|proved)|automatically detected|automatic vision confirmed)/i.test(combined), "manual path is not mislabeled as autonomous vision", "critical");
addCheck("manual_confirmation", "manual_evidence_kind_source", "allowed evidence kinds", /human_correction/.test(js) && /contains_raw_media:\s*false/.test(js), "manual evidence is human_correction and raw-media-free", "critical");

await runPrototypeGateChecks();
checkPhysicalFixtureIfPresent();

const failures = report.checks.filter((check) => !check.passed);
const sourceBlockingFailures = failures.filter((check) => ["source_files", "wizard", "controls", "panels"].includes(check.category));
report.source_readiness = sourceBlockingFailures.length === 0 ? "PASS" : "FAIL";
report.failure_count = failures.length;
report.failures = failures;

if (failures.length > 0) {
  report.final_verdict = sourceBlockingFailures.length > 0 ? "NOT_TRYABLE" : "FAIL";
} else if (report.physical_trace_status === "valid") {
  report.final_verdict = "PHYSICAL_TRACE_READY_FOR_GATE_1C";
} else {
  report.final_verdict = "TRACE_EXPORT_READY";
}

mkdirSync("runs", { recursive: true });
writeFileSync("runs/gate-1e-latest.json", `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate 1E readiness check`);
console.log("report: runs/gate-1e-latest.json");
console.log(`checks: ${report.checks.length - failures.length}/${report.checks.length}`);
console.log(`physical trace: ${report.physical_trace_status}`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
}

process.exit(failures.length === 0 ? 0 : 1);

async function runPrototypeGateChecks() {
  try {
    const mod = await import(pathToFileURL(resolve(PATHS.js)).href);
    const stageNames = mod.wizardStagesForState(mod.createInitialState()).map((stage) => stage.name);
    addCheck("wizard", "wizard_stage_count", "8 wizard stages", stageNames.length === 8, `stages: ${stageNames.join(", ")}`, "critical");
    for (const stageName of REQUIRED_STAGES) {
      addCheck("wizard", "wizard_stage_name", stageName, stageNames.includes(stageName), `stage: ${stageName}`, "critical");
    }

    const incomplete = prepareStartedState(mod);
    mod.stopRecordingInState(incomplete);
    incomplete.physicalConfirmed = true;
    const incompleteGuard = mod.getButtonGuards(incomplete).exportTrace;
    addCheck("export_preflight", "export_blocks_incomplete_ritual", "incomplete ritual", incompleteGuard.enabled === false, incompleteGuard.reason, "critical");

    const noConfirmation = prepareCompleteState(mod, { physicalConfirmed: false });
    const noConfirmationGuard = mod.getButtonGuards(noConfirmation).exportTrace;
    let defaultExportBlocked = false;
    try {
      mod.buildReplayFixture(noConfirmation);
    } catch {
      defaultExportBlocked = true;
    }
    addCheck("export_preflight", "export_blocks_without_confirmation", "physical confirmation", noConfirmationGuard.enabled === false && defaultExportBlocked, noConfirmationGuard.reason, "critical");

    const physicalState = prepareCompleteState(mod, { physicalConfirmed: true });
    const physicalFixture = mod.buildReplayFixture(physicalState);
    const physicalFixtureValid = validatePhysicalSourceFixture(physicalFixture);
    writeArtifact(PHYSICAL_SOURCE_PATH, physicalFixture);
    const sourceReplayPassed = runReplay(PHYSICAL_SOURCE_PATH);
    addCheck("export_preflight", "physical_source_fixture_replays", "source-generated physical fixture", physicalFixtureValid && sourceReplayPassed, "source fixture replays 3 times", "critical");

    const devState = prepareCompleteState(mod, { physicalConfirmed: false });
    const devFixture = mod.buildReplayFixture(devState, { devDryRun: true });
    const devFixtureValid = validateDevDryRunFixture(devFixture);
    writeArtifact(DEV_DRY_RUN_PATH, devFixture);
    report.artifacts.push(DEV_DRY_RUN_PATH);
    const devReplayPassed = runReplay(DEV_DRY_RUN_PATH);
    addCheck("dev_dry_run", "dev_dry_run_fixture_replays", "dev dry-run fixture", devFixtureValid && devReplayPassed, "dev dry-run fixture is replay-compatible", "critical");

    const devValidation = spawnSync(process.execPath, [PATHS.devValidator, DEV_DRY_RUN_PATH], {
      cwd: resolve("."),
      encoding: "utf8"
    });
    addCheck("dev_dry_run", "dev_trace_validator_passes", "npm run dev:trace:validate target", devValidation.status === 0, (devValidation.stdout || devValidation.stderr || "").trim(), "critical");

    const physicalRejectsDev = spawnSync(process.execPath, [PATHS.validator, DEV_DRY_RUN_PATH], {
      cwd: resolve("."),
      encoding: "utf8"
    });
    addCheck("dev_dry_run", "physical_validator_rejects_dev_dry_run", "cannot satisfy Gate 1C", physicalRejectsDev.status !== 0, (physicalRejectsDev.stdout || physicalRejectsDev.stderr || "").trim(), "critical");
    report.dev_dry_run_status = devFixtureValid && devReplayPassed && devValidation.status === 0 && physicalRejectsDev.status !== 0 ? "valid_non_physical" : "failed";
  } catch (error) {
    addCheck("dev_dry_run", "prototype_flow_exception", "prototype flow", false, error?.stack ?? error?.message ?? "prototype flow failed", "critical");
    report.dev_dry_run_status = "failed";
  }
}

function prepareStartedState(mod) {
  const state = mod.createInitialState();
  state.cameraReady = true;
  state.cameraStatus = "granted";
  mod.saveCalibrationToState(state, mod.defaultCalibration());
  mod.startFocusRitualInState(state);
  mod.startRecordingInState(state);
  mod.confirmStepInState(state, "phone");
  return state;
}

function prepareCompleteState(mod, options = {}) {
  const state = mod.createInitialState();
  state.cameraReady = true;
  state.cameraStatus = "granted";
  mod.saveCalibrationToState(state, mod.defaultCalibration());
  mod.startFocusRitualInState(state);
  mod.startRecordingInState(state);
  for (const step of ["phone", "notebook", "pen", "writing", "typing"]) mod.confirmStepInState(state, step);
  mod.stopRecordingInState(state);
  state.physicalConfirmed = options.physicalConfirmed === true;
  mod.getButtonGuards(state);
  return state;
}

function validatePhysicalSourceFixture(fixture) {
  const origin = fixture.trace_origin ?? {};
  return fixture.schema === "darkquest.replay_fixture.v0" &&
    fixture.fixture_id === "live_physical_focus_ritual_001" &&
    origin.source === "browser.local_camera" &&
    origin.dev_dry_run === false &&
    origin.manual_fixture === false &&
    origin.physical_capture === true &&
    origin.operator_confirmed_physical_session === true &&
    origin.generated_by === "browser-local-capture" &&
    origin.capture_mode === "physical_webcam_manual_calibration" &&
    Array.isArray(fixture.metrics?.browser_latency_records) &&
    fixture.metrics.browser_latency_records.length >= 6 &&
    fixture.expected?.model_calls?.length === 0 &&
    fixture.expected?.memory_writes?.length === 0 &&
    fixture.metrics?.max_llm_calls === 0 &&
    fixture.metrics?.max_vlm_calls === 0 &&
    fixture.metrics?.max_cost_usd === 0 &&
    evidenceAllowed(fixture.input_events ?? []) &&
    !containsForbiddenRawMedia(fixture);
}

function validateDevDryRunFixture(fixture) {
  const origin = fixture.trace_origin ?? {};
  return fixture.schema === "darkquest.replay_fixture.v0" &&
    fixture.fixture_id === "gate_1d_dry_run_export" &&
    origin.source === "browser.local_camera" &&
    origin.dev_dry_run === true &&
    origin.manual_fixture === true &&
    origin.physical_capture === false &&
    origin.operator_confirmed_physical_session === false &&
    origin.capture_mode === "dev_dry_run_manual_confirmation" &&
    Array.isArray(fixture.input_events) &&
    fixture.input_events.length >= 6 &&
    Array.isArray(fixture.metrics?.browser_latency_records) &&
    fixture.metrics.browser_latency_records.length >= 6 &&
    fixture.expected?.model_calls?.length === 0 &&
    fixture.expected?.memory_writes?.length === 0 &&
    fixture.metrics?.max_llm_calls === 0 &&
    fixture.metrics?.max_vlm_calls === 0 &&
    fixture.metrics?.max_cost_usd === 0 &&
    evidenceAllowed(fixture.input_events ?? []) &&
    !containsForbiddenRawMedia(fixture);
}

function checkPhysicalFixtureIfPresent() {
  if (!existsSync(resolve(PHYSICAL_FIXTURE_PATH))) {
    report.physical_trace_status = "missing";
    report.gate_1c_status = "BLOCKED_MISSING_PHYSICAL_TRACE";
    addCheck("physical_trace", "physical_fixture_missing_expected", PHYSICAL_FIXTURE_PATH, true, "physical fixture is missing; Gate 1C remains blocked", "info");
    return;
  }

  const validation = spawnSync(process.execPath, [PATHS.validator, PHYSICAL_FIXTURE_PATH], {
    cwd: resolve("."),
    encoding: "utf8"
  });
  report.physical_trace_status = validation.status === 0 ? "valid" : "invalid";
  report.gate_1c_status = validation.status === 0 ? "READY_FOR_GATE_1C" : "FAIL";
  addCheck("physical_trace", "physical_fixture_if_present_validates", PHYSICAL_FIXTURE_PATH, validation.status === 0, (validation.stdout || validation.stderr || "").trim(), "critical");
}

function runReplay(path) {
  const replay = spawnSync(process.execPath, [
    "packages/evals/bin/darkquest-eval.mjs",
    "replay",
    "--repeat",
    "3",
    path
  ], {
    cwd: resolve("."),
    encoding: "utf8"
  });
  return replay.status === 0;
}

function writeArtifact(path, value) {
  const outputPath = resolve(path);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function evidenceAllowed(events) {
  return events.every((event) =>
    Array.isArray(event.evidence) &&
    event.evidence.length > 0 &&
    event.evidence.every((item) => ALLOWED_EVIDENCE_KINDS.has(item.kind) && item.contains_raw_media === false)
  );
}

function noModelHooks(source) {
  return ![
    /openai/i,
    /anthropic/i,
    /model_router/i,
    /fetch\(/,
    /WebSocket/
  ].some((pattern) => pattern.test(source));
}

function noRawMediaExportHooks(source) {
  return ![
    /MediaRecorder/,
    /\.toDataURL\(/,
    /canvas\.toBlob/,
    /data:image/,
    /data:video/,
    /data:audio/,
    /readAsDataURL/,
    /getUserMedia\(\{\s*video:\s*true,\s*audio:\s*true/
  ].some((pattern) => pattern.test(source));
}

function containsForbiddenRawMedia(value, path = "$") {
  if (path === "$.forbidden" || path.startsWith("$.forbidden.")) return false;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    return /^data:(image|audio|video)\//.test(lowered) ||
      lowered.includes("base64") ||
      lowered.includes("raw_frame") ||
      lowered.includes("raw_video") ||
      lowered.includes("raw_audio") ||
      lowered.includes("screenshot") ||
      lowered.includes("ocr") ||
      lowered.includes("notebook_text") ||
      /\.(png|jpe?g|webp|gif|mp4|mov|webm|wav|mp3)$/i.test(value);
  }
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((child, index) => containsForbiddenRawMedia(child, `${path}[${index}]`));
  return Object.entries(value).some(([key, child]) => {
    if (child === false && [
      "raw_media_persisted",
      "raw_video_persisted",
      "raw_audio_persisted",
      "raw_frame_persisted",
      "contains_raw_media",
      "contains_raw_video",
      "contains_audio",
      "contains_raw_frames",
      "contains_screenshots"
    ].includes(key)) {
      return false;
    }
    return containsForbiddenRawMedia(key, `${path}.${key}`) || containsForbiddenRawMedia(child, `${path}.${key}`);
  });
}

function includesText(source, text) {
  return source.replace(/\s+/g, " ").includes(text);
}

function addCheck(category, code, name, passed, evidence, severity) {
  report.checks.push({ category, code, name, passed, evidence, severity });
}
