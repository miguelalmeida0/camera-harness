#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PATHS = {
  html: "packages/perception/browser-local-capture/prototype/index.html",
  js: "packages/perception/browser-local-capture/prototype/local-capture.js",
  launcher: "packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs",
  exporter: "packages/replay/live-trace-recorder/scripts/export-physical-trace.mjs",
  validator: "packages/replay/live-trace-recorder/scripts/validate-physical-trace.mjs",
  packageJson: "package.json"
};

const REQUIRED_BUTTONS = [
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
  "Copy Validation Commands"
];

const REQUIRED_PANELS = [
  "Runtime status",
  "Current step",
  "preview",
  "Calibration Panel",
  "Calibration Summary",
  "Quest State Panel",
  "Current Objective",
  "Active Zone",
  "Operator progress",
  "Last 10 Symbolic Events",
  "Confidence Panel",
  "Recording Status",
  "Privacy Status",
  "Model-Call Status",
  "Latency Panel",
  "Export & save",
  "Export Preflight",
  "Preview Export JSON",
  "Validation",
  "Troubleshooting Panel"
];

const REQUIRED_ZONES = ["phone_zone", "notebook_zone", "pen_zone", "keyboard_zone", "neutral_zone", "off_desk_zone"];
const REQUIRED_OBJECTS = ["phone", "notebook", "pen", "keyboard"];
const REQUIRED_SCRIPTS = ["physical:capture", "physical:validate", "gate:1c", "gate:1d", "gate:1f", "test:adapter", "test:recorder", "typecheck"];

const report = {
  schema: "darkquest.gate_1d_source_report.v0",
  gate: "1D",
  checks: [],
  source_check_passed: false,
  operator_check_required: true,
  final_verdict: "NOT_TRYABLE"
};

const files = {};
for (const [key, path] of Object.entries(PATHS)) {
  const fullPath = resolve(path);
  const exists = existsSync(fullPath);
  addCheck("file_exists", path, exists, exists ? "present" : "missing", "critical");
  files[key] = exists ? readFileSync(fullPath, "utf8") : "";
}

const html = files.html;
const js = files.js;
const combined = `${html}\n${js}`;
const packageJson = files.packageJson ? JSON.parse(files.packageJson) : { scripts: {} };

for (const label of REQUIRED_BUTTONS) {
  addCheck("required_button", label, includesText(html, label), `button text: ${label}`, "critical");
}

for (const panel of REQUIRED_PANELS) {
  addCheck("required_panel", panel, includesText(html, panel) || html.includes(`id="${panel}"`), `panel marker: ${panel}`, "critical");
}

for (const zone of REQUIRED_ZONES) {
  addCheck("required_zone", zone, combined.includes(zone), `zone marker: ${zone}`, "critical");
}

for (const objectName of REQUIRED_OBJECTS) {
  addCheck("required_object", objectName, combined.includes(objectName), `object marker: ${objectName}`, "critical");
}

for (const script of REQUIRED_SCRIPTS) {
  addCheck("required_script", script, typeof packageJson.scripts?.[script] === "string", `package script: ${script}`, "critical");
}

addCheck("manual_confirmation_disclosure", "manual label", /manual local confirmation/i.test(combined), "manual confirmation is visibly disclosed", "critical");
addCheck("physical_confirmation_disclosure", "operator physical checkbox", /real physical webcam session/i.test(combined), "operator physical confirmation is visible", "critical");
addCheck("privacy_status_visible", "raw media persistence status", /Raw media/i.test(html) && (/Off · Protected/.test(html) || /raw_media_persisted=false/.test(combined)), "privacy status is visible", "critical");
addCheck("model_status_visible", "LLM/VLM status", /LLM calls/i.test(html) && /VLM calls/i.test(html), "model-call status is visible", "critical");
addCheck("validation_commands_visible", "validation commands", /npm run physical:validate/.test(combined) && /replay --repeat 3/.test(combined) && /npm run gate:1c/.test(combined) && /npm run gate:1d/.test(combined), "validation commands are visible", "critical");
addCheck("preflight_function", "runExportPreflight", /function runExportPreflight/.test(js), "export preflight function exists", "critical");
addCheck("dry_run_export_shape", "dev dry-run flags", /devDryRun/.test(js) && /manual_fixture/.test(js) && /physical_capture/.test(js), "non-physical dry-run export flags exist", "critical");
addCheck("export_function", "buildReplayFixture/exportPhysicalTrace", /function exportPhysicalTrace/.test(js) && /function buildReplayFixture/.test(js), "trace export functions exist", "critical");
addCheck("trace_origin_generation", "trace_origin", /trace_origin/.test(js) && /physical_webcam_manual_calibration/.test(js), "trace_origin generation exists", "critical");
addCheck("event_creation_function", "eventSpec/emitEvents", /function eventSpec/.test(js) && /function emitEvents/.test(js), "symbolic event creation exists", "critical");
addCheck("quest_state_logic", "confirmStepInState/quest_complete", /confirmStepInState/.test(js) && /quest_complete/.test(js), "quest state transition logic exists", "critical");
addCheck("timeline_updates", "last 10 events render", /slice\(-10\)/.test(js) && /Last 10 Symbolic Events/.test(html), "symbolic timeline render exists", "critical");

const forbiddenRawExportPatterns = [
  /MediaRecorder/,
  /\.toDataURL\(/,
  /canvas\.toBlob/,
  /data:image/,
  /data:video/,
  /data:audio/,
  /readAsDataURL/,
  /getUserMedia\(\{\s*video:\s*true,\s*audio:\s*true/
];
addCheck(
  "no_obvious_raw_media_export",
  "source scan",
  !forbiddenRawExportPatterns.some((pattern) => pattern.test(combined)),
  "no obvious raw media export APIs or data URLs found",
  "critical"
);

const forbiddenModelHooks = [
  /openai/i,
  /anthropic/i,
  /model_router/i,
  /fetch\(/,
  /WebSocket/
];
addCheck(
  "no_model_call_hooks",
  "source scan",
  !forbiddenModelHooks.some((pattern) => pattern.test(js)),
  "no model-call hooks found in prototype source",
  "critical"
);

await runPrototypeFlowCheck();

const failures = report.checks.filter((check) => !check.passed);
report.source_check_passed = failures.length === 0;
report.final_verdict = failures.length === 0 ? "TRYABLE_WITH_MANUAL_CONFIRMATION" : "NOT_TRYABLE";
report.failure_count = failures.length;
report.failures = failures;

mkdirSync("runs", { recursive: true });
writeFileSync("runs/gate-1d-latest.json", `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate 1D source check`);
console.log("report: runs/gate-1d-latest.json");
console.log(`checks: ${report.checks.length - failures.length}/${report.checks.length}`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure.code}: ${failure.name}`);
}

process.exit(failures.length === 0 ? 0 : 1);

async function runPrototypeFlowCheck() {
  try {
    const mod = await import(pathToFileURL(resolve(PATHS.js)).href);
    const state = mod.createInitialState();
    state.cameraReady = true;
    state.cameraStatus = "granted";
    mod.saveCalibrationToState(state, mod.defaultCalibration());
    mod.startFocusRitualInState(state);
    mod.startRecordingInState(state);
    for (const step of ["phone", "notebook", "pen", "writing", "typing"]) mod.confirmStepInState(state, step);
    mod.stopRecordingInState(state);
    state.physicalConfirmed = true;
    const fixture = mod.buildReplayFixture(state);
    const dryRun = mod.buildReplayFixture(state, { devDryRun: true });
    const valid =
      fixture.schema === "darkquest.replay_fixture.v0" &&
      fixture.fixture_id === "live_physical_focus_ritual_001" &&
      fixture.trace_origin?.source === "browser.local_camera" &&
      fixture.trace_origin?.operator_confirmed_physical_session === true &&
      fixture.trace_origin?.raw_media_persisted === false &&
      fixture.metrics?.max_llm_calls === 0 &&
      fixture.metrics?.max_vlm_calls === 0 &&
      fixture.input_events?.length >= 6 &&
      fixture.expected?.quest_transitions?.length === 6 &&
      fixture.metrics?.browser_latency_records?.length >= 6 &&
      dryRun.fixture_id === "gate_1d_dry_run_export" &&
      dryRun.trace_origin?.manual_fixture === true &&
      dryRun.trace_origin?.physical_capture === false &&
      dryRun.trace_origin?.operator_confirmed_physical_session === false &&
      dryRun.trace_origin?.dev_dry_run === true &&
      JSON.stringify(fixture).includes("data:image") === false;
    let replayPassed = false;
    if (valid) {
      const fixturePath = "runs/gate-1d-source-fixture.v0.json";
      mkdirSync("runs", { recursive: true });
      writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
      const replay = spawnSync(process.execPath, [
        "packages/evals/bin/darkquest-eval.mjs",
        "replay",
        "--repeat",
        "3",
        fixturePath
      ], { cwd: resolve("."), encoding: "utf8" });
      replayPassed = replay.status === 0;
    }
    addCheck("prototype_flow_smoke", "manual ritual flow", valid && replayPassed, "source-level ritual flow exports Gate 1C-compatible fixture and replays 3 times", "critical");
  } catch (error) {
    addCheck("prototype_flow_smoke", "manual ritual flow", false, error?.message ?? "prototype flow failed", "critical");
  }
}

function includesText(source, text) {
  return source.replace(/\s+/g, " ").includes(text);
}

function addCheck(code, name, passed, evidence, severity) {
  report.checks.push({ code, name, passed, evidence, severity });
}
