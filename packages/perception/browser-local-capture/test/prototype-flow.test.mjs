import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CAMPAIGN_BUNDLE_FILENAME,
  LOCAL_MOTION,
  LIVE_PHYSICAL_TRACE_PATH,
  LIVE_PHYSICAL_TRACE_FILENAME,
  MACOS_SAVE_COMMAND,
  MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
  MOVEMENT_RECOGNITION_CLIENT_CONFIG,
  REQUIRED_ZONES,
  SUGGESTION_CAMPAIGN_STEPS,
  SUGGESTION_TRACE_MODES,
  VALIDATION_COMMANDS,
  VALIDATION_COMMAND_LIST,
  acceptSuggestionInState,
  buildActionSuggestion,
  buildExportPreview,
  buildLocalPerceptionFrame,
  buildOperatorBugReport,
  buildReplayFixture,
  campaignSummaryFor,
  computeDirectionalChange,
  computeMotionBurst,
  computeZoneDwell,
  confirmStepInState,
  createPerceptionSuggestion,
  createInitialState,
  defaultCalibration,
  expireOldSuggestions,
  getButtonGuards,
  inspectEventSequence,
  markCameraResetInState,
  markUncertainInState,
  motionProxyEventSpec,
  queuePerceptionSuggestion,
  rankActionSuggestions,
  rejectSuggestionInState,
  resetSessionInState,
  runExportPreflight,
  scoreLocalActionFrame,
  runSuggestionTracePreflight,
  saveCalibrationToState,
  smoothActionConfidence,
  startCampaignTraceInState,
  startFocusRitualInState,
  startRecordingInState,
  suggestionSummaryFor,
  updateMotionHistory,
  stopRecordingInState,
  topStatusForState,
  wizardStagesForState,
  zoneActivatedEventSpec
} from "../prototype/local-capture.js";

const html = readFileSync(resolve("packages/perception/browser-local-capture/prototype/index.html"), "utf8");
const source = readFileSync(resolve("packages/perception/browser-local-capture/prototype/local-capture.js"), "utf8");
const launcherSource = readFileSync(resolve("packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs"), "utf8");
const agents = readFileSync(resolve("AGENTS.md"), "utf8");
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const defaultMainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;
const suggestionRunbook = readFileSync(resolve("docs/perception/gate-3B-live-suggestion-trace-runbook.md"), "utf8");
const correctionMemoryContract = readFileSync(resolve("docs/contracts/movement-correction-memory.v0.md"), "utf8");
const promptV2Contract = readFileSync(resolve("docs/contracts/movement-narration-prompt.v2.md"), "utf8");
const gate3bLiveManifest = JSON.parse(readFileSync(resolve("fixtures/replay/gate_3b_live_manifest.json"), "utf8"));
const devSuggestionFixtures = [
  "runs/dev/suggestions/dev_suggestion_phone_moved.json",
  "runs/dev/suggestions/dev_suggestion_reject_does_not_progress.json",
  "runs/dev/suggestions/dev_suggestion_full_focus_ritual.json"
].map((path) => JSON.parse(readFileSync(resolve(path), "utf8")));
for (const required of [
  'id="preview"',
  'id="zoneOverlay"',
  'id="movementPrivacyDisclosure"',
  'id="mainWorkspace"',
  'id="bottomDiagnostics"',
  'id="dqPremiumCompression"',
  'id="topStatusBar"',
  'id="nextStepCard"',
  'id="errorBanner"',
  'id="operatorModePanel"',
  'id="operatorReadiness"',
  'id="operatorOutputPath"',
  'id="operatorValidationCommands"',
  'id="copyOperatorCommands"',
  'id="operatorExportTroubleshooting"',
  'id="operatorSendBack"',
  'id="startCamera"',
  'id="stopCamera"',
  'id="calibrateZones"',
  'id="editZones"',
  'id="calibrationStatusHero"',
  'id="saveCalibration"',
  'id="startFocusRitual"',
  'id="startRecording"',
  'id="stopRecording"',
  'id="exportTrace"',
  'id="resetSession"',
  'id="copyValidation"',
  'id="currentWizard"',
  'id="wizardStages"',
  'id="operatorCommandsCard"',
  'id="currentActionControl"',
  'id="currentManualAction"',
  'id="allManualControls"',
  'id="manualConfirmationRail"',
  'id="cameraSuggestionsPanel"',
  'id="cameraSuggestions"',
  'id="developerTools"',
  'id="suggestionTraceSetupPanel"',
  'id="suggestionTraceMode"',
  'id="suggestionTraceInstructions"',
  'id="suggestionCounters"',
  'id="suggestionCampaignPanel"',
  'id="suggestionCampaignSummary"',
  'id="suggestionCampaignSteps"',
  'id="exportCampaignBundle"',
  'id="campaignValidationInstructions"',
  'id="savePathValue"',
  'id="localPerceptionTuning"',
  'id="motionSensitivity"',
  'id="suggestionThreshold"',
  'id="suggestionCooldown"',
  'id="maxActiveSuggestions"',
  'id="showRawMotionScores"',
  'id="buttonReasons"',
  'id="ritualChecklist"',
  'id="preflightChecklist"',
  'id="exportReadinessSummary"',
  'id="preflightStatus"',
  'id="exportPreview"',
  'id="eventSequenceInspector"',
  'id="staticWaiverDisclosure"',
  'id="lowConfidence"',
  'id="diagnosticModelCalls"',
  'id="diagnosticRawMedia"',
  'id="dryRunSeparation"',
  'id="calibrationSummary"',
  'id="copyCommandButtons"',
  'id="copySavePath"',
  'id="copyMacosCpCommand"',
  'id="exportBugReport"',
  'id="operatorArtifactChecklist"',
  'id="stuckGuide"',
  'id="missingFixtureNote"',
  'id="troubleshooting"',
  "Operator Mode",
  "Advanced / Developer Tools",
  "Current Readiness",
  "Required Output File Path",
  "What To Send Back To The Team",
  "Runtime status",
  "Camera Ready",
  "Pending export",
  "Raw media off",
  "Current step",
  "Advanced Calibration",
  "Calibration Panel",
  "Calibration Summary",
  "Quest State Panel",
  "Current Objective",
  "Active Zone",
  "Last 10 Symbolic Events",
  "Confidence Panel",
  "Recording Status",
  "Privacy Status",
  "Model-Call Status",
  "Latency Panel",
  "LLM/VLM Calls",
  "Raw Media Count",
  "Export & save",
  "Validation",
  "Preview Export JSON",
  "Export Preflight",
  "Event Sequence Inspector",
  "Progress",
  "Dry-Run / Physical Separation",
  "Export Save-Path Assistant",
  "Bug Report",
  "Operator Run Artifact Checklist",
  "What To Do If Stuck",
  "Operator progress",
  "Troubleshooting Panel",
  "View technical details",
  "Operator Commands",
  "Manual confirmation - not automatic vision",
  "Manual local confirmation — not automatic vision.",
  "AI Movement Narrator",
  "Show a movement. Let AI describe what happened.",
  "Describe my next movement",
  "Move now.",
  "Understanding movement",
  "Try another movement",
  "Live narrator coming next",
  "Movement Result",
  "Speak result",
  "Auto-speak off",
  "Show tracking overlay",
  "Detected Action",
  "One click captures one short movement window. Move when prompted.",
  "Describe my next movement sends a short temporary frame window only after you click.",
  "No continuous upload.",
  "No raw media is saved by this app.",
  "Requires HF_TOKEN for live Hugging Face/Cerebras recognition.",
  "Suggestion Trace Campaign",
  "Suggestion Trace Campaign Summary",
  "traces required",
  "traces exported",
  "missing traces",
  "generated suggestions total",
  "accepted suggestions total",
  "rejected suggestions total",
  "auto_completed_steps total",
  "ready for npm run gate:3b:live",
  "Start this trace",
  "Reset this trace",
  "Export this trace",
  "Copy save path",
  "Copy macOS move command",
  "Mark trace exported",
  "Export Campaign Bundle",
  "Bundle export is for convenience. Gate 3B-Live requires individual files under fixtures/replay/live/suggestions/.",
  "npm run suggestions:validate",
  "npm run suggestions:report",
  "npm run gate:3b:live",
  "Selected trace mode",
  "Required physical action",
  "Expected suggestion",
  "Accept/Reject",
  "Required export filename",
  "Required save path",
  "Suggestion export preflight",
  "Standard Physical Trace",
  "Suggestion Trace: Phone Moved",
  "Suggestion Trace: Notebook Opened",
  "Suggestion Trace: Pen Picked Up",
  "Suggestion Trace: Writing Motion",
  "Suggestion Trace: Typing Motion",
  "Suggestion Trace: Reject Suggestion",
  "Suggestion Trace: Uncertain Scene",
  "Suggestion Trace: Full Focus Ritual",
  "generated",
  "accepted",
  "rejected",
  "auto-completed",
  "Local Perception Tuning",
  "Motion sensitivity",
  "Suggestion threshold",
  "Suggestion cooldown",
  "Max active suggestions",
  "Show symbolic motion scores",
  "Describe my next movement sends a short temporary frame window only after you click.",
  "No continuous upload.",
  "No raw media is saved by this app.",
  "Requires HF_TOKEN for live Hugging Face/Cerebras recognition.",
  "No continuous stream upload. Short sampled frames may be sent to the selected AI provider when Describe my next movement is clicked.",
  "Manual local confirmation",
  "Copy Validation Commands",
  "Optional source checks: npm run gate:1d, npm run gate:1e, npm run gate:2a.",
  "Copy physical:validate",
  "Copy replay x3",
  "Copy gate:1c",
  "Copy gate:1e",
  "Static compatibility disclosure: historical eval status is retained in Developer Tools",
  "Copy Save Path",
  "Copy macOS Save Command",
  "Export Bug Report",
  "Raw media",
  "Not saved",
  "AI provider",
  "LLM calls",
  "VLM Calls"
]) {
  assert.equal(html.includes(required), true, `missing prototype UI marker: ${required}`);
}
for (const requiredAgentRule of [
  "# Critical UI Rules",
  "# DarkQuest Critical UI Rules",
  "## 1. Text containment",
  "## 2. No dead space",
  "## 3. Camera + steps first",
  "## 4. Developer tools separation",
  "Never allow vertical letter-by-letter wrapping",
  "Suggestion Trace Campaign must never appear in the default operator view",
  "Manual confirmation must remain visible",
  "# Design Freeze v1",
  "The current UI is approved and frozen.",
  "Only functionality, validation, trace export, safety, and hidden developer-tool logic may change"
]) {
  assert.equal(agents.includes(requiredAgentRule), true, `missing AGENTS.md UI rule: ${requiredAgentRule}`);
}
for (const removedChrome of [
  "dq-topnav",
  "dq-navlinks",
  "dq-session",
  "dq-avatar",
  "Session <b>Local</b>",
  'aria-label="Theme"',
  "☼",
  "<footer",
  "DarkQuest local prototype"
]) {
  assert.equal(html.includes(removedChrome), false, `removed app chrome still present: ${removedChrome}`);
}
for (const removedVisibleText of ["Dashboard", "Sessions", "Focus Rituals", "Settings", "Session Local"]) {
  assert.equal(bodyHtml.includes(removedVisibleText), false, `removed visible app chrome text still present: ${removedVisibleText}`);
}
assert.equal(html.includes('<details id="operatorModePanel"'), true, "operator details should be collapsed by default");
assert.equal(html.includes('<details id="calibrationPanel"'), true, "advanced calibration should be collapsed by default");
assert.equal(html.includes('<details id="developerTools"'), true, "developer tools should exist");
assert.equal(html.includes('<details id="developerTools" class="dq-dev-tools" open'), false, "developer tools should be closed by default");
assert.equal(html.includes('<details id="questStatePanel"'), true, "quest state panel should be collapsed by default");
assert.equal(html.includes('<details id="ritualChecklistPanel"'), true, "ritual checklist should be collapsed by default");
assert.equal(html.includes('<details id="operatorArtifactPanel"'), true, "operator artifact checklist should be collapsed by default");
assert.equal(html.includes('class="dq-nested-details dq-command-tuning" open'), false, "suggestion trace setup should be collapsed by default");
assert.equal(html.includes('class="dq-dashboard-grid"'), true, "responsive dashboard grid marker should exist");
assert.equal(html.includes("dq-flow-column"), true, "main operator mode should have an operator column");
assert.equal(html.includes('"camera step"'), true, "main operator mode should place camera and step side by side");
assert.equal(html.includes('"export validation"'), true, "bottom operator row should include export and validation");
assert.equal(html.includes('id="flowCard"'), true, "current step card should exist");
assert.equal(html.includes('id="progressCard"'), true, "progress card should exist");
assert.equal(html.includes('data-product-card="detected-action"'), true, "main UI should expose a product-facing detected action card");
assert.equal(html.includes('id="movementResultTitle">Movement Result'), true, "main card should use Movement Result title");
assert.equal(html.includes('id="cameraSuggestionsTitle">Detected Action'), true, "legacy detected action marker stays hidden for compatibility");
assert.equal(html.includes("Start the camera, then describe a movement."), true, "result card should explain the camera-off state");
assert.equal(html.includes("One click captures one short movement window. Move when prompted."), true, "movement confirmation disclosure should be visible");
assert.equal(html.includes("dq-primary-action-region"), true, "detected action live region should have a stable primary action region");
assert.equal(html.includes("dq-movement-sentence"), true, "movement sentence should be a readable hero");
assert.equal(html.includes("dq-movement-summary-row"), true, "confidence summary should be secondary to the sentence");
assert.equal(html.includes('id="movementWhy"'), true, "Why details should exist for result evidence");
const movementWhyBlock = defaultMainUi.slice(defaultMainUi.indexOf('id="movementWhy"'), defaultMainUi.indexOf('id="currentManualAction"'));
assert.equal(movementWhyBlock.includes("Provider"), true, "provider is inside secondary details");
assert.equal(movementWhyBlock.includes("Model"), true, "model is inside secondary details");
assert.equal(movementWhyBlock.includes("Latency"), true, "latency is inside secondary details");
assert.equal(html.includes("result-card-stable"), true, "result card stable layout marker exists");
assert.equal(html.includes("dq-result-ready"), true, "result animation markers exist");
assert.equal(html.includes(".dq-movement-result.result-reveal"), true, "result animation is attached to reveal class only");
assert.equal(html.includes("prefers-reduced-motion: reduce"), true, "reduced-motion guard exists");
assert.equal(html.includes('id="showTrackingOverlay" type="checkbox"'), true, "tracking overlay toggle should exist");
assert.equal(html.includes('id="showTrackingOverlay" type="checkbox" checked'), false, "tracking overlay should default off");
assert.equal(html.includes("transform: scaleX(-1)"), true, "preview is mirrored by default");
assert.equal(source.includes("mirrorFramesToPreview: true"), true, "capture frames are explicitly mirrored to match preview");
assert.equal(html.includes('data-mirror-default="on"'), true, "mirror policy marker exists");
assert.equal(html.includes('data-analysis-mirror="on"'), true, "analysis mirror policy marker exists");
assert.equal(source.includes("drawVideoFrameForAnalysis"), true, "analysis frame drawing uses mirror helper");
assert.equal(source.includes("liveCameraState"), true, "live camera state is separated");
assert.equal(source.includes("movementCaptureState"), true, "movement capture state is separated");
assert.equal(source.includes("movementResultSnapshot"), true, "movement result snapshot state is separated");
assert.equal(source.includes("renderLiveCameraState(state)"), true, "camera frame loop uses isolated live-camera render");
assert.equal(source.includes("snapshot.result_id !== lastMovementRevealResultId"), true, "result animation is keyed to result_id");
const localMotionBlock = source.slice(source.indexOf("function applyLocalMotionObservations"), source.indexOf("export function updateMotionHistory"));
assert.equal(localMotionBlock.includes("movementResultSnapshot"), false, "camera/motion updates do not mutate movementResultSnapshot");
const resultRenderKeyBlock = source.slice(source.indexOf("function movementResultRenderKey"), source.indexOf("function movementResultDetailKey"));
assert.equal(resultRenderKeyBlock.includes("liveCameraState"), false, "camera movement does not reset result animation");
const resultDetailKeyBlock = source.slice(source.indexOf("function movementResultDetailKey"), source.indexOf("function readableDetailHtml"));
assert.equal(resultDetailKeyBlock.includes("voiceStatus"), false, "voice state changes do not resize the result card");
assert.equal(source.includes("MOVEMENT_HISTORY_MAX_ITEMS"), true, "movement history has a max length cap");
assert.equal(source.includes("CORRECTION_MEMORY_MAX_ITEMS"), true, "correction memory has a max length cap");
assert.equal(source.includes("MOVEMENT_HISTORY_MAX_ITEMS = 10"), true, "movement history is capped at 10");
assert.equal(source.includes("CORRECTION_MEMORY_MAX_ITEMS = 10"), true, "correction memory is capped at 10");
assert.equal(source.includes("movementHistory"), true, "movement history state exists");
assert.equal(source.includes("correctionMemory"), true, "correction memory state exists");
assert.equal(source.includes("confidenceCalibration"), true, "confidence calibration counters exist");
assert.equal(source.includes('format: "text_only"'), true, "movement history and correction memory are text-only");
assert.equal(source.includes('storage: "session_only"'), true, "correction memory is session-only");
assert.equal(source.includes("clearMovementHistory"), true, "movement history can be cleared");
assert.equal(source.includes("clearCorrectionMemory"), true, "corrections are clearable");
assert.equal(source.includes("sanitizeMemoryText"), true, "corrections sanitize sensitive text");
assert.equal(source.includes("recent_corrections: recentCorrectionContextForPrompt(target)"), true, "correction context is sent on the next provider request");
assert.equal(html.includes('id="movementCorrectionInput"'), true, "correction input exists");
assert.equal(html.includes("What did you actually do?"), true, "correction input asks for the actual movement");
assert.equal(html.includes('id="movementHistoryPanel"'), true, "movement history section exists");
const movementHistoryBlock = source.slice(source.indexOf("function appendMovementHistory"), source.indexOf("function appendCorrectionMemory"));
assert.equal(/frame|screenshot|base64|data:image/i.test(movementHistoryBlock), false, "movement history stores no frames/screenshots/base64");
assert.equal(movementHistoryBlock.includes("provider"), false, "movement history does not store provider metadata");
assert.equal(movementHistoryBlock.includes("model"), false, "movement history does not store model metadata");
assert.equal(movementHistoryBlock.includes("confidence"), false, "movement history stores movement text only");
const correctionMemoryBlock = source.slice(source.indexOf("function appendCorrectionMemory"), source.indexOf("export function clearMovementHistory"));
assert.equal(/\b(age|gender|race|ethnicity|private text|frame|screenshot|base64|data:image)\b/i.test(correctionMemoryBlock), false, "correction memory stores no sensitive attributes or media");
assert.equal(correctionMemoryBlock.includes("contains_biometric_identity: false"), true, "correction memory explicitly stores no biometric identity");
assert.equal(correctionMemoryBlock.includes("session_only: true"), true, "correction memory is session-only");
assert.equal(correctionMemoryContract.includes("Correction memory is text-only"), true, "correction memory contract requires text-only storage");
assert.equal(correctionMemoryContract.includes("session-only"), true, "correction memory contract is session-only");
assert.equal(correctionMemoryContract.includes("contains_biometric_identity: false"), true, "correction memory contract requires no biometric identity");
assert.equal(correctionMemoryContract.includes("clearCorrectionMemory"), true, "correction memory contract requires clearing");
assert.equal(promptV2Contract.includes("Movement Narration Prompt v2"), true, "prompt v2 contract exists");
assert.equal(promptV2Contract.includes("Compare frames over time"), true, "prompt v2 asks for temporal movement across frames");
assert.equal(promptV2Contract.includes("Do not identify a person"), true, "prompt v2 forbids identity descriptions");
assert.equal(promptV2Contract.includes("sensitive attributes"), true, "prompt v2 forbids sensitive attributes");
assert.equal(promptV2Contract.includes("Allow uncertainty"), true, "prompt v2 allows uncertainty");
assert.equal(bodyHtml.indexOf('id="researchLabPanel"') > bodyHtml.indexOf('id="developerTools"'), true, "Research Lab is under Developer Tools");
assert.equal(defaultMainUi.includes("Research Lab"), false, "Research Lab is hidden from main UI");
assert.equal(html.includes('<details id="researchLabPanel" class="dq-card dq-technical-card" open'), false, "Research Lab is collapsed by default");
const researchLabBlock = bodyHtml.slice(bodyHtml.indexOf('id="researchLabPanel"'), bodyHtml.indexOf('id="diagnosticsCard"'));
assert.equal(/hf_[A-Za-z0-9]{12,}|Authorization|Bearer|raw frame|raw video|screenshot|base64|data:image/i.test(researchLabBlock), false, "Research Lab shows no token/raw frames/base64");
assert.equal(researchLabBlock.includes("Safe provider metadata only"), true, "Research Lab shows only safe provider metadata");
for (const safeResearchField of ["researchPromptVersion", "researchImageTokens", "researchRetries", "researchCandidateFailures", "researchLastSafeError", "researchHistoryCount", "researchCorrectionCount", "researchOneShotGuard"]) {
  assert.equal(researchLabBlock.includes(safeResearchField), true, `Research Lab includes ${safeResearchField}`);
}
assert.equal(html.includes('id="oneMovementMode" name="movementNarratorMode" type="radio" value="one" checked'), true, "one-movement mode defaults on");
assert.equal(html.includes('id="liveNarratorMode" name="movementNarratorMode" type="radio" value="live" disabled'), true, "live narrator remains a disabled placeholder");
assert.equal(html.includes("Live narrator is disabled in this version. No background movement calls run."), true, "live narrator disabled copy is explicit");
assert.equal(defaultMainUi.includes("Recent events"), false, "recent symbolic events should not be in the main product");
assert.equal(bodyHtml.indexOf("Recent events") > bodyHtml.indexOf('id="developerTools"'), true, "recent events should be under developer tools");
for (const removedMainText of ["Focus Ritual", "Suggestion Trace Campaign", "Gate", "trace", "fixture", "neutral_zone", "off_desk_zone", "notebook_zone", "keyboard_zone", "pen_zone", "phone_zone", "hand.left_zone", "hand.entered_zone", "zone.activated"]) {
  assert.equal(defaultMainUi.toLowerCase().includes(removedMainText.toLowerCase()), false, `main UI should not show ${removedMainText}`);
}
for (const removedMainWord of ["phone", "notebook", "keyboard"]) {
  assert.equal(new RegExp(`\\b${removedMainWord}\\b`, "i").test(defaultMainUi), false, `main UI should not show ${removedMainWord}`);
}
assert.equal(/\bpen\b/i.test(defaultMainUi), false, "main UI should not show pen as a standalone ritual object");
assert.equal(defaultMainUi.includes("Analyze Movement"), false, "primary action should not use Analyze Movement copy");
assert.equal(defaultMainUi.indexOf('id="cameraTitle"') < defaultMainUi.indexOf('id="analyzeMovement"'), true, "camera appears before movement control");
assert.equal(defaultMainUi.indexOf('id="analyzeMovement"') < defaultMainUi.indexOf('id="movementResultTitle"'), true, "movement control appears before result");
assert.equal(source.includes("SUGGESTION_RENDER_INTERVAL_MS"), true, "detected action rendering should be throttled");
assert.equal(source.includes(".slice(0, 1)"), true, "only one primary suggestion should be visible in the product card");
assert.equal(html.includes('id="privacyTitle">Privacy & models'), true, "privacy/models card should exist");
assert.equal(html.includes('id="validationCard"'), true, "validation card should exist");
assert.equal(html.includes("Show all manual controls"), true, "legacy manual controls remain hidden for compatibility");
for (const containmentClass of [
  ".text-contained",
  ".path-field",
  ".code-contained",
  ".card-contained",
  ".truncate-safe",
  ".wrap-safe",
  ".scroll-contained",
  ".no-vertical-text"
]) {
  assert.equal(html.includes(containmentClass), true, `missing containment CSS: ${containmentClass}`);
}
for (const containmentBehavior of ["overflow-wrap: anywhere", "word-break: break-word", "text-overflow: ellipsis", "white-space: nowrap", "max-height: 260px", "overflow: auto"]) {
  assert.equal(html.includes(containmentBehavior), true, `missing containment behavior: ${containmentBehavior}`);
}
assert.equal(html.includes('class="campaign-shell"'), true, "suggestion campaign should render as a two-panel wizard shell");
assert.equal(html.includes(".campaign-shell"), true, "campaign shell CSS should exist");
assert.equal(html.includes("grid-template-columns: minmax(240px, 320px) minmax(0, 1fr)"), true, "campaign shell should use the required two-panel grid");
assert.equal(html.includes("campaign-trace-list"), true, "campaign trace list should exist");
assert.equal(html.includes("campaign-detail"), true, "selected campaign detail panel should exist");
assert.equal(html.includes("campaign-counter-row"), true, "campaign counters should render as compact chips");
assert.equal(html.includes("campaign-action-row"), true, "campaign actions should render as wrapping button rows");
assert.equal(html.includes("campaign-path-field"), true, "campaign paths should be contained");
assert.equal(html.includes("grid-template-columns: repeat(auto-fit, minmax(148px, max-content))"), true, "campaign buttons should avoid unsafe narrow columns");
assert.equal(source.includes("campaign-trace-row text-contained"), true, "campaign trace rows should be compact list rows");
assert.equal(source.includes("campaignSelectedTraceDetailHtml"), true, "campaign should render one selected trace detail");
assert.equal(source.includes("Waiting for camera suggestion."), true, "selected trace detail should tell the operator what is happening after start");
assert.equal(source.includes("Perform the physical action and wait for a camera suggestion."), true, "selected trace detail should show the next instruction");
assert.equal(source.includes("dq-campaign-row is-header"), false, "campaign should not render the old all-traces-expanded table header");
assert.equal(source.includes("dq-campaign-cell"), false, "campaign should not render all 8 expanded trace cells");
assert.equal(source.includes("dq-suggestion-row text-contained\" data-campaign-step"), false, "campaign traces should not render as large suggestion cards");
assert.equal(source.includes("dq-current-action-button no-vertical-text"), true, "current action button should prevent vertical text wrapping");
assert.equal(source.includes("dq-button primary no-vertical-text"), true, "contextual manual button should prevent vertical text wrapping");
assert.equal(html.includes('<section id="operatorCommandsCard" class="dq-card dq-operator-commands card-contained"'), true, "operator commands should be a standalone card");
assert.equal(bodyHtml.indexOf('id="flowCard"') < bodyHtml.indexOf('id="operatorCommandsCard"'), true, "operator commands should sit directly after primary flow");
assert.equal(bodyHtml.indexOf('id="sequenceTitle"') < bodyHtml.indexOf('id="developerTools"'), true, "compact sequence progress should be visible in default operator mode");
assert.equal(html.includes('<details id="suggestionCampaignPanel" class="dq-card dq-technical-card dq-campaign-details"'), true, "suggestion campaign should be in developer tools");
assert.equal(html.includes('<section id="suggestionCampaignPanel"'), false, "suggestion campaign should not be an open default card");
assert.equal(html.includes('id="suggestionCampaignPanel" class="dq-card dq-technical-card dq-campaign-details" open'), false, "suggestion campaign details should not start open");
assert.equal(bodyHtml.indexOf('id="developerTools"') < bodyHtml.indexOf('id="suggestionCampaignPanel"'), true, "suggestion campaign should live under developer tools");
assert.equal(bodyHtml.indexOf("Suggestion Trace Campaign") > bodyHtml.indexOf('id="developerTools"'), true, "trace campaign copy should be developer-only");
assert.equal(bodyHtml.indexOf("Gate 3B-Live") > bodyHtml.indexOf('id="developerTools"'), true, "Gate 3B-Live copy should be developer-only");
assert.equal(bodyHtml.indexOf('id="developerTools"') < bodyHtml.indexOf('id="calibrationPanel"'), true, "advanced calibration should live under developer tools");
assert.equal(bodyHtml.indexOf('id="developerTools"') < bodyHtml.indexOf('id="preflightTitle"'), true, "raw preflight should live under developer tools");
assert.equal(html.includes('aria-labelledby="preflightTitle" open'), false, "export preflight details should be collapsed by default");
assert.equal(html.includes("dq-technical-card"), true, "collapsed technical sections should use technical card styling");
assert.equal(source.includes(["blocks_export", "true"].join("=")), false, "sequence inspector should not render raw export booleans");
assert.equal(source.includes(`state=${"${item.state}"}`), false, "ritual checklist should not render raw state keys");
assert.equal(html.includes('id="validationCommands" class="code-contained scroll-contained" hidden'), true, "post-export validation command block should start hidden");
assert.equal(html.includes('id="operatorValidationCommands"'), true, "operator validation commands should exist before export");
assert.equal(VALIDATION_COMMAND_LIST.length, 4);
assert.equal(VALIDATION_COMMANDS.includes("npm run physical:validate"), true);
assert.equal(VALIDATION_COMMANDS.includes("replay --repeat 3"), true);
assert.equal(VALIDATION_COMMANDS.includes("npm run gate:1c"), true);
assert.equal(VALIDATION_COMMANDS.includes("npm run gate:1e"), true);
assert.equal(VALIDATION_COMMANDS.includes("npm run gate:1d"), false);
assert.equal(VALIDATION_COMMANDS.includes("npm run gate:2a"), false);
assert.equal(html.includes("Copy gate:1d"), false);
assert.equal(html.includes("Copy gate:1e"), true);
assert.equal(html.includes("Copy gate:2a"), false);
assert.equal(html.includes("npm run gate:2a"), true, "Gate 2A source check should remain discoverable");
assert.equal(source.includes("10:42"), false, "prototype must not render fake timeline times");
const forbiddenClaimNeedles = [
  ["autonomous", "vision"].join(" "),
  ["automatically", "understands your desk"].join(" "),
  ["production", "ready"].join(" "),
  ["portfolio", "ready"].join(" "),
  ["cinematic", "demo ready"].join(" "),
  ["detects", "everything"].join(" "),
  ["AI", "vision proven"].join(" "),
  ["gesture", "recognition solved"].join(" "),
  ["object", "detection proven"].join(" "),
  ["VLM", "powered"].join("-"),
  ["cloud", "vision"].join(" "),
  ["cin", "ematic"].join(""),
  ["portfolio", "demo"].join(" "),
  ["production", "quality"].join("-")
];
for (const needle of forbiddenClaimNeedles) {
  assert.equal(`${html}\n${source}\n${suggestionRunbook}\n${JSON.stringify(devSuggestionFixtures)}`.toLowerCase().includes(needle), false, `forbidden claim marker present: ${needle}`);
}
assert.equal(/fetch\s*\(|WebSocket|OpenAI|OPENAI_API_KEY|sk-proj-|sk-[A-Za-z0-9]/i.test(source), false);
assert.equal(/MediaRecorder|toDataURL|readAsDataURL|data:image|data:video|data:audio/i.test(source), false);
assert.equal(/localStorage|sessionStorage|indexedDB|navigator\.sendBeacon/i.test(source), false);
for (const marker of [
  "readDownsampledGrayFrame",
  "computeZoneMotion",
  "motion_score",
  "zone.activated",
  "hand.entered_zone",
  "hand.left_zone",
  "motion_proxy",
  "local_signal",
  "suggestion_only",
  "low_confidence",
  "expires_at_ms",
  "suggested_event_type",
  "suggested_action",
  "quest_step",
  "accepted",
  "rejected",
  "computeZoneDwell",
  "computeMotionBurst",
  "computeDirectionalChange",
  "createLocalPerceptionFrame",
  "scoreLocalActions",
  "localPerceptionFrame",
  "local_action_engine_status",
  "handEngineStatus",
  "rejectedCandidateCooldowns",
  "previousActionConfidence",
  "detected_action_candidate",
  "requires_confirmation",
  "buildActionSuggestion",
  "rankActionSuggestions",
  "expireOldSuggestions",
  "SUGGESTION_TRACE_MODES",
  "SUGGESTION_CAMPAIGN_STEPS",
  "CAMPAIGN_BUNDLE_FILENAME",
  "campaignSummaryFor",
  "buildCampaignBundle",
  "suggestion_campaign_status",
  "campaign_mode_active",
  "completed_trace_list",
  "missing_trace_list",
  "suggestionSummaryFor",
  "suggestion_summary",
  "suggestions_generated",
  "suggestions_accepted",
  "suggestions_rejected",
  "auto_completed_steps",
  "suggestion_source",
  "suggestion_trace_mode",
  "runSuggestionTracePreflight",
  "suggestion_accept_required",
  "suggestion_reject_required",
  "accepted_suggestion_payload",
  "accepted_suggestion_evidence",
  "suggestion_trace_status",
  "export_blocked_reason",
  "Possible phone moved - confirm to accept.",
  "Possible notebook opened - confirm to accept.",
  "Possible pen picked up - confirm to accept.",
  "Possible writing motion - confirm to accept.",
  "Possible typing motion - confirm to accept.",
  "Camera suggestion accepted"
]) {
  assert.equal(source.includes(marker), true, `missing local perception marker: ${marker}`);
}
assert.equal(LIVE_PHYSICAL_TRACE_PATH, "fixtures/replay/live/live_physical_focus_ritual_001.v0.json");
assert.equal(LIVE_PHYSICAL_TRACE_FILENAME, "live_physical_focus_ritual_001.v0.json");
assert.equal(MACOS_SAVE_COMMAND.includes("cp ~/Downloads/live_physical_focus_ritual_001.v0.json"), true);
assert.equal(SUGGESTION_TRACE_MODES.length, 9);
assert.equal(SUGGESTION_TRACE_MODES[0].path, LIVE_PHYSICAL_TRACE_PATH);
assert.equal(SUGGESTION_TRACE_MODES[0].filename, LIVE_PHYSICAL_TRACE_FILENAME);
assert.equal(SUGGESTION_CAMPAIGN_STEPS.length, 8);
assert.equal(CAMPAIGN_BUNDLE_FILENAME, "darkquest_suggestion_trace_campaign_bundle.json");
const expectedSuggestionTraceMap = {
  suggestion_phone_moved: "fixtures/replay/live/suggestions/live_suggestion_phone_moved_001.v0.json",
  suggestion_notebook_opened: "fixtures/replay/live/suggestions/live_suggestion_notebook_opened_001.v0.json",
  suggestion_pen_picked_up: "fixtures/replay/live/suggestions/live_suggestion_pen_picked_up_001.v0.json",
  suggestion_writing_motion: "fixtures/replay/live/suggestions/live_suggestion_writing_motion_001.v0.json",
  suggestion_typing_motion: "fixtures/replay/live/suggestions/live_suggestion_typing_motion_001.v0.json",
  suggestion_reject: "fixtures/replay/live/suggestions/live_suggestion_reject_does_not_progress_001.v0.json",
  suggestion_uncertain: "fixtures/replay/live/suggestions/live_suggestion_uncertain_scene_001.v0.json",
  suggestion_full_focus_ritual: "fixtures/replay/live/suggestions/live_suggestion_full_focus_ritual_001.v0.json"
};
for (const modeId of [
  "standard",
  "suggestion_phone_moved",
  "suggestion_notebook_opened",
  "suggestion_pen_picked_up",
  "suggestion_writing_motion",
  "suggestion_typing_motion",
  "suggestion_reject",
  "suggestion_uncertain",
  "suggestion_full_focus_ritual"
]) {
  assert.equal(SUGGESTION_TRACE_MODES.some((mode) => mode.id === modeId), true, `missing trace mode ${modeId}`);
}
for (const [modeId, tracePath] of Object.entries(expectedSuggestionTraceMap)) {
  const mode = SUGGESTION_TRACE_MODES.find((item) => item.id === modeId);
  assert.equal(mode?.path, tracePath, `trace mode path mismatch: ${modeId}`);
  assert.equal(mode?.filename, tracePath.split("/").at(-1), `trace mode filename mismatch: ${modeId}`);
  assert.notEqual(mode?.path, LIVE_PHYSICAL_TRACE_PATH, `suggestion trace overwrites standard physical trace: ${modeId}`);
}
const suggestionTracePaths = SUGGESTION_TRACE_MODES
  .filter((mode) => mode.id !== "standard")
  .map((mode) => mode.path);
assert.deepEqual(suggestionTracePaths, gate3bLiveManifest.required_traces);
for (const [index, tracePath] of suggestionTracePaths.entries()) {
  assert.equal(suggestionRunbook.includes(tracePath), true, `runbook missing ${tracePath}`);
  assert.equal(SUGGESTION_CAMPAIGN_STEPS[index].path, tracePath);
  assert.equal(SUGGESTION_CAMPAIGN_STEPS[index].filename, tracePath.split("/").at(-1));
  assert.equal(tracePath.startsWith("fixtures/replay/live/suggestions/"), true);
}
assert.equal(suggestionRunbook.includes("npm run physical:capture"), true);
assert.equal(suggestionRunbook.includes("Open the local URL"), true);
assert.equal(suggestionRunbook.includes("npm run gate:3b"), true);
assert.equal(suggestionRunbook.includes("npm run gate:3b:live"), true);
assert.equal(suggestionRunbook.includes("npm run suggestions:validate"), true);
assert.equal(suggestionRunbook.includes("npm run suggestions:report"), true);
assert.equal(suggestionRunbook.includes("live_suggestion_full_focus_ritual_001.v0.json"), true);
assert.equal(suggestionRunbook.includes("Suggestion Trace Campaign"), true);

const campaignStartState = createInitialState();
startCampaignTraceInState(campaignStartState, "suggestion_phone_moved");
assert.equal(campaignStartState.suggestionTraceMode, "suggestion_phone_moved");
assert.equal(campaignStartState.suggestionCampaign.active, true);
assert.equal(campaignStartState.suggestionCampaign.captureStatuses.suggestion_phone_moved, "active");
assert.equal(campaignStartState.suggestionCampaign.exportReadiness.suggestion_phone_moved, "blocked");
assert.equal(campaignStartState.suggestionCampaign.traceStatuses.suggestion_phone_moved, "active");
assert.equal(campaignStartState.exportReady, false);
assert.equal(campaignStartState.exported, false);
assert.equal(campaignStartState.suggestionStats.suggestionsGenerated, 0);
assert.equal(campaignStartState.suggestionStats.suggestionsAccepted, 0);
assert.equal(campaignStartState.suggestionStats.suggestionsRejected, 0);
assert.equal(campaignStartState.statusMessage.includes("Waiting for camera suggestion"), true);
assert.equal(campaignStartState.objective, "Perform the physical action and wait for a camera suggestion.");

for (const fixture of devSuggestionFixtures) {
  assert.equal(fixture.trace_origin.dev_dry_run, true);
  assert.equal(fixture.trace_origin.manual_fixture, true);
  assert.equal(fixture.trace_origin.physical_capture, false);
  assert.equal(fixture.trace_origin.operator_confirmed_physical_session, false);
  assert.equal(fixture.trace_origin.raw_media_persisted, false);
  assert.equal(fixture.metrics.suggestion_summary.auto_completed_steps, 0);
  assert.equal(fixture.metrics.suggestion_summary.llm_calls, 0);
  assert.equal(fixture.metrics.suggestion_summary.vlm_calls, 0);
  assert.equal(fixture.metrics.suggestion_summary.raw_media_persistence, 0);
  assert.equal(JSON.stringify(fixture).includes("data:image"), false);
  assert.equal(JSON.stringify(fixture).includes("base64"), false);
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

function seedMotion(zoneId, baseMs, scores) {
  scores.forEach((score, index) => {
    updateMotionHistory({
      zone_id: zoneId,
      motion_score: score,
      active: score >= LOCAL_MOTION.activeThreshold,
      confidence: Math.min(0.96, Math.max(0.5, score + 0.68)),
      timestamp_ms: baseMs + (index * 450)
    });
  });
}

function motionFrame(activeScores, timestampMs) {
  return REQUIRED_ZONES.map((zoneId) => {
    const motionScore = Number(activeScores[zoneId] ?? 0.004);
    return {
      zone_id: zoneId,
      motion_score: motionScore,
      active: motionScore >= LOCAL_MOTION.activeThreshold,
      confidence: Math.min(0.96, Math.max(0.5, motionScore + 0.68)),
      timestamp_ms: timestampMs
    };
  });
}

function rankedActionSuggestions(target, activeScores, timestampMs) {
  const observations = motionFrame(activeScores, timestampMs);
  return rankActionSuggestions(buildActionSuggestion({ target, observations, timestampMs }), target);
}

function syntheticLocalFrame(activeScores, timestampMs) {
  const observations = motionFrame(activeScores, timestampMs);
  for (const observation of observations) updateMotionHistory(observation);
  return buildLocalPerceptionFrame({
    timestamp_ms: timestampMs,
    zone_motion: Object.fromEntries(observations.map((observation) => [observation.zone_id, observation]))
  });
}

assert.equal(html.includes('data-product-card="detected-action"'), true, "Gate 4A Detected Action card exists");
assert.equal(html.includes("Describe my next movement sends a short temporary frame window only after you click."), true, "Gate 4A camera suggestion disclosure exists");
assert.equal(html.includes("Manual local confirmation — not automatic vision."), true, "Gate 4A manual confirmation disclosure exists");
assert.equal(html.includes("Uncertainty State"), true, "Gate 4A uncertainty shown");
assert.equal(html.includes('<details id="developerTools" class="dq-dev-tools" open'), false, "Gate 4A advanced tools closed by default");
for (const hiddenDefault of [
  "Gate 3B-Live",
  "Suggestion Trace Campaign",
  "campaign bundle",
  "Export Campaign Bundle",
  "live_suggestion_",
  "Preview Export JSON",
  "Export Preflight",
  "Blocked Button Reasons",
  "npm run suggestions:validate"
]) {
  assert.equal(defaultMainUi.toLowerCase().includes(hiddenDefault.toLowerCase()), false, `Gate 4A main UI hides ${hiddenDefault}`);
}
assert.equal(source.includes("requestAnimationFrame(processLocalPerceptionFrame)"), true, "Gate 4A local perception loop exists");
assert.equal(source.includes("Describe my next movement"), true, "AI movement narrator action exists");
assert.equal(source.includes('["checking", "capturing", "analyzing"].includes(target.movementRecognition.status)'), true, "double-click one-shot cost guard exists");
assert.equal(source.includes("dom.analyzeMovement.disabled = !state.cameraReady || analyzing"), true, "one-shot cost guard disables button while busy");
assert.equal(/setInterval\([^)]*analyzeMovementInState|requestAnimationFrame\([^)]*analyzeMovementInState/i.test(source), false, "one-shot cost guard prevents repeated analyze loop");
assert.equal(source.includes("Math.min(config.maxFrames ?? 4, 4)"), true, "one-shot cost guard caps capture frames");
assert.equal(source.includes('frame.data_uri = ""'), true, "one-shot cost guard clears frame buffers");
assert.equal(MOVEMENT_RECOGNITION_CLIENT_CONFIG.endpoint, "/api/movement-recognition/analyze");
assert.equal(launcherSource.includes('decodedPath === "/"') && launcherSource.includes("return prototypePath"), true, "root URL maps to prototype index");
assert.equal(launcherSource.includes("return join(prototypeRoot, normalize(decodedPath)"), true, "root static files resolve from prototype root");
assert.equal(source.includes('from "./perception/action-cooldowns.js"'), true, "perception module paths remain relative to prototype root");
assert.equal(launcherSource.includes("legacyPrototypePrefix") && launcherSource.includes("decodedPath.startsWith(legacyPrototypePrefix)"), true, "legacy deep URL fallback remains");
assert.equal(source.includes('boundDom.startCamera.addEventListener("click", startCamera)'), true, "Start Camera button handler is wired");
assert.equal(launcherSource.includes("movementRecognitionResponseForRequest"), true, "launcher serves movement recognition analyze API");
assert.equal(launcherSource.includes("movementRecognitionHealth"), true, "launcher serves movement recognition health API");
assert.equal(launcherSource.includes("cloud services: disabled"), false, "launcher copy no longer says cloud services disabled");
assert.equal(launcherSource.includes("LLM/VLM keys: not required"), false, "launcher copy no longer says LLM/VLM keys not required");
assert.equal(launcherSource.includes("HF_TOKEN"), true, "launcher copy mentions HF_TOKEN for AI movement recognition");
assert.equal(source.includes("DarkQuest app booted"), true, "boot diagnostic logs app boot");
assert.equal(source.includes("local-capture.js loaded"), true, "boot diagnostic logs module load");
assert.equal(source.includes("camera API available"), true, "boot diagnostic logs camera API availability");
assert.equal(source.includes("movement recognition endpoint configured"), true, "boot diagnostic logs movement endpoint");
assert.equal(MOVEMENT_RECOGNITION_CLIENT_CONFIG.maxFrames, 4);
assert.equal(MOVEMENT_RECOGNITION_CLIENT_CONFIG.windowMs, 1500);
assert.equal(MOVEMENT_RECOGNITION_ALLOWED_ACTIONS.includes("uncertain"), true);
assert.equal(/Authorization:\s*`Bearer|hf_secret|hf_test|hf_[A-Za-z0-9]{12,}/.test(source), false, "frontend does not expose HF token values");
assert.equal(source.includes("clearMovementFrameBuffer"), true, "frame buffer cleanup exists");
assert.equal(source.includes("queueMovementRecognitionFallback"), true, "local fallback exists");
assert.equal(source.includes("buildActionSuggestion"), true, "Gate 4A detected action candidate builder exists");
assert.equal(source.includes("rankActionSuggestions"), true, "Gate 4A current-step priority exists");
assert.equal(source.includes("scoreLocalActions"), true, "Gate 4A.1 deterministic action scorer exists");
assert.equal(source.includes("local_action_engine_status"), true, "Gate 4A.1 developer diagnostics are hidden in bug report");
assert.equal(source.includes('data-suggestion-action="accept"'), true, "Gate 4A Confirm button exists");
assert.equal(source.includes('data-suggestion-action="reject"'), true, "Gate 4A Not this button exists");
assert.equal(source.includes("Confidence ${suggestion.confidence.toFixed(2)}"), true, "Gate 4A confidence shown in natural copy");
assert.equal(source.includes("naturalizeMovementText"), true, "Gate 4A internal zone labels are naturalized");
assert.equal(source.includes("readableDetailHtml"), true, "Gate 4A reason shown in readable details");
assert.equal(/fetch\s*\(|WebSocket|OpenAI|OPENAI_API_KEY|sk-proj-|sk-[A-Za-z0-9]/i.test(source), false, "Gate 4A no LLM/VLM hooks");
assert.equal(/MediaRecorder|toDataURL|readAsDataURL|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon/i.test(source), false, "Gate 4A no raw media hooks");
for (const claim of ["autonomous vision", "object detection proven", "gesture recognition proven", "production perception", "production action recognition", "VLM-powered", "cloud vision"]) {
  assert.equal(`${html}\n${source}`.toLowerCase().includes(claim.toLowerCase()), false, `Gate 4A no autonomous vision claims: ${claim}`);
}

const gate4ActionState = preparedRecordingState("writing");
const gate4LocalFrame = syntheticLocalFrame({ notebook_zone: 0.071 }, 190800);
const gate4LocalFrameJson = JSON.stringify(gate4LocalFrame);
for (const rawMediaMarker of ["data:image", "base64", "screenshot", "raw_frame", "frame_data", "audio", "notebook_text"]) {
  assert.equal(gate4LocalFrameJson.includes(rawMediaMarker), false, `Gate 4A.1 local perception frame excludes ${rawMediaMarker}`);
}
assert.equal(Boolean(gate4LocalFrame.zone_motion?.notebook_zone), true, "Gate 4A.1 local perception frame keeps symbolic zone motion");
const gate4Candidates = rankActionSuggestions([
  createPerceptionSuggestion("gesture.detected", "notebook_zone", 0.84, "writing local motion candidate", "writing", 191400),
  createPerceptionSuggestion("gesture.detected", "keyboard_zone", 0.94, "future typing local motion", "typing", 191500)
], gate4ActionState);
const gate4WritingCandidate = gate4Candidates.find((suggestion) => suggestion.quest_step === "writing");
assert.equal(gate4WritingCandidate?.suggested_action, "Possible writing motion - confirm to accept.");
assert.equal(gate4WritingCandidate.confidence >= gate4ActionState.localPerceptionTuning.suggestionThreshold, true);
queuePerceptionSuggestion(gate4ActionState, gate4WritingCandidate);
assert.equal(gate4ActionState.events.some((event) => event.id === "evt_writing_like_motion"), false, "Gate 4A candidate does not progress before confirmation");
acceptSuggestionInState(gate4ActionState, gate4WritingCandidate.id);
const gate4Accepted = gate4ActionState.events.find((event) => event.id === "evt_writing_like_motion");
assert.equal(gate4Accepted.evidence.some((item) => item.kind === "local_signal" && item.contains_raw_media === false), true, "Gate 4A confirm emits local_signal");
assert.equal(gate4Accepted.evidence.some((item) => item.kind === "human_correction" && item.contains_raw_media === false), true, "Gate 4A confirm emits human_correction");

const gate4RejectState = preparedRecordingState("writing");
const gate4RejectCandidate = createPerceptionSuggestion("gesture.detected", "notebook_zone", 0.84, "reject test local motion", "writing", 192000);
queuePerceptionSuggestion(gate4RejectState, gate4RejectCandidate);
const gate4RejectQuestState = gate4RejectState.questState;
const gate4RejectEventCount = gate4RejectState.events.length;
rejectSuggestionInState(gate4RejectState, gate4RejectCandidate.id);
assert.equal(gate4RejectState.questState, gate4RejectQuestState, "Gate 4A reject action does not progress");
assert.equal(gate4RejectState.events.length, gate4RejectEventCount, "Gate 4A reject action emits no progress event");

const gate4PriorityState = preparedRecordingState("phone");
const gate4FutureCandidate = createPerceptionSuggestion("gesture.detected", "keyboard_zone", 0.94, "future typing local motion", "typing", 193000);
queuePerceptionSuggestion(gate4PriorityState, gate4FutureCandidate);
assert.equal(gate4PriorityState.perceptionSuggestions.length, 0, "Gate 4A current-step priority rejects future-step candidate");

const gate4EngineCases = [
  {
    step: "phone",
    actionType: "phone_moved",
    zone: "phone_zone",
    label: "Possible phone moved - confirm to accept.",
    frames: [
      { phone_zone: 0.066 },
      { phone_zone: 0.078, off_desk_zone: 0.058 },
      { phone_zone: 0.071, off_desk_zone: 0.061 }
    ]
  },
  {
    step: "notebook",
    actionType: "notebook_opened",
    zone: "notebook_zone",
    label: "Possible notebook opened - confirm to accept.",
    frames: [{ notebook_zone: 0.061 }, { notebook_zone: 0.067 }, { notebook_zone: 0.073 }]
  },
  {
    step: "pen",
    actionType: "pen_picked_up",
    zone: "pen_zone",
    label: "Possible pen picked up - confirm to accept.",
    frames: [{ pen_zone: 0.061 }, { pen_zone: 0.074, neutral_zone: 0.056 }, { pen_zone: 0.069, neutral_zone: 0.052 }]
  },
  {
    step: "writing",
    actionType: "writing_motion",
    zone: "notebook_zone",
    label: "Possible writing motion - confirm to accept.",
    frames: [{ notebook_zone: 0.063 }, { notebook_zone: 0.076 }, { notebook_zone: 0.071 }]
  },
  {
    step: "typing",
    actionType: "typing_motion",
    zone: "keyboard_zone",
    label: "Possible typing motion - confirm to accept.",
    frames: [{ keyboard_zone: 0.064 }, { keyboard_zone: 0.079 }, { keyboard_zone: 0.072 }]
  }
];
for (const [index, testCase] of gate4EngineCases.entries()) {
  const target = preparedRecordingState(testCase.step);
  let frame = null;
  for (const [frameIndex, scores] of testCase.frames.entries()) {
    frame = syntheticLocalFrame(scores, 300000 + (index * 10000) + (frameIndex * 500));
  }
  const candidates = scoreLocalActionFrame(frame, target);
  const candidate = candidates.find((item) => item.action_type === testCase.actionType);
  assert.equal(candidate?.label, testCase.label, `Gate 4A.1 ${testCase.actionType} candidate label`);
  assert.equal(candidate.zone_id, testCase.zone, `Gate 4A.1 ${testCase.actionType} candidate zone`);
  assert.equal(candidate.requires_confirmation, true, `Gate 4A.1 ${testCase.actionType} requires confirmation`);
  assert.equal(candidate.detection_method, "motion_proxy", `Gate 4A.1 ${testCase.actionType} detection method`);
  assert.equal(typeof candidate.reason, "string", `Gate 4A.1 ${testCase.actionType} has reason`);
  assert.equal(candidate.evidence.some((item) => item.kind === "local_signal" && item.contains_raw_media === false), true, `Gate 4A.1 ${testCase.actionType} local evidence`);
  assert.equal(candidate.confidence >= target.localPerceptionTuning.suggestionThreshold, true, `Gate 4A.1 ${testCase.actionType} confidence threshold`);
}
const gate4UncertainState = preparedRecordingState("phone");
const gate4UncertainFrame = syntheticLocalFrame({ phone_zone: 0.34, notebook_zone: 0.33, pen_zone: 0.35, keyboard_zone: 0.34 }, 380000);
assert.equal(scoreLocalActionFrame(gate4UncertainFrame, gate4UncertainState).some((candidate) => candidate.action_type === "uncertain"), true, "Gate 4A.1 uncertain candidate");
const gate4NotebookState = preparedRecordingState("notebook");
const gate4PhoneFrame = syntheticLocalFrame({ phone_zone: 0.079, off_desk_zone: 0.061 }, 390000);
assert.equal(scoreLocalActionFrame(gate4PhoneFrame, gate4NotebookState).some((candidate) => candidate.quest_step === "notebook"), false, "Gate 4A.1 phone signals do not trigger notebook step");
const gate4TypingState = preparedRecordingState("typing");
const gate4NotebookFrame = syntheticLocalFrame({ notebook_zone: 0.079 }, 400000);
assert.equal(scoreLocalActionFrame(gate4NotebookFrame, gate4TypingState).some((candidate) => candidate.quest_step === "typing"), false, "Gate 4A.1 notebook signals do not trigger typing step");

const gate4CooldownState = preparedRecordingState("writing");
const gate4CooldownFrame = syntheticLocalFrame({ notebook_zone: 0.079 }, 410000);
const gate4CooldownCandidate = scoreLocalActionFrame(gate4CooldownFrame, gate4CooldownState)[0];
queuePerceptionSuggestion(gate4CooldownState, gate4CooldownCandidate);
rejectSuggestionInState(gate4CooldownState, gate4CooldownCandidate.id);
const gate4RepeatedCandidate = createPerceptionSuggestion("gesture.detected", "notebook_zone", 0.84, "same rejected writing motion", "writing", 410200);
queuePerceptionSuggestion(gate4CooldownState, gate4RepeatedCandidate);
assert.equal(gate4CooldownState.perceptionSuggestions.filter((item) => item.status === "pending").length, 0, "Gate 4A.1 rejection cooldown suppresses repeated suggestion");
assert.equal(suggestionSummaryFor(gate4CooldownState).auto_completed_steps, 0, "Gate 4A.1 no auto-completed steps");

const gate4SmoothState = preparedRecordingState("writing");
const gate4SmoothPrevious = createPerceptionSuggestion("gesture.detected", "notebook_zone", 0.9, "previous writing motion", "writing", 420000);
queuePerceptionSuggestion(gate4SmoothState, gate4SmoothPrevious);
const gate4SmoothFrame = syntheticLocalFrame({ notebook_zone: 0.063 }, 420600);
const gate4Smoothed = scoreLocalActionFrame(gate4SmoothFrame, gate4SmoothState, { confidence_alpha: 0.5 })[0];
assert.equal(gate4Smoothed.confidence_smoothed_from, 0.9, "Gate 4A.1 confidence smoothing source");
assert.equal(gate4Smoothed.confidence > gate4Smoothed.raw_confidence, true, "Gate 4A.1 confidence smoothing applies");
assert.equal(smoothActionConfidence(0.9, 0.7, 0.5), 0.8, "Gate 4A.1 confidence smoothing deterministic");

const zoneEvent = zoneActivatedEventSpec("notebook_zone", 0.12, 640, 1234);
assert.equal(zoneEvent.type, "zone.activated");
assert.equal(zoneEvent.payload.zone_id, "notebook_zone");
assert.equal(zoneEvent.payload.activation_type, "local_motion");
assert.equal(zoneEvent.payload.motion_score, 0.12);
assert.equal(zoneEvent.payload.duration_ms, 640);
assert.equal(zoneEvent.evidence[0].kind, "local_signal");
assert.equal(zoneEvent.evidence[0].contains_raw_media, false);

const handEnter = motionProxyEventSpec("entered", "keyboard_zone", 0.77, 1400);
const handLeave = motionProxyEventSpec("left", "keyboard_zone", 0.73, 1900);
assert.equal(handEnter.type, "hand.entered_zone");
assert.equal(handLeave.type, "hand.left_zone");
assert.equal(handEnter.payload.detection_method, "motion_proxy");
assert.equal(handEnter.evidence[0].contains_raw_media, false);

const state = createInitialState();
const initialTopStatus = topStatusForState(state);
assert.equal(initialTopStatus.camera, "off");
assert.equal(initialTopStatus.calibration, "missing");
assert.equal(initialTopStatus.export, "not ready");
assert.equal(initialTopStatus.validation, "pending_export");
assert.equal(initialTopStatus.privacy, "raw_media_persisted=false");
assert.equal(initialTopStatus.models, "LLM=0 · VLM=0");
assert.equal(initialTopStatus.modelCost, "cost=$0");
let guards = getButtonGuards(state);
assert.equal(guards.startFocusRitual.enabled, false);
assert.match(guards.startFocusRitual.reason, /camera/);
assert.equal(guards.startRecording.enabled, false);
assert.match(guards.startRecording.reason, /camera/);
let preflight = runExportPreflight(state);
assert.equal(preflight.passed, false);
assert.equal(preflight.failures.some((failure) => failure.id === "camera_started"), true);

state.cameraReady = true;
state.cameraStarted = true;
state.cameraStatus = "granted";
assert.equal(topStatusForState(state).camera, "ready");

saveCalibrationToState(state, defaultCalibration());
assert.equal(state.questState, "calibrated");
assert.equal(state.stateHistory.includes("calibrated"), true);
assert.equal(state.events.some((event) => event.type === "scene.calibrated"), true);
assert.equal(state.events[0].evidence[0].contains_raw_media, false);
assert.equal(state.events[0].evidence[0].kind, "human_correction");
assert.equal(Object.keys(defaultCalibration().zoneGeometry).length, 6);
assert.equal(Object.keys(defaultCalibration().objectAssignments).length, 4);

startFocusRitualInState(state);
assert.equal(state.questState, "quest_started");
guards = getButtonGuards(state);
assert.equal(guards.startRecording.enabled, true);

startRecordingInState(state);
assert.equal(state.recording, true);
assert.equal(state.questState, "phone_removal_pending");
assert.equal(getButtonGuards(state).phone.enabled, true);
assert.equal(getButtonGuards(state).notebook.enabled, false);
preflight = runExportPreflight(state);
assert.equal(preflight.passed, false);
assert.equal(preflight.failures.some((failure) => failure.id === "recording_stopped"), true);

confirmStepInState(state, "typing");
assert.equal(state.questState, "phone_removal_pending");
assert.equal(state.events.some((event) => event.id === "evt_typing_like_motion"), false);
assert.match(state.errorMessage, /current objective/);

confirmStepInState(state, "phone");
assert.equal(state.questState, "notebook_pending");
assert.equal(state.events.some((event) => event.id === "evt_phone_moved_to_off_desk" && event.type === "object.moved"), true);
confirmStepInState(state, "notebook");
assert.equal(state.questState, "pen_pending");
assert.equal(state.events.some((event) => event.id === "evt_notebook_opened" && event.type === "object.placed" && event.payload.object_type === "notebook"), true);
confirmStepInState(state, "pen");
assert.equal(state.questState, "writing_pending");
assert.equal(state.events.some((event) => event.id === "evt_pen_moved_to_hand" && event.payload.to_zone_id === "zone_notebook"), true);
confirmStepInState(state, "writing");
assert.equal(state.questState, "typing_pending");
assert.equal(state.events.some((event) => event.id === "evt_writing_like_motion" && event.payload.gesture_type === "writing_motion"), true);
confirmStepInState(state, "typing");
assert.equal(state.questState, "quest_complete");
assert.equal(state.events.some((event) => event.id === "evt_typing_like_motion" && event.payload.gesture_type === "typing_motion"), true);
for (const requiredState of ["phone_removed", "notebook_opened", "pen_detected", "writing_detected", "typing_detected", "quest_complete"]) {
  assert.equal(state.stateHistory.includes(requiredState), true, `missing state transition ${requiredState}`);
}

stopRecordingInState(state);
preflight = runExportPreflight(state);
assert.equal(preflight.passed, false);
assert.equal(preflight.failures.some((failure) => failure.id === "physical_confirmed"), true);
assert.throws(() => buildReplayFixture(state), /Physical confirmation/);
state.physicalConfirmed = true;
assert.equal(getButtonGuards(state).exportTrace.enabled, true);
assert.equal(wizardStagesForState(state).length, 8);
preflight = runExportPreflight(state);
assert.equal(preflight.passed, true);
const preview = buildExportPreview(state);
assert.equal(preview.fixture_id, "live_physical_focus_ritual_001");
assert.equal(preview.expected_save_path, LIVE_PHYSICAL_TRACE_PATH);
assert.equal(preview.event_count, 6);
assert.equal(preview.llm_calls, 0);
assert.equal(preview.vlm_calls, 0);
assert.equal(topStatusForState(state).calibration, "saved");
assert.equal(topStatusForState(state).quest, "complete");
assert.equal(topStatusForState(state).export, "ready");

const fixture = buildReplayFixture(state);
assert.equal(fixture.schema, "darkquest.replay_fixture.v0");
assert.equal(fixture.fixture_id, "live_physical_focus_ritual_001");
assert.equal(fixture.trace_origin.source, "browser.local_camera");
assert.equal(fixture.trace_origin.manual_fixture, false);
assert.equal(fixture.trace_origin.dev_dry_run, false);
assert.equal(fixture.trace_origin.physical_capture, true);
assert.equal(fixture.trace_origin.operator_confirmed_physical_session, true);
assert.equal(fixture.trace_origin.raw_media_persisted, false);
assert.equal(fixture.privacy.contains_raw_video, false);
assert.equal(fixture.privacy.contains_audio, false);
assert.equal(fixture.expected.model_calls.length, 0);
assert.equal(fixture.expected.memory_writes.length, 0);
assert.equal(fixture.metrics.max_llm_calls, 0);
assert.equal(fixture.metrics.max_vlm_calls, 0);
assert.equal(fixture.metrics.max_cost_usd, 0);
assert.equal(fixture.metrics.suggestion_summary.suggestions_generated, 0);
assert.equal(fixture.metrics.suggestion_summary.suggestions_accepted, 0);
assert.equal(fixture.metrics.suggestion_summary.suggestions_rejected, 0);
assert.equal(fixture.metrics.suggestion_summary.auto_completed_steps, 0);
assert.equal(fixture.metrics.suggestion_summary.confirmation_required, true);
assert.equal(fixture.metrics.suggestion_summary.future_step_bypassed_order, false);
assert.equal(fixture.metrics.suggestion_summary.rejected_suggestion_progressed_quest, false);
assert.equal(fixture.metrics.suggestion_summary.llm_calls, 0);
assert.equal(fixture.metrics.suggestion_summary.vlm_calls, 0);
assert.equal(fixture.metrics.suggestion_summary.raw_media_persistence, 0);
assert.equal(fixture.input_events.length, 6);
assert.equal(fixture.input_events.every((event) => event.producer === "perception.local"), true);
assert.equal(fixture.input_events.every((event) => event.evidence.every((item) => item.contains_raw_media === false)), true);
assert.equal(fixture.expected.stable_events.every((matcher) => Object.keys(matcher.payload_match).length > 0), true);
assert.equal(fixture.metrics.browser_latency_records.length, 6);
assert.equal(fixture.expected.quest_transitions[1].trigger_event_id, "evt_notebook_opened");
assert.equal(fixture.expected.quest_transitions[2].trigger_event_id, "evt_pen_moved_to_hand");
assert.equal(JSON.stringify(fixture).includes("data:image"), false);
assert.equal(JSON.stringify(fixture).includes("base64"), false);
assert.equal(JSON.stringify(fixture).includes("screenshot"), false);
assert.equal(JSON.stringify(fixture).includes("notebook_text"), false);
assert.equal(fixture.input_events.some((event) => event.evidence.some((item) => item.kind === "human_correction")), true);

const sequenceInspection = inspectEventSequence(state);
assert.equal(sequenceInspection.length, 7);
assert.equal(sequenceInspection.every((item) => item.status === "present"), true);
assert.equal(sequenceInspection[0].matched_event_id, "evt_scene_calibrated");
assert.equal(typeof sequenceInspection[0].payload_summary, "string");
assert.equal(sequenceInspection[6].required_event_id, "quest_complete");

const bugReport = buildOperatorBugReport(state, { userAgent: "node-test" });
assert.equal(bugReport.schema, "darkquest.operator_bug_report.v0");
assert.equal(bugReport.app_version, "0.1.0");
assert.equal(bugReport.browser_user_agent, "node-test");
assert.equal(bugReport.calibration_saved, true);
assert.equal(bugReport.quest_state, "quest_complete");
assert.equal(bugReport.event_count >= 6, true);
assert.equal(bugReport.event_types.includes("scene.calibrated"), true);
assert.equal(bugReport.event_sequence.length, 7);
assert.equal(bugReport.symbolic_events.length >= 6, true);
assert.equal(bugReport.validation_commands.includes("npm run gate:1c"), true);
assert.equal(bugReport.validation_commands.includes("npm run gate:1e"), true);
assert.equal(bugReport.validation_commands.includes("npm run gate:2a"), false);
assert.equal(typeof bugReport.last_error, "string");
assert.equal(bugReport.model_status.llm_calls, 0);
assert.equal(bugReport.model_status.vlm_calls, 0);
assert.equal(bugReport.privacy_status.media_persisted, false);
for (const forbidden of ["raw_frame", "raw_video", "raw_audio", "screenshot", "base64", "ocr", "notebook_text", "api_key", "model_response", "cloud_evidence"]) {
  assert.equal(JSON.stringify(bugReport).toLowerCase().includes(forbidden), false, `bug report contains forbidden marker ${forbidden}`);
}

const suggestionState = createInitialState();
suggestionState.cameraReady = true;
suggestionState.cameraStarted = true;
saveCalibrationToState(suggestionState, defaultCalibration());
startFocusRitualInState(suggestionState);
startRecordingInState(suggestionState);
confirmStepInState(suggestionState, "phone");
confirmStepInState(suggestionState, "notebook");
confirmStepInState(suggestionState, "pen");
const writingSuggestion = createPerceptionSuggestion(
  "gesture.detected writing_like_motion",
  "notebook_zone",
  0.82,
  "repeated small local motion in notebook_zone",
  "writing",
  4700
);
suggestionState.perceptionSuggestions.push(writingSuggestion);
acceptSuggestionInState(suggestionState, writingSuggestion.id);
const acceptedWriting = suggestionState.events.find((event) => event.id === "evt_writing_like_motion");
assert.equal(suggestionState.questState, "typing_pending");
assert.equal(acceptedWriting.evidence.some((item) => item.kind === "local_signal" && item.contains_raw_media === false), true);
assert.equal(acceptedWriting.evidence.some((item) => item.kind === "human_correction" && item.contains_raw_media === false), true);
assert.equal(acceptedWriting.evidence.some((item) => item.kind === "local_signal" && item.detection_method === "motion_proxy" && item.suggestion_only === true), true);
assert.equal(acceptedWriting.payload.accepted_from_suggestion_id, writingSuggestion.id);
assert.equal(acceptedWriting.payload.detection_method, "motion_proxy");
assert.equal(acceptedWriting.payload.suggestion_source.kind, "camera_suggestion");

const rejectState = createInitialState();
rejectState.cameraReady = true;
rejectState.cameraStarted = true;
saveCalibrationToState(rejectState, defaultCalibration());
startFocusRitualInState(rejectState);
startRecordingInState(rejectState);
const typingSuggestion = createPerceptionSuggestion(
  "gesture.detected typing_like_motion",
  "keyboard_zone",
  0.8,
  "repeated distributed local motion in keyboard_zone",
  "typing",
  6200
);
rejectState.perceptionSuggestions.push(typingSuggestion);
const rejectQuestState = rejectState.questState;
const rejectEventCount = rejectState.events.length;
rejectSuggestionInState(rejectState, typingSuggestion.id);
assert.equal(rejectState.questState, rejectQuestState);
assert.equal(rejectState.events.length, rejectEventCount);
assert.equal(rejectState.perceptionSuggestions[0].status, "rejected");

const lowConfidenceState = createInitialState();
lowConfidenceState.cameraReady = true;
lowConfidenceState.cameraStarted = true;
saveCalibrationToState(lowConfidenceState, defaultCalibration());
startFocusRitualInState(lowConfidenceState);
startRecordingInState(lowConfidenceState);
confirmStepInState(lowConfidenceState, "phone");
confirmStepInState(lowConfidenceState, "notebook");
confirmStepInState(lowConfidenceState, "pen");
const lowConfidenceSuggestion = createPerceptionSuggestion(
  "gesture.detected writing_like_motion",
  "notebook_zone",
  0.61,
  "weak repeated small local motion in notebook_zone",
  "writing",
  5000
);
queuePerceptionSuggestion(lowConfidenceState, lowConfidenceSuggestion);
assert.equal(lowConfidenceState.perceptionSuggestions[0].low_confidence, true);
assert.equal(lowConfidenceState.questState, "writing_pending");
assert.equal(lowConfidenceState.events.some((event) => event.id === "evt_writing_like_motion"), false);

const futureStepState = createInitialState();
futureStepState.cameraReady = true;
futureStepState.cameraStarted = true;
saveCalibrationToState(futureStepState, defaultCalibration());
startFocusRitualInState(futureStepState);
startRecordingInState(futureStepState);
const futureSuggestion = createPerceptionSuggestion(
  "gesture.detected typing_like_motion",
  "keyboard_zone",
  0.84,
  "future typing-like local motion",
  "typing",
  5100
);
queuePerceptionSuggestion(futureStepState, futureSuggestion);
assert.equal(futureStepState.perceptionSuggestions.length, 0);
futureStepState.perceptionSuggestions.push(futureSuggestion);
acceptSuggestionInState(futureStepState, futureSuggestion.id);
assert.equal(futureStepState.questState, "phone_removal_pending");
assert.equal(futureStepState.events.some((event) => event.id === "evt_typing_like_motion"), false);

const cooldownState = createInitialState();
cooldownState.cameraReady = true;
cooldownState.cameraStarted = true;
saveCalibrationToState(cooldownState, defaultCalibration());
startFocusRitualInState(cooldownState);
startRecordingInState(cooldownState);
confirmStepInState(cooldownState, "phone");
confirmStepInState(cooldownState, "notebook");
confirmStepInState(cooldownState, "pen");
const cooldownSuggestionA = createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.81, "cooldown A", "writing", 6000);
const cooldownSuggestionB = createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.82, "cooldown B", "writing", 6000 + LOCAL_MOTION.suggestionCooldownMs - 1);
const cooldownSuggestionC = createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.83, "cooldown C", "writing", 6000 + LOCAL_MOTION.suggestionCooldownMs + 1);
queuePerceptionSuggestion(cooldownState, cooldownSuggestionA);
queuePerceptionSuggestion(cooldownState, cooldownSuggestionB);
assert.equal(cooldownState.perceptionSuggestions.length, 1);
queuePerceptionSuggestion(cooldownState, cooldownSuggestionC);
assert.equal(cooldownState.perceptionSuggestions.length, 1);
assert.equal(cooldownState.perceptionSuggestions[0].id, cooldownSuggestionC.id);
assert.equal(LOCAL_MOTION.suggestionCooldownMs > 0, true);

const uncertainSuggestionState = createInitialState();
uncertainSuggestionState.cameraReady = true;
uncertainSuggestionState.cameraStarted = true;
saveCalibrationToState(uncertainSuggestionState, defaultCalibration());
startFocusRitualInState(uncertainSuggestionState);
startRecordingInState(uncertainSuggestionState);
confirmStepInState(uncertainSuggestionState, "phone");
confirmStepInState(uncertainSuggestionState, "notebook");
confirmStepInState(uncertainSuggestionState, "pen");
markUncertainInState(uncertainSuggestionState);
const unsafeSuggestion = createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.86, "unsafe while uncertain", "writing", 7000);
queuePerceptionSuggestion(uncertainSuggestionState, unsafeSuggestion);
assert.equal(uncertainSuggestionState.perceptionSuggestions.length, 0);
uncertainSuggestionState.perceptionSuggestions.push(unsafeSuggestion);
acceptSuggestionInState(uncertainSuggestionState, unsafeSuggestion.id);
assert.equal(uncertainSuggestionState.uncertain, true);
assert.equal(uncertainSuggestionState.events.some((event) => event.id === "evt_writing_like_motion"), false);

const phoneActionState = preparedRecordingState("phone");
seedMotion("phone_zone", 100000, [0.062, 0.074, 0.069]);
seedMotion("off_desk_zone", 100300, [0.051, 0.058]);
const phoneActionSuggestions = rankedActionSuggestions(phoneActionState, { phone_zone: 0.07, off_desk_zone: 0.06 }, 101400);
const phoneSuggestion = phoneActionSuggestions.find((suggestion) => suggestion.quest_step === "phone");
assert.equal(computeMotionBurst("phone_zone").burst_score >= 0.069, true);
assert.equal(computeDirectionalChange("phone_zone").to_zone_id, "off_desk_zone");
assert.equal(phoneSuggestion?.suggested_event_type, "object.moved");
assert.equal(phoneSuggestion?.suggested_action, "Possible phone moved - confirm to accept.");
assert.equal(phoneSuggestion?.accepted, false);
assert.equal(phoneSuggestion?.rejected, false);
assert.equal(phoneSuggestion?.evidence.every((item) => item.contains_raw_media === false), true);

const futureActionSuggestions = rankedActionSuggestions(phoneActionState, { notebook_zone: 0.09 }, 102200);
assert.equal(futureActionSuggestions.some((suggestion) => suggestion.quest_step === "notebook"), false);

const acceptedActionState = preparedRecordingState("phone");
acceptedActionState.perceptionSuggestions.push(phoneSuggestion);
acceptSuggestionInState(acceptedActionState, phoneSuggestion.id);
const acceptedPhone = acceptedActionState.events.find((event) => event.id === "evt_phone_moved_to_off_desk");
assert.equal(acceptedActionState.questState, "notebook_pending");
assert.equal(phoneSuggestion.accepted, true);
assert.equal(acceptedPhone.payload.detection_method, "motion_proxy");
assert.equal(acceptedPhone.payload.accepted_from_suggestion_id, phoneSuggestion.id);
assert.equal(acceptedPhone.evidence.some((item) => item.kind === "local_signal" && item.suggestion_only === true), true);
assert.equal(acceptedPhone.evidence.some((item) => item.kind === "human_correction"), true);
const acceptedActionEventCount = acceptedActionState.events.length;
acceptSuggestionInState(acceptedActionState, phoneSuggestion.id);
rejectSuggestionInState(acceptedActionState, phoneSuggestion.id);
assert.equal(acceptedActionState.events.length, acceptedActionEventCount, "confirm/correct handling should be idempotent after accept");
assert.equal(suggestionSummaryFor(acceptedActionState).suggestions_accepted, 1);

const suggestionExportState = preparedRecordingState("writing");
startCampaignTraceInState(suggestionExportState, "suggestion_writing_motion");
const exportWritingSuggestion = createPerceptionSuggestion(
  "gesture.detected writing_like_motion",
  "notebook_zone",
  0.86,
  "exported writing suggestion",
  "writing",
  4700
);
queuePerceptionSuggestion(suggestionExportState, exportWritingSuggestion);
assert.equal(suggestionExportState.suggestionCampaign.captureStatuses.suggestion_writing_motion, "suggestion_seen");
assert.equal(suggestionExportState.suggestionCampaign.exportReadiness.suggestion_writing_motion, "blocked");
acceptSuggestionInState(suggestionExportState, exportWritingSuggestion.id);
assert.equal(suggestionExportState.suggestionCampaign.captureStatuses.suggestion_writing_motion, "accepted");
confirmStepInState(suggestionExportState, "typing");
stopRecordingInState(suggestionExportState);
suggestionExportState.physicalConfirmed = true;
const suggestionExportFixture = buildReplayFixture(suggestionExportState);
const exportedWriting = suggestionExportFixture.input_events.find((event) => event.id === "evt_writing_like_motion");
assert.deepEqual(suggestionExportFixture.input_events.map((event) => event.id), ["evt_scene_calibrated", "evt_writing_like_motion"]);
assert.equal(suggestionExportFixture.input_events.some((event) => event.id === "evt_phone_moved_to_off_desk"), false);
assert.equal(suggestionExportFixture.input_events.some((event) => event.id === "evt_notebook_opened"), false);
assert.equal(suggestionExportFixture.input_events.some((event) => event.id === "evt_pen_moved_to_hand"), false);
assert.equal(suggestionExportFixture.input_events.some((event) => event.id === "evt_typing_like_motion"), false);
assert.equal(suggestionExportFixture.fixture_id, "live_suggestion_writing_motion_001");
assert.equal(suggestionExportFixture.trace_origin.suggestion_trace_mode, "suggestion_writing_motion");
assert.equal(suggestionExportFixture.metrics.suggestion_summary.suggestions_generated, 1);
assert.equal(suggestionExportFixture.metrics.suggestion_summary.suggestions_accepted, 1);
assert.equal(suggestionExportFixture.metrics.suggestion_summary.suggestions_rejected, 0);
assert.equal(suggestionExportFixture.metrics.suggestion_summary.auto_completed_steps, 0);
assert.equal(suggestionExportFixture.suggestion_summary.confirmation_required, true);
assert.equal(suggestionExportFixture.suggestion_summary.future_step_bypassed_order, false);
assert.equal(suggestionExportFixture.suggestion_summary.rejected_suggestion_progressed_quest, false);
assert.equal(exportedWriting.payload.accepted_from_suggestion_id, exportWritingSuggestion.id);
assert.equal(exportedWriting.payload.detection_method, "motion_proxy");
assert.equal(exportedWriting.payload.suggestion_source.kind, "camera_suggestion");
assert.equal(exportedWriting.evidence.some((item) => item.kind === "local_signal" && item.contains_raw_media === false), true);
assert.equal(exportedWriting.evidence.some((item) => item.kind === "human_correction" && item.contains_raw_media === false), true);
assert.equal(runSuggestionTracePreflight(suggestionExportState).passed, true);
assert.notEqual(suggestionExportFixture.trace_origin.suggestion_trace_path, LIVE_PHYSICAL_TRACE_PATH);

for (const scenario of [
  ["phone", "suggestion_phone_moved", "object.moved", "phone_zone", "evt_phone_moved_to_off_desk"],
  ["notebook", "suggestion_notebook_opened", "gesture.detected", "notebook_zone", "evt_notebook_opened"],
  ["pen", "suggestion_pen_picked_up", "object.moved", "pen_zone", "evt_pen_moved_to_hand"]
]) {
  const [step, modeId, type, zoneId, expectedEventId] = scenario;
  const modeState = preparedRecordingState(step);
  startCampaignTraceInState(modeState, modeId);
  const suggestion = createPerceptionSuggestion(type, zoneId, 0.86, `${step} suggestion export`, step, 4720);
  queuePerceptionSuggestion(modeState, suggestion);
  acceptSuggestionInState(modeState, suggestion.id);
  stopRecordingInState(modeState);
  modeState.physicalConfirmed = true;
  const modeFixture = buildReplayFixture(modeState);
  assert.deepEqual(modeFixture.input_events.map((event) => event.id), ["evt_scene_calibrated", expectedEventId]);
  assert.equal(modeFixture.input_events.filter((event) => event.payload?.accepted_from_suggestion_id).length, 1);
}

let campaignSummary = campaignSummaryFor(suggestionExportState);
assert.equal(campaignSummary.traces_required, 8);
assert.equal(campaignSummary.traces_exported, 0);
assert.equal(campaignSummary.missing_traces.length, 8);
assert.equal(campaignSummary.generated_suggestions_total >= 1, true);
assert.equal(campaignSummary.auto_completed_steps_total, 0);
assert.equal(campaignSummary.llm_calls, 0);
assert.equal(campaignSummary.vlm_calls, 0);
assert.equal(campaignSummary.raw_media_persistence, 0);
assert.equal(campaignSummary.ready_for_gate_3b_live, false);
suggestionExportState.suggestionCampaign.exportedTraceIds.push("suggestion_writing_motion");
campaignSummary = campaignSummaryFor(suggestionExportState);
assert.equal(campaignSummary.traces_exported, 1);
assert.equal(campaignSummary.missing_traces.includes("fixtures/replay/live/suggestions/live_suggestion_writing_motion_001.v0.json"), false);

const acceptPreflightState = preparedRecordingState("writing");
acceptPreflightState.suggestionTraceMode = "suggestion_writing_motion";
let suggestionPreflight = runSuggestionTracePreflight(acceptPreflightState);
assert.equal(suggestionPreflight.passed, false);
assert.equal(suggestionPreflight.failures.some((failure) => failure.id === "suggestions_generated"), true);
assert.equal(suggestionPreflight.failures.some((failure) => failure.id === "suggestion_accept_required"), true);
queuePerceptionSuggestion(acceptPreflightState, createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.84, "queued but not accepted", "writing", 4800));
suggestionPreflight = runSuggestionTracePreflight(acceptPreflightState);
assert.equal(suggestionPreflight.passed, false);
assert.equal(suggestionPreflight.failures.some((failure) => failure.id === "suggestion_accept_required"), true);

const rejectPreflightState = preparedRecordingState("writing");
rejectPreflightState.suggestionTraceMode = "suggestion_reject";
const rejectTraceSuggestion = createPerceptionSuggestion("gesture.detected writing_like_motion", "notebook_zone", 0.83, "reject trace suggestion", "writing", 4900);
queuePerceptionSuggestion(rejectPreflightState, rejectTraceSuggestion);
suggestionPreflight = runSuggestionTracePreflight(rejectPreflightState);
assert.equal(suggestionPreflight.passed, false);
assert.equal(suggestionPreflight.failures.some((failure) => failure.id === "suggestion_reject_required"), true);
const rejectPreflightQuest = rejectPreflightState.questState;
rejectSuggestionInState(rejectPreflightState, rejectTraceSuggestion.id);
suggestionPreflight = runSuggestionTracePreflight(rejectPreflightState);
assert.equal(suggestionPreflight.passed, true);
assert.equal(rejectPreflightState.questState, rejectPreflightQuest);

const autoCompleteBlockedState = preparedRecordingState("writing");
autoCompleteBlockedState.suggestionTraceMode = "suggestion_writing_motion";
autoCompleteBlockedState.suggestionStats.autoCompletedSteps = 1;
suggestionPreflight = runSuggestionTracePreflight(autoCompleteBlockedState);
assert.equal(suggestionPreflight.failures.some((failure) => failure.id === "suggestion_no_auto_complete"), true);

const suggestionBugReport = buildOperatorBugReport(suggestionExportState, { userAgent: "node-test" });
assert.equal(suggestionBugReport.suggestion_trace_status.selected_trace_mode, "suggestion_writing_motion");
assert.equal(suggestionBugReport.suggestion_trace_status.suggestions_generated, 1);
assert.equal(suggestionBugReport.suggestion_trace_status.suggestions_accepted, 1);
assert.equal(suggestionBugReport.suggestion_trace_status.suggestions_rejected, 0);
assert.equal(suggestionBugReport.suggestion_trace_status.auto_completed_steps, 0);
assert.equal(suggestionBugReport.suggestion_trace_status.last_suggestion.contains_raw_media, false);
assert.equal(suggestionBugReport.suggestion_trace_status.suggestion_confidence, 0.86);
assert.equal(suggestionBugReport.suggestion_trace_status.suggestion_reason, "exported writing suggestion");
assert.equal(suggestionBugReport.suggestion_trace_status.export_blocked_reason, "ok");
assert.equal(suggestionBugReport.suggestion_trace_status.llm_calls, 0);
assert.equal(suggestionBugReport.suggestion_trace_status.vlm_calls, 0);
suggestionExportState.suggestionCampaign.active = true;
suggestionExportState.suggestionCampaign.currentIndex = 3;
suggestionExportState.suggestionCampaign.traceSummaries.suggestion_writing_motion = suggestionSummaryFor(suggestionExportState);
suggestionExportState.suggestionCampaign.lastSuggestions.suggestion_writing_motion = {
  id: exportWritingSuggestion.id,
  confidence: exportWritingSuggestion.confidence,
  reason: exportWritingSuggestion.reason,
  contains_raw_media: false
};
const campaignBugReport = buildOperatorBugReport(suggestionExportState, { userAgent: "node-test" });
assert.equal(campaignBugReport.suggestion_campaign_status.campaign_mode_active, true);
assert.equal(campaignBugReport.suggestion_campaign_status.current_campaign_step, "Suggestion Trace: Writing Motion");
assert.equal(campaignBugReport.suggestion_campaign_status.completed_trace_list.includes("fixtures/replay/live/suggestions/live_suggestion_writing_motion_001.v0.json"), true);
assert.equal(campaignBugReport.suggestion_campaign_status.missing_trace_list.length, 7);
assert.equal(campaignBugReport.suggestion_campaign_status.last_suggestion_per_trace.suggestion_writing_motion.confidence, 0.86);
assert.equal(campaignBugReport.suggestion_campaign_status.per_trace_counts.suggestion_writing_motion.suggestions_accepted, 1);
assert.equal(campaignBugReport.suggestion_campaign_status.validation_commands.includes("npm run gate:3b:live"), true);
assert.equal(campaignBugReport.suggestion_campaign_status.llm_calls, 0);
assert.equal(campaignBugReport.suggestion_campaign_status.vlm_calls, 0);

const notebookActionState = preparedRecordingState("notebook");
seedMotion("notebook_zone", 110000, [0.057, 0.061, 0.059]);
const notebookActionSuggestions = rankedActionSuggestions(notebookActionState, { notebook_zone: 0.061 }, 111400);
const notebookSuggestion = notebookActionSuggestions.find((suggestion) => suggestion.quest_step === "notebook");
assert.equal(computeZoneDwell("notebook_zone").dwell_ms >= 900, true);
assert.equal(notebookSuggestion?.suggested_event_type, "gesture.detected");
assert.equal(notebookSuggestion?.suggested_action, "Possible notebook opened - confirm to accept.");

const penActionState = preparedRecordingState("pen");
seedMotion("pen_zone", 120000, [0.058, 0.071, 0.063]);
seedMotion("neutral_zone", 120600, [0.052, 0.055]);
const penActionSuggestions = rankedActionSuggestions(penActionState, { pen_zone: 0.07, neutral_zone: 0.055 }, 121300);
const penSuggestion = penActionSuggestions.find((suggestion) => suggestion.quest_step === "pen");
assert.equal(penSuggestion?.suggested_event_type, "object.moved");
assert.equal(penSuggestion?.suggested_action, "Possible pen picked up - confirm to accept.");

const writingActionState = preparedRecordingState("writing");
seedMotion("notebook_zone", 130000, [0.07, 0.081, 0.076]);
const writingActionSuggestions = rankedActionSuggestions(writingActionState, { notebook_zone: 0.08, keyboard_zone: 0.004 }, 131200);
const writingAction = writingActionSuggestions.find((suggestion) => suggestion.quest_step === "writing");
assert.equal(writingAction?.suggested_event_type, "gesture.detected");
assert.equal(writingAction?.suggested_action, "Possible writing motion - confirm to accept.");
assert.equal(writingAction.suggested_action.toLowerCase().includes("automatic vision"), false);
assert.equal(writingAction.payload.suggestion_only, true);

const typingActionState = preparedRecordingState("typing");
seedMotion("keyboard_zone", 140000, [0.073, 0.086, 0.079]);
const typingActionSuggestions = rankedActionSuggestions(typingActionState, { keyboard_zone: 0.086 }, 141200);
const typingAction = typingActionSuggestions.find((suggestion) => suggestion.quest_step === "typing");
assert.equal(typingAction?.suggested_event_type, "gesture.detected");
assert.equal(typingAction?.suggested_action, "Possible typing motion - confirm to accept.");
assert.equal(typingAction.suggested_action.toLowerCase().includes("automatic vision"), false);
assert.equal(typingAction.payload.suggestion_only, true);

const limitedSuggestionState = preparedRecordingState("writing");
limitedSuggestionState.localPerceptionTuning.maxActiveSuggestions = 2;
const limitedSuggestions = rankActionSuggestions(buildActionSuggestion({
  target: limitedSuggestionState,
  observations: motionFrame({ phone_zone: 0.34, notebook_zone: 0.34, pen_zone: 0.34, keyboard_zone: 0.34 }, 150000),
  timestampMs: 150000
}), limitedSuggestionState);
assert.equal(limitedSuggestions.length <= 2, true);
assert.equal(limitedSuggestions.some((suggestion) => suggestion.quest_step === "uncertain"), true);

const expiringSuggestionState = preparedRecordingState("writing");
const expiringSuggestion = createPerceptionSuggestion("gesture.detected", "notebook_zone", 0.82, "short-lived writing suggestion", "writing", 160000, { ttl_ms: 100 });
queuePerceptionSuggestion(expiringSuggestionState, expiringSuggestion);
expireOldSuggestions(expiringSuggestionState, 160101);
assert.equal(expiringSuggestionState.perceptionSuggestions[0].status, "expired");

const rejectedActionState = preparedRecordingState("writing");
const rejectedActionSuggestion = createPerceptionSuggestion("gesture.detected", "notebook_zone", 0.83, "writing suggestion rejected by operator", "writing", 170000);
queuePerceptionSuggestion(rejectedActionState, rejectedActionSuggestion);
rejectSuggestionInState(rejectedActionState, rejectedActionSuggestion.id);
assert.equal(rejectedActionSuggestion.rejected, true);
assert.equal(rejectedActionState.rejectedSuggestionCooldowns[rejectedActionSuggestion.key] > 0, true);
assert.equal(rejectedActionState.questState, "writing_pending");
assert.equal(rejectedActionState.events.some((event) => event.id === "evt_writing_like_motion"), false);
rejectSuggestionInState(rejectedActionState, rejectedActionSuggestion.id);
assert.equal(suggestionSummaryFor(rejectedActionState).suggestions_generated, 1);
assert.equal(suggestionSummaryFor(rejectedActionState).suggestions_accepted, 0);
assert.equal(suggestionSummaryFor(rejectedActionState).suggestions_rejected, 1);
assert.equal(suggestionSummaryFor(rejectedActionState).auto_completed_steps, 0);
assert.equal(suggestionSummaryFor(rejectedActionState).rejected_suggestion_progressed_quest, false);

const rejectedExportState = preparedRecordingState("writing");
startCampaignTraceInState(rejectedExportState, "suggestion_reject");
const rejectExportSuggestion = createPerceptionSuggestion("gesture.detected", "notebook_zone", 0.83, "writing suggestion rejected before manual completion", "writing", 171000);
queuePerceptionSuggestion(rejectedExportState, rejectExportSuggestion);
assert.equal(rejectedExportState.suggestionCampaign.captureStatuses.suggestion_reject, "suggestion_seen");
const rejectExportQuestState = rejectedExportState.questState;
const rejectExportEventCount = rejectedExportState.events.length;
rejectSuggestionInState(rejectedExportState, rejectExportSuggestion.id);
assert.equal(rejectedExportState.questState, rejectExportQuestState);
assert.equal(rejectedExportState.events.length, rejectExportEventCount);
assert.equal(rejectedExportState.suggestionCampaign.captureStatuses.suggestion_reject, "rejected");
confirmStepInState(rejectedExportState, "writing");
confirmStepInState(rejectedExportState, "typing");
stopRecordingInState(rejectedExportState);
rejectedExportState.physicalConfirmed = true;
const rejectedExportFixture = buildReplayFixture(rejectedExportState);
assert.equal(rejectedExportFixture.fixture_id, "live_suggestion_reject_does_not_progress_001");
assert.deepEqual(rejectedExportFixture.input_events.map((event) => event.id), ["evt_scene_calibrated"]);
assert.equal(rejectedExportFixture.expected.quest_transitions.length, 0);
assert.equal(rejectedExportFixture.suggestion_summary.suggestions_generated, 1);
assert.equal(rejectedExportFixture.suggestion_summary.suggestions_accepted, 0);
assert.equal(rejectedExportFixture.suggestion_summary.suggestions_rejected, 1);
assert.equal(rejectedExportFixture.suggestion_summary.auto_completed_steps, 0);
assert.equal(rejectedExportFixture.suggestion_summary.rejected_suggestion_progressed_quest, false);
assert.equal(rejectedExportFixture.input_events.some((event) => event.payload?.accepted_from_suggestion_id === rejectExportSuggestion.id), false);
assert.equal(runSuggestionTracePreflight(rejectedExportState).passed, true);

const uncertainActionState = preparedRecordingState("phone");
const uncertaintySuggestions = rankedActionSuggestions(uncertainActionState, {
  phone_zone: 0.34,
  notebook_zone: 0.33,
  pen_zone: 0.35,
  keyboard_zone: 0.34
}, 180000);
const uncertaintySuggestion = uncertaintySuggestions.find((suggestion) => suggestion.quest_step === "uncertain");
assert.equal(uncertaintySuggestion?.suggested_event_type, "scene.uncertain");
uncertainActionState.perceptionSuggestions.push(uncertaintySuggestion);
acceptSuggestionInState(uncertainActionState, uncertaintySuggestion.id);
const acceptedUncertainty = uncertainActionState.events.find((event) => event.type === "scene.uncertain");
assert.equal(acceptedUncertainty.payload.accepted_from_suggestion_id, uncertaintySuggestion.id);
assert.equal(acceptedUncertainty.evidence.some((item) => item.kind === "local_signal" && item.suggestion_only === true), true);
assert.equal(acceptedUncertainty.evidence.some((item) => item.kind === "human_correction"), true);

const dryRun = buildReplayFixture(state, { devDryRun: true });
assert.equal(dryRun.fixture_id, "gate_1d_dry_run_export");
assert.equal(dryRun.trace_origin.manual_fixture, true);
assert.equal(dryRun.trace_origin.physical_capture, false);
assert.equal(dryRun.trace_origin.operator_confirmed_physical_session, false);
assert.equal(dryRun.trace_origin.dev_dry_run, true);
assert.equal(dryRun.metrics.max_llm_calls, 0);
assert.equal(dryRun.metrics.max_vlm_calls, 0);

const diagnosticState = createInitialState();
diagnosticState.cameraReady = true;
diagnosticState.cameraStarted = true;
saveCalibrationToState(diagnosticState, defaultCalibration());
startFocusRitualInState(diagnosticState);
startRecordingInState(diagnosticState);
markUncertainInState(diagnosticState);
assert.equal(diagnosticState.events.some((event) => event.type === "scene.uncertain" && event.evidence[0].contains_raw_media === false), true);
assert.equal(runExportPreflight(diagnosticState).passed, false);

const resetState = resetSessionInState(diagnosticState);
assert.equal(resetState.questState, "idle");
assert.equal(resetState.recording, false);
assert.equal(resetState.recordingStarted, false);
assert.equal(resetState.events.length, 0);
assert.equal(resetState.latencyRecords.length, 0);
assert.equal(resetState.errorMessage, "");
assert.equal(resetState.physicalConfirmed, false);
assert.equal(resetState.exported, false);

resetState.cameraReady = true;
resetState.cameraStarted = true;
saveCalibrationToState(resetState, defaultCalibration());
startFocusRitualInState(resetState);
startRecordingInState(resetState);
markCameraResetInState(resetState);
assert.equal(resetState.events.some((event) => event.type === "scene.reset" && event.evidence[0].contains_raw_media === false), true);
assert.equal(resetState.recording, false);

console.log("ok gate1d prototype flow smoke");
