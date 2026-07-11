#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPORT_PATH = "runs/gate-v1-latest.json";
const files = {
  packageJson: "package.json",
  html: "packages/perception/browser-local-capture/prototype/index.html",
  source: "packages/perception/browser-local-capture/prototype/local-capture.js",
  visualProvider: "packages/perception/browser-local-capture/server/visual-companion-provider.mjs",
  provider: "packages/perception/browser-local-capture/server/movement-recognition-provider.mjs",
  server: "packages/perception/browser-local-capture/server/movement-recognition-server.mjs",
  movementTest: "packages/perception/browser-local-capture/test/movement-recognition.test.mjs",
  visualTest: "packages/perception/browser-local-capture/test/visual-companion.test.mjs",
  prototypeTest: "packages/perception/browser-local-capture/test/prototype-flow.test.mjs",
  correctionMemoryContract: "docs/contracts/movement-correction-memory.v0.md",
  promptV2Contract: "docs/contracts/movement-narration-prompt.v2.md",
  resultsDoc: "docs/evals/darkquest-v1-1-research-layer-results.md",
  agents: "AGENTS.md"
};

const packageJson = JSON.parse(read(files.packageJson));
const html = read(files.html);
const source = read(files.source);
const visualProvider = read(files.visualProvider);
const provider = read(files.provider);
const server = read(files.server);
const movementTest = read(files.movementTest);
const visualTest = read(files.visualTest);
const prototypeTest = read(files.prototypeTest);
const correctionMemoryContract = read(files.correctionMemoryContract);
const promptV2Contract = read(files.promptV2Contract);
const resultsDoc = read(files.resultsDoc);
const agents = read(files.agents);
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const mainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;

const report = {
  schema: "darkquest.gate_v1_product_freeze_report.v0",
  gate: "v1_product_freeze",
  claim: "The DarkQuest visual companion product surface is frozen around Camera -> Observe now -> Big result, with mirrored preview, one-shot cost guards, reliable states, voice safety, and local provider privacy preserved.",
  generated_at: new Date().toISOString(),
  files_checked: files,
  checks: [],
  final_verdict: "FAIL"
};

checkPackage();
checkProductSurface();
checkHierarchy();
checkForbiddenMainUi();
checkMirroredCamera();
checkOneShotCostGuard();
checkReliability();
checkResultHero();
checkResultCardStability();
checkResearchFeatures();
checkResearchLab();
checkVoice();
checkProviderSafety();
checkResultsDoc();
checkTestCoverage();

const failures = report.checks.filter((check) => !check.passed && check.severity === "critical");
report.failure_count = failures.length;
report.failures = failures;
report.final_verdict = failures.length ? "FAIL" : "PASS_WITH_DISCLOSURE";

mkdirSync("runs", { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate v1 product freeze check`);
console.log(`report: ${REPORT_PATH}`);
console.log(`checks: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
}

process.exit(failures.length ? 1 : 0);

function checkPackage() {
  const scripts = packageJson.scripts ?? {};
  addCheck("package", "gate_v1_script", "npm run gate:v1 exists", scripts["gate:v1"]?.includes("gate-v1-product-freeze-check.mjs") === true, "package script", "critical");
  addCheck("package", "typecheck_includes_gate_v1", "typecheck includes v1 checker", scripts.typecheck?.includes("gate-v1-product-freeze-check.mjs") === true, "typecheck script", "critical");
}

function checkProductSurface() {
  for (const marker of [
    "Capture Studio",
    "Start the camera to begin",
    "Observe",
    "Visual Response",
    "Voice & Actions",
    "Speak again",
    "Auto-speak on",
    "Gesture Recipes",
    "Movement History",
    "Privacy & Model Usage",
    "Developer Tools"
  ]) includes("surface", safeCode(marker), mainUi, marker, `main UI includes ${marker}`, "critical");
  includes("surface", "movement_sentence", html, "dq-movement-sentence", "movement sentence hero exists", "critical");
  includes("surface", "movement_summary_secondary", html, "dq-movement-summary-row", "confidence/details summary is secondary", "critical");
}

function checkHierarchy() {
  const cameraIndex = mainUi.indexOf('id="cameraTitle"');
  const controlIndex = mainUi.indexOf('id="analyzeMovement"');
  const resultIndex = mainUi.indexOf('id="movementResultTitle"');
  addCheck("hierarchy", "camera_before_control", "camera appears before movement control", cameraIndex >= 0 && cameraIndex < controlIndex, `${cameraIndex} < ${controlIndex}`, "critical");
  addCheck("hierarchy", "control_before_result", "movement control appears before result", controlIndex >= 0 && controlIndex < resultIndex, `${controlIndex} < ${resultIndex}`, "critical");
  const resultBlock = mainUi.slice(resultIndex, mainUi.indexOf('id="currentManualAction"'));
  addCheck("hierarchy", "result_not_debug", "result block is not debug/eval content", !/gate|trace|json fixture|recent events/i.test(resultBlock), resultBlock.slice(0, 120), "critical");
}

function checkForbiddenMainUi() {
  for (const text of [
    "Focus Ritual",
    "Gate 1C",
    "Gate 3B",
    "Gate 4A",
    "trace campaign",
    "trace",
    "fixture",
    "JSON",
    "JSON fixture",
    "Recent Events",
    "hand.left_zone",
    "hand.entered_zone",
    "zone.activated",
    "neutral_zone",
    "phone_zone",
    "notebook_zone",
    "pen_zone",
    "keyboard_zone",
    "zone_*"
  ]) absent("forbidden", safeCode(text), mainUi, text, `main UI excludes ${text}`, "critical");
  for (const word of ["phone", "notebook", "pen", "keyboard"]) {
    addCheck("forbidden", `word_${word}`, `main UI excludes standalone ${word}`, !new RegExp(`\\b${word}\\b`, "i").test(mainUi), word, "critical");
  }
  absentRegex("forbidden", "zone_prefix", mainUi, /\bzone_[a-z0-9_]+/i, "main UI excludes zone_*", "critical");
}

function checkMirroredCamera() {
  includes("mirror", "preview_transform", html, "#preview", "preview CSS exists", "critical");
  includes("mirror", "mirror_scale", html, "transform: scaleX(-1)", "preview is mirrored by default", "critical");
  includes("mirror", "mirror_config", source, "mirrorFramesToPreview: true", "capture mirroring is explicit", "critical");
  includes("mirror", "canvas_translate", source, "context.translate(width, 0)", "canvas mirror translates before capture", "critical");
  includes("mirror", "canvas_scale", source, "context.scale(-1, 1)", "canvas mirror scales safely", "critical");
  includes("mirror", "frame_cleanup", source, "clearMovementFrameBuffer", "mirror path still clears frame buffers", "critical");
  absentRegex("mirror", "no_token_or_media_state", source, /indexedDB|MediaRecorder|navigator\.sendBeacon/i, "mirror state does not persist token/media", "critical");
}

function checkOneShotCostGuard() {
  includes("cost", "user_click_handler", source, 'boundDom.analyzeMovement?.addEventListener("click"', "provider path starts from user click", "critical");
  includes("cost", "no_duplicate_guard", source, '["checking", "capturing", "analyzing"].includes(target.movementRecognition.status)', "double click guard exists", "critical");
  includes("cost", "button_disabled", source, "dom.analyzeMovement.disabled = !state.cameraReady || analyzing", "button disabled while capturing/analyzing", "critical");
  includes("cost", "one_window", source, "captureMovementFrameWindow", "one capture window function exists", "critical");
  includes("cost", "max_frames_client", source, "Math.min(config.maxFrames ?? 4, 8)", "client frame count capped", "critical");
  includes("cost", "max_candidates", provider, "MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES", "provider candidate count capped", "critical");
  includes("cost", "candidate_slice", provider, ".slice(0, MAX_MOVEMENT_RECOGNITION_MODEL_CANDIDATES)", "candidate ladder slice cap exists", "critical");
  includes("cost", "live_disabled", html, 'id="liveNarratorMode" name="movementNarratorMode" type="radio" value="live" disabled', "live narrator off by default", "critical");
  absentRegex("cost", "no_repeating_analyze_loop", source, /setInterval\([^)]*analyzeMovementInState|requestAnimationFrame\([^)]*analyzeMovementInState/i, "no repeating analyze loop in one-shot mode", "critical");
  includes("cost", "no_continuous_upload_copy", mainUi, "No continuous upload.", "no continuous upload disclosure", "critical");
  includes("cost", "frame_buffer_cleared", source, 'frame.data_uri = ""', "frame buffers cleared after request", "critical");
  includes("cost", "hidden_tab_guard", source, "document.hidden", "no calls while tab hidden", "critical");
  includes("cost", "request_in_flight", source, "requestInFlight", "duplicate request guard exists", "critical");
}

function checkReliability() {
  for (const marker of [
    "Start Camera",
    "Observe now",
    "Get ready",
    "Watching",
    "Understanding what changed",
    "Observe again",
    "Model not installed",
    "Visual companion endpoint unavailable",
    "Camera frame could not be read"
  ]) includes("reliability", safeCode(marker), `${html}\n${source}`, marker, `state exists: ${marker}`, "critical");
  includes("reliability", "queue_busy", provider, "queue_exceeded", "queue_exceeded classified", "critical");
  includes("reliability", "http_429", provider, "status === 429", "HTTP 429 classified as busy", "critical");
  includes("reliability", "invalid_image", provider, "invalid_image", "invalid image is payload failure", "critical");
  includes("reliability", "model_not_found", movementTest, "model_not_found", "model_not_found is covered", "critical");
  includes("reliability", "missing_token", provider, "HF_TOKEN is not configured", "missing token classified", "critical");
  includes("reliability", "network_error", source, "network_error", "network endpoint error exists", "critical");
}

function checkResultHero() {
  includes("result", "sentence_class", html, ".dq-movement-sentence", "movement sentence CSS exists", "critical");
  const sentenceCss = sliceBetween(html, ".dq-movement-sentence", ".dq-movement-hint");
  absent("result", "no_ellipsis", sentenceCss, "ellipsis", "movement sentence has no ellipsis", "critical");
  absent("result", "no_line_clamp", sentenceCss, "-webkit-line-clamp", "movement sentence has no line clamp", "critical");
  includes("result", "wrap", sentenceCss, "overflow-wrap: anywhere", "movement sentence supports wrapping", "critical");
  includes("result", "why_details", html, 'id="movementWhy"', "Why/details section exists", "critical");
  const resultBlock = sliceBetween(mainUi, 'id="movementResultTitle"', 'id="currentManualAction"');
  addCheck("result", "provider_in_why", "provider is secondary", resultBlock.indexOf("Provider") > resultBlock.indexOf("Why?"), "Provider after Why", "critical");
  addCheck("result", "model_in_why", "model is secondary", resultBlock.indexOf("Model") > resultBlock.indexOf("Why?"), "Model after Why", "critical");
  addCheck("result", "latency_in_why", "latency is secondary", resultBlock.indexOf("Latency") > resultBlock.indexOf("Why?"), "Latency after Why", "critical");
  includes("result", "evidence_cap", source, "items.slice(0, 3)", "evidence capped to 3 bullets", "critical");
  includes("result", "animation_marker", html, "dq-result-ready", "result animation marker exists", "critical");
  includes("result", "reduced_motion", html, "prefers-reduced-motion: reduce", "reduced-motion guard exists", "critical");
  includes("result", "collapsed_default", html, 'data-collapsed-default="true"', "Why/details collapsed by default", "critical");
}

function checkResultCardStability() {
  includes("result_stability", "snapshot_state", source, "movementResultSnapshot", "movement result snapshot exists", "critical");
  includes("result_stability", "live_camera_state", source, "liveCameraState", "live camera state exists separately", "critical");
  includes("result_stability", "render_key", source, "movementResultRenderKey", "result render key exists", "critical");
  includes("result_stability", "detail_key", source, "movementResultDetailKey", "result details key exists", "critical");
  includes("result_stability", "result_id_gate", source, "snapshot.result_id !== lastMovementRevealResultId", "result reveal runs only on new result_id", "critical");
  const renderKeyBlock = sliceBetween(source, "function movementResultRenderKey", "function movementResultDetailKey");
  absent("result_stability", "render_key_no_live_camera", renderKeyBlock, "liveCameraState", "camera movement does not reset result animation", "critical");
  const detailKeyBlock = sliceBetween(source, "function movementResultDetailKey", "function readableDetailHtml");
  absent("result_stability", "detail_key_no_voice", detailKeyBlock, "voiceStatus", "voice state changes do not resize result card", "critical");
  includes("result_stability", "snapshot_display", source, "const snapshot = target.movementResultSnapshot", "result card reads snapshot, not live telemetry", "critical");
}

function checkResearchFeatures() {
  includes("research", "movement_history_state", source, "movementHistory", "movement history exists", "critical");
  includes("research", "movement_history_text_only", source, 'format: "text_only"', "movement history text-only", "critical");
  includes("research", "movement_history_cap", source, "MOVEMENT_HISTORY_MAX_ITEMS", "movement history cap exists", "critical");
  includes("research", "movement_history_clear", source, "clearMovementHistory", "movement history clear exists", "critical");
  const movementHistoryBlock = sliceBetween(source, "function appendMovementHistory", "function appendCorrectionMemory");
  absentRegex("research", "movement_history_no_media", movementHistoryBlock, /frame|screenshot|base64|data:image/i, "movement history stores no media fields", "critical");
  includes("research", "correction_memory_state", source, "correctionMemory", "correction memory exists", "critical");
  includes("research", "correction_memory_cap", source, "CORRECTION_MEMORY_MAX_ITEMS", "correction memory cap exists", "critical");
  includes("research", "correction_memory_clear", source, "clearCorrectionMemory", "correction memory clear exists", "critical");
  includes("research", "session_only", source, 'storage: "session_only"', "memory is session-only", "critical");
  includes("research", "sanitize_memory", source, "sanitizeMemoryText", "corrections sanitize sensitive text", "critical");
  includes("research", "correction_contract_text_only", correctionMemoryContract, "Correction memory is text-only", "correction contract text-only", "critical");
  includes("research", "correction_contract_session", correctionMemoryContract, "session-only", "correction contract session-only", "critical");
  includes("research", "correction_contract_clear", correctionMemoryContract, "clearCorrectionMemory", "correction contract clearable", "critical");
  includes("research", "prompt_v2_exists", promptV2Contract, "Movement Narration Prompt v2", "prompt v2 exists", "critical");
  includes("research", "prompt_temporal", promptV2Contract, "Compare frames over time", "prompt v2 asks temporal movement", "critical");
  includes("research", "prompt_no_identity", promptV2Contract, "Do not identify a person", "prompt v2 forbids identity", "critical");
  includes("research", "prompt_no_sensitive", promptV2Contract, "sensitive attributes", "prompt v2 forbids sensitive attributes", "critical");
  includes("research", "prompt_uncertainty", promptV2Contract, "Allow uncertainty", "prompt v2 allows uncertainty", "critical");
}

function checkResearchLab() {
  const researchIndex = bodyHtml.indexOf('id="researchLabPanel"');
  if (researchIndex < 0) {
    addCheck("research_lab", "not_implemented", "Research Lab not implemented", true, "optional", "info");
    return;
  }
  addCheck("research_lab", "under_developer_tools", "Research Lab is below Developer Tools", researchIndex > developerToolsIndex && developerToolsIndex >= 0, `${researchIndex} > ${developerToolsIndex}`, "critical");
  absent("research_lab", "not_in_main", mainUi, "Research Lab", "Research Lab not in main UI", "critical");
  absent("research_lab", "not_open_default", html, '<details id="researchLabPanel" class="dq-card dq-technical-card" open', "Research Lab collapsed by default", "critical");
  const researchBlock = sliceBetween(bodyHtml, 'id="researchLabPanel"', 'id="diagnosticsCard"');
  absentRegex("research_lab", "no_token_value", researchBlock, /hf_[A-Za-z0-9]{12,}|Authorization|Bearer/i, "Research Lab shows no token", "critical");
  absentRegex("research_lab", "no_raw_frames", researchBlock, /raw frame|raw video|screenshot|base64|data:image/i, "Research Lab shows no raw media/base64", "critical");
  includes("research_lab", "safe_metadata", researchBlock, "Safe provider metadata only", "Research Lab safe metadata only", "critical");
}

function checkVoice() {
  includes("voice", "speak_button", mainUi, "Speak again", "Speak again button exists", "critical");
  includes("voice", "autospeak_on", mainUi, "Auto-speak on", "Auto-speak on is visible by default", "critical");
  includes("voice", "speech_synthesis", source, "speechSynthesis.speak", "browser speechSynthesis used", "critical");
  includes("voice", "contextual_response_only", source, "new Utterance(text)", "voice speaks only the contextual response text", "critical");
  absentRegex("voice", "no_provider_voice", source, /new Utterance\([^)]*(provider|model|confidence|evidence)/i, "voice does not speak details", "critical");
  includes("voice", "dedupe_autospeak", source, "spokenObservationIds.has(observationId)", "auto-speak is deduped per observation", "critical");
  includes("voice", "cancel_previous", source, "speechSynthesis?.cancel?.()", "new speech cancels previous speech", "critical");
  includes("voice", "no_paid_tts", source, "speechSynthesisAvailable", "no paid TTS key path required", "critical");
  includes("voice", "no_microphone", source, "audio: false", "no microphone permission requested", "critical");
}

function checkProviderSafety() {
  includes("provider", "visual_model", visualProvider, "HuggingFaceTB/SmolVLM2-2.2B-Instruct", "local visual model selected", "critical");
  includes("provider", "visual_no_router", visualProvider, "production_path_uses_hf_router: false", "visual production path does not use HF router", "critical");
  includes("provider", "visual_frame_cleanup", visualProvider, "clearVisualFramePayloads", "visual provider clears frame payloads", "critical");
  includes("provider", "visual_observe_endpoint", server, "/api/visual-companion/observe", "visual observe endpoint exists", "critical");
  includes("provider", "known_route", provider, "google/gemma-4-31B-it:cerebras", "known model route preserved", "critical");
  includes("provider", "data_uri", provider, "data:${frame.mime_type || \"image/jpeg\"};base64", "data:image/jpeg;base64 frames preserved", "critical");
  includes("provider", "server_token", provider, "env.HF_TOKEN", "HF_TOKEN is server-side", "critical");
  includes("provider", "health_endpoint", server, "/api/movement-recognition/health", "health endpoint exists", "critical");
  includes("provider", "analyze_endpoint", server, "/api/movement-recognition/analyze", "analyze endpoint exists", "critical");
  absentRegex("provider", "frontend_no_token_value", source, /process\.env\.HF_TOKEN|Authorization:\s*`Bearer|hf_secret|hf_test|hf_[A-Za-z0-9]{12,}/, "token never exposed to frontend", "critical");
  absentRegex("provider", "no_raw_media_persistence", source, /indexedDB|MediaRecorder|readAsDataURL|toDataURL|navigator\.sendBeacon/i, "no raw media persisted", "critical");
}

function checkResultsDoc() {
  for (const marker of [
    "Verified",
    "Disclosed",
    "Blocked",
    "Requires Live Local Test",
    "HF_TOKEN"
  ]) includes("results", safeCode(marker), resultsDoc, marker, `results doc includes ${marker}`, "critical");
}

function checkTestCoverage() {
  for (const marker of [
    "preview is mirrored",
    "one-shot cost guard",
    "double-click",
    "model_not_found",
    "auto speech starts exactly once",
    "provider/model/latency",
    "no continuous upload",
    "visual companion"
  ]) {
    includes("tests", safeCode(marker), `${movementTest}\n${visualTest}\n${prototypeTest}`, marker, `test covers ${marker}`, "critical");
  }
  includes("rules", "vanta", agents, "Suggestion Trace Campaign must never appear in the default operator view", "VANTA rule present", "critical");
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

function sliceBetween(haystack, start, end) {
  const startIndex = haystack.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = haystack.indexOf(end, startIndex + start.length);
  return haystack.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}
