#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PATHS = {
  html: "packages/perception/browser-local-capture/prototype/index.html",
  js: "packages/perception/browser-local-capture/prototype/local-capture.js",
  packageJson: "package.json",
  validator: "packages/replay/live-trace-recorder/scripts/validate-physical-trace.mjs",
  devValidator: "packages/evals/bin/dev-trace-validate.mjs",
  gate1d: "packages/evals/bin/gate-1d-check.mjs",
  gate1e: "packages/evals/bin/gate-1e-check.mjs",
  canITest: "docs/architecture/CAN_I_TEST_IT.md",
  scopePolicy: "docs/architecture/stop-scope-creep-until-physical-trace.md",
  resultInterpretation: "docs/architecture/user-test-result-interpretation.md",
  physicalBlocker: "docs/architecture/physical-trace-is-the-only-product-blocker.md",
  acceptanceCriteria: "docs/architecture/gate-1F-acceptance-criteria.md",
  finalUserScript: "docs/architecture/FINAL_USER_TEST_SCRIPT.md",
  finalHandoff: "docs/architecture/gate-1F-final-handoff.md",
  minimalHudApproval: "docs/evals/minimal-hud-polish-approval.md"
};
const PHYSICAL_TRACE_PATH = "fixtures/replay/live/live_physical_focus_ritual_001.v0.json";
const PHYSICAL_TRACE_FILENAME = "live_physical_focus_ritual_001.v0.json";
const DEV_DRY_RUN_PATH = "runs/dev/gate-1f-dry-run-export.json";
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
  schema: "darkquest.gate_1f_report.v0",
  gate: "1F",
  claim: "Local app has enough operator guidance, troubleshooting, save-path support, bug-report export, event-sequence inspection, and dry-run/physical separation for a non-agent user to attempt the physical trace run.",
  generated_at: new Date().toISOString(),
  checks: [],
  artifacts: [],
  physical_trace_status: "unknown",
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
const combined = Object.values(files).join("\n");
const packageJson = files.packageJson ? JSON.parse(files.packageJson) : { scripts: {} };

checkScript("gate:1f");
checkDependentGates();
checkRequiredDocs();
checkOperatorGuidance();
checkTroubleshooting();
checkSavePath();
checkBugReportSource();
checkEventSequenceSource();
checkDryRunSeparationSource();
await checkRuntimeBehavior();
checkPhysicalValidateGuidance();
checkPhysicalTraceStatus();

const failures = report.checks.filter((check) => !check.passed && check.severity !== "info");
report.failure_count = failures.length;
report.failures = failures;
report.final_verdict = failures.length
  ? failures.some((check) => check.severity === "critical") ? "NOT_OPERATOR_READY" : "FAIL"
  : "TRACE_EXPORT_GUIDED";

mkdirSync("runs", { recursive: true });
writeFileSync("runs/gate-1f-latest.json", `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate 1F operator readiness check`);
console.log("report: runs/gate-1f-latest.json");
console.log(`checks: ${report.checks.length - failures.length}/${report.checks.length}`);
console.log(`physical trace: ${report.physical_trace_status}`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
}

process.exit(failures.length === 0 ? 0 : 1);

function checkScript(scriptName) {
  addCheck("source", "required_script", scriptName, typeof packageJson.scripts?.[scriptName] === "string", `package script: ${scriptName}`, "critical");
}

function checkDependentGates() {
  const gate1d = runNode(PATHS.gate1d);
  addCheck("gate_dependency", "gate_1d_passes", "Gate 1D passes", gate1d.status === 0 && gate1d.output.includes("TRYABLE_WITH_MANUAL_CONFIRMATION"), gate1d.output, "critical");

  const gate1e = runNode(PATHS.gate1e);
  const gate1eReady = gate1e.output.includes("TRACE_EXPORT_READY") || gate1e.output.includes("PHYSICAL_TRACE_READY_FOR_GATE_1C");
  addCheck("gate_dependency", "gate_1e_passes", "Gate 1E passes", gate1e.status === 0 && gate1eReady, gate1e.output, "critical");
}

function checkRequiredDocs() {
  requireAnyText("docs", "can_i_test_it_exists", [
    "Yes, the local app can be tested now with manual confirmation.",
    "Gate 1C passes with disclosure",
    "PASS_WITH_DISCLOSURE"
  ]);
  requireAnyText("docs", "gate_1c_status_disclosed", [
    "No, Gate 1C is not passed until the physical trace is exported, saved, replayed, and validated.",
    "Latest Gate 1C verdict: `PASS_WITH_DISCLOSURE`.",
    "Gate 1C `PASS_WITH_DISCLOSURE`"
  ]);
  requireAnyText("docs", "hud_polish_disclosed", [
    "No, HUD polish is not unlocked.",
    "minimal state-backed HUD polish: approved_with_disclosure",
    "minimal state-backed HUD polish approved with disclosure"
  ]);
  requireText("docs", "no_autonomous_vision_proven", "No, autonomous vision is not proven.");
  requireText("docs", "stop_scope_creep", "No new gates after Gate 1F.");
  requireText("docs", "allowed_physical_capture_support", "physical trace capture support");
  requireText("docs", "not_allowed_cinematic_hud", "cinematic HUD");
  requireText("docs", "not_allowed_model_integration", "model integration");
  requireText("docs", "result_interpretation_table", "Gate 1C passes with disclosure");
  requireText("docs", "only_product_blocker", "the only product blocker for moving beyond local tryability is the physical trace and Gate 1C validation");
  requireText("docs", "gate_1f_acceptance", "Gate 1F Passes If");
  requireText("docs", "final_user_script", "## 1. Start The App");
  requireText("docs", "final_handoff_multimodal", "To Multimodal Perception & Interface Researcher");
  requireText("docs", "final_handoff_harness", "To Harness, Evaluation, Memory & Safety Researcher");
  requireText("docs", "gate_2_locked", "Gate 2 remains locked");
}

function checkOperatorGuidance() {
  requireText("operator_guidance", "operator_mode_panel", "Operator Mode");
  requireText("operator_guidance", "next_action_text", "Next Action");
  requireText("operator_guidance", "blocking_reason_text", "Blocking Reason");
  requireText("operator_guidance", "validation_commands", "Validation Commands");
  requireText("operator_guidance", "artifact_checklist", "Artifact Checklist");
  requirePattern("operator_guidance", "operator_helper_functions", /operatorReadiness|operatorBlockingReason|operatorArtifactChecklistItems/, combined);
}

function checkTroubleshooting() {
  requireText("troubleshooting", "troubleshooting_panel", "Troubleshooting Panel");
  requireText("troubleshooting", "camera_failure_help", "Camera failure help");
  requireText("troubleshooting", "disabled_button_help", "Disabled-button help");
  requireText("troubleshooting", "export_missing_help", "Export missing help");
  requireText("troubleshooting", "wrong_save_path_help", "Wrong save path help");
  requireAnyText("troubleshooting", "gate_1c_blocked_help", [
    "Gate 1C blocked help",
    "Gate 1C still says BLOCKED_MISSING_PHYSICAL_TRACE",
    "Gate 1C should move from BLOCKED_MISSING_PHYSICAL_TRACE",
    "Gate 1C validation help: run physical:validate first",
    "Gate 1C returns an unexpected blocker"
  ]);
  requireText("troubleshooting", "port_fallback_help", "Port fallback help");
}

function checkSavePath() {
  requireText("save_path", "required_path", PHYSICAL_TRACE_PATH);
  requireText("save_path", "downloaded_filename", PHYSICAL_TRACE_FILENAME);
  requireText("save_path", "copy_save_path_button", "Copy Save Path");
  requireText("save_path", "copy_validation_commands_button", "Copy Validation Commands");
  requirePattern("save_path", "macos_cp_command", /cp ~\/Downloads\/\$\{LIVE_PHYSICAL_TRACE_FILENAME\}/, js);
}

function checkBugReportSource() {
  requireText("bug_report", "export_bug_report_control", "Export Bug Report");
  requirePattern("bug_report", "bug_report_builder_function", /buildOperatorBugReport/, js);
  requireText("bug_report", "bug_report_filename", "darkquest_operator_bug_report.json");
  requireText("bug_report", "bug_report_excludes_raw_media", "Bug report excludes raw frames, screenshots, base64 media, audio, OCR, notebook text, API keys, model responses, and cloud evidence.");
}

function checkEventSequenceSource() {
  requireText("event_sequence", "event_sequence_inspector", "Event Sequence Inspector");
  requirePattern("event_sequence", "required_sequence_source", /REQUIRED_EXPORT_EVENT_IDS/, js);
  requirePattern("event_sequence", "present_missing_status", /"present"\s*:\s*"missing"/, js);
  requirePattern("event_sequence", "matched_event_id", /matched_event_id/, js);
  requirePattern("event_sequence", "confidence", /confidence/, js);
  requirePattern("event_sequence", "payload_summary", /payload_summary/, js);
}

function checkDryRunSeparationSource() {
  requireText("dry_run", "dev_dry_run_label", "DEV DRY RUN ONLY");
  requireText("dry_run", "physical_export_separate", "PHYSICAL EXPORT");
  requirePattern("dry_run", "dry_run_physical_false", /physical_capture:\s*!devDryRun/, js);
  requirePattern("dry_run", "dry_run_operator_false", /operator_confirmed_physical_session:\s*!devDryRun/, js);
  requireText("dry_run", "dry_run_cannot_satisfy_gate_1c", "cannot satisfy Gate 1C");
}

function checkPhysicalValidateGuidance() {
  const result = runNode(PATHS.validator, PHYSICAL_TRACE_PATH);
  const missingWithGuidance = result.status !== 0
    && result.output.includes("BLOCKED_MISSING_PHYSICAL_TRACE")
    && result.output.includes("physical_trace_missing")
    && result.output.includes(PHYSICAL_TRACE_PATH)
    && result.output.includes("npm run physical:validate")
    && result.output.includes("npm run gate:1c");
  const passedWithTrace = result.status === 0
    && result.output.includes("PASS")
    && result.output.includes("physical trace validation");
  addCheck("physical_validate", "useful_missing_file_guidance", "physical:validate guidance", missingWithGuidance || passedWithTrace, result.output, "critical");
}

async function checkRuntimeBehavior() {
  try {
    const mod = await import(pathToFileURL(resolve(PATHS.js)).href);
    const state = completeState(mod);

    const sequence = mod.inspectEventSequence(state);
    const eventRows = sequence.filter((item) => item.required_event_id !== "quest_complete");
    addCheck("event_sequence", "runtime_sequence_count", "six sequence items", eventRows.length >= 6, `count=${eventRows.length}`, "critical");
    addCheck("event_sequence", "runtime_sequence_present", "present status", eventRows.every((item) => item.status === "present" && item.matched_event_id), "all required events present", "critical");
    addCheck("event_sequence", "runtime_sequence_payload_summary", "payload summaries", sequence.every((item) => typeof item.payload_summary === "string" && item.payload_summary.length > 0), "payload summaries present", "critical");
    addCheck("save_path", "runtime_macos_cp_command", "macOS cp command", mod.MACOS_SAVE_COMMAND.includes(`cp ~/Downloads/${PHYSICAL_TRACE_FILENAME} ${PHYSICAL_TRACE_PATH}`), mod.MACOS_SAVE_COMMAND, "critical");

    const bugReport = mod.buildOperatorBugReport(state, { userAgent: "gate-1f-check" });
    const bugJson = JSON.stringify(bugReport);
    addCheck("bug_report", "runtime_bug_report_shape", "bug report shape", bugReport.schema === "darkquest.operator_bug_report.v0" && Array.isArray(bugReport.symbolic_events), "bug report includes allowed shape", "critical");
    addCheck("bug_report", "runtime_bug_report_allowed_fields", "allowed fields", bugReport.browser_user_agent === "gate-1f-check" && bugReport.wizard_stage && bugReport.quest_state && bugReport.latency_metrics && bugReport.privacy_status && bugReport.model_status, "allowed bug report fields present", "critical");
    addCheck("bug_report", "runtime_bug_report_forbidden_markers", "forbidden markers", !FORBIDDEN_BUG_REPORT_MARKERS.some((pattern) => pattern.test(bugJson)), "no forbidden bug report markers", "critical");
    writeArtifact("runs/darkquest_operator_bug_report.sample.json", bugReport);
    report.artifacts.push("runs/darkquest_operator_bug_report.sample.json");

    const dryRun = mod.buildReplayFixture(state, { devDryRun: true });
    writeArtifact(DEV_DRY_RUN_PATH, dryRun);
    report.artifacts.push(DEV_DRY_RUN_PATH);
    const origin = dryRun.trace_origin ?? {};
    addCheck("dry_run", "runtime_dry_run_provenance", "dry-run provenance", origin.dev_dry_run === true && origin.manual_fixture === true && origin.physical_capture === false && origin.operator_confirmed_physical_session === false, "dry run is explicitly non-physical", "critical");
    const devValidation = spawnSync(process.execPath, [PATHS.devValidator, DEV_DRY_RUN_PATH], {
      cwd: resolve("."),
      encoding: "utf8"
    });
    addCheck("dry_run", "dev_trace_validator_passes", "dev trace validator", devValidation.status === 0, (devValidation.stdout || devValidation.stderr || "").trim(), "critical");
    const physicalRejectsDev = spawnSync(process.execPath, [PATHS.validator, DEV_DRY_RUN_PATH], {
      cwd: resolve("."),
      encoding: "utf8"
    });
    addCheck("dry_run", "physical_validator_rejects_dev", "dry run cannot satisfy Gate 1C", physicalRejectsDev.status !== 0, (physicalRejectsDev.stdout || physicalRejectsDev.stderr || "").trim(), "critical");
  } catch (error) {
    addCheck("runtime", "runtime_exception", "runtime behavior", false, error?.stack ?? error?.message ?? "runtime failed", "critical");
  }
}

function completeState(mod) {
  const state = mod.createInitialState();
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
  return state;
}

function checkPhysicalTraceStatus() {
  const exists = existsSync(resolve(PHYSICAL_TRACE_PATH));
  report.physical_trace_status = exists ? "present_unchecked_by_gate_1f" : "missing";
  addCheck("physical_trace", "physical_trace_missing_expected", PHYSICAL_TRACE_PATH, true, exists ? "physical trace exists; Gate 1C still owns validation" : "physical trace missing; Gate 1C remains blocked", "info");
}

function requireText(category, code, text) {
  addCheck(category, code, text, combined.includes(text), `required text: ${text}`, "critical");
}

function requireAnyText(category, code, texts) {
  addCheck(category, code, texts.join(" | "), texts.some((text) => combined.includes(text)), `required one of: ${texts.join(" | ")}`, "critical");
}

function requirePattern(category, code, pattern, source) {
  addCheck(category, code, String(pattern), pattern.test(source), `required pattern: ${pattern}`, "critical");
}

function runNode(scriptPath, ...args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: resolve("."),
    encoding: "utf8"
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  };
}

function writeArtifact(path, value) {
  const outputPath = resolve(path);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function addCheck(category, code, name, passed, evidence, severity) {
  report.checks.push({ category, code, name, passed, evidence, severity });
}
