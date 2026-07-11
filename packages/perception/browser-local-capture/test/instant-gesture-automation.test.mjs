import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MEDIAPIPE_ESM_URL,
  MEDIAPIPE_GESTURE_MAP,
  MEDIAPIPE_VERSION,
  MEDIAPIPE_WASM_ROOT,
  createLocalGestureEngine,
  extractGestureCandidates,
  inferGestureCandidateFromLandmarks,
  isLocalGestureEngineReady,
  mapMediaPipeGestureLabel
} from "../prototype/perception/local-gesture-engine.js";
import {
  createGestureStabilizerState,
  updateGestureStabilizer
} from "../prototype/perception/gesture-stabilizer.js";
import {
  createAutomationRuntimeState,
  createRecipeStore,
  DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE,
  normalizeAutomationRecipe,
  runAutomationForStableLocalGesture
} from "../prototype/automation/index.js";
import {
  INSTANT_GESTURE_DIAGNOSIS_CODES,
  automationManagerHtml,
  createInitialState,
  handleAutomationGestureChange,
  handleLocalGestureObservationInState,
  handleStableLocalGesture,
  openAutomationRecipeEditor,
  scheduleInstantGestureCooldownInState,
  saveAutomationRecipeFromForm,
  updateAutomationActionFields,
  updateAutomationRecipeModeFields
} from "../prototype/local-capture.js";
import * as publicAutomation from "../prototype/automation/index.js";
import * as publicServerAutomation from "../server/automation/index.mjs";

assert.equal(MEDIAPIPE_GESTURE_MAP.Thumb_Up, "thumbs_up");
assert.equal(mapMediaPipeGestureLabel("Thumb_Up"), "thumbs_up");
assert.equal(mapMediaPipeGestureLabel("Victory"), "peace_sign");
assert.equal(mapMediaPipeGestureLabel("None"), null);
assert.equal(mapMediaPipeGestureLabel("Unsupported"), null);
const parsedCandidates = extractGestureCandidates({
  gestures: [[
    { categoryName: "None", score: 0.08 },
    { categoryName: "Thumb_Up", score: 0.92 }
  ]],
  landmarks: [thumbsUpLandmarks()]
});
assert.deepEqual(parsedCandidates, [{ label: "Thumb_Up", confidence: 0.92 }], "instant_gesture_candidate_parse_failure: nested candidate is extracted");
assert.equal(mapMediaPipeGestureLabel(parsedCandidates[0].label), "thumbs_up");
assert.equal(parsedCandidates[0].confidence, 0.92);
assert.deepEqual(extractGestureCandidates({ gestures: [[{ categoryName: "", displayName: "Thumb_Up", score: Number.NaN, confidence: 0.91 }]] }), [{ label: "Thumb_Up", confidence: 0.91 }], "alternate MediaPipe label and confidence fields are accepted");
let parsedStabilizer = createGestureStabilizerState();
let parsedUpdate = updateGestureStabilizer(parsedStabilizer, { gesture_key: mapMediaPipeGestureLabel(parsedCandidates[0].label), confidence: parsedCandidates[0].confidence, timestamp_ms: 100 }, { minimumConfidence: 0.85, holdMs: 350, neutralResetMs: 250, cooldownMs: 2500 });
parsedStabilizer = parsedUpdate.state;
parsedUpdate = updateGestureStabilizer(parsedStabilizer, { gesture_key: "thumbs_up", confidence: parsedCandidates[0].confidence, timestamp_ms: 450 }, { minimumConfidence: 0.85, holdMs: 350, neutralResetMs: 250, cooldownMs: 2500 });
assert.equal(parsedUpdate.event?.gesture_key, "thumbs_up", "real candidate reaches the stabilizer");
assert.deepEqual(inferGestureCandidateFromLandmarks(thumbsUpLandmarks()), { label: "Thumb_Up", confidence: 0.72 }, "extended thumb with folded fingers yields conservative fallback");
assert.equal(inferGestureCandidateFromLandmarks(ambiguousLandmarks()), null, "ambiguous landmarks do not yield a gesture");
assert.deepEqual(extractGestureCandidates({ gestures: [], landmarks: [thumbsUpLandmarks()] }), [{ label: "Thumb_Up", confidence: 0.72 }], "landmark fallback enters candidate extraction");
assert.deepEqual(extractGestureCandidates({ gestures: [], landmarks: [ambiguousLandmarks()] }), [], "ambiguous landmark fallback remains empty");

const options = { minimumConfidence: 0.85, holdMs: 350, neutralResetMs: 250, cooldownMs: 2500 };
let stabilizer = createGestureStabilizerState();
let update = updateGestureStabilizer(stabilizer, { gesture_key: "thumbs_up", confidence: 0.84, timestamp_ms: 0 }, options);
assert.equal(update.event, null, "low confidence is ignored");
stabilizer = update.state;
update = updateGestureStabilizer(stabilizer, { gesture_key: "thumbs_up", confidence: 0.95, timestamp_ms: 100 }, options);
stabilizer = update.state;
assert.equal(update.event, null, "a single frame cannot emit");
update = updateGestureStabilizer(stabilizer, { gesture_key: "thumbs_up", confidence: 0.96, timestamp_ms: 449 }, options);
stabilizer = update.state;
assert.equal(update.event, null, "hold duration is enforced");
update = updateGestureStabilizer(stabilizer, { gesture_key: "thumbs_up", confidence: 0.96, timestamp_ms: 450 }, options);
stabilizer = update.state;
assert.equal(update.event?.gesture_key, "thumbs_up");
assert.equal(update.event?.contains_raw_media, false);
assert.equal(update.event?.first_seen_ms, 100);
assert.equal(update.event?.stable_at_ms, 450);
assert.equal(update.event?.held_for_ms, 350);
assert.equal(update.event?.hand_count, 1);
assert.equal(update.event?.requires_neutral_reset, true);
assert.equal(update.event?.neutral_reset_completed, false);
const firstGestureEvent = update.event;
update = updateGestureStabilizer(stabilizer, { gesture_key: "thumbs_up", confidence: 0.96, timestamp_ms: 900 }, options);
stabilizer = update.state;
assert.equal(update.event, null, "one event is emitted while the gesture remains held");
update = updateGestureStabilizer(stabilizer, { gesture_key: null, confidence: 0, timestamp_ms: 1000 }, options);
stabilizer = update.state;
update = updateGestureStabilizer(stabilizer, { gesture_key: null, confidence: 0, timestamp_ms: 1249 }, options);
stabilizer = update.state;
assert.equal(stabilizer.resetReady, false, "neutral reset duration is enforced");
update = updateGestureStabilizer(stabilizer, { gesture_key: null, confidence: 0, timestamp_ms: 1250 }, options);
stabilizer = update.state;
assert.equal(stabilizer.resetReady, true);
update = updateGestureStabilizer(stabilizer, { gesture_key: "thumbs_up", confidence: 0.96, timestamp_ms: 2600 }, options);
stabilizer = update.state;
update = updateGestureStabilizer(stabilizer, { gesture_key: "thumbs_up", confidence: 0.96, timestamp_ms: 2950 }, options);
assert.equal(update.event?.gesture_key, "thumbs_up", "a new event emits after neutral reset and cooldown");

const instantRecipe = makeInstantRecipe("thumbs_up", "recipe_thumbs_up_encouragement", {
  type: "speak_phrase",
  config: { text: "Great job" }
});

function makeInstantRecipe(gestureKey, recipeId, action) {
  return normalizeAutomationRecipe({
  schema: "movement-automation-recipe.v1-1",
  recipe_id: recipeId,
  name: `${gestureKey} instant action`,
  enabled: true,
  execution_mode: "instant_local_gesture",
  trigger: {
    movement_key: gestureKey,
    source: "mediapipe_gesture",
    gesture_key: gestureKey,
    aliases: [],
    required_tags: [],
    minimum_confidence: 0.85,
    hold_ms: 350,
    neutral_reset_required: true,
    require_user_confirmation: false
  },
  action,
  risk_tier: 0,
  execution_policy: { cooldown_ms: 2500, max_runs_per_session: 20, require_per_run_confirmation: false, retry_limit: 0 },
  consent: { run_instantly: true, consent_version: 1, consented_at: 0 },
  created_at: 0,
  updated_at: 0
  });
}

const defaultThresholdInput = {
  ...instantRecipe,
  recipe_id: "recipe_default_threshold",
  trigger: { ...instantRecipe.trigger }
};
delete defaultThresholdInput.trigger.minimum_confidence;
const defaultThresholdRecipe = normalizeAutomationRecipe(defaultThresholdInput);
assert.equal(defaultThresholdRecipe.trigger.minimum_confidence, DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE, "new instant recipe defaults to 0.70");
const explicitThresholdRecipe = normalizeAutomationRecipe({
  ...instantRecipe,
  recipe_id: "recipe_explicit_threshold",
  trigger: { ...instantRecipe.trigger, minimum_confidence: 0.85 }
});
assert.equal(explicitThresholdRecipe.trigger.minimum_confidence, 0.85, "existing explicit threshold remains unchanged");
let thresholdState = createGestureStabilizerState();
let thresholdResult = updateGestureStabilizer(thresholdState, { gesture_key: "thumbs_up", confidence: 0.75, timestamp_ms: 0 }, options);
thresholdState = thresholdResult.state;
thresholdResult = updateGestureStabilizer(thresholdState, { gesture_key: "thumbs_up", confidence: 0.75, timestamp_ms: 500 }, options);
assert.equal(thresholdResult.code, "instant_gesture_below_threshold");
thresholdState = createGestureStabilizerState();
thresholdResult = updateGestureStabilizer(thresholdState, { gesture_key: "thumbs_up", confidence: 0.92, timestamp_ms: 100 }, options);
thresholdState = thresholdResult.state;
thresholdResult = updateGestureStabilizer(thresholdState, { gesture_key: "thumbs_up", confidence: 0.92, timestamp_ms: 450 }, options);
assert.equal(thresholdResult.event?.confidence, 0.92, "0.92 candidate passes a 0.85 threshold");
for (const diagnosisCode of [
  "loop_not_running", "zero_frames", "no_gesture", "instant_gesture_below_threshold",
  "instant_gesture_hold_not_met", "instant_gesture_duplicate", "instant_gesture_neutral_reset_missing",
  "instant_gesture_cooldown_active", "instant_recipe_not_enabled", "instant_action_not_allowlisted", "instant_action_failed",
  "instant_speech_unavailable"
]) assert.equal(INSTANT_GESTURE_DIAGNOSIS_CODES.includes(diagnosisCode), true, `Research Lab can distinguish ${diagnosisCode}`);

const context = {
  instantGesturesEnabled: true,
  cameraReady: true,
  documentHidden: false,
  engineStatus: "ready",
  speechSynthesis: { cancelCalls: 0, spoken: [], cancel() { this.cancelCalls += 1; }, speak(utterance) { utterance.onstart?.(); this.spoken.push(utterance.text); utterance.onend?.(); } },
  SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
};
const runtime = createAutomationRuntimeState([instantRecipe]);
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls += 1; throw new Error("network forbidden"); };
try {
  const first = await runAutomationForStableLocalGesture({ gestureEvent: firstGestureEvent, recipes: [instantRecipe], runtimeState: runtime, context });
  const duplicate = await runAutomationForStableLocalGesture({ gestureEvent: firstGestureEvent, recipes: [instantRecipe], runtimeState: runtime, context });
  assert.equal(first.matches.length, 1);
  assert.equal(first.code, "instant_action_executed");
  assert.equal(duplicate.receipts.length, 0, "stable event idempotency prevents duplicate execution");
  assert.equal(duplicate.code, "instant_gesture_duplicate");
  assert.deepEqual(context.speechSynthesis.spoken, ["Great job"], "Great job is spoken exactly once");
  assert.equal(context.speechSynthesis.cancelCalls, 1);
  assert.match(first.receipts[0].safe_message, /Completed: said “Great job”/);
  assert.equal(first.receipts[0].contains_raw_media, false);
  assert.equal(networkCalls, 0, "local speech makes no network call");
} finally {
  globalThis.fetch = originalFetch;
}

const mismatchOutcome = await runAutomationForStableLocalGesture({
  gestureEvent: { ...firstGestureEvent, gesture_event_id: "gesture_recipe_mismatch", gesture_key: "peace_sign" },
  recipes: [instantRecipe],
  runtimeState: createAutomationRuntimeState([instantRecipe]),
  context
});
assert.equal(mismatchOutcome.code, "instant_recipe_not_enabled", "recipe mismatch remains distinguishable");

const unavailableVoiceOutcome = await runAutomationForStableLocalGesture({
  gestureEvent: { ...firstGestureEvent, gesture_event_id: "gesture_voice_unavailable" },
  recipes: [instantRecipe],
  runtimeState: createAutomationRuntimeState([instantRecipe]),
  context: { ...context, speechSynthesis: {}, SpeechSynthesisUtterance: null }
});
assert.equal(unavailableVoiceOutcome.code, "instant_speech_failed");
assert.equal(unavailableVoiceOutcome.receipts[0].status, "failed");
assert.equal(unavailableVoiceOutcome.receipts[0].safe_message, "Voice unavailable");
assert.equal(unavailableVoiceOutcome.receipts.some((receipt) => receipt.status === "succeeded"), false, "voice failure is never marked Completed");

for (const [name, contextPatch] of [
  ["instant off", { instantGesturesEnabled: false }],
  ["hidden tab", { documentHidden: true }],
  ["camera stopped", { cameraReady: false }]
]) {
  const testRuntime = createAutomationRuntimeState([instantRecipe]);
  const output = await runAutomationForStableLocalGesture({ gestureEvent: { ...firstGestureEvent, gesture_event_id: `gesture_${name}` }, recipes: [instantRecipe], runtimeState: testRuntime, context: { ...context, ...contextPatch } });
  assert.equal(output.matches.length, 0, `${name} means no action`);
}

const disabledRuntime = createAutomationRuntimeState([{ ...instantRecipe, enabled: false }]);
assert.equal((await runAutomationForStableLocalGesture({ gestureEvent: firstGestureEvent, recipes: [{ ...instantRecipe, enabled: false }], runtimeState: disabledRuntime, context })).matches.length, 0);

for (const actionType of ["local_snapshot_download", "signed_webhook_post"]) {
  const blocked = { ...instantRecipe, recipe_id: `recipe_blocked_${actionType}`, action: { type: actionType, config: {} } };
  const output = await runAutomationForStableLocalGesture({ gestureEvent: { ...firstGestureEvent, gesture_event_id: `gesture_${actionType}` }, recipes: [blocked], runtimeState: createAutomationRuntimeState([blocked]), context });
  assert.equal(output.matches.length, 0, `${actionType} is blocked in instant mode`);
  assert.equal(output.code, actionType === "local_snapshot_download" ? "instant_snapshot_forbidden" : "instant_webhook_forbidden");
}

for (const name of [
  "validateAutomationRecipe",
  "normalizeAutomationRecipe",
  "matchAutomationRecipes",
  "createAutomationRuntimeState",
  "transitionAutomationState",
  "automationIdempotencyKey",
  "runAutomationForConfirmedMovement",
  "runAutomationForStableLocalGesture",
  "executeLocalAutomationAction",
  "clearAutomationActivityLog"
]) assert.equal(typeof publicAutomation[name], "function", `${name} public export exists`);
for (const name of ["validateAutomationWebhookDestination", "buildSignedAutomationWebhookRequest", "executeSignedAutomationWebhook"]) {
  assert.equal(typeof publicServerAutomation[name], "function", `${name} server export exists`);
}

const editorStorage = memoryStorage();
const editorStore = createRecipeStore(editorStorage);
const editorSeed = editorStore.create({
  ...instantRecipe,
  recipe_id: "recipe_editor_persistence",
  confirmation_policy: "movement_confirmation",
  execution_policy: { ...instantRecipe.execution_policy, require_per_run_confirmation: true },
  action: { type: "speak_phrase", config: { text: "GREAT JOB" } }
});
const editorTarget = createInitialState();
editorTarget.automation.recipes = editorStore.list();
const editorDom = automationEditorDom();
openAutomationRecipeEditor(editorTarget, editorSeed.recipe_id, { store: editorStore, dom: editorDom });
assert.equal(editorDom.automationInstantMode.checked, true);
assert.equal(editorDom.automationConfirmationPolicy.value, "none");
assert.equal(editorDom.automationConfirmationPolicy.disabled, true);
assert.equal(editorDom.automationConfirmationPolicyField.hidden, true);
assert.equal(editorDom.automationInstantPolicy.hidden, false);
assert.equal(editorDom.automationInstantPolicy.textContent, "This safe local action runs immediately after local gesture recognition.");
const editorSaved = saveAutomationRecipeFromForm(editorTarget, editorDom, { store: editorStore });
assert.equal(editorSaved.confirmation_policy, "none");
assert.equal(editorSaved.execution_policy.require_per_run_confirmation, false);
const reloadedEditorStore = createRecipeStore(editorStorage);
const reloadedEditorDom = automationEditorDom();
openAutomationRecipeEditor(editorTarget, editorSeed.recipe_id, { store: reloadedEditorStore, dom: reloadedEditorDom });
const reloadedEditorRecipe = reloadedEditorStore.read(editorSeed.recipe_id);
assert.equal(reloadedEditorDom.automationInstantMode.checked, true, "Run instantly remains checked after reload");
assert.equal(reloadedEditorDom.automationConfirmationPolicy.value, "none");
assert.equal(reloadedEditorDom.automationConfirmationPolicy.disabled, true);
assert.equal(reloadedEditorDom.automationConfirmationPolicyField.hidden, true);
assert.equal(reloadedEditorRecipe.execution_policy.require_per_run_confirmation, false);
editorTarget.automation.recipes = reloadedEditorStore.list();
assert.match(automationManagerHtml(editorTarget), /· instant · enabled/, "recipe card says instant after reload");

const unsafeInstantDom = automationEditorDom();
unsafeInstantDom.automationInstantMode.checked = true;
unsafeInstantDom.automationActionType.value = "local_snapshot_download";
updateAutomationRecipeModeFields(unsafeInstantDom);
assert.equal(unsafeInstantDom.automationInstantMode.checked, false, "unsafe actions cannot remain in instant mode");
assert.equal(unsafeInstantDom.automationInstantPolicy.textContent, "This action requires confirmation and cannot run instantly.");

const newRecipeStorage = trackedMemoryStorage();
const newRecipeStore = createRecipeStore(newRecipeStorage);
const newRecipeTarget = createInitialState();
const newRecipeDom = automationEditorDom();
newRecipeDom.automationRecipeName.value = "Mobile instant speech";
newRecipeDom.automationInstantMode.checked = true;
newRecipeDom.automationGestureKey.value = "thumbs_up";
newRecipeDom.automationActionType.value = "speak_phrase";
newRecipeDom.automationConfigValue.value = "GREAT JOB";
const newRecipeSaved = saveAutomationRecipeFromForm(newRecipeTarget, newRecipeDom, { store: newRecipeStore });
assert.match(newRecipeSaved?.recipe_id || "", /^recipe_[a-zA-Z0-9_-]{1,80}$/, "recipe_id_missing_during_create: editor creation receives an internal ID");
assert.equal(newRecipeDom.automationRecipeDialog.closeCalls, 1, "successful save closes the editor");
assert.match(automationManagerHtml(newRecipeTarget), /Mobile instant speech/, "successful save immediately renders the recipe card");

const failedEditDom = automationEditorDom();
openAutomationRecipeEditor(newRecipeTarget, newRecipeSaved.recipe_id, { store: newRecipeStore, dom: failedEditDom });
const stableRecipeId = newRecipeSaved.recipe_id;
const beforeFailedEdit = newRecipeStore.read(stableRecipeId);
const writesBeforeFailedEdit = newRecipeStorage.writes.length;
failedEditDom.automationRecipeName.value = "";
failedEditDom.automationConfigValue.value = "DRAFT REMAINS";
newRecipeTarget.errorMessage = "";
const failedEdit = saveAutomationRecipeFromForm(newRecipeTarget, failedEditDom, { store: newRecipeStore });
assert.equal(failedEdit, null);
assert.deepEqual(newRecipeStore.read(stableRecipeId), beforeFailedEdit, "recipe_edit_deleted_existing: failed edit preserves the stored recipe");
assert.equal(newRecipeStorage.writes.length, writesBeforeFailedEdit, "recipe_save_non_atomic: failed edit performs no write");
assert.equal(failedEditDom.automationRecipeDialog.open, true, "failed edit keeps the modal open");
assert.equal(failedEditDom.automationRecipeDialog.closeCalls, 0);
assert.equal(failedEditDom.automationConfigValue.value, "DRAFT REMAINS", "recipe_draft_lost_on_error: draft remains intact");
assert.equal(failedEditDom.automationFormError.hidden, false);
assert.equal(failedEditDom.automationFormError.textContent, "Enter a name for this automation.");
assert.equal(failedEditDom.automationRecipeName.focusCalls > 0, true, "failed save focuses the relevant field");
assert.equal(failedEditDom.automationRecipeName.attributes["aria-invalid"], "true", "failed save highlights the relevant field");
assert.equal(newRecipeTarget.errorMessage, "", "recipe_error_scope_invalid: modal validation does not create a page-wide banner");

const conditionalDom = automationEditorDom();
for (const [actionType, label, secretVisible, snapshotVisible] of [
  ["speak_phrase", "Phrase", false, false],
  ["signed_webhook_post", "Approved destination ID", true, false],
  ["start_timer", "Duration seconds", false, false],
  ["increment_counter", "Counter name", false, false],
  ["append_activity_log", "Activity category or template", false, false],
  ["local_snapshot_download", "Filename prefix", false, true]
]) {
  conditionalDom.automationActionType.value = actionType;
  updateAutomationActionFields(conditionalDom);
  assert.equal(conditionalDom.automationConfigLabel.textContent, label, `conditional form label for ${actionType}`);
  assert.equal(conditionalDom.automationSecretRefField.hidden, !secretVisible, `webhook-only secret field for ${actionType}`);
  assert.equal(conditionalDom.automationSecretRef.disabled, !secretVisible);
  assert.equal(conditionalDom.automationSnapshotPolicy.hidden, !snapshotVisible, `snapshot policy visibility for ${actionType}`);
}
conditionalDom.automationActionType.value = "signed_webhook_post";
conditionalDom.automationSecretRef.value = "DARKQUEST_WEBHOOK_SECRET_PRESENTATION";
updateAutomationActionFields(conditionalDom);
conditionalDom.automationActionType.value = "speak_phrase";
updateAutomationActionFields(conditionalDom);
assert.equal(conditionalDom.automationSecretRef.value, "", "recipe_irrelevant_field_visible: webhook secret reference is cleared outside webhook mode");
conditionalDom.automationGestureKey.dataset.previousGesture = "thumbs_up";
conditionalDom.automationAliases.value = "thumb gesture";
conditionalDom.automationGestureKey.value = "peace_sign";
handleAutomationGestureChange(conditionalDom);
assert.equal(conditionalDom.automationAliases.value, "", "recipe_alias_contamination: aliases clear when the gesture changes");
conditionalDom.automationInstantMode.checked = true;
conditionalDom.automationActionType.value = "speak_phrase";
updateAutomationRecipeModeFields(conditionalDom);
assert.equal(conditionalDom.automationConfirmationPolicyField.hidden, true, "recipe_instant_confirmation_conflict: after-confirm policy is not visible in instant mode");
assert.equal(conditionalDom.automationConfirmationPolicy.value, "none");
assert.equal(conditionalDom.automationGestureField.hidden, false, "instant mode shows the gesture selector");
assert.equal(conditionalDom.automationHoldField.hidden, false, "instant mode shows hold duration");
assert.equal(conditionalDom.automationAliasesField.hidden, true, "instant mode hides confirmed-movement aliases");

const html = readFileSync(resolve("packages/perception/browser-local-capture/prototype/index.html"), "utf8");
const clientSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/local-capture.js"), "utf8");
const workerSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/perception/gesture-recognizer-worker.js"), "utf8");
const gestureEngineSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/perception/local-gesture-engine.js"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve("package-lock.json"), "utf8"));
const body = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const mainUi = body.slice(0, body.indexOf('id="developerTools"'));
assert.equal(mainUi.indexOf('id="cameraTitle"') < mainUi.indexOf('id="analyzeMovement"'), true);
assert.equal(mainUi.indexOf('id="analyzeMovement"') < mainUi.indexOf('id="movementResultTitle"'), true);
assert.equal(html.includes('id="instantGestures"'), true);
assert.equal(html.includes("Run instantly when recognized"), true);
assert.equal(html.includes('id="automationGestureKey"'), true);
assert.equal(html.includes('id="automationHoldMs"'), true);
assert.equal(html.includes("result-card-stable"), true);
assert.equal(clientSource.includes("runStableGestureRecipes"), true);
assert.equal(clientSource.includes("movementResultSnapshot = stabilized"), false, "gesture telemetry does not mutate the result snapshot");
assert.equal(workerSource.includes('runningMode: "VIDEO"'), true);
assert.equal(workerSource.includes("importScripts"), false, "module gesture worker cannot use importScripts");
assert.equal(workerSource.includes("await import(MEDIAPIPE_ESM_URL)"), true, "worker uses a real ESM import");
assert.equal(workerSource.includes('type: "gesture_engine_loading"'), true);
assert.equal(workerSource.includes('type: "gesture_engine_ready"'), true);
assert.equal(workerSource.includes('type: "gesture_result"'), true);
assert.equal(workerSource.includes('type: "gesture_engine_error"'), true);
assert.equal(gestureEngineSource.includes('name: "darkquest-gesture-recognizer"'), true);
assert.equal(gestureEngineSource.includes('type: "module"'), true);
assert.equal(gestureEngineSource.includes("startCompatibilityFallback"), true);
assert.equal(gestureEngineSource.includes("compatibilityFrameIntervalMs"), true);
assert.equal(packageJson.dependencies["@mediapipe/tasks-vision"], MEDIAPIPE_VERSION, "MediaPipe dependency is exactly pinned");
assert.equal(packageLock.packages["node_modules/@mediapipe/tasks-vision"].version, MEDIAPIPE_VERSION, "lockfile uses the same MediaPipe version");
assert.equal(workerSource.includes("landmarks: Array.isArray(landmarkGroups)"), true, "worker posts only the current landmark frame");
assert.equal(workerSource.includes("fetch("), false, "worker does not upload frames");
assert.equal(workerSource.includes("localStorage"), false, "worker does not persist frames");
assert.equal(clientSource.includes("movement-recognition/analyze") && clientSource.includes("runAutomationForStableLocalGesture"), true, "one-shot narration remains separate");

const runtimeState = createInitialState();
runtimeState.cameraReady = true;
runtimeState.instantGestures.enabled = true;
runtimeState.instantGestures.status = "ready";
runtimeState.automation = createAutomationRuntimeState([instantRecipe]);
runtimeState.automation.recipes = [instantRecipe];
const runtimeSpeech = { spoken: [], cancel() {}, speak(utterance) { utterance.onstart?.(); this.spoken.push(utterance.text); utterance.onend?.(); } };
const RuntimeUtterance = class { constructor(text) { this.text = text; } };
let runtimeNetworkCalls = 0;
let stableHandlerCalls = 0;
let publicRunnerCalls = 0;
let confirmCalls = 0;
const runtimeFetch = globalThis.fetch;
globalThis.fetch = async () => { runtimeNetworkCalls += 1; throw new Error("runtime network forbidden"); };
const runtimeOptions = {
  engineStatus: "ready",
  speechSynthesis: runtimeSpeech,
  SpeechSynthesisUtterance: RuntimeUtterance,
  confirmMovement: () => { confirmCalls += 1; },
  handleStableLocalGesture: async (event, options) => {
    stableHandlerCalls += 1;
    return handleStableLocalGesture(event, {
      ...options,
      runAutomationForStableLocalGesture: async (input) => {
        publicRunnerCalls += 1;
        return runAutomationForStableLocalGesture(input);
      }
    });
  }
};
try {
  await handleLocalGestureObservationInState(runtimeState, { gesture_key: null, confidence: 0, hand_count: 0, timestamp_ms: 0 }, runtimeOptions);
  await handleLocalGestureObservationInState(runtimeState, { gesture_key: "thumbs_up", confidence: 0.9, hand_count: 1, timestamp_ms: 100 }, runtimeOptions);
  const runtimeFirst = await handleLocalGestureObservationInState(runtimeState, { gesture_key: "thumbs_up", confidence: 0.96, hand_count: 1, timestamp_ms: 450 }, runtimeOptions);
  assert.equal(runtimeFirst.code, "instant_action_executed");
  assert.equal(stableHandlerCalls, 1, "handleStableLocalGesture is called by the live observation path");
  assert.equal(publicRunnerCalls, 1, "runAutomationForStableLocalGesture is called by the live handler");
  assert.deepEqual(runtimeSpeech.spoken, ["Great job"]);
  assert.equal(runtimeState.movementResultSnapshot, null, "instant runtime requires no movement result");
  assert.equal(runtimeState.movementRecognition.lastResult, null, "instant runtime performs no VLM result write");
  assert.equal(runtimeState.confidenceCalibration.confirmed_count, 0, "Confirm handler was never called");
  assert.equal(confirmCalls, 0, "no Confirm callback is invoked");
  assert.equal(runtimeState.events.some((event) => event.payload?.confirmed_by_user === true), false, "no movement.confirmed event exists");
  assert.equal(runtimeState.automation.receipts.length, 1);
  assert.equal(runtimeState.automation.cooldowns[instantRecipe.recipe_id], 2950, "instant cooldown is based on the stable event timestamp");
  const heldRuntime = await handleLocalGestureObservationInState(runtimeState, { gesture_key: "thumbs_up", confidence: 0.96, hand_count: 1, timestamp_ms: 900 }, runtimeOptions);
  assert.equal(heldRuntime.code, "instant_gesture_duplicate");
  assert.equal(runtimeSpeech.spoken.length, 1);
  await handleLocalGestureObservationInState(runtimeState, { gesture_key: null, confidence: 0, hand_count: 0, timestamp_ms: 1000 }, runtimeOptions);
  await handleLocalGestureObservationInState(runtimeState, { gesture_key: null, confidence: 0, hand_count: 0, timestamp_ms: 1250 }, runtimeOptions);
  await handleLocalGestureObservationInState(runtimeState, { gesture_key: "thumbs_up", confidence: 0.96, hand_count: 1, timestamp_ms: 3500 }, runtimeOptions);
  const runtimeSecond = await handleLocalGestureObservationInState(runtimeState, { gesture_key: "thumbs_up", confidence: 0.96, hand_count: 1, timestamp_ms: 3850 }, runtimeOptions);
  assert.equal(runtimeSecond.gestureEvent?.stable_at_ms, 3850);
  assert.equal(runtimeState.automation.cooldowns[instantRecipe.recipe_id], 6350);
  assert.equal(runtimeSecond.code, "instant_action_executed");
  assert.deepEqual(runtimeSpeech.spoken, ["Great job", "Great job"]);
  assert.equal(new Set(runtimeState.automation.receipts.map((receipt) => receipt.execution_id)).size, 2);
  assert.equal(runtimeNetworkCalls, 0);
} finally {
  globalThis.fetch = runtimeFetch;
}

for (const [configKey, phrase] of [["text", "GREAT JOB!"], ["phrase", "GREAT JOB!"]]) {
  const exactThresholdRecipe = makeInstantRecipe(
    "thumbs_up",
    `recipe_exact_250_${configKey}`,
    { type: "speak_phrase", config: { [configKey]: phrase } }
  );
  const exactThresholdState = createInitialState();
  exactThresholdState.cameraReady = true;
  exactThresholdState.instantGestures.enabled = true;
  exactThresholdState.instantGestures.status = "ready";
  exactThresholdState.automation = createAutomationRuntimeState([exactThresholdRecipe]);
  exactThresholdState.automation.recipes = [exactThresholdRecipe];
  const exactThresholdSpeech = {
    spoken: [],
    cancel() {},
    speak(utterance) {
      utterance.onstart?.();
      this.spoken.push(utterance.text);
      utterance.onend?.();
    }
  };
  let exactStableHandlerCalls = 0;
  let exactRunnerCalls = 0;
  let exactConfirmCalls = 0;
  let exactNetworkCalls = 0;
  const exactFetch = globalThis.fetch;
  globalThis.fetch = async () => { exactNetworkCalls += 1; throw new Error("instant runtime network forbidden"); };
  try {
    const exactOptions = {
      engineStatus: "ready",
      physicalSmokeTest: true,
      speechSynthesis: exactThresholdSpeech,
      SpeechSynthesisUtterance: RuntimeUtterance,
      confirmMovement: () => { exactConfirmCalls += 1; },
      handleStableLocalGesture: async (event, options) => {
        exactStableHandlerCalls += 1;
        return handleStableLocalGesture(event, {
          ...options,
          runAutomationForStableLocalGesture: async (input) => {
            exactRunnerCalls += 1;
            return runAutomationForStableLocalGesture(input);
          }
        });
      }
    };
    await handleLocalGestureObservationInState(exactThresholdState, { gesture_key: "thumbs_up", confidence: 0.55, hand_count: 1, timestamp_ms: 100 }, exactOptions);
    const exactThresholdOutcome = await handleLocalGestureObservationInState(exactThresholdState, { gesture_key: "thumbs_up", confidence: 0.55, hand_count: 1, timestamp_ms: 350 }, exactOptions);
    assert.equal(exactThresholdOutcome.stabilization.event?.held_for_ms, 250, "threshold equality emits the stable event without clamping");
    assert.equal(exactThresholdOutcome.code, "instant_action_executed", "the live browser handler consumes a 250ms stable gesture");
    assert.equal(exactStableHandlerCalls, 1, "the stable gesture handler is invoked exactly once");
    assert.equal(exactRunnerCalls, 1, "the public stable-gesture automation runner is invoked exactly once");
    assert.deepEqual(exactThresholdSpeech.spoken, ["GREAT JOB!"], `${configKey} resolves to the configured speech phrase`);
    assert.equal(exactThresholdState.automation.receipts.length, 1, "speech creates one receipt after it starts");
    assert.match(automationManagerHtml(exactThresholdState), /Last run: Completed/, "the automation manager receives the completed run");
    assert.equal(exactThresholdState.automation.recipes[0].trigger.hold_ms, 350, "physical smoke thresholds do not mutate the saved recipe");
    assert.equal(exactConfirmCalls, 0, "the instant path never invokes Confirm");
    assert.equal(exactNetworkCalls, 0, "the instant path makes no provider or network call");
    const duplicateOutcome = await handleLocalGestureObservationInState(exactThresholdState, { gesture_key: "thumbs_up", confidence: 0.55, hand_count: 1, timestamp_ms: 500 }, exactOptions);
    assert.equal(duplicateOutcome.code, "instant_gesture_duplicate", "a held thumb cannot execute twice");
    assert.equal(exactThresholdSpeech.spoken.length, 1);
  } finally {
    globalThis.fetch = exactFetch;
  }
}

class ReadyWorker {
  static instance = null;
  constructor(url, workerOptions) {
    this.listeners = {};
    this.url = String(url);
    this.options = workerOptions;
    ReadyWorker.instance = this;
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  postMessage(message) {
    if (message.type === "init") {
      this.emit({ type: "gesture_engine_loading" });
      this.emit({ type: "gesture_engine_initialized" });
      this.emit({ type: "gesture_engine_ready", engine: "mediapipe_gesture_recognizer" });
    }
  }
  emit(data) { return this.listeners.message?.({ data }); }
  terminate() { this.terminated = true; }
}

const workerTarget = createInitialState();
workerTarget.cameraReady = true;
workerTarget.instantGestures.enabled = true;
workerTarget.automation = createAutomationRuntimeState([instantRecipe]);
workerTarget.automation.recipes = [instantRecipe];
const workerSpeech = { spoken: [], cancel() {}, speak(utterance) { utterance.onstart?.(); this.spoken.push(utterance.text); utterance.onend?.(); } };
const workerOutcomes = [];
const workerStatuses = [];
const workerLifecycle = [];
const workerLandmarkFrames = [];
let workerNetworkCalls = 0;
const workerFetch = globalThis.fetch;
globalThis.fetch = async () => { workerNetworkCalls += 1; throw new Error("instant worker network forbidden"); };
const workerEngine = createLocalGestureEngine({
  Worker: ReadyWorker,
  createImageBitmap: async () => ({ close() {} }),
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  onStatusChange: ({ status }) => workerStatuses.push(status),
  onLifecycleEvent: ({ type }) => workerLifecycle.push(type),
  onLandmarks: (frame) => {
    workerLandmarkFrames.push(frame);
    return null;
  },
  onObservation: async (observation) => {
    const outcome = await handleLocalGestureObservationInState(workerTarget, observation, {
      engineStatus: workerEngine.getStatus(),
      speechSynthesis: workerSpeech,
      SpeechSynthesisUtterance: RuntimeUtterance
    });
    workerOutcomes.push(outcome);
    return outcome;
  }
});
workerEngine.start({ readyState: 2 });
assert.equal(ReadyWorker.instance.url.endsWith("/perception/gesture-recognizer-worker.js"), true, "worker URL resolves to the real perception worker");
assert.deepEqual(ReadyWorker.instance.options, { type: "module", name: "darkquest-gesture-recognizer" });
assert.equal(workerStatuses.includes("ready"), false, "worker cannot report Ready before its first inference");
assert.deepEqual(workerLifecycle.slice(0, 5), [
  "gesture_worker_constructing",
  "gesture_worker_constructed",
  "gesture_engine_loading",
  "gesture_engine_initialized",
  "gesture_engine_ready"
], "worker boot reports constructed, loading, initialized, and ready in order");
await ReadyWorker.instance.emit({ type: "gesture_result", timestamp_ms: 0, gestures: [] });
assert.equal(workerStatuses.includes("ready"), false, "worker cannot report Ready after only one processed frame");
for (const timestamp_ms of [50, 100, 150, 200]) {
  await ReadyWorker.instance.emit({ type: "gesture_result", timestamp_ms, gestures: [] });
}
assert.equal(workerStatuses.includes("ready"), true, "worker reports Ready after five fresh processed frames");
for (const payload of [
  { type: "gesture_result", timestamp_ms: 300, gestures: [{ label: "Thumb_Up", confidence: 0.9 }], landmarks: [thumbsUpLandmarks()], handedness: [[{ categoryName: "Right" }]] },
  { type: "gesture_result", timestamp_ms: 700, gestures: [{ label: "Thumb_Up", confidence: 0.96 }] }
]) await ReadyWorker.instance.emit(payload);
assert.equal(workerLandmarkFrames.length >= 1, true, "worker landmarks reach the current-frame trainer hook");
assert.equal(workerLandmarkFrames[0].hands.length, 1, "worker landmark payload is normalized to current hands");
assert.equal(workerLandmarkFrames[0].contains_raw_media, false, "worker landmark payload is symbolic only");
assert.deepEqual(workerSpeech.spoken, ["Great job"], `worker Thumb_Up reaches instant speech exactly once: ${JSON.stringify(workerOutcomes)}`);
assert.equal(workerTarget.automation.receipts.length, 1);
await ReadyWorker.instance.emit({ type: "gesture_result", timestamp_ms: 900, gestures: [{ label: "Thumb_Up", confidence: 0.96 }] });
assert.equal(workerSpeech.spoken.length, 1, "continued worker Thumb_Up does not repeat");
for (const payload of [
  { type: "gesture_result", timestamp_ms: 1000, gestures: [] },
  { type: "gesture_result", timestamp_ms: 1250, gestures: [] },
  { type: "gesture_result", timestamp_ms: 3500, gestures: [{ label: "Thumb_Up", confidence: 0.96 }] },
  { type: "gesture_result", timestamp_ms: 3850, gestures: [{ label: "Thumb_Up", confidence: 0.96 }] }
]) await ReadyWorker.instance.emit(payload);
assert.deepEqual(workerSpeech.spoken, ["Great job", "Great job"], "neutral reset and cooldown permit one new worker execution");
assert.equal(workerTarget.automation.receipts.length, 2);
assert.equal(workerTarget.confidenceCalibration.confirmed_count, 0);
assert.equal(workerTarget.vlmCalls, 0);
assert.equal(workerTarget.movementRecognition.lastResult, null);
assert.equal(workerNetworkCalls, 0, "worker instant path makes no VLM or network call");
workerEngine.stop();
assert.equal(ReadyWorker.instance.terminated, true, "worker terminates when the engine stops");

const directFrames = [];
let directRecognizerOptions = null;
let directInferenceCount = 0;
const directVideo = { readyState: 2 };
const directEngine = createLocalGestureEngine({
  directMainThread: true,
  compatibilityMaxFps: 6,
  requestAnimationFrame: (callback) => { directFrames.push(callback); return directFrames.length; },
  cancelAnimationFrame() {},
  loadMediaPipe: async () => ({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    GestureRecognizer: {
      createFromOptions: async (_vision, options) => {
        directRecognizerOptions = options;
        return {
          recognizeForVideo(input, timestampMs) {
            assert.equal(input, directVideo);
            assert.equal(Number.isFinite(timestampMs), true);
            directInferenceCount += 1;
            return { gestures: [] };
          },
          close() {}
        };
      }
    }
  }),
  onObservation: async () => ({ code: "instant_gesture_neutral_reset_missing" })
});
directEngine.start(directVideo);
await new Promise((resolveTick) => setTimeout(resolveTick, 0));
for (const timestampMs of [100, 300, 500, 700, 900]) await runQueuedFrame(directFrames, timestampMs);
assert.equal(directEngine.getMode(), "direct_main_thread", "physical path uses the direct main-thread recognizer");
assert.equal(directRecognizerOptions.runningMode, "VIDEO");
assert.equal(directRecognizerOptions.numHands, 1);
assert.equal(directRecognizerOptions.cannedGesturesClassifierOptions.scoreThreshold, 0.5);
assert.equal(directInferenceCount, 5, JSON.stringify({ mode: directEngine.getMode(), diagnostics: directEngine.getDiagnostics(), queued_frames: directFrames.length }));
assert.equal(directEngine.getStatus(), "ready", "direct path requires five successful inferences before Ready");
directEngine.stop();

class FailingWorker extends ReadyWorker {
  static instance = null;
  constructor(url, workerOptions) {
    super(url, workerOptions);
    FailingWorker.instance = this;
  }
  postMessage(message) {
    if (message.type === "init") this.emit({
      type: "gesture_engine_error",
      code: "gesture_worker_import_mode_mismatch",
      safe_message: "Gesture worker import mode mismatch."
    });
  }
}

const fallbackStatuses = [];
const fallbackStatusProgression = [];
const fallbackLifecycle = [];
const fallbackFrames = [];
const fallbackTimers = [];
const fallbackTarget = createInitialState();
const fallbackRecipe = normalizeAutomationRecipe({
  ...instantRecipe,
  recipe_id: "recipe_compatibility_great_job",
  action: { type: "speak_phrase", config: { text: "GREAT JOB!" } }
});
fallbackTarget.cameraReady = true;
fallbackTarget.instantGestures.enabled = true;
fallbackTarget.automation = createAutomationRuntimeState([fallbackRecipe]);
fallbackTarget.automation.recipes = [fallbackRecipe];
const fallbackSpeechLifecycle = [];
const fallbackSpeech = {
  spoken: [],
  cancel() {},
  speak(utterance) {
    utterance.onstart?.();
    this.spoken.push(utterance.text);
    utterance.onend?.();
  }
};
let fallbackConfirmCalls = 0;
let fallbackAnalyzeCalls = 0;
let fallbackProviderCalls = 0;
let fallbackActiveInferences = 0;
let fallbackMaxConcurrent = 0;
let fallbackClosedFrames = 0;
let fallbackRecognitionIndex = 0;
const fallbackVideo = { readyState: 2, videoWidth: 640, videoHeight: 480 };
const fallbackDrawInputs = [];
const fallbackCanvas = {
  width: 0,
  height: 0,
  getContext() {
    return {
      drawImage(input) {
        fallbackDrawInputs.push(input);
      }
    };
  }
};
const fallbackInferenceInputs = [];
const fallbackInferenceTimestamps = [];
const fallbackRecognitionResults = [
  { gestures: [], landmarks: [] },
  { gestures: [], landmarks: [] },
  { gestures: [], landmarks: [] },
  { gestures: [], landmarks: [] },
  { gestures: [], landmarks: [] },
  { gestures: [], landmarks: [] },
  { gestures: [], landmarks: [] },
  { gestures: [[{ categoryName: "Thumb_Up", score: 0.92 }]], landmarks: [thumbsUpLandmarks()] },
  { gestures: [[{ categoryName: "Thumb_Up", score: 0.92 }]], landmarks: [thumbsUpLandmarks()] },
  { gestures: [[{ categoryName: "Thumb_Up", score: 0.92 }]], landmarks: [thumbsUpLandmarks()] },
  { gestures: [], landmarks: [] },
  { gestures: [], landmarks: [] },
  { gestures: [[{ categoryName: "Thumb_Up", score: 0.92 }]], landmarks: [thumbsUpLandmarks()] },
  { gestures: [[{ categoryName: "Thumb_Up", score: 0.92 }]], landmarks: [thumbsUpLandmarks()] }
];
const fallbackEngine = createLocalGestureEngine({
  Worker: FailingWorker,
  requestAnimationFrame: (callback) => { fallbackFrames.push(callback); return fallbackFrames.length; },
  cancelAnimationFrame() {},
  createCanvas: () => fallbackCanvas,
  createImageBitmap: async () => ({ close() { fallbackClosedFrames += 1; } }),
  loadMediaPipe: async () => ({
    FilesetResolver: {
      async forVisionTasks(root) {
        assert.equal(root, MEDIAPIPE_WASM_ROOT);
        return { root };
      }
    },
    GestureRecognizer: {
      async createFromOptions(_vision, recognizerOptions) {
        assert.equal(recognizerOptions.baseOptions.modelAssetPath, "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task");
        assert.equal(recognizerOptions.baseOptions.delegate, "CPU", "compatibility mode is explicitly CPU-first");
        return {
          recognizeForVideo(input, timestampMs) {
            fallbackInferenceInputs.push(input);
            fallbackInferenceTimestamps.push(timestampMs);
            fallbackActiveInferences += 1;
            fallbackMaxConcurrent = Math.max(fallbackMaxConcurrent, fallbackActiveInferences);
            fallbackActiveInferences -= 1;
            const result = fallbackRecognitionResults[fallbackRecognitionIndex] || { gestures: [], landmarks: [] };
            fallbackRecognitionIndex += 1;
            return result;
          },
          close() {}
        };
      }
    }
  }),
  onStatusChange: (status) => {
    fallbackStatuses.push(status);
    fallbackStatusProgression.push(status.reason);
  },
  onLifecycleEvent: (event) => fallbackLifecycle.push(event),
  onObservation: async (observation) => {
    const outcome = await handleLocalGestureObservationInState(fallbackTarget, observation, {
      engineStatus: fallbackEngine.getStatus(),
      speechSynthesis: fallbackSpeech,
      SpeechSynthesisUtterance: RuntimeUtterance,
      onStatusChange: ({ message }) => fallbackStatusProgression.push(message),
      onConfirm: () => { fallbackConfirmCalls += 1; },
      context: {
        onSpeechStart: (text) => fallbackSpeechLifecycle.push(`start:${text}`),
        onSpeechEnd: (text) => fallbackSpeechLifecycle.push(`end:${text}`),
        analyzeMovement: () => { fallbackAnalyzeCalls += 1; },
        providerCall: () => { fallbackProviderCalls += 1; }
      }
    });
    if (outcome.code === "instant_action_executed") {
      scheduleInstantGestureCooldownInState(fallbackTarget, outcome, {
        setTimeout: (callback, delayMs) => {
          fallbackTimers.push({ callback, delayMs });
          return fallbackTimers.length;
        },
        onStatusChange: ({ message }) => fallbackStatusProgression.push(message),
        engineStatus: "ready_compatibility"
      });
    }
    return outcome;
  }
});
fallbackEngine.start(fallbackVideo);
await new Promise((resolveTick) => setTimeout(resolveTick, 0));
assert.equal(fallbackStatuses.some(({ status }) => status === "loading" || status === "loading_model"), true, "worker initialization error is surfaced while fallback loads");
assert.equal(fallbackStatuses.some(({ status }) => status === "ready_compatibility"), false, "instant_engine_false_ready: zero processed frames cannot report Ready");
assert.equal(fallbackEngine.getStatus(), "starting_inference");
assert.deepEqual({
  recognizer_ready: fallbackEngine.getDiagnostics().recognizer_ready,
  loop_running: fallbackEngine.getDiagnostics().loop_running,
  frames_processed: fallbackEngine.getDiagnostics().frames_processed,
  successful_inference_exists: fallbackEngine.getDiagnostics().successful_inference_exists,
  inference_recent: fallbackEngine.getDiagnostics().inference_recent,
  last_outcome_code: fallbackEngine.getDiagnostics().last_outcome_code,
  last_error_code: fallbackEngine.getDiagnostics().last_error_code
}, {
  recognizer_ready: true,
  loop_running: true,
  frames_processed: 0,
  successful_inference_exists: false,
  inference_recent: false,
  last_outcome_code: "zero_frames",
  last_error_code: ""
});
assert.equal(isLocalGestureEngineReady(fallbackEngine.getDiagnostics()), false, "instant_engine_false_ready: initialization alone is not readiness");
assert.equal(fallbackLifecycle.some(({ type }) => type === "gesture_compatibility_loading"), true);
assert.equal(fallbackLifecycle.some(({ type }) => type === "gesture_engine_initialized"), true);
assert.equal(fallbackStatuses.some(({ status }) => status === "unavailable"), false, "recoverable worker failure never displays Unavailable");
await runQueuedFrame(fallbackFrames, 100);
assert.equal(fallbackMaxConcurrent, 1, "compatibility fallback starts bounded local inference");
assert.equal(fallbackEngine.getStatus(), "starting_inference", "one processed frame cannot make compatibility mode Ready");
assert.equal(fallbackEngine.getDiagnostics().frames_processed, 1);
assert.equal(fallbackEngine.getDiagnostics().last_outcome_code, "no_gesture", "empty result is diagnosed and the loop continues");
assert.equal(isLocalGestureEngineReady(fallbackEngine.getDiagnostics()), false, "Ready requires five fresh successful inferences");
assert.equal(isLocalGestureEngineReady({
  ...fallbackEngine.getDiagnostics(),
  last_inference_age_ms: 10_000,
  inference_recent: false
}), false, "instant_engine_false_ready: stale inference cannot remain Ready");
await runQueuedFrame(fallbackFrames, 250);
assert.equal(fallbackEngine.getDiagnostics().frames_processed, 2, "a second empty result does not stop recognition");
await runQueuedFrame(fallbackFrames, 400);
await runQueuedFrame(fallbackFrames, 550);
assert.equal(fallbackEngine.getStatus(), "starting_inference", "four successful inferences remain in startup");
await runQueuedFrame(fallbackFrames, 700);
assert.equal(fallbackEngine.getStatus(), "ready_compatibility", "five fresh successful inferences make compatibility mode Ready");
assert.equal(isLocalGestureEngineReady(fallbackEngine.getDiagnostics()), true, "Ready requires a fresh fifth successful inference");
await runQueuedFrame(fallbackFrames, 850);
await runQueuedFrame(fallbackFrames, 1000);
assert.equal(fallbackEngine.getDiagnostics().frames_processed, 7, "two empty results leave the ready recognition loop running");
await runQueuedFrame(fallbackFrames, 1150);
await runQueuedFrame(fallbackFrames, 1550);
await new Promise((resolveTick) => setTimeout(resolveTick, 0));
assert.equal(fallbackMaxConcurrent, 1, "compatibility fallback runs at most one inference at a time");
assert.equal(fallbackClosedFrames, 0, "compatibility mode does not allocate transferable frame objects");
assert.equal(fallbackDrawInputs.every((input) => input === fallbackVideo), true, "compatibility mode draws the live video element into a transient canvas");
assert.equal(fallbackInferenceInputs.every((input) => input === fallbackCanvas), true, "compatibility mode passes the transient canvas frame to MediaPipe");
assert.deepEqual([fallbackCanvas.width, fallbackCanvas.height], [640, 480], "compatibility canvas follows the current video dimensions");
assert.equal(fallbackInferenceTimestamps.every((timestamp, index, values) => index === 0 || timestamp > values[index - 1]), true, "compatibility timestamps are strictly monotonic");
assert.equal(fallbackEngine.getDiagnostics().frames_processed, 9);
assert.equal(fallbackEngine.getDiagnostics().last_raw_label, "Thumb_Up");
assert.equal(fallbackEngine.getDiagnostics().last_raw_confidence, 0.92);
assert.equal(fallbackEngine.getDiagnostics().mapped_gesture, "thumbs_up");
assert.equal(fallbackEngine.getDiagnostics().first_inference_completed, true);
assert.deepEqual(fallbackSpeech.spoken, ["GREAT JOB!"], "compatibility recognition reaches instant automation");
assert.deepEqual(fallbackSpeechLifecycle, ["start:GREAT JOB!", "end:GREAT JOB!"], "speech start and end are observed");
assert.equal(fallbackTarget.confidenceCalibration.confirmed_count, 0);
assert.equal(fallbackConfirmCalls, 0, "Confirm handler is never called");
assert.equal(fallbackTarget.vlmCalls, 0);
assert.equal(fallbackAnalyzeCalls, 0, "Analyze endpoint is never requested");
assert.equal(fallbackProviderCalls, 0, "provider helper is never requested");
assert.equal(fallbackTarget.movementRecognition.lastResult, null);
assert.equal(fallbackTarget.movementResultSnapshot, null);
assert.equal(fallbackTarget.automation.receipts.length, 1);
assert.match(automationManagerHtml(fallbackTarget), /Last run: Completed/, "successful instant execution updates Last run");
assert.equal(fallbackTimers.length, 1, "one cooldown completion is scheduled");
fallbackTimers.shift().callback();
assert.equal(fallbackTimers.length, 1, "cooldown schedules one bounded rearm");
fallbackTimers.shift().callback();
await runQueuedFrame(fallbackFrames, 1750);
assert.deepEqual(fallbackSpeech.spoken, ["GREAT JOB!"], "continued hold does not repeat speech");
await runQueuedFrame(fallbackFrames, 1950);
await runQueuedFrame(fallbackFrames, 2250);
await runQueuedFrame(fallbackFrames, 5000);
await runQueuedFrame(fallbackFrames, 5400);
await new Promise((resolveTick) => setTimeout(resolveTick, 0));
assert.deepEqual(fallbackSpeech.spoken, ["GREAT JOB!", "GREAT JOB!"], "neutral reset and cooldown allow exactly one new speech");
assert.equal(fallbackTarget.automation.receipts.length, 2, "a second unique receipt is emitted after rearm");
assert.equal(new Set(fallbackTarget.automation.receipts.map((receipt) => receipt.execution_id)).size, 2);
assert.equal(containsOrdered(fallbackStatusProgression, [
  /^Loading/,
  /^Starting inference/,
  "Ready — scanning",
  "Thumbs up 92% — hold steady",
  /^Thumbs up — \d+ \/ 350ms/,
  "Recognized — executing",
  /^Completed/,
  "Cooling down",
  "Ready — scanning"
]), true, `status progression is evidence-backed: ${fallbackStatusProgression.join(" -> ")}`);
const fallbackTelemetry = JSON.stringify(fallbackTarget.instantGestures.diagnostics);
assert.doesNotMatch(fallbackTelemetry, /data:image|base64|landmarks?|HF_TOKEN|provider[_ ]payload|raw[_ ]image/i, "Research Lab telemetry remains symbolic");
assert.equal(fallbackTarget.instantGestures.diagnostics.contains_raw_media, false);
fallbackEngine.stop();

const terminalStatuses = [];
const terminalEngine = createLocalGestureEngine({
  Worker: FailingWorker,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  createImageBitmap: async () => ({ close() {} }),
  loadMediaPipe: async () => { throw new Error("synthetic compatibility boot failure"); },
  onStatusChange: (event) => terminalStatuses.push(event)
});
terminalEngine.start({ readyState: 2 });
await new Promise((resolveTick) => setTimeout(resolveTick, 0));
const terminalFailure = terminalStatuses.find(({ status }) => status === "unavailable");
assert.equal(Boolean(terminalFailure?.reason), true, "instant_worker_error_hidden: terminal boot failure exposes a safe reason");
assert.equal(terminalFailure?.code, "gesture_compatibility_initialization_failed");

const inferenceFailureStatuses = [];
const inferenceFailureFrames = [];
let inferenceFailureClosed = 0;
const inferenceFailureEngine = createLocalGestureEngine({
  Worker: FailingWorker,
  requestAnimationFrame: (callback) => { inferenceFailureFrames.push(callback); return inferenceFailureFrames.length; },
  cancelAnimationFrame() {},
  createImageBitmap: async () => ({ close() { inferenceFailureClosed += 1; } }),
  loadMediaPipe: async () => ({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    GestureRecognizer: { createFromOptions: async () => ({ recognizeForVideo() { throw new Error("synthetic recognition failure"); }, close() {} }) }
  }),
  onStatusChange: (event) => inferenceFailureStatuses.push(event)
});
inferenceFailureEngine.start({ readyState: 2 });
await new Promise((resolveTick) => setTimeout(resolveTick, 0));
await inferenceFailureFrames.shift()?.(200);
const surfacedInferenceRetry = inferenceFailureStatuses.find(({ code }) => code === "gesture_compatibility_inference_retry");
assert.equal(Boolean(surfacedInferenceRetry?.reason), true, "first recognition exception is surfaced as a non-terminal retry");
assert.equal(inferenceFailureStatuses.some(({ code }) => code === "gesture_compatibility_inference_failed"), false, "first recognition exception does not terminal-fail live startup");
for (const timestampMs of [400, 600, 800, 1000, 1200, 1400, 1600]) {
  await inferenceFailureFrames.shift()?.(timestampMs);
}
const surfacedInferenceFailure = inferenceFailureStatuses.find(({ code }) => code === "gesture_compatibility_inference_failed");
assert.equal(Boolean(surfacedInferenceFailure?.reason), true, "repeated recognition exceptions are surfaced safely");
assert.equal(inferenceFailureClosed, 0, "failed compatibility inference retains no frame object");
inferenceFailureEngine.stop();
assert.equal(workerNetworkCalls, 0, "compatibility fallback makes no cloud or VLM call");
globalThis.fetch = workerFetch;

assert.equal(MEDIAPIPE_ESM_URL.includes(`@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/`), true);
assert.equal(MEDIAPIPE_WASM_ROOT.includes(`@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/`), true);

for (const scenario of [
  { gesture: "peace_sign", action: { type: "speak_phrase", config: { phrase: "Nice" } }, verify: (target, speech) => speech.spoken[0] === "Nice" },
  { gesture: "open_palm", action: { type: "start_timer", config: { duration_seconds: 1 } }, verify: (target) => Object.keys(target.automation.timers).length === 1 },
  { gesture: "closed_fist", action: { type: "increment_counter", config: { counter_name: "fists" } }, verify: (target) => target.automation.counters.fists === 1 }
]) {
  const recipe = makeInstantRecipe(scenario.gesture, `recipe_runtime_${scenario.gesture}`, scenario.action);
  const target = createInitialState();
  target.cameraReady = true;
  target.instantGestures.enabled = true;
  target.instantGestures.status = "ready";
  target.automation = createAutomationRuntimeState([recipe]);
  target.automation.recipes = [recipe];
  const speech = { spoken: [], cancel() {}, speak(utterance) { utterance.onstart?.(); this.spoken.push(utterance.text); utterance.onend?.(); } };
  const options = { engineStatus: "ready", speechSynthesis: speech, SpeechSynthesisUtterance: RuntimeUtterance, context: { setTimeout: () => 1 } };
  await handleLocalGestureObservationInState(target, { gesture_key: scenario.gesture, confidence: 0.95, hand_count: 1, timestamp_ms: 100 }, options);
  const output = await handleLocalGestureObservationInState(target, { gesture_key: scenario.gesture, confidence: 0.95, hand_count: 1, timestamp_ms: 450 }, options);
  assert.equal(output.code, "instant_action_executed", `${scenario.gesture} executes generically`);
  assert.equal(scenario.verify(target, speech), true, `${scenario.gesture} adapter effect is visible`);
}

function thumbsUpLandmarks() {
  return [
    [0.50, 0.90], [0.45, 0.72], [0.42, 0.57], [0.43, 0.39], [0.44, 0.18],
    [0.38, 0.52], [0.35, 0.58], [0.36, 0.68], [0.39, 0.76],
    [0.48, 0.50], [0.48, 0.58], [0.49, 0.68], [0.50, 0.77],
    [0.58, 0.53], [0.60, 0.61], [0.61, 0.70], [0.61, 0.78],
    [0.67, 0.57], [0.70, 0.65], [0.70, 0.73], [0.68, 0.80]
  ].map(([x, y]) => ({ x, y, z: 0 }));
}

function ambiguousLandmarks() {
  return Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
}

function containsOrdered(values, expected) {
  let cursor = 0;
  for (const value of values) {
    const matcher = expected[cursor];
    if (matcher == null) return true;
    if (matcher instanceof RegExp ? matcher.test(String(value)) : value === matcher) cursor += 1;
  }
  return cursor === expected.length;
}

async function runQueuedFrame(queue, timestampMs) {
  const callback = queue.shift();
  assert.equal(typeof callback, "function", `scheduled frame exists for ${timestampMs}ms`);
  callback(timestampMs);
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

function trackedMemoryStorage() {
  const values = new Map();
  const writes = [];
  return {
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      writes.push({ key, value });
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key)
  };
}

function automationEditorDom() {
  return {
    automationRecipeName: {
      value: "",
      focusCalls: 0,
      attributes: {},
      focus() { this.focusCalls += 1; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; }
    },
    automationMovementSentence: { textContent: "" },
    automationShortLabel: { textContent: "" },
    automationMovementKey: { value: "", readOnly: false },
    automationInstantMode: { checked: false },
    automationInstantPolicy: { hidden: true, textContent: "" },
    automationInstantUpgrade: { hidden: true },
    automationGestureKey: { value: "thumbs_up", disabled: false, dataset: {} },
    automationGestureField: { hidden: false },
    automationConfidence: { textContent: "" },
    automationActionType: { value: "speak_phrase" },
    automationAliases: { value: "" },
    automationAliasesField: { hidden: false },
    automationMinConfidence: { value: "0.85" },
    automationHoldMs: { value: "350", disabled: false },
    automationHoldField: { hidden: false },
    automationCooldown: { value: "2.5" },
    automationConfirmationPolicy: { value: "movement_confirmation", disabled: false },
    automationConfirmationPolicyField: { hidden: false },
    automationConfigField: { hidden: false },
    automationConfigLabel: { textContent: "Configuration" },
    automationConfigValue: { value: "GREAT JOB", placeholder: "" },
    automationSecretRefField: { hidden: false },
    automationSecretRef: { value: "", disabled: false },
    automationSnapshotPolicy: { hidden: true, textContent: "" },
    automationFormError: { hidden: true, textContent: "" },
    automationRecipeSave: { disabled: false },
    automationEnabled: { checked: true },
    automationRecipeDialog: {
      open: false,
      closeCalls: 0,
      showModal() { this.open = true; },
      close() { this.open = false; this.closeCalls += 1; }
    }
  };
}

const runtimeHandlerSource = clientSource.slice(clientSource.indexOf("export async function handleLocalGestureObservationInState"), clientSource.indexOf("async function handleLocalGestureObservation", clientSource.indexOf("export async function handleLocalGestureObservationInState")));
assert.equal(/confirmMovementResultInState|requestMovementRecognition|movementResultSnapshot\s*=/.test(runtimeHandlerSource), false, "instant runtime handler has no Confirm, VLM, or result dependency");
for (const statusCopy of ["Loading", "Starting inference", "Ready — scanning", "Thumbs up", "hold steady", "Recognized — executing", "Completed — ", "Cooling down", "Unavailable"]) assert.equal(clientSource.includes(statusCopy), true, `browser exposes ${statusCopy}`);
assert.equal(clientSource.includes('if (document.hidden) stopInstantGestureEngine("Off")'), true, "hidden tab stops the worker");
assert.equal(clientSource.includes('stopInstantGestureEngine("Off")'), true, "camera stop and toggle off stop the worker");

console.log("ok instant gesture automation");
