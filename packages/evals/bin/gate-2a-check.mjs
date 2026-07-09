#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PATHS = {
  html: "packages/perception/browser-local-capture/prototype/index.html",
  js: "packages/perception/browser-local-capture/prototype/local-capture.js",
  prototypeTest: "packages/perception/browser-local-capture/test/prototype-flow.test.mjs",
  packageJson: "package.json",
  approval: "docs/evals/minimal-hud-polish-approval.md"
};

const PHYSICAL_TRACE_PATH = "fixtures/replay/live/live_physical_focus_ritual_001.v0.json";
const FORBIDDEN_CLAIMS = [
  "autonomous vision works",
  "ai automatically detects everything",
  "production ready",
  "portfolio ready",
  "cinematic demo ready",
  "real object detection proven",
  "gesture recognition proven",
  "cloud vision enabled",
  "vlm intelligence",
  "model-powered perception"
];
const RAW_MEDIA_HOOKS = [
  /MediaRecorder/,
  /\.toDataURL\s*\(/,
  /\.toBlob\s*\(/,
  /getImageData\s*\(/,
  /createImageBitmap\s*\(/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /navigator\.sendBeacon/,
  /XMLHttpRequest/,
  /fetch\s*\(/,
  /WebSocket/,
  /data:image/i,
  /data:video/i,
  /data:audio/i
];
const MODEL_CALL_HOOKS = [
  /api\.openai/i,
  /OPENAI_API_KEY/,
  /sk-proj/,
  /chat\.completions/i,
  /responses\.create/i,
  /model_router\.route/i,
  /cloud_vision_request/i
];
const FORBIDDEN_BUG_REPORT_MARKERS = [
  /raw_frame/i,
  /raw_video/i,
  /raw_audio/i,
  /base64/i,
  /data:image/i,
  /data:video/i,
  /data:audio/i,
  /screenshot/i,
  /ocr/i,
  /notebook_text/i,
  /api[_-]?key/i,
  /model_response/i,
  /cloud_evidence/i
];

const report = {
  schema: "darkquest.gate_2a_report.v0",
  gate: "2A",
  claim: "Minimal HUD polish is allowed only when polished visual state remains backed by state/event/evidence, manual confirmation remains disclosed, privacy/model status remains visible, and no cinematic, demo, autonomous, model-powered, or production claim is introduced.",
  generated_at: new Date().toISOString(),
  gate_1c_status: "UNKNOWN",
  waiver_status: "UNKNOWN",
  checks: [],
  artifacts: [],
  final_verdict: "FAIL"
};

const files = {};
for (const [key, path] of Object.entries(PATHS)) {
  const exists = existsSync(resolve(path));
  addCheck("source", "file_exists", path, exists, exists ? "present" : "missing", "critical");
  files[key] = exists ? readFileSync(resolve(path), "utf8") : "";
}

const html = files.html;
const js = files.js;
const appSource = `${html}\n${js}`;
const combined = Object.values(files).join("\n");
const packageJson = files.packageJson ? JSON.parse(files.packageJson) : { scripts: {} };

checkPackageScripts();
checkGate1C();
checkApprovalDisclosure();
checkStateBackedSurfaces();
checkManualConfirmationDisclosure();
checkPrivacyModelVisibility();
checkExportValidationUX();
checkUncertaintyConfidenceVisibility();
checkBugReportSource();
checkForbiddenClaimScan();
await checkRuntimeBehavior();

const failures = report.checks.filter((check) => !check.passed && check.severity !== "info");
report.failure_count = failures.length;
report.failures = failures;
if (!["PASS", "PASS_WITH_DISCLOSURE"].includes(report.gate_1c_status)) {
  report.final_verdict = "BLOCKED_GATE_1C";
} else if (failures.length) {
  report.final_verdict = "FAIL";
} else if (report.gate_1c_status === "PASS_WITH_DISCLOSURE" || report.waiver_status === "accepted") {
  report.final_verdict = "PASS_WITH_DISCLOSURE";
} else {
  report.final_verdict = "PASS";
}

mkdirSync("runs", { recursive: true });
writeFileSync("runs/gate-2a-latest.json", `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate 2A minimal state-backed HUD polish check`);
console.log("report: runs/gate-2a-latest.json");
console.log(`checks: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}`);
console.log(`gate_1c_status: ${report.gate_1c_status}`);
console.log(`waiver_status: ${report.waiver_status}`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
}

process.exit(report.final_verdict === "FAIL" || report.final_verdict === "BLOCKED_GATE_1C" ? 1 : 0);

function checkPackageScripts() {
  requireScript("gate:2a");
  addCheck("source", "typecheck_includes_gate_2a", "typecheck includes gate-2a-check.mjs", packageJson.scripts?.typecheck?.includes("gate-2a-check.mjs") === true, "node --check packages/evals/bin/gate-2a-check.mjs", "critical");
}

function checkGate1C() {
  const result = spawnSync("npm", ["run", "gate:1c"], {
    cwd: resolve("."),
    encoding: "utf8"
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (/PASS_WITH_DISCLOSURE/.test(output)) report.gate_1c_status = "PASS_WITH_DISCLOSURE";
  else if (/\bPASS\b/.test(output)) report.gate_1c_status = "PASS";
  else if (/BLOCKED/.test(output)) report.gate_1c_status = "BLOCKED";
  else report.gate_1c_status = "FAIL";
  addCheck("gate_dependency", "gate_1c_pass_or_disclosure", "Gate 1C is PASS or PASS_WITH_DISCLOSURE", ["PASS", "PASS_WITH_DISCLOSURE"].includes(report.gate_1c_status), compactOutput(output), "critical");
}

function checkApprovalDisclosure() {
  report.waiver_status = /waiver:\s*accepted|static waiver.*accepted|static validation.*waived/i.test(combined) ? "accepted" : "missing";
  requireText("disclosure", "static_waiver_visible", "Static waiver disclosure");
  requireText("disclosure", "pass_with_disclosure_visible", "PASS_WITH_DISCLOSURE");
  requireText("disclosure", "minimal_polish_scope", "minimal state-backed HUD polish: approved_with_disclosure");
}

function checkStateBackedSurfaces() {
  const statusIds = [
    "topStatusBar",
    "statusCamera",
    "statusCalibration",
    "statusQuest",
    "statusRecording",
    "statusExport",
    "statusValidation",
    "statusPrivacy",
    "statusModels",
    "statusModelCost"
  ];
  for (const id of statusIds) requireText("state_backed_ui", `status_id_${id}`, `id="${id}"`);
  requirePattern("state_backed_ui", "top_status_state_helper", /export function topStatusForState/, js);
  requirePattern("state_backed_ui", "top_status_uses_helper", /const status = topStatusForState\(target\)/, js);
  rejectPattern("state_backed_ui", "no_constant_camera_ready", /\?\s*"Ready"\s*:\s*"Ready"/, js);
  rejectPattern("state_backed_ui", "no_constant_calibrated", /\?\s*"Calibrated"\s*:\s*"Calibrated"/, js);

  requireText("state_backed_ui", "checklist_panel", "Operator progress");
  requirePattern("state_backed_ui", "checklist_from_state", /operatorProgressItems\(state\)/, js);
  requirePattern("state_backed_ui", "checklist_completed_steps", /target\.completedSteps/, js);

  requireText("state_backed_ui", "event_timeline_panel", "Last 10 Symbolic Events");
  requirePattern("state_backed_ui", "timeline_from_events", /timelineHtml\(state\.events\)/, js);
  requirePattern("state_backed_ui", "timeline_last_ten", /slice\(-10\)/, js);

  requireText("state_backed_ui", "sequence_inspector_panel", "Event Sequence Inspector");
  requirePattern("state_backed_ui", "sequence_from_inspector", /inspectEventSequence\(target\)/, js);
  requirePattern("state_backed_ui", "sequence_payload_summary", /payload_summary/, js);
}

function checkManualConfirmationDisclosure() {
  for (const text of [
    "Manual local confirmation",
    "not automatic vision",
    "operator-confirmed",
    "symbolic event"
  ]) requireText("manual_confirmation", slug(text), text);
}

function checkPrivacyModelVisibility() {
  for (const text of [
    "Privacy & models",
    "Privacy Status",
    "Model-Call Status",
    "Raw media",
    "Cloud fallback",
    "LLM calls",
    "VLM calls",
    "LLM: 0",
    "VLM: 0",
    "cost=$0"
  ]) requireText("privacy_model", slug(text), text);
  requirePattern("privacy_model", "raw_media_false_runtime", /rawMediaPersistenceCount:\s*0/, js);
  requirePattern("privacy_model", "model_calls_zero_runtime", /llmCalls:\s*0[\s\S]*vlmCalls:\s*0/, js);
}

function checkExportValidationUX() {
  for (const text of [
    "Export & save",
    "Export Save-Path Assistant",
    PHYSICAL_TRACE_PATH,
    "Copy Save Path",
    "Copy macOS Save Command",
    "Validation",
    "Copy Validation Commands",
    "npm run physical:validate",
    "replay --repeat 3",
    "npm run gate:1c",
    "npm run gate:2a"
  ]) requireText("export_validation", slug(text), text);
  requirePattern("export_validation", "export_preflight", /runExportPreflight/, js);
  requirePattern("export_validation", "physical_confirmation_required", /operator_confirmed_physical_session/, js);
}

function checkUncertaintyConfidenceVisibility() {
  for (const text of [
    "Uncertainty State",
    "Scene Reset Count",
    "Uncertainty Count",
    "Reset/Recalibration",
    "Low Confidence",
    "Mark Uncertain",
    "Mark Camera Reset"
  ]) requireText("uncertainty", slug(text), text);
  requirePattern("uncertainty", "uncertainty_export_blocker", /uncertainty was marked/, js);
  requirePattern("uncertainty", "reset_export_blocker", /camera reset was marked/, js);
  requirePattern("uncertainty", "low_confidence_state", /state\.confidence < 0\.7 \|\| state\.uncertain/, js);
}

function checkBugReportSource() {
  requireText("bug_report", "bug_report_control", "Export Bug Report");
  requirePattern("bug_report", "builder_exists", /buildOperatorBugReport/, js);
  requireText("bug_report", "symbolic_only_copy", "stage, state, symbolic events, errors, latency, privacy, and model status only");
  requireText("bug_report", "forbidden_media_copy", "Bug report excludes raw frames, screenshots, base64 media, audio, OCR, notebook text, API keys, model responses, and cloud evidence.");
}

function checkForbiddenClaimScan() {
  const lowerApp = appSource.toLowerCase();
  for (const phrase of FORBIDDEN_CLAIMS) {
    addCheck("forbidden_claims", "forbidden_claim_absent", phrase, !lowerApp.includes(phrase), `scan phrase: ${phrase}`, "critical");
  }
  for (const pattern of RAW_MEDIA_HOOKS) rejectPattern("privacy_model", "raw_media_hook_absent", pattern, appSource);
  for (const pattern of MODEL_CALL_HOOKS) rejectPattern("privacy_model", "model_call_hook_absent", pattern, appSource);
}

async function checkRuntimeBehavior() {
  try {
    const mod = await import(pathToFileURL(resolve(PATHS.js)).href);
    const state = mod.createInitialState();
    const initialStatus = mod.topStatusForState(state);
    addCheck("runtime", "initial_top_status_truthful", "initial top status is not optimistic", initialStatus.camera === "off" && initialStatus.calibration === "missing" && initialStatus.export === "not ready" && initialStatus.validation === "pending_export" && initialStatus.privacy === "raw_media_persisted=false", JSON.stringify(initialStatus), "critical");

    state.cameraReady = true;
    state.cameraStarted = true;
    state.cameraStatus = "granted";
    mod.saveCalibrationToState(state, mod.defaultCalibration());
    mod.startFocusRitualInState(state);
    mod.startRecordingInState(state);
    for (const step of ["phone", "notebook", "pen", "writing", "typing"]) mod.confirmStepInState(state, step);
    mod.stopRecordingInState(state);
    state.physicalConfirmed = true;
    mod.getButtonGuards(state);

    const completeStatus = mod.topStatusForState(state);
    addCheck("runtime", "complete_top_status_truthful", "complete top status is state-backed", completeStatus.camera === "ready" && completeStatus.calibration === "saved" && completeStatus.quest === "complete" && completeStatus.export === "ready" && completeStatus.privacy === "raw_media_persisted=false", JSON.stringify(completeStatus), "critical");

    const sequence = mod.inspectEventSequence(state);
    addCheck("runtime", "sequence_present", "sequence inspector state-backed", sequence.length === 7 && sequence.every((item) => item.status === "present"), `sequence_count=${sequence.length}`, "critical");

    const fixture = mod.buildReplayFixture(state);
    addCheck("runtime", "fixture_privacy_model_zero", "fixture no raw media or model calls", fixture.trace_origin.raw_media_persisted === false && fixture.privacy.contains_raw_video === false && fixture.metrics.max_llm_calls === 0 && fixture.metrics.max_vlm_calls === 0, "fixture privacy/model metrics are zero", "critical");

    const bugReport = mod.buildOperatorBugReport(state, { userAgent: "gate-2a-check" });
    const bugJson = JSON.stringify(bugReport);
    addCheck("runtime", "bug_report_symbolic_shape", "bug report symbolic-only shape", bugReport.schema === "darkquest.operator_bug_report.v0" && Array.isArray(bugReport.symbolic_events) && bugReport.model_status.llm_calls === 0 && bugReport.privacy_status.media_persisted === false, "bug report allowed shape", "critical");
    addCheck("runtime", "bug_report_forbidden_markers_absent", "bug report forbidden markers absent", !FORBIDDEN_BUG_REPORT_MARKERS.some((pattern) => pattern.test(bugJson)), "no forbidden bug report markers", "critical");
    writeArtifact("runs/darkquest_gate_2a_bug_report.sample.json", bugReport);
    report.artifacts.push("runs/darkquest_gate_2a_bug_report.sample.json");
  } catch (error) {
    addCheck("runtime", "runtime_exception", "runtime behavior", false, error?.stack ?? error?.message ?? "runtime failed", "critical");
  }
}

function requireScript(scriptName) {
  addCheck("source", "required_script", scriptName, typeof packageJson.scripts?.[scriptName] === "string", `package script: ${scriptName}`, "critical");
}

function requireText(category, code, text) {
  addCheck(category, code, text, combined.includes(text), `required text: ${text}`, "critical");
}

function requirePattern(category, code, pattern, source) {
  addCheck(category, code, String(pattern), pattern.test(source), `required pattern: ${pattern}`, "critical");
}

function rejectPattern(category, code, pattern, source) {
  addCheck(category, code, String(pattern), !pattern.test(source), `forbidden pattern: ${pattern}`, "critical");
}

function addCheck(category, code, name, passed, evidence, severity) {
  report.checks.push({ category, code, name, passed, evidence, severity });
}

function writeArtifact(path, value) {
  const outputPath = resolve(path);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function compactOutput(output) {
  return output.split("\n").filter(Boolean).slice(-18).join("\n");
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
