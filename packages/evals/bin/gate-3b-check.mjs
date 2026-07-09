#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PATHS = {
  html: "packages/perception/browser-local-capture/prototype/index.html",
  js: "packages/perception/browser-local-capture/prototype/local-capture.js",
  prototypeTest: "packages/perception/browser-local-capture/test/prototype-flow.test.mjs",
  packageJson: "package.json"
};

const FORBIDDEN_CLAIMS = [
  "autonomous vision",
  "automatic action recognition",
  "camera understands your task",
  "object detection proven",
  "gesture recognition proven",
  "production perception",
  "ai sees what you are doing",
  "vlm-powered",
  "cloud vision"
];
const RAW_MEDIA_HOOKS = [
  /MediaRecorder/,
  /\.toDataURL\s*\(/,
  /\.toBlob\s*\(/,
  /readAsDataURL/,
  /data:image/i,
  /data:video/i,
  /data:audio/i,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /navigator\.sendBeacon/,
  /XMLHttpRequest/,
  /fetch\s*\(/,
  /WebSocket/
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

const report = {
  schema: "darkquest.gate_3b_report.v0",
  gate: "3B",
  claim: "The app can convert local motion-proxy signals into safe, quest-state-aware camera suggestions for Focus Ritual steps without blind auto-completion, model calls, raw media persistence, or autonomous vision claims.",
  generated_at: new Date().toISOString(),
  gate_3a_status: "UNKNOWN",
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
const combined = Object.values(files).join("\n");
const appSource = `${html}\n${js}`;
const packageJson = files.packageJson ? JSON.parse(files.packageJson) : { scripts: {} };

checkGate3APrerequisite();
checkPackageScripts();
checkSuggestionEngineSource();
checkSuggestionPanelSource();
checkEvidenceSource();
checkForbiddenScans();
await checkRuntimeBehavior();

const failures = report.checks.filter((check) => !check.passed && check.severity !== "info");
report.failure_count = failures.length;
report.failures = failures;
if (report.gate_3a_status !== "PASS") {
  report.final_verdict = "BLOCKED_GATE_3A";
} else if (failures.length) {
  report.final_verdict = "FAIL";
} else {
  report.final_verdict = "PASS_WITH_DISCLOSURE";
}

mkdirSync("runs", { recursive: true });
writeFileSync("runs/gate-3b-latest.json", `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate 3B action suggestion engine check`);
console.log("report: runs/gate-3b-latest.json");
console.log(`checks: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}`);
console.log(`gate_3a_status: ${report.gate_3a_status}`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
}

process.exit(report.final_verdict === "PASS_WITH_DISCLOSURE" || report.final_verdict === "PASS" ? 0 : 1);

function checkGate3APrerequisite() {
  const markers = [
    "readDownsampledGrayFrame",
    "computeZoneMotion",
    "motionProxyEventSpec",
    "zoneActivatedEventSpec",
    "applyLocalMotionObservations",
    "cameraSuggestionsPanel"
  ];
  const missing = markers.filter((marker) => !combined.includes(marker));
  report.gate_3a_status = missing.length ? "BLOCKED" : "PASS";
  addCheck("gate_dependency", "gate_3a_markers", "Gate 3A local motion markers present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "Gate 3A prerequisite markers present", "critical");
}

function checkPackageScripts() {
  requireScript("gate:3b");
  addCheck("source", "typecheck_includes_gate_3b", "typecheck includes gate-3b-check.mjs", packageJson.scripts?.typecheck?.includes("gate-3b-check.mjs") === true, "node --check packages/evals/bin/gate-3b-check.mjs", "critical");
}

function checkSuggestionEngineSource() {
  requirePattern("suggestion_engine", "action_suggestion_engine", /createPerceptionSuggestion|queuePerceptionSuggestion/, js);
  requirePattern("suggestion_engine", "motion_history", /previousMotionSample|zoneState|gestureWindows/, js);
  requirePattern("suggestion_engine", "zone_dwell", /stableDurationMs|durationMs >= LOCAL_MOTION\.stableDurationMs/, js);
  requirePattern("suggestion_engine", "motion_burst", /gestureWindows|windowItems\.length < 3/, js);
  requirePattern("suggestion_engine", "suggestion_ranking", /rankSuggestion|\.sort\(\(a, b\) => \(b\.rank/, js);
  requirePattern("suggestion_engine", "expiration_cooldown", /expires_at_ms|suggestionCooldownMs/, js);
  requirePattern("suggestion_engine", "current_step_gating", /suggestionMatchesCurrentStep|target\.questState === step\.activeState/, js);
  requirePattern("suggestion_engine", "accept_flow", /acceptSuggestionInState[\s\S]*confirmStepInState/, js);
  requirePattern("suggestion_engine", "reject_flow", /rejectSuggestionInState[\s\S]*Quest state was not changed/, js);
  requirePattern("suggestion_engine", "uncertainty_blocks_suggestions", /target\.uncertain \|\| target\.reset/, js);
  requirePattern("suggestion_engine", "low_confidence_marking", /low_confidence:\s*normalizedConfidence < 0\.7/, js);
  requirePattern("suggestion_engine", "suggestion_only_metadata", /suggestion_only:\s*true/, js);
  requirePattern("suggestion_engine", "motion_proxy_metadata", /detection_method:\s*"motion_proxy"/, js);
}

function checkSuggestionPanelSource() {
  requireText("ui", "camera_suggestion_panel", "cameraSuggestionsPanel");
  requireText("ui", "camera_suggestion_requires_confirmation", "Camera suggestion — requires confirmation");
  requireText("ui", "manual_confirmation_disclosure", "Manual local confirmation");
  requireText("ui", "not_automatic_vision_disclosure", "not automatic vision");
  requireText("ui", "local_motion_proxy_copy", "Local motion proxy only");
}

function checkEvidenceSource() {
  requirePattern("evidence", "local_signal_evidence", /kind:\s*"local_signal"/, js);
  requirePattern("evidence", "human_correction_on_accept", /kind:\s*"human_correction"[\s\S]*Operator accepted camera suggestion/, js);
  requirePattern("evidence", "accept_extra_evidence", /suggestionEvidence|localSuggestionEvidence/, js);
  requirePattern("evidence", "no_raw_media_evidence", /contains_raw_media:\s*false/, js);
}

function checkForbiddenScans() {
  const lower = appSource.toLowerCase();
  for (const phrase of FORBIDDEN_CLAIMS) {
    addCheck("forbidden_claims", "forbidden_claim_absent", phrase, !lower.includes(phrase), `scan phrase: ${phrase}`, "critical");
  }
  for (const pattern of RAW_MEDIA_HOOKS) rejectPattern("privacy_model", "raw_media_persistence_hook_absent", pattern, appSource);
  for (const pattern of MODEL_CALL_HOOKS) rejectPattern("privacy_model", "model_call_hook_absent", pattern, appSource);
}

async function checkRuntimeBehavior() {
  try {
    const mod = await import(pathToFileURL(resolve(PATHS.js)).href);
    const state = preparedState(mod);
    mod.confirmStepInState(state, "phone");
    mod.confirmStepInState(state, "notebook");
    mod.confirmStepInState(state, "pen");
    const suggestion = mod.createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.82, "repeated small local motion in notebook_zone", "writing", 4700);
    mod.queuePerceptionSuggestion(state, suggestion);
    addCheck("runtime", "suggestion_pending_no_auto_progress", "queued suggestion does not auto-progress", state.questState === "writing_pending" && !state.events.some((event) => event.id === "evt_writing_like_motion"), `quest=${state.questState}`, "critical");
    mod.acceptSuggestionInState(state, suggestion.id);
    const accepted = state.events.find((event) => event.id === "evt_writing_like_motion");
    addCheck("runtime", "accept_progresses_same_reducer", "accepted current-step suggestion progresses quest", state.questState === "typing_pending" && Boolean(accepted), `quest=${state.questState}`, "critical");
    addCheck("runtime", "accept_evidence_local_and_human", "accepted suggestion evidence has local_signal and human_correction", Boolean(accepted) && accepted.evidence.some((item) => item.kind === "local_signal" && item.detection_method === "motion_proxy" && item.suggestion_only === true && item.contains_raw_media === false) && accepted.evidence.some((item) => item.kind === "human_correction" && item.contains_raw_media === false), accepted ? JSON.stringify(accepted.evidence) : "missing event", "critical");

    const rejectState = preparedState(mod);
    const typing = mod.createPerceptionSuggestion("gesture.detected typing_like_motion", "keyboard_zone", 0.81, "typing-like local motion", "typing", 6200);
    rejectState.perceptionSuggestions.push(typing);
    const beforeReject = { questState: rejectState.questState, eventCount: rejectState.events.length };
    mod.rejectSuggestionInState(rejectState, typing.id);
    addCheck("runtime", "reject_no_progress", "rejected suggestion does not progress quest", rejectState.questState === beforeReject.questState && rejectState.events.length === beforeReject.eventCount && rejectState.perceptionSuggestions[0].status === "rejected", JSON.stringify({ beforeReject, after: rejectState.questState }), "critical");

    const futureState = preparedState(mod);
    const future = mod.createPerceptionSuggestion("gesture.detected typing_like_motion", "keyboard_zone", 0.84, "future typing-like local motion", "typing", 5100);
    mod.queuePerceptionSuggestion(futureState, future);
    futureState.perceptionSuggestions.push(future);
    mod.acceptSuggestionInState(futureState, future.id);
    addCheck("runtime", "future_step_suppressed", "future-step suggestion suppressed", futureState.questState === "phone_removal_pending" && !futureState.events.some((event) => event.id === "evt_typing_like_motion"), `quest=${futureState.questState}`, "critical");

    const lowState = preparedState(mod);
    mod.confirmStepInState(lowState, "phone");
    mod.confirmStepInState(lowState, "notebook");
    mod.confirmStepInState(lowState, "pen");
    const low = mod.createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.61, "weak writing-like local motion", "writing", 5300);
    mod.queuePerceptionSuggestion(lowState, low);
    addCheck("runtime", "low_confidence_no_auto_progress", "low-confidence suggestion marked and does not auto-progress", lowState.perceptionSuggestions[0]?.low_confidence === true && lowState.questState === "writing_pending" && !lowState.events.some((event) => event.id === "evt_writing_like_motion"), JSON.stringify(lowState.perceptionSuggestions[0] ?? null), "critical");

    const cooldownState = preparedState(mod);
    mod.confirmStepInState(cooldownState, "phone");
    mod.confirmStepInState(cooldownState, "notebook");
    mod.confirmStepInState(cooldownState, "pen");
    const first = mod.createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.8, "first", "writing", 6000);
    const dup = mod.createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.81, "duplicate", "writing", 6000 + mod.LOCAL_MOTION.suggestionCooldownMs - 1);
    mod.queuePerceptionSuggestion(cooldownState, first);
    mod.queuePerceptionSuggestion(cooldownState, dup);
    addCheck("runtime", "duplicate_cooldown", "duplicate suggestion suppressed during cooldown", cooldownState.perceptionSuggestions.length === 1 && cooldownState.perceptionSuggestions[0].id === first.id, JSON.stringify(cooldownState.perceptionSuggestions), "critical");

    const uncertainState = preparedState(mod);
    mod.confirmStepInState(uncertainState, "phone");
    mod.confirmStepInState(uncertainState, "notebook");
    mod.confirmStepInState(uncertainState, "pen");
    mod.markUncertainInState(uncertainState);
    const unsafe = mod.createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.86, "unsafe while uncertain", "writing", 7000);
    mod.queuePerceptionSuggestion(uncertainState, unsafe);
    uncertainState.perceptionSuggestions.push(unsafe);
    mod.acceptSuggestionInState(uncertainState, unsafe.id);
    addCheck("runtime", "uncertainty_blocks_progress", "uncertainty prevents unsafe suggestion progression", uncertainState.uncertain === true && !uncertainState.events.some((event) => event.id === "evt_writing_like_motion"), `quest=${uncertainState.questState}`, "critical");

    writeArtifact("runs/gate-3b-runtime-summary.json", {
      accepted_event_id: accepted?.id ?? null,
      low_confidence_marked: lowState.perceptionSuggestions[0]?.low_confidence === true,
      duplicate_count_after_cooldown_check: cooldownState.perceptionSuggestions.length,
      model_calls: { llm: state.llmCalls, vlm: state.vlmCalls },
      raw_media_persistence_count: state.rawMediaPersistenceCount
    });
    report.artifacts.push("runs/gate-3b-runtime-summary.json");
  } catch (error) {
    addCheck("runtime", "runtime_exception", "runtime behavior", false, error?.stack ?? error?.message ?? "runtime failed", "critical");
  }
}

function preparedState(mod) {
  const state = mod.createInitialState();
  state.cameraReady = true;
  state.cameraStarted = true;
  mod.saveCalibrationToState(state, mod.defaultCalibration());
  mod.startFocusRitualInState(state);
  mod.startRecordingInState(state);
  return state;
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
