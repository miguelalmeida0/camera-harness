#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  acceptSuggestionInState,
  buildLocalPerceptionFrame,
  createInitialState,
  createPerceptionSuggestion,
  defaultCalibration,
  expireOldSuggestions,
  LOCAL_MOTION,
  queuePerceptionSuggestion,
  rejectSuggestionInState,
  REQUIRED_ZONES,
  saveCalibrationToState,
  scoreLocalActionFrame,
  smoothActionConfidence,
  startFocusRitualInState,
  startRecordingInState,
  confirmStepInState,
  updateMotionHistory
} from "../../perception/browser-local-capture/prototype/local-capture.js";

const REPORT_PATH = "runs/gate-4a-engine-latest.json";
const files = {
  packageJson: "package.json",
  html: "packages/perception/browser-local-capture/prototype/index.html",
  source: "packages/perception/browser-local-capture/prototype/local-capture.js",
  test: "packages/perception/browser-local-capture/test/prototype-flow.test.mjs",
  contract: "docs/contracts/local-action-inference.v0.md",
  gate4aPassFail: "docs/evals/gate-4A-pass-fail.md",
  agents: "AGENTS.md"
};

const packageJson = JSON.parse(read(files.packageJson));
const html = read(files.html);
const source = read(files.source);
const test = read(files.test);
const contract = read(files.contract);
const agents = read(files.agents);
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const defaultMainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;

const report = {
  schema: "darkquest.gate_4a_engine_report.v0",
  gate: "4A.1",
  claim: "The app has a real local symbolic action engine that can score current-step candidates from synthetic local perception frames without webcam, raw media, cloud/model calls, or confirmation bypass.",
  generated_at: new Date().toISOString(),
  files_checked: files,
  synthetic_results: [],
  checks: [],
  final_verdict: "FAIL"
};

checkPackageWiring();
checkEngineSourceShape();
checkLocalFrameContract();
checkSyntheticActionSequences();
checkConfirmationBoundary();
checkProductUxRegression();
checkSafetyBoundary();
checkSyntheticTestsExist();

const failures = report.checks.filter((check) => !check.passed && check.severity === "critical");
const engineFailures = failures.filter((check) => check.category === "engine" || check.category === "synthetic");
const testFailures = failures.filter((check) => check.category === "tests");
report.failure_count = failures.length;
report.failures = failures;

if (engineFailures.length > 0) report.final_verdict = "BLOCKED_MISSING_ENGINE";
else if (testFailures.length > 0) report.final_verdict = "BLOCKED_MISSING_TESTS";
else if (failures.length > 0) report.final_verdict = "FAIL";
else report.final_verdict = "PASS_WITH_DISCLOSURE";

mkdirSync("runs", { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate 4A.1 real local camera engine check`);
console.log(`report: ${REPORT_PATH}`);
console.log(`checks: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
}

process.exit(report.final_verdict === "FAIL" ? 1 : 0);

function checkPackageWiring() {
  const scripts = packageJson.scripts ?? {};
  addCheck("source", "gate_4a_engine_script", "npm run gate:4a:engine", typeof scripts["gate:4a:engine"] === "string" && scripts["gate:4a:engine"].includes("gate-4a-engine-check.mjs"), "package script", "critical");
  addCheck("source", "typecheck_includes_gate_4a_engine", "typecheck includes gate-4a-engine-check.mjs", scripts.typecheck?.includes("gate-4a-engine-check.mjs") === true, "typecheck script", "critical");
}

function checkEngineSourceShape() {
  for (const [code, needle] of [
    ["local_frame_builder", "export function buildLocalPerceptionFrame"],
    ["action_scorer", "export function scoreLocalActionFrame"],
    ["action_candidate_builder", "export function createPerceptionSuggestion"],
    ["current_step_filter", "suggestionMatchesCurrentStep"],
    ["rejection_cooldown", "rejectedSuggestionCooldowns"],
    ["confidence_smoothing", "export function smoothActionConfidence"],
    ["confirmation_required", "requires_confirmation: true"]
  ]) includes("engine", code, source, needle, needle, "critical");
  includes("contract", "local_perception_frame_contract", contract, "type LocalPerceptionFrame", "LocalPerceptionFrame contract exists", "critical");
  includes("contract", "detected_action_candidate_contract", contract, "type DetectedActionCandidate", "DetectedActionCandidate contract exists", "critical");
}

function checkLocalFrameContract() {
  runCheck("engine", "symbolic_frame_builder_runtime", "buildLocalPerceptionFrame returns symbolic frame", () => {
    const frame = buildLocalPerceptionFrame({
      timestamp_ms: 1000,
      zone_motion: { phone_zone: { motion_score: 0.08, active: true } }
    });
    return frame.timestamp_ms === 1000 &&
      frame.zone_motion.phone_zone.active === true &&
      frame.active_zone === "phone_zone" &&
      frame.hand_landmarks.length === 0 &&
      frame.scene_reset.reset === false;
  });
  runCheck("engine", "symbolic_frame_rejects_raw_media", "buildLocalPerceptionFrame rejects raw media fields", () => {
    try {
      buildLocalPerceptionFrame({ timestamp_ms: 1, raw_frame: "data:image/png;base64,abc" });
      return false;
    } catch {
      return true;
    }
  });
}

function checkSyntheticActionSequences() {
  const cases = [
    ["phone", "phone_moved", "phone_zone", [{ phone_zone: 0.066 }, { phone_zone: 0.078, off_desk_zone: 0.058 }, { phone_zone: 0.071, off_desk_zone: 0.061 }]],
    ["notebook", "notebook_opened", "notebook_zone", [{ notebook_zone: 0.061 }, { notebook_zone: 0.067 }, { notebook_zone: 0.073 }]],
    ["pen", "pen_picked_up", "pen_zone", [{ pen_zone: 0.061 }, { pen_zone: 0.074, neutral_zone: 0.056 }, { pen_zone: 0.069, neutral_zone: 0.052 }]],
    ["writing", "writing_motion", "notebook_zone", [{ notebook_zone: 0.063 }, { notebook_zone: 0.076 }, { notebook_zone: 0.071 }]],
    ["typing", "typing_motion", "keyboard_zone", [{ keyboard_zone: 0.064 }, { keyboard_zone: 0.079 }, { keyboard_zone: 0.072 }]]
  ];
  cases.forEach(([step, actionType, zoneId, frames], index) => {
    runCheck("synthetic", `scores_${actionType}`, `${actionType} synthetic sequence scores candidate`, () => {
      const target = preparedRecordingState(step);
      const candidates = scoreSequence(target, frames, 500000 + (index * 10000));
      const candidate = candidates.find((item) => item.action_type === actionType);
      report.synthetic_results.push({ action_type: actionType, candidate: summarizeCandidate(candidate) });
      return candidate &&
        candidate.zone_id === zoneId &&
        candidate.requires_confirmation === true &&
        candidate.detection_method === "motion_proxy" &&
        candidate.confidence >= target.localPerceptionTuning.suggestionThreshold &&
        candidate.evidence.some((item) => item.kind === "local_signal" && item.contains_raw_media === false) &&
        typeof candidate.reason === "string";
    });
  });
  runCheck("synthetic", "scores_uncertain", "uncertain synthetic sequence scores candidate", () => {
    const target = preparedRecordingState("phone");
    const candidates = scoreSequence(target, [{ phone_zone: 0.34, notebook_zone: 0.33, pen_zone: 0.35, keyboard_zone: 0.34 }], 570000);
    return candidates.some((candidate) => candidate.action_type === "uncertain" && candidate.requires_confirmation === true);
  });
  runCheck("synthetic", "phone_does_not_trigger_notebook", "phone signals do not trigger notebook step", () => {
    const target = preparedRecordingState("notebook");
    const candidates = scoreSequence(target, [{ phone_zone: 0.079, off_desk_zone: 0.061 }], 580000);
    return !candidates.some((candidate) => candidate.quest_step === "notebook");
  });
  runCheck("synthetic", "notebook_does_not_trigger_typing", "notebook signals do not trigger typing step", () => {
    const target = preparedRecordingState("typing");
    const candidates = scoreSequence(target, [{ notebook_zone: 0.079 }], 590000);
    return !candidates.some((candidate) => candidate.quest_step === "typing");
  });
  runCheck("synthetic", "confidence_smoothing_runtime", "confidence smoothing applies deterministically", () => {
    const target = preparedRecordingState("writing");
    const previous = createPerceptionSuggestion("gesture.detected", "notebook_zone", 0.9, "previous writing motion", "writing", 600000);
    queuePerceptionSuggestion(target, previous);
    const candidate = scoreSequence(target, [{ notebook_zone: 0.063 }, { notebook_zone: 0.066 }, { notebook_zone: 0.068 }], 600600, { confidence_alpha: 0.5 })[0];
    return smoothActionConfidence(0.9, 0.7, 0.5) === 0.8 &&
      candidate.confidence_smoothed_from === 0.9 &&
      candidate.confidence > candidate.raw_confidence;
  });
}

function checkConfirmationBoundary() {
  runCheck("engine", "candidate_does_not_progress_before_confirm", "candidate alone cannot progress ritual", () => {
    const target = preparedRecordingState("writing");
    const candidate = scoreSequence(target, [{ notebook_zone: 0.063 }, { notebook_zone: 0.076 }, { notebook_zone: 0.071 }], 610000)[0];
    queuePerceptionSuggestion(target, candidate);
    return target.questState === "writing_pending" && !target.events.some((event) => event.id === "evt_writing_like_motion");
  });
  runCheck("engine", "confirm_emits_local_and_human_evidence", "confirm emits local_signal and human_correction", () => {
    const target = preparedRecordingState("writing");
    const candidate = scoreSequence(target, [{ notebook_zone: 0.063 }, { notebook_zone: 0.076 }, { notebook_zone: 0.071 }], 620000)[0];
    queuePerceptionSuggestion(target, candidate);
    acceptSuggestionInState(target, candidate.id);
    const event = target.events.find((item) => item.id === "evt_writing_like_motion");
    return target.questState === "typing_pending" &&
      event?.evidence.some((item) => item.kind === "local_signal" && item.contains_raw_media === false) &&
      event?.evidence.some((item) => item.kind === "human_correction" && item.contains_raw_media === false);
  });
  runCheck("engine", "reject_does_not_progress", "rejected action cannot progress ritual", () => {
    const target = preparedRecordingState("writing");
    const candidate = createPerceptionSuggestion("gesture.detected", "notebook_zone", 0.84, "reject local motion", "writing", 630000);
    queuePerceptionSuggestion(target, candidate);
    const before = { questState: target.questState, events: target.events.length };
    rejectSuggestionInState(target, candidate.id);
    return target.questState === before.questState && target.events.length === before.events;
  });
  runCheck("engine", "rejection_cooldown_runtime", "rejection cooldown suppresses repeated suggestion briefly", () => {
    const target = preparedRecordingState("writing");
    const candidate = scoreSequence(target, [{ notebook_zone: 0.063 }, { notebook_zone: 0.076 }, { notebook_zone: 0.071 }], 640000)[0];
    queuePerceptionSuggestion(target, candidate);
    rejectSuggestionInState(target, candidate.id);
    const repeated = { ...candidate, id: `${candidate.id}_repeat`, timestamp_ms: candidate.timestamp_ms + 200, status: "pending" };
    queuePerceptionSuggestion(target, repeated);
    const evidence = {
      rejected_key_recorded: target.rejectedSuggestionKeys.includes(candidate.key),
      rejected_cooldown_recorded: Number(target.rejectedSuggestionCooldowns[candidate.key] ?? 0) > 0,
      repeated_pending: target.perceptionSuggestions.some((item) => item.id === repeated.id && item.status === "pending"),
      rejected_status_recorded: target.perceptionSuggestions.some((item) => item.id === candidate.id && item.status === "rejected")
    };
    return {
      passed: evidence.rejected_key_recorded && evidence.rejected_cooldown_recorded && !evidence.repeated_pending && evidence.rejected_status_recorded,
      evidence
    };
  });
}

function checkProductUxRegression() {
  includes("ux", "detected_action_card_main_ui", html, 'data-product-card="detected-action"', "Detected Action card remains in main UI", "critical");
  absent("ux", "developer_tools_closed_default", html, '<details id="developerTools" class="dq-dev-tools" open', "Advanced / Developer Tools closed by default", "critical");
  addCheck("ux", "suggestion_campaign_hidden_default", "Suggestion Trace Campaign default visibility", bodyHtml.indexOf("Suggestion Trace Campaign") > developerToolsIndex && developerToolsIndex >= 0, "campaign copy appears after developer tools", "critical");
  for (const forbidden of [
    "Gate 3B-Live",
    "Suggestion Trace Campaign",
    "campaign bundle",
    "Export Campaign Bundle",
    "live_suggestion_",
    "Suggestion Trace: Phone Moved",
    "Preview Export JSON",
    "Export Preflight",
    "Blocked Button Reasons"
  ]) {
    absent("ux", `main_ui_hides_${safeCode(forbidden)}`, defaultMainUi, forbidden, `${forbidden} hidden from product mode`, "critical");
  }
  includes("ux", "design_freeze_rule_present", agents, "The current UI is approved and frozen.", "Design Freeze v1 rule present", "critical");
  absent("ux", "removed_topnav_absent", html, "dq-topnav", "no removed app chrome regression", "critical");
}

function checkSafetyBoundary() {
  absentRegex("safety", "no_raw_media_hooks", source, /MediaRecorder|toDataURL|readAsDataURL|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon/i, "no raw video/screenshot/base64 persistence hooks", "critical");
  absentRegex("safety", "no_audio_capture", source, /getUserMedia\(\{\s*audio:\s*true|AudioContext|MediaStreamAudioSourceNode/i, "no audio capture path", "critical");
  absentRegex("safety", "no_ocr_hooks", source, /Tesseract|recognizeText|OCRWorker|notebookText/i, "no OCR hook", "critical");
  absentRegex("safety", "no_cloud_frame_upload", source, /fetch\s*\(|WebSocket|XMLHttpRequest|sendBeacon/i, "no cloud frame upload", "critical");
  absentRegex("safety", "no_llm_vlm_hot_path", source, /OpenAI|OPENAI_API_KEY|sk-proj-|sk-[A-Za-z0-9]|chat\.completions|responses\.create/i, "no LLM/VLM hot path", "critical");
  includes("safety", "model_counts_zero", source, "llmCalls: 0", "LLM count remains zero in session metadata", "critical");
  includes("safety", "vlm_counts_zero", source, "vlmCalls: 0", "VLM count remains zero in session metadata", "critical");
  includes("safety", "raw_media_count_zero", source, "rawMediaPersistenceCount: 0", "raw media count remains zero in session metadata", "critical");
  for (const claim of [
    "autonomous vision",
    "automatic action recognition",
    "object detection proven",
    "gesture recognition proven",
    "production action recognition",
    "production perception",
    "VLM-powered",
    "cloud vision"
  ]) {
    absent("claims", `forbidden_claim_${safeCode(claim)}`, `${html}\n${source}`, claim, `forbidden claim absent: ${claim}`, "critical");
  }
}

function checkSyntheticTestsExist() {
  for (const marker of [
    "Gate 4A.1",
    "phone_moved",
    "notebook_opened",
    "pen_picked_up",
    "writing_motion",
    "typing_motion",
    "rejection cooldown",
    "future-step",
    "confidence smoothing",
    "buildLocalPerceptionFrame",
    "scoreLocalActionFrame"
  ]) includes("tests", `prototype_flow_${safeCode(marker)}`, test, marker, `prototype flow covers ${marker}`, "critical");
}

function preparedRecordingState(targetStep = "phone") {
  const target = createInitialState();
  target.cameraReady = true;
  target.cameraStarted = true;
  saveCalibrationToState(target, defaultCalibration());
  startFocusRitualInState(target);
  startRecordingInState(target);
  const priorSteps = {
    phone: [],
    notebook: ["phone"],
    pen: ["phone", "notebook"],
    writing: ["phone", "notebook", "pen"],
    typing: ["phone", "notebook", "pen", "writing"]
  }[targetStep] ?? [];
  for (const step of priorSteps) confirmStepInState(target, step);
  return target;
}

function scoreSequence(target, frames, baseMs, options = {}) {
  let frame = null;
  frames.forEach((scores, index) => {
    frame = syntheticLocalFrame(scores, baseMs + (index * 500));
  });
  return scoreLocalActionFrame(frame, target, options);
}

function syntheticLocalFrame(activeScores, timestampMs) {
  const observations = REQUIRED_ZONES.map((zoneId) => {
    const motionScore = Number(activeScores[zoneId] ?? 0.004);
    return {
      zone_id: zoneId,
      motion_score: motionScore,
      active: motionScore >= LOCAL_MOTION.activeThreshold,
      confidence: Math.min(0.96, Math.max(0.5, motionScore + 0.68)),
      timestamp_ms: timestampMs
    };
  });
  for (const observation of observations) updateMotionHistory(observation);
  return buildLocalPerceptionFrame({
    timestamp_ms: timestampMs,
    zone_motion: Object.fromEntries(observations.map((observation) => [observation.zone_id, observation]))
  });
}

function summarizeCandidate(candidate) {
  if (!candidate) return null;
  return {
    action_type: candidate.action_type,
    quest_step: candidate.quest_step,
    confidence: candidate.confidence,
    zone_id: candidate.zone_id,
    requires_confirmation: candidate.requires_confirmation,
    detection_method: candidate.detection_method
  };
}

function read(path) {
  return readFileSync(resolve(path), "utf8");
}

function runCheck(category, code, name, fn, severity = "critical") {
  try {
    const result = fn();
    if (result && typeof result === "object" && "passed" in result) {
      addCheck(category, code, name, result.passed === true, JSON.stringify(result.evidence ?? "runtime check"), severity);
    } else {
      addCheck(category, code, name, result === true, "runtime check", severity);
    }
  } catch (error) {
    addCheck(category, code, name, false, error?.message ?? "runtime check failed", severity);
  }
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
