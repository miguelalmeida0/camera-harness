#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPORT_PATH = "runs/gate-4a-latest.json";
const files = {
  packageJson: "package.json",
  html: "packages/perception/browser-local-capture/prototype/index.html",
  source: "packages/perception/browser-local-capture/prototype/local-capture.js",
  test: "packages/perception/browser-local-capture/test/prototype-flow.test.mjs",
  agents: "AGENTS.md"
};

const packageJson = JSON.parse(read(files.packageJson));
const html = read(files.html);
const source = read(files.source);
const test = read(files.test);
const agents = read(files.agents);
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const defaultMainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;

const report = {
  schema: "darkquest.gate_4a_report.v0",
  gate: "4A",
  claim: "The app can run local camera perception, produce current-step-aware detected action candidates, show them in the main UI, let the user confirm/correct, and preserve privacy/no-model/no-raw-media guarantees.",
  generated_at: new Date().toISOString(),
  files_checked: files,
  checks: [],
  final_verdict: "FAIL"
};

checkPackageWiring();
checkLocalPerception();
checkDetectedActionCandidate();
checkDetectedActionUi();
checkConfirmationCorrection();
checkPrivacyAndModels();
checkHiddenQaUi();
checkForbiddenClaims();
checkSafetyTests();

const failures = report.checks.filter((check) => !check.passed && check.severity === "critical");
const perceptionBlockers = failures.filter((check) => check.category === "perception");
report.failure_count = failures.length;
report.failures = failures;

if (perceptionBlockers.length > 0) {
  report.final_verdict = "BLOCKED_MISSING_PERCEPTION";
} else if (failures.length > 0) {
  report.final_verdict = "FAIL";
} else {
  report.final_verdict = "PASS_WITH_DISCLOSURE";
}

mkdirSync("runs", { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate 4A real local camera action engine check`);
console.log(`report: ${REPORT_PATH}`);
console.log(`checks: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
}

process.exit(report.final_verdict === "FAIL" || report.final_verdict === "BLOCKED_MISSING_PERCEPTION" ? 1 : 0);

function checkPackageWiring() {
  const scripts = packageJson.scripts ?? {};
  addCheck("source", "gate_4a_script", "npm run gate:4a", typeof scripts["gate:4a"] === "string" && scripts["gate:4a"].includes("gate-4a-check.mjs"), "package script", "critical");
  addCheck("source", "typecheck_includes_gate_4a", "typecheck includes gate-4a-check.mjs", scripts.typecheck?.includes("gate-4a-check.mjs") === true, "typecheck script", "critical");
}

function checkLocalPerception() {
  includes("perception", "camera_local_video_only", source, "getUserMedia({ video: true, audio: false })", "camera requests local video and no audio", "critical");
  includes("perception", "local_perception_loop", source, "requestAnimationFrame(processLocalPerceptionFrame)", "local perception frame loop exists", "critical");
  includes("perception", "transient_frame_processing", source, "readDownsampledGrayFrame", "frames are downsampled transiently", "critical");
  includes("perception", "local_motion_compute", source, "computeZoneMotion", "local zone motion computation exists", "critical");
  includes("perception", "motion_history", source, "updateMotionHistory", "motion history feeds local candidates", "critical");
  includes("perception", "hand_motion_markers", source, "hand.entered_zone", "hand entered marker exists", "critical");
  includes("perception", "hand_left_marker", source, "hand.left_zone", "hand left marker exists", "critical");
  includes("perception", "motion_proxy_marker", source, "motion_proxy", "motion proxy marker exists", "critical");
}

function checkDetectedActionCandidate() {
  for (const [code, needle] of [
    ["candidate_builder", "createPerceptionSuggestion"],
    ["candidate_type", 'type: "action_suggestion"'],
    ["suggested_event_type", "suggested_event_type"],
    ["suggested_action", "suggested_action"],
    ["quest_step", "quest_step"],
    ["candidate_confidence", "confidence"],
    ["candidate_zone", "zone_id"],
    ["candidate_evidence", "evidence"]
  ]) includes("candidate", code, source, needle, needle, "critical");
  includes("candidate", "current_step_prioritization", source, "rankActionSuggestions", "current-step ranking exists", "critical");
  includes("candidate", "current_step_filter", source, "suggestionMatchesCurrentStep", "candidate must match current quest step", "critical");
  includes("candidate", "phone_candidate", source, "Possible phone moved - confirm to accept.", "phone moved candidate exists", "critical");
  includes("candidate", "notebook_candidate", source, "Possible notebook opened - confirm to accept.", "notebook opened candidate exists", "critical");
  includes("candidate", "pen_candidate", source, "Possible pen picked up - confirm to accept.", "pen picked up candidate exists", "critical");
  includes("candidate", "writing_candidate", source, "Possible writing motion - confirm to accept.", "writing motion candidate exists", "critical");
  includes("candidate", "typing_candidate", source, "Possible typing motion - confirm to accept.", "typing motion candidate exists", "critical");
}

function checkDetectedActionUi() {
  includes("ui", "detected_action_card", html, 'data-product-card="detected-action"', "Detected Action card exists", "critical");
  includes("ui", "detected_action_title", html, 'id="cameraSuggestionsTitle">Detected Action', "product-facing Detected Action title", "critical");
  includes("ui", "confirm_button", source, 'data-suggestion-action="accept"', "Confirm action button exists", "critical");
  includes("ui", "reject_button", source, 'data-suggestion-action="reject"', "Not this / Correct button exists", "critical");
  includes("ui", "confidence_display", source, "Confidence ${suggestion.confidence.toFixed(2)}", "candidate confidence is shown", "critical");
  includes("ui", "zone_display", source, "naturalizeMovementText", "candidate location is naturalized for product UI", "critical");
  includes("ui", "reason_display", source, "readableDetailHtml(\"Reason\"", "candidate reason is shown as readable detail", "critical");
  includes("ui", "camera_suggestion_disclosure", html, "Camera suggestion — requires confirmation. Local motion proxy only.", "camera suggestion disclosure visible", "critical");
  includes("ui", "manual_confirmation_disclosure", html, "Manual local confirmation — not automatic vision.", "manual confirmation disclosure visible", "critical");
  includes("ui", "uncertainty_display", html, "Uncertainty State", "uncertainty state visible", "critical");
}

function checkConfirmationCorrection() {
  includes("confirmation", "accept_handler", source, "acceptSuggestionInState", "accept handler exists", "critical");
  includes("confirmation", "reject_handler", source, "rejectSuggestionInState", "reject handler exists", "critical");
  includes("confirmation", "human_correction_evidence", source, "withHumanCorrectionEvidence", "accepted suggestion adds human_correction", "critical");
  includes("confirmation", "local_signal_evidence", source, "localSuggestionEvidence", "accepted suggestion keeps local_signal", "critical");
  includes("confirmation", "accepted_suggestion_id", source, "accepted_from_suggestion_id", "accepted suggestion id is recorded", "critical");
  includes("confirmation", "reject_status_message", source, "Quest state was not changed.", "reject path explicitly does not progress", "critical");
  includes("confirmation", "no_auto_completion_counter", source, "autoCompletedSteps: 0", "auto-completion counter starts at zero", "critical");
}

function checkPrivacyAndModels() {
  absentRegex("privacy", "no_raw_media_persistence_hooks", source, /MediaRecorder|toDataURL|readAsDataURL|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon/i, "no browser raw-media persistence hooks", "critical");
  absentRegex("privacy", "no_frame_upload_hooks", source, /fetch\s*\(|WebSocket|XMLHttpRequest|sendBeacon/i, "no frame upload/cloud path", "critical");
  absentRegex("model", "no_model_api_hooks", source, /OpenAI|OPENAI_API_KEY|sk-proj-|sk-[A-Za-z0-9]|chat\.completions|responses\.create/i, "no LLM/VLM API hook", "critical");
  includes("model", "model_counters_zero", source, "llmCalls: 0", "LLM counter starts at zero", "critical");
  includes("model", "vlm_counter_zero", source, "vlmCalls: 0", "VLM counter starts at zero", "critical");
  includes("privacy", "raw_media_counter_zero", source, "rawMediaPersistenceCount: 0", "raw media persistence counter starts at zero", "critical");
}

function checkHiddenQaUi() {
  includes("ux", "developer_tools_exists", html, '<details id="developerTools"', "Advanced / Developer Tools exists", "critical");
  absent("ux", "developer_tools_closed_default", html, '<details id="developerTools" class="dq-dev-tools" open', "Developer Tools closed by default", "critical");
  includes("ux", "suggestion_campaign_in_developer_tools", html, '<details id="suggestionCampaignPanel" class="dq-card dq-technical-card dq-campaign-details"', "Suggestion Trace Campaign is a developer detail", "critical");
  absent("ux", "suggestion_campaign_closed_default", html, 'id="suggestionCampaignPanel" class="dq-card dq-technical-card dq-campaign-details" open', "Suggestion Trace Campaign closed by default", "critical");
  addCheck("ux", "trace_campaign_after_developer_tools", "Suggestion Trace Campaign position", bodyHtml.indexOf("Suggestion Trace Campaign") > developerToolsIndex && developerToolsIndex >= 0, "campaign copy appears after Developer Tools", "critical");
  for (const forbidden of [
    "Gate 3B-Live",
    "Suggestion Trace Campaign",
    "campaign bundle",
    "Export Campaign Bundle",
    "live_suggestion_",
    "Preview Export JSON",
    "Export Preflight",
    "Blocked Button Reasons",
    "Suggestion export preflight",
    "npm run suggestions:validate",
    "raw preflight"
  ]) {
    absent("ux", `default_ui_hides_${safeCode(forbidden)}`, defaultMainUi, forbidden, `${forbidden} hidden from default main UI`, "critical");
  }
}

function checkForbiddenClaims() {
  for (const claim of [
    "autonomous vision",
    "automatic action recognition",
    "camera understands your task",
    "object detection proven",
    "gesture recognition proven",
    "production perception",
    "production action recognition",
    "production ready",
    "portfolio ready",
    "AI sees what you are doing",
    "VLM-powered",
    "cloud vision"
  ]) {
    absent("claims", `forbidden_claim_${safeCode(claim)}`, `${html}\n${source}`, claim, `forbidden claim absent: ${claim}`, "critical");
  }
}

function checkSafetyTests() {
  for (const marker of [
    "Gate 4A",
    "Detected Action",
    "acceptSuggestionInState",
    "rejectSuggestionInState",
    "local_signal",
    "human_correction",
    "rankActionSuggestions",
    "Uncertainty State",
    "no LLM/VLM",
    "no raw media",
    "Suggestion Trace Campaign",
    "developer tools should be closed by default"
  ]) includes("tests", `prototype_flow_${safeCode(marker)}`, test, marker, `prototype flow test covers ${marker}`, "critical");
  includes("rules", "vanta_ui_rules", agents, "Suggestion Trace Campaign must never appear in the default operator view", "repo UI rule present", "critical");
}

function read(path) {
  return readFileSync(resolve(path), "utf8");
}

function includes(category, code, haystack, needle, name, severity) {
  addCheck(category, code, name, haystack.includes(needle), needle, severity);
}

function absent(category, code, haystack, needle, name, severity) {
  addCheck(category, code, name, !haystack.toLowerCase().includes(needle.toLowerCase()), needle, severity);
}

function absentRegex(category, code, haystack, regex, name, severity) {
  addCheck(category, code, name, !regex.test(haystack), String(regex), severity);
}

function addCheck(category, code, name, passed, evidence, severity) {
  report.checks.push({ category, code, name, passed, evidence, severity });
}

function safeCode(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
