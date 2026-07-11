#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLocalGestureEngine, extractGestureCandidates, mapMediaPipeGestureLabel } from "../../perception/browser-local-capture/prototype/perception/local-gesture-engine.js";
import { createGestureStabilizerState, updateGestureStabilizer } from "../../perception/browser-local-capture/prototype/perception/gesture-stabilizer.js";
import {
  automationManagerHtml,
  createInitialState,
  handleLocalGestureObservationInState,
  openAutomationRecipeEditor,
  saveAutomationRecipeFromForm
} from "../../perception/browser-local-capture/prototype/local-capture.js";
import * as browserApi from "../../perception/browser-local-capture/prototype/automation/index.js";
import * as serverApi from "../../perception/browser-local-capture/server/automation/index.mjs";

const REPORT_PATH = "runs/gate-v1-instant-automation-latest.json";
const BROWSER_AUTOMATION_API_PATH = "packages/perception/browser-local-capture/prototype/automation/index.js";
const SERVER_AUTOMATION_API_PATH = "packages/perception/browser-local-capture/server/automation/index.mjs";
const REQUIRED_TEST_MARKERS = [
  "MEDIAPIPE_GESTURE_MAP.Thumb_Up", "a single frame cannot emit", "hold duration is enforced",
  "one event is emitted while the gesture remains held", "neutral reset duration is enforced",
  "a new event emits after neutral reset and cooldown", "Great job is spoken exactly once",
  "stable event idempotency prevents duplicate execution", "local speech makes no network call",
  "local_snapshot_download", "signed_webhook_post", "public export exists"
];
const BROWSER_EXPORTS = [
  "validateAutomationRecipe", "matchAutomationRecipes", "createAutomationRuntimeState", "transitionAutomationState",
  "automationIdempotencyKey", "runAutomationForConfirmedMovement", "runAutomationForStableLocalGesture",
  "executeLocalAutomationAction", "clearAutomationActivityLog"
];
const SERVER_EXPORTS = ["validateAutomationWebhookDestination", "buildSignedAutomationWebhookRequest", "executeSignedAutomationWebhook"];
const files = {
  package: "package.json",
  html: "packages/perception/browser-local-capture/prototype/index.html",
  runtime: "packages/perception/browser-local-capture/prototype/local-capture.js",
  browserApi: BROWSER_AUTOMATION_API_PATH,
  serverApi: SERVER_AUTOMATION_API_PATH,
  gestureEngine: "packages/perception/browser-local-capture/prototype/perception/local-gesture-engine.js",
  stabilizer: "packages/perception/browser-local-capture/prototype/perception/gesture-stabilizer.js",
  worker: "packages/perception/browser-local-capture/prototype/perception/gesture-recognizer-worker.js",
  test: "packages/perception/browser-local-capture/test/instant-gesture-automation.test.mjs",
  automationTest: "packages/perception/browser-local-capture/test/automation-recipes.test.mjs",
  automationGate: "packages/evals/bin/gate-v1-automation-check.mjs",
  publicApiContract: "docs/contracts/automation-public-api.v1-2-1.md",
  recipeContract: "docs/contracts/movement-automation-recipe.v1-1.md",
  gestureContract: "docs/contracts/stable-local-gesture-event.v1.md",
  outcomeRegistry: "docs/contracts/instant-automation-outcome-codes.v1.md",
  policy: "docs/architecture/instant-gesture-action-policy.md"
};

const packageJson = JSON.parse(read(files.package));
const html = read(files.html);
const runtimeSource = read(files.runtime);
const gestureSource = read(files.gestureEngine);
const stabilizerSource = read(files.stabilizer);
const workerSource = read(files.worker);
const testSource = read(files.test);
const automationTestSource = read(files.automationTest);
const automationGateSource = read(files.automationGate);
const recipeContract = read(files.recipeContract);
const gestureContract = read(files.gestureContract);
const policy = read(files.policy);
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerIndex = bodyHtml.indexOf('id="developerTools"');
const mainUi = developerIndex >= 0 ? bodyHtml.slice(0, developerIndex) : bodyHtml;

const report = {
  schema: "darkquest.gate_v1_instant_automation_report.v0",
  gate: "v1_instant_automation",
  claim: "A stable local MediaPipe gesture may execute one explicitly enabled safe local recipe without VLM or per-run confirmation, while open-ended and higher-risk actions remain confirmation-gated.",
  generated_at: new Date().toISOString(),
  canonical_entrypoints: { browser: BROWSER_AUTOMATION_API_PATH, server: SERVER_AUTOMATION_API_PATH },
  files_checked: files,
  checks: [],
  final_verdict: "FAIL"
};

checkPackage();
checkGestureEngine();
const missingPublic = [...checkPublicApi(), ...checkCanonicalEntrypoints()];
checkContractsAndTests();
checkPerformanceAndUi();
checkPrivacy();

const suite = await runBehaviorSuite();
for (const result of suite.checks) add("behavior", result.id, result.passed, result.id, result.evidence, "critical", "behavior");

const gestureFunctionsPresent = [mapMediaPipeGestureLabel, createLocalGestureEngine, createGestureStabilizerState, updateGestureStabilizer].every((value) => typeof value === "function");
const gestureFilesPresent = [files.gestureEngine, files.stabilizer, files.worker].every((path) => existsSync(resolve(path)));
const missingTests = testSurfaceBlockers();
const criticalFailures = report.checks.filter((check) => !check.passed && check.severity === "critical");
report.missing_public_exports = missingPublic;
report.missing_test_surfaces = missingTests;
report.behavior_checks_executed = suite.checks.length;
report.failure_count = criticalFailures.length;
report.failures = criticalFailures;

if (!gestureFunctionsPresent || !gestureFilesPresent) report.final_verdict = "BLOCKED_MISSING_GESTURE_ENGINE";
else if (missingPublic.length > 0) report.final_verdict = "BLOCKED_MISSING_PUBLIC_API";
else if (missingTests.length > 0) report.final_verdict = "BLOCKED_MISSING_TESTS";
else if (criticalFailures.length > 0) report.final_verdict = "FAIL";
else report.final_verdict = "PASS_WITH_DISCLOSURE";

mkdirSync("runs", { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.final_verdict} Gate v1.2.1 instant gesture automation check`);
console.log(`report: ${REPORT_PATH}`);
console.log(`checks: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}`);
if (missingPublic.length) console.log(`missing public API: ${missingPublic.join(", ")}`);
if (missingTests.length) console.log(`missing tests: ${missingTests.join(", ")}`);
for (const failure of criticalFailures) console.log(`- ${failure.category}.${failure.code}`);
process.exit(report.final_verdict.startsWith("PASS") ? 0 : 1);

function checkPackage() {
  const scripts = packageJson.scripts || {};
  add("package", "gate_script", scripts["gate:v1:instant-automation"]?.includes("gate-v1-instant-automation-check.mjs"), "Instant gate script exists", scripts["gate:v1:instant-automation"]);
  add("package", "test_script", scripts["test:instant-gestures"]?.includes("instant-gesture-automation.test.mjs"), "Instant behavior test script exists", scripts["test:instant-gestures"]);
  add("package", "typecheck_gate", scripts.typecheck?.includes("gate-v1-instant-automation-check.mjs"), "Typecheck includes instant gate", "typecheck");
  add("package", "typecheck_test", scripts.typecheck?.includes("instant-gesture-automation.test.mjs"), "Typecheck includes instant test", "typecheck");
}

function checkGestureEngine() {
  add("gesture", "mapping_function", typeof mapMediaPipeGestureLabel === "function", "MediaPipe label mapper is executable", typeof mapMediaPipeGestureLabel, "blocking");
  add("gesture", "engine_function", typeof createLocalGestureEngine === "function", "Local gesture engine is executable", typeof createLocalGestureEngine, "blocking");
  add("gesture", "state_function", typeof createGestureStabilizerState === "function", "Stabilizer state factory is executable", typeof createGestureStabilizerState, "blocking");
  add("gesture", "update_function", typeof updateGestureStabilizer === "function", "Stabilizer update is executable", typeof updateGestureStabilizer, "blocking");
}

function checkPublicApi() {
  const missing = [];
  for (const name of BROWSER_EXPORTS) {
    const passed = typeof browserApi?.[name] === "function";
    if (!passed) missing.push(`browser:${name}`);
    add("public_api", `browser_${safe(name)}`, passed, `Browser API exports ${name}`, typeof browserApi?.[name], "blocking");
  }
  for (const name of SERVER_EXPORTS) {
    const passed = typeof serverApi?.[name] === "function";
    if (!passed) missing.push(`server:${name}`);
    add("public_api", `server_${safe(name)}`, passed, `Server API exports ${name}`, typeof serverApi?.[name], "blocking");
  }
  return missing;
}

function checkCanonicalEntrypoints() {
  const checks = [
    ["browser_index_exists", existsSync(resolve(files.browserApi)), files.browserApi],
    ["server_index_exists", existsSync(resolve(files.serverApi)), files.serverApi],
    ["runtime_uses_browser_index", runtimeSource.includes('from "./automation/index.js"'), "./automation/index.js"],
    ["automation_gate_uses_browser_index", automationGateSource.includes("prototype/automation/index.js"), "automation/index.js"],
    ["automation_gate_uses_server_index", automationGateSource.includes("server/automation/index.mjs"), "server/automation/index.mjs"]
  ];
  const missing = [];
  for (const [code, passed, evidence] of checks) {
    if (!passed) missing.push(`entrypoint:${code}`);
    add("public_api", code, passed, code.replaceAll("_", " "), evidence, "blocking");
  }
  return missing;
}

function checkContractsAndTests() {
  for (const marker of ["instant_local_gesture", "consent.run_instantly", "speak_phrase", "local_snapshot_download", "signed_webhook_post"]) add("contract", safe(marker), recipeContract.includes(marker), `Recipe v1.1 contract includes ${marker}`, marker);
  for (const marker of ["stable-local-gesture-event.v1", "gesture_event_id", "requires_neutral_reset", "contains_raw_media", "gesture_event_id + recipe_id"]) add("contract", safe(marker), gestureContract.includes(marker), `Stable gesture contract includes ${marker}`, marker);
  for (const marker of ["Session activation consent", "Instant Allowlist", "Instant Denylist", "Any LLM/VLM", "Camera stop", "hidden tab"]) add("policy", safe(marker), policy.toLowerCase().includes(marker.toLowerCase()), `Instant policy includes ${marker}`, marker);
  for (const marker of REQUIRED_TEST_MARKERS) add("tests", safe(marker), testSource.includes(marker), `Behavior test includes ${marker}`, marker, "critical");
  add("tests", "underlying_automation_contract", automationTestSource.includes("AUTOMATION_CONTRACT_TEST_IDS"), "Underlying automation behavior contract remains present", "AUTOMATION_CONTRACT_TEST_IDS");
}

function checkPerformanceAndUi() {
  add("worker_boot", "instant_worker_module_importscripts_conflict", gestureSource.includes('type: "module"') && !workerSource.includes("importScripts"), "Module worker never calls importScripts", "type=module; no importScripts");
  add("worker_boot", "instant_worker_bundle_mode_invalid", gestureSource.includes("vision_bundle.mjs") && workerSource.includes("import(MEDIAPIPE_ESM_URL)") && /Math\.min\(15/.test(gestureSource), "Pinned ESM bundle is loaded with bounded inference", "dynamic ESM import; worker <=15 FPS");
  add("worker_boot", "instant_worker_url_invalid", gestureSource.includes('new URL("./gesture-recognizer-worker.js", import.meta.url)') && gestureSource.includes("frameInFlight"), "Worker URL resolves relative to the module and one frame is in flight", "relative URL; frameInFlight");
  add("worker_boot", "instant_worker_version_mismatch", workerSource.includes('from "./local-gesture-engine.js"') && gestureSource.includes("MEDIAPIPE_ESM_URL") && gestureSource.includes("MEDIAPIPE_WASM_ROOT") && gestureSource.includes("document?.hidden"), "Worker and compatibility mode share one JS/WASM version source", "shared constants; hidden-tab guard");
  const instantBlock = slice(runtimeSource, "export async function handleLocalGestureObservationInState", "async function handleLocalGestureObservation");
  add("worker_boot", "instant_worker_unpinned_dependency", /MEDIAPIPE_VERSION\s*=\s*"[0-9][^"]+"/.test(gestureSource) && !/\blatest\b/i.test(gestureSource + workerSource) && !/\brender\s*\(/.test(instantBlock), "MediaPipe is pinned and instant frames do not full-render", "pinned version; no latest; no full render");
  add("performance", "snapshot_stable", !/movementResultSnapshot|confirmMovementResultInState|requestMovementRecognition/.test(instantBlock), "Instant path has no result, Confirm, or provider dependency", "instant runtime handler source");
  add("ui", "result_id_animation", runtimeSource.includes("snapshot.result_id !== lastMovementRevealResultId"), "Movement Result reanimates only for new result_id", "result animation key");
  add("ui", "camera_mirrored", html.includes("transform: scaleX(-1)"), "Camera remains mirrored", "scaleX(-1)");
  const camera = mainUi.indexOf('id="cameraTitle"');
  const control = mainUi.indexOf('id="analyzeMovement"');
  const result = mainUi.indexOf('id="movementResultTitle"');
  add("ui", "hierarchy", camera >= 0 && camera < control && control < result, "Camera -> Describe -> Result hierarchy remains unchanged", `${camera}<${control}<${result}`);
  add("ui", "instant_not_above_result", !/Instant gestures/i.test(mainUi.slice(0, result)) && ["Loading model", "Starting inference", "Waiting for camera frames", "Ready — scanning", "Thumbs up", "Cooling down", "Unavailable"].every((marker) => runtimeSource.includes(marker)), "Instant lifecycle statuses are visible without moving them above the result", "loading, inference, waiting, ready, recognized, cooldown, terminal unavailable");
}

function checkPrivacy() {
  const gesturePath = `${gestureSource}\n${stabilizerSource}\n${workerSource}`;
  add("privacy", "no_persistence", !/localStorage|sessionStorage|indexedDB|MediaRecorder|toDataURL|readAsDataURL|importScripts/.test(gesturePath) && runtimeSource.includes('if (document.hidden) stopInstantGestureEngine("Off")') && runtimeSource.includes('stopInstantGestureEngine("Off")'), "Gesture path persists no media and stops for hidden tab, camera stop, or toggle off", "source and lifecycle scan");
  add("privacy", "no_screenshots_or_base64", !/screenshot|base64|data:image/i.test(gesturePath), "Gesture path stores no screenshots or base64", "source scan");
  add("privacy", "no_landmark_history", !/landmarkHistory|landmarks\s*[:=]\s*\[/.test(gesturePath)
    && ["researchInstantLoop", "researchInstantFrames", "researchInstantDiagnosis"].every((id) => html.includes(`id="${id}"`))
    && ["loop_not_running", "zero_frames", "no_gesture", "instant_gesture_below_threshold", "instant_action_failed"].every((code) => runtimeSource.includes(code)), "Gesture path stores no landmark history and Research Lab exposes symbolic-only diagnosis", "source scan; compact diagnosis fields");
  add("privacy", "frame_closed", workerSource.includes("image?.close?.()") && gestureSource.includes("bitmap.close?.()")
    && gestureSource.includes("processCompatibilityFrame(video") && testSource.includes("contains_raw_media"), "Worker releases transferred bitmaps; compatibility mode infers directly without retaining a frame copy", "worker image.close; direct-video compatibility; symbolic receipt");
  add("privacy", "no_token", !/HF_TOKEN|process\.env|Authorization|Bearer/.test(gesturePath), "Gesture path cannot access provider token", "source scan");
  add("privacy", "no_provider_request", !/movement-recognition\/analyze|requestMovementRecognition|buildMovementRecognitionPrompt/.test(gesturePath), "Gesture path contains no provider request", "source scan");
}

async function runBehaviorSuite() {
  const checks = [];
  const check = (id, passed, evidence) => checks.push({ id, passed: Boolean(passed), evidence: compact(evidence) });
  check("mapping.primary", mapMediaPipeGestureLabel("Thumb_Up") === "thumbs_up" && mapMediaPipeGestureLabel("Thumb_Down") === "thumbs_down" && mapMediaPipeGestureLabel("Victory") === "peace_sign", "primary MediaPipe mappings");
  const nestedCandidates = extractGestureCandidates({ gestures: [[{ categoryName: "None", score: 0.08 }, { categoryName: "Thumb_Up", score: 0.92 }]] });
  check("instant_gesture_candidate_parse_failure", nestedCandidates.length === 1 && nestedCandidates[0].label === "Thumb_Up" && nestedCandidates[0].confidence === 0.92
    && mapMediaPipeGestureLabel(nestedCandidates[0].label) === "thumbs_up"
    && mapMediaPipeGestureLabel("Open_Palm") === "open_palm" && mapMediaPipeGestureLabel("Closed_Fist") === "closed_fist"
    && mapMediaPipeGestureLabel("Pointing_Up") === "pointing_up" && mapMediaPipeGestureLabel("ILoveYou") === "i_love_you"
    && mapMediaPipeGestureLabel("None") === null && mapMediaPipeGestureLabel("Unsupported") === null, nestedCandidates);
  await runWorkerBootBehavior(check);

  const settings = { minimumConfidence: 0.85, holdMs: 350, neutralResetMs: 250, cooldownMs: 2500 };
  const single = gestureTrace([gestureFrame("thumbs_up", 0.95, 100)], settings);
  check("stabilizer.single_frame", single.events.length === 0 && hasCode(single.outputs.at(-1), "instant_gesture_hold_not_met"), single.outputs.at(-1));
  const low = gestureTrace([gestureFrame("thumbs_up", 0.75, 0), gestureFrame("thumbs_up", 0.75, 500)], settings);
  check("stabilizer.below_threshold", low.events.length === 0 && hasCode(low.outputs.at(-1), "instant_gesture_below_threshold"), low.outputs.at(-1));
  const held = gestureTrace([gestureFrame("thumbs_up", 0.92, 100), gestureFrame("thumbs_up", 0.92, 450), gestureFrame("thumbs_up", 0.92, 900)], settings);
  check("stabilizer.stable_hold", held.events.length === 1, held.events);
  check("stabilizer.event_contract", validStableEvent(held.events[0]), held.events[0]);
  check("stabilizer.continued_hold", held.events.length === 1 && hasCode(held.outputs.at(-1), "instant_gesture_duplicate"), held.outputs.at(-1));
  const noNeutral = gestureTrace([gestureFrame("thumbs_up", 0.95, 100), gestureFrame("thumbs_up", 0.96, 450), gestureFrame("thumbs_up", 0.96, 3000), gestureFrame("thumbs_up", 0.96, 3400)], settings);
  check("stabilizer.neutral_required", noNeutral.events.length === 1 && hasCode(noNeutral.outputs.at(-1), "instant_gesture_neutral_reset_missing"), noNeutral.outputs.at(-1));
  const shortNeutral = gestureTrace([gestureFrame("thumbs_up", 0.95, 100), gestureFrame("thumbs_up", 0.96, 450), gestureFrame(null, 0, 1000), gestureFrame(null, 0, 1249)], settings);
  check("stabilizer.neutral_duration", shortNeutral.state.resetReady === false, shortNeutral.state);
  const cooling = gestureTrace([gestureFrame("thumbs_up", 0.95, 100), gestureFrame("thumbs_up", 0.96, 450), gestureFrame(null, 0, 1000), gestureFrame(null, 0, 1250), gestureFrame("thumbs_up", 0.96, 1300), gestureFrame("thumbs_up", 0.96, 1650)], settings);
  check("stabilizer.cooldown", cooling.events.length === 1 && hasCode(cooling.outputs.at(-1), "instant_gesture_cooldown_active"), cooling.outputs.at(-1));
  const acceptanceTrace = gestureTrace([
    gestureFrame(null, 0, 0), gestureFrame("thumbs_up", 0.9, 100), gestureFrame("thumbs_up", 0.96, 450),
    gestureFrame("thumbs_up", 0.96, 900), gestureFrame(null, 0, 1000), gestureFrame(null, 0, 1250),
    gestureFrame("thumbs_up", 0.96, 2600), gestureFrame("thumbs_up", 0.96, 2950)
  ], settings);
  check("stabilizer.after_reset", acceptanceTrace.events.length === 2, acceptanceTrace.events);

  const v11 = browserApi.validateAutomationRecipe(instantRecipe({ schema: "movement-automation-recipe.v1-1" }));
  const defaultThresholdInput = instantRecipe({ recipe_id: "recipe_default_threshold_gate" });
  delete defaultThresholdInput.trigger.minimum_confidence;
  const defaultThreshold = browserApi.validateAutomationRecipe(defaultThresholdInput);
  check("recipe.v1_1", isValid(v11) && isValid(defaultThreshold) && defaultThreshold.recipe?.trigger?.minimum_confidence === 0.7 && v11.recipe?.trigger?.minimum_confidence === 0.85, { v11, defaultThreshold });
  const workingValidation = browserApi.validateAutomationRecipe(instantRecipe());
  const recipe = workingValidation.recipe || workingValidation.normalized;
  check("editor.persistence", isValid(workingValidation) && Boolean(recipe) && runEditorPersistenceBehavior(recipe), "instant editor save/reload/reopen");
  if (recipe && acceptanceTrace.events.length === 2) {
    await runActivationBehavior(check, recipe, acceptanceTrace.events[0]);
    await runSafeActionBehavior(check, recipe, acceptanceTrace.events[0]);
    await runAcceptanceBehavior(check, recipe, acceptanceTrace.events);
  }
  runUnderlyingAutomationBehavior(check);
  return { checks };
}

function runEditorPersistenceBehavior(recipe) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const store = browserApi.createRecipeStore(storage);
  const seeded = store.create({
    ...recipe,
    recipe_id: "recipe_gate_editor_persistence",
    confirmation_policy: "after_confirmation",
    execution_policy: { ...recipe.execution_policy, require_per_run_confirmation: true }
  });
  const target = createInitialState();
  target.automation.recipes = store.list();
  const editor = gateAutomationEditorDom();
  openAutomationRecipeEditor(target, seeded.recipe_id, { store, dom: editor });
  const saved = saveAutomationRecipeFromForm(target, editor, { store });
  const reloaded = browserApi.createRecipeStore(storage);
  const reopened = gateAutomationEditorDom();
  openAutomationRecipeEditor(target, seeded.recipe_id, { store: reloaded, dom: reopened });
  const persisted = reloaded.read(seeded.recipe_id);
  target.automation.recipes = reloaded.list();
  return saved?.execution_mode === "instant_local_gesture"
    && persisted?.confirmation_policy === "none"
    && persisted?.execution_policy?.require_per_run_confirmation === false
    && reopened.automationInstantMode.checked === true
    && reopened.automationConfirmationPolicy.value === "none"
    && reopened.automationConfirmationPolicy.disabled === true
    && reopened.automationConfirmationPolicyField.hidden === true
    && automationManagerHtml(target).includes("· instant · enabled");
}

function gateAutomationEditorDom() {
  return {
    automationRecipeId: { value: "" }, automationRecipeName: { value: "" },
    automationMovementSentence: { textContent: "" }, automationShortLabel: { textContent: "" },
    automationMovementKey: { value: "", readOnly: false }, automationInstantMode: { checked: false },
    automationInstantUpgrade: { hidden: true }, automationGestureKey: { value: "thumbs_up", disabled: false },
    automationConfidence: { textContent: "" }, automationActionType: { value: "speak_phrase" },
    automationAliases: { value: "" }, automationMinConfidence: { value: "0.85" },
    automationHoldMs: { value: "350", disabled: false }, automationCooldown: { value: "3" },
    automationConfirmationPolicy: { value: "movement_confirmation", disabled: false },
    automationConfirmationPolicyField: { hidden: false }, automationConfigValue: { value: "GREAT JOB" },
    automationSecretRef: { value: "" }, automationEnabled: { checked: true },
    automationRecipeDialog: { showModal() {}, close() {} }
  };
}

async function runWorkerBootBehavior(check) {
  class ReadyBootWorker {
    static instance = null;
    constructor(url, options) {
      this.url = String(url);
      this.options = options;
      this.listeners = {};
      ReadyBootWorker.instance = this;
    }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    postMessage(message) {
      if (message.type !== "init") return;
      this.emit({ type: "gesture_engine_loading" });
      this.emit({ type: "gesture_engine_initialized" });
      this.emit({ type: "gesture_engine_ready" });
    }
    emit(data) { return this.listeners.message?.({ data }); }
    terminate() { this.terminated = true; }
  }

  const statuses = [];
  const lifecycle = [];
  const bootEngine = createLocalGestureEngine({
    Worker: ReadyBootWorker,
    createImageBitmap: async () => ({ close() {} }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    onStatusChange: (event) => statuses.push(event),
    onLifecycleEvent: (event) => lifecycle.push(event)
  });
  bootEngine.start({ readyState: 2 });
  const lifecycleTypes = lifecycle.map(({ type }) => type);
  check("instant_worker_boot_failed", ReadyBootWorker.instance?.options?.type === "module" && ReadyBootWorker.instance?.url.endsWith("/perception/gesture-recognizer-worker.js") && lifecycleTypes.includes("gesture_worker_constructed") && lifecycleTypes.includes("gesture_engine_loading") && lifecycleTypes.includes("gesture_engine_initialized"), { lifecycleTypes, url: ReadyBootWorker.instance?.url });
  const workerReadyBeforeInference = bootEngine.getStatus() === "ready";
  await ReadyBootWorker.instance.emit({ type: "gesture_result", gestures: [], timestamp_ms: 100 });
  const workerReadyAfterFirstInference = bootEngine.getStatus() === "ready";
  for (const timestampMs of [200, 300, 400, 500]) await ReadyBootWorker.instance.emit({ type: "gesture_result", gestures: [], timestamp_ms: timestampMs });
  check("instant_worker_ready_missing", workerReadyBeforeInference === false && workerReadyAfterFirstInference === false && bootEngine.getStatus() === "ready" && bootEngine.getDiagnostics().frames_processed === 5 && statuses.some(({ status }) => status === "ready"), { workerReadyBeforeInference, workerReadyAfterFirstInference, statuses, diagnostics: bootEngine.getDiagnostics() });
  bootEngine.stop();

  class FailedBootWorker extends ReadyBootWorker {
    postMessage(message) {
      if (message.type === "init") this.emit({ type: "gesture_engine_error", code: "gesture_worker_import_mode_mismatch", safe_message: "Gesture worker import mode mismatch." });
    }
  }

  const fallbackStatuses = [];
  const frameCallbacks = [];
  let activeInferences = 0;
  let maximumInferences = 0;
  let inferenceCount = 0;
  let closedFrames = 0;
  const compatibilityVideo = { readyState: 2 };
  let compatibilityInput = null;
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("instant fallback network forbidden"); };
  try {
    const fallbackEngine = createLocalGestureEngine({
      Worker: FailedBootWorker,
      createImageBitmap: async () => ({ close() { closedFrames += 1; } }),
      requestAnimationFrame: (callback) => { frameCallbacks.push(callback); return frameCallbacks.length; },
      cancelAnimationFrame() {},
      loadMediaPipe: async () => ({
        FilesetResolver: { forVisionTasks: async () => ({}) },
        GestureRecognizer: {
          createFromOptions: async () => ({
            recognizeForVideo(input) {
              compatibilityInput = input;
              activeInferences += 1;
              maximumInferences = Math.max(maximumInferences, activeInferences);
              inferenceCount += 1;
              activeInferences -= 1;
              return { gestures: [[{ categoryName: "Thumb_Up", score: 0.95 }]] };
            },
            close() {}
          })
        }
      }),
      onStatusChange: (event) => fallbackStatuses.push(event)
    });
    fallbackEngine.start(compatibilityVideo);
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    const compatibilityBeforeInference = fallbackEngine.getDiagnostics();
    check("instant_engine_false_ready", ["loading", "starting_inference"].includes(fallbackEngine.getStatus()) && compatibilityBeforeInference.recognizer_ready === true
      && compatibilityBeforeInference.frames_processed === 0 && compatibilityBeforeInference.first_inference_completed === false
      && compatibilityBeforeInference.last_error_code === "", compatibilityBeforeInference);
    for (const timestampMs of [100, 250, 400, 550, 700]) await runQueuedCompatibilityFrame(frameCallbacks, timestampMs);
    const compatibilityAfterInference = fallbackEngine.getDiagnostics();
    check("instant_worker_fallback_missing", fallbackEngine.getStatus() === "ready_compatibility" && fallbackEngine.getMode() === "compatibility"
      && compatibilityAfterInference.frames_processed === 5 && compatibilityAfterInference.first_inference_completed === true, { fallbackStatuses, compatibilityAfterInference });
    check("instant_worker_fallback_unbounded", inferenceCount === 5 && maximumInferences === 1 && closedFrames === 0
      && compatibilityInput === compatibilityVideo && fallbackEngine.isFrameInFlight() === false && compatibilityAfterInference.loop_running === true, { inferenceCount, maximumInferences, closedFrames, compatibilityAfterInference });
    check("instant_worker_fallback_cloud_call", networkCalls === 0 && !/movement-recognition\/analyze|requestMovementRecognition|buildMovementRecognitionPrompt/.test(gestureSource), { networkCalls });
    fallbackEngine.stop();

    const terminalStatuses = [];
    const terminalEngine = createLocalGestureEngine({
      Worker: FailedBootWorker,
      createImageBitmap: async () => ({ close() {} }),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
      loadMediaPipe: async () => { throw new Error("synthetic compatibility initialization failure"); },
      onStatusChange: (event) => terminalStatuses.push(event)
    });
    terminalEngine.start({ readyState: 2 });
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    const terminal = terminalStatuses.find(({ status }) => status === "unavailable");
    check("instant_worker_error_hidden", Boolean(terminal?.reason) && terminal?.code === "gesture_compatibility_initialization_failed", terminalStatuses);
    terminalEngine.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runActivationBehavior(check, recipe, event) {
  for (const [id, context, candidate, code] of [
    ["activation.session_off", { instantGesturesEnabled: false }, recipe, "instant_gesture_not_enabled"],
    ["activation.recipe_disabled", {}, { ...recipe, enabled: false }, "instant_recipe_not_enabled"],
    ["activation.wrong_mode", {}, { ...recipe, execution_mode: "confirmed_ai_movement" }, "instant_recipe_wrong_mode"],
    ["activation.camera_stopped", { cameraReady: false }, recipe, "instant_camera_inactive"],
    ["activation.tab_hidden", { documentHidden: true }, recipe, "instant_document_hidden"],
    ["activation.engine_unavailable", { engineStatus: "unavailable" }, recipe, "instant_engine_unavailable"]
  ]) {
    const output = await runStableEvent(eventWithId(event, id), candidate, context);
    check(id, output.receipts.length === 0 && hasCode(output, code), output);
  }
  const enabled = await runStableEvent(eventWithId(event, "enabled"), recipe, {});
  check("activation.session_enabled", enabled.receipts.length === 1, enabled);
}

async function runSafeActionBehavior(check, baseRecipe, event) {
  for (const [id, gestureKey, type, config] of [
    ["actions.speak_phrase", "peace_sign", "speak_phrase", { phrase: "Nice" }],
    ["actions.increment_counter", "closed_fist", "increment_counter", { counter_name: "wins" }],
    ["actions.start_timer", "open_palm", "start_timer", { duration_seconds: 1 }],
    ["actions.append_activity_log", "thumbs_up", "append_activity_log", { category: "gesture" }]
  ]) {
    const candidate = { ...baseRecipe, recipe_id: `recipe_${safe(id)}`, trigger: { ...baseRecipe.trigger, movement_key: gestureKey, gesture_key: gestureKey }, action: { type, config } };
    const output = await runStableEvent(eventWithId({ ...event, gesture_key: gestureKey }, id), candidate, {});
    check(id, output.receipts.length === 1 && output.receipts[0].status === "succeeded", output);
  }
  let permissionPrompts = 0;
  const notificationRecipe = { ...baseRecipe, recipe_id: "recipe_notification", action: { type: "browser_notification", config: { title: "DarkQuest", body: "Great job" } } };
  const notification = await runStableEvent(eventWithId(event, "notification"), notificationRecipe, {
    Notification: class { static permission = "granted"; },
    requestNotificationPermission: () => { permissionPrompts += 1; return "granted"; }
  });
  check("actions.notification_permission", notification.receipts.some((receipt) => receipt.status === "succeeded") && permissionPrompts === 0, { notification, permissionPrompts });
  for (const [id, type, code] of [
    ["actions.snapshot_forbidden", "local_snapshot_download", "instant_snapshot_forbidden"],
    ["actions.webhook_forbidden", "signed_webhook_post", "instant_webhook_forbidden"],
    ["actions.external_forbidden", "external_action", "instant_action_not_allowlisted"],
    ["actions.ai_forbidden", "movement_recognition", "instant_ai_call_forbidden"]
  ]) {
    const candidate = { ...baseRecipe, recipe_id: `recipe_${safe(id)}`, action: { type, config: {} } };
    const output = await runStableEvent(eventWithId(event, id), candidate, {});
    check(id, output.receipts.length === 0 && hasCode(output, code), output);
  }
  const recursionRuntime = browserApi.createAutomationRuntimeState([baseRecipe]);
  recursionRuntime.automationExecutionInFlight = true;
  const recursion = await browserApi.runAutomationForStableLocalGesture({ gestureEvent: eventWithId(event, "recursion"), recipes: [baseRecipe], runtimeState: recursionRuntime, context: actionContext() });
  check("actions.recursive_analysis", recursion.receipts.length === 0 && hasCode(recursion, "instant_recursive_analysis"), recursion);
}

async function runAcceptanceBehavior(check, recipe, events) {
  const target = createInitialState();
  target.cameraReady = true;
  target.instantGestures.enabled = true;
  target.instantGestures.status = "ready";
  target.automation = browserApi.createAutomationRuntimeState([recipe]);
  target.automation.recipes = [recipe];
  const spoken = [];
  let networkCalls = 0;
  let providerCalls = 0;
  const context = actionContext({
    speechSynthesis: {
      cancel() {},
      speak: (utterance) => {
        spoken.push(utterance.text);
        utterance.onstart?.();
        utterance.onend?.();
      }
    },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    providerCall: () => { providerCalls += 1; }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("network forbidden"); };
  try {
    const options = { engineStatus: "ready", speechSynthesis: context.speechSynthesis, SpeechSynthesisUtterance: context.SpeechSynthesisUtterance, context: { providerCall: context.providerCall } };
    await handleLocalGestureObservationInState(target, gestureFrame(null, 0, 0), options);
    await handleLocalGestureObservationInState(target, gestureFrame("thumbs_up", 0.9, 100), options);
    const first = await handleLocalGestureObservationInState(target, gestureFrame("thumbs_up", 0.96, 450), options);
    const duplicate = await handleLocalGestureObservationInState(target, gestureFrame("thumbs_up", 0.96, 900), options);
    await handleLocalGestureObservationInState(target, gestureFrame(null, 0, 1000), options);
    await handleLocalGestureObservationInState(target, gestureFrame(null, 0, 1250), options);
    await handleLocalGestureObservationInState(target, gestureFrame("thumbs_up", 0.96, 3500), options);
    const second = await handleLocalGestureObservationInState(target, gestureFrame("thumbs_up", 0.96, 3850), options);
    const noConfirm = target.movementResultSnapshot === null && target.movementRecognition.lastResult === null
      && target.confidenceCalibration.confirmed_count === 0
      && !target.events.some((event) => event.payload?.confirmed_by_user === true);
    check("acceptance.first_stable", first.receipts.length === 1 && first.code === "instant_action_executed" && noConfirm, { first, noConfirm });
    check("acceptance.continued_hold", duplicate.receipts.length === 0 && hasCode(duplicate, "instant_gesture_duplicate"), duplicate);
    check("acceptance.after_reset", second.receipts.length === 1 && second.code === "instant_action_executed", second);
    check("acceptance.speech_exact", spoken.length === 2 && spoken.every((text) => text === "GREAT JOB"), spoken);
    check("acceptance.one_receipt", first.receipts.length === 1 && target.automation.receipts.length === 2, { first, total: target.automation.receipts.length });
    check("acceptance.zero_cloud", networkCalls === 0 && providerCalls === 0 && target.movementRecognition.lastResult === null, { networkCalls, providerCalls });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function runUnderlyingAutomationBehavior(check) {
  const secret = browserApi.validateAutomationRecipe(confirmedRecipe({ action: { type: "speak_phrase", config: { phrase: "hello", HF_TOKEN: "hf_secret_value" } } }));
  check("underlying.secret_code", hasCode(secret, "automation_recipe_contains_secret"), secret);
  const recipe = browserApi.validateAutomationRecipe(confirmedRecipe()).recipe;
  const unrelated = browserApi.matchAutomationRecipes({ confirmed: true, uncertainty: false, movement_key: "jump", short_label: "Jump", gesture_tags: [], confidence: 0.95 }, [recipe]);
  check("underlying.no_match", Array.isArray(unrelated) && unrelated.length === 0, unrelated);
}

async function runStableEvent(event, recipe, context) {
  const runtime = browserApi.createAutomationRuntimeState([recipe]);
  return browserApi.runAutomationForStableLocalGesture({ gestureEvent: event, recipes: [recipe], runtimeState: runtime, context: actionContext(context) });
}

function actionContext(patch = {}) {
  return {
    instantGesturesEnabled: true, cameraReady: true, documentHidden: false, engineStatus: "ready",
    speechSynthesis: {
      cancel() {},
      speak(utterance) { utterance.onstart?.(); utterance.onend?.(); }
    }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    setTimeout: () => 1, showNotification() {}, ...patch
  };
}

function instantRecipe(patch = {}) {
  return {
    schema: patch.schema || "movement-automation-recipe.v1-1", recipe_id: patch.recipe_id || "recipe_thumbs_up_gate",
    name: "Thumbs up encouragement", enabled: patch.enabled ?? true, execution_mode: "instant_local_gesture",
    trigger: { movement_key: "thumbs_up", source: "mediapipe_gesture", gesture_key: "thumbs_up", aliases: [], required_tags: [], minimum_confidence: 0.85, hold_ms: 350, neutral_reset_required: true, require_user_confirmation: false },
    action: patch.action || { type: "speak_phrase", config: { phrase: "GREAT JOB" } }, risk_tier: patch.risk_tier ?? 0,
    execution_policy: { cooldown_ms: 2500, max_runs_per_session: 20, require_per_run_confirmation: false, retry_limit: 0 },
    consent: { run_instantly: true, consent_version: 1, consented_at: 0 }, created_at: 0, updated_at: 0
  };
}

function confirmedRecipe(patch = {}) {
  return {
    schema_version: "movement-automation-recipe.v1", recipe_id: "recipe_confirmed_gate", name: "Confirmed movement",
    enabled: true, execution_mode: "confirmed_ai_movement",
    trigger: { movement_key: "peace_sign", aliases: [], required_tags: [], minimum_confidence: 0.7, require_user_confirmation: true },
    action: patch.action || { type: "increment_counter", config: { counter_name: "done" } }, risk_tier: 0,
    execution_policy: { cooldown_ms: 1000, max_runs_per_session: 2, require_per_run_confirmation: false, retry_limit: 0 }, created_at: 0, updated_at: 0
  };
}

async function runQueuedCompatibilityFrame(frameCallbacks, timestampMs) {
  const callback = frameCallbacks.shift();
  if (typeof callback !== "function") throw new Error(`Compatibility frame callback missing at ${timestampMs}ms`);
  callback(timestampMs);
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

function gestureTrace(frames, settings) {
  let state = createGestureStabilizerState();
  const events = [];
  const outputs = [];
  for (const frame of frames) {
    const output = updateGestureStabilizer(state, frame, settings);
    state = output.state;
    if (output.event) events.push(output.event);
    outputs.push(output);
  }
  return { state, events, outputs };
}

function gestureFrame(gestureKey, confidence, timestampMs) {
  return { gesture_key: gestureKey, confidence, timestamp_ms: timestampMs };
}

function eventWithId(event, suffix) {
  return { ...event, gesture_event_id: `gesture_${safe(suffix)}` };
}

function validStableEvent(event) {
  return event?.schema_version === "stable-local-gesture-event.v1" && event.source === "mediapipe_gesture" && event.contains_raw_media === false
    && Number.isFinite(event.first_seen_ms) && Number.isFinite(event.stable_at_ms) && Number.isFinite(event.held_for_ms)
    && [1, 2].includes(event.hand_count) && event.requires_neutral_reset === true;
}

function hasCode(value, code) {
  return value?.code === code || value?.error_code === code || value?.failure_code === code || value?.errors?.some?.((error) => error === code || error?.code === code);
}

function isValid(value) {
  return value?.valid === true || value?.ok === true || value?.passed === true;
}

function compact(value) {
  if (typeof value === "string") return value.slice(0, 300);
  try { return JSON.stringify(value).slice(0, 700); } catch { return String(value).slice(0, 300); }
}

function testSurfaceBlockers() {
  const blockers = [];
  if (!existsSync(resolve(files.test))) blockers.push(files.test);
  if (REQUIRED_TEST_MARKERS.some((marker) => !testSource.includes(marker))) blockers.push("required behavior assertions");
  for (const path of [files.publicApiContract, files.recipeContract, files.gestureContract, files.outcomeRegistry, files.policy]) if (!existsSync(resolve(path))) blockers.push(path);
  return blockers;
}

function add(category, code, passed, name, evidence, severity = "critical", kind = "source") {
  report.checks.push({ category, code, name, passed: Boolean(passed), evidence, severity, kind });
}

function read(path) {
  return readFileSync(resolve(path), "utf8");
}

function safe(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function slice(value, start, end) {
  const from = value.indexOf(start);
  if (from < 0) return "";
  const to = value.indexOf(end, from + start.length);
  return value.slice(from, to < 0 ? undefined : to);
}
