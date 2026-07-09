#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CORRECTION_MEMORY_MAX_ITEMS,
  MOVEMENT_HISTORY_MAX_ITEMS,
  MOVEMENT_RECOGNITION_CLIENT_CONFIG,
  clearCorrectionMemory,
  clearMovementFrameBuffer,
  clearMovementHistory,
  confirmMovementResultInState,
  createInitialState,
  queueMovementRecognitionResult,
  showMovementCorrectionInState,
  submitMovementCorrectionInState
} from "../../perception/browser-local-capture/prototype/local-capture.js";
import {
  DEFAULT_MOVEMENT_RECOGNITION_CONFIG,
  MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES,
  MOVEMENT_NARRATION_PROMPT_VERSION,
  buildHuggingFaceVlmRequestBody,
  buildMovementRecognitionPrompt
} from "../../perception/browser-local-capture/server/movement-recognition-provider.mjs";

const REPORT_PATH = "runs/gate-v1-research-latest.json";
const files = {
  packageJson: "package.json",
  html: "packages/perception/browser-local-capture/prototype/index.html",
  source: "packages/perception/browser-local-capture/prototype/local-capture.js",
  provider: "packages/perception/browser-local-capture/server/movement-recognition-provider.mjs",
  server: "packages/perception/browser-local-capture/server/movement-recognition-server.mjs",
  movementTest: "packages/perception/browser-local-capture/test/movement-recognition.test.mjs",
  prototypeTest: "packages/perception/browser-local-capture/test/prototype-flow.test.mjs",
  correctionContract: "docs/contracts/movement-correction-memory.v0.md",
  promptContract: "docs/contracts/movement-narration-prompt.v2.md",
  resultsDoc: "docs/evals/darkquest-v1-1-research-layer-results.md"
};

const packageJson = JSON.parse(read(files.packageJson));
const html = read(files.html);
const source = read(files.source);
const provider = read(files.provider);
const server = read(files.server);
const movementTest = read(files.movementTest);
const prototypeTest = read(files.prototypeTest);
const correctionContract = read(files.correctionContract);
const promptContract = read(files.promptContract);
const resultsDoc = read(files.resultsDoc);
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const mainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;

const report = {
  schema: "darkquest.gate_v1_research_layer_report.v0",
  gate: "v1_research_layer",
  claim: "DarkQuest v1.1 research-layer behavior is implemented in state, prompt, safety, and product-freeze boundaries, not only documented.",
  generated_at: new Date().toISOString(),
  files_checked: files,
  checks: [],
  final_verdict: "FAIL"
};

checkPackage();
checkMovementHistoryBehavior();
checkCorrectionLoopBehavior();
checkPromptV2Behavior();
checkResearchLabBoundary();
checkConfidenceCalibration();
checkResultCardStability();
checkOneShotCostGuard();
checkProviderSafety();
checkProductFreeze();
checkTestCoverage();
checkResultsDoc();

const failures = report.checks.filter((check) => !check.passed && check.severity === "critical");
report.failure_count = failures.length;
report.failures = failures;
report.final_verdict = failures.length ? "FAIL" : "PASS_WITH_DISCLOSURE";

mkdirSync("runs", { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate v1.1 research layer check`);
console.log(`report: ${REPORT_PATH}`);
console.log(`checks: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}`);
for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);

process.exit(failures.length ? 1 : 0);

function checkPackage() {
  const scripts = packageJson.scripts ?? {};
  includes("package", "script_exists", scripts["gate:v1:research"] ?? "", "gate-v1-research-layer-check.mjs", "npm run gate:v1:research exists", "critical");
  includes("package", "typecheck_includes_gate", scripts.typecheck ?? "", "gate-v1-research-layer-check.mjs", "typecheck includes research gate", "critical");
}

function checkMovementHistoryBehavior() {
  addCheck("history", "cap_constant", "movement history max length is 10", MOVEMENT_HISTORY_MAX_ITEMS === 10, String(MOVEMENT_HISTORY_MAX_ITEMS), "critical");
  const target = createInitialState();
  for (let index = 0; index < 12; index += 1) {
    queueMovementRecognitionResult(target, {
      movement: `You moved your hand ${index}.`,
      short_label: `Movement ${index}`,
      confidence: 0.72,
      reason: "synthetic gate result",
      evidence: ["text-only behavioral check"],
      provider: "huggingface",
      model: "google/gemma-4-31B-it:cerebras",
      latency_ms: 20
    }, 1000 + index);
  }
  const historyJson = JSON.stringify(target.movementHistory);
  const historyEntry = target.movementHistory.entries[0] ?? {};
  addCheck("history", "session_only", "movement history is session-only state", target.movementHistory.storage === "session_only", target.movementHistory.storage, "critical");
  addCheck("history", "text_only", "movement history format is text-only", target.movementHistory.format === "text_only", target.movementHistory.format, "critical");
  addCheck("history", "max_length", "movement history is capped at 10 entries", target.movementHistory.entries.length === 10, String(target.movementHistory.entries.length), "critical");
  addCheck("history", "movement_text_only_keys", "history entries store movement text only", sameKeys(historyEntry, ["movement"]), Object.keys(historyEntry).join(","), "critical");
  absentRegex("history", "no_media", historyJson, /frame|screenshot|base64|data:image|encoded_frame|raw provider|request body/i, "history stores no media or raw provider request body", "critical");
  absentRegex("history", "no_provider_metadata", JSON.stringify(historyEntry), /provider|model|latency|confidence|token/i, "history entries do not store provider metadata", "critical");
  clearMovementHistory(target);
  addCheck("history", "clearable", "movement history can be cleared", target.movementHistory.entries.length === 0, String(target.movementHistory.entries.length), "critical");
  addCheck("history", "below_result", "movement history does not appear above camera/button/result", mainUi.indexOf('id="movementHistoryPanel"') > mainUi.indexOf('id="movementResultTitle"'), "history after result", "critical");
}

function checkCorrectionLoopBehavior() {
  addCheck("correction", "cap_constant", "correction memory max length is 10", CORRECTION_MEMORY_MAX_ITEMS === 10, String(CORRECTION_MEMORY_MAX_ITEMS), "critical");
  includes("correction", "not_this_button", html, 'id="correctMovement"', "Not this / Correct button exists", "critical");
  includes("correction", "actual_prompt", html, "What did you actually do?", "correction asks what actually happened", "critical");

  const target = createInitialState();
  queueMovementRecognitionResult(target, {
    movement: "You waved your hand.",
    short_label: "Wave",
    confidence: 0.64,
    reason: "synthetic gate result",
    evidence: ["hand moved"],
    provider: "huggingface",
    model: "google/gemma-4-31B-it:cerebras"
  }, 2000);
  showMovementCorrectionInState(target);
  addCheck("correction", "opens_input", "Not this opens correction input state", target.correctionDraft.open === true, JSON.stringify(target.correctionDraft), "critical");
  submitMovementCorrectionInState(target, "I pointed at the camera; data:image/jpeg;base64,AAAA named Sam male age 30.");
  const entry = target.correctionMemory.entries[0] ?? {};
  const entryJson = JSON.stringify(entry);
  addCheck("correction", "stores_original", "correction stores original_movement", entry.original_movement === "You waved your hand.", entry.original_movement ?? "", "critical");
  addCheck("correction", "stores_corrected", "correction stores corrected_movement", typeof entry.corrected_movement === "string" && entry.corrected_movement.includes("pointed"), entry.corrected_movement ?? "", "critical");
  addCheck("correction", "raw_media_false", "correction includes contains_raw_media false", entry.contains_raw_media === false, String(entry.contains_raw_media), "critical");
  addCheck("correction", "biometric_false", "correction includes contains_biometric_identity false", entry.contains_biometric_identity === false, String(entry.contains_biometric_identity), "critical");
  addCheck("correction", "session_only", "correction entry is session-only", entry.session_only === true && target.correctionMemory.storage === "session_only", entryJson, "critical");
  absentRegex("correction", "no_media", entryJson, /data:image|base64|encoded_frame|screenshot|raw frame|raw video/i, "correction stores no image data", "critical");
  absentRegex("correction", "no_sensitive", entryJson, /\b(named|male|female|man|woman|boy|girl|race|ethnicity|age)\b/i, "correction stores no sensitive attributes", "critical");
  addCheck("correction", "updates_snapshot", "correction updates current result snapshot without confirming it", target.movementResultSnapshot?.corrected === true && target.movementResultSnapshot.confirmed === false, JSON.stringify(target.movementResultSnapshot), "critical");
  clearCorrectionMemory(target);
  addCheck("correction", "clearable", "correction memory can be cleared", target.correctionMemory.entries.length === 0, String(target.correctionMemory.entries.length), "critical");
  includes("correction", "contract_text_only", correctionContract, "Correction memory is text-only", "correction contract text-only", "critical");
  includes("correction", "contract_flags", correctionContract, "contains_biometric_identity: false", "correction contract has safety flags", "critical");
}

function checkPromptV2Behavior() {
  const prompt = buildMovementRecognitionPrompt(["uncertain"], "movement_narration", { neutral_zone: {} }, [{
    original_movement: "You waved. data:image/jpeg;base64,AAAA",
    corrected_movement: "I pointed at the camera."
  }]);
  for (const marker of ["Frame 1", "Frame 2", "Frame 3", "Frame 4", "compare frames over time", "movement", "short_label", "confidence", "reason", "evidence", "uncertainty", "requires_confirmation"]) {
    includes("prompt_v2", safeCode(marker), prompt, marker, `prompt includes ${marker}`, "critical");
  }
  includes("prompt_v2", "model_said", prompt, "Model said:", "prompt includes correction context", "critical");
  includes("prompt_v2", "user_corrected", prompt, "User corrected:", "prompt includes user correction context", "critical");
  includes("prompt_v2", "wording_only", prompt, "Use these corrections only to improve movement wording", "corrections scoped to wording", "critical");
  includes("prompt_v2", "no_identity_rule", prompt, "do not identify the person", "prompt forbids identity", "critical");
  includes("prompt_v2", "no_sensitive_rule", prompt, "do not describe sensitive attributes", "prompt forbids sensitive attributes", "critical");
  includes("prompt_v2", "no_appearance_rule", prompt, "do not judge appearance", "prompt forbids appearance judgments", "critical");
  includes("prompt_v2", "allows_uncertainty", prompt, "Uncertain", "prompt allows uncertainty", "critical");
  absentRegex("prompt_v2", "no_old_images", prompt, /data:image|base64|encoded_frame|old image|old frame data/i, "prompt correction context sends no old images/frame data", "critical");
  includes("prompt_v2", "contract_frame_1_4", promptContract, "Frame 1, Frame 2, Frame 3, and Frame 4", "prompt v2 contract names frames", "critical");
  addCheck("prompt_v2", "version_constant", "provider prompt version is v2", MOVEMENT_NARRATION_PROMPT_VERSION === "movement-narration-prompt.v2", MOVEMENT_NARRATION_PROMPT_VERSION, "critical");
}

function checkResearchLabBoundary() {
  const researchIndex = bodyHtml.indexOf('id="researchLabPanel"');
  addCheck("research_lab", "exists", "Research Lab exists", researchIndex >= 0, String(researchIndex), "critical");
  addCheck("research_lab", "under_dev_tools", "Research Lab is inside Developer Tools only", researchIndex > developerToolsIndex && developerToolsIndex >= 0, `${researchIndex} > ${developerToolsIndex}`, "critical");
  absent("research_lab", "not_main_ui", mainUi, "Research Lab", "Research Lab does not appear above camera/button/result", "critical");
  absent("research_lab", "not_open_default", html, '<details id="researchLabPanel" class="dq-card dq-technical-card" open', "Research Lab collapsed by default", "critical");
  const block = sliceBetween(bodyHtml, 'id="researchLabPanel"', 'id="diagnosticsCard"');
  for (const marker of ["researchProvider", "researchRequestedModel", "researchReturnedModel", "researchLatency", "researchPromptVersion", "researchImageTokens", "researchRetries", "researchCandidateFailures", "researchLastSafeError", "researchHistoryCount", "researchCorrectionCount", "researchOneShotGuard"]) {
    includes("research_lab", safeCode(marker), block, marker, `Research Lab includes ${marker}`, "critical");
  }
  absentRegex("research_lab", "no_token", block, /HF_TOKEN|hf_[A-Za-z0-9]{12,}|Authorization|Bearer/i, "Research Lab shows no token", "critical");
  absentRegex("research_lab", "no_raw_payload", block, /data:image|base64|raw frame|raw video|screenshot|provider payload|request body/i, "Research Lab shows no raw frames or full image payload", "critical");
}

function checkConfidenceCalibration() {
  const target = createInitialState();
  queueMovementRecognitionResult(target, {
    movement: "You raised your hand.",
    short_label: "Hand raise",
    confidence: 0.82,
    reason: "synthetic gate result",
    evidence: ["hand moved"],
    uncertainty: false
  }, 3000);
  confirmMovementResultInState(target);
  queueMovementRecognitionResult(target, {
    movement: "Uncertain — try again.",
    short_label: "Uncertain",
    confidence: 0.2,
    reason: "synthetic unclear result",
    evidence: ["static frames"],
    uncertainty: true
  }, 4000);
  showMovementCorrectionInState(target);
  submitMovementCorrectionInState(target, "I leaned closer to the camera.");
  addCheck("confidence", "results_count", "confidence calibration tracks results_count", target.confidenceCalibration.results_count === 2, JSON.stringify(target.confidenceCalibration), "critical");
  addCheck("confidence", "confirmed_count", "confidence calibration tracks confirmed_count", target.confidenceCalibration.confirmed_count === 1, JSON.stringify(target.confidenceCalibration), "critical");
  addCheck("confidence", "corrected_count", "confidence calibration tracks corrected_count", target.confidenceCalibration.corrected_count === 1, JSON.stringify(target.confidenceCalibration), "critical");
  addCheck("confidence", "uncertain_count", "confidence calibration tracks uncertain_count", target.confidenceCalibration.uncertain_count === 1, JSON.stringify(target.confidenceCalibration), "critical");
  includes("confidence", "low_confidence_softening", source, "I’m not fully sure", "low-confidence wording is softened", "critical");
  includes("confidence", "calibrated_sentence", source, "calibratedMovementSentence", "calibrated movement sentence function exists", "critical");
  absentRegex("confidence", "no_fake_precision_claims", mainUi, /production certainty|always correct|guaranteed|proven action recognition/i, "main UI has no fake precision claims", "critical");
  const resultBlock = sliceBetween(mainUi, 'id="movementResultTitle"', 'id="currentManualAction"');
  addCheck("confidence", "secondary_to_sentence", "confidence is secondary to movement sentence", resultBlock.indexOf("Confidence") > resultBlock.indexOf('id="cameraSuggestions"'), "confidence after result hero", "critical");
}

function checkResultCardStability() {
  includes("stability", "snapshot_state", source, "movementResultSnapshot", "movementResultSnapshot exists", "critical");
  includes("stability", "live_camera_state", source, "liveCameraState", "liveCameraState exists separately", "critical");
  const localMotionBlock = sliceBetween(source, "function applyLocalMotionObservations", "export function updateMotionHistory");
  absent("stability", "local_motion_no_snapshot_mutation", localMotionBlock, "movementResultSnapshot", "camera motion does not mutate movementResultSnapshot", "critical");
  includes("stability", "result_id_animation", source, "snapshot.result_id !== lastMovementRevealResultId", "result reveal animation is keyed to result_id", "critical");
  const renderKeyBlock = sliceBetween(source, "function movementResultRenderKey", "function movementResultDetailKey");
  absent("stability", "render_key_no_live_camera", renderKeyBlock, "liveCameraState", "liveCameraState does not reset result animation", "critical");
  const detailKeyBlock = sliceBetween(source, "function movementResultDetailKey", "function readableDetailHtml");
  absent("stability", "detail_key_no_voice", detailKeyBlock, "voiceStatus", "voice status does not rewrite hero result", "critical");
  const sentenceCss = sliceBetween(html, ".dq-movement-sentence", ".dq-movement-hint");
  absent("stability", "no_ellipsis", sentenceCss, "ellipsis", "movement sentence is never truncated with ellipsis", "critical");
  absent("stability", "no_line_clamp", sentenceCss, "-webkit-line-clamp", "movement sentence has no line clamp", "critical");
  includes("stability", "why_collapsed", html, 'id="movementWhy" class="dq-readable-detail dq-result-details" data-collapsed-default="true"', "Why/details collapsed by default", "critical");
}

function checkOneShotCostGuard() {
  includes("cost", "explicit_click", source, 'boundDom.analyzeMovement?.addEventListener("click", () => analyzeMovementInState(state))', "AI call starts from explicit click", "critical");
  const startCameraBlock = sliceBetween(source, "async function startCamera", "function stopCamera");
  absent("cost", "no_camera_start_call", startCameraBlock, "analyzeMovementInState", "no AI call on camera start", "critical");
  includes("cost", "request_in_flight", source, "target.movementRecognition.requestInFlight ||", "double-click cannot duplicate calls", "critical");
  includes("cost", "hidden_tab", source, "document.hidden", "hidden tab blocks capture", "critical");
  includes("cost", "button_disabled", source, "dom.analyzeMovement.disabled = !state.cameraReady || analyzing", "button disabled during capture/analyze", "critical");
  includes("cost", "max_frames_client", source, "Math.min(config.maxFrames ?? 4, 4)", "max frames capped", "critical");
  addCheck("cost", "client_max_frames", "client config max frames capped at 4", MOVEMENT_RECOGNITION_CLIENT_CONFIG.maxFrames === 4, String(MOVEMENT_RECOGNITION_CLIENT_CONFIG.maxFrames), "critical");
  addCheck("cost", "candidate_max", "provider candidates capped", MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES === 5, String(MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES), "critical");
  includes("cost", "candidate_slice", provider, ".slice(0, MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES)", "candidate attempts/retries capped by ladder", "critical");
  includes("cost", "frames_cleared_finally", source, "finally {\n    clearMovementFrameBuffer(frames);", "frames cleared in finally", "critical");
  const frames = [{ encoded_frame: "abc", data_uri: "data:image/jpeg;base64,abc" }];
  clearMovementFrameBuffer(frames);
  addCheck("cost", "frame_clear_behavior", "frame buffer cleanup clears and empties transient frames", frames.length === 0, JSON.stringify(frames), "critical");
  absentRegex("cost", "no_auto_repeat", source, /setInterval\([^)]*analyzeMovementInState|requestAnimationFrame\([^)]*analyzeMovementInState|if \(state\.cameraReady\) await analyzeMovementInState/i, "no automatic repeat after result", "critical");
  includes("cost", "live_disabled", html, 'id="liveNarratorMode" name="movementNarratorMode" type="radio" value="live" disabled', "continuous live narrator disabled", "critical");
}

function checkProviderSafety() {
  addCheck("provider", "known_route", "known Cerebras route preserved", DEFAULT_MOVEMENT_RECOGNITION_CONFIG.model === "google/gemma-4-31B-it:cerebras", DEFAULT_MOVEMENT_RECOGNITION_CONFIG.model, "critical");
  includes("provider", "server_health", server, "/api/movement-recognition/health", "health endpoint exists", "critical");
  includes("provider", "server_analyze", server, "/api/movement-recognition/analyze", "analyze endpoint exists", "critical");
  absentRegex("provider", "frontend_no_token", source, /process\.env\.HF_TOKEN|Authorization:\s*`Bearer|hf_secret|hf_test|hf_[A-Za-z0-9]{12,}/, "frontend does not expose token", "critical");
  absentRegex("provider", "no_persistence_hooks", source, /localStorage|sessionStorage|indexedDB|MediaRecorder|readAsDataURL|navigator\.sendBeacon/i, "no raw media persistence hooks", "critical");
  const body = buildHuggingFaceVlmRequestBody({
    model: DEFAULT_MOVEMENT_RECOGNITION_CONFIG.model,
    prompt: "test",
    frames: [{ mime_type: "image/jpeg", encoded_frame: "abc" }]
  });
  addCheck("provider", "router_payload_shape", "provider request uses OpenAI-compatible messages only", sameKeys(body, ["model", "messages", "stream"]), Object.keys(body).join(","), "critical");
}

function checkProductFreeze() {
  for (const text of ["Focus Ritual", "Gate 1C", "Gate 3B", "Gate 4A", "trace", "fixture", "JSON", "Recent Events", "hand.left_zone", "neutral_zone", "zone_*"]) {
    absent("freeze", safeCode(text), mainUi, text, `main UI excludes ${text}`, "critical");
  }
  for (const word of ["phone", "notebook", "pen", "keyboard"]) {
    absentRegex("freeze", `word_${word}`, mainUi, new RegExp(`\\b${word}\\b`, "i"), `main UI excludes standalone ${word}`, "critical");
  }
  absentRegex("freeze", "zone_prefix", mainUi, /\bzone_[a-z0-9_]+/i, "main UI excludes zone_*", "critical");
  addCheck("freeze", "camera_before_button", "camera remains before movement button", mainUi.indexOf('id="cameraTitle"') < mainUi.indexOf('id="analyzeMovement"'), "camera before button", "critical");
  addCheck("freeze", "button_before_result", "movement button remains before result", mainUi.indexOf('id="analyzeMovement"') < mainUi.indexOf('id="movementResultTitle"'), "button before result", "critical");
}

function checkTestCoverage() {
  for (const marker of [
    "movement history is capped at 10",
    "correction context is sent on the next provider request",
    "What did you actually do?",
    "contains_biometric_identity: false",
    "voice state changes do not resize the result card"
  ]) includes("tests", safeCode(marker), `${movementTest}\n${prototypeTest}`, marker, `tests cover ${marker}`, "critical");
  includes("tests", "research_lab_field_loop", `${movementTest}\n${prototypeTest}`, "researchPromptVersion", "tests cover Research Lab prompt version metadata", "critical");
  includes("tests", "research_lab_assertion", `${movementTest}\n${prototypeTest}`, "Research Lab includes", "tests assert Research Lab safe fields", "critical");
}

function checkResultsDoc() {
  for (const marker of ["gate:v1:research", "PASS_WITH_DISCLOSURE", "Movement history", "Correction loop", "Prompt v2", "HF_TOKEN"]) {
    includes("results", safeCode(marker), resultsDoc, marker, `results doc includes ${marker}`, "critical");
  }
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

function sameKeys(value, keys) {
  return JSON.stringify(Object.keys(value ?? {}).sort()) === JSON.stringify([...keys].sort());
}

function safeCode(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sliceBetween(haystack, start, end) {
  const startIndex = haystack.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = haystack.indexOf(end, startIndex + start.length);
  return haystack.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}
