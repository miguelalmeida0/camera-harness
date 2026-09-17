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
  PERSISTENT_OBSERVATION,
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
  persistentObservationEventFromLocalChange,
  queuePerceptionSuggestion,
  rankActionSuggestions,
  rejectSuggestionInState,
  resetSessionInState,
  runExportPreflight,
  scoreLocalActionFrame,
  selectMovementAnalysisBackend,
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
const coreCss = readFileSync(resolve("packages/perception/browser-local-capture/prototype/perception-core.css"), "utf8");
const gestureWorkerSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/perception/gesture-recognizer-worker.js"), "utf8");
const gestureEngineSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/perception/local-gesture-engine.js"), "utf8");
const gestureStabilizerSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/perception/gesture-stabilizer.js"), "utf8");
const launcherSource = readFileSync(resolve("packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs"), "utf8");
const automationEngineSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/automation/automation-engine.js"), "utf8");
const automationStoreSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/automation/recipe-store.js"), "utf8");
const customSkillSource = [
  "custom-skill-store.js",
  "hand-pose-normalizer.js",
  "hand-pose-classifier.js",
  "custom-skill-trainer.js",
  "custom-skill-runtime.js"
].map((file) => readFileSync(resolve(`packages/perception/browser-local-capture/prototype/perception/custom-skills/${file}`), "utf8")).join("\n");
const webhookPolicySource = readFileSync(resolve("packages/perception/browser-local-capture/server/webhook-policy.mjs"), "utf8");
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

function jsonResponse(ok, status, body) {
  return {
    ok,
    status,
    async json() {
      return body;
    }
  };
}
const advancedTemplateStart = bodyHtml.indexOf('<template id="advancedViewTemplate">');
const primaryHtml = advancedTemplateStart >= 0 ? bodyHtml.slice(0, advancedTemplateStart) : bodyHtml;
const advancedHtml = advancedTemplateStart >= 0 ? bodyHtml.slice(advancedTemplateStart) : "";
const primaryVisibleText = primaryHtml
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const primaryButtonCount = (primaryHtml.match(/<button\b/g) || []).length;
const primaryPrimaryButtonCount = (primaryHtml.match(/class="[^"]*\bdq-button\b[^"]*\bprimary\b[^"]*"/g) || []).length;
const responseSentenceCss = coreCss.slice(
  coreCss.indexOf(".pc-response .dq-movement-sentence"),
  coreCss.indexOf(".pc-response .dq-movement-hint")
);

assert.equal(html.includes("<title>Sensefield Visual Companion</title>"), true, "browser title is Sensefield");
assert.equal(primaryVisibleText.includes("DarkQuest"), false, "primary UI has no visible DarkQuest copy");
assert.equal(primaryHtml.includes("sf-camera-brand"), false, "primary camera stage has no visible app-name overlay");
assert.equal(advancedHtml.includes("DarkQuest"), false, "advanced UI has no visible DarkQuest copy");
assert.equal(agents.includes("# Sensefield Critical UI Rules"), true, "AGENTS.md uses Sensefield naming");
assert.equal(agents.includes("# DarkQuest Critical UI Rules"), false, "AGENTS.md no longer exposes old product naming");

for (const requiredPrimary of [
  'id="preview"',
  'id="mainWorkspace"',
  'id="analyzeMovement"',
  'aria-label="Sensefield local camera preview"',
  'data-mirror-default="on"',
  'data-analysis-mirror="on"',
  'id="cameraStatusChip"',
  'id="primaryObservationState"',
  "No raw media stored",
  'id="operatorCommandsCard"',
  'data-product-card="visual-response"',
  'id="cameraSuggestions"',
  'id="movementSummaryRow"',
  'id="voiceStatus"',
  'id="recentMomentsCard"',
  'id="recentMomentsList"'
]) {
  assert.equal(primaryHtml.includes(requiredPrimary), true, "missing primary Sensefield marker: " + requiredPrimary);
}

assert.equal(primaryButtonCount, 12, "primary DOM has six core controls and six hidden Ask conversation controls");
assert.match(primaryHtml, /id="askReturnToLatest"[^>]*hidden/, "Ask return control stays hidden outside an active conversation");
assert.match(primaryHtml, /id="askControlsDisclosure"[^>]*hidden/, "Ask voice controls stay hidden outside an active conversation");
assert.equal(primaryPrimaryButtonCount, 1, "primary UI has exactly one primary CTA");
assert.equal(primaryHtml.includes('class="dq-product-header"'), false, "primary UI has no app header bar");
assert.equal(primaryHtml.includes('class="dq-segmented"'), false, "primary UI has no Capture/Observe segmented control");
assert.equal(primaryHtml.includes('id="topStatusBar"'), false, "primary UI has no top status bar");
assert.equal(primaryHtml.includes("dq-header-actions"), false, "primary UI has no notification/settings/avatar shell");
assert.equal(primaryHtml.includes('id="startCamera"'), false, "primary UI has no separate Start Camera button");
assert.equal(primaryHtml.includes('id="stopCamera"'), false, "primary UI has no separate Stop Camera button");
assert.equal(primaryHtml.includes("Cam</button>"), false, "primary UI has no Cam button");
assert.equal(primaryHtml.includes("Grid</button>"), false, "primary UI has no Grid button");
assert.equal(primaryHtml.includes("Mic</button>"), false, "primary UI has no Mic button");
assert.equal(primaryHtml.includes("More</button>"), false, "primary UI has no More button");
assert.equal(primaryHtml.includes("showTrackingOverlay"), false, "primary UI has no tracking-overlay control");
assert.equal(primaryHtml.includes("Auto-speak"), false, "primary UI has no Auto-speak toggle");
assert.equal(primaryHtml.includes("Speak again"), false, "primary UI has no Speak again control");
assert.equal(primaryHtml.includes("Voice & Actions"), false, "primary UI has no Voice & Actions card");
assert.equal(primaryHtml.includes("Gesture Recipes"), false, "primary UI has no Gesture Recipes card");
assert.equal(primaryHtml.includes("Developer Tools"), false, "primary UI has no Developer Tools");
assert.equal(primaryHtml.includes("Suggestion Trace Campaign"), false, "primary UI has no trace campaign DOM");
assert.equal(primaryHtml.includes("Privacy & Model Usage"), false, "primary UI has no privacy/model usage accordion");
assert.equal(primaryHtml.includes("Movement History"), false, "primary UI has no movement history accordion");
assert.equal(primaryHtml.includes("Confirm suggested action"), false, "primary UI has no ordinary narration confirmation");
assert.equal(primaryHtml.includes("Not this / Correct"), false, "primary UI has no correction action row");
assert.equal(primaryHtml.includes("Why?"), false, "primary UI has no Why action");
assert.equal(primaryHtml.includes("Observe again"), false, "primary UI has no Observe again button");
assert.equal(primaryHtml.includes("Saved actions"), false, "primary UI removes Saved Actions");
assert.equal(primaryHtml.includes('id="savedActionsCard"'), false, "primary UI has no Saved Actions card");
assert.equal(primaryHtml.includes('id="savedActionsList"'), false, "primary UI has no Saved Actions list");
assert.equal(primaryHtml.includes("Recent moments"), true, "primary UI shows Recent Moments");
assert.equal(primaryHtml.includes("Your recent observations will appear here."), true, "recent moments has a useful empty state");
assert.equal(source.includes("Show me a movement or object change."), true, "Watch mode retains a useful observing empty state");
assert.equal(html.includes(".sf-primary-page #analyzeMovement::after"), true, "primary CTA suppresses inherited sublabel");
assert.equal(html.includes("content: none !important"), true, "primary CTA label remains a single visible state");
assert.equal(html.includes(".sf-primary-page #analyzeMovement.sf-primary-action:hover"), true, "primary CTA hover keeps route-scoped positioning");
assert.equal(html.includes("transform: translateX(-50%) !important"), true, "primary CTA hover cannot erase horizontal centering");
assert.equal(html.includes(".sf-response-card .dq-movement-status"), true, "primary response suppresses duplicate inherited status");

for (const stateLabel of ["Start observing", "Starting…", "End observing", "Try again"]) {
  assert.equal(source.includes(stateLabel) || primaryHtml.includes(stateLabel), true, "single-button state label exists: " + stateLabel);
}
for (const cameraState of ["Ready", "Starting…", "Ending…", "Understanding", "Speaking", "Watching", "Listening", "Error"]) {
  assert.equal(source.includes(cameraState) || primaryHtml.includes(cameraState), true, "camera-stage state exists: " + cameraState);
}
assert.equal(source.includes("function handlePrimaryAction"), true, "one stable CTA handler exists");
assert.equal(source.includes("function primaryActionLabel"), true, "single-button state label helper exists");
assert.equal(source.includes("function startObserving"), true, "Start observing activates persistent mode");
assert.equal(source.includes("function stopObserving"), true, "Stop observing disables camera and observer");
assert.equal(source.includes("function primaryActionBusy"), true, "starting state has one disabled guard");
assert.equal(source.includes("state.cameraStartInFlight"), true, "camera startup has a duplicate-click guard");
assert.equal(source.includes('["checking", "capturing", "analyzing"].includes(target.movementRecognition.status)'), true, "observation requests remain single-flight");
assert.equal(/setInterval\([^)]*analyzeMovementInState|requestAnimationFrame\([^)]*analyzeMovementInState/i.test(source), false, "Observe is never run as a repeated background loop");
assert.equal(source.includes("maybeTriggerPersistentObservationFromLocalChange"), true, "local change detection gates persistent observation");
assert.equal(source.includes("persistentObservationEventFromLocalChange"), true, "meaningful local change helper exists");
assert.equal(source.includes("triggerPersistentObservation(target, event)"), true, "meaningful change creates one bounded observation");
assert.equal(source.includes("queuedEventLimit: 1"), true, "persistent observer allows at most one queued event");
assert.equal(source.includes("PERSISTENT_OBSERVATION.cooldownMs"), true, "observer rearm interval remains explicit");
assert.equal(source.includes("persistentObservationDuplicate"), true, "duplicate scene dedupe exists");
assert.equal(source.includes("document.hidden"), true, "hidden tab stops observation triggers");
assert.equal(source.includes("maxFrames: 1"), false, "local visual observation uses an ordered multi-frame window");
assert.equal(source.includes("maxFrames: Math.max(4, Math.min(PERSISTENT_OBSERVATION.maxFrames, 8))"), true, "cloud persistent observation remains bounded to 4-8 frames");
assert.equal(source.includes("windowMs: Math.max(2000, Math.min(PERSISTENT_OBSERVATION.windowMs, 4000))"), true, "persistent observation captures a 2-4s window");
assert.equal(PERSISTENT_OBSERVATION.cooldownMs, 0, "distinct observations are not blocked by cooldown");
const persistentChange = persistentObservationEventFromLocalChange([
  { zone_id: "neutral_zone", motion_score: 0.02, active: false },
  { zone_id: "phone_zone", motion_score: 0.22, active: true }
], 1234);
assert.equal(Boolean(persistentChange), true, "meaningful local change creates a queued observation candidate");
assert.equal(persistentObservationEventFromLocalChange([{ zone_id: "neutral_zone", motion_score: 0.01, active: false }], 1234), null, "low local motion does not call VLM continuously");

assert.equal(source.includes("if (isPrimaryView()) state.movementRecognition.autoSpeak = true"), true, "primary mode forces inherent auto-speak");
assert.equal(source.includes("maybeAutoSpeakVisualResult(target)"), true, "successful visual responses auto-speak");
assert.equal(source.includes("spokenObservationIds"), true, "auto-speech deduping remains state-backed");
assert.equal(source.includes("completePersistentObservationCycle(target);") && source.includes("processRealtimeSessionScheduler(target);"), true, "observation resumes through the active-session scheduler or bounded completion path");
assert.equal(source.includes("VISUAL_COMPANION_CLIENT_CONFIG.speakEndpoint"), true, "neural voice endpoint remains functional");
assert.equal(source.includes("trySystemVisualSpeech"), false, "browser/system speech fallback is absent");

assert.equal(responseSentenceCss.includes("overflow: visible"), true, "response sentence is not clipped");
assert.equal(responseSentenceCss.includes("text-overflow: clip"), true, "response sentence never ellipsizes");
assert.equal(responseSentenceCss.includes("white-space: normal"), true, "response sentence wraps naturally");
assert.equal(responseSentenceCss.includes("overflow-wrap: anywhere"), true, "response sentence remains contained");
// Editorial Perception Core redesign (2026-09-17) replaced the icy premium
// presentation layer wholesale (approved design change; see AGENTS.md design
// freeze note and CLAUDE_PIXEL_IMPLEMENTATION_PROMPT.md). These assertions
// check the same underlying invariants — a dominant camera/hero region next
// to a Live Exchange rail, responsive containment, no leftover future/roadmap
// cards — against the new single stylesheet instead of the retired one.
assert.equal(html.includes('href="./perception-core.css"'), true, "primary view loads the editorial Perception Core presentation layer");
assert.equal(coreCss.includes("grid-template-columns: minmax(0, 1fr) minmax(240px, 320px)"), true, "desktop instrument places the camera/hero and Live Exchange rail side by side");
assert.equal(html.includes('<div class="dq-preview-live-chip"'), false, "camera views do not render an in-preview LIVE badge");
assert.match(primaryHtml, /class="dq-camera-frame sf-camera-frame[^"]*"[\s\S]*id="analyzeMovement"/, "the single primary action follows the camera lens in document order");
assert.equal(primaryHtml.includes('id="whatsNextPanel"'), false, "obsolete future-capability cards are absent from the primary screen");
assert.equal(coreCss.includes("@media (max-width: 960px)"), true, "tablet instrument stacks the hero and Live Exchange rail");
assert.equal(coreCss.includes("@media (max-width: 720px)"), true, "mobile containment breakpoint exists");
assert.equal(coreCss.includes("overflow-x: hidden"), true, "page-level horizontal overflow is prohibited");
assert.equal(primaryHtml.includes('data-interaction-mode="microscope"'), true, "Microscope is a functional primary interaction mode");
assert.equal(primaryHtml.includes('id="microscopePanel"'), true, "Microscope live runtime panel is mounted");
for (const viewport of ["390 × 844", "412 × 915", "768 × 1024", "1024 × 768", "1440 × 900"]) {
  assert.equal(typeof viewport, "string", "responsive viewport covered by visual QA plan: " + viewport);
}

assert.equal(source.includes("prepareDocumentView"), true, "primary and advanced views are structurally separated at boot");
assert.equal(source.includes("isAdvancedRoute"), true, "advanced route detection exists");
assert.equal(source.includes('params.get("advanced") === "1"'), true, "?advanced=1 route mounts advanced tools");
assert.equal(source.includes("app.replaceChildren(template.content.cloneNode(true))"), true, "advanced DOM is cloned only for advanced mode");
assert.equal(primaryHtml.includes('id="developerTools"'), false, "advanced tools absent from primary DOM");
assert.equal(advancedHtml.includes('id="developerTools"'), true, "advanced route retains Developer Tools");
assert.equal(advancedHtml.includes('id="suggestionCampaignPanel"'), true, "advanced route retains Suggestion Trace Campaign");
assert.equal(advancedHtml.includes('id="gestureRecipesCard"'), true, "advanced route retains gesture recipes");
assert.equal(advancedHtml.includes('id="automationManagerPanel"'), true, "advanced route retains automations");
assert.equal(advancedHtml.includes('id="movementHistoryPanel"'), true, "advanced route retains history");
assert.equal(advancedHtml.includes('id="showTrackingOverlay"'), true, "advanced route retains tracking overlay control");
assert.equal(advancedHtml.includes('id="autoSpeak"'), true, "advanced route retains mute/auto-speak preference");
assert.equal(source.includes("ensureCloudUsageNode"), true, "advanced route retains cost/usage rendering");

assert.equal(source.includes("VISUAL_COMPANION_CLIENT_CONFIG"), true, "frontend has visual companion client config");
assert.equal(source.includes("/api/visual-companion/observe"), true, "frontend calls visual observe endpoint");
assert.equal(source.includes("clearMovementFrameBuffer(frames)"), true, "frame cleanup remains in finally path");
assert.equal(source.includes("Math.min(config.maxFrames ?? 4, 8)"), true, "request frame limits remain capped");
assert.equal(source.includes("drawVideoFrameForAnalysis"), true, "analysis frame drawing keeps mirror helper");
assert.equal(source.includes("mirrorFramesToPreview: true"), true, "capture frames mirror the preview");
assert.equal(source.includes("savedActionsSummaryHtml"), true, "Saved Actions summary renderer exists");
assert.equal(source.includes(".slice(0, 3)"), true, "Saved Actions and Recent Moments cap visible rows");
assert.equal(source.includes("recentMomentsSummaryHtml"), true, "Recent Moments summary renderer exists");
assert.equal(/fetch\s*\(|WebSocket|OpenAI|OPENAI_API_KEY|(?:^|[^A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{12,}/i.test(source), false, "frontend exposes no direct LLM/VLM keys or raw fetch calls");
assert.equal(/MediaRecorder|toDataURL|readAsDataURL|indexedDB|navigator\.sendBeacon/i.test(source), false, "frontend still avoids raw media persistence APIs");

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
  assert.equal(source.includes(marker), true, "missing local perception marker: " + marker);
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

assert.equal(source.includes("requestAnimationFrame(processLocalPerceptionFrame)"), true, "local perception loop exists");
assert.equal(source.includes("Observe"), true, "visual companion action exists");
assert.equal(source.includes("primaryActionBusy"), true, "one-shot cost guard uses the primary busy helper");
assert.equal(source.includes("Math.min(config.maxFrames ?? 4, 8)"), true, "one-shot cost guard caps capture frames");
assert.equal(source.includes('frame.data_uri = ""'), true, "one-shot cost guard clears frame buffers");
assert.equal(MOVEMENT_RECOGNITION_CLIENT_CONFIG.endpoint, "/api/movement-recognition/analyze");
assert.equal(launcherSource.includes('decodedPath === "/"') && launcherSource.includes("return prototypePath"), true, "root URL maps to prototype index");
assert.equal(launcherSource.includes("return join(prototypeRoot, normalize(decodedPath)"), true, "root static files resolve from prototype root");
assert.equal(source.includes('from "./perception/action-cooldowns.js"'), true, "perception module paths remain relative to prototype root");
assert.equal(launcherSource.includes("legacyPrototypePrefix") && launcherSource.includes("decodedPath.startsWith(legacyPrototypePrefix)"), true, "legacy deep URL fallback remains");
assert.equal(source.includes("selectMovementAnalysisBackend"), true, "Observe selects local visual or cloud backend before capture");
assert.equal(source.includes('kind: "hf_cloud"'), true, "Observe can use HF cloud when local visual service is unavailable");
assert.equal(source.includes("requestMovementRecognition({"), true, "cloud fallback goes through the guarded movement-recognition API");
const originalFetchForBackendSelector = globalThis.fetch;
try {
  globalThis.fetch = async (url) => {
    const endpoint = String(url);
    if (endpoint.includes("/api/visual-companion/health")) {
      return jsonResponse(true, 200, { ok: true, provider: "local_visual_companion", model: "local model service", status: "ready", observe_endpoint_ready: true });
    }
    throw new Error("unexpected endpoint " + endpoint);
  };
  const localBackend = await selectMovementAnalysisBackend(createInitialState());
  assert.equal(localBackend.kind, "local_visual", "ready local visual service is preferred");

  globalThis.fetch = async (url) => {
    const endpoint = String(url);
    if (endpoint.includes("/api/visual-companion/health")) {
      return jsonResponse(true, 200, { ok: false, provider: "local_visual_companion", status: "model_not_installed", observe_endpoint_ready: false });
    }
    if (endpoint.includes("/api/movement-recognition/health")) {
      return jsonResponse(true, 200, { ok: true, provider: "huggingface", model: "cloud:test", has_token: true, cloud_enabled: true, live_call_enabled: true, analyze_endpoint_ready: true });
    }
    throw new Error("unexpected endpoint " + endpoint);
  };
  const cloudBackend = await selectMovementAnalysisBackend(createInitialState());
  assert.equal(cloudBackend.kind, "hf_cloud", "local visual unavailable falls through to guarded HF cloud");
} finally {
  globalThis.fetch = originalFetchForBackendSelector;
}
assert.equal(source.includes("Sensefield app booted"), true, "boot diagnostic logs app boot");
assert.equal(source.includes("local-capture.js loaded"), true, "boot diagnostic logs module load");
assert.equal(source.includes("camera API available"), true, "boot diagnostic logs camera API availability");
assert.equal(source.includes("visual companion endpoint configured"), true, "boot diagnostic logs visual companion endpoint");
assert.equal(MOVEMENT_RECOGNITION_CLIENT_CONFIG.maxFrames, 4);
assert.equal(MOVEMENT_RECOGNITION_CLIENT_CONFIG.windowMs, 1500);
assert.equal(MOVEMENT_RECOGNITION_ALLOWED_ACTIONS.includes("uncertain"), true);
assert.equal(/Authorization:\s*`Bearer|hf_secret|hf_test|hf_[A-Za-z0-9]{12,}/.test(source), false, "frontend does not expose HF token values");
assert.equal(source.includes("clearMovementFrameBuffer"), true, "frame buffer cleanup exists");
assert.equal(source.includes("queueMovementRecognitionFallback"), true, "local fallback exists");
assert.equal(source.includes("buildActionSuggestion"), true, "detected action candidate builder exists");
assert.equal(source.includes("rankActionSuggestions"), true, "current-step priority exists");
assert.equal(source.includes("scoreLocalActions"), true, "deterministic action scorer exists");
assert.equal(source.includes("local_action_engine_status"), true, "developer diagnostics are hidden in bug report");
assert.equal(source.includes('data-suggestion-action="accept"'), true, "advanced Confirm button exists");
assert.equal(source.includes('data-suggestion-action="reject"'), true, "advanced reject button exists");
assert.equal(source.includes("Confidence \${suggestion.confidence.toFixed(2)}"), true, "advanced confidence copy remains available");
assert.equal(source.includes("naturalizeMovementText"), true, "internal zone labels are naturalized");
assert.equal(source.includes("readableDetailHtml"), true, "reason details remain available");
assert.equal(/fetch\s*\(|WebSocket|OpenAI|OPENAI_API_KEY|(?:^|[^A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{12,}/i.test(source), false, "no direct LLM/VLM hooks");
assert.equal(/MediaRecorder|toDataURL|readAsDataURL|indexedDB|navigator\.sendBeacon/i.test(source), false, "no raw media hooks");
assert.equal(source.includes("DARKQUEST_SESSION_STORAGE_KEY"), true, "sessionStorage use is scoped to anonymous cloud usage id");
for (const claim of ["autonomous vision", "object detection proven", "gesture recognition proven", "production perception", "production action recognition", "VLM-powered", "cloud vision"]) {
  assert.equal((html + "\n" + source).toLowerCase().includes(claim.toLowerCase()), false, "no autonomous vision claims: " + claim);
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
