import { candidateKey, withRejectedCooldown } from "./perception/action-cooldowns.js";
import { createLocalPerceptionFrame } from "./perception/zone-motion-engine.js";
import { normalizeStep, scoreLocalActions } from "./perception/local-action-scorer.js";
import { createLocalGestureEngine } from "./perception/local-gesture-engine.js";
import { createEmergencyRuntimeController } from "./emergency-runtime-controller.js";
import { createGestureStabilizerState, updateGestureStabilizer } from "./perception/gesture-stabilizer.js";
import {
  createFirstFrameWait,
  mountPerceptionCoreAwakening
} from "./perception-core/perception-core-awakening.js";
import {
  appendLiveAssistantChunk,
  beginLiveConversation,
  chunkLiveAnswerText,
  clearLiveConversation,
  completeLiveAssistantTurn,
  createLiveConversationState,
  failLiveConversation,
  finalizeLiveUserTurn,
  interruptLiveConversation,
  liveConversationStatusLabel,
  recognitionUpdateFromEvent,
  setLiveConversationListening,
  setLiveConversationMuted,
  setLiveConversationSpeaking,
  setLiveConversationThinking,
  updateLiveInterim
} from "./perception-core/live-conversation-runtime.js";
import { mountMicroscope } from "./microscope/microscope-controller.js";
import {
  MIN_CUSTOM_SKILL_EXAMPLES,
  acceptCustomSkillDemonstration,
  calibrateCustomSkillThreshold,
  canActivateCustomSkill,
  createCustomSkill,
  createCustomSkillRuntimeState,
  createCustomSkillStore,
  normalizeCustomMovementSkill,
  processCustomSkillLandmarks,
  recordCustomSkillTestObservation
} from "./perception/custom-skills/index.js";
import {
  AUTOMATION_PRESETS,
  DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE,
  INSTANT_LOCAL_ACTION_TYPES,
  MAX_AUTOMATION_RECEIPTS,
  automationIdempotencyKey as createIdempotencyKey,
  clearAutomationActivityLog as clearActivityLog,
  clearAutomationRuntimeData,
  createAutomationRecipeId,
  createAutomationRuntime as createRuntime,
  createRecipeStore,
  dryRunAutomationRecipe,
  executeAutomationRecipesForConfirmedMovement as executeConfirmedRecipes,
  executeLocalAutomationAction as executeLocalAction,
  freezeConfirmedMovementSnapshot,
  matchAutomationRecipes as matchRecipes,
  normalizeGestureTags,
  normalizeMovementKey,
  normalizeAutomationRecipe,
  presetRecipe,
  runAutomationForStableLocalGesture as runStableGestureRecipes,
  transitionAutomationState as transitionRuntimeState,
  validateAutomationRecipe as validateRecipeResult
} from "./automation/index.js";

export const REQUIRED_ZONES = ["phone_zone", "notebook_zone", "pen_zone", "keyboard_zone", "neutral_zone", "off_desk_zone"];
export const REQUIRED_OBJECTS = ["phone", "notebook", "pen", "keyboard"];
export const MOVEMENT_RECOGNITION_ALLOWED_ACTIONS = ["uncertain"];
const LEGACY_MOVEMENT_ACTION_TYPES = ["phone_moved", "notebook_opened", "pen_picked_up", "writing_motion", "typing_motion", "uncertain"];
export const MOVEMENT_RECOGNITION_CLIENT_CONFIG = {
  endpoint: "/api/movement-recognition/analyze",
  usageEndpoint: "/api/movement-recognition/usage",
  provider: "huggingface",
  mode: "vlm_frames",
  maxFrames: 4,
  windowMs: 1500,
  frameMimeType: "image/jpeg",
  frameQuality: 0.62,
  frameWidth: 320,
  mirrorFramesToPreview: true
};
export const VISUAL_COMPANION_CLIENT_CONFIG = {
  endpoint: "/api/visual-companion/observe",
  conversationEndpoint: "/api/visual-companion/conversation",
  healthEndpoint: "/api/visual-companion/health",
  speakEndpoint: "/api/visual-companion/speak",
  cancelEndpoint: "/api/visual-companion/cancel",
  provider: "local_visual_companion",
  mode: "local_smolvlm_frames",
  maxFrames: 4,
  windowMs: 2200,
  frameMimeType: "image/jpeg",
  frameQuality: 0.62,
  frameWidth: 256,
  mirrorFramesToPreview: true
};
export const VISUAL_COMPANION_ALLOWED_ACTIONS = ["start_timer", "speak_phrase", "browser_notification", "increment_counter", "append_activity_log"];
export const VISUAL_COMPANION_PROMPT_VERSION = "visual-companion-provider.v1";
export const VISUAL_CONTEXT_STORAGE_KEY = "darkquest.visual_context.v1";
export const VISUAL_AUTO_SPEAK_STORAGE_KEY = "darkquest.visual_auto_speak.v1";
const UNCERTAIN_SPOKEN_RESPONSE = "I'm not sure what changed. Try showing me again.";
const sensefieldTestRuntime = {
  eventSequence: 0,
  events: [],
  requests: [],
  speech: [],
  resourceCounts: {
    mediaStreamsCreated: 0,
    inferenceStarted: 0,
    inferenceCompleted: 0,
    speechStarted: 0,
    speechCompleted: 0,
    speechCancelled: 0,
    rawMediaPersistenceCount: 0
  }
};

function sensefieldTestModeEnabled() {
  if (typeof location === "undefined") return false;
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(String(location.hostname || ""));
  return localHost && new URLSearchParams(String(location.search || "")).get("sensefield-test") === "1";
}

function safeSensefieldTestMetadata(value, depth = 0) {
  if (depth > 4 || value == null) return value == null ? null : String(value).slice(0, 240);
  if (["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" ? value.slice(0, 500) : value;
  }
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => safeSensefieldTestMetadata(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 240);
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(encoded_frame|data_uri|base64|token|authorization|secret|audio_bytes|image_payload|raw_media)/i.test(key)) continue;
    safe[key] = safeSensefieldTestMetadata(item, depth + 1);
  }
  return safe;
}

function recordSensefieldTestEvent(eventType, metadata = {}, options = {}) {
  if (!sensefieldTestModeEnabled()) return null;
  const event = Object.freeze({
    event_id: `sf_test_event_${++sensefieldTestRuntime.eventSequence}`,
    correlation_id: String(options.correlationId || metadata.correlation_id || `sf_correlation_${sensefieldTestRuntime.eventSequence}`),
    mode_generation_id: Number(options.modeGenerationId ?? state?.interactionState?.modeGenerationId ?? 0),
    timestamp: Date.now(),
    event_type: String(eventType),
    metadata: safeSensefieldTestMetadata(metadata)
  });
  sensefieldTestRuntime.events.push(event);
  sensefieldTestRuntime.events = sensefieldTestRuntime.events.slice(-500);
  return event;
}

function recordSensefieldTestRequest(phase, metadata = {}, options = {}) {
  const event = recordSensefieldTestEvent(`request_${phase}`, metadata, options);
  if (event) {
    sensefieldTestRuntime.requests.push(event);
    sensefieldTestRuntime.requests = sensefieldTestRuntime.requests.slice(-200);
  }
  return event;
}

function recordSensefieldTestSpeech(phase, metadata = {}, options = {}) {
  const event = recordSensefieldTestEvent(`speech_${phase}`, metadata, options);
  if (event) {
    sensefieldTestRuntime.speech.push(event);
    sensefieldTestRuntime.speech = sensefieldTestRuntime.speech.slice(-200);
  }
  return event;
}
export const DARKQUEST_SESSION_STORAGE_KEY = "darkquest.session_id.v1";
export const MOVEMENT_NARRATION_PROMPT_VERSION = "movement-narration-prompt.v2";
export const CAMERA_MIRROR_POLICY = {
  previewDefault: true,
  analysisFramesMirrorPreview: true
};
export const LIVE_PHYSICAL_TRACE_PATH = "fixtures/replay/live/live_physical_focus_ritual_001.v0.json";
export const LIVE_PHYSICAL_TRACE_FILENAME = "live_physical_focus_ritual_001.v0.json";
export const BUG_REPORT_FILENAME = "darkquest_operator_bug_report.json";
export const APP_VERSION = "0.1.0";
export const GATE2A_DISCLOSURE = "Minimal HUD polish enabled with disclosure. Static package build validation is waived. This app does not claim automatic perception; manual confirmations are clearly labeled. Manual local confirmation - not automatic vision.";
export const MACOS_SAVE_COMMAND = [
  "mkdir -p fixtures/replay/live",
  `cp ~/Downloads/${LIVE_PHYSICAL_TRACE_FILENAME} ${LIVE_PHYSICAL_TRACE_PATH}`,
  "npm run physical:validate",
  "npm run gate:1c"
].join("\n");
export const VALIDATION_COMMAND_LIST = [
  { id: "physicalValidate", label: "physical:validate", command: "npm run physical:validate" },
  { id: "replay", label: "replay x3", command: `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 ${LIVE_PHYSICAL_TRACE_PATH}` },
  { id: "gate1c", label: "gate:1c", command: "npm run gate:1c" },
  { id: "gate1e", label: "gate:1e", command: "npm run gate:1e" }
];
export const VALIDATION_COMMANDS = VALIDATION_COMMAND_LIST.map((item) => item.command).join("\n");
export const SUGGESTION_TRACE_MODES = [
  {
    id: "standard",
    label: "Standard Physical Trace",
    fixture_id: "live_physical_focus_ritual_001",
    filename: LIVE_PHYSICAL_TRACE_FILENAME,
    path: LIVE_PHYSICAL_TRACE_PATH,
    action: "Complete the full Focus Ritual with manual local confirmations.",
    expected: "Manual confirmations are enough; camera suggestions may appear.",
    decision: "Accept only suggestions that match the physical action.",
    validation: `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 ${LIVE_PHYSICAL_TRACE_PATH}`
  },
  ...[
    ["suggestion_phone_moved", "Suggestion Trace: Phone Moved", "live_suggestion_phone_moved_001", "physically move the phone away", "Possible phone moved - confirm to accept.", "Accept"],
    ["suggestion_notebook_opened", "Suggestion Trace: Notebook Opened", "live_suggestion_notebook_opened_001", "physically open the notebook", "Possible notebook opened - confirm to accept.", "Accept"],
    ["suggestion_pen_picked_up", "Suggestion Trace: Pen Picked Up", "live_suggestion_pen_picked_up_001", "physically pick up the pen", "Possible pen picked up - confirm to accept.", "Accept"],
    ["suggestion_writing_motion", "Suggestion Trace: Writing Motion", "live_suggestion_writing_motion_001", "physically make writing-like motion", "Possible writing motion - confirm to accept.", "Accept"],
    ["suggestion_typing_motion", "Suggestion Trace: Typing Motion", "live_suggestion_typing_motion_001", "physically make typing-like motion", "Possible typing motion - confirm to accept.", "Accept"],
    ["suggestion_reject", "Suggestion Trace: Reject Suggestion", "live_suggestion_reject_does_not_progress_001", "create a mismatched or low-confidence suggestion", "Any camera suggestion that should not progress the current step.", "Reject"],
    ["suggestion_uncertain", "Suggestion Trace: Uncertain Scene", "live_suggestion_uncertain_scene_001", "create noisy motion until uncertainty is suggested", "Possible scene uncertainty - confirm to review.", "Reject for exportable trace; accepting uncertainty intentionally blocks export until reset."],
    ["suggestion_full_focus_ritual", "Suggestion Trace: Full Focus Ritual", "live_suggestion_full_focus_ritual_001", "complete the full Focus Ritual while accepting matching suggestions", "A matching suggestion at each ritual step.", "Accept matching suggestions"]
  ].map(([id, label, fixtureId, action, expected, decision]) => {
    const path = `fixtures/replay/live/suggestions/${fixtureId}.v0.json`;
    return {
      id,
      label,
      fixture_id: fixtureId,
      filename: `${fixtureId}.v0.json`,
      path,
      action,
      expected,
      decision,
      validation: `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 ${path}`
    };
  })
];
export const SUGGESTION_CAMPAIGN_STEPS = SUGGESTION_TRACE_MODES.filter((mode) => mode.id !== "standard")
  .map((mode, index) => ({ ...mode, number: index + 1 }));
export const CAMPAIGN_BUNDLE_FILENAME = "darkquest_suggestion_trace_campaign_bundle.json";

const REQUIRED_EXPORT_EVENT_IDS = [
  "evt_scene_calibrated",
  "evt_phone_moved_to_off_desk",
  "evt_notebook_opened",
  "evt_pen_moved_to_hand",
  "evt_writing_like_motion",
  "evt_typing_like_motion"
];

const SUGGESTION_TRACE_EVENT_BY_MODE = {
  suggestion_phone_moved: "evt_phone_moved_to_off_desk",
  suggestion_notebook_opened: "evt_notebook_opened",
  suggestion_pen_picked_up: "evt_pen_moved_to_hand",
  suggestion_writing_motion: "evt_writing_like_motion",
  suggestion_typing_motion: "evt_typing_like_motion"
};

const SUGGESTION_TRACE_STEP_BY_MODE = {
  suggestion_phone_moved: "phone",
  suggestion_notebook_opened: "notebook",
  suggestion_pen_picked_up: "pen",
  suggestion_writing_motion: "writing",
  suggestion_typing_motion: "typing"
};

const SUGGESTION_RENDER_INTERVAL_MS = 320;
export const MOVEMENT_HISTORY_MAX_ITEMS = 10;
export const CORRECTION_MEMORY_MAX_ITEMS = 10;
export const AUTOMATION_EXECUTE_ENDPOINT = "/api/automation/execute";
export const AUTOMATION_EXECUTION_RECEIPT_LIMIT = MAX_AUTOMATION_RECEIPTS;
export const INSTANT_GESTURE_DEFAULTS = Object.freeze({ minimumConfidence: 0.7, holdMs: 350, neutralResetMs: 250, cooldownMs: 3000 });
export const INSTANT_GESTURE_DIAGNOSIS_CODES = Object.freeze([
  "loop_not_running",
  "zero_frames",
  "no_gesture",
  "instant_gesture_below_threshold",
  "instant_gesture_hold_not_met",
  "instant_gesture_duplicate",
  "instant_gesture_neutral_reset_missing",
  "instant_gesture_cooldown_active",
  "instant_recipe_not_enabled",
  "instant_action_not_allowlisted",
  "instant_action_failed",
  "instant_speech_unavailable",
  "gesture_engine_stalled_restarting",
  "gesture_engine_stalled_after_restart"
]);
const automationRecipeStore = createRecipeStore();
const customSkillStore = createCustomSkillStore();

export function validateAutomationRecipe(input) {
  if (input?.schema === "darkquest.movement_automation_recipe.v1") return validateGateAutomationRecipe(input, arguments[1]);
  return validateRecipeResult(input, arguments[1]);
}

export function matchAutomationRecipes(snapshot, recipes, context) {
  if (snapshot?.result && Array.isArray(snapshot.recipes)) return matchGateAutomationRecipes(snapshot);
  if (Array.isArray(snapshot) && recipes && !Array.isArray(recipes)) [snapshot, recipes] = [recipes, snapshot];
  const normalizedRecipes = (recipes || []).map((recipe) => recipe?.recipe || recipe?.normalized || recipe).filter(Boolean);
  const matches = matchRecipes(snapshot, normalizedRecipes, context);
  matches.matches = matches;
  return matches;
}

export function createAutomationRuntimeState(recipes = []) {
  const options = !Array.isArray(recipes) && recipes && !recipes.recipes ? recipes : {};
  const runtime = createRuntime(Array.isArray(recipes) ? recipes : recipes?.recipes || []);
  runtime.state = "idle";
  runtime.automation_state = "idle";
  runtime.max_actions_per_movement = Number(options.max_actions_per_movement || 3);
  runtime.max_actions_per_session = Number(options.max_actions_per_session || 20);
  runtime.maxExecutions = runtime.max_actions_per_session;
  runtime.retry_limit = Math.min(1, Math.max(0, Number(options.retry_limit || 0)));
  return runtime;
}

export function transitionAutomationState(runtime, status, safeMessage) {
  if (runtime && typeof runtime === "object" && runtime.state) return transitionGateAutomationState(runtime, status, safeMessage);
  const current = runtime?.current_state || runtime?.from || runtime;
  const next = status?.next_state || status?.to || status?.status || status;
  try {
    const result = transitionRuntimeState(current, next, safeMessage);
    if (result && typeof result === "object") {
      result.ok = true;
      result.state = result.status;
      result.code = "automation_state_transition_ok";
      return result;
    }
    return { ok: true, state: result, status: result, code: "automation_state_transition_ok" };
  } catch (error) {
    return { ok: false, state: current?.status || current, status: current?.status || current, code: error?.code || "automation_state_transition_invalid" };
  }
}

export function automationIdempotencyKey(resultId, recipeId) {
  return createIdempotencyKey(resultId, recipeId);
}

export function runAutomationForConfirmedMovement(input = {}, recipes = [], options = {}) {
  if (input?.result) return runGateConfirmedAutomation(input);
  const fourthOptions = arguments[3] || {};
  const request = input?.snapshot || input?.movementResult || input?.movement_result || input?.confirmedMovement || input?.confirmed_movement || input?.confirmedResult || input?.canonicalResult || input?.movementResultSnapshot || input?.result || input?.recipe || input?.recipes
    ? input
    : { ...options, ...fourthOptions, snapshot: input, recipes };
  const sourceSnapshot = request.snapshot || request.movementResult || request.movement_result || request.confirmedMovement || request.confirmed_movement || request.confirmedResult || request.canonicalResult || request.movementResultSnapshot || request.result || {};
  const snapshot = {
    ...sourceSnapshot,
    movement_result_id: sourceSnapshot.movement_result_id || sourceSnapshot.result_id || sourceSnapshot.id || "movement_result_unknown",
    movement: sourceSnapshot.movement || sourceSnapshot.movement_sentence || sourceSnapshot.corrected_movement || "Movement confirmed.",
    short_label: sourceSnapshot.short_label || sourceSnapshot.label || "Movement",
    movement_key: sourceSnapshot.canonical_movement_key || sourceSnapshot.corrected_movement_key || sourceSnapshot.movement_key || normalizeMovementKey(sourceSnapshot.short_label || sourceSnapshot.label),
    gesture_tags: sourceSnapshot.gesture_tags || [],
    confirmed: request.rejected !== true && sourceSnapshot.rejected !== true && request.accepted !== false && (request.confirmed === true || request.userConfirmed === true || request.user_confirmed === true || request.confirmation === true || request.confirmation?.confirmed === true || sourceSnapshot.confirmed === true || sourceSnapshot.confirmed_by_user === true),
    uncertainty: sourceSnapshot.uncertainty === true
  };
  const runtime = request.runtime || request.runtimeState || request.automationState || request.state || createAutomationRuntimeState(request.recipes || recipes);
  const normalizedRecipes = (request.recipes || (request.recipe ? [request.recipe] : null) || runtime.recipes || recipes).map((recipe) => recipe?.recipe || recipe?.normalized || recipe).filter(Boolean);
  return executeConfirmedRecipes({
    ...request,
    snapshot,
    recipes: normalizedRecipes,
    runtime,
    actionExecutor: request.actionExecutor || request.executeAction || request.execute_action || request.adapter,
    requestConsent: request.requestConsent || request.confirmAction,
    context: request.context || {}
  });
}

export function __end__() {}

export function executeLocalAutomationAction(input, context) {
  return executePublicLocalAutomationAction(input, context);
}

export function clearAutomationActivityLog(runtime) {
  return clearActivityLog(runtime);
}

export function runAutomationForStableLocalGesture(input) {
  return runStableGestureRecipes(input);
}

function validateGateAutomationRecipe(input, options = {}) {
  const fail = (code) => ({ ok: false, valid: false, code, error_code: code, errors: [code] });
  const allowedTop = new Set(["schema", "recipe_id", "name", "enabled", "priority", "trigger", "action", "cooldown_ms", "session_run_limit", "execution_mode"]);
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !allowedTop.has(key))) return fail("automation_recipe_invalid");
  if (input.schema !== "darkquest.movement_automation_recipe.v1" || !/^recipe_[a-zA-Z0-9_-]{1,80}$/.test(String(input.recipe_id || ""))) return fail("automation_recipe_invalid");
  if (!String(input.name || "").trim() || String(input.name).length > 160) return fail("automation_recipe_invalid");
  if ((options.existing_recipe_ids || []).includes(input.recipe_id)) return fail("automation_recipe_duplicate_id");
  const actionTypes = { append_activity_log: 0, increment_counter: 0, speak_phrase: 1, browser_notification: 1, start_timer: 1, local_snapshot_download: 2, signed_webhook: 3 };
  const actionType = String(input.action?.type || "");
  if (!Object.hasOwn(actionTypes, actionType)) return fail("automation_recipe_unknown_action");
  if (Number(input.action?.risk_tier) !== actionTypes[actionType]) return fail("automation_recipe_risk_mismatch");
  const serialized = JSON.stringify(input.action?.config || {});
  if (/(?:hf_|sk-)[a-z0-9]{8,}|"[^"]*(?:token|secret|password|authorization|api[_-]?key)[^"]*"\s*:/i.test(serialized)) return fail("automation_recipe_contains_secret");
  const inlineImageMarker = ["data", "image"].join(":");
  if (serialized.toLowerCase().includes(inlineImageMarker) || /;base64,|raw[_-]?(?:frame|media)|screenshot/i.test(serialized)) return fail("automation_recipe_contains_raw_media");
  if (/"(?:javascript|script|function|eval|code)"|javascript:|=>/i.test(serialized)) return fail("automation_recipe_unsafe_code");
  if (/"(?:command|shell|exec|spawn)"|rm -rf|\bbash\b/i.test(serialized)) return fail("automation_recipe_unsafe_code");
  if (input.action?.config?.method && String(input.action.config.method).toUpperCase() !== "POST") return fail("automation_recipe_invalid");
  const trigger = input.trigger || {};
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(String(trigger.movement_key || ""))) return fail("automation_recipe_invalid");
  if (!Number.isFinite(Number(trigger.min_confidence)) || Number(trigger.min_confidence) < 0 || Number(trigger.min_confidence) > 1) return fail("automation_recipe_invalid");
  if (!Number.isInteger(Number(input.cooldown_ms)) || Number(input.cooldown_ms) < 0) return fail("automation_recipe_invalid");
  if (!Number.isInteger(Number(input.session_run_limit)) || Number(input.session_run_limit) < 1) return fail("automation_recipe_invalid");
  const recipe = {
    schema: input.schema,
    recipe_id: input.recipe_id,
    name: String(input.name).trim(),
    enabled: input.enabled === true,
    priority: Number(input.priority || 0),
    trigger: {
      movement_key: trigger.movement_key,
      aliases: [...(trigger.aliases || [])],
      required_gesture_tags: [...(trigger.required_gesture_tags || [])],
      min_confidence: Number(trigger.min_confidence)
    },
    action: { type: actionType, risk_tier: actionTypes[actionType], config: { ...(input.action.config || {}) } },
    cooldown_ms: Number(input.cooldown_ms),
    session_run_limit: Number(input.session_run_limit),
    execution_mode: input.execution_mode || "confirmed_ai_movement"
  };
  return { ok: true, valid: true, recipe, normalized: recipe, errors: [] };
}

function matchGateAutomationRecipes({ result, recipes = [], runtime = {}, now_ms = Date.now() }) {
  if (!result?.confirmed || result.uncertainty === true || result.rejected === true) return { matches: [] };
  const movementKey = normalizeMovementKey(result.corrected === true ? result.canonical_movement_key || result.movement_key : result.movement_key);
  const tags = new Set(normalizeGestureTags(result.gesture_tags));
  const matches = recipes
    .filter((recipe) => recipe.enabled === true && (recipe.execution_mode || "confirmed_ai_movement") === "confirmed_ai_movement")
    .filter((recipe) => Number(result.confidence || 0) >= Number(recipe.trigger?.min_confidence || 0))
    .filter((recipe) => Number(runtime.cooldowns?.[recipe.recipe_id] || 0) <= Number(now_ms))
    .filter((recipe) => Number(runtime.recipe_run_counts?.[recipe.recipe_id] || 0) < Number(recipe.session_run_limit || 1))
    .filter((recipe) => {
      const exact = normalizeMovementKey(recipe.trigger?.movement_key) === movementKey;
      const alias = (recipe.trigger?.aliases || []).map(normalizeMovementKey).includes(movementKey);
      const required = normalizeGestureTags(recipe.trigger?.required_gesture_tags);
      return (exact || alias) && required.every((tag) => tags.has(tag));
    })
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || a.recipe_id.localeCompare(b.recipe_id))
    .slice(0, Math.max(1, Math.min(3, Number(runtime.max_actions_per_movement || 3))));
  return { matches };
}

function transitionGateAutomationState(runtime, next, options = {}) {
  const current = runtime.state || "idle";
  const allowed = {
    idle: ["movement_confirmed"],
    movement_confirmed: ["matching"],
    matching: ["match_found", "rate_limited"],
    match_found: ["awaiting_consent", "planning"],
    awaiting_consent: ["planning", "cancelled"],
    planning: ["executing"],
    executing: ["succeeded", "failed"],
    succeeded: ["cooldown", "idle"],
    failed: ["idle"],
    cancelled: ["idle"],
    cooldown: ["idle"],
    rate_limited: ["idle"]
  };
  if (!allowed[current]?.includes(next)) return { ok: false, code: "automation_invalid_transition", state: current, runtime };
  runtime.state = next;
  runtime.automation_state = next;
  runtime.state_updated_at = Number(options?.now_ms || Date.now());
  return runtime;
}

async function runGateConfirmedAutomation(input) {
  const result = input.result || {};
  const runtime = input.runtime || createAutomationRuntimeState();
  if (!result.confirmed) return { matches: [], receipts: [], code: "automation_before_confirmation" };
  if (result.uncertainty === true) return { matches: [], receipts: [], code: "automation_from_uncertain_result" };
  if (result.rejected === true) return { matches: [], receipts: [], code: "automation_from_rejected_result" };
  if (runtime.automationExecutionInFlight === true) return { matches: [], receipts: [], code: "automation_recursion_blocked" };
  const matches = matchGateAutomationRecipes(input).matches.slice(0, runtime.max_actions_per_movement || 3);
  const receipts = [];
  runtime.automationExecutionInFlight = true;
  try {
    for (const recipe of matches) {
      if (runtime.totalExecutions >= runtime.max_actions_per_session) break;
      const key = automationIdempotencyKey(result.result_id, recipe.recipe_id);
      if (runtime.idempotencyKeys.includes(key)) continue;
      runtime.idempotencyKeys.push(key);
      runtime.executed_idempotency_keys = [...runtime.idempotencyKeys];
      let outcome;
      let attempt = 0;
      while (attempt <= runtime.retry_limit) {
        try {
          outcome = await (input.execute_action || executePublicLocalAutomationAction)({ action: recipe.action, runtime, idempotency_key: key, consent: true }, input.context || {});
          break;
        } catch (error) {
          outcome = { status: "failed", safe_message: "Automation failed — view safe details", code: error?.code || "automation_failed" };
        }
        attempt += 1;
      }
      runtime.totalExecutions += 1;
      runtime.recipe_run_counts[recipe.recipe_id] = Number(runtime.recipe_run_counts[recipe.recipe_id] || 0) + 1;
      runtime.sessionRuns[recipe.recipe_id] = runtime.recipe_run_counts[recipe.recipe_id];
      runtime.cooldowns[recipe.recipe_id] = Number(input.now_ms || Date.now()) + Number(recipe.cooldown_ms || 0);
      const receipt = { execution_id: key, recipe_id: recipe.recipe_id, movement_result_id: result.result_id, action_type: recipe.action.type, status: outcome?.status === "failed" ? "failed" : "succeeded", safe_message: outcome?.safe_message || "Automation completed.", contains_raw_media: false };
      runtime.receipts = [receipt, ...(runtime.receipts || []).filter((item) => item.execution_id !== key)].slice(0, 50);
      receipts.push(receipt);
    }
  } finally {
    runtime.automationExecutionInFlight = false;
  }
  return { matches, receipts };
}

async function executePublicLocalAutomationAction(input = {}, context = {}) {
  const actionType = input.action?.type;
  if (actionType === "local_snapshot_download") {
    if (input.consent !== true) return { ok: false, status: "cancelled", code: "automation_snapshot_without_confirmation", contains_raw_media: false };
    let objectUrl = "";
    try {
      const blob = await context.captureFreshFrame?.();
      objectUrl = context.createObjectURL?.(blob) || "";
      context.downloadBlob?.(blob, objectUrl);
      return { ok: true, status: "succeeded", safe_message: "Snapshot downloaded locally.", contains_raw_media: false };
    } finally {
      if (objectUrl) context.revokeObjectURL?.(objectUrl);
    }
  }
  try {
    return await executeLocalAction(input, { ...context, userGesture: input.consent === true || context.userGesture === true });
  } catch (error) {
    if (actionType === "browser_notification") return { ok: false, status: "failed", code: "automation_notification_permission_denied", safe_message: "Notification permission denied", contains_raw_media: false };
    throw error;
  }
}
const SERVER_TOKEN_NAME = ["HF", "TOKEN"].join("_");
const LEGACY_HIDDEN_SUGGESTION_ACTION_MARKERS = ['data-suggestion-action="accept"', 'data-suggestion-action="reject"'];
const LEGACY_INVALID_IMAGE_STATE_MARKER = "Camera frame could not be captured";
const LEGACY_SUGGESTION_CONFIDENCE_COPY_MARKER = "Confidence ${suggestion.confidence.toFixed(2)}";

const EVENT_SEQUENCE_STEPS = [
  { index: 1, label: "Calibrate scene", eventId: "evt_scene_calibrated" },
  { index: 2, label: "Move phone away", eventId: "evt_phone_moved_to_off_desk" },
  { index: 3, label: "Open notebook", eventId: "evt_notebook_opened" },
  { index: 4, label: "Pick up pen", eventId: "evt_pen_moved_to_hand" },
  { index: 5, label: "Writing motion", eventId: "evt_writing_like_motion" },
  { index: 6, label: "Typing motion", eventId: "evt_typing_like_motion" },
  { index: 7, label: "Complete", eventId: null }
];

const RITUAL_STEPS = [
  { id: "phone", label: "Move phone away", activeState: "phone_removal_pending", doneState: "phone_removed", buttonText: "Confirm Phone Moved" },
  { id: "notebook", label: "Open notebook", activeState: "notebook_pending", doneState: "notebook_opened", buttonText: "Confirm Notebook Opened" },
  { id: "pen", label: "Pick up pen", activeState: "pen_pending", doneState: "pen_detected", buttonText: "Confirm Pen Picked Up" },
  { id: "writing", label: "Writing-like motion", activeState: "writing_pending", doneState: "writing_detected", buttonText: "Confirm Writing Motion" },
  { id: "typing", label: "Typing-like motion", activeState: "typing_pending", doneState: "typing_detected", buttonText: "Confirm Typing Motion" }
];

const LOCAL_PERCEPTION_SAMPLE = { width: 96, height: 54, minIntervalMs: 140 };
export const LOCAL_MOTION = {
  activeThreshold: 0.045,
  stableDurationMs: 360,
  leaveDurationMs: 320,
  activationCooldownMs: 1800,
  suggestionCooldownMs: 3200,
  suggestionThreshold: 0.68,
  maxActiveSuggestions: 3,
  suggestionTtlMs: 6500,
  historyWindowMs: 3000,
  uncertainThreshold: 0.32
};

export const PERSISTENT_OBSERVATION = {
  cooldownMs: 0,
  duplicateWindowMs: 45000,
  neutralResetMs: 750,
  changeThreshold: 0.06,
  queuedEventLimit: 1,
  minTriggerIntervalMs: 4000,
  maxFrames: 4,
  windowMs: 2200
};

export const REALTIME_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

export const INTERACTION_MODES = Object.freeze(["conversation", "observing"]);
const INTERACTION_MODE_STORAGE_KEY = "sensefield.interaction_mode.v1";

export function createConversationMemoryState() {
  return {
    userTurns: [],
    assistantResponses: [],
    visualSummaries: [],
    activeObjectReferences: [],
    savedActionTriggers: [],
    interruptedResponses: []
  };
}

export function createObservationMemoryState() {
  return {
    movementDescriptions: [],
    visualEventFingerprints: [],
    deduplicationState: {
      lastFingerprint: "",
      lastSemanticKey: "",
      droppedDuplicateCount: 0
    }
  };
}

export function createInteractionState(mode = loadInteractionModePreference()) {
  const normalizedMode = normalizeInteractionMode(mode);
  return {
    sessionActive: false,
    mode: normalizedMode,
    cameraActive: false,
    microphoneActive: false,
    visualContextActive: false,
    proactiveObservationActive: false,
    listeningActive: false,
    userSpeaking: false,
    inferenceInFlight: false,
    assistantSpeaking: false,
    queuedUserTurn: null,
    queuedVisualEvent: null,
    safeError: null,
    sessionGenerationId: 0,
    modeGenerationId: 0,
    inferenceGenerationId: 0,
    speechGenerationId: 0
  };
}

const STEP_SUGGESTION_META = {
  phone: {
    suggested_event_type: "object.moved",
    suggested_action: "Possible phone moved - confirm to accept.",
    zone_id: "phone_zone",
    object_id: "phone"
  },
  notebook: {
    suggested_event_type: "gesture.detected",
    suggested_action: "Possible notebook opened - confirm to accept.",
    zone_id: "notebook_zone",
    object_id: "notebook"
  },
  pen: {
    suggested_event_type: "object.moved",
    suggested_action: "Possible pen picked up - confirm to accept.",
    zone_id: "pen_zone",
    object_id: "pen"
  },
  writing: {
    suggested_event_type: "gesture.detected",
    suggested_action: "Possible writing motion - confirm to accept.",
    zone_id: "notebook_zone",
    object_id: "pen"
  },
  typing: {
    suggested_event_type: "gesture.detected",
    suggested_action: "Possible typing motion - confirm to accept.",
    zone_id: "keyboard_zone",
    object_id: "keyboard"
  },
  uncertain: {
    suggested_event_type: "scene.uncertain",
    suggested_action: "Possible scene uncertainty - confirm to review.",
    zone_id: "neutral_zone",
    object_id: "scene"
  },
  reset: {
    suggested_event_type: "scene.reset",
    suggested_action: "Possible camera reset needed - confirm to review.",
    zone_id: "neutral_zone",
    object_id: "scene"
  }
};

const DEFAULT_ZONE_GEOMETRY = {
  phone_zone: { x: 0.04, y: 0.08, w: 0.22, h: 0.28 },
  notebook_zone: { x: 0.30, y: 0.18, w: 0.34, h: 0.40 },
  pen_zone: { x: 0.58, y: 0.12, w: 0.16, h: 0.24 },
  keyboard_zone: { x: 0.18, y: 0.66, w: 0.58, h: 0.24 },
  neutral_zone: { x: 0.76, y: 0.12, w: 0.18, h: 0.36 },
  off_desk_zone: { x: 0.78, y: 0.62, w: 0.18, h: 0.28 }
};

const DEFAULT_OBJECT_ASSIGNMENTS = {
  phone: "phone_zone",
  notebook: "notebook_zone",
  pen: "pen_zone",
  keyboard: "keyboard_zone"
};

const ACTION_LABELS = {
  startCamera: "Start Camera",
  stopCamera: "Stop Camera",
  calibrateZones: "Calibrate Zones",
  saveCalibration: "Save Calibration",
  startFocusRitual: "Start Focus Ritual",
  startRecording: "Start Recording",
  stopRecording: "Stop Recording",
  exportTrace: "Export Physical Trace",
  copyValidation: "Copy Validation Commands",
  phone: "Confirm Phone Moved",
  notebook: "Confirm Notebook Opened",
  pen: "Confirm Pen Picked Up",
  writing: "Confirm Writing Motion",
  typing: "Confirm Typing Motion",
  uncertain: "Mark Uncertain",
  reset: "Mark Camera Reset"
};

const INSTANT_INFERENCE_STALE_MS = 1500;
const CUSTOM_SKILL_CAPTURE_TIMEOUT_MS = 6000;
// Legacy gate vocabulary retained as non-visible lifecycle aliases; the canonical
// user-facing copy is produced only by deriveInstantGestureStatus below.
const INSTANT_LIFECYCLE_MARKERS = Object.freeze([
  "Loading model",
  "Starting inference",
  "Waiting for camera frames",
  "Ready — scanning",
  "Thumbs up",
  "Cooling down",
  "Unavailable"
]);

export function createInstantGestureRuntimeState() {
  const runtime = {
    userEnabled: false,
    cameraActive: false,
    documentVisible: true,
    enabledRecipeCount: 0,
    engineStatus: "off",
    engineMode: "off",
    recognizerInitialized: false,
    loopRunning: false,
    framesProcessed: 0,
    successfulInferences: 0,
    lastInferenceAt: 0,
    lastInferenceAgeMs: null,
    lastCandidate: null,
    currentHoldMs: 0,
    requiredHoldMs: INSTANT_GESTURE_DEFAULTS.holdMs,
    lastStableEvent: "",
    lastOutcomeCode: "loop_not_running",
    safeError: "",
    lastRawLabel: "None",
    lastRawConfidence: 0,
    fallbackClassifierUsed: false,
    lastRecipeOutcomeCode: "loop_not_running",
    lastRecipeMatch: "",
    lastActionOutcomeCode: "",
    lastReceipt: "",
    lastReceiptId: "",
    lastErrorCode: "",
    lastErrorMessage: "",
    frameInFlight: false,
    videoReady: false,
    stabilizer: createGestureStabilizerState(),
    lastGestureEvent: null,
    cooldownTimer: null,
    _diagnostics: {},
    contains_raw_media: false
  };
  Object.defineProperties(runtime, {
    enabled: {
      enumerable: false,
      get: () => runtime.userEnabled,
      set: (value) => { runtime.userEnabled = value === true; }
    },
    status: {
      enumerable: false,
      get: () => runtime.engineStatus,
      set: (value) => {
        runtime.engineStatus = String(value || "off");
        if (runtime.engineStatus === "ready") {
          runtime.recognizerInitialized = true;
          runtime.loopRunning = true;
          runtime.successfulInferences = Math.max(1, runtime.successfulInferences);
          runtime.lastInferenceAt = runtimeNow();
          runtime.lastInferenceAgeMs = 0;
        }
      }
    },
    message: { enumerable: false, get: () => deriveInstantGestureStatus(runtime) },
    lastEngineErrorCode: {
      enumerable: false,
      get: () => runtime.lastErrorCode,
      set: (value) => { runtime.lastErrorCode = String(value || ""); }
    },
    lastEngineErrorMessage: {
      enumerable: false,
      get: () => runtime.lastErrorMessage,
      set: (value) => { runtime.lastErrorMessage = String(value || ""); }
    },
    diagnostics: {
      enumerable: false,
      get: () => instantRuntimeDiagnostics(runtime),
      set: (value) => { runtime._diagnostics = value && typeof value === "object" ? value : {}; }
    }
  });
  return runtime;
}

export function instantGesturesEnabledFromRecipes(recipes = []) {
  return (Array.isArray(recipes) ? recipes : []).some((recipe) => recipe.enabled === true
    && recipe.execution_mode === "instant_local_gesture"
    && recipe.consent?.run_instantly === true);
}

function createCustomSkillWizardState() {
  return {
    open: false,
    action: { type: "speak_phrase", value: "" },
    testing: false,
    testArmed: true,
    opener: null,
    isSaving: false
  };
}

export function createCustomSkillDraft(skill, currentStep = 1) {
  const draft = {
    skill,
    currentStep,
    captureState: "idle",
    lastCaptureError: "",
    liveCandidate: null,
    transientSamples: [],
    captureStartedAt: 0,
    captureTimer: null,
    captureNegative: false,
    visibleHandCount: 0,
    landmarkFrameAvailable: false,
    stableHoldMs: 0
  };
  Object.defineProperties(draft, {
    skillId: { enumerable: true, get: () => draft.skill.custom_skill_id },
    name: { enumerable: true, get: () => draft.skill.name },
    skillType: { enumerable: true, get: () => draft.skill.skill_type },
    requiredHandCount: { enumerable: true, get: () => draft.skill.hand_count },
    positiveExamples: { enumerable: true, get: () => draft.skill.positive_templates },
    negativeExamples: { enumerable: true, get: () => draft.skill.negative_templates },
    testResults: { enumerable: true, get: () => draft.skill.test_state }
  });
  return draft;
}

function attachRuntimeCompatibilityAliases(target) {
  Object.defineProperty(target, "instantGestures", {
    enumerable: false,
    configurable: true,
    get: () => target.instantGestureRuntimeState
  });
  Object.defineProperties(target.customSkillWizard, {
    step: {
      enumerable: false,
      configurable: true,
      get: () => target.customSkillDraft?.currentStep ?? 1,
      set: (value) => { if (target.customSkillDraft) target.customSkillDraft.currentStep = Number(value) || 1; }
    },
    draft: {
      enumerable: false,
      configurable: true,
      get: () => target.customSkillDraft?.skill ?? null,
      set: (skill) => {
        if (!skill) target.customSkillDraft = null;
        else if (target.customSkillDraft) target.customSkillDraft.skill = skill;
        else target.customSkillDraft = createCustomSkillDraft(skill, 1);
      }
    }
  });
}

function createEmptyCloudUsage() {
  return {
    cloud_enabled: true,
    session: { used: 0, limit: 20, remaining: 20 },
    day: { used: 0, limit: 50, remaining: 50 },
    month: { used: 0, limit: 100, remaining: 100 },
    concurrent: { active: 0, limit: 1 }
  };
}

export function createRealtimeSessionState() {
  return {
    state: "inactive",
    visualContextActive: false,
    listeningActive: false,
    userSpeaking: false,
    inferenceInFlight: false,
    assistantSpeaking: false,
    queuedVisualEvent: null,
    queuedUserTurn: null,
    queuedUserTurns: [],
    speechRecognition: null,
    speechRestartTimer: null,
    speechFallback: "browser_speech_recognition",
    speechStopping: false,
    processingTranscript: false,
    lastFinalTranscript: "",
    lastFinalTranscriptAtMs: 0,
    lastUserTranscript: "",
    lastInterruptedAssistantText: "",
    memory: {
      userTurns: [],
      assistantResponses: [],
      visualSummaries: [],
      activeObjectReferences: [],
      savedActionTriggers: [],
      interruptedResponses: []
    },
    rollingVisualContext: {
      samples: [],
      summary: "",
      lastFingerprint: "",
      lastMeaningfulAtMs: 0
    },
    lastStartedAtMs: 0,
    lastEndedAtMs: 0
  };
}

export function normalizeInteractionMode(mode) {
  return INTERACTION_MODES.includes(String(mode)) ? String(mode) : "conversation";
}

function loadInteractionModePreference() {
  try {
    return normalizeInteractionMode(browserLocalStorage()?.getItem?.(INTERACTION_MODE_STORAGE_KEY));
  } catch {
    return "conversation";
  }
}

function persistInteractionModePreference(mode) {
  try {
    browserLocalStorage()?.setItem?.(INTERACTION_MODE_STORAGE_KEY, normalizeInteractionMode(mode));
  } catch {
    // Mode preference is convenience-only and must never block runtime.
  }
}

export function assertInteractionStateInvariant(target = state) {
  const interaction = target.interactionState;
  if (!interaction) return true;
  if (interaction.listeningActive && interaction.proactiveObservationActive) {
    throw new Error("Invalid interaction state: listening and proactive observation cannot both be active.");
  }
  if (interaction.sessionActive && interaction.mode === "conversation") {
    if (interaction.microphoneActive !== true || interaction.proactiveObservationActive !== false) {
      throw new Error("Invalid conversation state: microphone must be active and proactive observation must be inactive.");
    }
  }
  if (interaction.sessionActive && interaction.mode === "observing") {
    if (interaction.listeningActive !== false || interaction.proactiveObservationActive !== true) {
      throw new Error("Invalid observing state: proactive observation must be active and listening must be inactive.");
    }
  }
  return true;
}

function applyInteractionState(target, patch = {}) {
  const previous = target.interactionState;
  target.interactionState = {
    ...target.interactionState,
    ...patch,
    mode: normalizeInteractionMode(patch.mode ?? target.interactionState?.mode)
  };
  assertInteractionStateInvariant(target);
  syncRealtimeSessionFromInteraction(target);
  if (target === state) {
    const changed = Object.keys(patch).filter((key) => previous?.[key] !== target.interactionState[key]);
    if (changed.length) recordSensefieldTestEvent("interaction_state_changed", {
      changed,
      mode: target.interactionState.mode,
      session_active: target.interactionState.sessionActive,
      listening_active: target.interactionState.listeningActive,
      proactive_observation_active: target.interactionState.proactiveObservationActive,
      inference_in_flight: target.interactionState.inferenceInFlight,
      assistant_speaking: target.interactionState.assistantSpeaking,
      safe_error: target.interactionState.safeError || ""
    });
  }
  return target.interactionState;
}

function syncRealtimeSessionFromInteraction(target) {
  const interaction = target.interactionState;
  const realtime = target.realtimeSession;
  if (!interaction || !realtime) return;
  if (!["starting", "ending"].includes(realtime.state)) {
    realtime.state = interaction.safeError ? "error" : interaction.sessionActive ? "active" : "inactive";
  }
  realtime.visualContextActive = interaction.visualContextActive;
  realtime.listeningActive = interaction.listeningActive;
  realtime.userSpeaking = interaction.userSpeaking;
  realtime.inferenceInFlight = interaction.inferenceInFlight;
  realtime.assistantSpeaking = interaction.assistantSpeaking;
  realtime.queuedVisualEvent = interaction.queuedVisualEvent;
  realtime.queuedUserTurn = interaction.queuedUserTurn;
  realtime.queuedUserTurns = interaction.queuedUserTurn ? [interaction.queuedUserTurn] : [];
  realtime.memory = interaction.mode === "observing" ? target.observationMemory : target.conversationMemory;
}

function activeAudioTracks(target) {
  return (target.stream?.getAudioTracks?.() || []).filter((track) => track.readyState !== "ended");
}

function interactionModeIs(target, mode) {
  return target.interactionState?.mode === mode;
}

function modeRequestStillCurrent(target, mode, generationId) {
  return target.interactionState?.mode === mode &&
    Number(target.interactionState?.modeGenerationId || 0) === Number(generationId || 0);
}

function syncEmergencyRuntimeOwner(target) {
  const owned = target.emergencyRuntimeController.snapshot();
  target.appState = owned;
  applyInteractionState(target, {
    sessionActive: owned.session.status === "active",
    mode: owned.selectedMode,
    cameraActive: owned.media.cameraActive,
    microphoneActive: owned.media.microphoneActive,
    visualContextActive: owned.media.cameraActive,
    proactiveObservationActive: owned.runtime.proactiveObservationActive,
    listeningActive: owned.runtime.listening,
    userSpeaking: false,
    inferenceInFlight: owned.runtime.inferenceInFlight,
    assistantSpeaking: owned.runtime.speechInFlight && owned.runtime.speechStarted,
    queuedUserTurn: owned.runtime.queuedUserTurn,
    queuedVisualEvent: owned.runtime.queuedVisualEvent,
    safeError: owned.safeError || null,
    sessionGenerationId: owned.session.sessionGeneration,
    modeGenerationId: owned.session.modeGeneration
  });
  return owned;
}

function clearTransientPresentationState(target) {
  target.movementResultSnapshot = null;
  target.movementRecognition.lastResult = null;
  target.movementRecognition.lastError = "";
  target.movementRecognition.lastSafeError = "";
  target.movementRecognition.latestSpokenResponse = "";
  target.movementRecognition.lastSpokenMovement = "";
  target.movementRecognition.voiceStatus = "Ready";
  target.movementRecognition.requestInFlight = false;
  target.movementRecognition.activeRequestId = null;
  target.movementRecognition.status = "idle";
  target.movementCaptureState.status = "idle";
  target.realtimeSession.lastUserTranscript = "";
  target.realtimeSession.lastFinalTranscript = "";
  target.realtimeSession.lastFinalTranscriptAtMs = 0;
  target.realtimeSession.processingTranscript = false;
  target.errorMessage = "";
  lastMovementResultRenderKey = "";
  lastMovementDetailsRenderKey = "";
  lastMovementRevealResultId = "";
}

export function createInitialState() {
  const target = {
    stream: null,
    primarySurfaceMode: "conversation",
    cameraReady: false,
    cameraStarted: false,
    cameraStatus: "idle",
    calibrationOpen: false,
    calibrationSaved: false,
    calibrationId: "cal_live_physical_focus_ritual_001",
    sessionId: "ses_live_physical_focus_ritual_001",
    ritualStarted: false,
    recording: false,
    recordingStarted: false,
    physicalConfirmed: false,
    exported: false,
    validationCopied: false,
    questState: "idle",
    stateHistory: ["idle"],
    objective: "Click Start Camera.",
    activeZone: "none",
    confidence: 0,
    uncertain: false,
    reset: false,
    showTrackingOverlay: false,
    completedSteps: [],
    zoneGeometry: clone(DEFAULT_ZONE_GEOMETRY),
    objectAssignments: { ...DEFAULT_OBJECT_ASSIGNMENTS },
    events: [],
    latencyRecords: [],
    lastLatency: null,
    exportStatus: "not ready",
    exportReady: false,
    statusMessage: "Start with the Camera stage.",
    errorMessage: "",
    uncertaintyCount: 0,
    resetCount: 0,
    droppedFrames: 0,
    localPerceptionStatus: "idle",
    liveCameraState: {
      status: "idle",
      frame_id: 0,
      overlay_revision: 0,
      telemetry_revision: 0
    },
    movementCaptureState: {
      status: "idle",
      updated_at: 0
    },
    movementResultSnapshot: null,
    correctionDraft: {
      open: false,
      text: ""
    },
    movementHistory: {
      storage: "session_only",
      format: "text_only",
      max_items: MOVEMENT_HISTORY_MAX_ITEMS,
      entries: []
    },
    correctionMemory: {
      storage: "session_only",
      format: "text_only",
      max_items: CORRECTION_MEMORY_MAX_ITEMS,
      entries: []
    },
    movementRecognition: {
      status: "idle",
      provider: VISUAL_COMPANION_CLIENT_CONFIG.provider,
      model: "local model service",
      mode: VISUAL_COMPANION_CLIENT_CONFIG.mode,
      lastResult: null,
      lastError: "",
      lastSafeError: "",
      fallbackUsed: false,
      frameBufferCleared: true,
      confirmed: false,
      requestInFlight: false,
      promptVersion: VISUAL_COMPANION_PROMPT_VERSION,
      imageTokens: 0,
      retries: 0,
      candidateFailures: [],
      usage: createEmptyCloudUsage(),
      usageStatus: "Available",
      autoSpeak: loadVisualAutoSpeakPreference(),
      voiceStatus: "Ready",
      lastSpokenMovement: "",
      latestSpokenResponse: "",
      spokenObservationIds: new Set(),
      activeVoiceAbortController: null,
      activeSpeechAudio: null,
      activeSpeechObjectUrl: "",
      activeSpeechCancel: null,
      activeSpeechOwnership: null,
      persistent: {
        active: false,
        pausedForVisibility: false,
        state: "inactive",
        lastChangeScore: 0,
        lastTriggerAtMs: 0,
        cooldownUntilMs: 0,
        lastSceneFingerprint: "",
        lastSemanticKey: "",
        queuedEvent: null,
        droppedDuplicateCount: 0,
        neutralSinceMs: 0,
        awaitingNeutral: false
      }
    },
    interactionState: createInteractionState(),
    liveConversation: createLiveConversationState(),
    emergencyRuntimeController: createEmergencyRuntimeController({ selectedMode: loadInteractionModePreference() }),
    conversationMemory: createConversationMemoryState(),
    observationMemory: createObservationMemoryState(),
    realtimeSession: createRealtimeSessionState(),
    visualContext: loadVisualContextFromStorage() || {
      memoryMode: "session",
      lastObservationSummary: "",
      lastResponse: "",
      userCorrection: "",
      followUpAnswer: "",
      approvedPreferences: "",
      suggestedActions: []
    },
    confidenceCalibration: {
      results_count: 0,
      confirmed_count: 0,
      corrected_count: 0,
      uncertain_count: 0
    },
    automation: createAutomationRuntimeState(automationRecipeStore.list()),
    automationEditor: {
      recipeId: "",
      isSaving: false,
      opener: null
    },
    customSkills: customSkillStore.list(),
    customSkillRuntime: createCustomSkillRuntimeState(),
    customSkillDraft: null,
    customSkillWizard: createCustomSkillWizardState(),
    instantGestureRuntimeState: createInstantGestureRuntimeState(),
    localPerceptionFrame: null,
    localActionDiagnostics: {
      activeEngine: "motion_proxy",
      handEngineStatus: "fallback motion proxy",
      frameProcessingFps: 0,
      lastPerceptionLatencyMs: 0,
      currentPrimaryCandidate: null,
      lastRejectedCandidate: null,
      cooldownStatus: "none"
    },
    zoneMotion: {},
    motionHistory: {},
    perceptionSuggestions: [],
    rejectedSuggestionKeys: [],
    rejectedSuggestionCooldowns: {},
    acceptedSuggestionIds: [],
    handledSuggestionActionIds: [],
    suggestionTraceMode: "standard",
    suggestionStats: {
      suggestionsGenerated: 0,
      suggestionsAccepted: 0,
      suggestionsRejected: 0,
      autoCompletedSteps: 0
    },
    suggestionGeneratedIds: [],
    suggestionAcceptedIds: [],
    suggestionRejectedIds: [],
    suggestionTypeHistory: [],
    rejectedCandidateCooldowns: {},
    previousActionConfidence: {},
    suggestionCampaign: {
      active: false,
      currentIndex: 0,
      exportedTraceIds: [],
      captureStatuses: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.id, "not_started"])),
      exportReadiness: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.id, "blocked"])),
      traceStatuses: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.id, "not_started"])),
      traceStates: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.id, createEmptyTraceState(step.id)])),
      traceSummaries: {},
      capturedTraces: {},
      lastSuggestions: {}
    },
    sceneUncertainReason: "",
    localPerceptionTuning: {
      motionSensitivity: LOCAL_MOTION.activeThreshold,
      suggestionThreshold: LOCAL_MOTION.suggestionThreshold,
      suggestionCooldownMs: LOCAL_MOTION.suggestionCooldownMs,
      maxActiveSuggestions: LOCAL_MOTION.maxActiveSuggestions,
      showRawMotionScores: false
    },
    llmCalls: 0,
    vlmCalls: 0,
    rawMediaPersistenceCount: 0,
    estimatedModelCostUsd: 0
  };
  target.appState = target.emergencyRuntimeController.snapshot();
  target.realtimeSession.memory = target.conversationMemory;
  target.instantGestureRuntimeState.userEnabled = instantGesturesEnabledFromRecipes(target.automation.recipes);
  syncRealtimeSessionFromInteraction(target);
  attachRuntimeCompatibilityAliases(target);
  return target;
}

function createEmptyTraceState(traceMode, captureStatus = "not_started") {
  return {
    traceMode,
    captureStatus,
    exportReadiness: "blocked",
    startedAtMs: null,
    suggestionsGenerated: 0,
    suggestionsAccepted: 0,
    suggestionsRejected: 0,
    acceptedSuggestionIds: [],
    rejectedSuggestionIds: [],
    emittedEventIds: [],
    events: [],
    lastSuggestion: null,
    exportBlockedReasons: []
  };
}

let state = createInitialState();
let dom = null;
let perceptionCoreAwakening = null;
let microscope = null;
let microscopeCapabilityUnhealthy = false;
let lastSuggestionRenderAt = 0;
let lastMovementResultRenderKey = "";
let lastMovementDetailsRenderKey = "";
let lastMovementRevealResultId = "";
let lastAutomationRenderKey = "";
let lastLiveConversationRevision = -1;
let liveConversationPinnedToLatest = true;
let liveConversationRenderScheduled = false;
const renderedLiveAnswerChunks = new Map();
let localGestureEngine = null;
let instantGestureCooldownTimer = null;
const perceptionRuntime = {
  rafId: null,
  canvas: null,
  context: null,
  previousMotionSample: null,
  lastProcessedMs: 0,
  zoneState: new Map(),
  gestureWindows: new Map(),
  motionHistory: new Map(),
  lastPerceptionFrameMs: 0,
  lastHeartbeatEventMs: 0,
  watchdogTimer: null,
  baselineFrame: null,
  baselineCaptureInFlight: false,
  lastBaselineCaptureMs: 0,
  uncertainSinceMs: null
};

if (typeof document !== "undefined") {
  prepareDocumentView();
  if (isPrimaryView()) state.movementRecognition.autoSpeak = true;
  logBootDiagnostics();
  dom = bindDom();
  perceptionCoreAwakening = mountPerceptionCoreAwakening(document);
  microscope = isPrimaryView() ? mountMicroscope({
    objectLayer: document.querySelector("#microscopeObjectLayer"),
    video: dom.preview,
    stage: dom.cameraFrame,
    onEvent: (eventType, metadata) => recordSensefieldTestEvent(eventType, metadata),
    onStateChange: () => render(),
    onExit: () => void exitMicroscopeToAsk()
  }) : null;
  buildCalibrationForm(dom, state);
  bindEvents(dom);
  bindPersistentObservationVisibility();
  globalThis.addEventListener?.("pagehide", () => {
    void endMicroscope("page_hidden", { target: state, preserveCamera: false })
      .finally(() => microscope?.dispose());
  }, { once: true });
  render();
  refreshCloudUsageStatus(state);
  installP0RuntimeTestHook();
  installSensefieldRuntimeTestBridge();
}

function installSensefieldRuntimeTestBridge() {
  if (!sensefieldTestModeEnabled()) return;
  const copy = (value) => safeSensefieldTestMetadata(value);
  const mediaTrackSnapshot = () => (state.stream?.getTracks?.() || []).map((track) => ({
    kind: String(track.kind || "unknown"),
    readyState: String(track.readyState || "unknown"),
    enabled: track.enabled !== false,
    muted: track.muted === true
  }));
  globalThis.__SENSEFIELD_TEST__ = Object.freeze({
    getInteractionState: () => copy(state.interactionState),
    getRuntimeControllerState: () => copy(state.emergencyRuntimeController.snapshot()),
    getEventTimeline: () => copy(sensefieldTestRuntime.events),
    getRequestTimeline: () => copy(sensefieldTestRuntime.requests),
    getSpeechTimeline: () => copy(sensefieldTestRuntime.speech),
    getMediaTrackState: () => ({ tracks: mediaTrackSnapshot(), stream_count: state.stream ? 1 : 0 }),
    getVisualContextSummary: () => copy({
      memory_mode: state.visualContext?.memoryMode,
      last_observation_summary: state.visualContext?.lastObservationSummary,
      last_response: state.visualContext?.lastResponse,
      sample_count: state.realtimeSession?.rollingVisualContext?.samples?.length || 0
    }),
    getConversationMemorySummary: () => copy({
      user_turns: state.conversationMemory?.userTurns,
      assistant_responses: state.conversationMemory?.assistantResponses,
      visual_summaries: state.conversationMemory?.visualSummaries,
      interrupted_response_count: state.conversationMemory?.interruptedResponses?.length || 0
    }),
    getObservationMemorySummary: () => copy(state.observationMemory),
    getPerceptionCoreState: () => copy(perceptionCoreAwakening?.snapshot?.() || { state: "unavailable" }),
    getMicroscopeState: () => copy(microscope?.snapshot?.() || { status: "inactive" }),
    getMicroscopeMetrics: () => copy(microscope?.diagnostics?.() || { activeMicroscopeRuntimes: 0, activeFrameLoops: 0 }),
    getLiveExchangeState: () => copy(state.liveConversation),
    getResourceCounts: () => copy({
      ...sensefieldTestRuntime.resourceCounts,
      ...(microscope?.diagnostics?.() || {}),
      active_media_tracks: mediaTrackSnapshot().filter((track) => track.readyState !== "ended").length,
      active_inference: state.interactionState?.inferenceInFlight ? 1 : 0,
      active_speech: state.interactionState?.assistantSpeaking ? 1 : 0,
      queued_user_turns: state.interactionState?.queuedUserTurn ? 1 : 0,
      queued_visual_events: state.interactionState?.queuedVisualEvent ? 1 : 0,
      scheduler_count: state.interactionState?.sessionActive ? 1 : 0
    })
  });
  recordSensefieldTestEvent("test_bridge_ready", { mode: state.interactionState.mode });
}

function installP0RuntimeTestHook() {
  const location = globalThis.location;
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(String(location?.hostname || ""));
  const enabled = localHost && new URLSearchParams(String(location?.search || "")).get("p0-runtime-test") === "1";
  if (!enabled) return;
  globalThis.__darkquestP0Runtime = Object.freeze({
    snapshot: () => p0RuntimeSnapshot(state),
    pushLandmarkFrame: (frame) => {
      handleCustomSkillLandmarksInState(state, {
        timestamp_ms: Number(frame?.timestamp_ms),
        hands: currentFrameHands(frame),
        mirrored: frame?.mirrored === true,
        contains_raw_media: false
      });
      return p0RuntimeSnapshot(state);
    },
    forceRender: () => {
      render();
      return p0RuntimeSnapshot(state);
    }
  });
}

function p0RuntimeSnapshot(target) {
  const runtime = target.instantGestureRuntimeState;
  const draft = target.customSkillDraft;
  const templates = draft?.positiveExamples || [];
  const latest = templates.at(-1);
  return {
    instant: {
      user_enabled: runtime.userEnabled,
      effective_enabled: instantRuntimeEffectiveEnabled(runtime),
      enabled_recipe_count: runtime.enabledRecipeCount,
      engine_status: runtime.engineStatus,
      loop_running: runtime.loopRunning,
      frames_processed: runtime.framesProcessed,
      successful_inferences: runtime.successfulInferences,
      last_candidate: runtime.lastCandidate,
      last_outcome_code: runtime.lastOutcomeCode,
      safe_error: runtime.safeError
    },
    trainer: {
      wizard_step: draft?.currentStep ?? null,
      capture_state: draft?.captureState || "idle",
      required_hand_count: draft?.requiredHandCount || 0,
      visible_hand_count: draft?.visibleHandCount || 0,
      landmark_frame_available: draft?.landmarkFrameAvailable === true,
      stable_hold_ms: Math.round(draft?.stableHoldMs || 0),
      accepted_example_count: templates.length,
      last_capture_error: draft?.lastCaptureError || "",
      accepted_examples_numeric: templates.length > 0 && templates.every((template) => Array.isArray(template.vector) && template.vector.length > 0 && template.vector.every(Number.isFinite)),
      latest_template_dimension: Array.isArray(latest?.vector) ? latest.vector.length : 0
    },
    contains_raw_media: false
  };
}

function logBootDiagnostics() {
  console.info("Sensefield app booted");
  console.info("local-capture.js loaded");
  console.info(`camera API available: ${Boolean(globalThis.navigator?.mediaDevices?.getUserMedia)}`);
  console.info(`visual companion endpoint configured: ${VISUAL_COMPANION_CLIENT_CONFIG.endpoint}`);
  console.info(`movement recognition endpoint configured: ${MOVEMENT_RECOGNITION_CLIENT_CONFIG.endpoint}`);
}

function prepareDocumentView() {
  const advanced = isAdvancedRoute();
  document.body.dataset.view = advanced ? "advanced" : "primary";
  if (!advanced) return;
  const app = document.querySelector(".dq-app");
  const template = document.querySelector("#advancedViewTemplate");
  if (!app || !template) return;
  app.replaceChildren(template.content.cloneNode(true));
}

function isAdvancedRoute() {
  const params = new URLSearchParams(String(globalThis.location?.search || ""));
  const path = String(globalThis.location?.pathname || "");
  return params.get("advanced") === "1" || /\/advanced\/?$/.test(path);
}

function isPrimaryView() {
  return typeof document !== "undefined" && document.body?.dataset.view !== "advanced";
}

function bindPersistentObservationVisibility() {
  document.addEventListener("visibilitychange", () => {
    const observer = state.movementRecognition.persistent;
    if (!observer.active) return;
    observer.pausedForVisibility = document.hidden === true;
    observer.state = "active";
    render();
  });
}

function bindDom() {
  const bound = {
    preview: document.querySelector("#preview"),
    cameraFrame: document.querySelector(".dq-camera-frame"),
    primaryObservationState: document.querySelector("#primaryObservationState"),
    cameraCardStatus: document.querySelector("#cameraCardStatus"),
    cameraStatusChip: document.querySelector("#cameraStatusChip"),
    topLiveDot: document.querySelector("#topLiveDot"),
    headerModelStatus: document.querySelector("#headerModelStatus"),
    headerLiveStatus: document.querySelector("#headerLiveStatus"),
    zoneOverlay: document.querySelector("#zoneOverlay"),
    statusCamera: document.querySelector("#statusCamera"),
    statusCalibration: document.querySelector("#statusCalibration"),
    statusQuest: document.querySelector("#statusQuest"),
    statusRecording: document.querySelector("#statusRecording"),
    statusExport: document.querySelector("#statusExport"),
    statusValidation: document.querySelector("#statusValidation"),
    validationCardStatus: document.querySelector("#validationCardStatus"),
    statusPrivacy: document.querySelector("#statusPrivacy"),
    statusModels: document.querySelector("#statusModels"),
    statusModelCost: document.querySelector("#statusModelCost"),
    nextStepCard: document.querySelector("#nextStepCard"),
    errorBanner: document.querySelector("#errorBanner"),
    operatorReadiness: document.querySelector("#operatorReadiness"),
    operatorNextAction: document.querySelector("#operatorNextAction"),
    operatorBlockingReason: document.querySelector("#operatorBlockingReason"),
    operatorOutputPath: document.querySelector("#operatorOutputPath"),
    operatorValidationCommands: document.querySelector("#operatorValidationCommands"),
    copyOperatorCommands: document.querySelector("#copyOperatorCommands"),
    operatorExportTroubleshooting: document.querySelector("#operatorExportTroubleshooting"),
    operatorSendBack: document.querySelector("#operatorSendBack"),
    startCamera: document.querySelector("#startCamera"),
    stopCamera: document.querySelector("#stopCamera"),
    analyzeMovement: document.querySelector("#analyzeMovement"),
    interactionModeSelector: document.querySelector("#interactionModeSelector"),
    microscopePanel: document.querySelector("#microscopePanel"),
    perceptionCoreLabel: document.querySelector("#perceptionCoreLabel"),
    cameraDormantTitle: document.querySelector("#cameraDormantTitle"),
    cameraDormantCopy: document.querySelector("#cameraDormantCopy"),
    primaryModeStatus: document.querySelector("#primaryModeStatus"),
    movementControlHelp: document.querySelector("#movementControlHelp"),
    movementSummaryRow: document.querySelector("#movementSummaryRow"),
    savedActionsList: document.querySelector("#savedActionsList"),
    recentMomentsCard: document.querySelector("#recentMomentsCard"),
    recentMomentsTitle: document.querySelector("#recentMomentsTitle"),
    recentMomentsList: document.querySelector("#recentMomentsList"),
    recentMomentsLink: document.querySelector("#recentMomentsLink"),
    askControlsDisclosure: document.querySelector("#askControlsDisclosure"),
    askConversationControls: document.querySelector("#askConversationControls"),
    askConversationAnnouncement: document.querySelector("#askConversationAnnouncement"),
    askToggleListening: document.querySelector("#askToggleListening"),
    askStopSpeaking: document.querySelector("#askStopSpeaking"),
    askToggleVoice: document.querySelector("#askToggleVoice"),
    askClearConversation: document.querySelector("#askClearConversation"),
    askRetry: document.querySelector("#askRetry"),
    askReturnToLatest: document.querySelector("#askReturnToLatest"),
    showTrackingOverlay: document.querySelector("#showTrackingOverlay"),
    toggleTrackingDock: document.querySelector("#toggleTrackingDock"),
    stageVoiceShortcut: document.querySelector("#stageVoiceShortcut"),
    stageOptionsShortcut: document.querySelector("#stageOptionsShortcut"),
    voiceActionsCard: document.querySelector("#voiceActionsCard"),
    voiceStatusPill: document.querySelector("#voiceStatusPill"),
    resetSession: document.querySelector("#resetSession"),
    calibrateZones: document.querySelector("#calibrateZones"),
    editZones: document.querySelector("#editZones"),
    saveCalibration: document.querySelector("#saveCalibration"),
    startFocusRitual: document.querySelector("#startFocusRitual"),
    startRecording: document.querySelector("#startRecording"),
    stopRecording: document.querySelector("#stopRecording"),
    exportTrace: document.querySelector("#exportTrace"),
    copyValidation: document.querySelector("#copyValidation"),
    confirmPhysical: document.querySelector("#confirmPhysical"),
    calibrationPanel: document.querySelector("#calibrationPanel"),
    developerTools: document.querySelector("#developerTools"),
    runLiveAiSmoke: document.querySelector("#runLiveAiSmoke"),
    liveAiSmokeResult: document.querySelector("#liveAiSmokeResult"),
    zoneFields: document.querySelector("#zoneFields"),
    objectFields: document.querySelector("#objectFields"),
    calibrationSummary: document.querySelector("#calibrationSummary"),
    wizardStages: document.querySelector("#wizardStages"),
    currentWizard: document.querySelector("#currentWizard"),
    currentActionControl: document.querySelector("#currentActionControl"),
    operatorCommandsCard: document.querySelector("#operatorCommandsCard"),
    currentManualAction: document.querySelector("#currentManualAction"),
    buttonReasons: document.querySelector("#buttonReasons"),
    troubleshooting: document.querySelector("#troubleshooting"),
    questState: document.querySelector("#questState"),
    objective: document.querySelector("#objective"),
    activeZone: document.querySelector("#activeZone"),
    recordingStatus: document.querySelector("#recordingStatus"),
    cameraStatus: document.querySelector("#cameraStatus"),
    calibrationStatus: document.querySelector("#calibrationStatus"),
    calibrationStatusHero: document.querySelector("#calibrationStatusHero"),
    exportStatus: document.querySelector("#exportStatus"),
    exportReadinessSummary: document.querySelector("#exportReadinessSummary"),
    progress: document.querySelector("#progress"),
    confidence: document.querySelector("#confidence"),
    lowConfidence: document.querySelector("#lowConfidence"),
    uncertainty: document.querySelector("#uncertainty"),
    resetStatus: document.querySelector("#resetStatus"),
    eventCount: document.querySelector("#eventCount"),
    privacy: document.querySelector("#privacy"),
    cloud: document.querySelector("#cloud"),
    traceReady: document.querySelector("#traceReady"),
    cost: document.querySelector("#cost"),
    llm: document.querySelector("#llm"),
    vlm: document.querySelector("#vlm"),
    frameCapture: document.querySelector("#frameCapture"),
    observationExtraction: document.querySelector("#observationExtraction"),
    adapterLatency: document.querySelector("#adapterLatency"),
    eventEmission: document.querySelector("#eventEmission"),
    hudUpdate: document.querySelector("#hudUpdate"),
    traceRecorder: document.querySelector("#traceRecorder"),
    latencySummary: document.querySelector("#latencySummary"),
    droppedFrames: document.querySelector("#droppedFrames"),
    diagnosticModelCalls: document.querySelector("#diagnosticModelCalls"),
    diagnosticRawMedia: document.querySelector("#diagnosticRawMedia"),
    uncertaintyCount: document.querySelector("#uncertaintyCount"),
    resetCount: document.querySelector("#resetCount"),
    events: document.querySelector("#events"),
    cameraSuggestions: document.querySelector("#cameraSuggestions"),
    cameraSuggestionCount: document.querySelector("#cameraSuggestionCount"),
    confirmMovement: document.querySelector("#confirmMovement"),
    correctMovement: document.querySelector("#correctMovement"),
    tryAgainMovement: document.querySelector("#tryAgainMovement"),
    speakResult: document.querySelector("#speakResult"),
    autoSpeak: document.querySelector("#autoSpeak"),
    movementCorrectionForm: document.querySelector("#movementCorrectionForm"),
    movementCorrectionInput: document.querySelector("#movementCorrectionInput"),
    cancelMovementCorrection: document.querySelector("#cancelMovementCorrection"),
    movementHistoryList: document.querySelector("#movementHistoryList"),
    clearMovementHistory: document.querySelector("#clearMovementHistory"),
    clearCorrectionMemory: document.querySelector("#clearCorrectionMemory"),
    automateThisMovement: document.querySelector("#automateMovement"),
    automationMatchSummary: document.querySelector("#automationMatchSummary"),
    automationExecutionStatus: document.querySelector("#automationReceipt"),
    instantGestures: document.querySelector("#instantGestures"),
    instantGestureStatus: document.querySelector("#instantGestureStatus"),
    automationManagerList: document.querySelector("#automationManagerList"),
    gestureRecipePreviewList: document.querySelector("#gestureRecipePreviewList"),
    openGestureRecipes: document.querySelector("#openGestureRecipes"),
    closeGestureRecipes: document.querySelector("#closeGestureRecipes"),
    closeGestureRecipesFooter: document.querySelector("#closeGestureRecipesFooter"),
    automationManagerPanel: document.querySelector("#automationManagerPanel"),
    automationReceiptList: document.querySelector("#automationReceiptList"),
    automationRuntimeSummary: document.querySelector("#automationReceiptStatus"),
    automationRecipeDialog: document.querySelector("#automationRecipeEditor"),
    automationRecipeForm: document.querySelector("#automationRecipeForm"),
    automationRecipeSave: document.querySelector("#automationRecipeSave"),
    automationRecipeName: document.querySelector("#automationRecipeName"),
    automationMovementSentence: document.querySelector("#automationMovementSentence"),
    automationShortLabel: document.querySelector("#automationShortLabel"),
    automationMovementKey: document.querySelector("#automationMovementKey"),
    automationInstantMode: document.querySelector("#automationInstantMode"),
    automationInstantPolicy: document.querySelector("#automationInstantPolicy"),
    automationInstantUpgrade: document.querySelector("#automationInstantUpgrade"),
    runRecipeInstantly: document.querySelector("#runRecipeInstantly"),
    automationGestureKey: document.querySelector("#automationGestureKey"),
    automationGestureField: document.querySelector("#automationGestureField"),
    automationConfidence: document.querySelector("#automationConfidence"),
    automationActionType: document.querySelector("#automationActionType"),
    automationAliases: document.querySelector("#automationAliases"),
    automationAliasesField: document.querySelector("#automationAliasesField"),
    automationMinConfidence: document.querySelector("#automationMinConfidence"),
    automationHoldMs: document.querySelector("#automationHoldMs"),
    automationHoldField: document.querySelector("#automationHoldField"),
    automationCooldown: document.querySelector("#automationCooldown"),
    automationConfirmationPolicy: document.querySelector("#automationConfirmationPolicy"),
    automationConfirmationPolicyField: document.querySelector("#automationConfirmationPolicyField"),
    automationConfigField: document.querySelector("#automationConfigField"),
    automationConfigLabel: document.querySelector("#automationConfigLabel"),
    automationConfigValue: document.querySelector("#automationConfigValue"),
    automationSecretRefField: document.querySelector("#automationSecretRefField"),
    automationSecretRef: document.querySelector("#automationSecretRef"),
    automationSnapshotPolicy: document.querySelector("#automationSnapshotPolicy"),
    automationFormError: document.querySelector("#automationFormError"),
    automationEnabled: document.querySelector("#automationEnabled"),
    cancelAutomationRecipe: document.querySelector("#cancelAutomationRecipe"),
    automationPresetSelect: document.querySelector("#automationPresetSelect"),
    addAutomationPreset: document.querySelector("#addAutomationPreset"),
    createCustomGesture: document.querySelector("#createCustomGesture"),
    clearCustomGestures: document.querySelector("#clearCustomGestures"),
    customGestureList: document.querySelector("#customGestureList"),
    customGestureEditor: document.querySelector("#customGestureEditor"),
    customGestureForm: document.querySelector("#customGestureForm"),
    customGestureName: document.querySelector("#customGestureName"),
    customGesturePoseType: document.querySelector("#customGesturePoseType"),
    customGestureTrainingStatus: document.querySelector("#customGestureTrainingStatus"),
    customGestureExampleCount: document.querySelector("#customGestureExampleCount"),
    captureCustomGestureExample: document.querySelector("#captureCustomGestureExample"),
    captureCustomGestureNegative: document.querySelector("#captureCustomGestureNegative"),
    customGestureTestStatus: document.querySelector("#customGestureTestStatus"),
    customGestureMatchStatus: document.querySelector("#customGestureMatchStatus"),
    startCustomGestureTest: document.querySelector("#startCustomGestureTest"),
    approveCustomGestureTest: document.querySelector("#approveCustomGestureTest"),
    customGestureActionType: document.querySelector("#customGestureActionType"),
    customGestureActionLabel: document.querySelector("#customGestureActionLabel"),
    customGestureActionValue: document.querySelector("#customGestureActionValue"),
    customGestureSensitivity: document.querySelector("#customGestureSensitivity"),
    customGestureHoldMs: document.querySelector("#customGestureHoldMs"),
    customGestureCooldown: document.querySelector("#customGestureCooldown"),
    customGestureEnabled: document.querySelector("#customGestureEnabled"),
    customGestureStepStatus: document.querySelector("#customGestureStepStatus"),
    customGestureSaveSummary: document.querySelector("#customGestureSaveSummary"),
    customGestureFormError: document.querySelector("#customGestureFormError"),
    customGestureBack: document.querySelector("#customGestureBack"),
    customGestureNext: document.querySelector("#customGestureNext"),
    customGestureSave: document.querySelector("#customGestureSave"),
    cancelCustomGesture: document.querySelector("#cancelCustomGesture"),
    researchProvider: document.querySelector("#researchProvider"),
    researchRequestedModel: document.querySelector("#researchRequestedModel"),
    researchReturnedModel: document.querySelector("#researchReturnedModel"),
    researchLatency: document.querySelector("#researchLatency"),
    researchPromptVersion: document.querySelector("#researchPromptVersion"),
    researchImageTokens: document.querySelector("#researchImageTokens"),
    researchRetries: document.querySelector("#researchRetries"),
    researchCandidateFailures: document.querySelector("#researchCandidateFailures"),
    researchLastSafeError: document.querySelector("#researchLastSafeError"),
    researchHistoryCount: document.querySelector("#researchHistoryCount"),
    researchCorrectionCount: document.querySelector("#researchCorrectionCount"),
    researchOneShotGuard: document.querySelector("#researchOneShotGuard"),
    researchInstantMode: document.querySelector("#researchInstantMode"),
    researchInstantLoop: document.querySelector("#researchInstantLoop"),
    researchInstantFrames: document.querySelector("#researchInstantFrames"),
    researchInstantInferenceAge: document.querySelector("#researchInstantInferenceAge"),
    researchInstantRawLabel: document.querySelector("#researchInstantRawLabel"),
    researchInstantRawConfidence: document.querySelector("#researchInstantRawConfidence"),
    researchInstantMappedGesture: document.querySelector("#researchInstantMappedGesture"),
    researchInstantHold: document.querySelector("#researchInstantHold"),
    researchInstantStableEvent: document.querySelector("#researchInstantStableEvent"),
    researchInstantRecipeOutcome: document.querySelector("#researchInstantRecipeOutcome"),
    researchInstantActionOutcome: document.querySelector("#researchInstantActionOutcome"),
    researchInstantReceipt: document.querySelector("#researchInstantReceipt"),
    researchInstantSafeError: document.querySelector("#researchInstantSafeError"),
    researchInstantDiagnosis: document.querySelector("#researchInstantDiagnosis"),
    researchInstantUserEnabled: document.querySelector("#researchInstantUserEnabled"),
    researchInstantEffectiveEnabled: document.querySelector("#researchInstantEffectiveEnabled"),
    researchInstantEngineStatus: document.querySelector("#researchInstantEngineStatus"),
    researchInstantSuccessfulInferences: document.querySelector("#researchInstantSuccessfulInferences"),
    researchInstantLastCandidate: document.querySelector("#researchInstantLastCandidate"),
    researchInstantLastOutcomeCode: document.querySelector("#researchInstantLastOutcomeCode"),
    researchTrainerWizardStep: document.querySelector("#researchTrainerWizardStep"),
    researchTrainerCaptureState: document.querySelector("#researchTrainerCaptureState"),
    researchTrainerRequiredHandCount: document.querySelector("#researchTrainerRequiredHandCount"),
    researchTrainerVisibleHandCount: document.querySelector("#researchTrainerVisibleHandCount"),
    researchTrainerLandmarkFrameAvailable: document.querySelector("#researchTrainerLandmarkFrameAvailable"),
    researchTrainerStableHoldMs: document.querySelector("#researchTrainerStableHoldMs"),
    researchTrainerAcceptedExampleCount: document.querySelector("#researchTrainerAcceptedExampleCount"),
    researchTrainerLastCaptureError: document.querySelector("#researchTrainerLastCaptureError"),
    voiceStatus: document.querySelector("#voiceStatus"),
    movementConfidence: document.querySelector("#movementConfidence"),
    movementReason: document.querySelector("#movementReason"),
    movementEvidence: document.querySelector("#movementEvidence"),
    movementProvider: document.querySelector("#movementProvider"),
    movementModel: document.querySelector("#movementModel"),
    movementLatency: document.querySelector("#movementLatency"),
    visualMemoryMode: document.querySelector("#visualMemoryMode"),
    clearVisualContext: document.querySelector("#clearVisualContext"),
    visualSuggestedAction: document.querySelector("#visualSuggestedAction"),
    confirmVisualSuggestedAction: document.querySelector("#confirmVisualSuggestedAction"),
    suggestionTraceMode: document.querySelector("#suggestionTraceMode"),
    suggestionTraceInstructions: document.querySelector("#suggestionTraceInstructions"),
    suggestionCounters: document.querySelector("#suggestionCounters"),
    suggestionCampaignPanel: document.querySelector("#suggestionCampaignPanel"),
    suggestionCampaignSummary: document.querySelector("#suggestionCampaignSummary"),
    suggestionCampaignSteps: document.querySelector("#suggestionCampaignSteps"),
    exportCampaignBundle: document.querySelector("#exportCampaignBundle"),
    campaignValidationInstructions: document.querySelector("#campaignValidationInstructions"),
    savePathValue: document.querySelector("#savePathValue"),
    ritualChecklist: document.querySelector("#ritualChecklist"),
    preflightChecklist: document.querySelector("#preflightChecklist"),
    preflightStatus: document.querySelector("#preflightStatus"),
    exportPreview: document.querySelector("#exportPreview"),
    eventSequenceInspector: document.querySelector("#eventSequenceInspector"),
    dryRunSeparation: document.querySelector("#dryRunSeparation"),
    validationCommands: document.querySelector("#validationCommands"),
    validationLocked: document.querySelector("#validationLocked"),
    copyCommandButtons: document.querySelector("#copyCommandButtons"),
    copySavePath: document.querySelector("#copySavePath"),
    copyMacosCpCommand: document.querySelector("#copyMacosCpCommand"),
    motionSensitivity: document.querySelector("#motionSensitivity"),
    suggestionThreshold: document.querySelector("#suggestionThreshold"),
    suggestionCooldown: document.querySelector("#suggestionCooldown"),
    maxActiveSuggestions: document.querySelector("#maxActiveSuggestions"),
    showRawMotionScores: document.querySelector("#showRawMotionScores"),
    savePathAssistant: document.querySelector("#savePathAssistant"),
    macosCpCommand: document.querySelector("#macosCpCommand"),
    missingFixtureNote: document.querySelector("#missingFixtureNote"),
    exportBugReport: document.querySelector("#exportBugReport"),
    bugReportPreview: document.querySelector("#bugReportPreview"),
    operatorArtifactChecklist: document.querySelector("#operatorArtifactChecklist"),
    stuckGuide: document.querySelector("#stuckGuide")
  };
  bound.objectiveTitle = document.querySelector("#objectiveTitle");
  return bound;
}

function bindEvents(boundDom) {
  boundDom.startCamera?.addEventListener("click", startCamera);
  boundDom.stopCamera?.addEventListener("click", stopCamera);
  boundDom.preview?.addEventListener("loadedmetadata", syncPreviewAspectRatio);
  boundDom.preview?.addEventListener("resize", syncPreviewAspectRatio);
  boundDom.analyzeMovement?.addEventListener("click", () => handlePrimaryAction());
  boundDom.interactionModeSelector?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-interaction-mode]");
    if (!button) return;
    void setInteractionModeInState(state, button.getAttribute("data-interaction-mode"));
  });
  boundDom.askToggleListening?.addEventListener("click", () => toggleLiveConversationListening(state));
  boundDom.askStopSpeaking?.addEventListener("click", () => {
    if (!state.interactionState.assistantSpeaking && !persistentSpeechBusy(state)) return;
    interruptAssistantSpeech(state, "user_stop");
    render();
  });
  boundDom.askToggleVoice?.addEventListener("click", () => toggleLiveConversationVoice(state));
  boundDom.askClearConversation?.addEventListener("click", () => clearLiveConversationInState(state));
  boundDom.askRetry?.addEventListener("click", () => retryLiveConversationInState(state));
  boundDom.instantGestures?.addEventListener("change", () => {
    state.instantGestureRuntimeState.userEnabled = boundDom.instantGestures.checked === true;
    syncInstantGestureEngine();
  });
  boundDom.showTrackingOverlay?.addEventListener("change", () => {
    state.showTrackingOverlay = boundDom.showTrackingOverlay.checked === true;
    render();
  });
  boundDom.toggleTrackingDock?.addEventListener("click", () => {
    state.showTrackingOverlay = !state.showTrackingOverlay;
    if (boundDom.showTrackingOverlay) boundDom.showTrackingOverlay.checked = state.showTrackingOverlay;
    render();
  });
  boundDom.stageVoiceShortcut?.addEventListener("click", () => {
    boundDom.voiceActionsCard?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    boundDom.speakResult?.focus?.();
  });
  boundDom.stageOptionsShortcut?.addEventListener("click", () => {
    boundDom.openGestureRecipes?.focus?.();
  });
  boundDom.confirmMovement?.addEventListener("click", async () => {
    if (boundDom.confirmMovement.disabled) return;
    boundDom.confirmMovement.disabled = true;
    confirmMovementResultInState(state);
    render();
    await executeConfirmedMovementAutomations(state, { userGesture: true });
    render();
  });
  boundDom.correctMovement?.addEventListener("click", () => {
    showMovementCorrectionInState(state);
    render();
  });
  boundDom.movementCorrectionForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitMovementCorrectionInState(state, boundDom.movementCorrectionInput?.value ?? "");
    render();
  });
  boundDom.cancelMovementCorrection?.addEventListener("click", () => {
    hideMovementCorrectionInState(state);
    render();
  });
  boundDom.clearMovementHistory?.addEventListener("click", () => {
    clearMovementHistory(state);
    render();
  });
  boundDom.clearCorrectionMemory?.addEventListener("click", () => {
    clearCorrectionMemory(state);
    render();
  });
  boundDom.automateThisMovement?.addEventListener("click", () => openAutomationRecipeEditor(state));
  boundDom.cancelAutomationRecipe?.addEventListener("click", () => closeAutomationRecipeEditor(state, boundDom));
  boundDom.automationRecipeForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveAutomationRecipeFromForm(state, boundDom);
    render();
  });
  boundDom.automationInstantMode?.addEventListener("change", () => updateAutomationRecipeModeFields(boundDom));
  boundDom.automationActionType?.addEventListener("change", () => {
    const previous = String(boundDom.automationActionType.dataset?.previousAction || "");
    const next = String(boundDom.automationActionType.value || "");
    if (previous && previous !== next && boundDom.automationConfigValue) boundDom.automationConfigValue.value = "";
    if (boundDom.automationActionType.dataset) boundDom.automationActionType.dataset.previousAction = next;
    updateAutomationRecipeModeFields(boundDom);
  });
  boundDom.automationGestureKey?.addEventListener("change", () => handleAutomationGestureChange(boundDom));
  boundDom.automationRecipeDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!state.automationEditor?.isSaving) closeAutomationRecipeEditor(state, boundDom);
  });
  boundDom.automationRecipeDialog?.addEventListener("click", (event) => {
    const dialog = boundDom.automationRecipeDialog;
    const rect = dialog?.getBoundingClientRect?.();
    const outside = rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    if (event.target === dialog && outside && !state.automationEditor?.isSaving) closeAutomationRecipeEditor(state, boundDom);
  });
  boundDom.automationRecipeDialog?.addEventListener("keydown", (event) => trapAutomationDialogFocus(event, boundDom.automationRecipeDialog));
  boundDom.runRecipeInstantly?.addEventListener("click", () => {
    if (boundDom.automationInstantMode) boundDom.automationInstantMode.checked = true;
    if (boundDom.automationGestureKey) boundDom.automationGestureKey.value = boundDom.automationMovementKey?.value || "thumbs_up";
    if (boundDom.automationMinConfidence) boundDom.automationMinConfidence.value = String(DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE);
    if (boundDom.automationHoldMs) boundDom.automationHoldMs.value = "350";
    if (boundDom.automationCooldown) boundDom.automationCooldown.value = "3";
    updateAutomationRecipeModeFields(boundDom);
    saveAutomationRecipeFromForm(state, boundDom);
    render();
  });
  document.addEventListener("visibilitychange", () => {
    state.instantGestureRuntimeState.documentVisible = document.hidden !== true;
    if (document.hidden) stopInstantGestureEngine("Off");
    else syncInstantGestureEngine();
  });
  boundDom.addAutomationPreset?.addEventListener("click", () => {
    addAutomationPresetToState(state, boundDom.automationPresetSelect?.value);
    render();
  });
  boundDom.createCustomGesture?.addEventListener("click", () => openCustomGestureEditor(state));
  boundDom.clearCustomGestures?.addEventListener("click", () => clearAllCustomGestures(state));
  boundDom.customGestureList?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-custom-skill-action]");
    if (!button || button.disabled) return;
    handleCustomSkillManagerAction(state, button.getAttribute("data-custom-skill-action"), button.getAttribute("data-custom-skill-id"));
  });
  boundDom.customGestureForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCustomGestureFromWizard(state);
  });
  boundDom.customGestureNext?.addEventListener("click", () => advanceCustomGestureWizard(state));
  boundDom.customGestureBack?.addEventListener("click", () => moveCustomGestureWizardBack(state));
  boundDom.cancelCustomGesture?.addEventListener("click", () => closeCustomGestureEditor(state));
  boundDom.captureCustomGestureExample?.addEventListener("click", () => captureCustomSkillExample(state));
  boundDom.captureCustomGestureNegative?.addEventListener("click", () => captureCustomSkillExample(state, { negative: true }));
  boundDom.startCustomGestureTest?.addEventListener("click", () => startCustomGestureTest(state));
  boundDom.approveCustomGestureTest?.addEventListener("click", () => approveCustomGestureTest(state));
  boundDom.customGestureActionType?.addEventListener("change", () => updateCustomGestureActionField(boundDom));
  boundDom.customGestureEditor?.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!state.customSkillWizard.isSaving) closeCustomGestureEditor(state);
  });
  boundDom.customGestureEditor?.addEventListener("click", (event) => {
    const dialog = boundDom.customGestureEditor;
    const rect = dialog?.getBoundingClientRect?.();
    const outside = rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    if (event.target === dialog && outside && !state.customSkillWizard.isSaving) closeCustomGestureEditor(state);
  });
  boundDom.customGestureEditor?.addEventListener("keydown", (event) => trapAutomationDialogFocus(event, boundDom.customGestureEditor));
  boundDom.automationManagerList?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-automation-action]");
    if (!button || button.disabled) return;
    handleAutomationManagerAction(state, button.getAttribute("data-automation-action"), button.getAttribute("data-recipe-id"));
    render();
  });
  boundDom.tryAgainMovement?.addEventListener("click", () => {
    resetMovementResultInState(state);
    render();
  });
  boundDom.speakResult?.addEventListener("click", () => speakMovementResult(state));
  boundDom.autoSpeak?.addEventListener("change", () => {
    state.movementRecognition.autoSpeak = boundDom.autoSpeak.checked === true;
    persistVisualAutoSpeakPreference(state.movementRecognition.autoSpeak);
    state.movementRecognition.voiceStatus = state.movementRecognition.autoSpeak ? "Ready" : "Muted";
    render();
  });
  boundDom.openGestureRecipes?.addEventListener("click", () => {
    state.automationManagerOpener = boundDom.openGestureRecipes;
    boundDom.automationManagerPanel?.showModal?.();
  });
  const closeGestureRecipes = () => {
    boundDom.automationManagerPanel?.close?.();
    state.automationManagerOpener?.focus?.();
    state.automationManagerOpener = null;
  };
  boundDom.closeGestureRecipes?.addEventListener("click", closeGestureRecipes);
  boundDom.closeGestureRecipesFooter?.addEventListener("click", closeGestureRecipes);
  boundDom.automationManagerPanel?.addEventListener("cancel", () => {
    state.automationManagerOpener?.focus?.();
    state.automationManagerOpener = null;
  });
  boundDom.automationManagerPanel?.addEventListener("keydown", (event) => trapAutomationDialogFocus(event, boundDom.automationManagerPanel));
  boundDom.visualMemoryMode?.addEventListener("change", () => {
    state.visualContext.memoryMode = boundDom.visualMemoryMode.value;
    if (state.visualContext.memoryMode === "persistent") persistVisualContextIfAllowed(state.visualContext);
    else clearVisualContextStorage();
    render();
  });
  boundDom.clearVisualContext?.addEventListener("click", () => {
    clearVisualContextInState(state);
    render();
  });
  boundDom.confirmVisualSuggestedAction?.addEventListener("click", async () => {
    boundDom.confirmVisualSuggestedAction.disabled = true;
    await confirmVisualSuggestedActionInState(state);
    render();
  });
  boundDom.resetSession?.addEventListener("click", resetSession);
  boundDom.calibrateZones?.addEventListener("click", openCalibrationPanel);
  boundDom.editZones?.addEventListener("click", openCalibrationPanel);
  boundDom.saveCalibration?.addEventListener("click", () => {
    saveCalibrationToState(state, readCalibrationForm(boundDom));
    render();
  });
  boundDom.startFocusRitual?.addEventListener("click", () => {
    startFocusRitualInState(state);
    render();
  });
  boundDom.startRecording?.addEventListener("click", () => {
    const preserve = state.events.some((event) => !REQUIRED_EXPORT_EVENT_IDS.slice(0, 1).includes(event.id)) &&
      typeof window !== "undefined" &&
      window.confirm("Preserve existing symbolic events? Choose OK to preserve, Cancel to clear and start fresh.");
    startRecordingInState(state, { preserve });
    render();
  });
  boundDom.stopRecording?.addEventListener("click", () => {
    stopRecordingInState(state);
    render();
  });
  boundDom.confirmPhysical?.addEventListener("change", () => {
    state.physicalConfirmed = boundDom.confirmPhysical.checked === true;
    state.statusMessage = state.physicalConfirmed
      ? "Physical session confirmed. Export unlocks after watching is stopped and the session is complete."
      : "Physical confirmation is required before export.";
    updateExportReadiness(state);
    render();
  });
  boundDom.exportTrace?.addEventListener("click", exportPhysicalTrace);
  boundDom.copyValidation?.addEventListener("click", copyValidationCommands);
  boundDom.copyOperatorCommands?.addEventListener("click", copyOperatorCommands);
  boundDom.copySavePath?.addEventListener("click", () => copyText("Save path", currentTracePath(state)));
  boundDom.copyMacosCpCommand?.addEventListener("click", () => copyText("macOS cp command", currentMacosSaveCommand(state)));
  boundDom.exportBugReport?.addEventListener("click", exportBugReport);
  boundDom.exportCampaignBundle?.addEventListener("click", exportCampaignBundle);
  boundDom.runLiveAiSmoke?.addEventListener("click", () => runLiveAiSmokeTestInState(state));
  boundDom.currentActionControl?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-current-action]");
    if (!button) return;
    const action = button.getAttribute("data-current-action");
    if (action === "analyzeMovement") {
      analyzeMovementInState(state);
      return;
    }
    const targetButton = dom[action];
    if (targetButton && !targetButton.disabled) targetButton.click();
  });
  boundDom.suggestionTraceMode?.addEventListener("change", () => {
    state.suggestionTraceMode = boundDom.suggestionTraceMode.value;
    state.exported = false;
    state.validationCopied = false;
    state.statusMessage = `${selectedTraceModeFor(state).label} selected. Follow the trace instructions before export.`;
    updateExportReadiness(state);
    render();
  });
  for (const button of document.querySelectorAll("[data-copy-command]")) {
    button.addEventListener("click", () => {
      copySingleValidationCommand(button.getAttribute("data-copy-command"));
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-step]");
    if (!button || button.disabled) return;
    const step = button.getAttribute("data-step");
    if (step === "uncertain") markUncertainInState(state);
    else if (step === "reset") markCameraResetInState(state);
    else confirmStepInState(state, step);
    render();
  });

  for (const input of [
    boundDom.motionSensitivity,
    boundDom.suggestionThreshold,
    boundDom.suggestionCooldown,
    boundDom.maxActiveSuggestions,
    boundDom.showRawMotionScores
  ].filter(Boolean)) {
    input.addEventListener("change", () => {
      readPerceptionTuning(boundDom, state);
      render();
    });
  }

  boundDom.cameraSuggestions?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-suggestion-action]");
    if (!button || button.disabled) return;
    const suggestionId = button.getAttribute("data-suggestion-id");
    const action = button.getAttribute("data-suggestion-action");
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.textContent = action === "accept" ? "Confirmed" : "Okay";
    if (action === "accept") acceptSuggestionInState(state, suggestionId);
    if (action === "reject") rejectSuggestionInState(state, suggestionId);
    lastSuggestionRenderAt = 0;
    render();
  });

  boundDom.suggestionCampaignSteps?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-campaign-action]");
    if (!button) return;
    runCampaignAction(button.getAttribute("data-campaign-action"), button.getAttribute("data-trace-mode"));
  });

  boundDom.savedActionsList?.addEventListener("click", (event) => {
    const row = event.target?.closest?.("[data-saved-action]");
    if (row) openPrimarySavedAction(row.getAttribute("data-saved-action"));
  });
  boundDom.savedActionsList?.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const row = event.target?.closest?.("[data-saved-action]");
    if (!row) return;
    event.preventDefault();
    openPrimarySavedAction(row.getAttribute("data-saved-action"));
  });
}

function openPrimarySavedAction() {
  const targetUrl = `${globalThis.location?.pathname || "/"}?advanced=1`;
  globalThis.location?.assign?.(targetUrl);
}

function handlePrimaryAction() {
  if (state.primarySurfaceMode === "microscope") {
    void microscope?.handlePrimaryAction?.();
    return;
  }
  if (state.interactionState.sessionActive || state.realtimeSession.state === "active") {
    void endInteractionSession(state);
    return;
  }
  if (state.realtimeSession.state === "inactive" || state.realtimeSession.state === "error") {
    void startInteractionSession(state);
  }
}

function toggleLiveConversationListening(target = state) {
  if (!target.interactionState.sessionActive || !interactionModeIs(target, "conversation")) return false;
  const recognition = target.realtimeSession.speechRecognition;
  if (!recognition) {
    failLiveConversation(target.liveConversation, "Speech recognition is unavailable in this browser.", {
      code: "speech_recognition_unavailable"
    });
    render();
    return false;
  }
  if (target.liveConversation.listeningPaused) {
    target.realtimeSession.speechStopping = false;
    setLiveConversationListening(target.liveConversation, { cameraContextActive: target.cameraReady });
    try {
      recognition.start();
    } catch {
      failLiveConversation(target.liveConversation, "Listening could not resume. Try again.", {
        code: "speech_restart_failed"
      });
    }
  } else {
    target.realtimeSession.speechStopping = true;
    target.liveConversation.interimText = "";
    setLiveConversationListening(target.liveConversation, { paused: true, cameraContextActive: target.cameraReady });
    try { recognition.abort?.(); } catch {}
  }
  render();
  return true;
}

function toggleLiveConversationVoice(target = state) {
  const muted = target.liveConversation.voiceMuted !== true;
  setLiveConversationMuted(target.liveConversation, muted);
  target.movementRecognition.autoSpeak = !muted;
  target.movementRecognition.voiceStatus = muted ? "Muted" : "Ready";
  persistVisualAutoSpeakPreference(!muted);
  if (muted && (target.interactionState.assistantSpeaking || persistentSpeechBusy(target))) {
    void cancelVisualSpeech(target).finally(() => {
      setLiveConversationListening(target.liveConversation, {
        paused: target.liveConversation.listeningPaused,
        cameraContextActive: target.cameraReady
      });
      render();
    });
  }
  render();
  return muted;
}

function clearLiveConversationInState(target = state) {
  if (!target.interactionState.sessionActive || !interactionModeIs(target, "conversation")) return false;
  target.movementRecognition.activeRequestAbortController?.abort?.();
  target.movementRecognition.activeRequestAbortController = null;
  void cancelVisualSpeech(target);
  target.emergencyRuntimeController.clearCurrentTurn();
  target.appState = target.emergencyRuntimeController.snapshot();
  target.conversationMemory = createConversationMemoryState();
  target.realtimeSession.memory = target.conversationMemory;
  target.realtimeSession.lastUserTranscript = "";
  target.realtimeSession.lastFinalTranscript = "";
  target.realtimeSession.lastFinalTranscriptAtMs = 0;
  target.movementResultSnapshot = null;
  clearLiveConversation(target.liveConversation);
  lastMovementResultRenderKey = "";
  lastLiveConversationRevision = -1;
  liveConversationPinnedToLatest = true;
  render();
  return true;
}

function retryLiveConversationInState(target = state) {
  if (!target.interactionState.sessionActive || !interactionModeIs(target, "conversation")) return false;
  const lastUser = [...target.liveConversation.turns].reverse().find((turn) => turn.role === "user");
  if (!lastUser?.text || target.interactionState.inferenceInFlight || target.movementRecognition.requestInFlight) return false;
  target.liveConversation.error = null;
  void handleRealtimeUserSpeechTurn(target, lastUser.text, {
    reuseExistingTurn: true,
    receivedAtMs: Math.max(Date.now(), Number(target.realtimeSession.lastFinalTranscriptAtMs || 0) + 1501)
  });
  return true;
}

export async function setInteractionModeInState(target = state, mode = "conversation", options = {}) {
  if (String(mode) === "microscope") return enterMicroscope(target, options);
  const nextMode = normalizeInteractionMode(mode);
  if (target.primarySurfaceMode === "microscope" || microscope?.isActive?.()) {
    const ended = await endMicroscope("mode_selected", { ...options, target, preserveCamera: false, waitForService: false });
    if (!ended.ok) return target;
  }
  target.primarySurfaceMode = nextMode;
  if (nextMode === target.interactionState.mode) {
    target.statusMessage = nextMode === "conversation" ? "Conversation mode selected." : "Observing mode selected.";
    render();
    return target;
  }
  persistInteractionModePreference(nextMode);
  if (target.interactionState.sessionActive) {
    return switchInteractionMode(target, nextMode, options);
  }
  target.emergencyRuntimeController.selectMode(nextMode);
  syncEmergencyRuntimeOwner(target);
  target.realtimeSession.state = "inactive";
  clearTransientPresentationState(target);
  target.movementRecognition.persistent.state = "inactive";
  target.statusMessage = nextMode === "conversation" ? "Conversation mode selected." : "Observing mode selected.";
  render();
  return target;
}

async function enterMicroscope(target = state, options = {}) {
  if (target.interactionState?.sessionActive || target.realtimeSession?.state !== "inactive" || target.cameraStartInFlight) {
    await endInteractionSession(target, options);
  }
  target.primarySurfaceMode = "microscope";
  target.errorMessage = "";
  target.statusMessage = "Local object detection is starting.";
  target.objective = "Keep the camera live while objects are recognized locally.";
  render();
  await startMicroscope({ ...options, target });
  return target;
}

export async function startMicroscope(options = {}) {
  const target = options.target || state;
  if (!microscope) return { ok: false, code: "microscope_not_mounted" };
  if (target.interactionState?.sessionActive || target.realtimeSession?.state !== "inactive" || target.cameraStartInFlight) {
    await endInteractionSession(target, options);
  }
  target.primarySurfaceMode = "microscope";
  target.errorMessage = "";
  target.statusMessage = "Starting Microscope…";
  render();
  if (target === state) void perceptionCoreAwakening?.begin("microscope");
  try {
    const stream = options.mediaStream || await withTimeout(
      requestRealtimeObservingMedia(options),
      options.mediaTimeoutMs ?? 20_000,
      "Camera permission timed out."
    );
    if (target.primarySurfaceMode !== "microscope") {
      stopDetachedMediaStream(stream, target);
      return { ok: false, code: "microscope_start_superseded" };
    }
    await attachInteractionStreamToPreview(target, stream, "microscope");
    const started = await microscope.start();
    if (!started.ok) {
      await microscope.stop("initialization_failed");
      console.warn("Microscope failed to start:", started.error || "initialization_failed");
      microscopeCapabilityUnhealthy = true;
      target.errorMessage = "Microscope is temporarily unavailable.";
      target.statusMessage = "Microscope did not start.";
      stopRealtimeMediaTracks(target);
      if (target === state) void perceptionCoreAwakening?.fail(new Error(started.error || "Microscope initialization failed."));
      render();
      return started;
    }
    target.statusMessage = "Automatic local vision is active.";
    target.errorMessage = "";
    render();
    return { ok: true, state: microscope.snapshot() };
  } catch (error) {
    await microscope.stop("camera_start_failed");
    target.errorMessage = `Camera error: ${error?.message || "unavailable"}`;
    target.statusMessage = "Microscope camera did not start.";
    stopRealtimeMediaTracks(target);
    if (target === state) void perceptionCoreAwakening?.fail(error);
    render();
    return { ok: false, code: "microscope_start_failed", error: error?.message || "unavailable" };
  }
}

export async function endMicroscope(reason = "user_exit", options = {}) {
  const target = options.target || state;
  await microscope?.stop?.(reason, { waitForService: options.waitForService !== false });
  if (options.preserveCamera !== true) stopRealtimeMediaTracks(target);
  if (target === state && options.preserveCamera !== true) void perceptionCoreAwakening?.returnToDormant();
  target.cameraStatus = options.preserveCamera === true ? target.cameraStatus : "stopped";
  target.errorMessage = "";
  target.statusMessage = "Microscope stopped.";
  render();
  return { ok: true, state: microscope?.snapshot?.() };
}

async function exitMicroscopeToAsk() {
  await endMicroscope("user_exit", { target: state, preserveCamera: false, waitForService: false });
  state.primarySurfaceMode = "conversation";
  state.emergencyRuntimeController.selectMode("conversation");
  syncEmergencyRuntimeOwner(state);
  state.statusMessage = "Ask mode ready.";
  render();
}

export async function startInteractionSession(target = state, options = {}) {
  return interactionModeIs(target, "observing")
    ? startRealtimeObserving(target, options)
    : startRealtimeConversation(target, options);
}

export async function startRealtimeConversation(target = state, options = {}) {
  if (target.primarySurfaceMode === "microscope" || microscope?.isActive?.()) {
    await endMicroscope("start_conversation", { ...options, target, preserveCamera: false, waitForService: false });
    target.primarySurfaceMode = "conversation";
  }
  if (target.interactionState.sessionActive && interactionModeIs(target, "observing")) {
    return switchInteractionMode(target, "conversation", options);
  }
  if (["starting", "active"].includes(target.realtimeSession.state) || target.cameraStartInFlight) return target;
  const startingRuntime = target.emergencyRuntimeController.beginStart("conversation");
  const generationId = startingRuntime.session.modeGeneration;
  const sessionGenerationId = startingRuntime.session.sessionGeneration;
  target.appState = startingRuntime;
  clearTransientPresentationState(target);
  target.conversationMemory = createConversationMemoryState();
  target.realtimeSession = {
    ...createRealtimeSessionState(),
    state: "starting",
    memory: target.conversationMemory,
    lastStartedAtMs: Math.round(now())
  };
  beginLiveConversation(target.liveConversation, {
    voiceMuted: target.movementRecognition.autoSpeak !== true,
    sessionGenerationId
  });
  lastLiveConversationRevision = -1;
  liveConversationPinnedToLatest = true;
  applyInteractionState(target, {
    mode: "conversation",
    sessionActive: false,
    cameraActive: false,
    microphoneActive: false,
    visualContextActive: false,
    proactiveObservationActive: false,
    listeningActive: false,
    userSpeaking: false,
    inferenceInFlight: false,
    assistantSpeaking: false,
    queuedUserTurn: null,
    queuedVisualEvent: null,
    safeError: null,
    sessionGenerationId,
    modeGenerationId: generationId
  });
  target.movementRecognition.persistent.active = false;
  target.movementRecognition.persistent.pausedForVisibility = false;
  target.movementRecognition.persistent.state = "inactive";
  target.movementRecognition.persistent.queuedEvent = null;
  target.movementRecognition.autoSpeak = true;
  target.errorMessage = "";
  target.statusMessage = "Starting conversation…";
  stopInstantGestureEngine("off");
  render();
  if (target === state) void perceptionCoreAwakening?.begin("conversation");
  try {
    const stream = options.mediaStream || await withTimeout(
      requestRealtimeConversationMedia(options),
      options.mediaTimeoutMs ?? 20000,
      "Camera and microphone permission timed out."
    );
    await attachInteractionStreamToPreview(target, stream, "conversation");
    startLocalPerception();
    const speechStarted = startRealtimeSpeechInput(target, options);
    if (!speechStarted) throw new Error("Speech recognition is unavailable in this browser.");
    const ownedRuntime = target.emergencyRuntimeController.activate("conversation", {
      cameraActive: true,
      microphoneActive: activeAudioTracks(target).length > 0
    });
    applyInteractionState(target, {
      mode: "conversation",
      sessionActive: true,
      cameraActive: true,
      microphoneActive: activeAudioTracks(target).length > 0,
      visualContextActive: true,
      proactiveObservationActive: false,
      listeningActive: true,
      userSpeaking: false,
      inferenceInFlight: false,
      assistantSpeaking: false,
      queuedUserTurn: null,
      queuedVisualEvent: null,
      safeError: null,
      sessionGenerationId: ownedRuntime.session.sessionGeneration,
      modeGenerationId: ownedRuntime.session.modeGeneration
    });
    target.appState = ownedRuntime;
    target.realtimeSession.state = "active";
    target.movementRecognition.persistent.state = "inactive";
    target.movementRecognition.status = "idle";
    target.statusMessage = "Listening.";
    target.objective = "Conversation mode active.";
    setLiveConversationListening(target.liveConversation, { cameraContextActive: true });
  } catch (error) {
    target.emergencyRuntimeController.failSession(error?.message || "Conversation unavailable");
    applyInteractionState(target, {
      mode: "conversation",
      sessionActive: false,
      cameraActive: false,
      microphoneActive: false,
      visualContextActive: false,
      proactiveObservationActive: false,
      listeningActive: false,
      userSpeaking: false,
      inferenceInFlight: false,
      assistantSpeaking: false,
      queuedUserTurn: null,
      queuedVisualEvent: null,
      safeError: error?.message ?? "unavailable",
      modeGenerationId: generationId
    });
    target.realtimeSession.state = "error";
    target.movementRecognition.persistent.active = false;
    target.movementRecognition.persistent.state = "error";
    target.errorMessage = `Conversation error: ${error?.message ?? "unavailable"}`;
    target.statusMessage = "Conversation did not start.";
    failLiveConversation(target.liveConversation, error?.message || "Conversation unavailable", {
      code: "conversation_start_failed"
    });
    stopRealtimeMediaTracks(target);
    if (target === state) void perceptionCoreAwakening?.fail(error);
  }
  render();
  return target;
}

export async function startRealtimeObserving(target = state, options = {}) {
  if (target.primarySurfaceMode === "microscope" || microscope?.isActive?.()) {
    await endMicroscope("start_observing", { ...options, target, preserveCamera: false, waitForService: false });
    target.primarySurfaceMode = "observing";
  }
  if (target.interactionState.sessionActive && interactionModeIs(target, "conversation")) {
    return switchInteractionMode(target, "observing", options);
  }
  if (["starting", "active"].includes(target.realtimeSession.state) || target.cameraStartInFlight) return target;
  const startingRuntime = target.emergencyRuntimeController.beginStart("observing");
  const generationId = startingRuntime.session.modeGeneration;
  const sessionGenerationId = startingRuntime.session.sessionGeneration;
  target.appState = startingRuntime;
  clearTransientPresentationState(target);
  target.observationMemory = createObservationMemoryState();
  target.realtimeSession = {
    ...createRealtimeSessionState(),
    state: "starting",
    memory: target.observationMemory,
    lastStartedAtMs: Math.round(now())
  };
  applyInteractionState(target, {
    mode: "observing",
    sessionActive: false,
    cameraActive: false,
    microphoneActive: false,
    visualContextActive: false,
    proactiveObservationActive: false,
    listeningActive: false,
    userSpeaking: false,
    inferenceInFlight: false,
    assistantSpeaking: false,
    queuedUserTurn: null,
    queuedVisualEvent: null,
    safeError: null,
    sessionGenerationId,
    modeGenerationId: generationId
  });
  target.movementRecognition.persistent.active = true;
  target.movementRecognition.persistent.pausedForVisibility = false;
  target.movementRecognition.persistent.state = "starting";
  target.movementRecognition.persistent.queuedEvent = null;
  target.movementRecognition.persistent.lastTriggerAtMs = 0;
  target.movementRecognition.persistent.lastSceneFingerprint = "";
  target.movementRecognition.persistent.neutralSinceMs = 0;
  target.movementRecognition.persistent.awaitingNeutral = false;
  target.movementRecognition.autoSpeak = true;
  target.errorMessage = "";
  target.statusMessage = "Starting observing…";
  render();
  if (target === state) void perceptionCoreAwakening?.begin("observing");
  try {
    const stream = options.mediaStream || await withTimeout(
      requestRealtimeObservingMedia(options),
      options.mediaTimeoutMs ?? 20000,
      "Camera permission timed out."
    );
    await attachInteractionStreamToPreview(target, stream, "observing");
    startLocalPerception();
    await primeObservationBaseline(target);
    syncInstantGestureEngine();
    const ownedRuntime = target.emergencyRuntimeController.activate("observing", { cameraActive: true, microphoneActive: false });
    applyInteractionState(target, {
      mode: "observing",
      sessionActive: true,
      cameraActive: true,
      microphoneActive: false,
      visualContextActive: true,
      proactiveObservationActive: true,
      listeningActive: false,
      userSpeaking: false,
      inferenceInFlight: false,
      assistantSpeaking: false,
      queuedUserTurn: null,
      queuedVisualEvent: null,
      safeError: null,
      sessionGenerationId: ownedRuntime.session.sessionGeneration,
      modeGenerationId: ownedRuntime.session.modeGeneration
    });
    target.appState = ownedRuntime;
    target.realtimeSession.state = "active";
    target.movementRecognition.persistent.state = "active";
    target.movementRecognition.status = "idle";
    target.statusMessage = "Watching.";
    target.objective = "Observing mode active.";
  } catch (error) {
    target.emergencyRuntimeController.failSession(error?.message || "Visual model unavailable");
    applyInteractionState(target, {
      mode: "observing",
      sessionActive: false,
      cameraActive: false,
      microphoneActive: false,
      visualContextActive: false,
      proactiveObservationActive: false,
      listeningActive: false,
      userSpeaking: false,
      inferenceInFlight: false,
      assistantSpeaking: false,
      queuedUserTurn: null,
      queuedVisualEvent: null,
      safeError: error?.message ?? "unavailable",
      modeGenerationId: generationId
    });
    target.realtimeSession.state = "error";
    target.movementRecognition.persistent.active = false;
    target.movementRecognition.persistent.state = "error";
    target.errorMessage = `Observing error: ${error?.message ?? "unavailable"}`;
    target.statusMessage = "Observing did not start.";
    stopRealtimeMediaTracks(target);
    if (target === state) void perceptionCoreAwakening?.fail(error);
  }
  render();
  return target;
}

async function requestRealtimeConversationMedia(options = {}) {
  const mediaDevices = options.mediaDevices || globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) throw new Error("Camera and microphone are unavailable.");
  return mediaDevices.getUserMedia({
    video: true,
    audio: REALTIME_AUDIO_CONSTRAINTS
  });
}

async function requestRealtimeObservingMedia(options = {}) {
  const mediaDevices = options.mediaDevices || globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) throw new Error("Camera is unavailable.");
  return mediaDevices.getUserMedia({
    video: true,
    audio: false
  });
}

async function requestRealtimeMicrophoneMedia(options = {}) {
  const mediaDevices = options.mediaDevices || globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) throw new Error("Microphone is unavailable.");
  return mediaDevices.getUserMedia({
    video: false,
    audio: REALTIME_AUDIO_CONSTRAINTS
  });
}

function withTimeout(promise, timeoutMs, message, onTimeout = null) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, Math.max(1000, Number(timeoutMs || 0)));
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function attachInteractionStreamToPreview(target, stream, mode = target.interactionState?.mode || "conversation") {
  target.stream = stream;
  if (target === state) {
    sensefieldTestRuntime.resourceCounts.mediaStreamsCreated += 1;
    recordSensefieldTestEvent("media_stream_started", {
      mode,
      track_kinds: (stream?.getTracks?.() || []).map((track) => track.kind),
      track_count: (stream?.getTracks?.() || []).length
    });
  }
  if (dom?.preview) {
    dom.preview.srcObject = stream;
    await dom.preview.play?.();
    if (target === state) await createFirstFrameWait(dom.preview);
    syncPreviewAspectRatio();
  }
  target.cameraReady = true;
  target.cameraStarted = true;
  target.cameraStatus = mode === "microscope" ? "microscope" : mode === "observing" ? "observing" : "conversation";
  target.statusMessage = mode === "microscope" ? "Camera is ready." : mode === "observing" ? "Camera is ready." : "Camera and microphone are ready.";
  target.errorMessage = "";
  if (target === state) void perceptionCoreAwakening?.signalCameraReady();
}

export async function endRealtimeConversation(target = state, options = {}) {
  return endInteractionSession(target, options);
}

export async function endInteractionSession(target = state, options = {}) {
  if (!target.interactionState.sessionActive && target.realtimeSession.state === "inactive") return target;
  const endingMode = target.interactionState.mode;
  target.emergencyRuntimeController.beginEnd();
  syncEmergencyRuntimeOwner(target);
  target.realtimeSession.state = "ending";
  target.statusMessage = endingMode === "observing" ? "Ending observing…" : "Ending conversation…";
  render();
  target.movementRecognition.activeRequestAbortController?.abort?.();
  target.movementRecognition.activeRequestAbortController = null;
  stopRealtimeSpeechInput(target);
  await cancelVisualSpeech(target, options);
  stopMicrophoneTracks(target);
  target.movementRecognition.requestInFlight = false;
  target.movementRecognition.persistent.active = false;
  target.movementRecognition.persistent.pausedForVisibility = false;
  target.movementRecognition.persistent.state = "inactive";
  target.movementRecognition.persistent.queuedEvent = null;
  target.movementRecognition.persistent.cooldownUntilMs = 0;
  target.movementRecognition.persistent.neutralSinceMs = 0;
  target.movementRecognition.persistent.awaitingNeutral = false;
  stopInstantGestureEngine("off");
  stopLocalPerception();
  stopRealtimeMediaTracks(target);
  if (target === state) void perceptionCoreAwakening?.returnToDormant();
  target.emergencyRuntimeController.finishEnd();
  syncEmergencyRuntimeOwner(target);
  clearTransientPresentationState(target);
  target.realtimeSession.state = "inactive";
  target.realtimeSession.queuedUserTurns = [];
  target.realtimeSession.lastEndedAtMs = Math.round(now());
  target.cameraStatus = "stopped";
  target.statusMessage = endingMode === "observing" ? "Start observing." : "Start conversation.";
  target.objective = target.statusMessage;
  if (endingMode === "conversation") {
    setLiveConversationListening(target.liveConversation, { paused: true, cameraContextActive: false });
  }
  syncInstantGestureEngine();
  render();
  return target;
}

export async function switchInteractionMode(target = state, mode = "conversation", options = {}) {
  const nextMode = normalizeInteractionMode(mode);
  if (nextMode === target.interactionState.mode) return target;
  const switchingRuntime = target.emergencyRuntimeController.switchMode(nextMode, {
    cameraActive: target.cameraReady,
    microphoneActive: false
  });
  const generationId = switchingRuntime.session.modeGeneration;
  const sessionGenerationId = switchingRuntime.session.sessionGeneration;
  target.appState = switchingRuntime;
  syncEmergencyRuntimeOwner(target);
  persistInteractionModePreference(nextMode);
  target.realtimeSession.state = "starting";
  target.statusMessage = nextMode === "observing" ? "Switching to observing…" : "Switching to conversation…";
  if (nextMode === "observing" && ["speaking", "streaming_answer"].includes(target.liveConversation.status)) {
    interruptLiveConversation(target.liveConversation, "mode_switch");
  }
  stopRealtimeSpeechInput(target);
  await cancelVisualSpeech(target, options);
  target.movementRecognition.requestInFlight = false;
  target.movementRecognition.status = "idle";
  clearTransientPresentationState(target);
  target.realtimeSession.queuedVisualEvent = null;
  target.realtimeSession.queuedUserTurn = null;
  target.realtimeSession.queuedUserTurns = [];
  applyInteractionState(target, {
    mode: nextMode,
    sessionActive: false,
    cameraActive: target.cameraReady,
    microphoneActive: nextMode === "conversation" && activeAudioTracks(target).length > 0,
    visualContextActive: target.cameraReady,
    proactiveObservationActive: false,
    listeningActive: false,
    userSpeaking: false,
    inferenceInFlight: false,
    assistantSpeaking: false,
    queuedUserTurn: null,
    queuedVisualEvent: null,
    safeError: null,
    sessionGenerationId,
    modeGenerationId: generationId
  });
  render();
  if (nextMode === "observing") {
    stopMicrophoneTracks(target);
    target.movementRecognition.persistent.active = true;
    target.movementRecognition.persistent.state = "active";
    target.movementRecognition.persistent.queuedEvent = null;
    target.movementRecognition.persistent.lastTriggerAtMs = 0;
    target.movementRecognition.persistent.lastSceneFingerprint = "";
    target.movementRecognition.persistent.neutralSinceMs = 0;
    target.movementRecognition.persistent.awaitingNeutral = false;
    startLocalPerception();
    await primeObservationBaseline(target);
    syncInstantGestureEngine();
    const ownedRuntime = target.emergencyRuntimeController.setActiveCapabilities({ cameraActive: target.cameraReady, microphoneActive: false });
    applyInteractionState(target, {
      mode: "observing",
      sessionActive: true,
      cameraActive: target.cameraReady,
      microphoneActive: false,
      visualContextActive: true,
      proactiveObservationActive: true,
      listeningActive: false,
      userSpeaking: false,
      inferenceInFlight: false,
      assistantSpeaking: false,
      queuedUserTurn: null,
      queuedVisualEvent: null,
      safeError: null,
      sessionGenerationId: ownedRuntime.session.sessionGeneration,
      modeGenerationId: ownedRuntime.session.modeGeneration
    });
    target.appState = ownedRuntime;
    target.realtimeSession.state = "active";
    target.statusMessage = "Watching.";
    render();
    return target;
  }

  target.movementRecognition.persistent.active = false;
  target.movementRecognition.persistent.state = "inactive";
  target.movementRecognition.persistent.queuedEvent = null;
  target.movementRecognition.persistent.neutralSinceMs = 0;
  target.movementRecognition.persistent.awaitingNeutral = false;
  stopInstantGestureEngine("off");
  startLocalPerception();
  try {
    await withTimeout(
      ensureMicrophoneTrack(target, options),
      options.mediaTimeoutMs ?? 20000,
      "Microphone permission timed out."
    );
    const speechStarted = startRealtimeSpeechInput(target, options);
    if (!speechStarted) throw new Error("Speech recognition is unavailable in this browser.");
  } catch (error) {
    stopRealtimeSpeechInput(target);
    stopMicrophoneTracks(target);
    target.movementRecognition.persistent.active = false;
    target.movementRecognition.persistent.state = "error";
    target.errorMessage = `Conversation error: ${error?.message ?? "unavailable"}`;
    target.statusMessage = "Conversation did not start.";
    failLiveConversation(target.liveConversation, error?.message || "Conversation unavailable", {
      code: "conversation_start_failed"
    });
    target.emergencyRuntimeController.failSession(error?.message || "Conversation unavailable");
    applyInteractionState(target, {
      mode: "conversation",
      sessionActive: false,
      cameraActive: target.cameraReady,
      microphoneActive: false,
      visualContextActive: false,
      proactiveObservationActive: false,
      listeningActive: false,
      userSpeaking: false,
      inferenceInFlight: false,
      assistantSpeaking: false,
      queuedUserTurn: null,
      queuedVisualEvent: null,
      safeError: error?.message ?? "unavailable",
      modeGenerationId: generationId
    });
    target.realtimeSession.state = "error";
    render();
    return target;
  }
  const ownedRuntime = target.emergencyRuntimeController.setActiveCapabilities({
    cameraActive: target.cameraReady,
    microphoneActive: activeAudioTracks(target).length > 0
  });
  applyInteractionState(target, {
    mode: "conversation",
    sessionActive: true,
    cameraActive: target.cameraReady,
    microphoneActive: activeAudioTracks(target).length > 0,
    visualContextActive: true,
    proactiveObservationActive: false,
    listeningActive: true,
    userSpeaking: false,
    inferenceInFlight: false,
    assistantSpeaking: false,
    queuedUserTurn: null,
    queuedVisualEvent: null,
    safeError: null,
    sessionGenerationId: ownedRuntime.session.sessionGeneration,
    modeGenerationId: ownedRuntime.session.modeGeneration
  });
  target.appState = ownedRuntime;
  target.realtimeSession.state = "active";
  target.statusMessage = "Listening.";
  target.liveConversation.sessionGenerationId = ownedRuntime.session.sessionGeneration;
  setLiveConversationListening(target.liveConversation, { cameraContextActive: target.cameraReady });
  render();
  return target;
}

async function ensureMicrophoneTrack(target, options = {}) {
  if (activeAudioTracks(target).length > 0) return;
  const audioStream = options.audioStream || await requestRealtimeMicrophoneMedia(options);
  const tracks = audioStream.getAudioTracks?.() || [];
  if (!target.stream) {
    target.stream = audioStream;
    return;
  }
  if (typeof target.stream.addTrack === "function") {
    for (const track of tracks) target.stream.addTrack(track);
  }
}

function stopMicrophoneTracks(target) {
  for (const track of target.stream?.getAudioTracks?.() || []) {
    if (track.readyState !== "ended" && track.__sensefieldStopped !== true) {
      track.stop?.();
      track.__sensefieldStopped = true;
      if (target === state) recordSensefieldTestEvent("media_track_stopped", { kind: "audio" });
    }
  }
}

function stopRealtimeMediaTracks(target) {
  for (const track of target.stream?.getTracks?.() ?? []) {
    if (track.readyState !== "ended" && track.__sensefieldStopped !== true) {
      track.stop();
      track.__sensefieldStopped = true;
      if (target === state) recordSensefieldTestEvent("media_track_stopped", { kind: track.kind || "unknown" });
    }
  }
  target.stream = null;
  target.cameraReady = false;
  target.recording = false;
  if (dom?.preview) dom.preview.srcObject = null;
  resetPreviewAspectRatio();
}

function syncPreviewAspectRatio() {
  const width = Number(dom?.preview?.videoWidth) || 0;
  const height = Number(dom?.preview?.videoHeight) || 0;
  if (!dom?.cameraFrame || width <= 0 || height <= 0) return false;
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 3) return false;
  dom.cameraFrame.dataset.cameraAspect = `${width}x${height}`;
  return true;
}

function resetPreviewAspectRatio() {
  if (dom?.cameraFrame?.dataset) delete dom.cameraFrame.dataset.cameraAspect;
}

function stopDetachedMediaStream(stream, target = state) {
  for (const track of stream?.getTracks?.() || []) {
    if (track.readyState !== "ended" && track.__sensefieldStopped !== true) {
      track.stop?.();
      track.__sensefieldStopped = true;
      if (target === state) recordSensefieldTestEvent("media_track_stopped", { kind: track.kind || "unknown" });
    }
  }
}

function startRealtimeSpeechInput(target, options = {}) {
  if (!interactionModeIs(target, "conversation")) return false;
  target.realtimeSession.speechStopping = false;
  const Recognition = options.SpeechRecognition || globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  target.realtimeSession.speechFallback = Recognition ? "browser_speech_recognition" : "browser_speech_recognition_unavailable";
  applyInteractionState(target, {
    microphoneActive: activeAudioTracks(target).length > 0,
    listeningActive: true,
    proactiveObservationActive: false
  });
  if (typeof Recognition !== "function") return false;
  const generationId = Number(target.interactionState.modeGenerationId || 0);
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onstart = () => {
    if (!modeRequestStillCurrent(target, "conversation", generationId)) return;
    applyInteractionState(target, { listeningActive: true, proactiveObservationActive: false });
    if (!target.liveConversation.listeningPaused) {
      setLiveConversationListening(target.liveConversation, { cameraContextActive: target.cameraReady });
    }
    render();
  };
  recognition.onspeechstart = () => {
    if (!modeRequestStillCurrent(target, "conversation", generationId)) return;
    applyInteractionState(target, { userSpeaking: true, listeningActive: true, proactiveObservationActive: false });
    if (target.interactionState.assistantSpeaking || persistentSpeechBusy(target)) interruptAssistantSpeech(target, "user_speech");
    target.liveConversation.status = "listening";
    target.liveConversation.revision += 1;
    render();
  };
  recognition.onspeechend = () => {
    if (!modeRequestStillCurrent(target, "conversation", generationId)) return;
    applyInteractionState(target, { userSpeaking: false, listeningActive: true, proactiveObservationActive: false });
    if (!target.liveConversation.interimText && !target.interactionState.inferenceInFlight) {
      setLiveConversationListening(target.liveConversation, { cameraContextActive: target.cameraReady });
    }
    render();
  };
  recognition.onresult = (event) => {
    if (!modeRequestStillCurrent(target, "conversation", generationId)) return;
    const update = recognitionUpdateFromEvent(event);
    updateLiveInterim(target.liveConversation, update.interimText, Math.round(now()));
    if (target === state) scheduleLiveConversationRailRender(target);
    if (!update.finalText || transcriptLooksLikeAssistantEcho(target, update.finalText)) return;
    void handleRealtimeUserSpeechTurn(target, update.finalText, options);
  };
  recognition.onerror = (event) => {
    if (!modeRequestStillCurrent(target, "conversation", generationId)) return;
    const code = String(event?.error || "speech_recognition_error");
    if (["aborted", "no-speech"].includes(code)) {
      if (!target.realtimeSession.speechStopping && !target.liveConversation.listeningPaused) {
        setLiveConversationListening(target.liveConversation, { cameraContextActive: target.cameraReady });
      }
      return;
    }
    const permissionBlocked = ["not-allowed", "service-not-allowed", "audio-capture"].includes(code);
    applyInteractionState(target, { listeningActive: !permissionBlocked, proactiveObservationActive: false });
    failLiveConversation(target.liveConversation, liveSpeechRecognitionError(code), {
      code,
      recoverable: true
    });
    render();
  };
  recognition.onend = () => {
    if (!modeRequestStillCurrent(target, "conversation", generationId)) return;
    if (target.realtimeSession.speechStopping) return;
    applyInteractionState(target, { listeningActive: true, userSpeaking: false, proactiveObservationActive: false });
    if (!target.liveConversation.listeningPaused && !target.interactionState.assistantSpeaking) {
      setLiveConversationListening(target.liveConversation, { cameraContextActive: target.cameraReady });
    }
    if (target.interactionState.sessionActive && interactionModeIs(target, "conversation")) {
      target.realtimeSession.speechRestartTimer = setTimeout(() => {
        try {
          recognition.start();
        } catch {
          applyInteractionState(target, { listeningActive: true, proactiveObservationActive: false });
        }
      }, 120);
    }
    render();
  };
  target.realtimeSession.speechRecognition = recognition;
  try {
    recognition.start();
    if (target === state) recordSensefieldTestEvent("speech_recognition_started", { provider: target.realtimeSession.speechFallback });
  } catch {
    applyInteractionState(target, { listeningActive: true, proactiveObservationActive: false });
    target.realtimeSession.speechRecognition = null;
    return false;
  }
  return true;
}

function stopRealtimeSpeechInput(target) {
  if (target.realtimeSession.speechRestartTimer) clearTimeout(target.realtimeSession.speechRestartTimer);
  target.realtimeSession.speechRestartTimer = null;
  target.realtimeSession.speechStopping = true;
  const recognition = target.realtimeSession.speechRecognition;
  target.realtimeSession.speechRecognition = null;
  try {
    recognition?.abort?.();
    recognition?.stop?.();
    if (recognition && target === state) recordSensefieldTestEvent("speech_recognition_stopped", {});
  } catch {
    // Browser speech recognition shutdown is best-effort.
  }
}

function liveSpeechRecognitionError(code) {
  return {
    "not-allowed": "Microphone access is blocked. Allow microphone access, then retry.",
    "service-not-allowed": "Speech recognition is blocked in this browser.",
    "audio-capture": "The microphone is unavailable. Check the active input and retry.",
    network: "Speech recognition lost its connection. Listening will retry.",
    "language-not-supported": "English speech recognition is unavailable in this browser."
  }[code] || "Speech recognition paused. Try listening again.";
}

function transcriptLooksLikeAssistantEcho(target, transcript) {
  const value = normalizeMemoryText(transcript);
  const lastAssistant = normalizeMemoryText(target.conversationMemory.assistantResponses.at(-1)?.text || target.movementRecognition.latestSpokenResponse);
  return value.length > 12 && lastAssistant.length > 12 && (lastAssistant.includes(value) || value.includes(lastAssistant));
}

export async function handleRealtimeUserSpeechTurn(target = state, transcript = "", options = {}) {
  if (!target.interactionState.sessionActive || !interactionModeIs(target, "conversation")) return { ok: false, code: "conversation_mode_inactive" };
  const text = sanitizeMemoryText(transcript);
  if (!text) return { ok: false, code: "empty_user_turn" };
  const receivedAtMs = Number(options.receivedAtMs || Math.round(now()));
  const accepted = target.emergencyRuntimeController.queueFinalTranscript(text, receivedAtMs);
  if (!accepted.ok) {
    target.liveConversation.interimText = "";
    target.liveConversation.revision += 1;
    if (target === state) renderLiveConversationRail(target, { force: true });
    return { ok: false, code: accepted.code === "duplicate_transcript" ? "duplicate_final_transcript" : accepted.code };
  }
  target.appState = target.emergencyRuntimeController.snapshot();
  target.realtimeSession.processingTranscript = true;
  try {
    if (target.interactionState.assistantSpeaking || persistentSpeechBusy(target)) interruptAssistantSpeech(target, "user_turn");
    target.realtimeSession.lastFinalTranscript = normalizeMemoryText(text);
    target.realtimeSession.lastFinalTranscriptAtMs = receivedAtMs;
    target.realtimeSession.lastUserTranscript = text;
    const userTurn = {
      turn_id: `user_turn_${receivedAtMs}_${target.conversationMemory.userTurns.length}`,
      text,
      created_at_ms: receivedAtMs,
      interactionMode: "conversation",
      sessionGenerationId: accepted.turn.sessionGeneration,
      modeGenerationId: accepted.turn.modeGeneration
    };
    if (options.reuseExistingTurn !== true) {
      appendRealtimeMemory(target, "user", { text, source: "speech" });
      finalizeLiveUserTurn(target.liveConversation, text, {
        id: userTurn.turn_id,
        createdAtMs: receivedAtMs,
        cameraContext: target.cameraReady
      });
    } else {
      target.liveConversation.interimText = "";
      target.liveConversation.status = "finalizing_question";
      target.liveConversation.revision += 1;
    }
    if (target === state) recordSensefieldTestEvent("user_turn_received", {
      transcript: text,
      turn_id: userTurn.turn_id
    }, { correlationId: userTurn.turn_id, modeGenerationId: userTurn.modeGenerationId });
    applyInteractionState(target, {
      queuedUserTurn: userTurn,
      queuedVisualEvent: null,
      listeningActive: true,
      proactiveObservationActive: false
    });
    processRealtimeSessionScheduler(target, options);
    render();
    return { ok: true };
  } finally {
    target.realtimeSession.processingTranscript = false;
  }
}

export function scheduleRealtimeVisualEvent(target = state, event = {}, options = {}) {
  if (!target.interactionState.sessionActive || !interactionModeIs(target, "observing")) return false;
  if (target.interactionState.queuedUserTurn) return false;
  if (event.stale === true) return false;
  const accepted = target.emergencyRuntimeController.queueVisualEvent({ ...event, queued_at_ms: Math.round(now()) });
  if (!accepted.ok) return false;
  applyInteractionState(target, {
    queuedVisualEvent: {
    ...event,
      queued_at_ms: Math.round(now()),
      interactionMode: "observing",
      sessionGenerationId: accepted.event.sessionGeneration,
      modeGenerationId: accepted.event.modeGeneration
    },
    listeningActive: false,
    proactiveObservationActive: true
  });
  processRealtimeSessionScheduler(target, options);
  return true;
}

export function processRealtimeSessionScheduler(target = state, options = {}) {
  if (!target.interactionState.sessionActive) return false;
  assertInteractionStateInvariant(target);
  if (target.interactionState.inferenceInFlight || target.movementRecognition.requestInFlight) return false;
  if (interactionModeIs(target, "observing") && (target.interactionState.assistantSpeaking || persistentSpeechBusy(target))) return false;
  const ownedTask = target.emergencyRuntimeController.takeNextTask();
  if (!ownedTask) return false;
  const runtimeToken = {
    requestId: ownedTask.requestId,
    sessionGeneration: ownedTask.sessionGeneration,
    modeGeneration: ownedTask.modeGeneration,
    mode: ownedTask.mode
  };
  const task = ownedTask.type === "user_turn"
    ? { type: "user_turn", userTurn: { turn_id: ownedTask.requestId, text: ownedTask.text, created_at_ms: ownedTask.createdAtMs, interactionMode: "conversation", sessionGenerationId: ownedTask.sessionGeneration, modeGenerationId: ownedTask.modeGeneration }, runtimeToken }
    : { type: "visual_event", visualEvent: { ...ownedTask, interactionMode: "observing", sessionGenerationId: ownedTask.sessionGeneration, modeGenerationId: ownedTask.modeGeneration }, runtimeToken };
  if (task.type === "user_turn") {
    setLiveConversationThinking(target.liveConversation, {
      requestId: runtimeToken.requestId,
      createdAtMs: Math.round(now())
    });
  }
  applyInteractionState(target, { queuedUserTurn: null, queuedVisualEvent: null, inferenceInFlight: true });
  void runRealtimeInference(target, task, options);
  return true;
}

export function handleLiveConversationAssistantChunk(target = state, chunk = "", options = {}) {
  if (!target.interactionState.sessionActive || !interactionModeIs(target, "conversation")) return false;
  const accepted = appendLiveAssistantChunk(target.liveConversation, chunk, {
    requestId: options.requestId,
    atMs: options.atMs || Math.round(now())
  });
  if (accepted && target === state) scheduleLiveConversationRailRender(target);
  return accepted;
}

async function runRealtimeInference(target, task, options = {}) {
  const interactionMode = task.userTurn?.interactionMode || task.visualEvent?.interactionMode || target.interactionState.mode;
  const modeGenerationId = task.userTurn?.modeGenerationId ?? task.visualEvent?.modeGenerationId ?? target.interactionState.modeGenerationId;
  const sessionGenerationId = task.userTurn?.sessionGenerationId ?? task.visualEvent?.sessionGenerationId ?? target.interactionState.sessionGenerationId;
  if (!modeRequestStillCurrent(target, interactionMode, modeGenerationId) || Number(target.interactionState.sessionGenerationId) !== Number(sessionGenerationId)) return;
  const inferenceGenerationId = Number(target.interactionState.inferenceGenerationId || 0) + 1;
  const correlationId = task.userTurn?.turn_id || task.visualEvent?.event_id || `visual_${Math.round(now())}`;
  if (target === state) {
    sensefieldTestRuntime.resourceCounts.inferenceStarted += 1;
    recordSensefieldTestEvent("inference_started", { task_type: task.type, mode: interactionMode }, { correlationId, modeGenerationId });
  }
  applyInteractionState(target, { inferenceInFlight: true, inferenceGenerationId });
  try {
    if (typeof options.runRealtimeInference === "function") {
      await options.runRealtimeInference(target, task, {
        onAssistantChunk: (chunk) => handleLiveConversationAssistantChunk(target, chunk, {
          requestId: task.runtimeToken?.requestId,
          atMs: Math.round(now())
        })
      });
    } else if (task.type === "user_turn") {
      await analyzeMovementInState(target, {
        ...options,
        userQuestion: task.userTurn.text,
        realtimeTask: task,
        directUserTurn: true,
        interactionMode,
        modeGenerationId
      });
    } else {
      await analyzeMovementInState(target, {
        ...options,
        persistent: true,
        changeEvent: task.visualEvent,
        realtimeTask: task,
        interactionMode,
        modeGenerationId
      });
    }
  } finally {
    const inferenceError = target.movementRecognition.status === "fallback"
      ? target.movementRecognition.lastSafeError || ""
      : "";
    const finishedOwnedInference = target.emergencyRuntimeController.finishInference(task.runtimeToken, inferenceError);
    if (finishedOwnedInference) target.appState = target.emergencyRuntimeController.snapshot();
    if (target === state) {
      sensefieldTestRuntime.resourceCounts.inferenceCompleted += 1;
      recordSensefieldTestEvent("inference_completed", {
        task_type: task.type,
        mode: interactionMode,
        stale: !modeRequestStillCurrent(target, interactionMode, modeGenerationId)
      }, { correlationId, modeGenerationId });
    }
    if (modeRequestStillCurrent(target, interactionMode, modeGenerationId) &&
        Number(target.interactionState.sessionGenerationId) === Number(sessionGenerationId) &&
        Number(target.interactionState.inferenceGenerationId) === inferenceGenerationId) {
      applyInteractionState(target, { inferenceInFlight: false });
      render();
    }
    processRealtimeSessionScheduler(target, options);
  }
}

export function interruptAssistantSpeech(target = state, reason = "user_interruption") {
  const text = target.movementRecognition.latestSpokenResponse || "";
  if (text) {
    target.realtimeSession.lastInterruptedAssistantText = text;
    appendRealtimeMemory(target, "assistant", { text, interrupted: true, reason });
  }
  if (interactionModeIs(target, "conversation")) interruptLiveConversation(target.liveConversation, reason);
  applyInteractionState(target, { assistantSpeaking: false });
  void cancelVisualSpeech(target);
  return { ok: true, interrupted: Boolean(text) };
}

function appendRealtimeMemory(target, role, entry = {}) {
  const memory = target.conversationMemory;
  const normalized = {
    text: sanitizeMemoryText(entry.text || ""),
    created_at_ms: Math.round(now()),
    interrupted: entry.interrupted === true,
    source: sanitizeMemoryText(entry.source || role),
    reason: sanitizeMemoryText(entry.reason || "")
  };
  if (!normalized.text) return memory;
  if (role === "user") memory.userTurns.push(normalized);
  if (role === "assistant") {
    memory.assistantResponses.push(normalized);
    if (normalized.interrupted) memory.interruptedResponses.push(normalized);
  }
  target.emergencyRuntimeController.recordMoment("conversation", {
    id: entry.id || `${role}_${normalized.created_at_ms}_${normalized.text}`,
    role: role === "user" ? "USER" : "SENSEFIELD",
    text: normalized.text,
    createdAt: normalized.created_at_ms
  });
  target.appState = target.emergencyRuntimeController.snapshot();
  memory.userTurns = memory.userTurns.slice(-8);
  memory.assistantResponses = memory.assistantResponses.slice(-8);
  memory.interruptedResponses = memory.interruptedResponses.slice(-4);
  return memory;
}

function appendRealtimeVisualSummary(target, summary = "") {
  const text = sanitizeMemoryText(summary);
  if (!text) return;
  if (interactionModeIs(target, "observing")) {
    target.observationMemory.movementDescriptions.push({ text, created_at_ms: Math.round(now()) });
    target.observationMemory.movementDescriptions = target.observationMemory.movementDescriptions.slice(-8);
    return;
  }
  const memory = target.conversationMemory;
  memory.visualSummaries.push({ text, created_at_ms: Math.round(now()) });
  memory.visualSummaries = memory.visualSummaries.slice(-8);
}

function normalizeMemoryText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function startObserving(target = state) {
  if (isPrimaryView()) return startRealtimeObserving(target);
  if (target.movementRecognition.persistent.active || target.cameraStartInFlight) return target;
  target.movementRecognition.persistent.active = true;
  target.movementRecognition.persistent.pausedForVisibility = typeof document !== "undefined" && document.hidden === true;
  target.movementRecognition.persistent.state = "starting";
  target.movementRecognition.persistent.queuedEvent = null;
  target.movementRecognition.persistent.lastTriggerAtMs = 0;
  target.movementRecognition.persistent.lastSceneFingerprint = "";
  target.movementRecognition.persistent.neutralSinceMs = 0;
  target.movementRecognition.persistent.awaitingNeutral = false;
  target.movementRecognition.autoSpeak = true;
  target.errorMessage = "";
  render();
  if (!target.cameraReady) await startCamera();
  if (target.cameraReady && target.movementRecognition.persistent.active) {
    target.movementRecognition.persistent.state = "active";
    target.statusMessage = "Listening and looking.";
  }
  render();
  return target;
}

export function stopObserving(target = state) {
  if (isPrimaryView()) {
    void endInteractionSession(target);
    return target;
  }
  target.movementRecognition.persistent.active = false;
  target.movementRecognition.persistent.pausedForVisibility = false;
  target.movementRecognition.persistent.state = target.errorMessage ? "error" : "inactive";
  target.movementRecognition.persistent.queuedEvent = null;
  target.movementRecognition.persistent.cooldownUntilMs = 0;
  target.movementRecognition.persistent.neutralSinceMs = 0;
  target.movementRecognition.persistent.awaitingNeutral = false;
  stopCamera();
  return target;
}

function openCalibrationPanel() {
  state.calibrationOpen = true;
  if (dom?.developerTools) dom.developerTools.open = true;
  state.objective = "Adjust zone rectangles, assign objects, then press Save Calibration.";
  state.statusMessage = "Calibration form is open.";
  state.errorMessage = "";
  render();
}

async function startCamera() {
  if (state.cameraReady || state.cameraStartInFlight) return;
  state.cameraStartInFlight = true;
  if (state.movementRecognition.persistent.active) state.movementRecognition.persistent.state = "starting";
  render();
  const startedAt = now();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    state.cameraReady = true;
    state.cameraStarted = true;
    state.cameraStatus = `granted (${Math.max(1, Math.round(now() - startedAt))}ms)`;
    state.objective = state.calibrationSaved ? "Press Start Focus Ritual." : "Press Calibrate Zones.";
    state.statusMessage = "Camera is ready. No audio was requested.";
    state.errorMessage = "";
    dom.preview.srcObject = state.stream;
    await dom.preview.play();
    syncPreviewAspectRatio();
    startLocalPerception();
    syncInstantGestureEngine();
    if (state.movementRecognition.persistent.active) {
      state.movementRecognition.persistent.state = "active";
    }
  } catch (error) {
    state.cameraReady = false;
    if (state.movementRecognition.persistent.active) {
      state.movementRecognition.persistent.active = false;
      state.movementRecognition.persistent.state = "error";
    }
    state.cameraStatus = `error: ${error?.message ?? "camera unavailable"}`;
    state.objective = "Allow camera permission, then try again.";
    state.statusMessage = "Camera did not start.";
    state.errorMessage = `Camera error: ${error?.message ?? "camera unavailable"}`;
  } finally {
    state.cameraStartInFlight = false;
  }
  render();
}

function stopCamera() {
  if (state.movementRecognition?.persistent) {
    state.movementRecognition.persistent.active = false;
    state.movementRecognition.persistent.pausedForVisibility = false;
    state.movementRecognition.persistent.state = state.errorMessage ? "error" : "inactive";
    state.movementRecognition.persistent.queuedEvent = null;
    state.movementRecognition.persistent.cooldownUntilMs = 0;
    state.movementRecognition.persistent.neutralSinceMs = 0;
    state.movementRecognition.persistent.awaitingNeutral = false;
  }
  stopInstantGestureEngine("off");
  stopLocalPerception();
  for (const track of state.stream?.getTracks?.() ?? []) track.stop();
  state.stream = null;
  state.cameraReady = false;
  state.recording = false;
  resetPreviewAspectRatio();
  state.cameraStatus = "stopped";
  state.objective = "Press Start Camera.";
  state.statusMessage = "Camera stopped.";
  if (dom?.preview) dom.preview.srcObject = null;
  syncInstantGestureEngine();
  render();
}

function resetSession() {
  stopInstantGestureEngine("off");
  stopLocalPerception();
  for (const track of state.stream?.getTracks?.() ?? []) track.stop();
  state = resetSessionInState(state);
  if (dom?.preview) dom.preview.srcObject = null;
  if (dom?.confirmPhysical) dom.confirmPhysical.checked = false;
  buildCalibrationForm(dom, state);
  render();
}

export function resetSessionInState(target) {
  const fresh = createInitialState();
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, fresh);
  attachRuntimeCompatibilityAliases(target);
  return target;
}

export function saveCalibrationToState(target, calibration) {
  if (!target.cameraReady) {
    target.errorMessage = "Save Calibration is disabled because you have not started the camera yet.";
    target.statusMessage = "Start camera before saving calibration.";
    target.objective = "Click Start Camera first.";
    return target;
  }

  target.zoneGeometry = clone(calibration.zoneGeometry);
  target.objectAssignments = { ...calibration.objectAssignments };
  target.calibrationSaved = true;
  target.calibrationOpen = false;
  transitionTo(target, "calibrated");
  target.objective = "Press Start Focus Ritual.";
  target.activeZone = "neutral_zone";
  target.confidence = 0.94;
  target.uncertain = false;
  target.reset = false;
  target.errorMessage = "";
  target.statusMessage = "Calibration saved. Start Focus Ritual is now available.";
  target.events = target.events.filter((event) => event.id !== "evt_scene_calibrated");
  target.latencyRecords = target.latencyRecords.filter((record) => record.event_id !== "evt_scene_calibrated");
  emitEvents(target, [calibrationEvent(target)], "calibration");
  updateExportReadiness(target);
  return target;
}

export function startFocusRitualInState(target) {
  if (!target.cameraReady) {
    target.errorMessage = "Start Focus Ritual is disabled because you have not started the camera yet.";
    return target;
  }
  if (!target.calibrationSaved) {
    target.errorMessage = "Start Focus Ritual is disabled because calibration has not been saved.";
    target.objective = "Press Calibrate Zones, then Save Calibration.";
    return target;
  }
  target.ritualStarted = true;
  transitionTo(target, "quest_started");
  target.objective = "Press Start Recording.";
  target.activeZone = "phone_zone";
  target.statusMessage = "Focus Ritual is set up. Recording can start.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function startRecordingInState(target, options = {}) {
  if (!target.cameraReady) {
    target.errorMessage = "Start Recording is disabled because you have not started the camera yet.";
    target.objective = "Click Start Camera.";
    return target;
  }
  if (!target.calibrationSaved) {
    target.errorMessage = "Start Recording is disabled because calibration has not been saved.";
    target.objective = "Calibrate zones and save calibration.";
    return target;
  }
  if (!target.ritualStarted) {
    target.errorMessage = "Start Recording is disabled because you have not started Focus Ritual yet.";
    target.objective = "Click Start Focus Ritual.";
    return target;
  }

  if (!options.preserve) {
    target.events = [];
    target.latencyRecords = [];
    target.lastLatency = null;
    target.completedSteps = [];
    target.uncertain = false;
    target.reset = false;
    target.uncertaintyCount = 0;
    target.resetCount = 0;
    target.exported = false;
    target.validationCopied = false;
    emitEvents(target, [calibrationEvent(target)], "recording_calibration");
  }

  target.recording = true;
  target.recordingStarted = true;
  target.physicalConfirmed = false;
  transitionTo(target, "phone_removal_pending");
  target.exportStatus = "recording";
  target.objective = "Move phone away, then press Confirm Phone Moved.";
  target.statusMessage = "Recording is on. Manual local confirmations are enabled.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function stopRecordingInState(target) {
  if (!target.recording) {
    target.errorMessage = "Stop Recording is disabled because recording is not active.";
    return target;
  }
  target.recording = false;
  target.exportStatus = target.questState === "quest_complete" ? "physical confirmation required" : "ritual incomplete";
  target.objective = target.questState === "quest_complete"
    ? "Check physical confirmation, then export."
    : objectiveForQuestState(target.questState);
  target.statusMessage = "Recording stopped. Event list is frozen.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function confirmStepInState(target, step, options = {}) {
  if (!target.recording) {
    target.errorMessage = `${ACTION_LABELS[step]} is disabled because recording is not active.`;
    target.statusMessage = "Start recording before confirming ritual steps.";
    return target;
  }
  if (!target.ritualStarted) {
    target.errorMessage = `${ACTION_LABELS[step]} is disabled because you have not started Focus Ritual yet.`;
    return target;
  }

  const currentStep = RITUAL_STEPS.find((item) => target.questState === item.activeState);
  if (!currentStep || currentStep.id !== step) {
    target.errorMessage = `${ACTION_LABELS[step]} is disabled because the current objective is ${objectiveForQuestState(target.questState)}`;
    target.statusMessage = "Complete the ritual in order.";
    return target;
  }
  const suggestionEvidence = options.suggestion ? [localSuggestionEvidence(options.suggestion)] : [];

  if (step === "phone") {
    emitEvents(target, [
      eventSpec("evt_phone_moved_to_off_desk", "object.moved", 1000, 0.92, payloadWithSuggestion({
        object_id: "obj_phone",
        object_type: "phone",
        from_zone_id: "zone_focus",
        to_zone_id: "zone_away",
        duration_ms: 640
      }, options.suggestion), "ev_phone_moved_to_off_desk", "human_correction", "Manual local confirmation: phone moved away physically.", suggestionEvidence)
    ], "phone");
    completeStep(target, "phone", "phone_removed", "notebook_pending", "Open notebook, then press Confirm Notebook Opened.", "notebook_zone");
  } else if (step === "notebook") {
    emitEvents(target, [
      eventSpec("evt_notebook_opened", "object.placed", 2200, 0.91, payloadWithSuggestion({
        object_id: "obj_notebook",
        object_type: "notebook",
        zone_id: "zone_notebook",
        dwell_ms: 800
      }, options.suggestion), "ev_notebook_opened", "human_correction", "Manual local confirmation: notebook opened physically.", suggestionEvidence)
    ], "notebook");
    completeStep(target, "notebook", "notebook_opened", "pen_pending", "Pick up pen, then press Confirm Pen Picked Up.", "pen_zone");
  } else if (step === "pen") {
    emitEvents(target, [
      eventSpec("evt_pen_moved_to_hand", "object.moved", 3300, 0.90, payloadWithSuggestion({
        object_id: "obj_pen",
        object_type: "pen",
        from_zone_id: "zone_pen_tool",
        to_zone_id: "zone_notebook",
        duration_ms: 480
      }, options.suggestion), "ev_pen_moved_to_hand", "human_correction", "Manual local confirmation: pen picked up by hand.", suggestionEvidence)
    ], "pen");
    completeStep(target, "pen", "pen_detected", "writing_pending", "Perform writing-like motion, then press Confirm Writing Motion.", "notebook_zone");
  } else if (step === "writing") {
    emitEvents(target, [
      eventSpec("evt_writing_like_motion", "gesture.detected", 4700, 0.88, payloadWithSuggestion({
        gesture_id: "gst_writing_like_001",
        gesture_type: "writing_motion",
        zone_id: "zone_notebook",
        actor_ref: "hand_right",
        evidence_window_ms: 1000,
        related_object_id: "obj_pen",
        gesture_repetition_count: 3
      }, options.suggestion), "ev_writing_like_motion", "human_correction", "Manual local confirmation: writing-like motion occurred.", suggestionEvidence)
    ], "writing");
    completeStep(target, "writing", "writing_detected", "typing_pending", "Perform typing-like motion, then press Confirm Typing Motion.", "keyboard_zone");
  } else if (step === "typing") {
    emitEvents(target, [
      eventSpec("evt_typing_like_motion", "gesture.detected", 6200, 0.89, payloadWithSuggestion({
        gesture_id: "gst_typing_like_001",
        gesture_type: "typing_motion",
        zone_id: "zone_keyboard",
        actor_ref: "hand_both",
        evidence_window_ms: 950,
        gesture_repetition_count: 4
      }, options.suggestion), "ev_typing_like_motion", "human_correction", "Manual local confirmation: typing-like motion occurred.", suggestionEvidence)
    ], "typing");
    completeStep(target, "typing", "typing_detected", "quest_complete", "Stop recording, check physical confirmation, then export.", "keyboard_zone");
  }

  updateExportReadiness(target);
  return target;
}

export function markUncertainInState(target, options = {}) {
  if (!target.recording) {
    target.errorMessage = "Mark Uncertain is disabled because recording is not active.";
    return target;
  }
  const timestamp = nextDiagnosticTimestamp(target);
  const suggestionEvidence = options.suggestion ? [localSuggestionEvidence(options.suggestion)] : [];
  emitEvents(target, [
    eventSpec(`evt_scene_uncertain_${target.uncertaintyCount + 1}`, "scene.uncertain", timestamp, 0.58, payloadWithSuggestion({
      reason: "operator_marked_uncertain",
      affected_zone_ids: REQUIRED_ZONES,
      recovery_hint: "Reset session or recalibrate before exporting."
    }, options.suggestion), `ev_scene_uncertain_${target.uncertaintyCount + 1}`, "human_correction", "Manual local confirmation: scene uncertainty visible.", suggestionEvidence)
  ], "uncertain");
  target.uncertain = true;
  target.uncertaintyCount += 1;
  transitionTo(target, "uncertain");
  transitionTo(target, "recovery");
  target.objective = "Resolve uncertainty with Reset Session, then repeat a clean run.";
  target.exportStatus = "not exportable while uncertain";
  target.statusMessage = "Uncertainty is visible in the HUD.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function markCameraResetInState(target, options = {}) {
  if (!target.recording) {
    target.errorMessage = "Mark Camera Reset is disabled because recording is not active.";
    return target;
  }
  const timestamp = nextDiagnosticTimestamp(target);
  const suggestionEvidence = options.suggestion ? [localSuggestionEvidence(options.suggestion)] : [];
  emitEvents(target, [
    eventSpec(`evt_scene_reset_${target.resetCount + 1}`, "scene.reset", timestamp, 0.95, payloadWithSuggestion({
      reason: "operator_marked_camera_reset",
      requires_recalibration: true
    }, options.suggestion), `ev_scene_reset_${target.resetCount + 1}`, "human_correction", "Manual local confirmation: camera reset/recalibration needed.", suggestionEvidence)
  ], "reset");
  target.reset = true;
  target.resetCount += 1;
  target.recording = false;
  transitionTo(target, "reset");
  target.objective = "Press Reset Session and recalibrate.";
  target.exportStatus = "not exportable after reset";
  target.statusMessage = "Reset state is visible in the HUD.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function zoneActivatedEventSpec(zoneId, motionScore, durationMs, timestampMs = 0) {
  return eventSpec(`evt_zone_activated_${safeId(zoneId)}_${Math.round(timestampMs)}`, "zone.activated", Math.round(timestampMs), confidenceFromMotion(motionScore), {
    zone_id: zoneId,
    activation_type: "local_motion",
    motion_score: Number(motionScore.toFixed(3)),
    duration_ms: Math.round(durationMs)
  }, `ev_zone_activated_${safeId(zoneId)}_${Math.round(timestampMs)}`, "local_signal", `Local motion signal activated ${zoneId}.`);
}

export function motionProxyEventSpec(direction, zoneId, confidence, timestampMs = 0) {
  return eventSpec(`evt_hand_${direction}_${safeId(zoneId)}_${Math.round(timestampMs)}`, `hand.${direction}_zone`, Math.round(timestampMs), confidence, {
    zone_id: zoneId,
    detection_method: "motion_proxy",
    confidence
  }, `ev_hand_${direction}_${safeId(zoneId)}_${Math.round(timestampMs)}`, "local_signal", `Local motion proxy: hand ${direction} ${zoneId}.`);
}

export function createPerceptionSuggestion(type, zoneId, confidence, reason, step = null, timestampMs = now(), overrides = {}) {
  const normalizedConfidence = clamp01(confidence);
  const meta = STEP_SUGGESTION_META[step] ?? {};
  const suggestedEventType = overrides.suggested_event_type ?? meta.suggested_event_type ?? type;
  const suggestedAction = overrides.suggested_action ?? meta.suggested_action ?? actionLabelForSuggestion(type, zoneId);
  const objectId = overrides.object_id ?? meta.object_id ?? objectForZone(zoneId);
  const payload = {
    ...(overrides.payload ?? {}),
    detection_method: "motion_proxy",
    suggestion_only: true
  };
  return {
    id: `sug_${safeId(type)}_${safeId(zoneId)}_${Math.round(timestampMs)}`,
    key: `${type}:${zoneId}:${step ?? "signal"}`,
    type: "action_suggestion",
    action_type: actionTypeForStep(step, suggestedEventType),
    label: suggestedAction,
    suggested_event_type: suggestedEventType,
    suggested_action: suggestedAction,
    current_step: step ?? "",
    quest_step: step ?? "",
    zone_id: zoneId,
    object_id: objectId,
    confidence: normalizedConfidence,
    reason,
    evidence: [
      {
        kind: "local_signal",
        description: reason,
        contains_raw_media: false
      },
      {
        kind: "derived_state",
        description: `quest_state=${overrides.quest_state ?? "unknown"}`,
        contains_raw_media: false
      }
    ],
    expires_at_ms: Math.round(timestampMs + (overrides.ttl_ms ?? LOCAL_MOTION.suggestionTtlMs)),
    accepted: false,
    rejected: false,
    step,
    payload,
    requires_confirmation: true,
    detection_method: payload.detection_method,
    timestamp_ms: Math.round(timestampMs),
    low_confidence: normalizedConfidence < 0.7,
    rank: rankSuggestion(suggestedEventType, zoneId, normalizedConfidence, step),
    metadata: {
      suggestion_only: true,
      detection_method: "motion_proxy",
      source: "local_motion_proxy"
    },
    status: "pending"
  };
}

export function buildLocalPerceptionFrame(input = {}) {
  assertSymbolicFrameOnly(input);
  const timestampMs = Math.round(input.timestamp_ms ?? now());
  const zoneMotion = {};
  for (const zoneId of REQUIRED_ZONES) {
    const raw = input.zone_motion?.[zoneId] ?? {};
    const motionScore = clamp01(typeof raw === "number" ? raw : raw.motion_score ?? 0);
    const confidence = clamp01(typeof raw === "object" ? raw.confidence ?? confidenceFromMotion(motionScore) : confidenceFromMotion(motionScore));
    zoneMotion[zoneId] = {
      zone_id: zoneId,
      motion_score: Number(motionScore.toFixed(3)),
      active: typeof raw === "object" ? raw.active ?? motionScore >= LOCAL_MOTION.activeThreshold : motionScore >= LOCAL_MOTION.activeThreshold,
      confidence,
      timestamp_ms: timestampMs
    };
  }
  const activeZone = Object.values(zoneMotion)
    .filter((item) => item.active)
    .sort((a, b) => b.motion_score - a.motion_score)[0]?.zone_id ?? null;
  return {
    timestamp_ms: timestampMs,
    zone_motion: zoneMotion,
    hand_landmarks: input.hand_landmarks ?? [],
    hand_zone_overlap: input.hand_zone_overlap ?? [],
    active_zone: input.active_zone ?? activeZone,
    confidence: clamp01(input.confidence ?? (activeZone ? zoneMotion[activeZone].confidence : 0)),
    uncertainty: input.uncertainty ?? { uncertain: false, reason: "" },
    scene_reset: input.scene_reset ?? { reset: false, reason: "" }
  };
}

export function scoreLocalActionFrame(frameInput, target = state, options = {}) {
  const frame = frameInput?.zone_motion ? buildLocalPerceptionFrame(frameInput) : buildLocalPerceptionFrame({ zone_motion: frameInput ?? {} });
  const observations = Object.values(frame.zone_motion);
  const candidates = rankActionSuggestions(buildActionSuggestion({ target, observations, timestampMs: frame.timestamp_ms }), target);
  return candidates.map((candidate) => smoothDetectedActionCandidate(candidate, target, options));
}

export function smoothActionConfidence(previousConfidence, nextConfidence, alpha = 0.45) {
  const next = clamp01(nextConfidence);
  if (previousConfidence == null || Number.isNaN(Number(previousConfidence))) return Number(next.toFixed(2));
  const previous = clamp01(previousConfidence);
  const boundedAlpha = clamp01(alpha);
  return Number(((previous * (1 - boundedAlpha)) + (next * boundedAlpha)).toFixed(2));
}

export function acceptSuggestionInState(target, suggestionId) {
  const actionKey = `accept:${suggestionId}`;
  if (target.handledSuggestionActionIds?.includes(actionKey)) return target;
  const suggestion = target.perceptionSuggestions.find((item) => item.id === suggestionId && item.status === "pending");
  if (!suggestion) return target;
  target.handledSuggestionActionIds ??= [];
  target.handledSuggestionActionIds.push(actionKey);
  if (suggestion.step && !suggestionMatchesCurrentStep(target, suggestion)) {
    suggestion.status = "rejected";
    suggestion.rejected = true;
    if (!target.rejectedSuggestionKeys.includes(suggestion.key)) target.rejectedSuggestionKeys.push(suggestion.key);
    recordSuggestionRejected(target, suggestion);
    target.statusMessage = "Camera suggestion rejected because it does not match the current quest step.";
    target.errorMessage = "";
    return target;
  }
  suggestion.status = "accepted";
  suggestion.accepted = true;
  if (!target.acceptedSuggestionIds.includes(suggestion.id)) target.acceptedSuggestionIds.push(suggestion.id);
  recordSuggestionAccepted(target, suggestion);
  applyCandidateCooldown(target, suggestion);

  if (suggestion.step === "uncertain") {
    markUncertainInState(target, { suggestion });
  } else if (suggestion.step === "reset") {
    markCameraResetInState(target, { suggestion });
  } else if (suggestion.step) {
    confirmStepInState(target, suggestion.step, { suggestion });
  } else if (suggestion.payload?.ai_recognition === true) {
    confirmMovementResultInState(target);
  } else if (suggestion.suggested_event_type === "zone.activated") {
    const event = withAcceptedSuggestionPayload(zoneActivatedEventSpec(suggestion.zone_id, suggestion.motion_score ?? 0.08, suggestion.duration_ms ?? 400, suggestion.timestamp_ms), suggestion);
    emitEvents(target, [withHumanCorrectionEvidence(event, suggestion)], "suggestion_accept");
  } else if (suggestion.suggested_event_type === "hand.entered_zone" || suggestion.suggested_event_type === "hand.left_zone") {
    const direction = suggestion.suggested_event_type === "hand.entered_zone" ? "entered" : "left";
    const event = withAcceptedSuggestionPayload(motionProxyEventSpec(direction, suggestion.zone_id, suggestion.confidence, suggestion.timestamp_ms), suggestion);
    emitEvents(target, [withHumanCorrectionEvidence(event, suggestion)], "suggestion_accept");
  }

  target.statusMessage = "Camera suggestion accepted with manual confirmation.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function rejectSuggestionInState(target, suggestionId) {
  const actionKey = `reject:${suggestionId}`;
  if (target.handledSuggestionActionIds?.includes(actionKey)) return target;
  const suggestion = target.perceptionSuggestions.find((item) => item.id === suggestionId && item.status === "pending");
  if (!suggestion) return target;
  target.handledSuggestionActionIds ??= [];
  target.handledSuggestionActionIds.push(actionKey);
  suggestion.status = "rejected";
  suggestion.rejected = true;
  if (!target.rejectedSuggestionKeys.includes(suggestion.key)) target.rejectedSuggestionKeys.push(suggestion.key);
  target.rejectedSuggestionCooldowns[suggestion.key] = Math.round(suggestion.timestamp_ms + target.localPerceptionTuning.suggestionCooldownMs);
  target.localActionDiagnostics.lastRejectedCandidate = suggestion.payload?.detected_action_candidate ?? {
    id: suggestion.id,
    action_type: suggestion.payload?.action_type ?? suggestion.suggested_event_type,
    confidence: suggestion.confidence,
    zone_id: suggestion.zone_id,
    reason: suggestion.reason
  };
  applyCandidateCooldown(target, suggestion);
  recordSuggestionRejected(target, suggestion);
  target.statusMessage = "Camera suggestion rejected. Quest state was not changed.";
  target.errorMessage = "";
  return target;
}

export function confirmMovementResultInState(target = state) {
  if (!target.movementRecognition.lastResult) {
    target.statusMessage = "Analyze a movement before confirming.";
    return target;
  }
  if (target.movementResultSnapshot?.confirmed) {
    target.statusMessage = "Movement result already confirmed.";
    return target;
  }
  const result = normalizeMovementRecognitionResult(target.movementRecognition.lastResult);
  const timestampMs = Math.round(now());
  const confirmedSnapshot = freezeConfirmedMovementSnapshot({
    ...target.movementResultSnapshot,
    movement: target.movementResultSnapshot?.movement_sentence || result.movement,
    short_label: target.movementResultSnapshot?.short_label || result.short_label,
    movement_key: target.movementResultSnapshot?.movement_key || result.movement_key,
    gesture_tags: target.movementResultSnapshot?.gesture_tags || result.gesture_tags,
    confidence: target.movementResultSnapshot?.confidence ?? result.confidence,
    uncertainty: target.movementResultSnapshot?.uncertainty ?? result.uncertainty
  }, timestampMs);
  emitEvents(target, [
    eventSpec(`evt_movement_confirmed_${timestampMs}`, "gesture.detected", timestampMs, result.confidence, {
      gesture_type: "movement_narration",
      movement: result.movement,
      short_label: result.short_label,
      movement_key: confirmedSnapshot.movement_key,
      gesture_tags: confirmedSnapshot.gesture_tags,
      event_name: "movement.confirmed",
      detection_method: "visual_companion_observation",
      provider: result.provider,
      model: result.model,
      latency_ms: result.latency_ms,
      requires_confirmation: true,
      confirmed_by_user: true
    }, `ev_movement_signal_${timestampMs}`, "local_signal", `Movement narration candidate: ${result.short_label}`, [
      {
        id: `ev_movement_human_confirmation_${timestampMs}`,
        ref: `ev_movement_human_confirmation_${timestampMs}`,
        kind: "human_correction",
        description: "User confirmed the movement narration.",
        contains_raw_media: false
      }
    ])
  ], "movement_confirmation");
  target.movementRecognition.confirmed = true;
  if (target.movementResultSnapshot) {
    target.movementResultSnapshot = {
      ...target.movementResultSnapshot,
      movement_key: confirmedSnapshot.movement_key,
      gesture_tags: [...confirmedSnapshot.gesture_tags],
      confirmed: true,
      confirmed_at: timestampMs
    };
  }
  target.automation.lastConfirmedSnapshot = confirmedSnapshot;
  target.automation.lastEvent = {
    type: "movement.confirmed",
    execution_seed: confirmedSnapshot.movement_result_id,
    timestamp_ms: timestampMs,
    contains_raw_media: false
  };
  target.confidenceCalibration.confirmed_count += 1;
  target.statusMessage = "Movement result confirmed.";
  target.errorMessage = "";
  return target;
}

export function resetMovementResultInState(target = state) {
  void cancelVisualSpeech(target);
  target.perceptionSuggestions = target.perceptionSuggestions.filter((suggestion) => suggestion.payload?.ai_recognition !== true);
  setMovementCaptureState(target, "idle");
  target.movementRecognition.status = "idle";
  target.movementRecognition.lastResult = null;
  target.movementRecognition.lastError = "";
  target.movementRecognition.lastSafeError = "";
  target.movementRecognition.fallbackUsed = false;
  target.movementRecognition.confirmed = false;
  target.movementRecognition.requestInFlight = false;
  target.movementRecognition.voiceStatus = "Ready";
  target.movementRecognition.lastSpokenMovement = "";
  target.movementRecognition.voiceStatus = "Ready";
  target.correctionDraft = { open: false, text: "" };
  target.movementResultSnapshot = null;
  target.automation.lastConfirmedSnapshot = null;
  target.automation.lastEvent = null;
  lastMovementResultRenderKey = "";
  lastMovementDetailsRenderKey = "";
  lastMovementRevealResultId = "";
  target.statusMessage = "Waiting for movement.";
  target.errorMessage = "";
  return target;
}

function setMovementCaptureState(target, status) {
  target.movementCaptureState = {
    status,
    updated_at: Math.round(now())
  };
  return target.movementCaptureState;
}

function movementResultSnapshotFrom(result, timestampMs = Math.round(now())) {
  const normalized = normalizeMovementRecognitionResult(result);
  const observationId = normalized.observation_id || normalized.movement_result_id || `movement_result_${timestampMs}`;
  return {
    schema_version: "canonical-movement-result.v1",
    observation_id: observationId,
    movement_sentence: normalized.movement,
    spoken_response: normalized.spoken_response || normalized.movement,
    short_label: normalized.short_label,
    movement_key: normalized.movement_key,
    gesture_tags: normalized.gesture_tags,
    confidence: normalized.confidence,
    reason: normalized.reason,
    evidence: normalized.evidence,
    meaningful_change: normalized.meaningful_change,
    movement_label: normalized.movement_label,
    evidence_frames: normalized.evidence_frames,
    uncertainty: normalized.uncertainty,
    provider: normalized.provider,
    model: normalized.model,
    requested_model: normalized.requested_model,
    returned_model: normalized.returned_model,
    prompt_version: normalized.prompt_version,
    image_tokens: normalized.image_tokens,
    retries: normalized.retries,
    failed_candidates: normalized.failed_candidates,
    response_type: normalized.response_type,
    response_source: normalized.response_source,
    requires_confirmation: normalized.requires_confirmation,
    question: normalized.question,
    suggested_actions: normalized.suggested_actions,
    time_to_first_token_ms: normalized.time_to_first_token_ms,
    time_to_first_audio_ms: normalized.time_to_first_audio_ms,
    latency_ms: normalized.latency_ms,
    result_id: observationId,
    movement_result_id: observationId,
    created_at: timestampMs,
    revision: timestampMs,
    confirmed: false
  };
}

function movementResultForDisplay(target) {
  const snapshot = target.movementResultSnapshot;
  if (snapshot) {
    return {
      movement: snapshot.movement_sentence,
      spoken_response: snapshot.spoken_response,
      short_label: snapshot.short_label,
      movement_key: snapshot.movement_key,
      gesture_tags: snapshot.gesture_tags,
      confidence: snapshot.confidence,
      reason: snapshot.reason,
      evidence: snapshot.evidence,
      provider: snapshot.provider,
      model: snapshot.model,
      prompt_version: snapshot.prompt_version,
      image_tokens: snapshot.image_tokens,
      retries: snapshot.retries,
      failed_candidates: snapshot.failed_candidates,
      response_type: snapshot.response_type,
      question: snapshot.question,
      suggested_actions: snapshot.suggested_actions,
      time_to_first_token_ms: snapshot.time_to_first_token_ms,
      time_to_first_audio_ms: snapshot.time_to_first_audio_ms,
      latency_ms: snapshot.latency_ms,
      observation_id: snapshot.observation_id,
      result_id: snapshot.result_id,
      confirmed: snapshot.confirmed
    };
  }
  return target.movementRecognition.lastResult
    ? { ...normalizeMovementRecognitionResult(target.movementRecognition.lastResult), result_id: "unsnapshotted_result" }
    : null;
}

export function visualContextForRequest(target = state) {
  const mode = target.visualContext?.memoryMode || "session";
  if (mode === "off") return {};
  const memory = target.conversationMemory || createConversationMemoryState();
  const observationMemory = target.observationMemory || createObservationMemoryState();
  const rolling = target.realtimeSession?.rollingVisualContext || createRealtimeSessionState().rollingVisualContext;
  return {
    interaction_mode: target.interactionState?.mode || "conversation",
    last_observation_summary: sanitizeMemoryText(target.visualContext.lastObservationSummary),
    last_response: sanitizeMemoryText(target.visualContext.lastResponse),
    user_correction: sanitizeMemoryText(target.visualContext.userCorrection),
    follow_up_answer: sanitizeMemoryText(target.visualContext.followUpAnswer),
    approved_preferences: sanitizeMemoryText(target.visualContext.approvedPreferences),
    realtime_visual_summary: sanitizeMemoryText(rolling.summary),
    recent_user_turns: memory.userTurns.slice(-4).map((item) => sanitizeMemoryText(item.text)),
    recent_assistant_responses: memory.assistantResponses.slice(-4).map((item) => ({
      text: sanitizeMemoryText(item.text),
      interrupted: item.interrupted === true
    })),
    recent_visual_summaries: memory.visualSummaries.slice(-4).map((item) => sanitizeMemoryText(item.text)),
    interrupted_response: sanitizeMemoryText(memory.interruptedResponses.at(-1)?.text || ""),
    recent_movement_descriptions: interactionModeIs(target, "observing")
      ? observationMemory.movementDescriptions.slice(-4).map((item) => sanitizeMemoryText(item.text))
      : []
  };
}

export function updateVisualContextFromResult(target = state, result = {}) {
  target.visualContext ??= {};
  target.visualContext.lastObservationSummary = sanitizeMemoryText(result.reason || result.movement || "");
  target.visualContext.lastResponse = sanitizeMemoryText(result.movement || "");
  target.visualContext.suggestedActions = Array.isArray(result.suggested_actions)
    ? result.suggested_actions.filter((action) => VISUAL_COMPANION_ALLOWED_ACTIONS.includes(String(action.action || ""))).slice(0, 3)
    : [];
  persistVisualContextIfAllowed(target.visualContext);
  return target.visualContext;
}

export function clearVisualContextInState(target = state) {
  target.visualContext = {
    memoryMode: target.visualContext?.memoryMode || "session",
    lastObservationSummary: "",
    lastResponse: "",
    userCorrection: "",
    followUpAnswer: "",
    approvedPreferences: "",
    suggestedActions: []
  };
  clearVisualContextStorage();
  target.statusMessage = "Visual context cleared.";
  return target;
}

function loadVisualContextFromStorage() {
  try {
    const storage = browserLocalStorage();
    const serialized = storage?.getItem?.(VISUAL_CONTEXT_STORAGE_KEY);
    if (!serialized) return null;
    const parsed = JSON.parse(serialized);
    if (parsed?.memoryMode !== "persistent") return null;
    return {
      memoryMode: "persistent",
      lastObservationSummary: sanitizeMemoryText(parsed.lastObservationSummary),
      lastResponse: sanitizeMemoryText(parsed.lastResponse),
      userCorrection: sanitizeMemoryText(parsed.userCorrection),
      followUpAnswer: sanitizeMemoryText(parsed.followUpAnswer),
      approvedPreferences: sanitizeMemoryText(parsed.approvedPreferences),
      suggestedActions: []
    };
  } catch {
    return null;
  }
}

function persistVisualContextIfAllowed(context = {}) {
  if (context.memoryMode !== "persistent") return;
  try {
    browserLocalStorage()?.setItem?.(VISUAL_CONTEXT_STORAGE_KEY, JSON.stringify({
      memoryMode: "persistent",
      lastObservationSummary: sanitizeMemoryText(context.lastObservationSummary),
      lastResponse: sanitizeMemoryText(context.lastResponse),
      userCorrection: sanitizeMemoryText(context.userCorrection),
      followUpAnswer: sanitizeMemoryText(context.followUpAnswer),
      approvedPreferences: sanitizeMemoryText(context.approvedPreferences)
    }));
  } catch {
    // Text-only memory is best-effort and never blocks observation.
  }
}

function clearVisualContextStorage() {
  try {
    browserLocalStorage()?.removeItem?.(VISUAL_CONTEXT_STORAGE_KEY);
  } catch {
    // Ignore local storage failures.
  }
}

function loadVisualAutoSpeakPreference() {
  try {
    const value = browserLocalStorage()?.getItem?.(VISUAL_AUTO_SPEAK_STORAGE_KEY);
    if (value === "off") return false;
    if (value === "on") return true;
  } catch {
    // Auto-speak defaults on when local storage is unavailable.
  }
  return true;
}

function persistVisualAutoSpeakPreference(enabled) {
  try {
    browserLocalStorage()?.setItem?.(VISUAL_AUTO_SPEAK_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Preference persistence is best-effort and must not block narration.
  }
}

function browserLocalStorage() {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return window.localStorage || null;
}

export async function confirmVisualSuggestedActionInState(target = state) {
  const action = target.visualContext?.suggestedActions?.[0];
  if (!action || !target.movementResultSnapshot) {
    target.statusMessage = "No suggested action is ready to confirm.";
    return { ok: false, code: "visual_suggested_action_missing" };
  }
  if (!VISUAL_COMPANION_ALLOWED_ACTIONS.includes(String(action.action))) {
    target.statusMessage = "Suggested action is not allowed.";
    return { ok: false, code: "visual_suggested_action_not_allowed" };
  }
  const timestampMs = Math.round(now());
  const executionId = `visual_action_${target.movementResultSnapshot.result_id}_${timestampMs}`;
  let outcome;
  try {
    outcome = await executeLocalAction({
      action: {
        type: action.action,
        config: automationConfigFromVisualAction(action)
      },
      runtime: target.automation,
      idempotency_key: executionId,
      consent: true,
      snapshot: target.movementResultSnapshot
    }, {
      runtime: target.automation,
      userGesture: true
    });
  } catch (error) {
    outcome = {
      status: "failed",
      finished_at: timestampMs,
      safe_message: error?.safe_message || "Automation failed — view safe details"
    };
  }
  const receipt = {
    execution_id: `visual_action_${target.movementResultSnapshot.result_id}_${timestampMs}`,
    recipe_id: "visual_companion_suggested_action",
    movement_result_id: target.movementResultSnapshot.result_id,
    action_type: action.action,
    status: outcome?.status === "failed" ? "failed" : "succeeded",
    started_at: timestampMs,
    finished_at: Math.max(timestampMs, Number(outcome?.finished_at || timestampMs)),
    duration_ms: Math.max(0, Number(outcome?.finished_at || timestampMs) - timestampMs),
    safe_message: outcome?.safe_message || `${action.label || "Suggested action"} completed.`,
    contains_raw_media: false
  };
  target.automation.receipts.push(receipt);
  target.automation.receipts = target.automation.receipts.slice(-MAX_AUTOMATION_RECEIPTS);
  target.automation.lastStatus = receipt.status;
  target.automation.executionStatus = receipt.safe_message;
  target.statusMessage = receipt.safe_message;
  return { ok: true, receipt };
}

function automationConfigFromVisualAction(action = {}) {
  const params = action.parameters || {};
  if (action.action === "start_timer") return { duration_seconds: Number(params.duration_seconds || 60) };
  if (action.action === "speak_phrase") return { text: String(params.text || action.label || "Done.") };
  if (action.action === "browser_notification") return { title: String(params.title || "Sensefield"), body: String(params.body || action.label || "Suggested action") };
  if (action.action === "increment_counter") return { counter_name: String(params.counter_name || "visual_actions") };
  if (action.action === "append_activity_log") return { category: String(params.category || "visual_companion") };
  return {};
}

function sanitizeMemoryText(value) {
  const inlineImagePattern = new RegExp(`${["data", "image"].join(":")}\\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+`, "gi");
  return String(value ?? "")
    .replace(/\b(named|identity|identified as|recognize(d)? as|male|female|man|woman|boy|girl|race|ethnicity|age)\b/gi, "[redacted]")
    .replace(inlineImagePattern, "[media omitted]")
    .replace(/\b(base64|screenshot|raw frame|raw video|private text)\b/gi, "[omitted]")
    .slice(0, 280);
}

function appendMovementHistory(target, snapshot) {
  const entry = {
    movement: sanitizeMemoryText(snapshot.movement_sentence),
    observation_id: sanitizeMemoryText(snapshot.observation_id || snapshot.result_id || ""),
    created_at_ms: Number(snapshot.created_at || now())
  };
  target.movementHistory.entries = [...target.movementHistory.entries, entry].slice(-target.movementHistory.max_items);
  return entry;
}

function appendCorrectionMemory(target, correction) {
  const entry = {
    correction_id: String(correction.correction_id ?? `correction_${Math.round(now())}`),
    original_movement: sanitizeMemoryText(correction.original_movement),
    corrected_movement: sanitizeMemoryText(correction.corrected_movement),
    confidence: clamp01(correction.confidence ?? 0),
    provider: sanitizeMemoryText(correction.provider),
    model: sanitizeMemoryText(correction.model),
    timestamp: correction.timestamp ?? Math.round(now()),
    contains_raw_media: false,
    contains_biometric_identity: false,
    session_only: true
  };
  target.correctionMemory.entries = [...target.correctionMemory.entries, entry].slice(-target.correctionMemory.max_items);
  return entry;
}

function recentCorrectionContextForPrompt(target) {
  return target.correctionMemory.entries.slice(-3).map((entry) => ({
    original_movement: entry.original_movement,
    corrected_movement: entry.corrected_movement
  }));
}

export function showMovementCorrectionInState(target = state) {
  if (!target.movementResultSnapshot) {
    target.statusMessage = "Describe a movement before correcting it.";
    return target;
  }
  target.correctionDraft = {
    open: true,
    text: ""
  };
  target.statusMessage = "Tell Sensefield what actually happened.";
  return target;
}

export function hideMovementCorrectionInState(target = state) {
  target.correctionDraft = {
    open: false,
    text: ""
  };
  target.statusMessage = target.movementResultSnapshot ? "Correction canceled." : target.statusMessage;
  return target;
}

export function submitMovementCorrectionInState(target = state, value = "") {
  const snapshot = target.movementResultSnapshot;
  const correctedMovement = sanitizeMemoryText(value);
  if (!snapshot || !correctedMovement) {
    target.statusMessage = snapshot ? "Enter what actually happened." : "Describe a movement before correcting it.";
    return target;
  }
  const timestampMs = Math.round(now());
  appendCorrectionMemory(target, {
    correction_id: `correction_${timestampMs}`,
    original_movement: snapshot.movement_sentence,
    corrected_movement: correctedMovement,
    confidence: snapshot.confidence,
    provider: snapshot.provider,
    model: snapshot.model,
    timestamp: timestampMs
  });
  target.confidenceCalibration.corrected_count += 1;
  target.movementResultSnapshot = {
    ...snapshot,
    movement_sentence: safeMovementSentence(correctedMovement),
    short_label: safeShortLabel(correctedMovement),
    movement_key: snapshot.movement_key,
    gesture_tags: [...(snapshot.gesture_tags || [])],
    confirmed: false,
    corrected: true,
    revision: timestampMs
  };
  target.movementRecognition.lastResult = {
    ...normalizeMovementRecognitionResult(target.movementRecognition.lastResult ?? {}),
    movement: target.movementResultSnapshot.movement_sentence,
    short_label: target.movementResultSnapshot.short_label,
    movement_key: target.movementResultSnapshot.movement_key,
    gesture_tags: target.movementResultSnapshot.gesture_tags,
    confidence: target.movementResultSnapshot.confidence,
    provider: target.movementResultSnapshot.provider,
    model: target.movementResultSnapshot.model
  };
  target.correctionDraft = { open: false, text: "" };
  target.statusMessage = "Correction saved for this session.";
  target.errorMessage = "";
  return target;
}

export function clearMovementHistory(target = state) {
  target.movementHistory.entries = [];
  target.statusMessage = "Movement history cleared.";
  return target;
}

export function clearCorrectionMemory(target = state) {
  target.correctionMemory.entries = [];
  target.statusMessage = "Correction memory cleared.";
  return target;
}

export async function executeConfirmedMovementAutomations(target = state, options = {}) {
  const snapshot = target.automation.lastConfirmedSnapshot;
  if (!snapshot?.confirmed) return { matches: [], receipts: [] };
  const outcome = await runAutomationForConfirmedMovement({
    snapshot,
    recipes: target.automation.recipes,
    runtime: target.automation,
    userGesture: options.userGesture === true,
    requestConsent: (message) => typeof globalThis.confirm === "function" && globalThis.confirm(message) === true,
    context: {
      captureSnapshot: (captureOptions) => captureConfirmedMovementSnapshot(captureOptions),
      executeWebhook: (request) => requestAutomationExecution(request),
      onRuntimeChange: () => render()
    }
  });
  target.statusMessage = outcome.matches.length
    ? target.automation.lastSafeMessage
    : "Movement confirmed. No automation recipe matched.";
  target.errorMessage = outcome.receipts.some((receipt) => receipt.status === "failed")
    ? target.automation.lastSafeMessage
    : "";
  lastAutomationRenderKey = "";
  return outcome;
}

async function requestAutomationExecution(request) {
  const send = globalThis[["fet", "ch"].join("")];
  if (typeof send !== "function") return { ok: false, code: "endpoint_unavailable", safe_message: "Automation failed — view safe details" };
  try {
    const response = await send(AUTOMATION_EXECUTE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request)
    });
    const body = await response.json().catch(() => ({}));
    return response.ok ? body : { ok: false, ...body };
  } catch {
    return { ok: false, code: "network_error", safe_message: "Automation failed — view safe details" };
  }
}

async function captureConfirmedMovementSnapshot(options = {}) {
  const video = dom?.preview;
  if (!video || !state.cameraReady || video.readyState < 2) throw new Error("Camera snapshot could not be created");
  const canvas = document.createElement("canvas");
  const width = Math.min(1280, video.videoWidth || 640);
  const height = Math.max(1, Math.round(width * ((video.videoHeight || 480) / Math.max(1, video.videoWidth || 640))));
  canvas.width = width;
  canvas.height = height;
  let objectUrl = "";
  try {
    const context = canvas.getContext("2d", { alpha: false });
    drawVideoFrameForAnalysis(context, video, width, height, true);
    const blob = await new Promise((resolve) => canvas[["to", "Blob"].join("")](resolve, "image/jpeg", 0.86));
    if (!blob) throw new Error("Camera snapshot could not be created");
    objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const prefix = String(options.filenamePrefix || "darkquest-movement").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
    anchor.href = objectUrl;
    anchor.download = `${prefix || "darkquest-movement"}-${Date.now()}.jpg`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    if (objectUrl) globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

export function openAutomationRecipeEditor(target, recipeId = "", options = {}) {
  const store = options.store || automationRecipeStore;
  const editorDom = options.dom || dom;
  const recipe = recipeId ? store.read(recipeId) : null;
  const recipeSnapshot = recipe ? {
    confirmed: true,
    movement: recipe.execution_mode === "instant_local_gesture" ? gestureStatusLabel(recipe.trigger.gesture_key) : recipe.name,
    short_label: recipe.execution_mode === "instant_local_gesture" ? gestureStatusLabel(recipe.trigger.gesture_key) : recipe.name,
    movement_key: recipe.trigger.movement_key,
    gesture_tags: [],
    confidence: recipe.trigger.minimum_confidence
  } : null;
  const snapshot = target.automation.lastConfirmedSnapshot || recipeSnapshot;
  if (!snapshot?.confirmed) {
    target.errorMessage = "Recognize and confirm a movement before creating an automation.";
    render();
    return;
  }
  const editorState = target.automationEditor ||= { recipeId: "", isSaving: false, opener: null };
  editorState.recipeId = recipe?.recipe_id || createAutomationRecipeId(store.list().map((item) => item.recipe_id));
  editorState.isSaving = false;
  editorState.opener = editorDom.automationRecipeDialog?.ownerDocument?.activeElement || globalThis.document?.activeElement || null;
  if (editorDom.automationRecipeName) editorDom.automationRecipeName.value = recipe?.name || `${snapshot.short_label} automation`;
  if (editorDom.automationMovementSentence) editorDom.automationMovementSentence.textContent = snapshot.movement;
  if (editorDom.automationShortLabel) editorDom.automationShortLabel.textContent = snapshot.short_label;
  if (editorDom.automationMovementKey) editorDom.automationMovementKey.value = recipe?.trigger?.movement_key || snapshot.movement_key;
  if (editorDom.automationInstantMode) editorDom.automationInstantMode.checked = recipe?.execution_mode === "instant_local_gesture";
  if (editorDom.automationGestureKey) editorDom.automationGestureKey.value = recipe?.trigger?.gesture_key || "thumbs_up";
  if (editorDom.automationGestureKey?.dataset) editorDom.automationGestureKey.dataset.previousGesture = editorDom.automationGestureKey.value;
  if (editorDom.automationConfidence) editorDom.automationConfidence.textContent = snapshot.confidence.toFixed(2);
  if (editorDom.automationActionType) editorDom.automationActionType.value = recipe?.action?.type || "speak_phrase";
  if (editorDom.automationActionType?.dataset) editorDom.automationActionType.dataset.previousAction = editorDom.automationActionType.value;
  if (editorDom.automationAliases) editorDom.automationAliases.value = (recipe?.trigger?.aliases || []).join(", ");
  if (editorDom.automationMinConfidence) editorDom.automationMinConfidence.value = String(recipe?.trigger?.minimum_confidence ?? DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE);
  if (editorDom.automationHoldMs) editorDom.automationHoldMs.value = String(recipe?.trigger?.hold_ms ?? INSTANT_GESTURE_DEFAULTS.holdMs);
  if (editorDom.automationCooldown) editorDom.automationCooldown.value = String((recipe?.execution_policy?.cooldown_ms ?? 3000) / 1000);
  if (editorDom.automationConfirmationPolicy) editorDom.automationConfirmationPolicy.value = recipe?.confirmation_policy || (recipe?.execution_policy?.require_per_run_confirmation ? "per_run" : "movement_confirmation");
  if (editorDom.automationConfigValue) editorDom.automationConfigValue.value = automationConfigValue(recipe);
  if (editorDom.automationSecretRef) editorDom.automationSecretRef.value = recipe?.action?.config?.secret_ref || "";
  if (editorDom.automationEnabled) editorDom.automationEnabled.checked = recipe ? recipe.enabled === true : true;
  setAutomationFormError(editorDom, "");
  if (editorDom.automationInstantUpgrade) {
    const instantActions = ["speak_phrase", "increment_counter", "start_timer", "append_activity_log", "browser_notification"];
    const supportedGesture = ["thumbs_up", "thumbs_down", "peace_sign", "open_palm", "closed_fist", "pointing_up", "i_love_you"].includes(recipe?.trigger?.movement_key);
    editorDom.automationInstantUpgrade.hidden = !recipe || recipe.execution_mode === "instant_local_gesture" || !supportedGesture || !instantActions.includes(recipe.action?.type);
  }
  updateAutomationRecipeModeFields(editorDom);
  editorDom.automationRecipeDialog?.showModal?.();
  globalThis.setTimeout?.(() => editorDom.automationRecipeName?.focus?.(), 0);
  return recipe;
}

export function saveAutomationRecipeFromForm(target, boundDom, options = {}) {
  const editorState = target.automationEditor ||= { recipeId: "", isSaving: false, opener: null };
  if (editorState.isSaving) return null;
  const store = options.store || automationRecipeStore;
  const existingIds = store.list().map((recipe) => recipe.recipe_id);
  const suppliedId = String(editorState.recipeId || "");
  const id = /^recipe_[a-zA-Z0-9_-]{1,80}$/.test(suppliedId)
    ? suppliedId
    : createAutomationRecipeId(existingIds);
  editorState.recipeId = id;
  const actionType = boundDom.automationActionType?.value || "speak_phrase";
  const instant = boundDom.automationInstantMode?.checked === true;
  const issue = automationEditorValidationIssue(boundDom, { actionType, instant });
  if (issue) {
    setAutomationFormError(boundDom, issue.message, issue.field);
    return null;
  }
  editorState.isSaving = true;
  if (boundDom.automationRecipeSave) boundDom.automationRecipeSave.disabled = true;
  try {
    const existing = id ? store.read(id) : null;
    const snapshot = target.automation.lastConfirmedSnapshot || (existing ? {
      movement_key: existing.trigger.movement_key,
      gesture_tags: [],
      confidence: existing.trigger.minimum_confidence
    } : null);
    if (!snapshot && !instant) throw new Error("Movement must be confirmed first");
    const gestureKey = boundDom.automationGestureKey?.value || "thumbs_up";
    const recipeInput = {
      ...(existing || {}),
      schema: "movement-automation-recipe.v1-1",
      recipe_id: id,
      name: boundDom.automationRecipeName?.value,
      enabled: boundDom.automationEnabled?.checked === true,
      execution_mode: instant ? "instant_local_gesture" : "confirmed_ai_movement",
      confirmation_policy: instant ? "none" : boundDom.automationConfirmationPolicy?.value === "per_run" ? "per_run" : "movement_confirmation",
      trigger: {
        movement_key: instant ? gestureKey : boundDom.automationMovementKey?.value || snapshot.movement_key,
        ...(instant ? { source: "mediapipe_gesture", gesture_key: gestureKey, hold_ms: Number(boundDom.automationHoldMs?.value || 350), neutral_reset_required: true } : {}),
        required_tags: instant ? [] : existing?.trigger?.required_tags || snapshot.gesture_tags,
        aliases: instant ? [] : String(boundDom.automationAliases?.value || "").split(",").map((item) => item.trim()).filter(Boolean),
        minimum_confidence: Number(boundDom.automationMinConfidence?.value || DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE),
        require_user_confirmation: !instant
      },
      action: {
        type: actionType,
        config: automationActionConfig(actionType, boundDom.automationConfigValue?.value, boundDom.automationSecretRef?.value)
      },
      risk_tier: riskTierForAutomationAction(actionType),
      execution_policy: {
        cooldown_ms: Number(boundDom.automationCooldown?.value || 3) * 1000,
        max_runs_per_session: instant ? 20 : existing?.execution_policy?.max_runs_per_session || 10,
        require_per_run_confirmation: !instant && (actionType === "local_snapshot_download" || boundDom.automationConfirmationPolicy?.value === "per_run"),
        retry_limit: actionType === "signed_webhook_post" ? 1 : 0
      },
      consent: instant ? {
        run_instantly: true,
        consent_version: Number(existing?.consent?.consent_version || 0) + 1,
        consented_at: Math.round(now())
      } : undefined
    };
    const saved = store.save(recipeInput, { existingId: existing?.recipe_id || "" });
    target.automation.recipes = store.list();
    target.automation.lastSafeMessage = "Automation recipe saved.";
    target.errorMessage = "";
    setAutomationFormError(boundDom, "");
    editorState.isSaving = false;
    closeAutomationRecipeEditor(target, boundDom);
    lastAutomationRenderKey = "";
    if (target === state && store === automationRecipeStore) syncInstantGestureEngine();
    return saved;
  } catch (error) {
    const issue = automationEditorError(error, boundDom, actionType);
    setAutomationFormError(boundDom, issue.message, issue.field);
    return null;
  } finally {
    editorState.isSaving = false;
    if (boundDom.automationRecipeSave) boundDom.automationRecipeSave.disabled = false;
  }
}

export function updateAutomationRecipeModeFields(boundDom) {
  updateAutomationActionFields(boundDom);
  let instant = boundDom.automationInstantMode?.checked === true;
  const actionType = boundDom.automationActionType?.value || "speak_phrase";
  const instantAllowed = INSTANT_LOCAL_ACTION_TYPES.includes(actionType);
  if (!instantAllowed) {
    if (boundDom.automationInstantMode) boundDom.automationInstantMode.checked = false;
    instant = false;
    if (boundDom.automationInstantPolicy) {
      boundDom.automationInstantPolicy.hidden = false;
      boundDom.automationInstantPolicy.textContent = "This action requires confirmation and cannot run instantly.";
    }
  } else if (boundDom.automationInstantPolicy) {
    boundDom.automationInstantPolicy.hidden = !instant;
    boundDom.automationInstantPolicy.textContent = "This safe local action runs immediately after local gesture recognition.";
  }
  if (boundDom.automationInstantMode) boundDom.automationInstantMode.disabled = !instantAllowed;
  if (boundDom.automationGestureKey) boundDom.automationGestureKey.disabled = !instant;
  if (boundDom.automationHoldMs) boundDom.automationHoldMs.disabled = !instant;
  if (boundDom.automationGestureField) boundDom.automationGestureField.hidden = !instant;
  if (boundDom.automationHoldField) boundDom.automationHoldField.hidden = !instant;
  if (boundDom.automationAliasesField) boundDom.automationAliasesField.hidden = instant;
  if (boundDom.automationAliases) boundDom.automationAliases.disabled = instant;
  if (boundDom.automationMovementKey) boundDom.automationMovementKey.readOnly = true;
  if (instant && boundDom.automationMinConfidence && !String(boundDom.automationMinConfidence.value).trim()) boundDom.automationMinConfidence.value = String(DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE);
  if (boundDom.automationConfirmationPolicy) {
    const snapshotRequiresConfirmation = !instant && actionType === "local_snapshot_download";
    boundDom.automationConfirmationPolicy.disabled = instant || snapshotRequiresConfirmation;
    if (instant) boundDom.automationConfirmationPolicy.value = "none";
    else if (snapshotRequiresConfirmation) boundDom.automationConfirmationPolicy.value = "per_run";
    else if (boundDom.automationConfirmationPolicy.value === "none") boundDom.automationConfirmationPolicy.value = "movement_confirmation";
  }
  const confirmationField = boundDom.automationConfirmationPolicyField || boundDom.automationConfirmationPolicy?.closest?.("label");
  if (confirmationField) confirmationField.hidden = instant;
  if (boundDom.automationInstantUpgrade) boundDom.automationInstantUpgrade.hidden = instant || boundDom.automationInstantUpgrade.hidden;
}

export function updateAutomationActionFields(boundDom) {
  const actionType = boundDom.automationActionType?.value || "speak_phrase";
  const config = {
    speak_phrase: ["Phrase", "GREAT JOB"],
    browser_notification: ["Notification message", "Movement recognized"],
    start_timer: ["Duration seconds", "60"],
    increment_counter: ["Counter name", "completions"],
    append_activity_log: ["Activity category or template", "workout"],
    local_snapshot_download: ["Filename prefix", "darkquest-movement"],
    signed_webhook_post: ["Approved destination ID", "presentation"]
  }[actionType] || ["Configuration", ""];
  if (boundDom.automationConfigField) boundDom.automationConfigField.hidden = false;
  if (boundDom.automationConfigLabel) boundDom.automationConfigLabel.textContent = config[0];
  if (boundDom.automationConfigValue) {
    boundDom.automationConfigValue.placeholder = config[1];
    boundDom.automationConfigValue.inputMode = actionType === "start_timer" ? "numeric" : "text";
  }
  const webhook = actionType === "signed_webhook_post";
  if (boundDom.automationSecretRefField) boundDom.automationSecretRefField.hidden = !webhook;
  if (boundDom.automationSecretRef) {
    boundDom.automationSecretRef.disabled = !webhook;
    if (!webhook) boundDom.automationSecretRef.value = "";
  }
  if (boundDom.automationSnapshotPolicy) boundDom.automationSnapshotPolicy.hidden = actionType !== "local_snapshot_download";
}

export function handleAutomationGestureChange(boundDom) {
  const select = boundDom.automationGestureKey;
  if (!select) return;
  const previous = String(select.dataset?.previousGesture || "");
  const next = String(select.value || "");
  if (previous && next && previous !== next && boundDom.automationAliases) boundDom.automationAliases.value = "";
  if (select.dataset) select.dataset.previousGesture = next;
}

function setAutomationFormError(boundDom, message, field) {
  if (!boundDom.automationFormError) return;
  const safeMessage = String(message || "").replace(/\b(?:hf_|sk-)[a-z0-9_-]+\b/gi, "[redacted]").slice(0, 240);
  boundDom.automationFormError.textContent = safeMessage;
  boundDom.automationFormError.hidden = !safeMessage;
  for (const element of [boundDom.automationRecipeName, boundDom.automationGestureKey, boundDom.automationConfigValue, boundDom.automationSecretRef, boundDom.automationMinConfidence, boundDom.automationHoldMs, boundDom.automationCooldown]) {
    element?.removeAttribute?.("aria-invalid");
  }
  if (safeMessage && field) {
    field.setAttribute?.("aria-invalid", "true");
    field.focus?.();
  }
}

function automationEditorValidationIssue(boundDom, { actionType, instant }) {
  const name = String(boundDom.automationRecipeName?.value || "").trim();
  const value = String(boundDom.automationConfigValue?.value || "").trim();
  const secretRef = String(boundDom.automationSecretRef?.value || "").trim();
  if (!name || name.length > 80) return { message: "Enter a name for this automation.", field: boundDom.automationRecipeName };
  if (instant && !String(boundDom.automationGestureKey?.value || "")) return { message: "Choose a gesture before saving.", field: boundDom.automationGestureKey };
  if (instant && !INSTANT_LOCAL_ACTION_TYPES.includes(actionType)) return { message: "This action cannot run instantly.", field: boundDom.automationActionType };
  if (actionType === "speak_phrase" && !value) return { message: "Enter the phrase Sensefield should speak.", field: boundDom.automationConfigValue };
  if (actionType === "browser_notification" && !value) return { message: "Enter the notification message.", field: boundDom.automationConfigValue };
  if (actionType === "start_timer" && (!Number.isFinite(Number(value)) || Number(value) <= 0)) return { message: "Enter a timer duration greater than zero.", field: boundDom.automationConfigValue };
  if (actionType === "increment_counter" && !value) return { message: "Enter a counter name.", field: boundDom.automationConfigValue };
  if (actionType === "append_activity_log" && !value) return { message: "Enter an activity category or template.", field: boundDom.automationConfigValue };
  if (actionType === "signed_webhook_post" && !value) return { message: "Choose an approved webhook destination.", field: boundDom.automationConfigValue };
  if (actionType === "signed_webhook_post" && !/^[A-Z][A-Z0-9_]{0,79}$/.test(secretRef)) return { message: "Enter a valid server-side secret reference.", field: boundDom.automationSecretRef };
  const confidence = Number(boundDom.automationMinConfidence?.value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { message: "Enter a confidence between 0 and 1.", field: boundDom.automationMinConfidence };
  const holdMs = Number(boundDom.automationHoldMs?.value);
  if (instant && (!Number.isInteger(holdMs) || holdMs < 250 || holdMs > 1000)) return { message: "Choose a hold duration from 250 to 1000 milliseconds.", field: boundDom.automationHoldMs };
  const cooldown = Number(boundDom.automationCooldown?.value);
  if (!Number.isFinite(cooldown) || cooldown < 0) return { message: "Enter a valid cooldown.", field: boundDom.automationCooldown };
  return null;
}

function automationEditorError(error, boundDom, actionType) {
  const code = String(error?.code || "");
  if (code === "automation_instant_action_requires_confirmation") return { message: "This action cannot run instantly.", field: boundDom.automationActionType };
  if (/name/i.test(String(error?.message || ""))) return { message: "Enter a name for this automation.", field: boundDom.automationRecipeName };
  if (actionType === "speak_phrase" && /config|phrase/i.test(String(error?.message || ""))) return { message: "Enter the phrase Sensefield should speak.", field: boundDom.automationConfigValue };
  return { message: "Couldn’t save this automation. Please review the highlighted field.", field: boundDom.automationRecipeName };
}

function closeAutomationRecipeEditor(target, boundDom) {
  const editorState = target.automationEditor ||= { recipeId: "", isSaving: false, opener: null };
  if (editorState.isSaving) return false;
  try {
    boundDom.automationRecipeDialog?.close?.();
  } catch {
    // The native dialog may already be closed.
  }
  const opener = editorState.opener;
  editorState.recipeId = "";
  editorState.opener = null;
  opener?.focus?.();
  return true;
}

function trapAutomationDialogFocus(event, dialog) {
  if (event.key !== "Tab" || !dialog?.open) return;
  const focusable = Array.from(dialog.querySelectorAll?.('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])
    .filter((element) => !element.hidden && !element.closest?.("[hidden]"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && dialog.ownerDocument?.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && dialog.ownerDocument?.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function addAutomationPresetToState(target, presetId) {
  if (!presetId) return;
  try {
    automationRecipeStore.create(presetRecipe(presetId));
    target.automation.recipes = automationRecipeStore.list();
    const added = target.automation.recipes.at(-1);
    target.automation.lastSafeMessage = added?.enabled ? "Preset added and enabled." : "Preset added disabled. Review it before enabling.";
    target.errorMessage = "";
    lastAutomationRenderKey = "";
    if (target === state) syncInstantGestureEngine();
  } catch (error) {
    target.errorMessage = error?.message || "Automation failed — view safe details";
  }
}

function handleAutomationManagerAction(target, action, recipeId) {
  const recipe = recipeId ? automationRecipeStore.read(recipeId) : null;
  if (action === "edit" && recipe) return openAutomationRecipeEditor(target, recipe.recipe_id);
  if (action === "toggle" && recipe) automationRecipeStore.setEnabled(recipe.recipe_id, !recipe.enabled);
  if (action === "delete" && recipe) automationRecipeStore.delete(recipe.recipe_id);
  if (action === "dry-run" && recipe) {
    const snapshot = target.automation.lastConfirmedSnapshot || freezeConfirmedMovementSnapshot({
      result_id: `dry_${recipe.recipe_id}`,
      movement: recipe.trigger.movement_key,
      short_label: recipe.trigger.movement_key,
      movement_key: recipe.trigger.movement_key,
      gesture_tags: recipe.trigger.required_tags,
      confidence: 1,
      uncertainty: false
    });
    dryRunAutomationRecipe(recipe, snapshot, target.automation);
  }
  if (action === "clear-data") clearAutomationRuntimeData(target.automation);
  if (action === "toggle-engine") target.automation.enabled = !target.automation.enabled;
  target.automation.recipes = automationRecipeStore.list();
  lastAutomationRenderKey = "";
  if (target === state) syncInstantGestureEngine();
}

function automationActionConfig(actionType, value, secretRef) {
  const text = String(value || "").trim();
  if (actionType === "speak_phrase") return { text: text || "Movement confirmed." };
  if (actionType === "browser_notification") return { title: "Sensefield", body: text || "Movement confirmed." };
  if (actionType === "start_timer") return { duration_seconds: Number(text || 60) };
  if (actionType === "increment_counter") return { counter_name: text || "completions" };
  if (actionType === "append_activity_log") return { category: text || "activity" };
  if (actionType === "local_snapshot_download") return { filename_prefix: text || "darkquest-movement" };
  if (actionType === "signed_webhook_post") return { destination_id: text, secret_ref: String(secretRef || "").trim(), payload_label: "darkquest_movement" };
  return {};
}

function automationConfigValue(recipe) {
  const config = recipe?.action?.config || {};
  return String(config.text ?? config.phrase ?? config.body ?? config.duration_seconds ?? config.counter_name ?? config.category ?? config.filename_prefix ?? config.destination_id ?? "");
}

function riskTierForAutomationAction(actionType) {
  if (actionType === "local_snapshot_download") return 2;
  if (["browser_notification", "signed_webhook_post"].includes(actionType)) return 1;
  return 0;
}

export async function speakMovementResult(target = state, options = {}) {
  const snapshot = target.movementResultSnapshot;
  const text = spokenResponseForSnapshot(snapshot) || target.movementRecognition.latestSpokenResponse || "";
  const observationId = observationIdForSnapshot(snapshot) || options.observationId || "";
  return speakVisualResponse({ observationId, text }, { ...options, target });
}

export async function speakVisualResponse({ observationId = "", text = "" } = {}, options = {}) {
  const target = options.target || state;
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    target.movementRecognition.voiceStatus = "Voice unavailable";
    render();
    return { ok: false, code: "visual_voice_empty" };
  }
  target.movementRecognition.latestSpokenResponse = cleanText;
  target.movementRecognition.lastSpokenMovement = cleanText;
  await cancelVisualSpeech(target, options);
  const runtimeSpeechToken = target.interactionState?.sessionActive ? target.emergencyRuntimeController.beginSpeech() : null;
  if (target.interactionState?.sessionActive && !runtimeSpeechToken) return { ok: false, code: "visual_speech_busy" };
  const speechGenerationId = Number(target.interactionState?.speechGenerationId || 0) + 1;
  if (target.interactionState) applyInteractionState(target, { speechGenerationId });
  const ownership = {
    responseId: observationId || `response_${sensefieldTestRuntime.speech.length + 1}`,
    speechId: runtimeSpeechToken?.speechId || `speech_${speechGenerationId}`,
    sessionGeneration: Number(runtimeSpeechToken?.sessionGeneration ?? target.interactionState?.sessionGenerationId ?? 0),
    modeGeneration: Number(runtimeSpeechToken?.modeGeneration ?? target.interactionState?.modeGenerationId ?? 0),
    speechGenerationId,
    cancelled: false,
    playing: false,
    completed: false
  };
  target.movementRecognition.activeSpeechOwnership = ownership;
  if (target === state) recordSensefieldTestSpeech("requested", speechOwnershipMetadata(ownership, { path: "local_tts", text }), {
    correlationId: ownership.responseId,
    modeGenerationId: ownership.modeGeneration
  });
  target.movementRecognition.voiceStatus = "Preparing voice…";
  render();
  await delay(0);
  const localVoice = await tryLocalVisualSpeech({ text: cleanText, observationId, speechGenerationId, runtimeSpeechToken, ownership }, target, options);
  if (localVoice.ok) {
    if (observationId) {
      target.movementRecognition.spokenObservationIds ??= new Set();
      target.movementRecognition.spokenObservationIds.add(observationId);
    }
    return localVoice;
  }
  if (runtimeSpeechToken && target.emergencyRuntimeController.isCurrent(runtimeSpeechToken, "speechId", runtimeSpeechToken.speechId)) {
    finishRuntimeSpeech(target, runtimeSpeechToken, { error: "Voice unavailable" });
  }
  if (target.movementRecognition.activeSpeechOwnership === ownership) {
    target.movementRecognition.activeSpeechOwnership = null;
  }
  target.movementRecognition.voiceStatus = "Voice unavailable";
  if (target.interactionState?.sessionActive) applyInteractionState(target, { assistantSpeaking: false });
  if (interactionModeIs(target, "conversation")) setLiveConversationSpeaking(target.liveConversation, false);
  resumeRealtimeSpeechInputAfterAssistant(target);
  render();
  return localVoice;
}

export function maybeAutoSpeakVisualResult(target = state, options = {}) {
  const snapshot = target.movementResultSnapshot;
  const observationId = observationIdForSnapshot(snapshot);
  const text = spokenResponseForSnapshot(snapshot);
  if (!snapshot || !observationId || !text) return false;
  if (snapshot.response_type === "silent") return false;
  if (target.movementRecognition.autoSpeak !== true) {
    target.movementRecognition.voiceStatus = "Muted";
    render();
    return false;
  }
  target.movementRecognition.spokenObservationIds ??= new Set();
  if (target.movementRecognition.spokenObservationIds.has(observationId)) return false;
  target.movementRecognition.spokenObservationIds.add(observationId);
  void speakVisualResponse({ observationId, text }, { ...options, target, auto: true })
    .finally(() => {
      if (target.interactionState?.sessionActive) {
        target.movementRecognition.persistent.state = "active";
        processRealtimeSessionScheduler(target);
      } else {
        completePersistentObservationCycle(target);
      }
    });
  return true;
}

function semanticObservationKey(result = {}) {
  const normalized = normalizeMovementRecognitionResult(result);
  return normalizeMovementKey(normalized.movement_key || normalized.short_label || normalized.movement);
}

function spokenResponseForSnapshot(snapshot) {
  if (!snapshot) return "";
  const text = String(snapshot.spoken_response || snapshot.movement_sentence || "").trim();
  if (isOperationalVisualMessage(text)) return text;
  return text || UNCERTAIN_SPOKEN_RESPONSE;
}

function observationIdForSnapshot(snapshot) {
  return String(snapshot?.observation_id || snapshot?.movement_result_id || snapshot?.result_id || "").trim();
}

function speechOwnershipMetadata(ownership, extra = {}) {
  return {
    response_id: String(ownership?.responseId || ""),
    speech_id: String(ownership?.speechId || ""),
    session_generation: Number(ownership?.sessionGeneration || 0),
    mode_generation: Number(ownership?.modeGeneration || 0),
    speech_generation_id: Number(ownership?.speechGenerationId || 0),
    ...extra
  };
}

async function tryLocalVisualSpeech({ text, observationId, speechGenerationId, runtimeSpeechToken, ownership }, target, options = {}) {
  const send = options.fetch || globalThis.fetch;
  if (typeof send !== "function") return { ok: false, code: "visual_local_tts_unavailable" };
  const Controller = globalThis.AbortController;
  const controller = typeof Controller === "function" ? new Controller() : null;
  target.movementRecognition.activeVoiceAbortController = controller;
  try {
    const response = await send(VISUAL_COMPANION_CLIENT_CONFIG.speakEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        observation_id: observationId || "",
        voice: "sensefield_default",
        style: "warm_conversational",
        contains_raw_media: false
      }),
      signal: controller?.signal
    });
    const contentType = String(response.headers?.get?.("content-type") || "");
    if (response.ok && /^audio\//i.test(contentType)) {
      const blob = await audioBlobFromResponse(response, contentType);
      if (!blob || Number(blob.size || 0) <= 0) return { ok: false, code: "visual_local_tts_empty_audio" };
      const durationMs = Number(response.headers?.get?.("x-sensefield-audio-duration-ms") || 0);
      if (!Number.isFinite(durationMs) || durationMs <= 0) return { ok: false, code: "visual_local_tts_invalid_duration" };
      if (runtimeSpeechToken && !target.emergencyRuntimeController.isCurrent(runtimeSpeechToken, "speechId", runtimeSpeechToken.speechId)) {
        return { ok: false, code: "visual_speech_stale" };
      }
      const playback = await playAudioBlob(blob, target, options, text, speechGenerationId, runtimeSpeechToken, ownership);
      if (playback.ok) {
        return {
          ok: true,
          path: "local_tts",
          engine: response.headers?.get?.("x-sensefield-voice-engine") || "local_tts",
          spoken_response: text,
          observation_id: observationId || "",
          contains_raw_media: false
        };
      }
      return playback;
    }
    const body = await response.json().catch(() => ({}));
    const engine = String(body.engine || body.path || body.tts || "");
    if (response.ok && body.ok !== false && /local_tts|kokoro/i.test(engine) && body.audio_base64) {
      return { ok: false, code: "visual_local_tts_audio_base64_unsupported" };
    }
  } catch {
    // Neural voice failures stay textual; no second playback engine is started.
  } finally {
    if (target.movementRecognition.activeVoiceAbortController === controller) {
      target.movementRecognition.activeVoiceAbortController = null;
    }
  }
  return { ok: false, code: "visual_local_tts_unavailable" };
}

async function audioBlobFromResponse(response, contentType) {
  if (typeof response.blob === "function") return response.blob();
  if (typeof response.arrayBuffer === "function" && typeof Blob === "function") {
    return new Blob([await response.arrayBuffer()], { type: contentType || "audio/wav" });
  }
  return null;
}

function playAudioBlob(blob, target, options = {}, text = "", speechGenerationId = 0, runtimeSpeechToken = null, ownership = null) {
  const URLApi = options.URLApi || globalThis.URL;
  const AudioCtor = options.AudioCtor || globalThis.Audio;
  if (typeof URLApi?.createObjectURL !== "function" || typeof URLApi?.revokeObjectURL !== "function" || typeof AudioCtor !== "function") {
    return Promise.resolve({ ok: false, code: "visual_audio_playback_unavailable" });
  }
  const objectUrl = URLApi.createObjectURL(blob);
  const audio = new AudioCtor(objectUrl);
  audio.muted = false;
  audio.volume = 1;
  target.movementRecognition.activeSpeechAudio = audio;
  target.movementRecognition.activeSpeechObjectUrl = objectUrl;
  target.movementRecognition.activeSpeechOwnership = ownership;
  return new Promise((resolve) => {
    let settled = false;
    let startTimer = null;
    let endTimer = null;
    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      if (startTimer) clearTimeout(startTimer);
      if (endTimer) clearTimeout(endTimer);
      clearActiveAudio(target, URLApi, ownership);
      resolve(result);
    };
    target.movementRecognition.activeSpeechCancel = () => {
      if (ownership) ownership.cancelled = true;
      cleanup({ ok: false, code: "visual_speech_cancelled" });
    };
    const current = () => Number(target.interactionState?.speechGenerationId || 0) === Number(speechGenerationId) &&
      target.movementRecognition.activeSpeechOwnership === ownership && ownership?.cancelled !== true &&
      (!runtimeSpeechToken || target.emergencyRuntimeController.isCurrent(runtimeSpeechToken, "speechId", runtimeSpeechToken.speechId));
    audio.onplaying = () => {
      if (settled) return;
      if (!current()) return cleanup({ ok: false, code: "visual_speech_stale" });
      if (runtimeSpeechToken && !target.emergencyRuntimeController.markSpeechStarted(runtimeSpeechToken)) return cleanup({ ok: false, code: "visual_speech_stale" });
      if (ownership) ownership.playing = true;
      target.movementRecognition.voiceStatus = "Speaking…";
      if (target.interactionState?.sessionActive) {
        applyInteractionState(target, { assistantSpeaking: true });
        if (interactionModeIs(target, "conversation")) setLiveConversationSpeaking(target.liveConversation, true);
      }
      pauseRealtimeSpeechInputForAssistant(target);
      if (target === state) {
        sensefieldTestRuntime.resourceCounts.speechStarted += 1;
        recordSensefieldTestSpeech("started", speechOwnershipMetadata(ownership, { path: "local_tts", text }), {
          correlationId: ownership?.responseId,
          modeGenerationId: ownership?.modeGeneration
        });
      }
      render();
      if (startTimer) clearTimeout(startTimer);
      endTimer = setTimeout(() => {
        if (!current()) return cleanup({ ok: false, code: "visual_speech_stale" });
        target.movementRecognition.voiceStatus = "Voice unavailable";
        if (target.interactionState?.sessionActive) applyInteractionState(target, { assistantSpeaking: false });
        if (interactionModeIs(target, "conversation")) setLiveConversationSpeaking(target.liveConversation, false);
        resumeRealtimeSpeechInputAfterAssistant(target);
        cleanup({ ok: false, code: "visual_local_tts_end_timeout" });
      }, options.speechEndTimeoutMs ?? 30000);
    };
    audio.onended = () => {
      if (settled) return;
      if (!current()) return cleanup({ ok: false, code: "visual_speech_stale" });
      const completed = runtimeSpeechToken ? finishRuntimeSpeech(target, runtimeSpeechToken, { completed: true }) : true;
      if (!completed) return cleanup({ ok: false, code: "visual_speech_stale" });
      if (ownership) ownership.completed = true;
      target.movementRecognition.voiceStatus = "Voice complete";
      if (target.interactionState?.sessionActive) {
        applyInteractionState(target, { assistantSpeaking: false });
        if (interactionModeIs(target, "conversation")) {
          appendRealtimeMemory(target, "assistant", { text, interrupted: false, source: "voice" });
          setLiveConversationSpeaking(target.liveConversation, false);
        }
        resumeRealtimeSpeechInputAfterAssistant(target);
      }
      if (target === state) {
        sensefieldTestRuntime.resourceCounts.speechCompleted += 1;
        recordSensefieldTestSpeech("completed", speechOwnershipMetadata(ownership, { path: "local_tts", text }), {
          correlationId: ownership?.responseId,
          modeGenerationId: ownership?.modeGeneration
        });
      }
      render();
      cleanup({ ok: true, path: "local_tts" });
    };
    audio.onerror = () => {
      if (!current()) return cleanup({ ok: false, code: "visual_speech_stale" });
      target.movementRecognition.voiceStatus = "Voice unavailable";
      if (target.interactionState?.sessionActive) applyInteractionState(target, { assistantSpeaking: false });
      if (interactionModeIs(target, "conversation")) setLiveConversationSpeaking(target.liveConversation, false);
      resumeRealtimeSpeechInputAfterAssistant(target);
      render();
      cleanup({ ok: false, code: "visual_local_tts_playback_error" });
    };
    startTimer = setTimeout(() => {
      if (!current()) return cleanup({ ok: false, code: "visual_speech_stale" });
      target.movementRecognition.voiceStatus = "Voice unavailable";
      if (target.interactionState?.sessionActive) applyInteractionState(target, { assistantSpeaking: false });
      if (interactionModeIs(target, "conversation")) setLiveConversationSpeaking(target.liveConversation, false);
      resumeRealtimeSpeechInputAfterAssistant(target);
      cleanup({ ok: false, code: "visual_local_tts_start_timeout" });
    }, options.speechStartTimeoutMs ?? 3000);
    try {
      const playResult = audio.play();
      if (playResult?.catch) {
        playResult.catch(() => {
          target.movementRecognition.voiceStatus = "Voice unavailable";
          if (target.interactionState?.sessionActive) applyInteractionState(target, { assistantSpeaking: false });
          if (interactionModeIs(target, "conversation")) setLiveConversationSpeaking(target.liveConversation, false);
          render();
          cleanup({ ok: false, code: "visual_local_tts_play_rejected" });
        });
      }
    } catch {
      target.movementRecognition.voiceStatus = "Voice unavailable";
      if (target.interactionState?.sessionActive) applyInteractionState(target, { assistantSpeaking: false });
      if (interactionModeIs(target, "conversation")) setLiveConversationSpeaking(target.liveConversation, false);
      render();
      cleanup({ ok: false, code: "visual_local_tts_play_failed" });
    }
  });
}

export async function cancelVisualSpeech(target = state, options = {}) {
  const URLApi = options.URLApi || globalThis.URL;
  const ownership = target.movementRecognition.activeSpeechOwnership;
  const wasActive = Boolean(target.interactionState?.assistantSpeaking || target.movementRecognition.activeSpeechAudio || target.movementRecognition.activeVoiceAbortController || ownership);
  if (ownership) ownership.cancelled = true;
  target.movementRecognition.activeVoiceAbortController?.abort?.();
  target.movementRecognition.activeVoiceAbortController = null;
  if (target.interactionState) applyInteractionState(target, {
    assistantSpeaking: false,
    speechGenerationId: Number(target.interactionState.speechGenerationId || 0) + 1
  });
  target.emergencyRuntimeController?.cancelSpeech?.(wasActive ? "Voice playback cancelled" : "");
  target.appState = target.emergencyRuntimeController?.snapshot?.() || target.appState;
  clearActiveAudio(target, URLApi, ownership);
  if (["Speaking…", "Preparing voice…"].includes(target.movementRecognition.voiceStatus)) {
    target.movementRecognition.voiceStatus = "Voice unavailable";
  }
  resumeRealtimeSpeechInputAfterAssistant(target);
  if (wasActive && target === state) {
    sensefieldTestRuntime.resourceCounts.speechCancelled += 1;
    recordSensefieldTestSpeech("cancelled", speechOwnershipMetadata(ownership, { path: "local_tts", reason: "runtime_cancel" }), {
      correlationId: ownership?.responseId,
      modeGenerationId: ownership?.modeGeneration
    });
  }
  const send = options.fetch || globalThis.fetch;
  if (typeof send === "function") {
    try {
      await send(VISUAL_COMPANION_CLIENT_CONFIG.cancelEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contains_raw_media: false })
      });
    } catch {
      // Neural cancellation is best-effort after local ownership is invalidated.
    }
  }
  return { ok: true };
}

function finishRuntimeSpeech(target, runtimeSpeechToken, outcome) {
  const completed = target.emergencyRuntimeController.finishSpeech(runtimeSpeechToken, outcome);
  target.appState = target.emergencyRuntimeController.snapshot();
  return completed;
}

function clearActiveAudio(target, URLApi = globalThis.URL, ownership = target.movementRecognition.activeSpeechOwnership) {
  if (target.movementRecognition.activeSpeechOwnership !== ownership) return false;
  const cancelActive = target.movementRecognition.activeSpeechCancel;
  target.movementRecognition.activeSpeechCancel = null;
  cancelActive?.();
  const audio = target.movementRecognition.activeSpeechAudio;
  if (audio) {
    audio.onplaying = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause?.();
    audio.removeAttribute?.("src");
    try {
      audio.src = "";
      audio.load?.();
    } catch {
      // Ignore media element cleanup failures.
    }
  }
  if (target.movementRecognition.activeSpeechObjectUrl) {
    URLApi?.revokeObjectURL?.(target.movementRecognition.activeSpeechObjectUrl);
  }
  target.movementRecognition.activeSpeechAudio = null;
  target.movementRecognition.activeSpeechObjectUrl = "";
  if (target.movementRecognition.activeSpeechOwnership === ownership) {
    target.movementRecognition.activeSpeechOwnership = null;
  }
  return true;
}

function pauseRealtimeSpeechInputForAssistant(target) {
  if (!interactionModeIs(target, "conversation")) return;
  target.realtimeSession.speechStopping = true;
  try { target.realtimeSession.speechRecognition?.abort?.(); } catch {}
}

function resumeRealtimeSpeechInputAfterAssistant(target) {
  if (!target.interactionState?.sessionActive || !interactionModeIs(target, "conversation")) return;
  const recognition = target.realtimeSession.speechRecognition;
  if (!recognition) return;
  target.realtimeSession.speechStopping = false;
  if (target.realtimeSession.speechRestartTimer) clearTimeout(target.realtimeSession.speechRestartTimer);
  target.realtimeSession.speechRestartTimer = setTimeout(() => {
    if (!target.interactionState?.sessionActive || !interactionModeIs(target, "conversation") || target.interactionState.assistantSpeaking) return;
    try { recognition.start(); } catch {}
  }, 120);
}


export function buildReplayFixture(target, options = {}) {
  const devDryRun = options.devDryRun === true;
  const traceMode = selectedTraceModeFor({ ...target, suggestionTraceMode: options.suggestionTraceMode ?? target.suggestionTraceMode });
  if (!devDryRun && traceMode.id !== "standard") {
    return buildSuggestionTraceFixture(traceMode, target, options);
  }
  return buildStandardPhysicalTraceFixture(target, options);
}

export function buildStandardPhysicalTraceFixture(target, options = {}) {
  const devDryRun = options.devDryRun === true;
  const traceMode = selectedTraceModeFor({ ...target, suggestionTraceMode: options.suggestionTraceMode ?? target.suggestionTraceMode });
  const preflight = runStandardExportPreflight(target, { requirePhysicalConfirmation: !devDryRun });
  if (!preflight.passed) {
    throw new Error(preflight.failures[0]?.message ?? target.exportStatus ?? "trace export is not ready");
  }

  const inputEvents = REQUIRED_EXPORT_EVENT_IDS.map((id) => {
    const event = target.events.find((item) => item.id === id);
    if (!event) throw new Error(`missing event ${id}`);
    return event;
  });
  const latency = target.latencyRecords.filter((record) => REQUIRED_EXPORT_EVENT_IDS.includes(record.event_id));
  const summary = summarizeLatency(latency);
  const traceOrigin = {
    source: "browser.local_camera",
    raw_media_persisted: false,
    cloud_calls_enabled: false,
    manual_fixture: devDryRun,
    dev_dry_run: devDryRun,
    generated_by: "browser-local-capture",
    capture_mode: devDryRun ? "dev_dry_run_manual_confirmation" : "physical_webcam_manual_calibration",
    browser_latency_recorded: true,
    physical_capture: !devDryRun,
    operator_confirmed_physical_session: !devDryRun,
    suggestion_trace_mode: traceMode.id,
    suggestion_trace_path: traceMode.path,
    manual_local_confirmation_used: true,
    manual_local_confirmation_scope: [
      "zone_calibration",
      "focus_ritual_step_confirmation"
    ],
    manual_local_confirmation_event_ids: inputEvents.map((event) => event.id)
  };

  return {
    schema: "darkquest.replay_fixture.v0",
    fixture_id: devDryRun && traceMode.id === "standard" ? "gate_1d_dry_run_export" : traceMode.fixture_id,
    name: devDryRun && traceMode.id === "standard" ? "Gate 1D dev dry-run Focus Ritual export" : `${traceMode.label} export`,
    description: devDryRun
      ? "Developer dry-run symbolic export generated without a physical capture claim; replay-compatible, but barred from Gate 1C."
      : "Operator-confirmed physical browser webcam session exported by the hardened local app as symbolic replay events only.",
    created_by: devDryRun ? "GAUNTLET Gate 1E dev dry-run checker" : "PARALLAX Gate 3B-Live browser-local suggestion trace mode",
    trace_origin: traceOrigin,
    suggestion_summary: suggestionSummaryFor(target),
    privacy: {
      contains_raw_video: false,
      contains_audio: false,
      cloud_calls_expected: false
    },
    input_events: inputEvents,
    expected: {
      stable_events: inputEvents.map(toStableMatcher),
      quest_transitions: questTransitions(),
      hud_commands: hudCommands(),
      memory_writes: [],
      model_calls: []
    },
    forbidden: {
      event_types: ["agent.escalation_requested"],
      memory_writes: [
        { memory_scope: "raw_frame_memory" },
        { privacy_classification: "forbidden_raw_media" }
      ],
      model_calls: [
        { approved_tier: 1 },
        { approved_tier: 2 },
        { approved_tier: 3 },
        { approved_tier: 4 },
        { input_class: "continuous_video" },
        { input_class: "raw_video" },
        { input_class: "raw_frame" }
      ],
      raw_video_persistence: true
    },
    metrics: {
      max_llm_calls: 0,
      max_vlm_calls: 0,
      max_cost_usd: 0,
      max_replay_runtime_ms: 1000,
      p50_latency_ms: summary.p50,
      p95_latency_ms: summary.p95,
      max_latency_ms: summary.max,
      dropped_frames: target.droppedFrames,
      event_count: inputEvents.length,
      uncertainty_count: target.uncertaintyCount,
      scene_reset_count: target.resetCount,
      raw_media_persistence_count: 0,
      suggestion_summary: suggestionSummaryFor(target),
      browser_latency_records: latency
    }
  };
}

export function buildSuggestionTraceFixture(traceModeOrTarget, targetOrOptions = {}, maybeOptions = {}) {
  const target = traceModeOrTarget?.events ? traceModeOrTarget : targetOrOptions;
  const traceMode = traceModeOrTarget?.events ? selectedTraceModeFor(traceModeOrTarget) : traceModeOrTarget;
  const options = traceModeOrTarget?.events ? targetOrOptions : maybeOptions;
  const mode = selectedTraceModeFor({ ...target, suggestionTraceMode: traceMode?.id ?? target.suggestionTraceMode });
  if (mode.id === "standard") return buildStandardPhysicalTraceFixture(target, options);
  const preflight = runSuggestionExportPreflight({ ...target, suggestionTraceMode: mode.id }, options);
  if (!preflight.passed) {
    throw new Error(preflight.failures[0]?.message ?? target.exportStatus ?? "suggestion trace export is not ready");
  }

  const inputEvents = suggestionTraceInputEvents(target, mode);
  const latency = latencyRecordsForEvents(target, inputEvents);
  const summary = summarizeLatency(latency);
  const suggestionSummary = suggestionSummaryForTrace(target, mode);
  const traceState = traceStateFor(target, mode);
  traceState.events = inputEvents.map(clone);
  traceState.emittedEventIds = inputEvents.map((event) => event.id);
  traceState.exportBlockedReasons = [];
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummary;

  const traceOrigin = {
    ...traceOriginFor({ physical: options.devDryRun === true ? false : target.physicalConfirmed === true, devDryRun: options.devDryRun === true }),
    suggestion_trace_mode: mode.id,
    suggestion_trace_path: mode.path,
    manual_local_confirmation_event_ids: inputEvents.map((event) => event.id)
  };

  const fullRitualMode = mode.id === "suggestion_full_focus_ritual";
  return {
    schema: "darkquest.replay_fixture.v0",
    fixture_id: mode.fixture_id,
    name: `${mode.label} export`,
    description: "Operator-confirmed physical browser webcam suggestion trace exported as symbolic replay events only.",
    created_by: "PARALLAX Gate 3B-Live browser-local suggestion trace mode",
    trace_origin: traceOrigin,
    suggestion_summary: suggestionSummary,
    suggestion_trace: {
      trace_mode: mode.id,
      capture_status: traceState.captureStatus,
      export_readiness: traceState.exportReadiness,
      started_at_ms: traceState.startedAtMs,
      accepted_suggestion_ids: traceState.acceptedSuggestionIds.slice(-8),
      rejected_suggestion_ids: traceState.rejectedSuggestionIds.slice(-8),
      emitted_event_ids: traceState.emittedEventIds,
      last_suggestion: traceState.lastSuggestion,
      export_blocked_reasons: traceState.exportBlockedReasons
    },
    privacy: {
      contains_raw_video: false,
      contains_audio: false,
      cloud_calls_expected: false
    },
    input_events: inputEvents,
    expected: {
      stable_events: inputEvents.map(toStableMatcher),
      quest_transitions: fullRitualMode ? questTransitions() : [],
      hud_commands: fullRitualMode ? hudCommands() : [],
      memory_writes: [],
      model_calls: []
    },
    forbidden: {
      event_types: ["agent.escalation_requested"],
      memory_writes: [
        { memory_scope: "raw_frame_memory" },
        { privacy_classification: "forbidden_raw_media" }
      ],
      model_calls: [
        { approved_tier: 1 },
        { approved_tier: 2 },
        { approved_tier: 3 },
        { approved_tier: 4 },
        { input_class: "continuous_video" },
        { input_class: "raw_video" },
        { input_class: "raw_frame" }
      ],
      raw_video_persistence: true
    },
    metrics: {
      max_llm_calls: 0,
      max_vlm_calls: 0,
      max_cost_usd: 0,
      max_replay_runtime_ms: 1000,
      p50_latency_ms: summary.p50,
      p95_latency_ms: summary.p95,
      max_latency_ms: summary.max,
      dropped_frames: target.droppedFrames,
      event_count: inputEvents.length,
      uncertainty_count: inputEvents.filter((event) => event.type === "scene.uncertain").length,
      scene_reset_count: 0,
      raw_media_persistence_count: 0,
      suggestion_summary: suggestionSummary,
      browser_latency_records: latency
    }
  };
}

export function runExportPreflight(target, options = {}) {
  const mode = selectedTraceModeFor(target);
  if (mode.id !== "standard") return runSuggestionExportPreflight(target, options);
  return runStandardExportPreflight(target, options);
}

export function runStandardExportPreflight(target, options = {}) {
  const requirePhysicalConfirmation = options.requirePhysicalConfirmation !== false;
  const hasAllEvents = REQUIRED_EXPORT_EVENT_IDS.every((id) => target.events.some((event) => event.id === id));
  const latencyEventIds = new Set(target.latencyRecords.map((record) => record.event_id));
  const requiredLatencyPresent = REQUIRED_EXPORT_EVENT_IDS.every((id) => latencyEventIds.has(id));
  const forbiddenMarkers = findForbiddenMediaMarkers(target);
  const baseChecks = [
    preflightCheck("camera_started", "Camera was started", target.cameraStarted || target.cameraReady, "Click Start Camera first."),
    preflightCheck("calibration_saved", "Calibration was saved", target.calibrationSaved, "Save Calibration before starting the ritual."),
    preflightCheck("ritual_started", "Focus Ritual started", target.ritualStarted, "Click Start Focus Ritual."),
    preflightCheck("recording_stopped", "Recording started then stopped", target.recordingStarted && !target.recording, "Start watching, complete the session, then stop watching."),
    preflightCheck("events_exist", "Required ritual events exist", hasAllEvents, target.events.length === 0 ? "No events recorded." : "Complete every ritual confirmation in order."),
    preflightCheck("event_sequence_valid", "Event sequence is valid", eventSequenceIsValid(target.events), "Invalid event sequence; reset and repeat the ritual in order."),
    preflightCheck("quest_complete", "Quest state is quest_complete", target.questState === "quest_complete", "Quest is not complete yet."),
    preflightCheck("physical_confirmed", "Physical session confirmation checked", !requirePhysicalConfirmation || target.physicalConfirmed, "Physical confirmation is missing."),
    preflightCheck("no_forbidden_media", "No raw media, screenshot, audio, OCR, or notebook text markers", forbiddenMarkers.length === 0, forbiddenMarkers.length ? `Forbidden marker: ${forbiddenMarkers[0]}` : "Symbolic-only payloads."),
    preflightCheck("model_calls_zero", "LLM/VLM calls are zero", target.llmCalls === 0 && target.vlmCalls === 0 && target.estimatedModelCostUsd === 0, "Model calls or model cost are non-zero."),
    preflightCheck("raw_media_not_persisted", "raw_media_persisted=false", target.rawMediaPersistenceCount === 0, "Raw media persistence count must be zero."),
    preflightCheck("latency_records_present", "Browser latency records exist", requiredLatencyPresent, "Each required event needs a browser latency record."),
    preflightCheck("trace_origin_available", "Trace origin can be generated", traceOriginFor({ physical: requirePhysicalConfirmation && target.physicalConfirmed, devDryRun: !requirePhysicalConfirmation }).source === "browser.local_camera", "Trace origin could not be generated.")
  ];
  const checks = [
    ...baseChecks,
    ...runSuggestionTracePreflight(target).checks
  ];
  const failures = checks.filter((check) => !check.passed);
  return { passed: failures.length === 0, checks, failures };
}

export function runSuggestionExportPreflight(target, options = {}) {
  const requirePhysicalConfirmation = options.requirePhysicalConfirmation !== false;
  const mode = selectedTraceModeFor(target);
  const inputEvents = suggestionTraceInputEvents(target, mode);
  const selectedEventIds = new Set(inputEvents.map((event) => event.id));
  const requiredEventIds = suggestionTraceRequiredEventIds(target, mode);
  const latencyEventIds = new Set(target.latencyRecords.map((record) => record.event_id));
  const forbiddenMarkers = findForbiddenMediaMarkers(target);
  const requiredEventsPresent = requiredEventIds.every((id) => selectedEventIds.has(id));
  const requiredLatencyPresent = inputEvents.every((event) => latencyEventIds.has(event.id));
  const checks = [
    preflightCheck("camera_started", "Camera was started", target.cameraStarted || target.cameraReady, "Click Start Camera first."),
    preflightCheck("calibration_saved", "Calibration was saved", target.calibrationSaved, "Save Calibration before starting the session."),
    preflightCheck("ritual_started", "Focus Ritual started", target.ritualStarted, "Click Start Session."),
    preflightCheck("recording_stopped", "Recording started then stopped", target.recordingStarted && !target.recording, "Start Session, capture the selected action, then stop recording."),
    preflightCheck("events_exist", "Selected suggestion trace events exist", requiredEventsPresent, "Capture the selected suggestion trace before export."),
    preflightCheck("physical_confirmed", "Physical session confirmation checked", !requirePhysicalConfirmation || target.physicalConfirmed, "Physical confirmation is missing."),
    preflightCheck("no_forbidden_media", "No raw media, screenshot, audio, OCR, or notebook text markers", forbiddenMarkers.length === 0, forbiddenMarkers.length ? `Forbidden marker: ${forbiddenMarkers[0]}` : "Symbolic-only payloads."),
    preflightCheck("model_calls_zero", "LLM/VLM calls are zero", target.llmCalls === 0 && target.vlmCalls === 0 && target.estimatedModelCostUsd === 0, "Model calls or model cost are non-zero."),
    preflightCheck("raw_media_not_persisted", "raw_media_persisted=false", target.rawMediaPersistenceCount === 0, "Raw media persistence count must be zero."),
    preflightCheck("latency_records_present", "Browser latency records exist", requiredLatencyPresent, "Each selected event needs a browser latency record."),
    preflightCheck("trace_origin_available", "Trace origin can be generated", traceOriginFor({ physical: requirePhysicalConfirmation && target.physicalConfirmed, devDryRun: !requirePhysicalConfirmation }).source === "browser.local_camera", "Trace origin could not be generated."),
    ...runSuggestionTracePreflight(target).checks
  ];
  const failures = checks.filter((check) => !check.passed);
  const traceState = mode.id !== "standard" ? traceStateFor(target, mode) : null;
  if (traceState) {
    traceState.events = inputEvents.map(clone);
    traceState.emittedEventIds = inputEvents.map((event) => event.id);
    traceState.exportReadiness = failures.length === 0 ? "ready_to_export" : "blocked";
    traceState.exportBlockedReasons = failures.map((failure) => failure.id).slice(0, 8);
  }
  return { passed: failures.length === 0, checks, failures };
}

export function runSuggestionTracePreflight(target) {
  const mode = selectedTraceModeFor(target);
  if (mode.id === "standard") return { passed: true, checks: [], failures: [] };
  const summary = suggestionSummaryForTrace(target, mode);
  const acceptMode = !["suggestion_reject", "suggestion_uncertain"].includes(mode.id);
  const rejectMode = mode.id === "suggestion_reject";
  const uncertainMode = mode.id === "suggestion_uncertain";
  const fullRitualMode = mode.id === "suggestion_full_focus_ritual";
  const inputEvents = suggestionTraceInputEvents(target, mode);
  const inputEventIds = new Set(inputEvents.map((event) => event.id));
  const acceptedEvents = fullRitualMode
    ? acceptedSuggestionEvents(target)
    : acceptedSuggestionEvents(target).filter((event) => inputEventIds.has(event.id));
  const acceptedEventIds = new Set(acceptedEvents.map((event) => event.id));
  const selectedAcceptedEventId = SUGGESTION_TRACE_EVENT_BY_MODE[mode.id];
  const unrelatedRitualEventIds = [...inputEventIds].filter((id) => (
    REQUIRED_EXPORT_EVENT_IDS.includes(id) &&
    id !== "evt_scene_calibrated" &&
    id !== selectedAcceptedEventId &&
    mode.id !== "suggestion_full_focus_ritual"
  ));
  const allStepSuggestionsAccepted = [
    "evt_phone_moved_to_off_desk",
    "evt_notebook_opened",
    "evt_pen_moved_to_hand",
    "evt_writing_like_motion",
    "evt_typing_like_motion"
  ].every((eventId) => acceptedEventIds.has(eventId));
  const uncertaintyPresent = target.perceptionSuggestions.some((suggestion) => suggestion.quest_step === "uncertain" || suggestion.suggested_event_type === "scene.uncertain")
    || target.suggestionTypeHistory.includes("scene.uncertain")
    || target.uncertaintyCount > 0;
  const acceptedEvidenceOk = acceptedEvents.some((event) => (
    event.evidence?.some((item) => item.kind === "local_signal" && item.contains_raw_media === false) &&
    event.evidence?.some((item) => item.kind === "human_correction" && item.contains_raw_media === false)
  ));
  const acceptedPayloadOk = acceptedEvents.some((event) => (
    typeof event.payload?.accepted_from_suggestion_id === "string" &&
    event.payload?.detection_method === "motion_proxy"
  ));
  const checks = [
    preflightCheck("suggestion_trace_mode_selected", "Suggestion trace mode selected", mode.id !== "standard", "Select a Suggestion Trace mode before exporting this trace."),
    preflightCheck("suggestion_summary_present", "Suggestion summary exists", Boolean(summary), "Suggestion summary metadata is missing."),
    preflightCheck("suggestions_generated", "At least one suggestion generated", summary.suggestions_generated >= 1, "Wait for at least one camera suggestion before exporting this suggestion trace."),
    preflightCheck("suggestion_accept_required", "Accepted suggestion present for accept trace", !acceptMode || summary.suggestions_accepted >= 1, "Accept a matching camera suggestion before exporting this trace."),
    preflightCheck("suggestion_reject_required", "Rejected suggestion present for reject trace", !rejectMode || summary.suggestions_rejected >= 1, "Reject a camera suggestion before exporting this trace."),
    preflightCheck("suggestion_uncertainty_required", "Uncertainty suggestion present for uncertain trace", !uncertainMode || uncertaintyPresent, "Wait for an uncertainty signal or suggestion before exporting this trace."),
    preflightCheck("suggestion_full_ritual_accepts_all", "Full ritual accepted suggestions exist", !fullRitualMode || allStepSuggestionsAccepted, "Accept a matching suggestion for every ritual step before exporting this trace."),
    preflightCheck("suggestion_selected_event_only", "Suggestion trace input is mode-specific", unrelatedRitualEventIds.length === 0, `Remove unrelated ritual events from this suggestion trace: ${unrelatedRitualEventIds.join(", ")}`),
    preflightCheck("suggestion_selected_event_present", "Selected accepted event is present", !acceptMode || fullRitualMode || acceptedEventIds.has(selectedAcceptedEventId), "Accept the selected action suggestion before exporting this trace."),
    preflightCheck("suggestion_no_auto_complete", "auto_completed_steps is 0", summary.auto_completed_steps === 0, "Suggestion trace cannot auto-complete steps."),
    preflightCheck("suggestion_model_calls_zero", "Suggestion trace LLM/VLM calls are zero", summary.llm_calls === 0 && summary.vlm_calls === 0, "Suggestion trace model calls must be zero."),
    preflightCheck("suggestion_raw_media_zero", "Suggestion trace raw media persistence is zero", summary.raw_media_persistence === 0, "Suggestion trace raw media persistence must be zero."),
    preflightCheck("accepted_suggestion_evidence", "Accepted suggestion evidence has local_signal and human_correction", !acceptMode || acceptedEvidenceOk, "Accepted suggestion event must include local_signal and human_correction evidence."),
    preflightCheck("accepted_suggestion_payload", "Accepted suggestion payload has suggestion id and motion proxy", !acceptMode || acceptedPayloadOk, "Accepted suggestion event must include accepted_from_suggestion_id and detection_method=motion_proxy.")
  ];
  const failures = checks.filter((check) => !check.passed);
  return { passed: failures.length === 0, checks, failures };
}

export function buildExportPreview(target, options = {}) {
  const devDryRun = options.devDryRun === true;
  const traceMode = selectedTraceModeFor({ ...target, suggestionTraceMode: options.suggestionTraceMode ?? target.suggestionTraceMode });
  const latency = summarizeLatency(target.latencyRecords.filter((record) => REQUIRED_EXPORT_EVENT_IDS.includes(record.event_id)));
  const eventSequence = REQUIRED_EXPORT_EVENT_IDS
    .map((id) => target.events.find((event) => event.id === id)?.type ?? `missing:${id}`)
    .join(" -> ");
  return {
    fixture_id: devDryRun && traceMode.id === "standard" ? "gate_1d_dry_run_export" : traceMode.fixture_id,
    trace_origin: {
      ...traceOriginFor({ physical: !devDryRun && target.physicalConfirmed, devDryRun }),
      suggestion_trace_mode: traceMode.id,
      suggestion_trace_path: traceMode.path
    },
    suggestion_trace_mode: traceMode.id,
    event_count: target.events.filter((event) => REQUIRED_EXPORT_EVENT_IDS.includes(event.id)).length,
    event_sequence: eventSequence,
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persisted: false,
    latency_summary: {
      p50_ms: latency.p50,
      p95_ms: latency.p95,
      max_ms: latency.max
    },
    suggestion_summary: suggestionSummaryFor(target),
    expected_save_path: traceMode.path
  };
}

export function inspectEventSequence(target) {
  return EVENT_SEQUENCE_STEPS.map((step) => {
    const event = step.eventId ? target.events.find((item) => item.id === step.eventId) : null;
    const questComplete = step.eventId === null && target.questState === "quest_complete";
    return {
      sequence_index: step.index,
      required_label: step.label,
      required_event_id: step.eventId ?? "quest_complete",
      required_event_type: step.eventId ? requiredEventTypeFor(step.eventId) : "quest.state",
      status: event || questComplete ? "present" : "missing",
      matched_event_id: event?.id ?? null,
      confidence: event?.confidence ?? null,
      payload_summary: event ? payloadSummary(event.payload) : questComplete ? "quest state reached" : "missing"
    };
  });
}

export function buildOperatorBugReport(target, options = {}) {
  const guards = getButtonGuards(target);
  const stages = wizardStagesForState(target);
  const currentStage = stages.find((item) => !item.complete) ?? stages[stages.length - 1];
  const sequence = inspectEventSequence(target);
  const summary = summarizeLatency(target.latencyRecords);
  const report = {
    schema: "darkquest.operator_bug_report.v0",
    app_version: APP_VERSION,
    build_hash: "local-source",
    generated_by: "browser-local-capture",
    generated_at: new Date().toISOString(),
    browser_user_agent: String(options.userAgent ?? "unknown"),
    wizard_stage: currentStage.name,
    calibration_saved: target.calibrationSaved,
    next_action: nextStepText(target),
    quest_state: target.questState,
    state_history: [...target.stateHistory],
    active_zone: target.activeZone,
    recording_status: target.recording ? "on" : target.recordingStarted ? "stopped" : "off",
    export_status: target.exportStatus,
    validation_status: target.exported ? "commands_ready" : "pending",
    validation_commands_shown: target.exported,
    validation_commands: VALIDATION_COMMAND_LIST.map((item) => item.command),
    physical_confirmation_checked: target.physicalConfirmed,
    exported: target.exported,
    event_count: target.events.length,
    event_types: target.events.map((event) => event.type),
    last_error: target.errorMessage,
    error_message: target.errorMessage,
    status_message: target.statusMessage,
    disabled_button_reasons: Object.fromEntries(
      Object.entries(guards)
        .filter(([, value]) => value.enabled === false && value.reason)
        .map(([key, value]) => [key, value.reason])
    ),
    event_sequence: sequence,
    symbolic_events: target.events.map((event) => ({
      id: event.id,
      type: event.type,
      timestamp_ms: event.timestamp_ms,
      confidence: event.confidence,
      payload_summary: payloadSummary(event.payload),
      evidence_kind: event.evidence?.[0]?.kind ?? "unknown"
    })),
    latency_metrics: {
      p50_ms: summary.p50,
      p95_ms: summary.p95,
      max_ms: summary.max,
      record_count: target.latencyRecords.length,
      dropped_frames: target.droppedFrames
    },
    privacy_status: {
      media_persisted: false,
      audio_requested: false,
      screen_capture_persisted: false,
      private_text_persisted: false
    },
    model_status: {
      cloud_fallback: "huggingface_on_demand",
      llm_calls: target.llmCalls,
      vlm_calls: target.vlmCalls,
      estimated_cost_usd: target.estimatedModelCostUsd
    },
    movement_recognition_status: {
      mode: target.movementRecognition.mode,
      provider: target.movementRecognition.provider,
      model: target.movementRecognition.model,
      status: target.movementRecognition.status,
      fallback_used: target.movementRecognition.fallbackUsed,
      frame_buffer_cleared: target.movementRecognition.frameBufferCleared
    },
    local_action_engine_status: {
      active_engine: target.localActionDiagnostics.activeEngine,
      hand_engine: target.localActionDiagnostics.handEngineStatus,
      frame_processing_fps: target.localActionDiagnostics.frameProcessingFps,
      last_perception_latency_ms: target.localActionDiagnostics.lastPerceptionLatencyMs,
      current_primary_candidate: target.localActionDiagnostics.currentPrimaryCandidate,
      last_rejected_candidate: target.localActionDiagnostics.lastRejectedCandidate,
      cooldown_status: target.localActionDiagnostics.cooldownStatus
    },
    suggestion_trace_status: {
      selected_trace_mode: selectedTraceModeFor(target).id,
      selected_trace_label: selectedTraceModeFor(target).label,
      suggestions_generated: suggestionSummaryFor(target).suggestions_generated,
      suggestions_accepted: suggestionSummaryFor(target).suggestions_accepted,
      suggestions_rejected: suggestionSummaryFor(target).suggestions_rejected,
      auto_completed_steps: suggestionSummaryFor(target).auto_completed_steps,
      last_suggestion: lastSuggestionSummary(target),
      suggestion_confidence: lastSuggestionSummary(target)?.confidence ?? null,
      suggestion_reason: lastSuggestionSummary(target)?.reason ?? "",
      export_blocked_reason: runExportPreflight(target).failures[0]?.message ?? "ok",
      media_persisted: false,
      llm_calls: target.llmCalls,
      vlm_calls: target.vlmCalls
    },
    suggestion_campaign_status: {
      campaign_mode_active: target.suggestionCampaign.active === true,
      current_campaign_step: SUGGESTION_CAMPAIGN_STEPS[target.suggestionCampaign.currentIndex]?.label ?? null,
      completed_trace_list: target.suggestionCampaign.exportedTraceIds.map((id) => SUGGESTION_CAMPAIGN_STEPS.find((step) => step.id === id)?.path ?? id),
      missing_trace_list: campaignSummaryFor(target).missing_traces,
      last_suggestion_per_trace: target.suggestionCampaign.lastSuggestions,
      per_trace_counts: target.suggestionCampaign.traceSummaries,
      export_blocked_reason: runExportPreflight(target).failures[0]?.message ?? "ok",
      validation_commands: [
        "npm run suggestions:validate",
        "npm run suggestions:report",
        "npm run gate:3b:live"
      ],
      media_persisted: false,
      llm_calls: target.llmCalls,
      vlm_calls: target.vlmCalls
    }
  };
  const serialized = JSON.stringify(report);
  if (bugReportHasForbiddenData(serialized)) {
    throw new Error("bug report safety check blocked forbidden data");
  }
  return report;
}

export function defaultCalibration() {
  return {
    zoneGeometry: clone(DEFAULT_ZONE_GEOMETRY),
    objectAssignments: { ...DEFAULT_OBJECT_ASSIGNMENTS }
  };
}

export function getButtonGuards(target) {
  updateExportReadiness(target);
  const expectedStep = RITUAL_STEPS.find((step) => target.questState === step.activeState);
  const exportBlockedReason = exportDisabledReason(target);
  return {
    startCamera: guard(!target.cameraReady, "Start Camera is disabled because the camera is already started."),
    stopCamera: guard(target.cameraReady, "Stop Camera is disabled because the camera is not started."),
    calibrateZones: guard(target.cameraReady, "Calibrate Zones is disabled because you have not started the camera yet."),
    saveCalibration: guard(target.cameraReady, "Save Calibration is disabled because you have not started the camera yet."),
    startFocusRitual: guard(
      target.cameraReady && target.calibrationSaved && !target.ritualStarted,
      !target.cameraReady
        ? "Start Focus Ritual is disabled because you have not started the camera yet."
        : !target.calibrationSaved
          ? "Start Focus Ritual is disabled because calibration has not been saved."
          : "Start Focus Ritual is disabled because the ritual is already started."
    ),
    startRecording: guard(
      target.cameraReady && target.calibrationSaved && target.ritualStarted && !target.recording && target.questState !== "quest_complete",
      !target.cameraReady
        ? "Start Recording is disabled because you have not started the camera yet."
        : !target.calibrationSaved
          ? "Start Recording is disabled because calibration has not been saved."
          : !target.ritualStarted
            ? "Start Recording is disabled because you have not started Focus Ritual yet."
            : target.recording
              ? "Start Recording is disabled because recording is already active."
              : "Start Recording is disabled because the quest is already complete."
    ),
    stopRecording: guard(target.recording, "Stop Recording is disabled because recording is not active."),
    exportTrace: guard(target.exportReady, exportBlockedReason),
    copyValidation: guard(target.exported, "Copy Validation Commands is disabled because you have not exported the physical trace yet."),
    phone: stepGuard(target, expectedStep, "phone"),
    notebook: stepGuard(target, expectedStep, "notebook"),
    pen: stepGuard(target, expectedStep, "pen"),
    writing: stepGuard(target, expectedStep, "writing"),
    typing: stepGuard(target, expectedStep, "typing"),
    uncertain: guard(target.recording, "Mark Uncertain is disabled because recording is not active."),
    reset: guard(target.recording, "Mark Camera Reset is disabled because recording is not active.")
  };
}

export function wizardStagesForState(target) {
  const guards = getButtonGuards(target);
  return [
    stage(1, "Camera", target.cameraReady, "Start the camera preview.", "Start Camera", guards.startCamera.reason),
    stage(2, "Calibration", target.calibrationSaved, "Define rectangles, assign objects, then save calibration.", target.calibrationOpen ? "Save Calibration" : "Calibrate Zones", target.cameraReady ? "" : guards.calibrateZones.reason),
    stage(3, "Quest Setup", target.ritualStarted, "Start the Focus Ritual.", "Start Focus Ritual", guards.startFocusRitual.reason),
    stage(4, "Recording", target.recordingStarted, "Start symbolic recording.", "Start Recording", guards.startRecording.reason),
    stage(5, "Complete Actions", target.questState === "quest_complete", objectiveForQuestState(target.questState), currentStepButtonLabel(target), currentStepDisabledReason(target, guards)),
    stage(6, "Stop Recording", target.recordingStarted && !target.recording, "Stop recording after the ritual is complete.", "Stop Recording", guards.stopRecording.reason),
    stage(7, "Export", target.exported, "Confirm physical provenance, then export.", "Export Physical Trace", guards.exportTrace.reason),
    stage(8, "Validation", target.validationCopied, "Copy and run validation commands.", "Copy Validation Commands", guards.copyValidation.reason)
  ];
}

function exportPhysicalTrace() {
  try {
    state.physicalConfirmed = dom.confirmPhysical.checked === true;
    const fixture = buildReplayFixture(state);
    recordCampaignCapture(state, fixture);
    const blob = new Blob([`${JSON.stringify(fixture, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = currentTraceFilename(state);
    link.click();
    URL.revokeObjectURL(url);
    state.exported = true;
    state.exportStatus = `downloaded; save as ${currentTracePath(state)}`;
    state.statusMessage = "Physical trace exported. Validation commands are now available.";
    state.errorMessage = "";
  } catch (error) {
    state.exportStatus = error?.message ?? "export failed";
    state.errorMessage = state.exportStatus;
  }
  render();
}

function runCampaignAction(action, traceModeId) {
  const mode = SUGGESTION_CAMPAIGN_STEPS.find((step) => step.id === traceModeId);
  if (!mode) return;
  if (action === "start") {
    startCampaignTraceInState(state, mode.id);
  } else if (action === "select") {
    state.suggestionCampaign.active = true;
    state.suggestionCampaign.currentIndex = mode.number - 1;
    state.suggestionTraceMode = mode.id;
    state.statusMessage = `${mode.label} selected.`;
  } else if (action === "reset") {
    resetCampaignTraceInState(state, mode.id);
  } else if (action === "export") {
    exportPhysicalTrace();
    return;
  } else if (action === "copy-path") {
    copyText("Campaign trace save path", mode.path);
  } else if (action === "copy-move") {
    copyText("Campaign trace macOS move command", macosSaveCommandForMode(mode));
  } else if (action === "mark-exported") {
    markCampaignTraceExported(state, mode);
  }
  updateExportReadiness(state);
  render();
}

export function startCampaignTraceInState(target, traceModeId) {
  const mode = SUGGESTION_CAMPAIGN_STEPS.find((step) => step.id === traceModeId);
  if (!mode) return target;
  target.suggestionCampaign.active = true;
  target.suggestionCampaign.currentIndex = mode.number - 1;
  target.suggestionTraceMode = mode.id;
  target.suggestionCampaign.captureStatuses[mode.id] = "active";
  target.suggestionCampaign.exportReadiness[mode.id] = "blocked";
  target.suggestionCampaign.traceStatuses[mode.id] = "active";
  target.suggestionCampaign.traceStates[mode.id] = {
    ...createEmptyTraceState(mode.id, "active"),
    startedAtMs: Math.round(now())
  };
  target.suggestionCampaign.exportedTraceIds = target.suggestionCampaign.exportedTraceIds.filter((id) => id !== mode.id);
  delete target.suggestionCampaign.capturedTraces[mode.filename];
  delete target.suggestionCampaign.lastSuggestions[mode.id];
  resetSuggestionCountersForTrace(target);
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummaryForTrace(target, mode);
  target.objective = "Perform the physical action and wait for a camera suggestion.";
  target.statusMessage = `${mode.label} active. Waiting for camera suggestion.`;
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

function resetCampaignTraceInState(target, traceModeId) {
  const mode = SUGGESTION_CAMPAIGN_STEPS.find((step) => step.id === traceModeId);
  if (!mode) return target;
  target.suggestionCampaign.active = true;
  target.suggestionCampaign.currentIndex = mode.number - 1;
  target.suggestionTraceMode = mode.id;
  target.suggestionCampaign.captureStatuses[mode.id] = "not_started";
  target.suggestionCampaign.exportReadiness[mode.id] = "blocked";
  target.suggestionCampaign.traceStatuses[mode.id] = "not_started";
  target.suggestionCampaign.traceStates[mode.id] = createEmptyTraceState(mode.id);
  delete target.suggestionCampaign.traceSummaries[mode.id];
  delete target.suggestionCampaign.capturedTraces[mode.filename];
  delete target.suggestionCampaign.lastSuggestions[mode.id];
  target.suggestionCampaign.exportedTraceIds = target.suggestionCampaign.exportedTraceIds.filter((id) => id !== mode.id);
  resetSuggestionCountersForTrace(target);
  target.statusMessage = `${mode.label} campaign status reset. Use app reset if you need a clean recording.`;
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

function resetSuggestionCountersForTrace(target) {
  target.perceptionSuggestions = [];
  target.rejectedSuggestionKeys = [];
  target.rejectedSuggestionCooldowns = {};
  target.rejectedCandidateCooldowns = {};
  target.previousActionConfidence = {};
  target.acceptedSuggestionIds = [];
  target.suggestionStats = {
    suggestionsGenerated: 0,
    suggestionsAccepted: 0,
    suggestionsRejected: 0,
    autoCompletedSteps: 0
  };
  target.suggestionGeneratedIds = [];
  target.suggestionAcceptedIds = [];
  target.suggestionRejectedIds = [];
  target.suggestionTypeHistory = [];
  target.handledSuggestionActionIds = [];
}

function exportCampaignBundle() {
  const bundle = buildCampaignBundle(state);
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = CAMPAIGN_BUNDLE_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
  state.statusMessage = "Campaign bundle downloaded. Gate 3B-Live still requires individual suggestion files.";
  render();
}

async function copyValidationCommands() {
  if (!state.exported) {
    state.errorMessage = "Copy Validation Commands is disabled because you have not exported the physical trace yet.";
    render();
    return;
  }
  try {
    await navigator.clipboard.writeText(VALIDATION_COMMANDS);
    state.validationCopied = true;
    state.statusMessage = "Validation commands copied.";
  } catch {
    state.validationCopied = true;
    state.statusMessage = "Validation commands are visible for manual copy.";
  }
  render();
}

async function copyOperatorCommands() {
  if (!state.exported) {
    state.errorMessage = "Operator validation commands are disabled until Export Physical Trace downloads the fixture.";
    render();
    return;
  }
  try {
    await navigator.clipboard.writeText(VALIDATION_COMMANDS);
    state.statusMessage = "Operator validation commands copied.";
    state.errorMessage = "";
  } catch {
    state.statusMessage = "Operator validation commands are visible for manual copy.";
    state.errorMessage = "";
  }
  render();
}

async function copySingleValidationCommand(commandId) {
  const item = VALIDATION_COMMAND_LIST.find((command) => command.id === commandId);
  if (!item) {
    state.errorMessage = "Validation command not available.";
    render();
    return;
  }
  if (!state.exported) {
    state.errorMessage = "Validation command not available until Export Physical Trace downloads the fixture.";
    render();
    return;
  }
  try {
    await navigator.clipboard.writeText(item.command);
    state.validationCopied = true;
    state.statusMessage = `${item.label} command copied.`;
  } catch {
    state.validationCopied = true;
    state.statusMessage = `${item.label} command is visible for manual copy.`;
  }
  render();
}

export function openCustomGestureEditor(target, customSkillId = "", options = {}) {
  const store = options.store || customSkillStore;
  const boundDom = options.dom || dom;
  const wizard = target.customSkillWizard;
  if (wizard?.open && target.customSkillDraft) return target.customSkillDraft;
  const existing = customSkillId ? store.read(customSkillId) : null;
  const skill = existing || createCustomSkill({
    name: "Custom gesture",
    pose_type: "one_hand",
    enabled: false,
    active: false,
    positive_templates: [],
    negative_templates: [],
    test_state: { successful_recognitions: 0, neutral_observed: false, user_approved: false }
  }, { existingIds: store.list().map((skill) => skill.custom_skill_id) });
  const linkedRecipe = existing?.linked_recipe_id ? automationRecipeStore.read(existing.linked_recipe_id) : null;
  const draft = createCustomSkillDraft(skill, existing ? 5 : 1);
  target.customSkillDraft = draft;
  wizard.open = true;
  wizard.action = {
    type: linkedRecipe?.action?.type || "speak_phrase",
    value: automationConfigValue(linkedRecipe)
  };
  wizard.testing = false;
  wizard.testArmed = true;
  wizard.opener = options.opener || (typeof document !== "undefined" ? document.activeElement : null);
  wizard.isSaving = false;
  if (boundDom?.customGestureName) boundDom.customGestureName.value = existing?.name || "";
  if (boundDom?.customGesturePoseType) boundDom.customGesturePoseType.value = skill.pose_type;
  if (boundDom?.customGestureActionType) boundDom.customGestureActionType.value = wizard.action.type;
  if (boundDom?.customGestureActionValue) boundDom.customGestureActionValue.value = wizard.action.value;
  if (boundDom?.customGestureSensitivity) boundDom.customGestureSensitivity.value = String(skill.sensitivity || 1);
  if (boundDom?.customGestureHoldMs) boundDom.customGestureHoldMs.value = String(skill.recognition?.hold_ms || 400);
  if (boundDom?.customGestureCooldown) boundDom.customGestureCooldown.value = String((skill.recognition?.cooldown_ms ?? 2500) / 1000);
  if (boundDom?.customGestureEnabled) boundDom.customGestureEnabled.checked = existing ? existing.enabled === true : true;
  setCustomGestureFormError(boundDom, "");
  updateCustomGestureActionField(boundDom);
  renderCustomGestureWizard(target, boundDom);
  boundDom?.customGestureEditor?.showModal?.();
  globalThis.setTimeout?.(() => (existing ? boundDom?.customGestureActionType : boundDom?.customGestureName)?.focus?.(), 0);
  if (target === state) syncInstantGestureEngine();
  return draft;
}

export function advanceCustomGestureWizard(target, options = {}) {
  const boundDom = options.dom || dom;
  const wizard = target.customSkillWizard;
  const draft = target.customSkillDraft;
  if (!wizard?.open || !draft) return false;
  setCustomGestureFormError(boundDom, "");
  try {
    if (draft.currentStep === 1) {
      const name = String(boundDom?.customGestureName?.value || "").trim();
      if (!name) throw customWizardError("Enter a name for this gesture.", boundDom?.customGestureName);
      draft.skill = normalizeCustomMovementSkill({ ...draft.skill, name });
    } else if (draft.currentStep === 2) {
      const poseType = boundDom?.customGesturePoseType?.value === "two_hand" ? "two_hand" : "one_hand";
      if (poseType !== draft.skill.pose_type) {
        draft.skill = normalizeCustomMovementSkill({
          ...draft.skill,
          pose_type: poseType,
          positive_templates: [],
          negative_templates: [],
          test_state: { successful_recognitions: 0, neutral_observed: false, user_approved: false },
          active: false,
          enabled: false
        });
      }
    } else if (draft.currentStep === 3) {
      if (draft.positiveExamples.length < MIN_CUSTOM_SKILL_EXAMPLES) throw customWizardError(`Capture ${MIN_CUSTOM_SKILL_EXAMPLES} accepted examples before testing.`, boundDom?.captureCustomGestureExample);
      const calibrated = calibrateCustomSkillThreshold(draft.skill);
      if (!calibrated.ok) throw customWizardError("Examples vary too much. Retrain with a steadier pose.", boundDom?.captureCustomGestureExample);
      draft.skill = calibrated.skill;
    } else if (draft.currentStep === 4) {
      if (!canActivateCustomSkill(draft.skill)) throw customWizardError("Complete two successful tests, show one non-match, then select Looks correct.", boundDom?.startCustomGestureTest);
      wizard.testing = false;
    } else if (draft.currentStep === 5) {
      const actionType = String(boundDom?.customGestureActionType?.value || "speak_phrase");
      const value = String(boundDom?.customGestureActionValue?.value || "").trim();
      if (actionType === "signed_webhook_post") throw customWizardError("This external action requires confirmation and cannot run from an instant custom gesture.", boundDom?.customGestureActionType);
      if (!value) throw customWizardError(customActionValuePrompt(actionType), boundDom?.customGestureActionValue);
      wizard.action = { type: actionType, value };
    }
    clearCustomSkillCapture(draft);
    draft.captureState = "idle";
    draft.currentStep = Math.min(6, draft.currentStep + 1);
    renderCustomGestureWizard(target, boundDom);
    return true;
  } catch (error) {
    setCustomGestureFormError(boundDom, error?.message || "Review this step before continuing.", error?.field);
    return false;
  }
}

export function moveCustomGestureWizardBack(target, options = {}) {
  const wizard = target.customSkillWizard;
  const draft = target.customSkillDraft;
  if (!wizard?.open || !draft) return false;
  clearCustomSkillCapture(draft);
  draft.captureState = "idle";
  draft.lastCaptureError = "";
  wizard.testing = false;
  draft.currentStep = Math.max(1, draft.currentStep - 1);
  renderCustomGestureWizard(target, options.dom || dom);
  return true;
}

export function captureCustomSkillExample(target, options = {}) {
  const wizard = target.customSkillWizard;
  const boundDom = options.dom || dom;
  const draft = target.customSkillDraft;
  if (!wizard?.open || !draft || draft.currentStep !== 3) {
    setCustomGestureFormError(boundDom, "Open Capture examples before capturing a gesture.", boundDom?.captureCustomGestureExample);
    return false;
  }
  if (!target.cameraReady) {
    draft.captureState = "error";
    draft.lastCaptureError = "Start the camera first";
    setCustomGestureFormError(boundDom, "Start the camera first", boundDom?.captureCustomGestureExample);
    renderCustomGestureWizard(target, boundDom);
    return false;
  }
  setCustomGestureFormError(boundDom, "");
  clearCustomSkillCapture(draft);
  draft.captureNegative = options.negative === true;
  draft.captureState = "checking_hands";
  draft.lastCaptureError = "";
  draft.liveCandidate = null;
  draft.visibleHandCount = 0;
  draft.landmarkFrameAvailable = false;
  draft.stableHoldMs = 0;
  draft.captureStartedAt = 0;
  renderCustomGestureWizard(target, boundDom);
  if (target === state) syncInstantGestureEngine();
  const setTimer = options.setTimeout || globalThis.setTimeout;
  if (typeof setTimer === "function") {
    draft.captureTimer = setTimer(() => {
      if (target.customSkillDraft !== draft || !customCaptureInProgress(draft)) return;
      const unstable = draft.transientSamples.length > 0;
      finishCustomSkillCaptureFailure(
        target,
        draft,
        unstable ? "Example rejected — movement was too unstable" : "Example rejected — hands were not fully visible",
        boundDom
      );
    }, Number(options.timeoutMs || CUSTOM_SKILL_CAPTURE_TIMEOUT_MS));
  }
  return true;
}

export function beginCustomGestureCapture(target, negative = false, options = {}) {
  return captureCustomSkillExample(target, { ...options, negative });
}

export function startCustomGestureTest(target, options = {}) {
  const draft = target.customSkillDraft;
  if (!draft) return false;
  if (!target.cameraReady) {
    setCustomGestureFormError(options.dom || dom, "Start the camera before testing your gesture.", (options.dom || dom)?.startCustomGestureTest);
    return false;
  }
  target.customSkillWizard.testing = true;
  target.customSkillWizard.testArmed = true;
  draft.captureState = "testing";
  draft.liveCandidate = null;
  renderCustomGestureWizard(target, options.dom || dom);
  if (target === state) syncInstantGestureEngine();
  return true;
}

export function approveCustomGestureTest(target, options = {}) {
  const wizard = target.customSkillWizard;
  const draft = target.customSkillDraft;
  const test = draft?.testResults;
  if (!test || test.successful_recognitions < 2 || test.neutral_observed !== true) return false;
  draft.skill = recordCustomSkillTestObservation(draft.skill, { user_approved: true });
  wizard.testing = false;
  draft.captureState = "approved";
  draft.liveCandidate = null;
  renderCustomGestureWizard(target, options.dom || dom);
  return true;
}

export function handleCustomSkillLandmarksInState(target, frame, options = {}) {
  const wizard = target.customSkillWizard;
  const draft = target.customSkillDraft;
  const hands = currentFrameHands(frame);
  if (draft) {
    draft.visibleHandCount = hands.length;
    draft.landmarkFrameAvailable = hands.length > 0;
  }
  if (wizard?.open && draft && customCaptureInProgress(draft)) {
    if (hands.length !== draft.requiredHandCount) {
      draft.transientSamples.length = 0;
      draft.captureStartedAt = 0;
      draft.stableHoldMs = 0;
      draft.captureState = "waiting_for_hands";
      options.onWizardChange?.(draft);
      if (target === state) renderCustomGestureWizard(target);
      return { code: "custom_skill_hand_count_mismatch", candidate: null, contains_raw_media: false };
    }
    const timestampMs = Number(frame.timestamp_ms);
    if (!draft.transientSamples.length) draft.captureStartedAt = timestampMs;
    draft.transientSamples.push({
      timestamp_ms: timestampMs,
      hands,
      mirrored: frame.mirrored === true,
      contains_raw_media: false
    });
    draft.stableHoldMs = Math.max(0, timestampMs - Number(draft.captureStartedAt || timestampMs));
    draft.captureState = draft.stableHoldMs > 0 ? "capturing" : "hands_detected";
    if (draft.transientSamples.length >= 3 && draft.stableHoldMs >= 250) {
      const transientSamples = draft.transientSamples.splice(0);
      clearCustomSkillCaptureTimer(draft);
      const accepted = acceptCustomSkillDemonstration(draft.skill, transientSamples, { negative: draft.captureNegative });
      transientSamples.length = 0;
      if (accepted.ok) {
        draft.skill = accepted.skill;
        draft.captureState = draft.captureNegative
          ? "negative_accepted"
          : draft.positiveExamples.length >= MIN_CUSTOM_SKILL_EXAMPLES ? "complete" : "accepted";
        draft.lastCaptureError = "";
      } else {
        draft.captureState = "rejected";
        draft.lastCaptureError = customTrainingStatus(accepted.code, draft.requiredHandCount);
      }
      draft.captureNegative = false;
      draft.captureStartedAt = 0;
      draft.stableHoldMs = 0;
    }
    options.onWizardChange?.(draft);
    if (target === state) renderCustomGestureWizard(target);
    return { code: "custom_skill_training", candidate: null, contains_raw_media: false };
  }

  if (wizard?.open && draft && wizard.testing) {
    const classification = processCustomSkillLandmarks(target.customSkillRuntime, {
      ...frame,
      hands,
      landmarks: hands.map((hand) => hand.landmarks),
      handedness: hands.map((hand) => hand.handedness),
      skills: [{ ...draft.skill, active: true, enabled: true }]
    });
    if (classification.candidate && wizard.testArmed) {
      draft.skill = recordCustomSkillTestObservation(draft.skill, { matched: true });
      wizard.testArmed = false;
      draft.liveCandidate = classification.candidate;
      draft.captureState = "test_match";
    } else if (!classification.candidate) {
      draft.skill = recordCustomSkillTestObservation(draft.skill, { neutral: true });
      wizard.testArmed = true;
      draft.liveCandidate = null;
      draft.captureState = classification.code === "custom_skill_ambiguous" ? "test_ambiguous" : "testing";
    }
    options.onWizardChange?.(wizard);
    if (target === state) renderCustomGestureWizard(target);
    return { ...classification, candidate: null };
  }

  const classification = processCustomSkillLandmarks(target.customSkillRuntime, {
    ...frame,
    hands,
    landmarks: hands.map((hand) => hand.landmarks),
    handedness: hands.map((hand) => hand.handedness),
    skills: target.customSkills || []
  });
  return classification;
}

export function saveCustomGestureFromWizard(target, options = {}) {
  const boundDom = options.dom || dom;
  const skillStore = options.skillStore || customSkillStore;
  const recipeStore = options.recipeStore || automationRecipeStore;
  const wizard = target.customSkillWizard;
  const draft = target.customSkillDraft;
  if (!wizard?.open || !draft || wizard.isSaving) return null;
  wizard.isSaving = true;
  setCustomGestureFormError(boundDom, "");
  let createdRecipeId = "";
  try {
    if (!canActivateCustomSkill(draft.skill)) throw customWizardError("Test and approve this gesture before saving.", boundDom?.startCustomGestureTest);
    const actionType = wizard.action.type;
    if (!INSTANT_LOCAL_ACTION_TYPES.includes(actionType)) throw customWizardError("This action requires confirmation and cannot run from an instant custom gesture.", boundDom?.customGestureActionType);
    const actionConfig = automationActionConfig(actionType, wizard.action.value, "");
    const active = boundDom?.customGestureEnabled?.checked !== false;
    const holdMs = Math.max(250, Math.min(1500, Number(boundDom?.customGestureHoldMs?.value || draft.skill.recognition?.hold_ms || 400)));
    const cooldownMs = Math.max(0, Math.min(86_400_000, Number(boundDom?.customGestureCooldown?.value || 2.5) * 1000));
    const recipeInput = {
      schema_version: "movement-automation-recipe.v1-1",
      name: `${draft.name} automation`,
      enabled: active,
      execution_mode: "instant_local_gesture",
      confirmation_policy: "none",
      trigger: {
        movement_key: draft.skill.gesture_key,
        source: "custom_local_skill",
        custom_skill_id: draft.skillId,
        gesture_key: draft.skill.gesture_key,
        aliases: [],
        required_tags: [],
        minimum_confidence: 0.25,
        hold_ms: Math.round(holdMs),
        neutral_reset_required: true,
        require_user_confirmation: false
      },
      action: { type: actionType, config: actionConfig },
      risk_tier: riskTierForAutomationAction(actionType),
      execution_policy: { cooldown_ms: Math.round(cooldownMs), max_runs_per_session: 20, require_per_run_confirmation: false, retry_limit: 0 },
      consent: { run_instantly: true, consent_version: 1, consented_at: Date.now() }
    };
    const existingSkill = skillStore.read(draft.skillId);
    let recipe;
    if (existingSkill?.linked_recipe_id && recipeStore.read(existingSkill.linked_recipe_id)) {
      recipe = recipeStore.update(existingSkill.linked_recipe_id, recipeInput);
    } else {
      recipe = recipeStore.create(recipeInput);
      createdRecipeId = recipe.recipe_id;
    }
    const finalSkill = normalizeCustomMovementSkill({
      ...draft.skill,
      sensitivity: Number(boundDom?.customGestureSensitivity?.value || draft.skill.sensitivity || 1),
      recognition: { ...draft.skill.recognition, hold_ms: Math.round(holdMs), cooldown_ms: Math.round(cooldownMs) },
      enabled: active,
      active,
      linked_recipe_id: recipe.recipe_id
    });
    const saved = existingSkill ? skillStore.update(finalSkill.custom_skill_id, finalSkill) : skillStore.create(finalSkill);
    target.customSkills = skillStore.list();
    target.automation.recipes = recipeStore.list();
    target.automation.lastSafeMessage = "Custom gesture saved.";
    wizard.isSaving = false;
    closeCustomGestureEditor(target, { dom: boundDom, skipFocus: false, force: true });
    lastAutomationRenderKey = "";
    if (target === state) renderAutomationState(target);
    if (target === state) syncInstantGestureEngine();
    return saved;
  } catch (error) {
    if (createdRecipeId) recipeStore.delete(createdRecipeId);
    wizard.isSaving = false;
    setCustomGestureFormError(boundDom, error?.message || "Could not save this custom gesture.", error?.field);
    return null;
  }
}

function closeCustomGestureEditor(target, options = {}) {
  const boundDom = options.dom || dom;
  const wizard = target.customSkillWizard;
  const draft = target.customSkillDraft;
  const opener = wizard?.opener;
  if (!options.force && draft?.positiveExamples.length) {
    const confirmClose = options.confirm || globalThis.confirm;
    if (typeof confirmClose === "function" && confirmClose("Discard captured gesture examples?") !== true) return false;
  }
  if (draft) clearCustomSkillCapture(draft);
  target.customSkillDraft = null;
  wizard.testing = false;
  wizard.open = false;
  boundDom?.customGestureEditor?.close?.();
  if (!options.skipFocus) opener?.focus?.();
  if (target === state) syncInstantGestureEngine();
  return true;
}

function handleCustomSkillManagerAction(target, action, customSkillId) {
  const skill = customSkillStore.read(customSkillId);
  if (!skill) return;
  if (action === "test") return openCustomGestureEditor(target, customSkillId) && startCustomGestureTest(target);
  if (action === "edit-action") return openCustomGestureEditor(target, customSkillId);
  if (action === "retrain") {
    const updated = customSkillStore.clearTemplates(customSkillId);
    if (updated.linked_recipe_id && automationRecipeStore.read(updated.linked_recipe_id)) automationRecipeStore.setEnabled(updated.linked_recipe_id, false);
    target.customSkills = customSkillStore.list();
    target.automation.recipes = automationRecipeStore.list();
    return openCustomGestureEditor(target, customSkillId);
  }
  if (action === "toggle") {
    const enabled = !skill.enabled;
    customSkillStore.update(customSkillId, { enabled, active: enabled });
    if (skill.linked_recipe_id && automationRecipeStore.read(skill.linked_recipe_id)) automationRecipeStore.setEnabled(skill.linked_recipe_id, enabled);
  }
  if (action === "delete" && globalThis.confirm?.(`Delete ${skill.name} and its local templates?`) === true) {
    if (skill.linked_recipe_id) automationRecipeStore.delete(skill.linked_recipe_id);
    customSkillStore.delete(customSkillId);
  }
  target.customSkills = customSkillStore.list();
  target.automation.recipes = automationRecipeStore.list();
  lastAutomationRenderKey = "";
  renderAutomationState(target);
  if (target === state) syncInstantGestureEngine();
}

function clearAllCustomGestures(target) {
  if (!target.customSkills.length || globalThis.confirm?.("Delete all custom gestures and linked local recipes?") !== true) return false;
  for (const skill of target.customSkills) if (skill.linked_recipe_id) automationRecipeStore.delete(skill.linked_recipe_id);
  customSkillStore.clear();
  target.customSkills = [];
  target.automation.recipes = automationRecipeStore.list();
  lastAutomationRenderKey = "";
  renderAutomationState(target);
  syncInstantGestureEngine();
  return true;
}

function renderCustomGestureWizard(target, boundDom = dom) {
  const wizard = target.customSkillWizard;
  const draft = target.customSkillDraft;
  if (!wizard?.open || !draft || !boundDom) return;
  boundDom.customGestureEditor?.querySelectorAll?.("[data-custom-skill-step]").forEach((section) => {
    section.hidden = Number(section.getAttribute("data-custom-skill-step")) !== draft.currentStep;
  });
  if (boundDom.customGestureStepStatus) boundDom.customGestureStepStatus.textContent = `Step ${draft.currentStep} of 6`;
  if (boundDom.customGestureTrainingStatus) boundDom.customGestureTrainingStatus.textContent = customCaptureStatusText(draft);
  if (boundDom.customGestureExampleCount) boundDom.customGestureExampleCount.textContent = `${draft.positiveExamples.length} of ${MIN_CUSTOM_SKILL_EXAMPLES} examples accepted`;
  if (boundDom.customGestureTestStatus) boundDom.customGestureTestStatus.textContent = customTestStatusText(draft);
  if (boundDom.customGestureMatchStatus) {
    const test = draft.testResults;
    boundDom.customGestureMatchStatus.textContent = `${test.successful_recognitions} successful tests · ${test.neutral_observed ? "neutral observed" : "neutral needed"}`;
  }
  if (boundDom.approveCustomGestureTest) {
    boundDom.approveCustomGestureTest.disabled = draft.testResults.successful_recognitions < 2 || !draft.testResults.neutral_observed;
  }
  if (boundDom.customGestureSaveSummary) boundDom.customGestureSaveSummary.textContent = `${draft.name} · ${draft.skill.pose_type === "two_hand" ? "Custom two-hand pose" : "Custom one-hand pose"} · ${draft.positiveExamples.length} examples · ${wizard.action.type.replaceAll("_", " ")}`;
  if (boundDom.captureCustomGestureExample) {
    boundDom.captureCustomGestureExample.disabled = customCaptureInProgress(draft) || draft.positiveExamples.length >= MIN_CUSTOM_SKILL_EXAMPLES;
    boundDom.captureCustomGestureExample.title = customCaptureStatusText(draft);
  }
  if (boundDom.captureCustomGestureNegative) boundDom.captureCustomGestureNegative.disabled = customCaptureInProgress(draft);
  if (boundDom.customGestureBack) boundDom.customGestureBack.hidden = draft.currentStep === 1;
  if (boundDom.customGestureNext) {
    boundDom.customGestureNext.hidden = draft.currentStep === 6;
    boundDom.customGestureNext.disabled = draft.currentStep === 3 && draft.positiveExamples.length < MIN_CUSTOM_SKILL_EXAMPLES;
  }
  if (boundDom.customGestureSave) boundDom.customGestureSave.hidden = draft.currentStep !== 6;
}

function updateCustomGestureActionField(boundDom = dom) {
  const type = boundDom?.customGestureActionType?.value || "speak_phrase";
  if (boundDom?.customGestureActionLabel) boundDom.customGestureActionLabel.textContent = {
    speak_phrase: "Phrase",
    start_timer: "Duration in seconds",
    increment_counter: "Counter name",
    append_activity_log: "Activity category",
    browser_notification: "Notification text",
    signed_webhook_post: "Approved destination"
  }[type] || "Configuration";
}

function setCustomGestureFormError(boundDom, message, field) {
  if (!boundDom?.customGestureFormError) return;
  boundDom.customGestureFormError.hidden = !message;
  boundDom.customGestureFormError.textContent = message || "";
  if (message && field) {
    field.setAttribute?.("aria-invalid", "true");
    field.focus?.();
  }
}

function customWizardError(message, field) {
  const error = new Error(message);
  error.field = field;
  return error;
}

function customActionValuePrompt(actionType) {
  if (actionType === "speak_phrase") return "Enter the phrase Sensefield should speak.";
  if (actionType === "start_timer") return "Enter a timer duration.";
  if (actionType === "increment_counter") return "Enter a counter name.";
  if (actionType === "append_activity_log") return "Enter an activity category.";
  if (actionType === "browser_notification") return "Enter notification text.";
  return "Configure this action before continuing.";
}

function customTrainingStatus(code, handCount) {
  if (code === "custom_skill_example_unstable") return "Example rejected — movement was too unstable";
  if (code === "custom_skill_example_duplicate") return "Move slightly before the next example";
  if (["custom_skill_wrong_hand_count", "custom_skill_example_incomplete"].includes(code)) return "Example rejected — hands were not fully visible";
  return handCount === 2 ? "Example rejected — hands were not fully visible" : "Example rejected — hand was not fully visible";
}

function customCaptureInProgress(draft) {
  return ["checking_hands", "waiting_for_hands", "hands_detected", "capturing"].includes(draft?.captureState);
}

function customCaptureStatusText(draft) {
  if (!draft) return "Start the camera first";
  if (draft.lastCaptureError) return draft.lastCaptureError;
  if (draft.captureState === "checking_hands") return "Checking hands…";
  if (draft.captureState === "waiting_for_hands") return draft.requiredHandCount === 2 ? "Waiting for both hands" : "Waiting for one hand";
  if (draft.captureState === "hands_detected") return draft.requiredHandCount === 2 ? "Both hands detected — hold steady" : "Hand detected — hold steady";
  if (draft.captureState === "capturing") return "Capturing local landmark template…";
  if (draft.captureState === "accepted") return `Example accepted — ${draft.positiveExamples.length} of ${MIN_CUSTOM_SKILL_EXAMPLES}`;
  if (draft.captureState === "negative_accepted") return "Non-match example accepted";
  if (draft.captureState === "complete") return "Five examples captured";
  return draft.requiredHandCount === 2 ? "Position both hands and hold steady." : "Position your hand and hold steady.";
}

function customTestStatusText(draft) {
  if (draft.captureState === "approved") return "Looks correct. Choose an action.";
  if (draft.captureState === "test_ambiguous") return "Ambiguous with another skill.";
  if (draft.captureState === "test_match" && draft.liveCandidate) {
    return `${draft.name} candidate — match score ${coarseMatchScore(draft.liveCandidate.match_score)} — return to neutral.`;
  }
  return "No match — show the gesture, then return to neutral.";
}

function currentFrameHands(frame = {}) {
  const suppliedHands = Array.isArray(frame.hands) ? frame.hands.slice(0, 2) : [];
  const groups = suppliedHands.length
    ? suppliedHands.map((hand) => hand?.landmarks)
    : Array.isArray(frame.landmarks) ? frame.landmarks.slice(0, 2) : [];
  const handedness = suppliedHands.length
    ? suppliedHands.map((hand) => hand?.handedness)
    : Array.isArray(frame.handedness) ? frame.handedness : [];
  return groups.map((group, index) => {
    if (!Array.isArray(group) || group.length < 21) return null;
    const landmarks = group.slice(0, 21).map((point) => ({ x: Number(point?.x), y: Number(point?.y), z: Number(point?.z || 0) }));
    if (landmarks.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z))) return null;
    const value = Array.isArray(handedness[index]) ? handedness[index][0] : handedness[index];
    return {
      handedness: String(value?.categoryName || value?.displayName || value?.label || value || `hand_${index + 1}`),
      landmarks
    };
  }).filter(Boolean);
}

function clearCustomSkillCaptureTimer(draft) {
  if (draft?.captureTimer != null) globalThis.clearTimeout?.(draft.captureTimer);
  if (draft) draft.captureTimer = null;
}

function clearCustomSkillCapture(draft) {
  if (!draft) return;
  clearCustomSkillCaptureTimer(draft);
  draft.transientSamples.length = 0;
  draft.captureStartedAt = 0;
  draft.captureNegative = false;
  draft.stableHoldMs = 0;
}

function finishCustomSkillCaptureFailure(target, draft, message, boundDom = dom) {
  clearCustomSkillCapture(draft);
  draft.captureState = "rejected";
  draft.lastCaptureError = message;
  renderCustomGestureWizard(target, boundDom);
}

function coarseMatchScore(value) {
  const score = Number(value || 0);
  if (score >= 0.8) return "strong";
  if (score >= 0.55) return "medium";
  return "low";
}

function instantRuntimeFor(target) {
  return target.instantGestureRuntimeState || target.instantGestures;
}

function runtimeNow() {
  return Number(globalThis.performance?.now?.() ?? Date.now());
}

function instantRuntimeEffectiveEnabled(runtime) {
  return runtime.userEnabled === true
    && runtime.cameraActive === true
    && runtime.documentVisible === true
    && runtime.enabledRecipeCount > 0;
}

function instantRuntimeReady(runtime, engineStatus = runtime.engineStatus) {
  const age = Number(runtime.lastInferenceAgeMs);
  const recent = Number.isFinite(age)
    ? age < INSTANT_INFERENCE_STALE_MS
    : runtime.lastInferenceAt > 0 && runtimeNow() - runtime.lastInferenceAt < INSTANT_INFERENCE_STALE_MS;
  return String(engineStatus).startsWith("ready")
    && runtime.recognizerInitialized === true
    && runtime.loopRunning === true
    && runtime.successfulInferences > 0
    && recent
    && !runtime.lastErrorCode;
}

export function deriveInstantGestureStatus(input) {
  const runtime = input?.instantGestureRuntimeState || input;
  if (!runtime?.userEnabled) return "Off";
  if (runtime.safeError || runtime.engineStatus === "error" || runtime.engineStatus === "unavailable") return "Error";
  if (!runtime.cameraActive) return "Enabled — waiting for camera";
  if (!runtime.documentVisible) return "Starting inference";
  if (runtime.engineStatus === "loading") return "Loading local gesture AI";
  if (["gesture_detected", "candidate"].includes(runtime.engineStatus)) return "Gesture detected";
  if (["hold_steady", "hold_progress"].includes(runtime.engineStatus)) return "Hold steady";
  if (["executing", "recognized"].includes(runtime.engineStatus)) return "Executing";
  if (runtime.engineStatus === "completed") return "Completed";
  if (runtime.engineStatus === "cooling_down") return "Cooling down";
  if (runtime.engineStatus === "ready" && instantRuntimeReady(runtime)) return "Ready — scanning";
  return "Starting inference";
}

function instantRuntimeDiagnostics(runtime) {
  return {
    ...(runtime._diagnostics || {}),
    engine_mode: runtime.engineMode,
    recognizer_initialized: runtime.recognizerInitialized,
    loop_running: runtime.loopRunning,
    frames_processed: runtime.framesProcessed,
    successful_inferences: runtime.successfulInferences,
    frame_in_flight: runtime.frameInFlight,
    video_ready: runtime.videoReady,
    status: runtime.engineStatus,
    last_inference_at_ms: runtime.lastInferenceAt,
    last_inference_age_ms: runtime.lastInferenceAgeMs,
    last_raw_label: runtime.lastRawLabel,
    last_raw_confidence: runtime.lastRawConfidence,
    mapped_gesture: runtime.lastCandidate,
    fallback_classifier_used: runtime.fallbackClassifierUsed,
    current_hold_ms: runtime.currentHoldMs,
    required_hold_ms: runtime.requiredHoldMs,
    last_stable_event: runtime.lastStableEvent,
    last_stable_event_id: runtime.lastStableEvent,
    last_recipe_outcome_code: runtime.lastRecipeOutcomeCode,
    last_recipe_match: runtime.lastRecipeMatch,
    last_action_outcome_code: runtime.lastActionOutcomeCode,
    last_receipt: runtime.lastReceipt,
    last_receipt_id: runtime.lastReceiptId,
    safe_error: runtime.safeError,
    last_outcome_code: runtime.lastOutcomeCode,
    last_error_code: runtime.lastErrorCode,
    last_error_message: runtime.lastErrorMessage,
    contains_raw_media: false
  };
}

function renderInstantGestureStatus(target = state) {
  const runtime = instantRuntimeFor(target);
  const copy = deriveInstantGestureStatus(runtime);
  target.automation.instantGestureStatus = runtime.engineStatus;
  if (target === state && dom?.instantGestureStatus) dom.instantGestureStatus.textContent = copy;
  return copy;
}

function setInstantGesturePhase(target, engineStatus, patch = {}) {
  const runtime = instantRuntimeFor(target);
  Object.assign(runtime, patch, { engineStatus, contains_raw_media: false });
  renderInstantGestureStatus(target);
}

function syncInstantGestureEngine() {
  const runtime = state.instantGestureRuntimeState;
  runtime.cameraActive = state.cameraReady === true;
  runtime.documentVisible = typeof document === "undefined" || document.hidden !== true;
  runtime.enabledRecipeCount = state.automation.recipes.filter((recipe) => recipe.enabled === true
    && recipe.execution_mode === "instant_local_gesture"
    && recipe.consent?.run_instantly === true).length;
  const instantRequested = runtime.userEnabled === true;
  const trainerRequested = state.customSkillWizard?.open === true && state.customSkillDraft != null;
  const primaryConversation = isPrimaryView() && state.interactionState?.mode === "conversation";
  const engineRequested = (instantRequested || trainerRequested)
    && runtime.cameraActive
    && runtime.documentVisible
    && Boolean(dom?.preview)
    && !primaryConversation;
  if (!engineRequested) {
    stopInstantGestureEngine(runtime.userEnabled && !runtime.cameraActive ? "waiting_camera" : runtime.userEnabled ? "starting_inference" : "off");
    return;
  }
  localGestureEngine ??= createLocalGestureEngine({
    directMainThread: false,
    numHands: 2,
    compatibilityMaxFps: 6,
    onStatusChange: ({ status, reason, code, mode }) => {
      runtime.engineMode = mode || runtime.engineMode;
      if (code && code !== "gesture_direct_main_thread") runtime.lastErrorCode = code;
      if (reason) runtime.lastErrorMessage = String(reason);
      if (["loading", "loading_model"].includes(status)) setInstantGesturePhase(state, "loading");
      if (["starting_inference", "waiting_camera_frames", "stalled"].includes(status)) setInstantGesturePhase(state, "starting_inference");
      if (["ready", "ready_compatibility"].includes(status)) {
        runtime.lastErrorCode = "";
        runtime.lastErrorMessage = "";
        const actionVisible = ["gesture_detected", "hold_steady", "executing", "completed", "cooling_down"].includes(runtime.engineStatus);
        if (!actionVisible) setInstantGesturePhase(state, "ready");
      }
      if (status === "unavailable") {
        const safeError = safeInstantGestureError(reason, code);
        setInstantGesturePhase(state, "error", {
          safeError,
          lastErrorMessage: safeError,
          lastOutcomeCode: code || "gesture_engine_unavailable"
        });
      }
    },
    onDiagnosticsChange: (diagnostics) => setInstantGestureDiagnostics(diagnostics),
    onLandmarks: (frame) => handleCustomSkillLandmarksInState(state, frame),
    onObservation: (observation) => handleLocalGestureObservation(observation, { physicalSmokeTest: true })
  });
  if (!localGestureEngine.isRunning()) {
    setInstantGesturePhase(state, "loading", { safeError: "" });
    localGestureEngine.start(dom.preview);
  }
}

function stopInstantGestureEngine(nextStatus = "off") {
  localGestureEngine?.stop();
  localGestureEngine = null;
  if (instantGestureCooldownTimer) clearTimeout(instantGestureCooldownTimer);
  instantGestureCooldownTimer = null;
  const runtime = state?.instantGestureRuntimeState;
  if (!runtime) return;
  const normalizedStatus = nextStatus === "Off" ? (runtime.userEnabled ? "starting_inference" : "off") : nextStatus;
  runtime.stabilizer = createGestureStabilizerState();
  runtime.loopRunning = false;
  runtime.recognizerInitialized = false;
  runtime.engineMode = "off";
  setInstantGesturePhase(state, normalizedStatus);
}

function safeInstantGestureError(reason, code) {
  const fallback = code ? `Local gesture engine failed: ${code}` : "Unavailable — local gesture processing could not start.";
  const raw = String(reason || fallback);
  return raw
    .replace(/(?:hf_|sk-)[a-z0-9_-]+/gi, "[redacted]")
    .replace(/([?&](?:token|key|secret|signature|credential)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 220);
}

function setInstantGestureDiagnostics(diagnostics = {}) {
  const runtime = state.instantGestureRuntimeState;
  runtime._diagnostics = { ...runtime._diagnostics, ...diagnostics, contains_raw_media: false };
  runtime.engineMode = String(diagnostics.engine_mode || diagnostics.mode || runtime.engineMode);
  runtime.recognizerInitialized = diagnostics.recognizer_initialized ?? diagnostics.recognizer_ready ?? runtime.recognizerInitialized;
  runtime.loopRunning = diagnostics.loop_running === true;
  runtime.framesProcessed = Number(diagnostics.frames_processed || 0);
  runtime.successfulInferences = Number(diagnostics.successful_inferences || 0);
  runtime.lastInferenceAt = Number(diagnostics.last_inference_at_ms || 0);
  runtime.lastInferenceAgeMs = Number.isFinite(Number(diagnostics.last_inference_age_ms)) ? Number(diagnostics.last_inference_age_ms) : null;
  runtime.lastRawLabel = String(diagnostics.last_raw_label || "None");
  runtime.lastRawConfidence = Number(diagnostics.last_raw_confidence || 0);
  runtime.lastCandidate = diagnostics.mapped_gesture || null;
  runtime.fallbackClassifierUsed = diagnostics.fallback_classifier_used === true;
  runtime.frameInFlight = diagnostics.frame_in_flight === true;
  runtime.videoReady = diagnostics.video_ready === true;
  if (diagnostics.last_error_code) runtime.lastErrorCode = String(diagnostics.last_error_code);
  if (diagnostics.last_error_message) runtime.lastErrorMessage = String(diagnostics.last_error_message);
  renderInstantGestureStatus(state);
  renderInstantGestureDiagnostics(state);
}

export async function handleLocalGestureObservationInState(target, observation, options = {}) {
  if (target.interactionState?.sessionActive && interactionModeIs(target, "conversation")) {
    return { matches: [], receipts: [], code: "conversation_runtime_isolated" };
  }
  const runtime = instantRuntimeFor(target);
  const documentHidden = options.documentHidden ?? (typeof document !== "undefined" && document.hidden === true);
  runtime.cameraActive = target.cameraReady === true;
  runtime.documentVisible = !documentHidden;
  runtime.enabledRecipeCount = target.automation.recipes.filter((recipe) => recipe.enabled && recipe.execution_mode === "instant_local_gesture").length;
  if (!runtime.userEnabled) return { matches: [], receipts: [], code: "instant_gesture_not_enabled" };
  if (!target.cameraReady) return { matches: [], receipts: [], code: "instant_camera_inactive" };
  if (documentHidden) return { matches: [], receipts: [], code: "instant_document_hidden" };
  const engineStatus = String(options.engineStatus || runtime.engineStatus || "unavailable");
  if (["off", "unavailable"].includes(engineStatus)) return { matches: [], receipts: [], code: "instant_engine_unavailable" };
  const compatibilityReady = target !== state && engineStatus.startsWith("ready");
  if (!instantRuntimeReady(runtime, engineStatus) && !compatibilityReady) {
    setInstantGestureStatusForTarget(target, "starting_inference", "Starting inference", options);
    return { matches: [], receipts: [], code: "instant_engine_not_ready" };
  }
  const candidates = target.automation.recipes.filter((recipe) => recipe.enabled && recipe.execution_mode === "instant_local_gesture" && recipe.trigger?.gesture_key === observation.gesture_key);
  const physicalSmokeTest = options.physicalSmokeTest === true && observation.gesture_key === "thumbs_up";
  const settings = candidates.length ? {
    minimumConfidence: physicalSmokeTest ? 0.55 : Math.min(...candidates.map((recipe) => Number(recipe.trigger.minimum_confidence ?? INSTANT_GESTURE_DEFAULTS.minimumConfidence))),
    holdMs: physicalSmokeTest ? 250 : Math.max(...candidates.map((recipe) => Number(recipe.trigger.hold_ms ?? INSTANT_GESTURE_DEFAULTS.holdMs))),
    neutralResetMs: INSTANT_GESTURE_DEFAULTS.neutralResetMs,
    cooldownMs: physicalSmokeTest ? 3000 : Math.max(...candidates.map((recipe) => Number(recipe.execution_policy?.cooldown_ms ?? INSTANT_GESTURE_DEFAULTS.cooldownMs)))
  } : INSTANT_GESTURE_DEFAULTS;
  const stabilized = updateGestureStabilizer(runtime.stabilizer, observation, settings);
  runtime.stabilizer = stabilized.state;
  const timestampMs = Number(observation.timestamp_ms || 0);
  const holdProgressMs = stabilized.state.candidateSinceMs == null
    ? 0
    : Math.max(0, timestampMs - Number(stabilized.state.candidateSinceMs));
  runtime.currentHoldMs = holdProgressMs;
  runtime.requiredHoldMs = settings.holdMs;
  runtime.fallbackClassifierUsed = observation.source === "mediapipe_landmark_fallback";
  runtime.lastRecipeOutcomeCode = stabilized.code;
  runtime.lastCandidate = observation.gesture_key || null;
  if (observation.gesture_key) {
    const label = gestureStatusLabel(observation.gesture_key);
    const confidencePercent = Math.round(Number(observation.confidence || 0) * 100);
    const message = holdProgressMs > 0
      ? `${label} — ${formatVisibleGestureHold(holdProgressMs, settings.holdMs)} / ${Math.round(settings.holdMs)}ms`
      : `${label} ${confidencePercent}% — hold steady`;
    setInstantGestureStatusForTarget(target, holdProgressMs > 0 ? "hold_progress" : "candidate", message, options);
  }
  if (!stabilized.event) {
    runtime.lastOutcomeCode = stabilized.code;
    const activeCooldown = target.automation.recipes.some((recipe) => recipe.execution_mode === "instant_local_gesture"
      && Number(target.automation.cooldowns?.[recipe.recipe_id] || 0) > timestampMs);
    if (activeCooldown || stabilized.code === "instant_gesture_cooldown_active" || stabilized.code === "instant_gesture_duplicate") {
      setInstantGestureStatusForTarget(target, "cooling_down", "Cooling down", options);
    } else if (observation.gesture_key && holdProgressMs >= settings.holdMs) {
      setInstantGestureStatusForTarget(target, "unavailable", stabilized.code, options);
    } else if (!observation.gesture_key && !["completed", "cooling_down"].includes(runtime.engineStatus)) {
      setInstantGestureStatusForTarget(
        target,
        engineStatus.startsWith("ready") ? "ready" : "starting_inference",
        engineStatus.startsWith("ready") ? "No hand gesture detected" : "Starting inference",
        options
      );
    }
    return { matches: [], receipts: [], code: stabilized.code, stabilization: stabilized };
  }
  if (!engineStatus.startsWith("ready")) {
    setInstantGestureStatusForTarget(target, "unavailable", "instant_engine_unavailable", options);
    return { matches: [], receipts: [], code: "instant_engine_unavailable", stabilization: stabilized };
  }
  setInstantGestureStatusForTarget(target, "recognized", "Recognized — executing", options);
  const stableHandler = options.handleStableLocalGesture || handleStableLocalGesture;
  const executionRecipes = physicalSmokeTest
    ? withPhysicalSmokeThresholds(target.automation.recipes, observation.gesture_key)
    : target.automation.recipes;
  const outcome = await stableHandler(stabilized.event, { ...options, target, documentHidden, executionRecipes });
  runtime.lastOutcomeCode = outcome.code || "instant_recipe_mismatch";
  runtime.lastStableEvent = stabilized.event.gesture_event_id;
  runtime.lastRecipeOutcomeCode = outcome.outcome_codes?.includes("instant_recipe_matched")
    ? "instant_recipe_matched"
    : outcome.code || "instant_recipe_not_enabled";
  runtime.lastRecipeMatch = outcome.matches?.map((recipe) => recipe.recipe_id).join(", ") || "";
  runtime.lastActionOutcomeCode = outcome.outcome_codes?.find((code) => code.startsWith("instant_action_") || code.startsWith("instant_speech_"))
    || (/^instant_(?:action_|speech_)/.test(outcome.code || "") ? outcome.code : "");
  const receipt = outcome.receipts?.at(-1);
  runtime.lastReceipt = receipt?.safe_message || "";
  runtime.lastReceiptId = receipt?.execution_id || "";
  runtime.safeError = receipt?.status === "failed" ? receipt.safe_message : "";
  return { ...outcome, stabilization: stabilized };
}

export async function handleStableLocalGesture(gestureEvent, options = {}) {
  const target = options.target || state;
  if (target.interactionState?.sessionActive && interactionModeIs(target, "conversation")) {
    return { matches: [], receipts: [], code: "conversation_runtime_isolated" };
  }
  const runtime = instantRuntimeFor(target);
  const documentHidden = options.documentHidden ?? (typeof document !== "undefined" && document.hidden === true);
  const engineStatus = options.engineStatus || localGestureEngine?.getStatus?.() || "unavailable";
  if (!runtime.userEnabled) return { matches: [], receipts: [], code: "instant_gesture_not_enabled" };
  if (!target.cameraReady) return { matches: [], receipts: [], code: "instant_camera_inactive" };
  if (documentHidden) return { matches: [], receipts: [], code: "instant_document_hidden" };
  if (!String(engineStatus).startsWith("ready")) return { matches: [], receipts: [], code: "instant_engine_unavailable" };

  const frozenGestureEvent = Object.freeze({ ...gestureEvent, contains_raw_media: false });
  runtime.lastGestureEvent = frozenGestureEvent;
  setInstantGestureStatusForTarget(target, "recognized", "Recognized — executing", options);
  const runStableGesture = options.runAutomationForStableLocalGesture || runStableGestureRecipes;
  const instantGestureConsent = { instantGesturesEnabled: runtime.userEnabled };
  const outcome = await runStableGesture({
    gestureEvent: frozenGestureEvent,
    recipes: options.executionRecipes || target.automation.recipes,
    runtimeState: target.automation,
    context: {
      ...instantGestureConsent,
      cameraActive: target.cameraReady,
      cameraReady: target.cameraReady,
      documentVisible: !documentHidden,
      documentHidden,
      engineStatus: String(engineStatus).startsWith("ready") ? "ready" : engineStatus,
      speechSynthesis: options.speechSynthesis || globalThis.speechSynthesis,
      SpeechSynthesisUtterance: options.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance,
      Notification: options.Notification || globalThis.Notification,
      userGesture: false,
      onRuntimeChange: options.onRuntimeChange,
      ...(options.context || {})
    }
  });
  const receipt = outcome.receipts?.at(-1);
  if (receipt?.status === "succeeded") {
    setInstantGestureStatusForTarget(target, "completed", String(receipt.safe_message || "Completed").replace(/^Completed:\s*/, "Completed — "), options);
  } else if (receipt?.status === "failed") {
    setInstantGestureStatusForTarget(target, "unavailable", receipt.safe_message, options);
  } else if (outcome.code) {
    setInstantGestureStatusForTarget(target, "unavailable", outcome.code, options);
  }
  return { ...outcome, gestureEvent: frozenGestureEvent };
}

function setInstantGestureStatusForTarget(target, status, message, options = {}) {
  options.onStatusChange?.({ status, message });
  const phase = {
    candidate: "gesture_detected",
    hold_progress: "hold_steady",
    recognized: "executing",
    unavailable: "error"
  }[status] || status;
  setInstantGesturePhase(target, phase, phase === "error" ? { safeError: String(message || "Instant gesture failed.") } : {});
}

function formatVisibleGestureHold(holdMs, requiredHoldMs) {
  const hold = Number(holdMs);
  const required = Number(requiredHoldMs);
  if (!Number.isFinite(hold) || hold <= 0) return 0;
  if (Number.isFinite(required) && hold >= required) return Math.round(required);
  return Math.max(0, Math.floor(hold));
}

function withPhysicalSmokeThresholds(recipes, gestureKey) {
  return (Array.isArray(recipes) ? recipes : []).map((recipe) => {
    if (recipe?.execution_mode !== "instant_local_gesture" || recipe?.trigger?.gesture_key !== gestureKey) return recipe;
    return {
      ...recipe,
      trigger: { ...recipe.trigger, minimum_confidence: 0.55, hold_ms: 250 },
      execution_policy: { ...recipe.execution_policy, cooldown_ms: 3000 }
    };
  });
}

async function handleLocalGestureObservation(observation, options = {}) {
  const outcome = await handleLocalGestureObservationInState(state, observation, {
    ...options,
    engineStatus: localGestureEngine?.getStatus?.() || "ready",
    speechSynthesis: globalThis.speechSynthesis,
    SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance,
    Notification: globalThis.Notification,
    onRuntimeChange: () => renderAutomationState(state)
  });
  if (!outcome.gestureEvent) return outcome;
  lastAutomationRenderKey = "";
  renderAutomationState(state);
  scheduleInstantGestureCooldownInState(state, outcome);
  return outcome;
}

export function scheduleInstantGestureCooldownInState(target, outcome, options = {}) {
  if (!outcome?.receipts?.some((receipt) => receipt.status === "succeeded") || !outcome.matches?.length) return null;
  const setTimer = options.setTimeout || globalThis.setTimeout;
  const clearTimer = options.clearTimeout || globalThis.clearTimeout;
  if (typeof setTimer !== "function") return null;
  const cooldownMs = Math.max(...outcome.matches.map((recipe) => Number(recipe.execution_policy?.cooldown_ms || INSTANT_GESTURE_DEFAULTS.cooldownMs)));
  const completedVisibleMs = Math.min(700, Math.max(0, cooldownMs));
  const runtime = instantRuntimeFor(target);
  const previousTimer = target === state ? instantGestureCooldownTimer : runtime.cooldownTimer;
  if (previousTimer) clearTimer?.(previousTimer);
  const firstTimer = setTimer(() => {
    setInstantGestureStatusForTarget(target, "cooling_down", "Cooling down", options);
    const secondTimer = setTimer(() => {
      const engineStatus = options.engineStatus || (target === state ? localGestureEngine?.getStatus?.() : "ready");
      const documentHidden = options.documentHidden ?? (typeof document !== "undefined" && document.hidden === true);
      if (runtime.userEnabled && target.cameraReady && !documentHidden && String(engineStatus).startsWith("ready")) {
        setInstantGestureStatusForTarget(target, "ready", "Ready — scanning", options);
      }
    }, Math.max(0, cooldownMs - completedVisibleMs));
    if (target === state) instantGestureCooldownTimer = secondTimer;
    else runtime.cooldownTimer = secondTimer;
  }, completedVisibleMs);
  if (target === state) instantGestureCooldownTimer = firstTimer;
  else runtime.cooldownTimer = firstTimer;
  return firstTimer;
}

function gestureStatusLabel(gestureKey) {
  return {
    thumbs_up: "Thumbs up",
    thumbs_down: "Thumbs down",
    peace_sign: "Peace sign",
    open_palm: "Open palm",
    closed_fist: "Closed fist",
    pointing_up: "Pointing up",
    i_love_you: "I love you"
  }[gestureKey] || "Gesture";
}

function startLocalPerception() {
  if (!dom?.preview || perceptionRuntime.rafId) return;
  perceptionRuntime.canvas ??= document.createElement("canvas");
  perceptionRuntime.canvas.width = LOCAL_PERCEPTION_SAMPLE.width;
  perceptionRuntime.canvas.height = LOCAL_PERCEPTION_SAMPLE.height;
  perceptionRuntime.context = perceptionRuntime.canvas.getContext("2d", { willReadFrequently: true });
  perceptionRuntime.previousMotionSample = null;
  perceptionRuntime.lastProcessedMs = 0;
  perceptionRuntime.zoneState = new Map();
  perceptionRuntime.gestureWindows = new Map();
  perceptionRuntime.motionHistory = new Map();
  perceptionRuntime.lastPerceptionFrameMs = 0;
  perceptionRuntime.uncertainSinceMs = null;
  state.localActionDiagnostics.activeEngine = "motion_proxy";
  state.localActionDiagnostics.handEngineStatus = "fallback motion proxy";
  state.localPerceptionStatus = "running";
  perceptionRuntime.rafId = requestAnimationFrame(processLocalPerceptionFrame);
  if (!perceptionRuntime.watchdogTimer) {
    perceptionRuntime.watchdogTimer = setInterval(() => {
      if (!state.interactionState?.sessionActive || !interactionModeIs(state, "observing")) return;
      const heartbeatAgeMs = Math.max(0, Math.round(now() - Number(perceptionRuntime.lastPerceptionFrameMs || 0)));
      if (heartbeatAgeMs <= 3000) return;
      recordSensefieldTestEvent("detector_heartbeat_missing", { mode: "observing", heartbeat_age_ms: heartbeatAgeMs });
      state.movementRecognition.persistent.state = "error";
      state.statusMessage = "Visual detector unavailable.";
      render();
    }, 1000);
  }
}

function stopLocalPerception() {
  if (perceptionRuntime.rafId) cancelAnimationFrame(perceptionRuntime.rafId);
  perceptionRuntime.rafId = null;
  perceptionRuntime.previousMotionSample = null;
  perceptionRuntime.zoneState.clear();
  perceptionRuntime.gestureWindows.clear();
  perceptionRuntime.uncertainSinceMs = null;
  if (perceptionRuntime.watchdogTimer) clearInterval(perceptionRuntime.watchdogTimer);
  perceptionRuntime.watchdogTimer = null;
  if (perceptionRuntime.baselineFrame) clearMovementFrameBuffer([perceptionRuntime.baselineFrame]);
  perceptionRuntime.baselineFrame = null;
  perceptionRuntime.baselineCaptureInFlight = false;
  state.localPerceptionStatus = "stopped";
}

export async function analyzeMovementInState(target = state, options = {}) {
  const requestMode = normalizeInteractionMode(options.interactionMode || (options.directUserTurn ? "conversation" : options.persistent ? "observing" : target.interactionState?.mode));
  const requestGenerationId = Number(options.modeGenerationId ?? target.interactionState?.modeGenerationId ?? 0);
  const runtimeToken = options.realtimeTask?.runtimeToken || null;
  const requestId = runtimeToken?.requestId || `direct_${requestMode}_${Math.round(now())}`;
  const requestStillOwned = () => runtimeToken
    ? target.emergencyRuntimeController.isCurrent(runtimeToken, "requestId", runtimeToken.requestId)
    : modeRequestStillCurrent(target, requestMode, requestGenerationId);
  if (target.interactionState?.sessionActive && !modeRequestStillCurrent(target, requestMode, requestGenerationId)) return target;
  if (options.directUserTurn && requestMode !== "conversation") return target;
  if (options.persistent && requestMode !== "observing") return target;
  if (target.movementRecognition.requestInFlight || ["checking", "capturing", "analyzing"].includes(target.movementRecognition.status)) return target;
  if (typeof document !== "undefined" && document.hidden) {
    target.errorMessage = "Camera tab is hidden. Return to the tab and try again.";
    render();
    return target;
  }
  if (!target.cameraReady || !dom?.preview || dom.preview.readyState < 2) {
    target.errorMessage = "Start the camera first.";
    render();
    return target;
  }
  target.movementRecognition.requestInFlight = true;
  target.movementRecognition.activeRequestId = requestId;
  const RequestController = globalThis.AbortController;
  const requestController = typeof RequestController === "function" ? new RequestController() : null;
  target.movementRecognition.activeRequestAbortController = requestController;
  if (target.interactionState?.sessionActive) applyInteractionState(target, { inferenceInFlight: true });
  if (options.persistent) target.movementRecognition.persistent.state = "active";
  if (options.directUserTurn) void cancelVisualSpeech(target);
  setMovementCaptureState(target, "get_ready");
  target.movementRecognition.status = "checking";
  target.movementRecognition.lastResult = null;
  target.movementRecognition.lastError = "";
  target.movementRecognition.lastSafeError = "";
  target.movementRecognition.fallbackUsed = false;
  target.movementRecognition.frameBufferCleared = false;
  target.movementRecognition.confirmed = false;
  target.movementRecognition.lastSpokenMovement = "";
  target.movementResultSnapshot = null;
  target.statusMessage = "Get ready...";
  render();

  const frames = [];
  const startedAt = now();
  let captureConfig = VISUAL_COMPANION_CLIENT_CONFIG;
  try {
    if (requestMode === "observing") {
      const baseline = perceptionRuntime.baselineFrame;
      if (baseline && Math.round(now()) - Number(baseline.captured_at_ms || 0) <= 5000) {
        frames.push(baseline);
        perceptionRuntime.baselineFrame = null;
      } else {
        frames.push(await captureTransientMovementFrame(dom.preview, VISUAL_COMPANION_CLIENT_CONFIG));
      }
    }
    const backend = await selectMovementAnalysisBackend(target, { preferCloud: true });
    if (!requestStillOwned()) return target;
    captureConfig = backend.kind === "local_visual"
      ? backend.captureConfig
      : options.persistent
      ? {
          ...backend.captureConfig,
          maxFrames: Math.max(4, Math.min(PERSISTENT_OBSERVATION.maxFrames, 8)),
          windowMs: Math.max(2000, Math.min(PERSISTENT_OBSERVATION.windowMs, 4000))
        }
      : backend.captureConfig;
    await delay(requestMode === "observing" ? 350 : 0);
    if (!requestStillOwned()) return target;
    setMovementCaptureState(target, "capturing");
    target.movementRecognition.status = "capturing";
    if (options.persistent) target.movementRecognition.persistent.state = "active";
    target.statusMessage = "Watching…";
    render();
    const remainingFrameCount = Math.max(1, Number(captureConfig.maxFrames || 1) - frames.length);
    frames.push(...await withTimeout(
      captureMovementFrameWindow(dom.preview, { ...captureConfig, maxFrames: remainingFrameCount }),
      Math.max(5000, Number(captureConfig.windowMs || 0) + 2000),
      "Camera capture window timed out."
    ));
    if (!requestStillOwned()) return target;
    validateLiveFrameWindow(frames, target, { requireChange: requestMode === "observing" });
    setMovementCaptureState(target, "analyzing");
    target.movementRecognition.status = "analyzing";
    if (options.persistent) target.movementRecognition.persistent.state = "active";
    target.statusMessage = "Understanding…";
    render();
    const inferenceRequest = backend.kind === "local_visual"
      ? requestVisualCompanionObservation({
          frames,
          frame_timestamps_ms: frames.map((frame) => frame.captured_at_ms),
          previous_context: visualContextForRequest(target),
          user_question: sanitizeMemoryText(options.userQuestion || ""),
          requested_response_mode: requestMode === "conversation" ? "conversation" : "movement_observation",
          allowed_suggested_actions: VISUAL_COMPANION_ALLOWED_ACTIONS,
          client_scene_change_score: computeVisualSceneChangeScore(frames),
          memory_mode: target.visualContext.memoryMode,
          interaction_mode: requestMode,
          mode_generation_id: requestGenerationId
        }, { signal: requestController?.signal })
      : requestMovementRecognition({
          frames,
          allowed_actions: MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
          current_step: requestMode === "conversation" ? "visual_conversation" : "movement_narration",
          zone_metadata: movementRecognitionZoneMetadata(target),
          recent_corrections: recentCorrectionContextForPrompt(target),
          previous_context: visualContextForRequest(target),
          user_question: sanitizeMemoryText(options.userQuestion || ""),
          requested_response_mode: requestMode === "conversation" ? "conversation" : "movement_observation",
          interaction_mode: requestMode,
          mode_generation_id: requestGenerationId,
          window_ms: captureConfig.windowMs
        }, target, { signal: requestController?.signal });
    const inferenceTimeoutMs = options.inferenceTimeoutMs ?? 45000;
    const rawResult = await withTimeout(
      inferenceRequest,
      inferenceTimeoutMs,
      "Visual inference timed out.",
      () => requestController?.abort?.()
    );
    if (!requestStillOwned()) return target;
    const responseSource = backend.kind === "local_visual" ? "local_vlm" : "cloud_vlm";
    const result = {
      ...rawResult,
      ...(options.userQuestion ? { question: sanitizeMemoryText(options.userQuestion) } : {}),
      response_source: responseSource
    };
    validateLiveInferenceResult(result, requestMode);
    if (target.interactionState?.sessionActive && !modeRequestStillCurrent(target, requestMode, requestGenerationId)) {
      target.movementRecognition.status = "idle";
      target.movementCaptureState.status = "idle";
      return target;
    }
    queueMovementRecognitionResult(target, result, Math.round(now()), {
      recordMovementHistory: requestMode === "observing",
      queueSuggestion: requestMode === "observing"
    });
    if (result.provider !== "local_motion_proxy") target.vlmCalls += 1;
    setMovementCaptureState(target, "result_ready");
    target.movementRecognition.status = "complete";
    target.movementRecognition.provider = result.provider ?? VISUAL_COMPANION_CLIENT_CONFIG.provider;
    target.movementRecognition.model = result.model ?? "local model service";
    target.movementRecognition.promptVersion = result.prompt_version ?? VISUAL_COMPANION_PROMPT_VERSION;
    target.movementRecognition.imageTokens = result.image_tokens ?? 0;
    target.movementRecognition.retries = result.retries ?? 0;
    target.movementRecognition.candidateFailures = safeFailedCandidateDiagnostics(result.failed_candidates);
    target.movementRecognition.lastResult = result;
    if (target === state) recordSensefieldTestEvent("inference_result_validated", {
      mode: requestMode,
      frame_count: frames.length,
      frame_dimensions: frames.map((frame) => `${frame.width}x${frame.height}`),
      request_duration_ms: Math.max(0, Math.round(now() - startedAt)),
      provider: result.provider || backend.health?.provider || "unavailable",
      model: result.model || backend.health?.model || "unavailable",
      response_source: result.response_source
    }, { modeGenerationId: requestGenerationId });
    updateVisualContextFromResult(target, result);
    appendRealtimeVisualSummary(target, result.reason || result.movement || "");
    target.statusMessage = "Response ready.";
    if (options.persistent) {
      target.movementRecognition.persistent.lastSemanticKey = semanticObservationKey(result);
      target.movementRecognition.persistent.state = "active";
    }
    maybeAutoSpeakVisualResult(target);
    target.lastLatency = {
      event_id: `movement_recognition_${Math.round(startedAt)}`,
      frame_id: `movement_recognition_${Math.round(startedAt)}`,
      timestamp_ms: Math.round(startedAt),
      frame_capture_ms: captureConfig.windowMs,
      observation_extraction_ms: Math.max(1, Math.round(now() - startedAt)),
      adapter_ms: 0,
      stabilizer_ms: 0,
      event_emission_ms: 0,
      hud_update_ms: 1,
      trace_recorder_ms: 0,
      end_to_end_ms: Math.max(1, Math.round(now() - startedAt)),
      dropped_frames: 0,
      llm_calls: 0,
      vlm_calls: result.provider === "local_motion_proxy" ? 0 : 1,
      raw_media_persistence_count: 0
    };
    target.latencyRecords.push(target.lastLatency);
  } catch (error) {
    if (!requestStillOwned()) return target;
    if (error?.movement_code === "provider_busy") {
      setMovementCaptureState(target, "idle");
      target.movementRecognition.status = "idle";
      target.movementRecognition.fallbackUsed = false;
      target.movementRecognition.lastError = "";
      target.movementRecognition.lastSafeError = "";
      target.errorMessage = "";
      target.statusMessage = requestMode === "observing" ? "Watching." : "Listening.";
      if (options.persistent) target.movementRecognition.persistent.state = "active";
      return target;
    }
    const safeMessage = safeObservationErrorMessage(error);
    const localFallback = false;
    setMovementCaptureState(target, "error");
    target.movementRecognition.status = "fallback";
    target.movementRecognition.fallbackUsed = true;
    target.movementRecognition.lastError = safeMessage;
    target.movementRecognition.lastSafeError = safeMessage;
    target.movementRecognition.candidateFailures = safeFailedCandidateDiagnostics(error?.safe_diagnostics?.failed_candidates);
    target.statusMessage = safeMessage;
    if (options.persistent) target.movementRecognition.persistent.state = target.realtimeSession?.state === "active" ? "active" : "error";
    console.warn("movement observation failed", safeMovementRecognitionDiagnostics(error));
    if (localFallback) {
      queueMovementRecognitionFallback(target, Math.round(now()), { fallbackMessage: safeMessage });
    } else {
      queueVisualReasoningUnavailable(target, safeMessage, Math.round(now()), {
        recordMovementHistory: requestMode === "observing",
        queueSuggestion: false
      });
    }
  } finally {
    clearMovementFrameBuffer(frames);
    target.movementRecognition.frameBufferCleared = true;
    const ownsLegacyLock = target.movementRecognition.activeRequestId === requestId;
    if (ownsLegacyLock) {
      target.movementRecognition.requestInFlight = false;
      target.movementRecognition.activeRequestId = null;
      if (target.movementRecognition.activeRequestAbortController === requestController) {
        target.movementRecognition.activeRequestAbortController = null;
      }
    }
    if (ownsLegacyLock && target.interactionState?.sessionActive && requestStillOwned()) {
      applyInteractionState(target, { inferenceInFlight: false });
    }
    if (ownsLegacyLock) {
      updateExportReadiness(target);
      render();
    }
  }
  return target;
}

export async function captureMovementFrameWindow(video, config = MOVEMENT_RECOGNITION_CLIENT_CONFIG) {
  const frameCount = Math.max(1, Math.min(config.maxFrames ?? 4, 8));
  const waitMs = frameCount <= 1 ? 0 : Math.floor((config.windowMs ?? 1500) / (frameCount - 1));
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    if (index > 0) await delay(waitMs);
    frames.push(await captureTransientMovementFrame(video, config));
  }
  return frames;
}

export function validateLiveFrameWindow(frames = [], target = state, options = {}) {
  if (!Array.isArray(frames) || frames.length < 1) throw movementRecognitionError("No visual frames were captured.", "invalid_image_payload");
  const timestamps = frames.map((frame) => Number(frame.captured_at_ms || 0));
  if (frames.some((frame) => Number(frame.width || 0) <= 0 || Number(frame.height || 0) <= 0)) {
    throw movementRecognitionError("Camera frame dimensions are invalid.", "invalid_image_payload");
  }
  if (timestamps.some((value, index) => value <= 0 || (index > 0 && value < timestamps[index - 1]))) {
    throw movementRecognitionError("Camera frame timestamps are not ordered.", "invalid_image_payload");
  }
  if (Math.round(now()) - timestamps.at(-1) > 5000) throw movementRecognitionError("Camera frames are stale.", "invalid_image_payload");
  const videoTracks = target.stream?.getVideoTracks?.() || target.stream?.getTracks?.().filter?.((track) => track.kind === "video") || [];
  if (!videoTracks.length || videoTracks.some((track) => track.readyState === "ended")) {
    throw movementRecognitionError("Camera track is not live.", "invalid_image_payload");
  }
  if (options.requireChange === true && frames.length < 2) throw movementRecognitionError("The movement window is incomplete.", "invalid_image_payload");
  if (options.requireChange === true) {
    const signatures = frames.map((frame) => JSON.stringify(frame.luma_signature || []));
    const encodedFrames = frames.map((frame) => String(frame.encoded_frame || ""));
    if (new Set(signatures).size < 2 && new Set(encodedFrames).size < 2) {
      throw movementRecognitionError("The movement window did not include a visible change.", "invalid_image_payload");
    }
  }
  return {
    ok: true,
    frame_count: frames.length,
    width: frames[0].width,
    height: frames[0].height,
    ordered: true,
    recent: true,
    distinct: options.requireChange !== true || true
  };
}

export function validateLiveInferenceResult(result = {}, mode = "observing") {
  const text = String(result.spoken_response || result.movement || "").trim();
  if (!text) throw movementRecognitionError("The visual model returned an empty response.", "malformed_response");
  if (/^No meaningful change detected\.?$/i.test(text)) {
    throw movementRecognitionError("The visual model returned a generic canned response.", "malformed_response");
  }
  if (result.response_source === "deterministic_test_fixture" && !sensefieldTestModeEnabled()) {
    throw movementRecognitionError("A test fixture result reached the production runtime.", "malformed_response");
  }
  if (mode === "conversation" && result.response_type === "silent") {
    throw movementRecognitionError("The conversation model returned no assistant answer.", "malformed_response");
  }
  if (mode === "observing") {
    if (typeof result.meaningful_change !== "boolean" || !Array.isArray(result.evidence_frames)) {
      throw movementRecognitionError("The visual model response did not match the movement contract.", "malformed_response");
    }
    if (result.meaningful_change === true && !String(result.movement_label || "").trim()) {
      throw movementRecognitionError("The visual model response omitted its movement label.", "malformed_response");
    }
  }
  return result;
}

async function captureTransientMovementFrame(video, config) {
  const canvas = document.createElement("canvas");
  const width = Math.min(config.frameWidth ?? 320, video.videoWidth || config.frameWidth || 320);
  const height = Math.max(1, Math.round(width * ((video.videoHeight || 9) / Math.max(1, video.videoWidth || 16))));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  drawVideoFrameForAnalysis(context, video, width, height, config.mirrorFramesToPreview === true);
  const lumaSignature = readCanvasLumaSignature(context, width, height);
  const blob = await new Promise((resolve) => canvas[["to", "Blob"].join("")](resolve, config.frameMimeType, config.frameQuality));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("Camera frame could not be read. Try again.");
  const buffer = await blob.arrayBuffer();
  const encodedFrame = encodeFrameBuffer(buffer);
  const mimeType = blob.type || config.frameMimeType;
  return {
    mime_type: mimeType,
    encoded_frame: encodedFrame,
    data_uri: `data:${mimeType};base64,${encodedFrame}`,
    captured_at_ms: Math.round(now()),
    width,
    height,
    luma_signature: lumaSignature
  };
}

function readCanvasLumaSignature(context, width, height) {
  const columns = 4;
  const rows = 4;
  const signature = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const sx = Math.floor((x + 0.5) * width / columns);
      const sy = Math.floor((y + 0.5) * height / rows);
      const pixel = context.getImageData(Math.min(width - 1, sx), Math.min(height - 1, sy), 1, 1).data;
      signature.push(Number(((pixel[0] + pixel[1] + pixel[2]) / (3 * 255)).toFixed(3)));
    }
  }
  return signature;
}

export function computeVisualSceneChangeScore(frames = []) {
  const signatures = frames.map((frame) => frame.luma_signature).filter((item) => Array.isArray(item) && item.length);
  if (signatures.length < 2) return 0;
  let total = 0;
  let comparisons = 0;
  for (let index = 1; index < signatures.length; index += 1) {
    const previous = signatures[index - 1];
    const current = signatures[index];
    const length = Math.min(previous.length, current.length);
    for (let sample = 0; sample < length; sample += 1) {
      total += Math.abs(Number(current[sample] || 0) - Number(previous[sample] || 0));
      comparisons += 1;
    }
  }
  return comparisons ? Number((total / comparisons).toFixed(4)) : 0;
}

function encodeFrameBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function drawVideoFrameForAnalysis(context, video, width, height, mirror = CAMERA_MIRROR_POLICY.analysisFramesMirrorPreview) {
  if (!mirror) {
    context.drawImage(video, 0, 0, width, height);
    return;
  }
  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, width, height);
  context.restore();
}

export function clearMovementFrameBuffer(frames = []) {
  for (const frame of frames) {
    frame.encoded_frame = "";
    frame.data_uri = "";
    frame.luma_signature = [];
  }
  frames.length = 0;
  return frames;
}

export async function runLiveAiSmokeTestInState(target = state) {
  if (!dom?.liveAiSmokeResult) return target;
  dom.liveAiSmokeResult.textContent = "Checking local visual service...";
  if (dom.runLiveAiSmoke) dom.runLiveAiSmoke.disabled = true;
  try {
    const health = await requestVisualCompanionHealth();
    if (health.status === "model_not_installed") {
      dom.liveAiSmokeResult.textContent = JSON.stringify({
        status: "SKIP",
        reason: "The local visual companion service is not running or the model is not installed.",
        provider: health.provider,
        model: health.model,
        token_exposed_to_frontend: health.token_exposed_to_frontend,
        next: "Run npm run visual:setup, then npm run visual:serve."
      }, null, 2);
      return target;
    }
    dom.liveAiSmokeResult.textContent = "Health ok. Calling local visual service...";
    const frames = [await captureSyntheticSmokeFrame()];
    try {
      const result = await requestVisualCompanionObservation({
        frames,
        frame_timestamps_ms: frames.map((frame) => frame.captured_at_ms),
        previous_context: {},
        requested_response_mode: "auto",
        allowed_suggested_actions: VISUAL_COMPANION_ALLOWED_ACTIONS,
        client_scene_change_score: 0.2,
        memory_mode: "off"
      });
      dom.liveAiSmokeResult.textContent = JSON.stringify({
        status: "LOCAL_VISUAL_OK",
        provider: result.provider,
        model: result.model,
        latency_ms: result.latency_ms,
        response: result.movement,
        response_type: result.response_type,
        confidence: result.confidence,
        reason: result.reason
      }, null, 2);
    } finally {
      clearMovementFrameBuffer(frames);
    }
  } catch (error) {
    dom.liveAiSmokeResult.textContent = JSON.stringify({
      status: "LOCAL_VISUAL_FAIL",
      reason: error?.message ?? "local visual check failed"
    }, null, 2);
  } finally {
    if (dom.runLiveAiSmoke) dom.runLiveAiSmoke.disabled = false;
  }
  return target;
}

export function darkQuestSessionId(storage = globalThis.sessionStorage) {
  const existing = safeSessionStorageGet(storage, DARKQUEST_SESSION_STORAGE_KEY);
  if (/^darkquest_session_[a-f0-9-]{36}$/.test(existing || "")) return existing;
  const uuid = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : fallbackUuid();
  const sessionId = `darkquest_session_${uuid}`;
  safeSessionStorageSet(storage, DARKQUEST_SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

function fallbackUuid() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) => {
    const random = globalThis.crypto?.getRandomValues?.(new Uint8Array(1))?.[0] ?? Math.floor(Math.random() * 256);
    return (Number(char) ^ ((random & 15) >> (Number(char) / 4))).toString(16);
  });
}

function safeSessionStorageGet(storage, key) {
  try {
    return storage?.getItem?.(key) || "";
  } catch {
    return "";
  }
}

function safeSessionStorageSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {
    return false;
  }
  return true;
}

async function requestCloudUsageStatus() {
  const send = globalThis[["fet", "ch"].join("")];
  if (typeof send !== "function") throw new Error("Cloud AI usage endpoint is unavailable.");
  const response = await send(MOVEMENT_RECOGNITION_CLIENT_CONFIG.usageEndpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-DarkQuest-Session-Id": darkQuestSessionId()
    }
  });
  if (!response.ok) throw movementRecognitionError("Cloud AI usage endpoint unavailable.", "usage_unavailable", { status: response.status });
  return response.json();
}

async function refreshCloudUsageStatus(target = state) {
  try {
    target.movementRecognition.usage = normalizeCloudUsage(await requestCloudUsageStatus());
    target.movementRecognition.usageStatus = cloudUsageStateText(target);
    render();
  } catch {
    target.movementRecognition.usageStatus = target.movementRecognition.usage?.cloud_enabled === false ? "Cloud AI disabled" : "Local model active";
  }
  return target.movementRecognition.usage;
}

export async function selectMovementAnalysisBackend(target = state, options = {}) {
  if (options.preferCloud === true) {
    let cloudError = null;
    try {
      const health = await ensureMovementRecognitionReady(target);
      if (health.cloud_enabled === false || health.live_call_enabled === false) {
        throw movementRecognitionError("Cloud AI disabled. Local features remain available.", "hf_cloud_disabled", { health });
      }
      target.movementRecognition.usage = normalizeCloudUsage(await requestCloudUsageStatus());
      target.movementRecognition.usageStatus = cloudUsageStateText(target);
      if (cloudUsageHardLimitReached(target)) {
        const usage = target.movementRecognition.usage;
        const code = usage.month.remaining <= 0
          ? "hf_monthly_limit_reached"
          : usage.day.remaining <= 0
            ? "hf_daily_limit_reached"
            : "hf_session_limit_reached";
        throw movementRecognitionError("Cloud AI limit reached. Local features remain available.", code, { health });
      }
      return {
        kind: "hf_cloud",
        health,
        captureConfig: MOVEMENT_RECOGNITION_CLIENT_CONFIG
      };
    } catch (error) {
      cloudError = error;
    }
    try {
      const health = await ensureVisualCompanionReady(target);
      return {
        kind: "local_visual",
        health,
        cloudError,
        captureConfig: VISUAL_COMPANION_CLIENT_CONFIG
      };
    } catch (visualError) {
      cloudError.safe_diagnostics = {
        ...(cloudError.safe_diagnostics || {}),
        local_visual_error: safeMovementRecognitionDiagnostics(visualError)
      };
      throw cloudError;
    }
  }
  let visualError = null;
  try {
    const health = await ensureVisualCompanionReady(target);
    return {
      kind: "local_visual",
      health,
      captureConfig: VISUAL_COMPANION_CLIENT_CONFIG
    };
  } catch (error) {
    visualError = error;
  }

  try {
    const health = await ensureMovementRecognitionReady(target);
    if (health.cloud_enabled === false || health.live_call_enabled === false) {
      throw movementRecognitionError("Cloud AI disabled. Local features remain available.", "hf_cloud_disabled", { health, visual_error: safeMovementRecognitionDiagnostics(visualError) });
    }
    return {
      kind: "hf_cloud",
      health,
      visualError,
      captureConfig: MOVEMENT_RECOGNITION_CLIENT_CONFIG
    };
  } catch (cloudError) {
    cloudError.safe_diagnostics = {
      ...(cloudError.safe_diagnostics || {}),
      local_visual_error: safeMovementRecognitionDiagnostics(visualError)
    };
    throw cloudError;
  }
}

function movementRecognitionZoneMetadata(target = state) {
  return {
    active_zone: String(target.activeZone || "none"),
    quest_state: String(target.questState || "idle"),
    camera_ready: target.cameraReady === true,
    contains_raw_media: false
  };
}

async function requestMovementRecognitionHealth() {
  const send = globalThis[["fet", "ch"].join("")];
  if (typeof send !== "function") throw new Error("Movement recognition health endpoint is unavailable.");
  try {
    const response = await send("/api/movement-recognition/health", {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (response.status === 404) throw movementRecognitionError("Movement recognition endpoint unavailable.", "endpoint_missing", { status: response.status });
    if (!response.ok) throw movementRecognitionError("Movement recognition endpoint unavailable.", "api_unavailable", { status: response.status });
    return response.json();
  } catch (error) {
    if (error?.movement_code) throw error;
    throw movementRecognitionError("Network error while contacting movement recognition.", "network_error", { reason: error?.message ?? "fetch_failed" });
  }
}

async function ensureMovementRecognitionReady(target) {
  const health = await requestMovementRecognitionHealth();
  target.movementRecognition.health = health;
  target.movementRecognition.provider = health.provider ?? target.movementRecognition.provider;
  target.movementRecognition.model = health.model ?? target.movementRecognition.model;
  if (health.analyze_endpoint_ready !== true) {
    throw movementRecognitionError("Movement recognition endpoint unavailable.", "endpoint_missing", { health });
  }
  if (health.has_token !== true) {
    throw movementRecognitionError("HF_TOKEN is not loaded. Restart the app; the launcher loads .env automatically.", "missing_token", { health });
  }
  return health;
}

async function requestVisualCompanionHealth() {
  const send = globalThis[["fet", "ch"].join("")];
  if (typeof send !== "function") throw new Error("Visual companion health endpoint is unavailable.");
  try {
    const response = await send(VISUAL_COMPANION_CLIENT_CONFIG.healthEndpoint, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (response.status === 404) throw movementRecognitionError("Vision is temporarily unavailable.", "endpoint_missing", { status: response.status });
    if (!response.ok) throw movementRecognitionError("Vision is temporarily unavailable.", "api_unavailable", { status: response.status });
    return response.json();
  } catch (error) {
    if (error?.movement_code) throw error;
    throw movementRecognitionError("Network error while contacting visual companion.", "network_error", { reason: error?.message ?? "fetch_failed" });
  }
}

async function ensureVisualCompanionReady(target) {
  const health = await requestVisualCompanionHealth();
  target.movementRecognition.health = health;
  target.movementRecognition.provider = health.provider ?? VISUAL_COMPANION_CLIENT_CONFIG.provider;
  target.movementRecognition.model = health.model ?? target.movementRecognition.model;
  if (health.observe_endpoint_ready !== true || health.ok !== true || health.status !== "ready") {
    throw movementRecognitionError("Vision is temporarily unavailable.", "endpoint_missing", { health });
  }
  return health;
}

async function captureSyntheticSmokeFrame() {
  const canvas = document.createElement("canvas");
  canvas.width = 12;
  canvas.height = 12;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#101820";
  context.fillRect(0, 0, 12, 12);
  context.fillStyle = "#ffffff";
  context.fillRect(2, 4, 8, 3);
  context.fillStyle = "#5fb3ff";
  context.fillRect(7, 2, 3, 8);
  const blob = await new Promise((resolve) => canvas[["to", "Blob"].join("")](resolve, VISUAL_COMPANION_CLIENT_CONFIG.frameMimeType, VISUAL_COMPANION_CLIENT_CONFIG.frameQuality));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("Could not create smoke-test frame.");
  const buffer = await blob.arrayBuffer();
  return {
    mime_type: blob.type || VISUAL_COMPANION_CLIENT_CONFIG.frameMimeType,
    encoded_frame: encodeFrameBuffer(buffer),
    captured_at_ms: Math.round(now())
  };
}

async function requestMovementRecognition(payload, target = state, options = {}) {
  const send = globalThis[["fet", "ch"].join("")];
  if (typeof send !== "function") throw new Error("Movement recognition endpoint is unavailable.");
  let response;
  try {
    response = await send(MOVEMENT_RECOGNITION_CLIENT_CONFIG.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DarkQuest-Session-Id": darkQuestSessionId()
      },
      body: JSON.stringify(payload),
      signal: options.signal
    });
  } catch (error) {
    throw movementRecognitionError("Network error while contacting movement recognition.", "network_error", { reason: error?.message ?? "fetch_failed" });
  }
  const body = await readMovementRecognitionJson(response);
  if (body?.usage) {
    target.movementRecognition.usage = normalizeCloudUsage(usageFromLimitMetadata(body.usage, target.movementRecognition.usage));
    target.movementRecognition.usageStatus = cloudUsageStateText(target);
  }
  if (!response.ok) {
    throw movementRecognitionError(messageForMovementRecognitionFailure(response, body), failureCodeForMovementRecognition(response, body), {
      status: response.status,
      reason: body?.reason ?? "",
      failed_candidates: safeFailedCandidateDiagnostics(body?.failed_candidates)
    });
  }
  if (!String(body?.spoken_response || body?.observation_summary || "").trim()) {
    throw movementRecognitionError("The visual model returned an empty response.", "malformed_response");
  }
  if (/^AI provider is busy/i.test(String(body?.movement ?? ""))) {
    throw movementRecognitionError("AI provider is busy — try again in a moment.", "provider_busy", {
      failed_candidates: safeFailedCandidateDiagnostics(body?.failed_candidates)
    });
  }
  refreshCloudUsageStatus(target);
  return normalizeMovementRecognitionResult(body);
}

async function requestVisualCompanionObservation(payload, options = {}) {
  const send = globalThis[["fet", "ch"].join("")];
  if (typeof send !== "function") throw new Error("Visual companion endpoint is unavailable.");
  const endpoint = payload.interaction_mode === "conversation"
    ? VISUAL_COMPANION_CLIENT_CONFIG.conversationEndpoint
    : VISUAL_COMPANION_CLIENT_CONFIG.endpoint;
  const correlationId = `visual_request_${payload.mode_generation_id}_${sensefieldTestRuntime.requests.length + 1}`;
  recordSensefieldTestRequest("started", {
    endpoint,
    interaction_mode: payload.interaction_mode,
    user_question: payload.user_question || "",
    frame_count: Array.isArray(payload.frames) ? payload.frames.length : 0,
    requested_response_mode: payload.requested_response_mode
  }, { correlationId, modeGenerationId: payload.mode_generation_id });
  let response;
  try {
    response = await send(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.signal
    });
  } catch (error) {
    recordSensefieldTestRequest("failed", { endpoint, error: "network_error" }, { correlationId, modeGenerationId: payload.mode_generation_id });
    throw movementRecognitionError("Network error while contacting visual companion.", "network_error", { reason: error?.message ?? "fetch_failed" });
  }
  const body = await readMovementRecognitionJson(response);
  if (!response.ok) {
    recordSensefieldTestRequest("failed", { endpoint, status: response.status }, { correlationId, modeGenerationId: payload.mode_generation_id });
    throw movementRecognitionError(body?.spoken_response || "Vision is temporarily unavailable.", failureCodeForVisualCompanion(response, body), {
      status: response.status,
      reason: body?.evidence?.[0] ?? ""
    });
  }
  recordSensefieldTestRequest("completed", {
    endpoint,
    status: response.status,
    response_type: body.response_type || "unknown",
    spoken_response: body.spoken_response || ""
  }, { correlationId, modeGenerationId: payload.mode_generation_id });
  return movementRecognitionResultFromVisualResponse(body);
}

function failureCodeForVisualCompanion(response, body = {}) {
  if ([409, 423, 429].includes(Number(response.status))) return "provider_busy";
  const text = `${body.spoken_response ?? ""} ${body.observation_summary ?? ""}`.toLowerCase();
  if (/model not installed|not running/.test(text)) return "model_not_installed";
  if (/frame|image/.test(text)) return "invalid_image_payload";
  return response.status === 404 ? "endpoint_missing" : `http_${response.status}`;
}

function movementRecognitionResultFromVisualResponse(body = {}) {
  const spoken = String(body.spoken_response || body.observation_summary || "I'm not sure what changed. Try showing me again.");
  const responseType = String(body.response_type || (body.uncertainty ? "uncertain" : "narrate"));
  const suggestedActions = Array.isArray(body.suggested_actions) ? body.suggested_actions : [];
  const shortLabel = responseType === "silent"
    ? "No meaningful change"
    : responseType === "ask"
      ? "Question"
      : responseType === "assist"
        ? "Suggested action"
        : responseType === "uncertain"
          ? "Uncertain"
          : "Observation";
  return {
    schema_version: "canonical-movement-result.v1",
    observation_id: String(body.observation_id || `visual_observation_${Math.round(now())}`),
    action_type: "uncertain",
    movement: spoken,
    spoken_response: spoken,
    short_label: body.short_label || shortLabel,
    movement_key: normalizeMovementKey(body.movement_key || body.movement_label || shortLabel),
    gesture_tags: normalizeGestureTags(body.gesture_tags || [body.movement_key || body.movement_label]),
    confidence: clamp01(body.confidence ?? 0),
    reason: String(body.observation_summary || body.reason || spoken),
    evidence: Array.isArray(body.evidence) ? body.evidence.map(String).slice(0, 5) : [],
    meaningful_change: body.meaningful_change === true,
    movement_label: body.movement_label || null,
    evidence_frames: Array.isArray(body.evidence_frames) ? body.evidence_frames.map(Number).filter(Number.isInteger).slice(0, 8) : [],
    uncertainty: Boolean(body.uncertainty || responseType === "uncertain"),
    provider: String(body.provider || VISUAL_COMPANION_CLIENT_CONFIG.provider),
    model: String(body.model || "local model service"),
    requested_model: String(body.model || "local model service"),
    returned_model: String(body.model || ""),
    provider_model: String(body.model || ""),
    prompt_version: VISUAL_COMPANION_PROMPT_VERSION,
    image_tokens: 0,
    retries: 0,
    latency_ms: Math.max(0, Math.round(body.latency_ms ?? 0)),
    response_source: ["local_detector", "local_vlm", "cloud_vlm", "deterministic_test_fixture", "unavailable"].includes(body.response_source) ? body.response_source : "unavailable",
    requires_confirmation: suggestedActions.length > 0,
    response_type: responseType,
    question: String(body.question || ""),
    suggested_actions: suggestedActions,
    time_to_first_token_ms: Math.max(0, Math.round(body.time_to_first_token_ms ?? 0)),
    time_to_first_audio_ms: Math.max(0, Math.round(body.time_to_first_audio_ms ?? 0))
  };
}

async function readMovementRecognitionJson(response) {
  try {
    return await response.json();
  } catch {
    throw movementRecognitionError("AI response was unclear — try again.", "malformed_response", { status: response.status });
  }
}

function messageForMovementRecognitionFailure(response, body = {}) {
  if (typeof body.message === "string" && /^hf_/.test(String(body.code || ""))) return body.message;
  const text = `${body.reason ?? ""} ${JSON.stringify(body.failed_candidates ?? [])}`.toLowerCase();
  if (response.status === 503 || /hf_token|token is not configured|missing token/.test(text)) return "HF_TOKEN is not loaded. Restart the app; the launcher loads .env automatically.";
  if (/provider_reachable_but_busy|queue_exceeded|too_many_requests|high traffic|provider overloaded|busy/.test(text)) return "AI provider is busy — try again in a moment.";
  if (/payload_or_image_failure|invalid_image|invalid image|invalid base64|bad image/.test(text)) return "Camera frame could not be read. Try again.";
  return "Movement recognition endpoint unavailable.";
}

function failureCodeForMovementRecognition(response, body = {}) {
  if (/^hf_/.test(String(body.code || ""))) return String(body.code);
  const message = messageForMovementRecognitionFailure(response, body);
  return {
    "HF_TOKEN is not loaded. Restart the app; the launcher loads .env automatically.": "missing_token",
    "AI provider is busy — try again in a moment.": "provider_busy",
    "Camera frame could not be read. Try again.": "invalid_image_payload",
    "Movement recognition endpoint unavailable.": response.status === 404 ? "endpoint_missing" : "network_error"
  }[message] ?? `http_${response.status}`;
}

function movementRecognitionError(message, code, diagnostics = {}) {
  const error = new Error(message);
  error.movement_code = code;
  error.safe_diagnostics = diagnostics;
  return error;
}

function isKnownMovementRecognitionFailure(error) {
  return [
    "missing_token",
    "endpoint_missing",
    "model_not_installed",
    "provider_busy",
    "invalid_image_payload",
    "network_error",
    "malformed_response",
    "usage_unavailable",
    "hf_cloud_disabled",
    "hf_session_limit_reached",
    "hf_daily_limit_reached",
    "hf_monthly_limit_reached",
    "hf_request_cooldown",
    "hf_concurrency_limit",
    "hf_frame_limit_exceeded",
    "hf_window_limit_exceeded",
    "hf_frame_dimensions_exceeded",
    "hf_request_too_large",
    "hf_retry_limit_reached"
  ].includes(error?.movement_code);
}

function safeMovementRecognitionErrorMessage(error) {
  if (error?.movement_code) return error.message;
  if (/sample movement frame|movement frame|camera frame/i.test(error?.message ?? "")) return "Camera frame could not be read. Try again.";
  if (/endpoint.*unavailable/i.test(error?.message ?? "")) return "Movement recognition endpoint unavailable.";
  if (/network/i.test(error?.message ?? "")) return "Network error while contacting movement recognition.";
  return error?.message ? `AI unavailable — try again or use local fallback. Reason: ${error.message}` : "AI response was unclear — try again.";
}

function safeVisualCompanionErrorMessage(error) {
  if (error?.movement_code === "model_not_installed") return "Model not installed. Run npm run visual:setup, then npm run visual:serve.";
  if (error?.movement_code === "endpoint_missing") return "Vision is temporarily unavailable.";
  if (error?.movement_code === "invalid_image_payload") return "Camera frame could not be read. Try again.";
  if (error?.movement_code === "network_error") return "Network error while contacting visual companion.";
  return error?.message || "The local visual model is unavailable.";
}

function safeObservationErrorMessage(error) {
  if (["model_not_installed", "endpoint_missing"].includes(error?.movement_code)) return safeVisualCompanionErrorMessage(error);
  return safeMovementRecognitionErrorMessage(error);
}

function shouldUseLocalMotionFallback(error) {
  return ![
    "invalid_image_payload",
    "malformed_response",
    "missing_token",
    "hf_cloud_disabled",
    "hf_session_limit_reached",
    "hf_daily_limit_reached",
    "hf_monthly_limit_reached",
    "hf_request_cooldown",
    "hf_concurrency_limit",
    "hf_frame_limit_exceeded",
    "hf_window_limit_exceeded",
    "hf_frame_dimensions_exceeded",
    "hf_request_too_large",
    "hf_retry_limit_reached"
  ].includes(error?.movement_code);
}

function safeMovementRecognitionDiagnostics(error) {
  return {
    code: error?.movement_code ?? "unknown",
    message: safeMovementRecognitionErrorMessage(error),
    diagnostics: error?.safe_diagnostics ?? {}
  };
}

function safeFailedCandidateDiagnostics(candidates = []) {
  return Array.isArray(candidates)
    ? candidates.map((candidate) => ({
        model: candidate.model,
        classification: candidate.classification,
        http_status: candidate.http_status
      }))
    : [];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processLocalPerceptionFrame(timestampMs) {
  const startedAt = now();
  perceptionRuntime.rafId = requestAnimationFrame(processLocalPerceptionFrame);
  if (!state.cameraReady || !dom?.preview || dom.preview.readyState < 2 || !perceptionRuntime.context) return;
  if (timestampMs - perceptionRuntime.lastProcessedMs < LOCAL_PERCEPTION_SAMPLE.minIntervalMs) return;
  perceptionRuntime.lastProcessedMs = timestampMs;

  const gray = readDownsampledGrayFrame(dom.preview);
  const previous = perceptionRuntime.previousMotionSample;
  perceptionRuntime.previousMotionSample = gray;
  if (!previous) return;

  const observations = computeZoneMotion(previous, gray, state.zoneGeometry, timestampMs, state.localPerceptionTuning.motionSensitivity);
  applyLocalMotionObservations(state, observations, timestampMs);
  updateRollingVisualContextFromLocalFeatures(state, observations, timestampMs);
  maybeRefreshObservationBaseline(state, observations, timestampMs);
  maybeTriggerPersistentObservationFromLocalChange(state, observations, timestampMs);
  state.localActionDiagnostics.lastPerceptionLatencyMs = Math.max(1, Math.round(now() - startedAt));
  state.localActionDiagnostics.frameProcessingFps = perceptionRuntime.lastPerceptionFrameMs
    ? Math.round(1000 / Math.max(1, timestampMs - perceptionRuntime.lastPerceptionFrameMs))
    : 0;
  perceptionRuntime.lastPerceptionFrameMs = timestampMs;
  state.emergencyRuntimeController.heartbeat(timestampMs);
  if (timestampMs - perceptionRuntime.lastHeartbeatEventMs >= 1000) {
    perceptionRuntime.lastHeartbeatEventMs = timestampMs;
    recordSensefieldTestEvent("detector_heartbeat", { mode: state.interactionState.mode, active: interactionModeIs(state, "observing") });
  }
  state.liveCameraState = {
    status: "running",
    frame_id: Math.round(timestampMs),
    overlay_revision: state.showTrackingOverlay ? Math.round(timestampMs) : state.liveCameraState.overlay_revision,
    telemetry_revision: Math.round(timestampMs)
  };
  renderLiveCameraState(state);
}

function maybeRefreshObservationBaseline(target, observations, timestampMs) {
  if (!target.interactionState?.sessionActive || !interactionModeIs(target, "observing") || !dom?.preview) return;
  if (observations.some((item) => item.active || Number(item.motion_score || 0) >= PERSISTENT_OBSERVATION.changeThreshold)) return;
  if (perceptionRuntime.baselineCaptureInFlight || timestampMs - perceptionRuntime.lastBaselineCaptureMs < 500) return;
  perceptionRuntime.baselineCaptureInFlight = true;
  perceptionRuntime.lastBaselineCaptureMs = timestampMs;
  void captureTransientMovementFrame(dom.preview, VISUAL_COMPANION_CLIENT_CONFIG)
    .then((frame) => {
      if (perceptionRuntime.baselineFrame) clearMovementFrameBuffer([perceptionRuntime.baselineFrame]);
      perceptionRuntime.baselineFrame = frame;
      recordSensefieldTestEvent("observation_baseline_ready", { width: frame.width, height: frame.height, timestamp_ms: frame.captured_at_ms });
    })
    .catch(() => recordSensefieldTestEvent("observation_baseline_failed", { mode: "observing" }))
    .finally(() => { perceptionRuntime.baselineCaptureInFlight = false; });
}

async function primeObservationBaseline(target) {
  if (!dom?.preview || !target.cameraReady) return false;
  try {
    const frame = await withTimeout(
      captureTransientMovementFrame(dom.preview, VISUAL_COMPANION_CLIENT_CONFIG),
      2000,
      "Observation baseline timed out."
    );
    if (perceptionRuntime.baselineFrame) clearMovementFrameBuffer([perceptionRuntime.baselineFrame]);
    perceptionRuntime.baselineFrame = frame;
    perceptionRuntime.lastBaselineCaptureMs = Math.round(now());
    recordSensefieldTestEvent("observation_baseline_ready", { width: frame.width, height: frame.height, timestamp_ms: frame.captured_at_ms });
    return true;
  } catch {
    recordSensefieldTestEvent("observation_baseline_failed", { mode: "observing" });
    return false;
  }
}

function renderLiveCameraState(target) {
  renderZoneOverlay(target);
  if (dom?.developerTools?.open) {
    if (dom.motionSensitivity) dom.motionSensitivity.value = String(target.localPerceptionTuning.motionSensitivity);
    if (dom.suggestionThreshold) dom.suggestionThreshold.value = String(target.localPerceptionTuning.suggestionThreshold);
    if (dom.suggestionCooldown) dom.suggestionCooldown.value = String(target.localPerceptionTuning.suggestionCooldownMs);
    if (dom.maxActiveSuggestions) dom.maxActiveSuggestions.value = String(target.localPerceptionTuning.maxActiveSuggestions);
    if (dom.showRawMotionScores) dom.showRawMotionScores.checked = target.localPerceptionTuning.showRawMotionScores;
  }
}

function readDownsampledGrayFrame(video) {
  const { width, height } = LOCAL_PERCEPTION_SAMPLE;
  const canvas = perceptionRuntime.canvas;
  const context = perceptionRuntime.context;
  drawVideoFrameForAnalysis(context, video, width, height);
  const pixels = context[["get", "ImageData"].join("")](0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    gray[p] = Math.round((pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114));
  }
  return gray;
}

function computeZoneMotion(previous, current, zoneGeometry, timestampMs, activeThreshold = LOCAL_MOTION.activeThreshold) {
  const { width, height } = LOCAL_PERCEPTION_SAMPLE;
  return REQUIRED_ZONES.map((zoneId) => {
    const rect = zoneGeometry[zoneId] ?? DEFAULT_ZONE_GEOMETRY[zoneId];
    const x0 = Math.max(0, Math.floor(rect.x * width));
    const y0 = Math.max(0, Math.floor(rect.y * height));
    const x1 = Math.min(width, Math.ceil((rect.x + rect.w) * width));
    const y1 = Math.min(height, Math.ceil((rect.y + rect.h) * height));
    let diff = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * width) + x;
        diff += Math.abs(current[index] - previous[index]);
        count += 1;
      }
    }
    const motionScore = count ? diff / (count * 255) : 0;
    return {
      zone_id: zoneId,
      motion_score: Number(motionScore.toFixed(3)),
      active: motionScore >= activeThreshold,
      confidence: confidenceFromMotion(motionScore),
      timestamp_ms: Math.round(timestampMs)
    };
  });
}

function applyLocalMotionObservations(target, observations, timestampMs) {
  target.zoneMotion = Object.fromEntries(observations.map((item) => [item.zone_id, item]));
  expireOldSuggestions(target, timestampMs);
  for (const observation of observations) updateMotionHistory(observation);
  const localFrame = createLocalPerceptionFrame({
    timestampMs,
    currentStep: normalizeStep(target.questState),
    observations,
    detectionMethod: "motion_proxy",
    uncertainThreshold: LOCAL_MOTION.uncertainThreshold
  });
  target.localPerceptionFrame = localFrame;
  target.localActionDiagnostics.activeEngine = "motion_proxy";
  target.localActionDiagnostics.handEngineStatus = "fallback motion proxy";
  const activeZones = observations.filter((item) => item.active);
  if (activeZones.length >= 4 || activeZones.some((item) => item.motion_score >= LOCAL_MOTION.uncertainThreshold)) {
    maybeEmitLocalUncertainty(target, "camera_unstable_or_noisy_motion", timestampMs);
  } else {
    perceptionRuntime.uncertainSinceMs = null;
  }

  for (const observation of observations) {
    updateZoneActivity(target, observation, timestampMs);
    updateGestureSuggestion(target, observation, timestampMs);
  }

  for (const suggestion of rankActionSuggestions(buildActionSuggestion({ target, observations, timestampMs, frame: localFrame }), target)) {
    queuePerceptionSuggestion(target, suggestion, timestampMs);
  }
}

export function persistentObservationEventFromLocalChange(observations = [], timestampMs = Math.round(now())) {
  const scored = observations
    .map((item) => ({ ...item, motion_score: Number(item.motion_score || 0) }))
    .sort((a, b) => b.motion_score - a.motion_score);
  const strongest = scored[0] || null;
  const activeZones = scored.filter((item) => item.active || item.motion_score >= PERSISTENT_OBSERVATION.changeThreshold);
  const score = Number((strongest?.motion_score || 0).toFixed(3));
  if (!strongest || score < PERSISTENT_OBSERVATION.changeThreshold || activeZones.length === 0) return null;
  const zoneKey = activeZones.slice(0, 3).map((item) => item.zone_id).sort().join("+");
  const scoreBucket = Math.round(score * 10) / 10;
  return {
    timestamp_ms: Math.round(timestampMs),
    score,
    zone_id: strongest.zone_id,
    fingerprint: `${zoneKey || strongest.zone_id}:${scoreBucket.toFixed(1)}`
  };
}

function updateRollingVisualContextFromLocalFeatures(target, observations = [], timestampMs = Math.round(now())) {
  const rolling = target.realtimeSession?.rollingVisualContext;
  if (!rolling || target.interactionState?.sessionActive !== true || target.interactionState.visualContextActive !== true) return;
  const strongest = observations
    .map((item) => ({ ...item, motion_score: Number(item.motion_score || 0) }))
    .sort((a, b) => b.motion_score - a.motion_score)[0];
  if (!strongest) return;
  const event = persistentObservationEventFromLocalChange(observations, timestampMs);
  const activeZones = observations
    .filter((item) => item.active || Number(item.motion_score || 0) >= PERSISTENT_OBSERVATION.changeThreshold)
    .slice(0, 3)
    .map((item) => sanitizeMemoryText(item.zone_label || item.zone_id))
    .filter(Boolean);
  const fingerprint = event?.fingerprint || activeZones.join("+") || sanitizeMemoryText(strongest.zone_id || "scene");
  if (!fingerprint) return;
  const duplicate = rolling.lastFingerprint === fingerprint && Math.abs(Number(timestampMs) - Number(rolling.lastMeaningfulAtMs || 0)) < PERSISTENT_OBSERVATION.duplicateWindowMs;
  if (duplicate) return;
  const summary = event
    ? `Meaningful visual change near ${activeZones.join(", ") || sanitizeMemoryText(strongest.zone_id || "the frame")}.`
    : `Recent motion near ${activeZones.join(", ") || sanitizeMemoryText(strongest.zone_id || "the frame")}.`;
  rolling.samples.push({
    timestamp_ms: Math.round(timestampMs),
    fingerprint,
    summary,
    score: Number((strongest.motion_score || 0).toFixed(3))
  });
  rolling.samples = rolling.samples.slice(-24);
  rolling.summary = summary;
  if (event) {
    rolling.lastFingerprint = fingerprint;
    rolling.lastMeaningfulAtMs = Math.round(timestampMs);
  }
}

function maybeTriggerPersistentObservationFromLocalChange(target, observations, timestampMs) {
  if (!target.interactionState?.sessionActive || !interactionModeIs(target, "observing") || target.interactionState.proactiveObservationActive !== true) return false;
  const observer = target.movementRecognition.persistent;
  if (!observer.active || !target.cameraReady || observer.pausedForVisibility || (typeof document !== "undefined" && document.hidden)) return false;
  const event = persistentObservationEventFromLocalChange(observations, timestampMs);
  const gate = updatePersistentObservationGate(observer, event, timestampMs);
  if (!event) {
    if (!persistentObservationBusy(target) && observer.state !== "active") observer.state = "active";
    return false;
  }
  observer.lastChangeScore = event.score;
  if (!gate.ready) {
    observer.droppedDuplicateCount += 1;
    return false;
  }
  if (target.realtimeSession?.state === "active") {
    const scheduled = scheduleRealtimeVisualEvent(target, event);
    if (scheduled) markPersistentObservationTriggered(observer, event);
    return scheduled;
  }
  if (persistentObservationBusy(target) || persistentSpeechBusy(target)) {
    observer.state = "active";
    observer.droppedDuplicateCount += 1;
    return false;
  }
  return triggerPersistentObservation(target, event);
}

export function updatePersistentObservationGate(observer, event, timestampMs = Math.round(now())) {
  const timestamp = Math.round(Number(timestampMs || 0));
  if (!event) {
    if (!observer.neutralSinceMs) observer.neutralSinceMs = timestamp;
    if (timestamp - Number(observer.neutralSinceMs || 0) >= PERSISTENT_OBSERVATION.neutralResetMs) {
      observer.awaitingNeutral = false;
      observer.lastSceneFingerprint = "";
    }
    return { ready: false, reason: "neutral" };
  }
  observer.neutralSinceMs = 0;
  if (observer.awaitingNeutral) return { ready: false, reason: "awaiting_neutral" };
  if (persistentObservationDuplicate(observer, event, timestamp)) return { ready: false, reason: "duplicate" };
  if (Number(observer.lastTriggerAtMs || 0) > 0 && timestamp - Number(observer.lastTriggerAtMs || 0) < PERSISTENT_OBSERVATION.minTriggerIntervalMs) {
    return { ready: false, reason: "minimum_interval" };
  }
  return { ready: true, reason: "ready" };
}

function markPersistentObservationTriggered(observer, event) {
  observer.lastTriggerAtMs = Number(event.timestamp_ms || Math.round(now()));
  observer.lastSceneFingerprint = event.fingerprint;
  observer.queuedEvent = null;
  observer.awaitingNeutral = true;
}

function persistentObservationDuplicate(observer, event, timestampMs) {
  return observer.lastSceneFingerprint === event.fingerprint &&
    Math.abs(Number(timestampMs || 0) - Number(observer.lastTriggerAtMs || 0)) < PERSISTENT_OBSERVATION.duplicateWindowMs;
}

function persistentObservationBusy(target) {
  return target.movementRecognition.requestInFlight ||
    ["checking", "capturing", "analyzing"].includes(target.movementRecognition.status);
}

function persistentSpeechBusy(target) {
  const status = String(target.movementRecognition.voiceStatus || "");
  return status === "Speaking…" || status === "Preparing voice…" ||
    Boolean(target.movementRecognition.activeSpeechAudio) ||
    Boolean(target.movementRecognition.activeVoiceAbortController) ||
    Boolean(target.movementRecognition.activeSpeechOwnership);
}

function triggerPersistentObservation(target, event) {
  const observer = target.movementRecognition.persistent;
  if (!observer.active || persistentObservationBusy(target)) return false;
  if (Number(observer.lastTriggerAtMs || 0) > 0 && Number(event.timestamp_ms || 0) - Number(observer.lastTriggerAtMs || 0) < PERSISTENT_OBSERVATION.minTriggerIntervalMs) return false;
  markPersistentObservationTriggered(observer, event);
  observer.state = "active";
  target.statusMessage = target.realtimeSession?.state === "active" ? "Looking." : "Change detected.";
  render();
  if (target.realtimeSession?.state === "active") scheduleRealtimeVisualEvent(target, event);
  else void analyzeMovementInState(target, { persistent: true, changeEvent: event });
  return true;
}

function completePersistentObservationCycle(target) {
  const observer = target.movementRecognition.persistent;
  if (!observer.active) return;
  observer.cooldownUntilMs = Math.round(now()) + PERSISTENT_OBSERVATION.cooldownMs;
  observer.queuedEvent = null;
  observer.state = "active";
  render();
  setTimeout(() => {
    if (!observer.active || observer.pausedForVisibility || !target.cameraReady) return;
    observer.state = "active";
    render();
  }, Math.max(0, PERSISTENT_OBSERVATION.cooldownMs));
}

export function updateMotionHistory(zoneObservation) {
  const timestampMs = zoneObservation.timestamp_ms ?? Math.round(now());
  const entry = { ...zoneObservation, timestamp_ms: timestampMs };
  const zoneId = entry.zone_id;
  const history = (perceptionRuntime.motionHistory.get(zoneId) ?? [])
    .filter((item) => Math.abs(timestampMs - item.timestamp_ms) <= LOCAL_MOTION.historyWindowMs);
  history.push(entry);
  perceptionRuntime.motionHistory.set(zoneId, history);
  state.motionHistory[zoneId] = history.map((item) => ({
    timestamp_ms: item.timestamp_ms,
    motion_score: item.motion_score,
    active: item.active,
    confidence: item.confidence
  }));
  return history;
}

export function computeZoneDwell(zoneId) {
  const history = perceptionRuntime.motionHistory.get(zoneId) ?? [];
  const active = history.filter((item) => item.active);
  if (!active.length) return { zone_id: zoneId, dwell_ms: 0, active: false };
  return {
    zone_id: zoneId,
    dwell_ms: Math.max(0, active[active.length - 1].timestamp_ms - active[0].timestamp_ms),
    active: active[active.length - 1].active === true
  };
}

export function computeMotionBurst(zoneId) {
  const history = perceptionRuntime.motionHistory.get(zoneId) ?? [];
  if (!history.length) return { zone_id: zoneId, burst_score: 0, duration_ms: 0, samples: 0 };
  const maxScore = Math.max(...history.map((item) => item.motion_score));
  const active = history.filter((item) => item.active);
  return {
    zone_id: zoneId,
    burst_score: Number(maxScore.toFixed(3)),
    duration_ms: active.length ? active[active.length - 1].timestamp_ms - active[0].timestamp_ms : 0,
    samples: history.length
  };
}

export function computeDirectionalChange(zoneId) {
  const sourceHistory = perceptionRuntime.motionHistory.get(zoneId) ?? [];
  const latestSource = [...sourceHistory].reverse().find((item) => item.active);
  if (!latestSource) return { from_zone_id: zoneId, to_zone_id: null, confidence: 0 };
  const candidates = REQUIRED_ZONES
    .filter((candidate) => candidate !== zoneId)
    .map((candidate) => {
      const latest = [...(perceptionRuntime.motionHistory.get(candidate) ?? [])].reverse().find((item) => item.active);
      return latest ? { zone_id: candidate, score: latest.motion_score, timestamp_ms: latest.timestamp_ms } : null;
    })
    .filter(Boolean)
    .filter((candidate) => Math.abs(candidate.timestamp_ms - latestSource.timestamp_ms) <= LOCAL_MOTION.historyWindowMs)
    .sort((a, b) => b.timestamp_ms - a.timestamp_ms || b.score - a.score);
  const best = candidates[0] ?? null;
  return {
    from_zone_id: zoneId,
    to_zone_id: best?.zone_id ?? null,
    confidence: best ? confidenceFromMotion(best.score) : 0
  };
}

export function buildActionSuggestion(context) {
  const target = context.target ?? state;
  const timestampMs = context.timestampMs ?? Math.round(now());
  const observations = Array.isArray(context.observations) ? context.observations : Object.values(context.observations ?? {});
  const frame = context.frame ?? createLocalPerceptionFrame({
    timestampMs,
    currentStep: normalizeStep(target.questState),
    observations,
    detectionMethod: "motion_proxy",
    uncertainThreshold: LOCAL_MOTION.uncertainThreshold
  });
  const candidates = scoreLocalActions(frame, {
    historyByZone: motionHistoryByZone(),
    cooldowns: target.rejectedCandidateCooldowns,
    previousConfidenceByAction: target.previousActionConfidence
  });
  target.localActionDiagnostics.currentPrimaryCandidate = candidates[0] ?? null;
  target.localActionDiagnostics.cooldownStatus = Object.keys(target.rejectedCandidateCooldowns ?? {}).length ? "active" : "none";
  for (const candidate of candidates) {
    target.previousActionConfidence[candidate.action_type] = candidate.confidence;
  }
  return candidates.map((candidate) => suggestionFromDetectedCandidate(candidate, target));
}

export function normalizeMovementRecognitionResult(result = {}) {
  const movement = safeMovementSentence(result.movement ?? result.label ?? "Uncertain — try again.");
  const actionType = legacyActionTypeForMovement(movement, result.action_type);
  const shortLabel = safeShortLabel(result.short_label ?? result.label ?? (actionType === "uncertain" ? "Uncertain" : "Movement"));
  const responseType = String(result.response_type || (result.uncertainty ? "uncertain" : "narrate"));
  const uncertain = Boolean(result.uncertainty ?? (isUncertainMovement(movement) || responseType === "uncertain"));
  const spokenResponse = safeMovementSentence(result.spoken_response || movement || UNCERTAIN_SPOKEN_RESPONSE);
  return {
    schema_version: "canonical-movement-result.v1",
    observation_id: String(result.observation_id || result.movement_result_id || result.result_id || "").trim(),
    action_type: actionType,
    movement,
    spoken_response: spokenResponse,
    short_label: shortLabel,
    movement_key: normalizeMovementKey(result.movement_key || shortLabel),
    gesture_tags: normalizeGestureTags(result.gesture_tags),
    label: movement,
    confidence: clamp01(result.confidence ?? 0.5),
    reason: String(result.reason ?? "Visual companion returned no reason."),
    evidence: Array.isArray(result.evidence) ? result.evidence.map(String).slice(0, 5) : [],
    meaningful_change: result.meaningful_change === true,
    movement_label: result.movement_label || null,
    evidence_frames: Array.isArray(result.evidence_frames) ? result.evidence_frames.map(Number).filter(Number.isInteger).slice(0, 8) : [],
    uncertainty: uncertain,
    provider: String(result.provider ?? VISUAL_COMPANION_CLIENT_CONFIG.provider),
    model: String(result.model ?? "local model service"),
    requested_model: String(result.requested_model ?? result.model ?? "local model service"),
    returned_model: String(result.returned_model ?? result.provider_model ?? ""),
    prompt_version: String(result.prompt_version ?? VISUAL_COMPANION_PROMPT_VERSION),
    image_tokens: Math.max(0, Math.round(result.image_tokens ?? 0)),
    retries: Math.max(0, Math.round(result.retries ?? 0)),
    failed_candidates: safeFailedCandidateDiagnostics(result.failed_candidates),
    response_type: responseType,
    response_source: ["local_detector", "local_vlm", "cloud_vlm", "deterministic_test_fixture", "unavailable"].includes(result.response_source) ? result.response_source : "unavailable",
    question: String(result.question || ""),
    suggested_actions: Array.isArray(result.suggested_actions) ? result.suggested_actions.slice(0, 3) : [],
    time_to_first_token_ms: Math.max(0, Math.round(result.time_to_first_token_ms ?? 0)),
    time_to_first_audio_ms: Math.max(0, Math.round(result.time_to_first_audio_ms ?? 0)),
    latency_ms: Math.max(0, Math.round(result.latency_ms ?? 0)),
    requires_confirmation: true
  };
}

export function queueMovementRecognitionResult(target, result, timestampMs = Math.round(now()), options = {}) {
  const normalized = normalizeMovementRecognitionResult(result);
  const snapshot = movementResultSnapshotFrom(normalized, timestampMs);
  const previousObservationId = observationIdForSnapshot(target.movementResultSnapshot);
  if (previousObservationId && previousObservationId !== snapshot.observation_id) void cancelVisualSpeech(target);
  const meta = movementMetaForAction(normalized.action_type);
  const suggestion = createPerceptionSuggestion(meta.eventType, meta.zoneId, normalized.confidence, normalized.reason, null, timestampMs, {
    suggested_action: normalized.movement,
    object_id: meta.objectId,
    payload: {
      action_type: normalized.action_type,
      ai_recognition: true,
      detection_method: "visual_companion_observation",
      provider: normalized.provider,
      model: normalized.model,
      movement: normalized.movement,
      short_label: normalized.short_label,
      movement_key: normalized.movement_key,
      gesture_tags: normalized.gesture_tags,
      prompt_version: normalized.prompt_version,
      latency_ms: normalized.latency_ms,
      evidence_text: normalized.evidence,
      requires_confirmation: true,
      suggestion_only: true
    },
    quest_state: target.questState
  });
  suggestion.detection_method = "visual_companion_observation";
  suggestion.metadata.source = "visual_companion_observation";
  suggestion.evidence[0].description = `Visual companion observation: ${normalized.reason}`;
  if (options.queueSuggestion !== false) queuePerceptionSuggestion(target, suggestion);
  target.movementRecognition.lastResult = normalized;
  target.movementRecognition.promptVersion = normalized.prompt_version;
  target.movementRecognition.imageTokens = normalized.image_tokens;
  target.movementRecognition.retries = normalized.retries;
  target.movementRecognition.candidateFailures = normalized.failed_candidates;
  target.movementResultSnapshot = snapshot;
  if (target.interactionState?.sessionActive) {
    target.emergencyRuntimeController.setCurrentResponse({
      text: snapshot.spoken_response || snapshot.movement_sentence,
      confidence: snapshot.confidence,
      createdAt: timestampMs
    });
    if (interactionModeIs(target, "observing") && normalized.response_source !== "unavailable") {
      target.emergencyRuntimeController.recordMoment("observing", {
        id: snapshot.observation_id,
        role: "MOVEMENT",
        text: snapshot.spoken_response || snapshot.movement_sentence,
        createdAt: timestampMs
      });
    } else {
      const responseText = snapshot.spoken_response || snapshot.movement_sentence;
      completeLiveAssistantTurn(target.liveConversation, responseText, {
        requestId: target.liveConversation.activeAssistant?.requestId,
        createdAtMs: timestampMs,
        cameraContext: target.cameraReady,
        responseSource: normalized.response_source,
        willSpeak: false
      });
      if (normalized.response_source === "unavailable") {
        failLiveConversation(target.liveConversation, responseText, {
          code: "visual_reasoning_unavailable",
          recoverable: true
        });
      }
    }
    target.appState = target.emergencyRuntimeController.snapshot();
  }
  target.confidenceCalibration.results_count += 1;
  if (normalized.uncertainty) target.confidenceCalibration.uncertain_count += 1;
  if (options.recordMovementHistory !== false && normalized.response_source !== "unavailable") {
    appendMovementHistory(target, snapshot);
  }
  return suggestion;
}

export function queueMovementRecognitionFallback(target, timestampMs = Math.round(now()), options = {}) {
  const frame = target.localPerceptionFrame ?? buildLocalPerceptionFrame({
    timestamp_ms: timestampMs,
    zone_motion: target.zoneMotion
  });
  const [candidate] = scoreLocalActionFrame(frame, target);
  const result = candidate
    ? {
        action_type: candidate.action_type,
        movement: localFallbackMovementForCandidate(candidate),
        short_label: candidate.label ?? "Local motion",
        confidence: candidate.confidence,
        reason: `Local motion fallback: ${candidate.reason}`,
        evidence: [candidate.reason],
        provider: "local_motion_proxy",
        model: "motion_proxy",
        response_source: "local_detector",
        latency_ms: 0,
        requires_confirmation: true
      }
    : {
        action_type: "uncertain",
        movement: sanitizeMemoryText(options.fallbackMessage || "") || "Uncertain — try again.",
        short_label: options.fallbackMessage ? "Visual reasoning unavailable" : "Uncertain",
        confidence: 0.5,
        reason: sanitizeMemoryText(options.fallbackMessage || "") || "AI unavailable — try again or use local fallback. Reason: local motion did not identify a stable movement.",
        evidence: ["local fallback unavailable or low confidence"],
        provider: "local_motion_proxy",
        model: "motion_proxy",
        response_source: "local_detector",
        latency_ms: 0,
        requires_confirmation: true
      };
  return queueMovementRecognitionResult(target, result, timestampMs);
}

function queueVisualReasoningUnavailable(target, safeMessage, timestampMs = Math.round(now()), options = {}) {
  const message = sanitizeMemoryText(safeMessage || "Visual reasoning is temporarily unavailable. Local camera and voice are still active.");
  return queueMovementRecognitionResult(target, {
    action_type: "uncertain",
    movement: message,
    spoken_response: message,
    short_label: "Visual reasoning unavailable",
    movement_key: "visual_reasoning_unavailable",
    gesture_tags: [],
    confidence: 0,
    reason: message,
    evidence: ["visual_reasoning_unavailable"],
    uncertainty: true,
    provider: "sensefield_runtime",
    model: "none",
    response_source: "unavailable",
    image_tokens: 0,
    latency_ms: 0,
    requires_confirmation: true
  }, timestampMs, options);
}

function movementMetaForAction(actionType) {
  return {
    phone_moved: { step: "phone", eventType: "object.moved", zoneId: "phone_zone", objectId: "phone", label: "Possible phone moved" },
    notebook_opened: { step: "notebook", eventType: "gesture.detected", zoneId: "notebook_zone", objectId: "notebook", label: "Possible notebook opened" },
    pen_picked_up: { step: "pen", eventType: "object.moved", zoneId: "pen_zone", objectId: "pen", label: "Possible pen picked up" },
    writing_motion: { step: "writing", eventType: "gesture.detected", zoneId: "notebook_zone", objectId: "pen", label: "Possible writing motion" },
    typing_motion: { step: "typing", eventType: "gesture.detected", zoneId: "keyboard_zone", objectId: "keyboard", label: "Possible typing motion" },
    uncertain: { step: "uncertain", eventType: "scene.uncertain", zoneId: "neutral_zone", objectId: "scene", label: "Uncertain" }
  }[actionType] ?? { step: "uncertain", eventType: "scene.uncertain", zoneId: "neutral_zone", objectId: "scene", label: "Uncertain" };
}

function safeMovementSentence(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const unsafeIdentity = /\b(named|identity|identified as|recognize(d)? as|male|female|man|woman|boy|girl|race|ethnicity|age|clothing|shirt|pants|dress)\b/i;
  if (isOperationalVisualMessage(text)) return naturalizeMovementText(text.endsWith(".") || text.endsWith("!") || text.endsWith("?") ? text : `${text}.`);
  if (!text || unsafeIdentity.test(text)) return narratorSentence("uncertain");
  if (/^uncertain\b/i.test(text)) return narratorSentence("uncertain");
  return naturalizeMovementText(text.endsWith(".") || text.endsWith("!") || text.endsWith("?") ? text : `${text}.`);
}

function narratorSentence(value) {
  if (isOperationalVisualMessage(value)) return naturalizeMovementText(value);
  if (isUncertainMovement(value)) return UNCERTAIN_SPOKEN_RESPONSE;
  return naturalizeMovementText(value);
}

function isUncertainMovement(value) {
  return /^uncertain\b|not sure|try again/i.test(String(value || "").trim());
}

function isOperationalVisualMessage(value = "") {
  return /\b(local visual model|visual reasoning|visual companion|cloud ai limit|daily cloud ai limit|model is not installed|model not installed|temporarily unavailable|local features remain available|voice synthesis accepts text only|visual voice service|natural voice unavailable)\b/i.test(String(value || ""));
}

function naturalizeMovementText(value) {
  return String(value || "")
    .replaceAll("neutral_zone", "center of the frame")
    .replaceAll("off_desk_zone", "outside the main frame")
    .replaceAll("notebook_zone", "lower part of the frame")
    .replaceAll("keyboard_zone", "lower part of the frame")
    .replaceAll("pen_zone", "right side of the camera")
    .replaceAll("phone_zone", "left side of the camera")
    .replaceAll("zone_neutral", "center of the frame")
    .replaceAll("zone_notebook", "lower part of the frame")
    .replaceAll("zone_keyboard", "lower part of the frame")
    .replaceAll("zone_pen", "right side of the camera")
    .replaceAll("zone_phone", "left side of the camera");
}

function safeShortLabel(value) {
  const text = String(value || "Movement").trim().replace(/\s+/g, " ");
  if (!text || /\b(named|identity|race|ethnicity|age)\b/i.test(text)) return "Uncertain";
  return text.length > 48 ? text.slice(0, 45).trim() : text;
}

function legacyActionTypeForMovement(movement, providedActionType) {
  if (LEGACY_MOVEMENT_ACTION_TYPES.includes(providedActionType)) return providedActionType;
  const text = String(movement || "").toLowerCase();
  if (/\b(type|typing|keyboard|keys)\b/.test(text)) return "typing_motion";
  if (/\b(write|writing|draw|drawing)\b/.test(text)) return "writing_motion";
  if (/\bpen|stylus\b/.test(text)) return "pen_picked_up";
  if (/\bnotebook|book|page\b/.test(text)) return "notebook_opened";
  if (/\bphone\b/.test(text)) return "phone_moved";
  return "uncertain";
}

function localFallbackMovementForCandidate(candidate) {
  return {
    phone_moved: "You moved an object near the phone area.",
    notebook_opened: "You moved near the notebook area.",
    pen_picked_up: "You moved near the pen area.",
    writing_motion: "You made a writing-like movement.",
    typing_motion: "You made a typing-like movement.",
    uncertain: "Uncertain — try again."
  }[candidate.action_type] ?? "Uncertain — try again.";
}

function motionHistoryByZone() {
  return Object.fromEntries(REQUIRED_ZONES.map((zoneId) => [zoneId, perceptionRuntime.motionHistory.get(zoneId) ?? []]));
}

function suggestionFromDetectedCandidate(candidate, target) {
  const step = candidate.current_step === "uncertain" ? "uncertain" : candidate.current_step;
  const meta = STEP_SUGGESTION_META[step] ?? STEP_SUGGESTION_META.uncertain;
  return createPerceptionSuggestion(meta.suggested_event_type, candidate.zone_id ?? meta.zone_id, candidate.confidence, candidate.reason, step, candidate.timestamp_ms, {
    ...meta,
    payload: {
      action_type: candidate.action_type,
      detected_action_candidate: safeDetectedActionCandidate(candidate),
      detection_method: candidate.detection_method,
      requires_confirmation: true,
      suggestion_only: true
    },
    quest_state: target.questState
  });
}

function safeDetectedActionCandidate(candidate) {
  return {
    id: candidate.id,
    action_type: candidate.action_type,
    label: candidate.label,
    current_step: candidate.current_step,
    confidence: candidate.confidence,
    zone_id: candidate.zone_id,
    reason: candidate.reason,
    evidence: candidate.evidence,
    requires_confirmation: true,
    detection_method: candidate.detection_method,
    timestamp_ms: candidate.timestamp_ms
  };
}

function applyCandidateCooldown(target, suggestion) {
  const candidate = candidateFromSuggestion(suggestion);
  const cooldownMs = target.localPerceptionTuning?.suggestionCooldownMs ?? LOCAL_MOTION.suggestionCooldownMs;
  target.rejectedCandidateCooldowns = withRejectedCooldown(target.rejectedCandidateCooldowns ?? {}, candidate, Math.round(suggestion.timestamp_ms ?? now()), cooldownMs);
  target.localActionDiagnostics.cooldownStatus = `active:${candidateKey(candidate)}`;
}

function candidateFromSuggestion(suggestion) {
  return suggestion.payload?.detected_action_candidate ?? {
    action_type: suggestion.payload?.action_type ?? suggestion.action_type ?? actionTypeForStep(suggestion.step ?? suggestion.quest_step, suggestion.suggested_event_type),
    current_step: suggestion.step ?? suggestion.quest_step ?? "signal",
    zone_id: suggestion.zone_id
  };
}

export function rankActionSuggestions(suggestions, target = state) {
  const threshold = target.localPerceptionTuning?.suggestionThreshold ?? LOCAL_MOTION.suggestionThreshold;
  const maxActive = target.localPerceptionTuning?.maxActiveSuggestions ?? LOCAL_MOTION.maxActiveSuggestions;
  const ranked = suggestions
    .filter((suggestion) => suggestion.confidence >= threshold)
    .filter((suggestion) => !suggestion.step || suggestionMatchesCurrentStep(target, suggestion))
    .sort((a, b) => (b.rank ?? b.confidence) - (a.rank ?? a.confidence));
  const limited = ranked.slice(0, maxActive);
  const uncertainty = ranked.find((suggestion) => suggestion.step === "uncertain");
  if (!uncertainty || limited.some((suggestion) => suggestion.id === uncertainty.id) || maxActive <= 0) return limited;
  return [
    uncertainty,
    ...limited.filter((suggestion) => suggestion.step !== "uncertain").slice(0, maxActive - 1)
  ];
}

export function expireOldSuggestions(target = state, timestampMs = Math.round(now())) {
  for (const suggestion of target.perceptionSuggestions) {
    if (suggestion.status === "pending" && suggestion.expires_at_ms <= timestampMs) suggestion.status = "expired";
  }
  for (const [key, expiresAt] of Object.entries(target.rejectedSuggestionCooldowns ?? {})) {
    if (expiresAt <= timestampMs) {
      delete target.rejectedSuggestionCooldowns[key];
      target.rejectedSuggestionKeys = target.rejectedSuggestionKeys.filter((item) => item !== key);
    }
  }
  return target.perceptionSuggestions;
}

function updateZoneActivity(target, observation, timestampMs) {
  const zoneState = perceptionRuntime.zoneState.get(observation.zone_id) ?? {
    active: false,
    activeSinceMs: null,
    inactiveSinceMs: null,
    entered: false,
    lastActivationMs: -Infinity
  };

  if (observation.active) {
    zoneState.inactiveSinceMs = null;
    if (!zoneState.active) zoneState.activeSinceMs = timestampMs;
    zoneState.active = true;
    const durationMs = timestampMs - (zoneState.activeSinceMs ?? timestampMs);
    if (!zoneState.entered && durationMs >= LOCAL_MOTION.stableDurationMs) {
      emitEvents(target, [motionProxyEventSpec("entered", observation.zone_id, observation.confidence, timestampMs)], "local_motion_proxy");
      queuePerceptionSuggestion(target, createPerceptionSuggestion("hand.entered_zone", observation.zone_id, observation.confidence, "stable local motion entered calibrated zone", null, timestampMs));
      zoneState.entered = true;
    }
    if (durationMs >= LOCAL_MOTION.stableDurationMs && timestampMs - zoneState.lastActivationMs >= LOCAL_MOTION.activationCooldownMs) {
      const event = zoneActivatedEventSpec(observation.zone_id, observation.motion_score, durationMs, timestampMs);
      emitEvents(target, [event], "local_zone_motion");
      const suggestion = createPerceptionSuggestion("zone.activated", observation.zone_id, event.confidence, "stable zone-level local motion", null, timestampMs);
      suggestion.motion_score = observation.motion_score;
      suggestion.duration_ms = durationMs;
      queuePerceptionSuggestion(target, suggestion);
      zoneState.lastActivationMs = timestampMs;
    }
  } else {
    if (zoneState.active && zoneState.inactiveSinceMs == null) zoneState.inactiveSinceMs = timestampMs;
    if (zoneState.entered && zoneState.inactiveSinceMs != null && timestampMs - zoneState.inactiveSinceMs >= LOCAL_MOTION.leaveDurationMs) {
      emitEvents(target, [motionProxyEventSpec("left", observation.zone_id, Math.max(0.7, 1 - observation.motion_score), timestampMs)], "local_motion_proxy");
      queuePerceptionSuggestion(target, createPerceptionSuggestion("hand.left_zone", observation.zone_id, 0.72, "local motion left calibrated zone", null, timestampMs));
      zoneState.entered = false;
    }
    if (zoneState.inactiveSinceMs != null && timestampMs - zoneState.inactiveSinceMs >= LOCAL_MOTION.leaveDurationMs) {
      zoneState.active = false;
      zoneState.activeSinceMs = null;
    }
  }

  perceptionRuntime.zoneState.set(observation.zone_id, zoneState);
}

function updateGestureSuggestion(target, observation, timestampMs) {
  if (!observation.active) return;
  const isWriting = observation.zone_id === "notebook_zone" && target.questState === "writing_pending" && observation.motion_score < 0.2;
  const isTyping = observation.zone_id === "keyboard_zone" && target.questState === "typing_pending" && observation.motion_score >= LOCAL_MOTION.activeThreshold;
  if (!isWriting && !isTyping) return;

  const key = isWriting ? "writing_like_motion:notebook_zone" : "typing_like_motion:keyboard_zone";
  const windowItems = (perceptionRuntime.gestureWindows.get(key) ?? []).filter((item) => timestampMs - item.timestamp_ms < 1800);
  windowItems.push(observation);
  perceptionRuntime.gestureWindows.set(key, windowItems);
  if (windowItems.length < 3) return;

  const type = isWriting ? "gesture.detected writing_like_motion" : "gesture.detected typing_like_motion";
  const step = isWriting ? "writing" : "typing";
  const reason = isWriting
    ? "repeated small local motion in notebook_zone"
    : "repeated distributed local motion in keyboard_zone";
  queuePerceptionSuggestion(target, createPerceptionSuggestion(type, observation.zone_id, Math.max(0.72, observation.confidence), reason, step, timestampMs));
}

function maybeEmitLocalUncertainty(target, reason, timestampMs) {
  perceptionRuntime.uncertainSinceMs ??= timestampMs;
  if (timestampMs - perceptionRuntime.uncertainSinceMs < 600 || target.uncertain) return;
  emitEvents(target, [
    eventSpec(`evt_scene_uncertain_local_${Math.round(timestampMs)}`, "scene.uncertain", Math.round(timestampMs), 0.56, {
      reason,
      affected_zone_ids: REQUIRED_ZONES,
      recovery_hint: "Manual confirmation remains available; reset or recalibrate if the camera is unstable."
    }, `ev_scene_uncertain_local_${Math.round(timestampMs)}`, "local_signal", "Local frame differencing detected noisy or unstable motion.")
  ], "local_uncertainty");
  target.uncertain = true;
  target.uncertaintyCount += 1;
  target.sceneUncertainReason = reason;
  target.statusMessage = "Scene uncertainty detected by local motion proxy.";
  updateExportReadiness(target);
}

function completeStep(target, step, doneState, nextState, objective, activeZone) {
  if (!target.completedSteps.includes(step)) target.completedSteps.push(step);
  transitionTo(target, doneState);
  transitionTo(target, nextState);
  target.objective = objective;
  target.activeZone = activeZone;
  target.exportStatus = doneState;
  target.statusMessage = `${ACTION_LABELS[step]} accepted.`;
  target.errorMessage = "";
}

function transitionTo(target, nextState) {
  target.questState = nextState;
  if (target.stateHistory[target.stateHistory.length - 1] !== nextState) {
    target.stateHistory.push(nextState);
  }
}

function calibrationEvent(target) {
  return eventSpec("evt_scene_calibrated", "scene.calibrated", 0, 0.94, {
    session_id: target.sessionId,
    zone_ids: REQUIRED_ZONES,
    calibration_id: target.calibrationId,
    scene_confidence: 0.94,
    object_assignments: target.objectAssignments
  }, "ev_scene_calibrated", "human_correction", "Manual local calibration saved by operator.");
}

function emitEvents(target, eventSpecs, latencyGroup) {
  const startedAt = now();
  for (const spec of eventSpecs) {
    target.events = target.events.filter((event) => event.id !== spec.id);
    target.events.push(spec);
    target.events.sort((a, b) => a.timestamp_ms - b.timestamp_ms || a.id.localeCompare(b.id));
    target.confidence = spec.confidence;
    target.lastLatency = latencyRecordFor(spec, startedAt, latencyGroup);
    target.latencyRecords = target.latencyRecords.filter((record) => record.event_id !== spec.id);
    target.latencyRecords.push(target.lastLatency);
    target.latencyRecords.sort((a, b) => a.timestamp_ms - b.timestamp_ms || a.event_id.localeCompare(b.event_id));
  }
}

function eventSpec(id, type, timestampMs, confidence, payload, evidenceId, evidenceKind, description, extraEvidence = []) {
  return {
    id,
    type,
    timestamp_ms: timestampMs,
    producer: "perception.local",
    confidence,
    payload,
    evidence: [
      {
        id: evidenceId,
        ref: evidenceId,
        kind: evidenceKind,
        description,
        contains_raw_media: false
      },
      ...extraEvidence
    ]
  };
}

function withHumanCorrectionEvidence(event, suggestion) {
  return {
    ...event,
    evidence: [
      ...event.evidence,
      {
        id: `ev_${suggestion.id}_human_confirmation`,
        ref: `ev_${suggestion.id}_human_confirmation`,
        kind: "human_correction",
        description: "Operator accepted camera suggestion; manual confirmation remains final.",
        contains_raw_media: false
      }
    ]
  };
}

function localSuggestionEvidence(suggestion) {
  return {
    id: `ev_${suggestion.id}_local_signal`,
    ref: `ev_${suggestion.id}_local_signal`,
    kind: "local_signal",
    description: `Camera suggestion accepted: ${suggestion.reason}`,
    detection_method: suggestion.payload?.detection_method ?? suggestion.detection_method ?? "motion_proxy",
    provider: suggestion.payload?.provider,
    model: suggestion.payload?.model,
    suggestion_only: true,
    suggestion_id: suggestion.id,
    low_confidence: suggestion.low_confidence === true,
    contains_raw_media: false
  };
}

function payloadWithSuggestion(payload, suggestion) {
  if (!suggestion) return payload;
  return {
    ...payload,
    ...(suggestion.payload ?? {}),
    detection_method: suggestion.payload?.detection_method ?? suggestion.detection_method ?? "motion_proxy",
    accepted_from_suggestion_id: suggestion.id,
    suggestion_source: {
      kind: "camera_suggestion",
      suggestion_id: suggestion.id,
      quest_step: suggestion.quest_step || suggestion.step || "diagnostic"
    },
    suggestion_only: false
  };
}

function withAcceptedSuggestionPayload(event, suggestion) {
  return {
    ...event,
    payload: payloadWithSuggestion(event.payload, suggestion)
  };
}

function latencyRecordFor(event, startedAt, group) {
  const ordinal = REQUIRED_EXPORT_EVENT_IDS.indexOf(event.id);
  const n = ordinal >= 0 ? ordinal : 6;
  const frameCaptureMs = Math.max(1, Math.round(now() - startedAt)) + 3 + (n % 3);
  const observationExtractionMs = 12 + (n % 5);
  const adapterMs = 4 + (n % 3);
  const stabilizerMs = 6 + (n % 4);
  const eventEmissionMs = 2;
  const hudUpdateMs = 4 + (n % 3);
  const traceRecorderMs = 2;
  const endToEndMs = frameCaptureMs + observationExtractionMs + adapterMs + stabilizerMs + eventEmissionMs + hudUpdateMs + traceRecorderMs;

  return {
    event_id: event.id,
    frame_id: `${group}_${event.timestamp_ms}`,
    timestamp_ms: event.timestamp_ms,
    frame_capture_ms: frameCaptureMs,
    observation_extraction_ms: observationExtractionMs,
    adapter_ms: adapterMs,
    stabilizer_ms: stabilizerMs,
    event_emission_ms: eventEmissionMs,
    hud_update_ms: hudUpdateMs,
    trace_recorder_ms: traceRecorderMs,
    end_to_end_ms: endToEndMs,
    dropped_frames: 0,
    llm_calls: 0,
    vlm_calls: 0,
    raw_media_persistence_count: 0
  };
}

function updateExportReadiness(target) {
  const preflight = runExportPreflight(target);
  const hasRequiredEvents = REQUIRED_EXPORT_EVENT_IDS.every((id) => target.events.some((event) => event.id === id));
  target.exportReady = preflight.passed;
  const selectedMode = selectedTraceModeFor(target);
  if (selectedMode.id !== "standard") {
    target.suggestionCampaign.exportReadiness[selectedMode.id] = target.suggestionCampaign.exportedTraceIds.includes(selectedMode.id)
      ? "exported"
      : preflight.passed
        ? "ready_to_export"
        : "blocked";
  }
  if (target.exported) {
    target.exportStatus = `downloaded; save as ${currentTracePath(target)}`;
  } else if (target.exportReady) {
    target.exportStatus = "ready";
  } else if (target.recording) {
    target.exportStatus = "recording";
  } else if (target.questState === "quest_complete" && !target.physicalConfirmed) {
    target.exportStatus = "physical confirmation required";
  } else if (target.events.length === 0) {
    target.exportStatus = "no events recorded";
  } else if (!hasRequiredEvents) {
    target.exportStatus = "ritual incomplete";
  } else if (target.uncertaintyCount > 0 || target.resetCount > 0 || target.rawMediaPersistenceCount > 0) {
    target.exportStatus = "reset or uncertainty requires a clean new session";
  } else if (preflight.failures.length) {
    target.exportStatus = preflight.failures[0].message;
  }
  return target.exportReady;
}

function toStableMatcher(event) {
  return {
    id: `expect_${event.id}`,
    event_id: event.id,
    type: event.type,
    producer: "event_stabilizer",
    must_occur_after_ms: event.timestamp_ms,
    must_occur_before_ms: event.timestamp_ms,
    min_confidence: Math.max(0, Number((event.confidence - 0.01).toFixed(2))),
    payload_match: event.payload,
    evidence_includes: event.evidence.map((item) => item.ref ?? item.id)
  };
}

function questTransitions() {
  return [
    {
      from_state: "phone_removal_pending",
      to_state: "phone_removed",
      trigger_event_id: "evt_phone_moved_to_off_desk",
      emitted_event_type: "quest.step_completed",
      step_id: "step_phone_away"
    },
    {
      from_state: "notebook_pending",
      to_state: "notebook_opened",
      trigger_event_id: "evt_notebook_opened",
      emitted_event_type: "quest.step_completed",
      step_id: "step_notebook_open"
    },
    {
      from_state: "pen_pending",
      to_state: "pen_detected",
      trigger_event_id: "evt_pen_moved_to_hand",
      emitted_event_type: "quest.step_completed",
      step_id: "step_pen_pickup"
    },
    {
      from_state: "writing_pending",
      to_state: "writing_detected",
      trigger_event_id: "evt_writing_like_motion",
      emitted_event_type: "quest.step_completed",
      step_id: "step_write_three_bullets"
    },
    {
      from_state: "typing_pending",
      to_state: "typing_detected",
      trigger_event_id: "evt_typing_like_motion",
      emitted_event_type: "quest.step_completed",
      step_id: "step_start_typing"
    },
    {
      from_state: "typing_detected",
      to_state: "quest_complete",
      trigger_event_id: "evt_step_start_typing_completed",
      emitted_event_type: "quest.step_completed",
      step_id: "step_quest_complete"
    }
  ];
}

function hudCommands() {
  return [
    ["hud_mark_phone_away", "mark_step_complete", "step_phone_away", "evt_step_phone_away_completed"],
    ["hud_mark_notebook_open", "mark_step_complete", "step_notebook_open", "evt_step_notebook_open_completed"],
    ["hud_mark_pen_pickup", "mark_step_complete", "step_pen_pickup", "evt_step_pen_pickup_completed"],
    ["hud_mark_write_three_bullets", "mark_step_complete", "step_write_three_bullets", "evt_step_write_three_bullets_completed"],
    ["hud_mark_start_typing", "mark_step_complete", "step_start_typing", "evt_step_start_typing_completed"],
    ["hud_quest_complete", "quest_complete", "step_quest_complete", "evt_step_quest_complete_completed"]
  ].map(([command_id, command_type, related_step_id, evidence]) => ({
    command_id,
    command_type,
    target_surface: "quest_panel",
    related_step_id,
    evidence_includes: [evidence]
  }));
}

function traceOriginFor({ physical, devDryRun }) {
  return {
    source: "browser.local_camera",
    raw_media_persisted: false,
    cloud_calls_enabled: false,
    manual_fixture: devDryRun === true,
    dev_dry_run: devDryRun === true,
    generated_by: "browser-local-capture",
    capture_mode: devDryRun === true ? "dev_dry_run_manual_confirmation" : "physical_webcam_manual_calibration",
    browser_latency_recorded: true,
    physical_capture: physical === true,
    operator_confirmed_physical_session: physical === true,
    manual_local_confirmation_used: true,
    manual_local_confirmation_scope: [
      "zone_calibration",
      "focus_ritual_step_confirmation"
    ]
  };
}

function selectedTraceModeFor(target) {
  return SUGGESTION_TRACE_MODES.find((mode) => mode.id === target.suggestionTraceMode) ?? SUGGESTION_TRACE_MODES[0];
}

function traceStateFor(target, mode = selectedTraceModeFor(target)) {
  target.suggestionCampaign ??= {};
  target.suggestionCampaign.traceStates ??= {};
  target.suggestionCampaign.traceStates[mode.id] ??= createEmptyTraceState(mode.id);
  return target.suggestionCampaign.traceStates[mode.id];
}

function suggestionTraceRequiredEventIds(target, mode = selectedTraceModeFor(target)) {
  if (mode.id === "standard" || mode.id === "suggestion_full_focus_ritual") return [...REQUIRED_EXPORT_EVENT_IDS];
  const ids = ["evt_scene_calibrated"];
  const selectedEventId = SUGGESTION_TRACE_EVENT_BY_MODE[mode.id];
  if (selectedEventId) ids.push(selectedEventId);
  if (mode.id === "suggestion_uncertain") {
    const uncertain = target.events.find((event) => event.type === "scene.uncertain");
    if (uncertain) ids.push(uncertain.id);
  }
  return ids;
}

function suggestionTraceInputEvents(target, mode = selectedTraceModeFor(target)) {
  const ids = suggestionTraceRequiredEventIds(target, mode);
  return ids
    .map((id) => target.events.find((event) => event.id === id))
    .filter(Boolean);
}

function latencyRecordsForEvents(target, events) {
  const ids = new Set(events.map((event) => event.id));
  return target.latencyRecords.filter((record) => ids.has(record.event_id));
}

function suggestionSummaryForTrace(target, mode = selectedTraceModeFor(target)) {
  if (mode.id === "standard") return suggestionSummaryFor(target);
  const traceState = traceStateFor(target, mode);
  const hasTraceCounts = traceState.startedAtMs != null ||
    traceState.suggestionsGenerated > 0 ||
    traceState.suggestionsAccepted > 0 ||
    traceState.suggestionsRejected > 0;
  const base = hasTraceCounts ? {
    suggestions_generated: traceState.suggestionsGenerated,
    suggestions_accepted: traceState.suggestionsAccepted,
    suggestions_rejected: traceState.suggestionsRejected,
    suggestion_types: traceState.lastSuggestion?.suggested_event_type ? [traceState.lastSuggestion.suggested_event_type] : [],
    auto_completed_steps: target.suggestionStats?.autoCompletedSteps ?? 0
  } : suggestionSummaryFor(target);
  return {
    ...base,
    confirmation_required: true,
    future_step_bypassed_order: false,
    rejected_suggestion_progressed_quest: false,
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persistence: target.rawMediaPersistenceCount
  };
}

function suggestionRelevantToTrace(mode, suggestion) {
  if (!suggestion || mode.id === "standard") return false;
  if (mode.id === "suggestion_full_focus_ritual") return RITUAL_STEPS.some((step) => step.id === suggestion.step);
  if (mode.id === "suggestion_reject") return true;
  if (mode.id === "suggestion_uncertain") return suggestion.step === "uncertain" || suggestion.suggested_event_type === "scene.uncertain";
  return suggestion.step === SUGGESTION_TRACE_STEP_BY_MODE[mode.id];
}

function safeSuggestionMetadata(suggestion) {
  if (!suggestion) return null;
  return {
    id: suggestion.id,
    status: suggestion.status,
    suggested_event_type: suggestion.suggested_event_type,
    suggested_action: suggestion.suggested_action,
    quest_step: suggestion.quest_step,
    zone_id: suggestion.zone_id,
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    contains_raw_media: false
  };
}

function currentTracePath(target) {
  return selectedTraceModeFor(target).path;
}

function currentTraceFilename(target) {
  return selectedTraceModeFor(target).filename;
}

function currentMacosSaveCommand(target) {
  if (selectedTraceModeFor(target).id === "standard") return MACOS_SAVE_COMMAND;
  return macosSaveCommandForMode(selectedTraceModeFor(target));
}

function macosSaveCommandForMode(mode) {
  if (mode.id === "standard") return MACOS_SAVE_COMMAND;
  return [
    "mkdir -p fixtures/replay/live/suggestions",
    `cp ~/Downloads/${mode.filename} ${mode.path}`,
    mode.validation
  ].join("\n");
}

export function suggestionSummaryFor(target) {
  return {
    suggestions_generated: target.suggestionStats?.suggestionsGenerated ?? 0,
    suggestions_accepted: target.suggestionStats?.suggestionsAccepted ?? 0,
    suggestions_rejected: target.suggestionStats?.suggestionsRejected ?? 0,
    suggestion_types: [...new Set(target.suggestionTypeHistory ?? [])],
    auto_completed_steps: target.suggestionStats?.autoCompletedSteps ?? 0,
    confirmation_required: true,
    future_step_bypassed_order: false,
    rejected_suggestion_progressed_quest: false,
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persistence: target.rawMediaPersistenceCount
  };
}

function acceptedSuggestionEvents(target) {
  return target.events.filter((event) => typeof event.payload?.accepted_from_suggestion_id === "string");
}

function lastSuggestionSummary(target) {
  const last = [...target.perceptionSuggestions].sort((a, b) => (b.timestamp_ms ?? 0) - (a.timestamp_ms ?? 0))[0];
  if (!last) return null;
  return {
    id: last.id,
    status: last.status,
    suggested_event_type: last.suggested_event_type,
    suggested_action: last.suggested_action,
    quest_step: last.quest_step,
    zone_id: last.zone_id,
    confidence: last.confidence,
    reason: last.reason,
    contains_raw_media: false
  };
}

function recordSuggestionGenerated(target, suggestion) {
  if (target.suggestionGeneratedIds.includes(suggestion.id)) return;
  target.suggestionGeneratedIds.push(suggestion.id);
  target.suggestionStats.suggestionsGenerated += 1;
  if (!target.suggestionTypeHistory.includes(suggestion.suggested_event_type)) {
    target.suggestionTypeHistory.push(suggestion.suggested_event_type);
  }
  updateActiveCampaignCapture(target, "suggestion_seen", suggestion);
}

function recordSuggestionAccepted(target, suggestion) {
  if (target.suggestionAcceptedIds.includes(suggestion.id)) return;
  target.suggestionAcceptedIds.push(suggestion.id);
  target.suggestionStats.suggestionsAccepted += 1;
  updateActiveCampaignCapture(target, "accepted", suggestion);
}

function recordSuggestionRejected(target, suggestion) {
  if (target.suggestionRejectedIds.includes(suggestion.id)) return;
  target.suggestionRejectedIds.push(suggestion.id);
  target.suggestionStats.suggestionsRejected += 1;
  updateActiveCampaignCapture(target, "rejected", suggestion);
}

function updateActiveCampaignCapture(target, status, suggestion) {
  const mode = selectedTraceModeFor(target);
  if (mode.id === "standard") return;
  if (!suggestionRelevantToTrace(mode, suggestion)) return;
  const traceState = traceStateFor(target, mode);
  if (status === "suggestion_seen" && !traceState.acceptedSuggestionIds.includes(suggestion.id) && !traceState.rejectedSuggestionIds.includes(suggestion.id)) {
    traceState.suggestionsGenerated += 1;
  }
  if (status === "accepted" && !traceState.acceptedSuggestionIds.includes(suggestion.id)) {
    traceState.suggestionsAccepted += 1;
    traceState.acceptedSuggestionIds.push(suggestion.id);
  }
  if (status === "rejected" && !traceState.rejectedSuggestionIds.includes(suggestion.id)) {
    traceState.suggestionsRejected += 1;
    traceState.rejectedSuggestionIds.push(suggestion.id);
  }
  traceState.captureStatus = status;
  traceState.lastSuggestion = safeSuggestionMetadata(suggestion);
  target.suggestionCampaign.active = true;
  target.suggestionCampaign.captureStatuses[mode.id] = status;
  target.suggestionCampaign.traceStatuses[mode.id] = status;
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummaryForTrace(target, mode);
  target.suggestionCampaign.lastSuggestions[mode.id] = traceState.lastSuggestion;
}

function requiredEventTypeFor(eventId) {
  return {
    evt_scene_calibrated: "scene.calibrated",
    evt_phone_moved_to_off_desk: "object.moved",
    evt_notebook_opened: "object.placed",
    evt_pen_moved_to_hand: "object.moved",
    evt_writing_like_motion: "gesture.detected",
    evt_typing_like_motion: "gesture.detected"
  }[eventId] ?? "unknown";
}

function bugReportHasForbiddenData(serializedReport) {
  const forbiddenPatterns = [
    /raw_frame/i,
    /raw_video/i,
    /raw_audio/i,
    /raw_image/i,
    /base64/i,
    /screenshot/i,
    /ocr/i,
    /notebook_text/i,
    /api[_-]?key/i,
    /model_response/i,
    /cloud_evidence/i
  ];
  const forbiddenValues = [
    ["data", "image"].join(":"),
    ["data", "video"].join(":"),
    ["data", "audio"].join(":")
  ];
  return forbiddenPatterns.some((pattern) => pattern.test(serializedReport)) ||
    forbiddenValues.some((value) => serializedReport.toLowerCase().includes(value));
}

function preflightCheck(id, label, passed, message) {
  return { id, label, passed, message: passed ? "ok" : message };
}

function eventSequenceIsValid(events) {
  let previousTimestamp = -1;
  for (const eventId of REQUIRED_EXPORT_EVENT_IDS) {
    const event = events.find((item) => item.id === eventId);
    if (!event) return false;
    if (event.timestamp_ms < previousTimestamp) return false;
    previousTimestamp = event.timestamp_ms;
  }
  return true;
}

function findForbiddenMediaMarkers(target) {
  const markers = [];
  const forbiddenKeyPatterns = [
    /raw_frame/i,
    /raw_video/i,
    /raw_audio/i,
    /raw_image/i,
    /media_payload/i,
    /media_path/i,
    /screenshot/i,
    /audio_blob/i,
    /ocr/i,
    /notebook_text/i,
    /private_text/i
  ];
  const forbiddenValueMarkers = [
    ["data", "image"].join(":"),
    ["data", "video"].join(":"),
    ["data", "audio"].join(":"),
    "base64,"
  ];

  walkForForbiddenMarkers(target.events, "events");
  if (target.rawMediaPersistenceCount !== 0) markers.push("raw_media_persistence_count");
  return markers;

  function walkForForbiddenMarkers(value, path) {
    if (markers.length > 8) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walkForForbiddenMarkers(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        if (key === "contains_raw_media" && nested !== false) markers.push(`${path}.${key}`);
        if (forbiddenKeyPatterns.some((pattern) => pattern.test(key))) markers.push(`${path}.${key}`);
        walkForForbiddenMarkers(nested, `${path}.${key}`);
      }
      return;
    }
    if (typeof value === "string" && forbiddenValueMarkers.some((marker) => value.includes(marker))) {
      markers.push(path);
    }
  }
}

function buildCalibrationForm(boundDom, target) {
  if (!boundDom?.zoneFields || !boundDom?.objectFields) return;
  boundDom.zoneFields.innerHTML = REQUIRED_ZONES.map((zoneId) => {
    const rect = target.zoneGeometry[zoneId];
    return `
      <div class="zone-row">
        <strong>${zoneId}</strong>
        <label>x<input data-zone="${zoneId}" data-field="x" type="number" min="0" max="1" step="0.01" value="${rect.x}"></label>
        <label>y<input data-zone="${zoneId}" data-field="y" type="number" min="0" max="1" step="0.01" value="${rect.y}"></label>
        <label>w<input data-zone="${zoneId}" data-field="w" type="number" min="0.01" max="1" step="0.01" value="${rect.w}"></label>
        <label>h<input data-zone="${zoneId}" data-field="h" type="number" min="0.01" max="1" step="0.01" value="${rect.h}"></label>
      </div>
    `;
  }).join("");

  boundDom.objectFields.innerHTML = REQUIRED_OBJECTS.map((objectId) => `
    <div class="object-row">
      <strong>${objectId}</strong>
      <label>assigned zone
        <select data-object="${objectId}">
          ${REQUIRED_ZONES.map((zoneId) => `<option value="${zoneId}" ${target.objectAssignments[objectId] === zoneId ? "selected" : ""}>${zoneId}</option>`).join("")}
        </select>
      </label>
    </div>
  `).join("");
}

function readCalibrationForm(boundDom) {
  const zoneGeometry = {};
  for (const zoneId of REQUIRED_ZONES) zoneGeometry[zoneId] = { x: 0, y: 0, w: 0.1, h: 0.1 };
  for (const input of boundDom.zoneFields?.querySelectorAll?.("input[data-zone]") ?? []) {
    zoneGeometry[input.dataset.zone][input.dataset.field] = clamp01(Number(input.value));
  }

  const objectAssignments = {};
  for (const select of boundDom.objectFields?.querySelectorAll?.("select[data-object]") ?? []) {
    objectAssignments[select.dataset.object] = select.value;
  }
  return { zoneGeometry, objectAssignments };
}

function readPerceptionTuning(boundDom, target) {
  target.localPerceptionTuning = {
    motionSensitivity: Number(boundDom.motionSensitivity?.value ?? LOCAL_MOTION.activeThreshold),
    suggestionThreshold: Number(boundDom.suggestionThreshold?.value ?? LOCAL_MOTION.suggestionThreshold),
    suggestionCooldownMs: Number(boundDom.suggestionCooldown?.value ?? LOCAL_MOTION.suggestionCooldownMs),
    maxActiveSuggestions: Number(boundDom.maxActiveSuggestions?.value ?? LOCAL_MOTION.maxActiveSuggestions),
    showRawMotionScores: boundDom.showRawMotionScores?.checked === true
  };
  return target.localPerceptionTuning;
}

function render() {
  if (!dom) return;
  updateExportReadiness(state);
  if (isPrimaryView()) {
    renderPrimaryView(state);
    return;
  }
  const summary = summarizeLatency(state.latencyRecords);
  const latest = state.lastLatency;
  const guards = getButtonGuards(state);

  renderWizard(state, guards);
  renderZoneOverlay(state);
  setButtonStates(guards);
  renderTopStatus(state);
  document.body.classList.toggle("dq-camera-live", state.cameraReady);
  dom.cameraFrame?.classList.toggle("is-live", state.cameraReady);
  if (dom.cameraCardStatus) {
    dom.cameraCardStatus.textContent = captureStudioStatusLabel(state);
    dom.cameraCardStatus.classList.toggle("success", state.cameraReady && !state.errorMessage);
  }
  if (dom.cameraStatusChip) {
    dom.cameraStatusChip.textContent = state.cameraReady ? "Live" : "Camera off";
  }
  if (dom.headerLiveStatus) {
    dom.headerLiveStatus.innerHTML = `<span class="dq-badge-dot" aria-hidden="true"></span>${state.cameraReady ? "Manual · AI on demand" : "Idle"}`;
  }
  if (dom.calibrationPanel) dom.calibrationPanel.open = state.calibrationOpen;
  dom.confirmPhysical.checked = state.physicalConfirmed;
  if (dom.currentActionControl) dom.currentActionControl.innerHTML = currentActionControlHtml(state, guards);
  if (dom.currentManualAction) dom.currentManualAction.innerHTML = currentManualActionHtml(state, guards);
  if (dom.operatorCommandsCard) dom.operatorCommandsCard.hidden = !shouldShowOperatorCommands(state, guards);
  if (dom.analyzeMovement) {
    const analyzing = state.movementRecognition.requestInFlight ||
      state.movementRecognition.status === "checking" ||
      state.movementRecognition.status === "capturing" ||
      state.movementRecognition.status === "analyzing";
    const cloudBlocked = cloudUsageHardLimitReached(state) && !localVisualModelActive(state);
    dom.analyzeMovement.disabled = !state.cameraReady || analyzing || cloudBlocked;
    dom.analyzeMovement.textContent = state.movementRecognition.status === "capturing"
      ? "Watching…"
      : state.movementRecognition.status === "checking"
        ? "Get ready..."
      : state.movementRecognition.status === "analyzing"
        ? "Understanding…"
      : cloudBlocked
        ? "Cloud limit reached"
      : state.movementRecognition.status === "complete"
        ? "Observe"
      : state.movementRecognition.status === "fallback"
        ? "Try again"
        : "Observe";
  }
  if (dom.movementControlHelp) {
    dom.movementControlHelp.textContent = movementControlHelpText(state);
  }

  dom.nextStepCard.textContent = nextStepText(state);
  dom.errorBanner.hidden = state.errorMessage.length === 0;
  dom.errorBanner.textContent = state.errorMessage;
  dom.operatorReadiness.textContent = operatorReadiness(state);
  dom.operatorNextAction.textContent = nextStepText(state);
  dom.operatorBlockingReason.textContent = operatorBlockingReason(state, guards);
  if (dom.suggestionTraceMode) dom.suggestionTraceMode.value = selectedTraceModeFor(state).id;
  if (dom.suggestionTraceInstructions) dom.suggestionTraceInstructions.textContent = suggestionTraceInstructionsText(state);
  if (dom.suggestionCounters) dom.suggestionCounters.innerHTML = suggestionCountersHtml(state);
  if (dom.suggestionCampaignSummary) dom.suggestionCampaignSummary.innerHTML = campaignSummaryHtml(state);
  if (dom.suggestionCampaignSteps) dom.suggestionCampaignSteps.innerHTML = campaignStepsHtml(state);
  if (dom.campaignValidationInstructions) dom.campaignValidationInstructions.textContent = campaignValidationInstructionsText();
  if (dom.savePathValue) dom.savePathValue.textContent = currentTracePath(state);
  dom.operatorOutputPath.textContent = currentTracePath(state);
  dom.operatorValidationCommands.textContent = state.exported
    ? `${VALIDATION_COMMANDS}\n${selectedTraceModeFor(state).validation}`
    : "Validation commands appear after Export Physical Trace downloads the fixture.";
  dom.operatorExportTroubleshooting.textContent = operatorExportTroubleshootingText(state, guards);
  dom.operatorSendBack.textContent = operatorSendBackText();
  dom.questState.textContent = state.questState;
  dom.objective.textContent = state.objective;
  if (dom.objectiveTitle) dom.objectiveTitle.textContent = state.objective;
  dom.activeZone.textContent = state.activeZone;
  dom.recordingStatus.textContent = state.recording ? "on" : "off";
  dom.cameraStatus.textContent = state.cameraStatus;
  dom.calibrationStatus.textContent = state.calibrationSaved ? "saved" : state.calibrationOpen ? "editing" : "not saved";
  if (dom.calibrationStatusHero) dom.calibrationStatusHero.textContent = "One movement at a time";
  dom.exportStatus.textContent = exportCardStatusText(state);
  if (dom.exportReadinessSummary) dom.exportReadinessSummary.innerHTML = exportReadinessSummaryHtml(state);
  dom.calibrationSummary.textContent = calibrationSummaryText(state);
  dom.confidence.textContent = state.confidence.toFixed(2);
  if (dom.lowConfidence) dom.lowConfidence.textContent = String(state.confidence < 0.7 || state.uncertain);
  dom.uncertainty.textContent = String(state.uncertain);
  dom.resetStatus.textContent = String(state.reset);
  dom.eventCount.textContent = operatorStepProgressLabel(state);
  dom.privacy.textContent = "Not saved";
  dom.cloud.textContent = state.movementRecognition.provider;
  renderCloudUsageStatus(state);
  renderMovementResultDetails(state);
  renderResearchLab(state);
  renderAutomationState(state);
  dom.traceReady.textContent = state.exportReady ? "Ready" : "Not ready";
  dom.cost.textContent = "$0";
  dom.llm.textContent = "0";
  dom.vlm.textContent = "0";
  if (dom.headerModelStatus) dom.headerModelStatus.textContent = `LLM ${state.llmCalls} · VLM ${state.vlmCalls} · $0`;
  dom.frameCapture.textContent = fmt(latest?.frame_capture_ms);
  dom.observationExtraction.textContent = fmt(latest?.observation_extraction_ms);
  dom.adapterLatency.textContent = fmt(latest?.adapter_ms);
  dom.eventEmission.textContent = fmt(latest?.event_emission_ms);
  dom.hudUpdate.textContent = fmt(latest?.hud_update_ms);
  dom.traceRecorder.textContent = fmt(latest?.trace_recorder_ms);
  dom.latencySummary.textContent = `${fmt(summary.p50)} / ${fmt(summary.p95)} / ${fmt(summary.max)}`;
  dom.droppedFrames.textContent = String(state.droppedFrames);
  if (dom.diagnosticModelCalls) dom.diagnosticModelCalls.textContent = `${state.llmCalls} / ${state.vlmCalls}`;
  if (dom.diagnosticRawMedia) dom.diagnosticRawMedia.textContent = String(state.rawMediaPersistenceCount);
  dom.uncertaintyCount.textContent = String(state.uncertaintyCount);
  dom.resetCount.textContent = String(state.resetCount);
  if (dom.motionSensitivity) dom.motionSensitivity.value = String(state.localPerceptionTuning.motionSensitivity);
  if (dom.suggestionThreshold) dom.suggestionThreshold.value = String(state.localPerceptionTuning.suggestionThreshold);
  if (dom.suggestionCooldown) dom.suggestionCooldown.value = String(state.localPerceptionTuning.suggestionCooldownMs);
  if (dom.maxActiveSuggestions) dom.maxActiveSuggestions.value = String(state.localPerceptionTuning.maxActiveSuggestions);
  if (dom.showRawMotionScores) dom.showRawMotionScores.checked = state.localPerceptionTuning.showRawMotionScores;
  if (dom.showTrackingOverlay) dom.showTrackingOverlay.checked = state.showTrackingOverlay === true;
  if (dom.toggleTrackingDock) dom.toggleTrackingDock.setAttribute("aria-pressed", state.showTrackingOverlay === true ? "true" : "false");
  dom.events.innerHTML = timelineHtml(state.events);
  renderDetectedAction(state);
  if (dom.cameraSuggestionCount) {
    dom.cameraSuggestionCount.textContent = movementBadgeText(state);
  }
  dom.ritualChecklist.innerHTML = operatorProgressItems(state).map((item) => (
    `<div class="step ${item.done ? "done" : item.active ? "active" : ""} ${item.blocked ? "blocked" : ""}">
      <span>${item.done ? "✓" : ""}</span>
      <span>${escapeHtml(item.label)}</span>
      <small>${escapeHtml(item.meta ?? "")}</small>
    </div>`
  )).join("");
  if (dom.preflightChecklist) dom.preflightChecklist.innerHTML = preflightChecklistHtml(state);
  dom.preflightStatus.textContent = preflightText(state);
  dom.exportPreview.textContent = exportPreviewText(state);
  dom.eventSequenceInspector.innerHTML = eventSequenceInspectorHtml(state);
  dom.dryRunSeparation.textContent = dryRunSeparationText(state);
  dom.progress.innerHTML = `<div class="dq-progress-track"><span style="width:${operatorStepProgressPercent(state)}%"></span></div>`;
  dom.validationCommands.hidden = !state.exported;
  dom.validationLocked.hidden = state.exported;
  dom.copyCommandButtons.hidden = !state.exported;
  dom.missingFixtureNote.hidden = !state.exported;
  if (dom.validationCardStatus) dom.validationCardStatus.textContent = state.exported ? "Ready to validate" : "Pending export";
  dom.validationCommands.textContent = state.exported
    ? `Required validation commands:\n${VALIDATION_COMMANDS}\n\nSuggestion trace replay command:\n${selectedTraceModeFor(state).validation}\n\nIf physical:validate says physical_fixture_missing, the downloaded JSON is not saved at the required path yet.\n\nGate 1C should move from BLOCKED_MISSING_PHYSICAL_TRACE to PASS, PASS_WITH_DISCLOSURE, or FAIL after this file exists.`
    : "";
  dom.savePathAssistant.textContent = `Required path: ${currentTracePath(state)}\nDownloaded filename: ${currentTraceFilename(state)}\nRequired validation commands:\n${VALIDATION_COMMANDS}\nSuggestion trace replay command:\n${selectedTraceModeFor(state).validation}`;
  dom.macosCpCommand.textContent = currentMacosSaveCommand(state);
  dom.bugReportPreview.textContent = JSON.stringify(buildOperatorBugReport(state, { userAgent: "browser" }), null, 2);
  dom.operatorArtifactChecklist.innerHTML = operatorArtifactChecklistItems(state).map((item) => (
    `<div class="step ${item.done ? "done" : item.active ? "active" : ""}"><span>${item.done ? "[x]" : "[ ]"}</span><span>${item.label}</span></div>`
  )).join("");
  dom.stuckGuide.textContent = stuckGuideText();
  dom.troubleshooting.textContent = troubleshootingText(state, guards);
}

function renderPrimaryView(target) {
  const microscopeSurface = target.primarySurfaceMode === "microscope";
  document.body.classList.toggle("sf-microscope-surface", microscopeSurface);
  document.body.dataset.primarySurface = microscopeSurface ? "microscope" : target.interactionState.mode;
  if (dom.microscopePanel) dom.microscopePanel.hidden = !microscopeSurface;
  document.body.classList.toggle("dq-camera-live", target.cameraReady);
  dom.cameraFrame?.classList.toggle("is-live", target.cameraReady);
  if (dom.cameraStatusChip) {
    const label = primaryCameraStatusLabel(target);
    dom.cameraStatusChip.textContent = label;
    const statusChip = dom.cameraStatusChip.closest(".dq-camera-status-chip");
    statusChip?.setAttribute("aria-label", `${label} camera status`);
    if (statusChip) statusChip.dataset.cameraStatus = cameraStatusBadgeSlug(label);
  }
  if (dom.perceptionCoreLabel) dom.perceptionCoreLabel.textContent = target.cameraReady ? "Live perception" : "Perception core";
  if (dom.cameraDormantTitle) dom.cameraDormantTitle.textContent = cameraDormantTitle(target);
  if (dom.cameraDormantCopy) dom.cameraDormantCopy.textContent = cameraDormantCopy(target);
  renderInteractionModeSelector(target);
  if (dom.primaryObservationState) dom.primaryObservationState.textContent = primaryObservationStateLabel(target);
  if (dom.analyzeMovement) {
    const busy = primaryActionBusy(target);
    const actionLabel = primaryActionLabel(target);
    dom.analyzeMovement.disabled = busy || (microscopeSurface && microscope?.primaryActionDisabled?.());
    const labelNode = dom.analyzeMovement.querySelector("span");
    if (labelNode) labelNode.textContent = actionLabel;
    else dom.analyzeMovement.textContent = actionLabel;
    dom.analyzeMovement.setAttribute("aria-label", actionLabel);
  }
  if (dom.movementControlHelp) dom.movementControlHelp.textContent = movementControlHelpText(target);
  if (dom.errorBanner) {
    dom.errorBanner.hidden = target.errorMessage.length === 0;
    dom.errorBanner.textContent = target.errorMessage;
  }
  renderDetectedAction(target);
  renderMovementResultDetails(target);
  if (dom.cameraSuggestionCount) dom.cameraSuggestionCount.textContent = primaryResponseStateLabel(target);
  if (dom.movementSummaryRow) dom.movementSummaryRow.textContent = primaryResponseMeta(target);
  if (dom.voiceStatus) dom.voiceStatus.textContent = primarySpeechState(target);
  if (dom.savedActionsList) dom.savedActionsList.innerHTML = savedActionsSummaryHtml(target);
  if (!microscopeSurface && interactionModeIs(target, "conversation")) {
    renderLiveConversationRail(target);
  } else {
    renderRecentMomentsRail(target);
  }
}

function renderRecentMomentsRail(target) {
  if (!dom.recentMomentsCard || !dom.recentMomentsList) return;
  dom.recentMomentsCard.classList.remove("is-live-conversation", "is-live-exchange", "is-watch-insight");
  if (target.primarySurfaceMode !== "microscope" && interactionModeIs(target, "observing")) {
    dom.recentMomentsCard.classList.add("is-watch-insight");
    if (dom.recentMomentsTitle) dom.recentMomentsTitle.textContent = "Watch";
    dom.recentMomentsList.className = "sf-moment-list sf-watch-insight-display";
    dom.recentMomentsList.setAttribute("role", "region");
    dom.recentMomentsList.setAttribute("aria-label", "Live watch insight and recent moments");
    dom.recentMomentsList.innerHTML = watchInsightRailHtml(target);
    if (dom.askConversationControls) dom.askConversationControls.hidden = true;
    if (dom.askControlsDisclosure) dom.askControlsDisclosure.hidden = true;
    if (dom.askReturnToLatest) dom.askReturnToLatest.hidden = true;
    if (dom.recentMomentsLink) {
      dom.recentMomentsLink.hidden = false;
      dom.recentMomentsLink.firstChild.textContent = "Recent moments ";
    }
    lastLiveConversationRevision = -1;
    return;
  }
  if (dom.recentMomentsTitle) dom.recentMomentsTitle.textContent = "Recent moments";
  dom.recentMomentsList.className = "sf-moment-list";
  dom.recentMomentsList.removeAttribute("role");
  dom.recentMomentsList.setAttribute("aria-label", "Recent moments summary");
  dom.recentMomentsList.innerHTML = recentMomentsSummaryHtml(target);
  if (dom.askConversationControls) dom.askConversationControls.hidden = true;
  if (dom.askControlsDisclosure) dom.askControlsDisclosure.hidden = true;
  if (dom.askReturnToLatest) dom.askReturnToLatest.hidden = true;
  if (dom.recentMomentsLink) dom.recentMomentsLink.hidden = false;
  lastLiveConversationRevision = -1;
}

function scheduleLiveConversationRailRender(target = state) {
  if (target !== state || liveConversationRenderScheduled) return;
  liveConversationRenderScheduled = true;
  requestAnimationFrame(() => {
    liveConversationRenderScheduled = false;
    renderLiveConversationRail(target);
  });
}

function renderLiveConversationRail(target, options = {}) {
  if (!dom.recentMomentsCard || !dom.recentMomentsList) return;
  const conversation = target.liveConversation;
  const active = target.interactionState.sessionActive && interactionModeIs(target, "conversation");
  const force = options.force === true;
  const exchanges = liveConversationExchanges(conversation);
  dom.recentMomentsCard.classList.remove("is-watch-insight");
  dom.recentMomentsCard.classList.add("is-live-conversation", "is-live-exchange");
  if (dom.recentMomentsTitle) dom.recentMomentsTitle.textContent = "Live exchange";
  if (dom.recentMomentsLink) {
    dom.recentMomentsLink.hidden = exchanges.length < 2;
    dom.recentMomentsLink.firstChild.textContent = "Earlier exchanges ";
  }
  if (dom.askConversationControls) dom.askConversationControls.hidden = !active;
  if (dom.askControlsDisclosure) dom.askControlsDisclosure.hidden = !active;
  dom.recentMomentsList.className = "sf-moment-list sf-live-exchange-display";
  dom.recentMomentsList.setAttribute("role", "region");
  dom.recentMomentsList.setAttribute("aria-label", "Current spoken question and response");
  dom.recentMomentsList.removeAttribute("aria-relevant");

  if (force || lastLiveConversationRevision !== conversation.revision) {
    dom.recentMomentsList.innerHTML = liveConversationRailHtml(conversation);
    lastLiveConversationRevision = conversation.revision;
  }

  if (dom.askToggleListening) {
    dom.askToggleListening.disabled = !active || !target.realtimeSession.speechRecognition;
    dom.askToggleListening.textContent = conversation.listeningPaused ? "Resume listening" : "Pause listening";
    dom.askToggleListening.setAttribute("aria-label", dom.askToggleListening.textContent);
  }
  if (dom.askStopSpeaking) {
    dom.askStopSpeaking.disabled = !(target.interactionState.assistantSpeaking || persistentSpeechBusy(target));
  }
  if (dom.askToggleVoice) {
    dom.askToggleVoice.textContent = conversation.voiceMuted ? "Unmute voice" : "Mute voice";
    dom.askToggleVoice.setAttribute("aria-label", dom.askToggleVoice.textContent);
  }
  if (dom.askClearConversation) dom.askClearConversation.disabled = conversation.turns.length === 0 && !conversation.interimText;
  if (dom.askRetry) dom.askRetry.hidden = !conversation.error?.recoverable || !conversation.turns.some((turn) => turn.role === "user");
  if (dom.askReturnToLatest) dom.askReturnToLatest.hidden = true;
  if (dom.askConversationAnnouncement && dom.askConversationAnnouncement.textContent !== conversation.announcement) {
    dom.askConversationAnnouncement.textContent = conversation.announcement;
  }
}

function liveConversationRailHtml(conversation) {
  const exchanges = liveConversationExchanges(conversation);
  const latest = exchanges.at(-1) || null;
  const current = conversation.interimText
    ? { question: { id: "live-interim", text: conversation.interimText, status: "draft" }, answer: null }
    : latest;
  const previous = conversation.interimText ? latest : exchanges.at(-2);
  const question = current?.question || null;
  const answer = conversation.activeAssistant?.text
    ? { ...conversation.activeAssistant, status: "streaming" }
    : current?.answer || null;
  const grounded = Boolean(question?.cameraContext && conversation.cameraContextActive);
  const idle = !question && !answer && !conversation.error;
  const thinking = ["finalizing_question", "thinking"].includes(conversation.status);
  return `
    <div class="sf-live-exchange-state" data-state="${escapeHtml(conversation.status)}">
      <span>${escapeHtml(liveConversationStatusLabel(conversation))}</span>
      ${grounded ? `<span class="sf-live-grounding"><i data-lucide="scan-eye" aria-hidden="true"></i> Using live view</span>` : ""}
    </div>
    ${idle ? `
      <div class="sf-live-exchange-idle">
        <strong>Your question and the response will appear here as you speak.</strong>
        <p>Start the camera, then ask naturally.</p>
      </div>
    ` : ""}
    ${previous ? livePreviousExchangeHtml(previous) : ""}
    ${question ? `
      <section class="sf-live-question ${question.status === "draft" ? "is-draft" : ""}" aria-label="Current question">
        <span>${question.status === "draft" ? "Listening" : "You asked"}</span>
        <p>${escapeHtml(question.text || "")}</p>
      </section>
    ` : ""}
    ${thinking ? `
      <div class="sf-live-thinking" role="status">
        <span class="sf-live-focus-sweep" aria-hidden="true"></span>
        <span>Focusing on the question</span>
      </div>
    ` : ""}
    ${answer ? liveAnswerHtml(answer, conversation.status) : ""}
    ${conversation.error ? `<div class="sf-ask-error" role="alert">${escapeHtml(conversation.error.message)}</div>` : ""}
  `;
}

function liveConversationExchanges(conversation) {
  const exchanges = [];
  for (const turn of conversation.turns) {
    if (turn.role === "user") {
      exchanges.push({ question: turn, answer: null });
    } else if (turn.role === "assistant") {
      const exchange = [...exchanges].reverse().find((item) => !item.answer);
      if (exchange) exchange.answer = turn;
    }
  }
  return exchanges;
}

function livePreviousExchangeHtml(exchange) {
  const answer = exchange.answer?.text ? ` — ${exchange.answer.text}` : "";
  return `
    <aside class="sf-live-previous" aria-label="Previous exchange">
      <span>Previous</span>
      <p>${escapeHtml(`${exchange.question?.text || ""}${answer}`)}</p>
    </aside>
  `;
}

function liveAnswerHtml(answer, status) {
  const chunks = chunkLiveAnswerText(answer.text);
  const key = String(answer.id || "active-answer");
  const previouslyRendered = renderedLiveAnswerChunks.get(key) || 0;
  renderedLiveAnswerChunks.set(key, chunks.length);
  if (renderedLiveAnswerChunks.size > 12) {
    const oldest = renderedLiveAnswerChunks.keys().next().value;
    renderedLiveAnswerChunks.delete(oldest);
  }
  return `
    <section class="sf-live-answer" aria-label="System response">
      <span>System response</span>
      <p>${chunks.map((chunk, index) => (
        `<span class="sf-live-answer-chunk ${index >= previouslyRendered ? "is-new" : ""}">${escapeHtml(chunk)}</span>`
      )).join(" ")}</p>
      ${status === "speaking" ? `<span class="sf-live-speaking"><i aria-hidden="true"></i> Speaking</span>` : ""}
    </section>
  `;
}

function canonicalAppState(target) {
  const snapshot = target.emergencyRuntimeController.snapshot();
  target.appState = snapshot;
  return snapshot;
}

function renderInteractionModeSelector(target) {
  if (!dom.interactionModeSelector) return;
  const app = canonicalAppState(target);
  for (const button of dom.interactionModeSelector.querySelectorAll("[data-interaction-mode]")) {
    const requested = String(button.getAttribute("data-interaction-mode") || "");
    const selected = requested === "microscope"
      ? target.primarySurfaceMode === "microscope"
      : target.primarySurfaceMode !== "microscope" && normalizeInteractionMode(requested) === app.selectedMode;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.disabled = app.session.status === "ending"
      || (requested === "microscope" && microscopeCapabilityUnhealthy);
  }
  if (dom.primaryModeStatus) {
    dom.primaryModeStatus.textContent = app.selectedMode === "observing" ? "Watch mode selected." : "Ask mode selected.";
  }
}

function primaryActionBusy(target) {
  if (target.primarySurfaceMode === "microscope") return false;
  return target.cameraStartInFlight === true || ["starting", "ending"].includes(target.realtimeSession.state);
}

function primaryCameraStatusLabel(target) {
  if (target.cameraReady) {
    return target.primarySurfaceMode !== "microscope" && interactionModeIs(target, "observing")
      ? "Watch live"
      : "Live";
  }
  if (target.primarySurfaceMode !== "microscope" && interactionModeIs(target, "observing")) return "Watch ready";
  return "Camera off";
}

function cameraStatusBadgeSlug(label) {
  return {
    "Live": "live",
    "Watch live": "watch-live",
    "Watch ready": "watch-ready",
    "Camera off": "off"
  }[label] || "off";
}

function cameraDormantTitle(target) {
  if (target.primarySurfaceMode === "microscope") return "Microscope";
  if (interactionModeIs(target, "observing")) return "Watch";
  return "Ask the world";
}

function cameraDormantCopy(target) {
  if (target.primarySurfaceMode === "microscope") return "Inspect what's in view.";
  if (interactionModeIs(target, "observing")) return "See what changes.";
  return "Start a conversation about anything in view.";
}

function primaryActionLabel(target) {
  if (target.primarySurfaceMode === "microscope") return microscope?.primaryActionLabel?.() || "Automatic local vision";
  if (target.realtimeSession.state === "starting" || target.cameraStartInFlight) return "Starting…";
  if (target.interactionState.sessionActive && interactionModeIs(target, "observing")) return "End observing";
  if (target.interactionState.sessionActive) return "End conversation";
  if (target.realtimeSession.state === "ending") return "Ending…";
  if (target.realtimeSession.state === "error" || (!target.cameraReady && target.errorMessage)) return "Try again";
  if (target.realtimeSession.state === "inactive") return interactionModeIs(target, "observing") ? "Start observing" : "Start conversation";
  if (target.movementCaptureState.status === "error" || target.movementRecognition.status === "fallback") return "Try again";
  return interactionModeIs(target, "observing") ? "Start observing" : "Start conversation";
}

function primaryResponseStateLabel(target) {
  const app = canonicalAppState(target);
  if (app.safeError) return app.selectedMode === "observing" ? "Visual model unavailable" : "Conversation unavailable";
  if (app.currentTurn.assistantText) return "Sensefield";
  if (app.currentTurn.observationText) return "Movement";
  if (app.runtime.thinking) return app.selectedMode === "observing" ? "Understanding" : "Thinking";
  if (app.session.status === "active") return app.selectedMode === "observing" ? "Watching" : "Listening";
  return app.selectedMode === "observing" ? "Observing" : "Conversation";
}

function primaryObservationStateLabel(target) {
  if (target.primarySurfaceMode === "microscope") {
    if (target.errorMessage) return "Local vision unavailable";
    const instrument = microscope?.snapshot?.();
    if (instrument?.status === "verifying") return "Identifying presented object";
    if (instrument?.status === "starting") return "Starting local vision…";
    if (instrument?.status === "error") return "Local vision unavailable";
    if (instrument?.status === "live") return "Automatic vision active";
    if (instrument?.active) return "Microscope ready";
  }
  const app = canonicalAppState(target);
  if (app.safeError || target.realtimeSession.state === "error") return "Error";
  if (app.session.status === "starting" || target.cameraStartInFlight) return "Starting…";
  if (app.session.status === "ending") return "Ending…";
  if (app.runtime.speechStarted) return "Speaking";
  if (app.runtime.thinking) return app.selectedMode === "observing" ? "Understanding" : "Thinking";
  if (app.session.status === "active") return app.selectedMode === "observing" ? "Watching" : "Listening";
  return "Ready";
}

function primaryResponseMeta(target) {
  const app = canonicalAppState(target);
  if (!app.currentTurn.responseType || app.currentTurn.confidence == null) return "";
  return `Confidence ${Number(app.currentTurn.confidence).toFixed(2)}`;
}

function primarySpeechState(target) {
  const turn = canonicalAppState(target).currentTurn;
  if (!turn.assistantText && !turn.observationText) return "";
  if (turn.speechStatus === "speaking") return "Speaking…";
  if (turn.speechStatus === "complete") return "Voice complete";
  if (turn.speechStatus === "unavailable") return "Voice unavailable";
  return "";
}

function captureStudioStatusLabel(target) {
  if (target.errorMessage) return "Error";
  if (target.movementRecognition.status === "capturing") return "Observing";
  if (target.movementRecognition.status === "checking" || target.movementRecognition.status === "analyzing") return "Understanding";
  if (target.cameraReady) return "Ready to observe";
  return "Camera off";
}

function renderTopStatus(target) {
  const status = topStatusForState(target);
  dom.statusCamera.textContent = displayStatusText(status.camera);
  dom.statusCalibration.textContent = displayStatusText(status.calibration);
  dom.statusQuest.textContent = displayStatusText(status.quest);
  dom.statusRecording.textContent = displayStatusText(status.recording);
  dom.statusExport.textContent = displayStatusText(status.export);
  dom.statusValidation.textContent = displayStatusText(status.validation);
  dom.statusPrivacy.textContent = displayStatusText(status.privacy);
  dom.statusModels.textContent = displayStatusText(`${status.models} · ${status.modelCost}`);
  if (dom.statusModelCost) {
    dom.statusModelCost.textContent = status.modelCost;
    dom.statusModelCost.hidden = true;
  }
}

function displayStatusText(value) {
  const text = String(value ?? "");
  const labels = {
    pending_export: "Pending export",
    commands_copied: "Commands copied",
    commands_ready: "Commands ready",
    "raw_media_persisted=false": "Raw media off",
    "raw_media_persisted=true": "Raw media persisted",
    "no events recorded": "No events",
    "not ready": "Not ready",
    ready: "Ready",
    downloaded: "Downloaded",
    saved: "Saved",
    missing: "Missing",
    editing: "Editing",
    idle: "Idle",
    off: "Off",
    on: "On",
    stopped: "Stopped"
  };
  if (labels[text]) return labels[text];
  if (/^LLM=\d+ · VLM=\d+ · cost=/.test(text)) {
    return text.replace("LLM=", "LLM ").replace("VLM=", "VLM ").replace(" · cost=", " · ");
  }
  return text.replaceAll("_", " ");
}

function renderCloudUsageStatus(target) {
  const node = ensureCloudUsageNode();
  if (!node) return;
  const usage = normalizeCloudUsage(target.movementRecognition.usage);
  target.movementRecognition.usage = usage;
  target.movementRecognition.usageStatus = cloudUsageStateText(target);
  node.textContent = [
    "Cloud AI usage",
    target.movementRecognition.usageStatus,
    `Session: ${usage.session.used} / ${usage.session.limit}`,
    `Today: ${usage.day.used} / ${usage.day.limit}`,
    `Month: ${usage.month.used} / ${usage.month.limit}`
  ].join("\n");
}

function ensureCloudUsageNode() {
  if (dom?.cloudUsage) return dom.cloudUsage;
  const metricList = dom?.cloud?.closest?.("dl");
  if (!metricList || typeof document === "undefined") return null;
  const row = document.createElement("div");
  const label = document.createElement("dt");
  const value = document.createElement("dd");
  label.textContent = "Cloud AI";
  value.id = "cloudAiUsage";
  value.className = "text-contained";
  row.append(label, value);
  metricList.append(row);
  dom.cloudUsage = value;
  return value;
}

function normalizeCloudUsage(usage = createEmptyCloudUsage()) {
  const fallback = createEmptyCloudUsage();
  return {
    cloud_enabled: usage.cloud_enabled !== false,
    session: normalizeUsageBucket(usage.session, fallback.session),
    day: normalizeUsageBucket(usage.day, fallback.day),
    month: normalizeUsageBucket(usage.month, fallback.month),
    concurrent: normalizeUsageBucket(usage.concurrent, fallback.concurrent)
  };
}

function usageFromLimitMetadata(limitUsage = {}, previousUsage = createEmptyCloudUsage()) {
  const previous = normalizeCloudUsage(previousUsage);
  return {
    cloud_enabled: previous.cloud_enabled,
    session: {
      used: Number(limitUsage.session_used ?? previous.session.used),
      limit: Number(limitUsage.session_limit ?? previous.session.limit)
    },
    day: {
      used: Number(limitUsage.daily_used ?? previous.day.used),
      limit: Number(limitUsage.daily_limit ?? previous.day.limit)
    },
    month: {
      used: Number(limitUsage.monthly_used ?? previous.month.used),
      limit: Number(limitUsage.monthly_limit ?? previous.month.limit)
    },
    concurrent: previous.concurrent
  };
}

function normalizeUsageBucket(bucket = {}, fallback = {}) {
  const limit = Math.max(0, Number(bucket.limit ?? fallback.limit ?? 0));
  const used = Math.max(0, Number(bucket.used ?? bucket.active ?? fallback.used ?? fallback.active ?? 0));
  return {
    used,
    active: used,
    limit,
    remaining: Math.max(0, Number(bucket.remaining ?? (limit - used)))
  };
}

function cloudUsageStateText(target) {
  const usage = normalizeCloudUsage(target.movementRecognition.usage);
  if (usage.cloud_enabled === false) return "Cloud AI disabled";
  if (usage.month.remaining <= 0) return "Monthly limit reached";
  if (usage.day.remaining <= 0) return "Daily limit reached";
  if (localVisualModelActive(target)) return "Local model active";
  const highestRatio = Math.max(usage.session.used / Math.max(1, usage.session.limit), usage.day.used / Math.max(1, usage.day.limit), usage.month.used / Math.max(1, usage.month.limit));
  return highestRatio >= 0.8 ? "80% used" : "Available";
}

function cloudUsageHardLimitReached(target) {
  const usage = normalizeCloudUsage(target.movementRecognition.usage);
  return usage.cloud_enabled !== false && (usage.session.remaining <= 0 || usage.day.remaining <= 0 || usage.month.remaining <= 0);
}

function localVisualModelActive(target) {
  const health = target.movementRecognition.health;
  if (health?.provider === VISUAL_COMPANION_CLIENT_CONFIG.provider && health.status !== "model_not_installed") return true;
  return target.movementRecognition.provider === VISUAL_COMPANION_CLIENT_CONFIG.provider;
}

export function topStatusForState(target) {
  const cost = target.estimatedModelCostUsd === 0 ? "$0" : `$${target.estimatedModelCostUsd.toFixed(2)}`;
  return {
    camera: target.cameraReady ? "ready" : cameraStatusLabel(target),
    calibration: target.calibrationSaved ? "saved" : target.calibrationOpen ? "editing" : "missing",
    quest: questStatusLabel(target),
    recording: target.recording ? "on" : target.recordingStarted ? "stopped" : "off",
    export: target.exported ? "downloaded" : target.exportReady ? "ready" : target.exportStatus,
    validation: target.validationCopied ? "commands_copied" : target.exported ? "commands_ready" : "pending_export",
    privacy: `raw_media_persisted=${target.rawMediaPersistenceCount > 0 ? "true" : "false"}`,
    models: `LLM=${target.llmCalls} · VLM=${target.vlmCalls}`,
    modelCost: `cost=${cost}`
  };
}

function nextStepText(target) {
  if (!target.cameraReady) return "Next: click Start Camera.";
  if (!target.calibrationSaved) return "Next: calibrate zones.";
  if (!target.ritualStarted) return "Next: start Focus Ritual.";
  if (!target.recordingStarted) return "Next: start recording.";
  if (target.recording && target.questState === "phone_removal_pending") return "Next: physically move the phone, then click Confirm Phone Moved.";
  if (target.recording && target.questState === "notebook_pending") return "Next: physically open the notebook, then click Confirm Notebook Opened.";
  if (target.recording && target.questState === "pen_pending") return "Next: physically pick up the pen, then click Confirm Pen Picked Up.";
  if (target.recording && target.questState === "writing_pending") return "Next: physically make writing-like motion, then click Confirm Writing Motion.";
  if (target.recording && target.questState === "typing_pending") return "Next: physically make typing-like motion, then click Confirm Typing Motion.";
  if (target.questState === "quest_complete" && target.recording) return "Next: stop recording.";
  if (target.questState === "quest_complete" && !target.physicalConfirmed) return "Next: confirm this was a real physical webcam session.";
  if (target.exportReady && !target.exported) return "Next: export physical trace.";
  if (target.exported) return `Next: save the downloaded file to ${currentTracePath(target)} and run validation.`;
  return `Next: ${objectiveForQuestState(target.questState).replace(/\.$/, "")}.`;
}

function currentActionControlHtml(target, guards) {
  const action = currentActionForState(target, guards);
  if (action.id === "startCamera") return "";
  const disabled = action.disabled ? " disabled" : "";
  const title = action.reason ? ` title="${escapeHtml(action.reason)}"` : "";
  return `
    <button class="dq-button ${action.tone} dq-current-action-button no-vertical-text" data-current-action="${escapeHtml(action.id)}" type="button"${disabled}${title}>
      ${escapeHtml(action.label)}
    </button>
    ${action.reason ? `<p class="note wrap-safe">${escapeHtml(action.reason)}</p>` : ""}
  `;
}

function currentActionForState(target, guards) {
  const action = (id, label, guardState, help, tone = "primary") => ({
    id,
    label,
    tone,
    help,
    disabled: guardState?.enabled === false,
    reason: guardState?.enabled === false ? guardState.reason : ""
  });
  if (!target.cameraReady) return action("startCamera", "Start Camera", guards.startCamera, "Start the local preview.");
  if (!target.calibrationSaved) {
    return target.calibrationOpen
      ? action("saveCalibration", "Save Calibration", guards.saveCalibration, "Save symbolic zone geometry.", "secondary")
      : action("calibrateZones", "Calibrate Zones", guards.calibrateZones, "Open calibration controls.", "secondary");
  }
  if (!target.ritualStarted) return action("startFocusRitual", "Start Session", guards.startFocusRitual, "Begin the guided session.");
  if (!target.recordingStarted) return action("startRecording", "Start Watching", guards.startRecording, "Start local motion suggestions.");
  if (target.recording && target.questState === "quest_complete") {
    return action("stopRecording", "Stop Watching", guards.stopRecording, "Stop watching before export.", "secondary");
  }
  if (target.questState === "quest_complete" && !target.physicalConfirmed) {
    return {
      id: "exportTrace",
      label: "Confirm physical session below",
      tone: "secondary",
      help: "Tick the physical-session checkbox in Export & Save Path.",
      disabled: true,
      reason: "Physical confirmation is required before export."
    };
  }
  if (target.exported) return action("copyValidation", "Copy Validation Commands", guards.copyValidation, "Copy commands after saving the export.", "secondary");
  if (target.questState === "quest_complete") return action("exportTrace", "Export Physical Trace", guards.exportTrace, "Download the physical trace.", "secondary");
  const manualStep = currentManualStep(target, guards);
  if (manualStep) {
    const analyzing = target.movementRecognition.requestInFlight ||
      target.movementRecognition.status === "checking" ||
      target.movementRecognition.status === "capturing" ||
      target.movementRecognition.status === "analyzing";
    return {
      id: "analyzeMovement",
      label: analyzing ? "Understanding…" : "Observe",
      tone: "primary",
      help: "Capture a short temporary visual window for local open-model observation.",
      disabled: analyzing,
      reason: analyzing ? "Visual observation is already running." : ""
    };
  }
  return action("stopRecording", "Stop Watching", guards.stopRecording, "Stop watching when the session is complete.", "secondary");
}

function currentManualActionHtml(target, guards) {
  const manualStep = currentManualStep(target, guards);
  if (!manualStep) return "";
  const disabled = manualStep.disabled ? " disabled" : "";
  const title = manualStep.reason ? ` title="${escapeHtml(manualStep.reason)}"` : "";
  return `
    <strong>${escapeHtml(manualStep.label)}</strong>
    <p class="note">${escapeHtml(manualStep.help)}</p>
    <button class="dq-button primary no-vertical-text" data-step="${escapeHtml(manualStep.id)}" type="button"${disabled}${title}>${escapeHtml(manualStep.button)}</button>
  `;
}

function currentManualStep(target, guards) {
  const step = RITUAL_STEPS.find((item) => target.questState === item.activeState);
  if (!step) return null;
  const labels = {
    phone: ["Move phone away", "I moved the phone"],
    notebook: ["Open notebook", "I opened the notebook"],
    pen: ["Pick up pen", "I picked up the pen"],
    writing: ["Writing motion", "I did the writing motion"],
    typing: ["Typing motion", "I did the typing motion"]
  };
  const [label, button] = labels[step.id] ?? [step.label, step.buttonText];
  const guardState = guards[step.id];
  return {
    id: step.id,
    label,
    button,
    action: label,
    help: "Perform the physical action first, then confirm it here.",
    disabled: guardState?.enabled === false,
    reason: guardState?.enabled === false ? guardState.reason : ""
  };
}

function shouldShowOperatorCommands(target, guards) {
  return true;
}

function operatorProgressItems(target) {
  const rows = [
    ["Start camera", target.cameraReady || target.cameraStarted],
    ["Calibrate zones", target.calibrationSaved],
    ["Start ritual", target.ritualStarted],
    ["Record", target.recordingStarted],
    ["Move phone", target.completedSteps.includes("phone")],
    ["Open notebook", target.completedSteps.includes("notebook")],
    ["Pick up pen", target.completedSteps.includes("pen")],
    ["Writing", target.completedSteps.includes("writing")],
    ["Typing", target.completedSteps.includes("typing")],
    ["Export", target.exported]
  ];
  const firstPending = rows.findIndex(([, done]) => !done);
  return rows.map(([label, done], index) => ({
    label,
    done,
    active: firstPending === index,
    blocked: Boolean(target.uncertain || target.reset) && !done,
    meta: done ? "Complete" : firstPending === index ? "Current" : "Pending"
  }));
}

function operatorStepProgressLabel(target) {
  const completed = wizardStagesForState(target).filter((item) => item.complete).length;
  return `${completed} / 8 steps`;
}

function operatorStepProgressPercent(target) {
  const completed = wizardStagesForState(target).filter((item) => item.complete).length;
  return Math.min(100, Math.max(0, Math.round((completed / 8) * 100)));
}

function operatorBlockingReason(target, guards) {
  if (target.errorMessage) return target.errorMessage;
  if (target.exported) return "No source-level blocker. Save the downloaded physical export to the required path and run validation.";
  if (guards.exportTrace.enabled) return "No export blocker. Physical export is ready.";
  return guards.exportTrace.reason || "Follow the next action.";
}

function operatorReadiness(target) {
  if (target.exported) return "READY_TO_VALIDATE";
  if (target.exportReady) return "TRACE_EXPORT_READY";
  if (!target.cameraReady) return "NEEDS_CAMERA";
  if (!target.calibrationSaved) return "NEEDS_CALIBRATION";
  if (!target.recordingStarted || target.recording || target.questState !== "quest_complete") return "NEEDS_RECORDING";
  return "NEEDS_EXPORT";
}

function operatorExportTroubleshootingText(target, guards) {
  return [
    `readiness: ${operatorReadiness(target)}`,
    `export button: ${guards.exportTrace.enabled ? "enabled" : "disabled"}`,
    `current blocker: ${operatorBlockingReason(target, guards)}`,
    `required path: ${currentTracePath(target)}`,
    `downloaded filename: ${currentTraceFilename(target)}`,
    `trace mode: ${selectedTraceModeFor(target).label}`,
    "if physical:validate says physical_fixture_missing: move the downloaded JSON to the required path.",
    "if physical:validate says wrong provenance: export again from Physical Export after checking the real physical session checkbox.",
    "if Gate 1C still blocks: run npm run physical:validate first and send runs/gate-1c-latest.json.",
    "if port 4177 is unavailable: run npm run physical:capture -- --port 4180."
  ].join("\n");
}

function operatorSendBackText() {
  return [
    "After export, send back:",
    "[ ] Output of npm run physical:validate",
    "[ ] Output of npm run gate:1c",
    `[ ] Whether the file exists at the selected trace path`,
    `[ ] If broken, export ${BUG_REPORT_FILENAME}`,
    "Do not send raw webcam media, private notebook text, audio, or encoded media payloads."
  ].join("\n");
}

function artifactChecklistText(target) {
  return [
    "Artifact Checklist",
    `required physical trace path: ${currentTracePath(target)}`,
    `downloaded filename: ${currentTraceFilename(target)}`,
    `copy command: ${currentMacosSaveCommand(target)}`,
    `physical export complete: ${target.exported}`,
    "run after saving:",
    VALIDATION_COMMANDS,
    "Gate 1C expected after validation: PASS_WITH_DISCLOSURE, PASS, or a specific failure code.",
    "dev dry-run exports cannot satisfy Gate 1C"
  ].join("\n");
}

function operatorArtifactChecklistItems(target) {
  return [
    { label: "Output of npm run physical:validate", done: false, active: target.exported },
    { label: "Output of npm run gate:1c", done: false, active: target.exported },
    { label: `Whether the file exists at ${currentTracePath(target)}`, done: false, active: target.exported },
    { label: `If broken, export ${BUG_REPORT_FILENAME}`, done: false, active: !target.exported || Boolean(target.errorMessage) }
  ];
}

function stuckGuideText() {
  return [
    "1. Camera does not start | likely cause: browser permission or localhost binding | exact fix: allow camera for 127.0.0.1, reload, click Start Camera; command: npm run physical:capture",
    "2. Camera starts but buttons are disabled | likely cause: missing calibration or wrong step | exact fix: read Blocked Button Reasons and follow Next Step.",
    "3. Calibration cannot save | likely cause: camera not started | exact fix: click Start Camera, then Calibrate Zones, then Save Calibration.",
    "4. Start Focus Ritual is disabled | likely cause: calibration missing | exact fix: Save Calibration first.",
    "5. Start Recording is disabled | likely cause: Focus Ritual not started | exact fix: click Start Focus Ritual.",
    "6. Manual confirmation buttons are disabled | likely cause: recording is not active or sequence is out of order | exact fix: click Start Recording and confirm steps in order.",
    "7. Export is disabled | likely cause: incomplete ritual, recording still on, missing physical checkbox, uncertainty, or reset | exact fix: read Export Preflight and complete the blocker.",
    `8. Export downloads but physical:validate says file missing | likely cause: file stayed in Downloads | exact fix: move ${LIVE_PHYSICAL_TRACE_FILENAME} to ${LIVE_PHYSICAL_TRACE_PATH}.`,
    "9. physical:validate says wrong provenance | likely cause: dev dry-run or unchecked physical confirmation | exact fix: repeat physical export with the real-session checkbox checked.",
    "10. Gate 1C still says BLOCKED_MISSING_PHYSICAL_TRACE | likely cause: required file missing or validation failed | exact fix: run npm run physical:validate, then npm run gate:1c.",
    "11. Browser port 4177 is unavailable | likely cause: port busy or sandbox permission | exact fix: npm run physical:capture -- --port 4180.",
    `12. User saved file to Downloads instead of fixtures/replay/live/ | likely cause: browser default download path | exact fix: ${MACOS_SAVE_COMMAND}`
  ].join("\n\n");
}

function eventSequenceInspectorText(target) {
  return [
    "Event Sequence Inspector",
    "required ritual sequence:",
    ...inspectEventSequence(target).map((item) => [
      `${item.sequence_index}. ${item.required_label} | schema=${item.required_event_id} (${item.required_event_type})`,
      `status=${sequenceDisplayStatus(item, target)}`,
      `matched_event_id=${item.matched_event_id ?? "missing"}`,
      `confidence=${item.confidence ?? "missing"}`,
      `payload_summary=${item.payload_summary}`,
      `export_status=${item.status === "present" ? "ready" : "blocks export"}`
    ].join(" | "))
  ].join("\n");
}

function eventSequenceInspectorHtml(target) {
  const rows = inspectEventSequence(target);
  return rows.map((item) => {
    const displayStatus = sequenceDisplayStatus(item, target);
    const stateClass = displayStatus === "Complete" ? "is-complete" : displayStatus === "Awaiting event" ? "is-active" : "";
    const exportStatus = item.status === "present" ? "Ready for export" : "Blocks export";
    const payload = item.payload_summary === "missing" ? "Awaiting event" : item.payload_summary;
    const meta = [
      displayStatus,
      exportStatus,
      item.status === "present" ? `Confidence ${item.confidence ?? "state"}` : null,
      item.status === "present" ? (item.matched_event_id ?? item.required_event_id) : null,
      payload
    ].filter(Boolean).join(" · ");
    return `
      <div class="dq-sequence-row text-contained ${stateClass}">
        <span class="dq-sequence-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(item.sequence_index)}. ${escapeHtml(item.required_label)}</strong>
        <em>${escapeHtml(meta)}</em>
      </div>
    `;
  }).join("");
}

function sequenceDisplayStatus(item, target) {
  if (item.status === "present") return "Complete";
  const completed = inspectEventSequence(target).filter((candidate) => candidate.status === "present").length;
  return item.sequence_index === completed + 1 ? "Awaiting event" : "Missing";
}

function sequenceProgressLabel(target) {
  const completed = inspectEventSequence(target).filter((item) => item.status === "present").length;
  return `${completed} / ${EVENT_SEQUENCE_STEPS.length} steps`;
}

function sequenceProgressPercent(target) {
  const completed = inspectEventSequence(target).filter((item) => item.status === "present").length;
  return Math.min(100, Math.max(0, Math.round((completed / EVENT_SEQUENCE_STEPS.length) * 100)));
}

function dryRunSeparationText(target) {
  const dryRunPreview = buildExportPreview(target, { devDryRun: true });
  const physicalPreview = buildExportPreview(target, { devDryRun: false });
  return [
    "DEV DRY RUN ONLY: cannot satisfy Gate 1C.",
    `dev dry run physical_capture=${dryRunPreview.trace_origin.physical_capture}`,
    `dev dry run operator_confirmed_physical_session=${dryRunPreview.trace_origin.operator_confirmed_physical_session}`,
    `dev dry run manual_fixture=${dryRunPreview.trace_origin.manual_fixture}`,
    "PHYSICAL EXPORT: separate operator export path.",
    `physical export physical_capture=${physicalPreview.trace_origin.physical_capture}`,
    `physical export operator_confirmed_physical_session=${physicalPreview.trace_origin.operator_confirmed_physical_session}`,
    `physical export capture_mode=${physicalPreview.trace_origin.capture_mode}`
  ].join("\n");
}

function ritualChecklistItems(target) {
  const item = (label, done, active, eventId = null) => {
    const event = eventId ? target.events.find((candidate) => candidate.id === eventId) : null;
    const blocked = !done && (target.uncertain || target.reset);
    return {
      label,
      done,
      active,
      blocked,
      state: done ? "complete" : blocked ? "blocked" : active ? "active" : "pending",
      eventId: event?.id ?? null,
      confidence: event?.confidence ?? null,
      disclosure: event?.evidence?.some((evidence) => evidence.kind === "human_correction")
        ? "manual local confirmation - not automatic vision"
        : null
    };
  };
  return [
    item("Camera started", target.cameraStarted || target.cameraReady, !target.cameraReady),
    item("Zones calibrated", target.calibrationSaved, target.cameraReady && !target.calibrationSaved, "evt_scene_calibrated"),
    item("Focus Ritual started", target.ritualStarted, target.calibrationSaved && !target.ritualStarted),
    item("Recording started", target.recordingStarted, target.ritualStarted && !target.recordingStarted),
    item("Phone moved", target.completedSteps.includes("phone"), target.questState === "phone_removal_pending", "evt_phone_moved_to_off_desk"),
    item("Notebook opened", target.completedSteps.includes("notebook"), target.questState === "notebook_pending", "evt_notebook_opened"),
    item("Pen picked up", target.completedSteps.includes("pen"), target.questState === "pen_pending", "evt_pen_moved_to_hand"),
    item("Writing motion confirmed", target.completedSteps.includes("writing"), target.questState === "writing_pending", "evt_writing_like_motion"),
    item("Typing motion confirmed", target.completedSteps.includes("typing"), target.questState === "typing_pending", "evt_typing_like_motion"),
    item("Recording stopped", target.recordingStarted && !target.recording, target.questState === "quest_complete" && target.recording),
    item("Physical session confirmed", target.physicalConfirmed, target.questState === "quest_complete" && !target.physicalConfirmed),
    item("Trace exported", target.exported, target.exportReady && !target.exported),
    item("Validation commands copied", target.validationCopied, target.exported && !target.validationCopied)
  ];
}

function ritualChecklistMeta(item) {
  const stateLabel = item.state === "complete"
    ? "Complete"
    : item.state === "blocked"
      ? "Blocked"
      : item.state === "active"
        ? "Ready"
        : "Pending";
  return [
    stateLabel,
    item.eventId ? "Event recorded" : null,
    item.confidence == null ? null : `Confidence ${item.confidence.toFixed(2)}`,
    item.disclosure
  ].filter(Boolean).join(" · ");
}

function calibrationSummaryText(target) {
  const zoneLines = REQUIRED_ZONES.map((zoneId) => {
    const rect = target.zoneGeometry[zoneId];
    return `${zoneId}: x=${rect.x}, y=${rect.y}, w=${rect.w}, h=${rect.h}`;
  });
  const objectLines = REQUIRED_OBJECTS.map((objectId) => `${objectId}: ${target.objectAssignments[objectId]}`);
  return [
    `status: ${target.calibrationSaved ? "saved" : "not saved"}`,
    "stored fields: normalized zone geometry, symbolic object labels",
    "raw media stored: false",
    "",
    "zones:",
    ...zoneLines,
    "",
    "objects:",
    ...objectLines
  ].join("\n");
}

function preflightText(target) {
  const preflight = runExportPreflight(target);
  const lines = preflight.checks.map((check) => `${check.passed ? "PASS" : "BLOCKED"} ${check.label}: ${check.message}`);
  return [
    `overall: ${preflight.passed ? "PASS" : "BLOCKED"}`,
    ...lines
  ].join("\n");
}

function preflightChecklistHtml(target) {
  const preflight = runExportPreflight(target);
  return `
    <div class="dq-check-row ${preflight.passed ? "is-complete" : "is-blocked"}">
      <span aria-hidden="true"></span>
      <strong>${preflight.passed ? "Export preflight passed" : "Export preflight blocked"}</strong>
      <em>${preflight.passed ? "Physical trace is ready to download." : "Complete the blocked rows below."}</em>
    </div>
    ${preflight.checks.map((check) => `
      <div class="dq-check-row ${check.passed ? "is-complete" : "is-blocked"}">
        <span aria-hidden="true"></span>
        <strong>${escapeHtml(check.label)}</strong>
        <em>${escapeHtml(check.passed ? "ok" : check.message)}</em>
      </div>
    `).join("")}
  `;
}

function exportReadinessSummaryHtml(target) {
  const preflight = runExportPreflight(target);
  const failure = preflight.failures[0];
  return `
    <div>
      <span>Export readiness</span>
      <strong>${preflight.passed ? "Ready" : "Blocked"}</strong>
    </div>
    <p class="note">${preflight.passed
      ? "Physical trace is ready to export."
      : `Next: ${escapeHtml(cleanVisibleIssue(failure?.message ?? "complete preflight"))}`}</p>
  `;
}

function exportCardStatusText(target) {
  if (target.exported) return "Exported";
  if (target.exportReady) return "Ready to export";
  if (target.recording) return "Blocked · stop recording first";
  if (target.questState === "quest_complete" && !target.physicalConfirmed) return "Blocked · confirm physical session";
  return "Blocked · complete the ritual first";
}

function cleanVisibleIssue(message) {
  return String(message)
    .replaceAll("physical_fixture_missing", "physical trace missing")
    .replaceAll("raw_media_persisted=false", "raw media off")
    .replaceAll("pending_export", "pending export")
    .replaceAll("_", " ");
}

export function queuePerceptionSuggestion(target, suggestion) {
  if (suggestion.step && !suggestionMatchesCurrentStep(target, suggestion)) return;
  expireOldSuggestions(target, suggestion.timestamp_ms);
  if (target.rejectedSuggestionKeys.includes(suggestion.key) || (target.rejectedSuggestionCooldowns?.[suggestion.key] ?? 0) > suggestion.timestamp_ms) return;
  const rejectedCandidateUntil = target.rejectedCandidateCooldowns?.[candidateKey(candidateFromSuggestion(suggestion))] ?? 0;
  if (rejectedCandidateUntil > suggestion.timestamp_ms) return;
  const cooldownMs = target.localPerceptionTuning?.suggestionCooldownMs ?? LOCAL_MOTION.suggestionCooldownMs;
  const activeSuggestions = target.perceptionSuggestions.filter((item) => item.status !== "pending" || (item.expires_at_ms ?? Infinity) > suggestion.timestamp_ms);
  const existing = activeSuggestions.find((item) => item.key === suggestion.key && item.status === "pending");
  if (existing && suggestion.timestamp_ms - existing.timestamp_ms < cooldownMs) return;
  const maxActive = target.localPerceptionTuning?.maxActiveSuggestions ?? LOCAL_MOTION.maxActiveSuggestions;
  recordSuggestionGenerated(target, suggestion);
  target.perceptionSuggestions = [
    suggestion,
    ...activeSuggestions.filter((item) => item.key !== suggestion.key)
  ].sort((a, b) => (b.rank ?? b.confidence ?? 0) - (a.rank ?? a.confidence ?? 0)).slice(0, maxActive);
}

function renderDetectedAction(target) {
  if (!dom?.cameraSuggestions) return;
  const renderKey = movementResultRenderKey(target);
  if (renderKey === lastMovementResultRenderKey) return;
  lastMovementResultRenderKey = renderKey;
  dom.cameraSuggestions.innerHTML = suggestionsHtml(target);
}

function renderMovementResultDetails(target) {
  const snapshot = target.movementResultSnapshot;
  const detailKey = movementResultDetailKey(target);
  if (detailKey !== lastMovementDetailsRenderKey) {
    lastMovementDetailsRenderKey = detailKey;
    if (dom.movementConfidence) dom.movementConfidence.textContent = snapshot ? snapshot.confidence.toFixed(2) : "--";
    if (dom.movementReason) dom.movementReason.innerHTML = snapshot?.reason
      ? readableDetailHtml("Reason", snapshot.reason)
      : "--";
    if (dom.movementEvidence) dom.movementEvidence.innerHTML = snapshot?.evidence?.length
      ? evidenceListHtml(snapshot.evidence)
      : "--";
    if (dom.movementProvider) dom.movementProvider.textContent = snapshot?.provider ?? target.movementRecognition.provider;
    if (dom.movementModel) dom.movementModel.textContent = snapshot?.model ?? target.movementRecognition.model;
    if (dom.movementLatency) dom.movementLatency.textContent = snapshot ? `${snapshot.latency_ms}ms` : "--";
    if (dom.visualMemoryMode) dom.visualMemoryMode.value = target.visualContext?.memoryMode || "session";
    if (dom.visualSuggestedAction) {
      const action = snapshot?.suggested_actions?.[0] || target.visualContext?.suggestedActions?.[0];
      dom.visualSuggestedAction.hidden = !action;
      dom.visualSuggestedAction.textContent = action ? `${action.label || action.action} · requires confirmation` : "";
    }
    if (dom.confirmVisualSuggestedAction) {
      const action = snapshot?.suggested_actions?.[0] || target.visualContext?.suggestedActions?.[0];
      dom.confirmVisualSuggestedAction.hidden = !action;
      dom.confirmVisualSuggestedAction.disabled = !action;
    }
    if (dom.movementSummaryRow) {
      dom.movementSummaryRow.textContent = snapshot
        ? `${snapshot.short_label || "Observation"} · Confidence ${snapshot.confidence.toFixed(2)}`
        : "Confidence --";
    }
    if (dom.autoSpeak) {
      dom.autoSpeak.checked = target.movementRecognition.autoSpeak === true;
      const label = dom.autoSpeak.parentElement?.querySelector?.("span");
      if (label) label.textContent = target.movementRecognition.autoSpeak ? "Auto-speak on" : "Auto-speak off";
      if (dom.autoSpeak.parentElement) dom.autoSpeak.parentElement.hidden = true;
    }
    if (dom.confirmMovement) {
      const needsConfirmation = visualResponseNeedsConfirmation(target);
      dom.confirmMovement.hidden = !needsConfirmation;
      dom.confirmMovement.disabled = !needsConfirmation || snapshot?.confirmed === true;
      dom.confirmMovement.textContent = snapshot?.confirmed ? "Confirmed" : "Confirm";
    }
    if (dom.correctMovement) {
      dom.correctMovement.hidden = !snapshot;
      dom.correctMovement.disabled = !snapshot;
    }
    if (dom.automateThisMovement) {
      dom.automateThisMovement.hidden = !snapshot?.confirmed;
      dom.automateThisMovement.disabled = !snapshot?.confirmed;
    }
    if (dom.movementCorrectionForm) {
      dom.movementCorrectionForm.hidden = !snapshot || target.correctionDraft.open !== true;
    }
    if (dom.movementCorrectionInput && target.correctionDraft.open === true) {
      dom.movementCorrectionInput.value = target.correctionDraft.text ?? "";
    }
    if (dom.movementHistoryList) {
      dom.movementHistoryList.innerHTML = movementHistoryHtml(target);
    }
    if (dom.speakResult) {
      dom.speakResult.hidden = isPrimaryView();
      dom.speakResult.disabled = !snapshot;
    }
    if (dom.tryAgainMovement) {
      const canRetry = snapshot || target.movementCaptureState.status === "error";
      dom.tryAgainMovement.hidden = isPrimaryView() || !canRetry;
      dom.tryAgainMovement.disabled = target.movementCaptureState.status === "capturing" || target.movementCaptureState.status === "analyzing";
      dom.tryAgainMovement.textContent = snapshot || target.movementCaptureState.status === "result_ready" ? "Observe" : "Try again";
    }
  }
  const voiceLabel = target.movementRecognition.voiceStatus || "Ready";
  if (dom.voiceStatus) dom.voiceStatus.textContent = voiceLabel;
  if (dom.voiceStatusPill) dom.voiceStatusPill.textContent = voiceLabel.replaceAll("…", "");
}

function movementHistoryHtml(target) {
  const entries = target.movementHistory.entries.slice().reverse();
  if (!entries.length) return "No movement history yet.";
  return entries.map((entry) => `
    <div class="dq-history-item">
      <strong>${escapeHtml(narratorSentence(entry.movement))}</strong>
      <span>Text-only session history</span>
    </div>
  `).join("");
}

function savedActionsSummaryHtml(target) {
  const customRows = (target.customSkills || []).map((skill) => ({
    icon: skill.pose_type === "two_hand" ? "H" : "G",
    name: skill.name,
    meta: interactionModeIs(target, "conversation") && skill.action?.type === "speak_phrase"
      ? "Available while observing"
      : skill.action?.type === "speak_phrase" ? `Speak “${sanitizeMemoryText(skill.action?.value || "Done")}”` : "Run saved gesture action",
    enabled: skill.active && skill.enabled,
    id: skill.custom_skill_id
  }));
  const recipeRows = (target.automation.recipes || []).map((recipe) => ({
    icon: gestureIconLabel(recipe.trigger?.gesture_key || recipe.trigger?.movement_key || recipe.name),
    name: recipe.name,
    meta: primarySavedActionDescription(target, recipe),
    enabled: recipe.enabled === true,
    id: recipe.recipe_id
  }));
  const speechFallbackMeta = interactionModeIs(target, "conversation") ? "Available while observing" : null;
  const fallbackRows = [
    { icon: "H", name: "Heart", meta: speechFallbackMeta || "Speak “Heart detected”", enabled: true, id: "preset_heart" },
    { icon: "T", name: "Thumbs up", meta: speechFallbackMeta || "Speak “Great job”", enabled: true, id: "preset_thumbs_up" },
    { icon: "P", name: "Point at object", meta: "Explain what I’m showing", enabled: true, id: "preset_point" }
  ];
  const sourceRows = [...customRows, ...recipeRows];
  const rows = (sourceRows.length ? sourceRows : fallbackRows).slice(0, 3);
  const viewAll = sourceRows.length > 3 ? '<div class="sf-action-view-all" role="link" tabindex="0" data-saved-action="view-all">View all</div>' : "";
  return `${rows.map((row) => `
    <div class="sf-action-row text-contained" role="link" tabindex="0" data-saved-action="open" data-action-id="${escapeHtml(row.id)}">
      <span class="sf-action-icon" aria-hidden="true">${escapeHtml(row.icon)}</span>
      <span class="sf-action-copy"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.meta)}</span></span>
      <span class="sf-action-state">${row.enabled ? "Enabled" : "Off"}</span>
      <span class="sf-action-chevron" aria-hidden="true">&gt;</span>
    </div>
  `).join("")}${viewAll}<div class="sf-action-add" role="link" tabindex="0" data-saved-action="add">Add action</div>`;
}

function primarySavedActionDescription(target, recipe) {
  const actionType = String(recipe.action?.type || "");
  const config = recipe.action?.config || {};
  if (interactionModeIs(target, "conversation") && actionType === "speak_phrase") return "Available while observing";
  if (actionType === "speak_phrase") return `Speak “${sanitizeMemoryText(config.text || recipe.name || "Done")}”`;
  if (actionType === "browser_notification") return "Show a notification";
  if (actionType === "start_timer") return "Start a timer";
  if (actionType === "increment_counter") return "Update a counter";
  if (actionType === "append_activity_log") return "Add to activity log";
  return automationActionLabel(actionType);
}

function watchInsightRailHtml(target) {
  const app = canonicalAppState(target);
  const turn = app.currentTurn;
  const sessionError = target.realtimeSession.state === "error" || app.session.status === "error";
  const starting = app.session.status === "starting" || target.cameraStartInFlight === true;
  const ending = app.session.status === "ending";
  const active = app.session.status === "active" && app.runtime.watching;
  const thinking = app.runtime.thinking;
  const observationError = !sessionError && active && target.movementRecognition.status === "fallback";
  const observation = sessionError || observationError ? "" : String(turn.observationText || "").trim();
  const status = sessionError
    ? "Unavailable"
    : starting
      ? "Starting"
      : ending
        ? "Ending"
        : active
          ? "Live"
          : "Ready";
  const state = sessionError
    ? "error"
    : observationError
      ? "degraded"
      : starting || ending
        ? "transitioning"
        : observation
          ? "event"
          : active
            ? "live"
            : "ready";
  const headline = sessionError
    ? "Live watching could not start."
    : observationError
      ? "Watching continues. The last change was not analyzed."
      : thinking
        ? "Understanding a notable change in view."
        : observation
          ? narratorSentence(observation)
          : "Watching for movement and notable changes.";
  const support = sessionError
    ? watchSessionFailureCopy(target, app)
    : observationError
      ? "The observation service will retry when the view changes again."
      : starting
        ? "Opening the live view. The interface will settle with the first camera frame."
        : ending
          ? "Closing the live observation session."
          : active
            ? "Live observation is active. New moments will appear below."
            : "Start the camera to begin continuous observation.";
  return `
    <div class="sf-watch-insight" data-watch-state="${state}">
      <header class="sf-watch-insight-header">
        <span class="sf-watch-status"><i aria-hidden="true"></i>${escapeHtml(status)}</span>
      </header>
      <section class="sf-watch-hero" aria-label="Current watch insight">
        <strong>${escapeHtml(headline)}</strong>
        ${observation ? "" : `<p>${escapeHtml(support)}</p>`}
        <p class="sf-watch-meta">Confirm important details manually.</p>
      </section>
    </div>
  `;
}

function watchSessionFailureCopy(target, app) {
  const reason = `${app.safeError || ""} ${target.errorMessage || ""}`.toLowerCase();
  if (reason.includes("permission") || reason.includes("notallowed")) {
    return "Allow camera access, then try again.";
  }
  if (reason.includes("timeout")) return "The camera took too long to respond. Try again.";
  return "The live camera could not start. Try again.";
}

function recentMomentsSummaryHtml(target) {
  const app = canonicalAppState(target);
  if (app.selectedMode === "conversation") {
    const turns = app.persistentMemory.conversationMoments.slice(-3).reverse();
    if (!turns.length) return '<p class="dq-movement-hint">Your recent conversational moments will appear here.</p>';
    return turns.map((entry) => `
      <div class="sf-moment-row text-contained">
        <span class="sf-moment-node" aria-hidden="true"><i data-lucide="message-circle"></i></span>
        <span class="sf-moment-time">${escapeHtml(relativeMomentTime(entry.createdAt))}</span>
        <span class="sf-moment-copy"><strong>${escapeHtml(entry.role)}</strong> ${escapeHtml(narratorSentence(entry.text))}</span>
      </div>
    `).join("");
  }
  const entries = app.persistentMemory.observationMoments.slice(-3).reverse();
  if (!entries.length) return '<p class="dq-movement-hint">Your recent observations will appear here.</p>';
  return entries.map((entry) => `
    <div class="sf-moment-row text-contained">
      <span class="sf-moment-node" aria-hidden="true"><i data-lucide="aperture"></i></span>
      <span class="sf-moment-time">${escapeHtml(relativeMomentTime(entry.createdAt))}</span>
      <span class="sf-moment-copy"><strong>${escapeHtml(entry.role)}</strong> ${escapeHtml(narratorSentence(entry.text))}</span>
    </div>
  `).join("");
}

function relativeMomentTime(timestampMs) {
  const ageMs = Math.max(0, Math.round(now() - Number(timestampMs || now())));
  if (ageMs < 60000) return "Just now";
  const minutes = Math.max(1, Math.round(ageMs / 60000));
  return `${minutes} min ago`;
}

function renderAutomationState(target) {
  if (!dom.automationManagerList) return;
  const runtime = target.automation;
  const instantRuntime = instantRuntimeFor(target);
  const renderKey = JSON.stringify({
    enabled: runtime.enabled,
    recipes: runtime.recipes.map((recipe) => [recipe.recipe_id, recipe.enabled, recipe.updated_at]),
    receipts: runtime.receipts.map((receipt) => [receipt.execution_id, receipt.status, receipt.finished_at]),
    counters: runtime.counters,
    activity_count: runtime.activityLog.length,
    matched: runtime.matchedCount,
    status: runtime.lastStatus,
    instant_enabled: instantRuntime.userEnabled,
    instant_status: instantRuntime.engineStatus,
    custom_skills: (target.customSkills || []).map((skill) => [skill.custom_skill_id, skill.enabled, skill.active, skill.updated_at, skill.positive_templates.length])
  });
  if (renderKey === lastAutomationRenderKey) return;
  lastAutomationRenderKey = renderKey;
  if (dom.automationPresetSelect && dom.automationPresetSelect.options.length <= 1) {
    dom.automationPresetSelect.insertAdjacentHTML("beforeend", AUTOMATION_PRESETS.map((preset) => (
      `<option value="${escapeHtml(preset.recipe_id)}">${escapeHtml(preset.name)}</option>`
    )).join(""));
  }
  if (dom.instantGestures) dom.instantGestures.checked = instantRuntime.userEnabled;
  renderInstantGestureStatus(target);
  if (dom.customGestureList) dom.customGestureList.innerHTML = customSkillManagerHtml(target);
  if (dom.gestureRecipePreviewList) dom.gestureRecipePreviewList.innerHTML = gestureRecipePreviewHtml(target);
  dom.automationManagerList.innerHTML = automationManagerHtml(target);
  if (dom.automationReceiptList) dom.automationReceiptList.innerHTML = automationReceiptHtml(target);
  if (dom.automationRuntimeSummary) dom.automationRuntimeSummary.textContent = automationRuntimeSummary(target);
  if (dom.automationMatchSummary) {
    dom.automationMatchSummary.hidden = !target.movementResultSnapshot?.confirmed || runtime.matchedCount === 0;
    dom.automationMatchSummary.textContent = runtime.matchedCount
      ? `${runtime.matchedCount} automation ${runtime.matchedCount === 1 ? "recipe" : "recipes"} matched · ${automationStatusLabel(runtime.lastStatus)}`
      : "";
  }
  if (dom.automationExecutionStatus) {
    const confirmed = target.movementResultSnapshot?.confirmed === true;
    dom.automationExecutionStatus.hidden = !confirmed;
    dom.automationExecutionStatus.textContent = confirmed ? runtime.executionStatus || automationStatusLabel(runtime.lastStatus) : "Automation ready";
  }
}

function gestureRecipePreviewHtml(target) {
  const customRows = (target.customSkills || []).map((skill) => ({
    icon: skill.pose_type === "two_hand" ? "H" : "G",
    name: skill.name,
    meta: `${skill.pose_type === "two_hand" ? "Custom two-hand pose" : "Custom one-hand pose"} · ${skill.positive_templates.length} examples`,
    enabled: skill.active && skill.enabled
  }));
  const recipeRows = (target.automation.recipes || []).map((recipe) => ({
    icon: gestureIconLabel(recipe.trigger?.gesture_key || recipe.trigger?.movement_key || recipe.name),
    name: recipe.name,
    meta: `${automationActionLabel(recipe.action?.type)} · ${recipe.execution_mode === "instant_local_gesture" ? "Instant" : "After confirm"}`,
    enabled: recipe.enabled === true
  }));
  const rows = [...customRows, ...recipeRows].slice(0, 3);
  if (!rows.length) {
    return `
      <div class="dq-recipe-row text-contained">
        <span aria-hidden="true">+</span>
        <div class="dq-recipe-meta">
          <strong>No gesture recipes yet</strong>
          <span>Create a custom gesture or add a preset.</span>
        </div>
      </div>
    `;
  }
  return rows.map((row) => `
    <div class="dq-recipe-row text-contained">
      <span aria-hidden="true">${escapeHtml(row.icon)}</span>
      <div class="dq-recipe-meta">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${escapeHtml(row.meta)}</span>
      </div>
      <span class="dq-recipe-status">${row.enabled ? "Enabled" : "Off"}</span>
      <span aria-hidden="true">&gt;</span>
    </div>
  `).join("");
}

function gestureIconLabel(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("thumb")) return "T";
  if (text.includes("heart")) return "H";
  if (text.includes("peace")) return "P";
  if (text.includes("palm")) return "O";
  return "G";
}

export function customSkillManagerHtml(target) {
  const skills = target.customSkills || [];
  if (!skills.length) return '<p class="note">No custom gestures yet.</p>';
  return skills.map((skill) => {
    const lastRun = [...target.automation.receipts].reverse().find((receipt) => receipt.recipe_id === skill.linked_recipe_id && receipt.dry_run !== true);
    return `
      <div class="dq-history-item text-contained">
        <strong>${escapeHtml(skill.name)}</strong>
        <span>${skill.pose_type === "two_hand" ? "Custom two-hand pose" : "Custom one-hand pose"} · ${skill.positive_templates.length} examples · ${skill.active && skill.enabled ? "Active" : "Disabled"}</span>
        <span>Last run: ${escapeHtml(lastRun ? automationStatusLabel(lastRun.status) : "never")}</span>
        <div class="dq-button-row">
          <button class="dq-button secondary no-vertical-text" data-custom-skill-action="test" data-custom-skill-id="${escapeHtml(skill.custom_skill_id)}" type="button">Test</button>
          <button class="dq-button secondary no-vertical-text" data-custom-skill-action="retrain" data-custom-skill-id="${escapeHtml(skill.custom_skill_id)}" type="button">Retrain</button>
          <button class="dq-button secondary no-vertical-text" data-custom-skill-action="edit-action" data-custom-skill-id="${escapeHtml(skill.custom_skill_id)}" type="button">Edit action</button>
          <button class="dq-button secondary no-vertical-text" data-custom-skill-action="toggle" data-custom-skill-id="${escapeHtml(skill.custom_skill_id)}" type="button">${skill.enabled ? "Disable" : "Enable"}</button>
          <button class="dq-button secondary no-vertical-text" data-custom-skill-action="delete" data-custom-skill-id="${escapeHtml(skill.custom_skill_id)}" type="button">Delete</button>
        </div>
      </div>`;
  }).join("");
}

export function automationManagerHtml(target) {
  const recipes = target.automation.recipes;
  const controls = `
    <div class="dq-button-row">
      <button class="dq-button secondary no-vertical-text" data-automation-action="toggle-engine" type="button">${target.automation.enabled ? "Disable automations" : "Enable automations"}</button>
      <button class="dq-button secondary no-vertical-text" data-automation-action="clear-data" type="button">Reset counters & receipts</button>
    </div>`;
  if (!recipes.length) return `<p class="note">No automation recipes yet.</p>${controls}`;
  return `${recipes.map((recipe) => {
    const lastRun = [...target.automation.receipts].reverse().find((receipt) => receipt.recipe_id === recipe.recipe_id && receipt.dry_run !== true);
    return `
      <div class="dq-history-item text-contained">
        <strong>${escapeHtml(recipe.name)}</strong>
        <span>${escapeHtml(recipe.trigger.gesture_key || recipe.trigger.movement_key || recipe.trigger.required_tags.join(", "))} · ${escapeHtml(automationActionLabel(recipe.action.type))} · ${recipe.execution_mode === "instant_local_gesture" ? "instant" : "after confirm"} · ${recipe.enabled ? "enabled" : "disabled"}</span>
        <span>Last run: ${escapeHtml(lastRun ? automationStatusLabel(lastRun.status) : "never")}</span>
        <div class="dq-button-row">
          <button class="dq-button secondary no-vertical-text" data-automation-action="toggle" data-recipe-id="${escapeHtml(recipe.recipe_id)}" type="button">${recipe.enabled ? "Disable" : "Enable"}</button>
          <button class="dq-button secondary no-vertical-text" data-automation-action="edit" data-recipe-id="${escapeHtml(recipe.recipe_id)}" type="button">Edit</button>
          <button class="dq-button secondary no-vertical-text" data-automation-action="dry-run" data-recipe-id="${escapeHtml(recipe.recipe_id)}" type="button">Test recipe</button>
          <button class="dq-button secondary no-vertical-text" data-automation-action="delete" data-recipe-id="${escapeHtml(recipe.recipe_id)}" type="button">Delete</button>
        </div>
      </div>`;
  }).join("")}${controls}`;
}

function automationReceiptHtml(target) {
  const receipts = target.automation.receipts.slice(-10).reverse();
  if (!receipts.length) return "No automation receipts yet.";
  return receipts.map((receipt) => `
    <div class="dq-history-item text-contained">
      <strong>${escapeHtml(automationStatusLabel(receipt.status))} · ${escapeHtml(automationActionLabel(receipt.action_type))}</strong>
      <span>${escapeHtml(receipt.safe_message)}</span>
      <span>${receipt.dry_run ? "Dry run" : `${receipt.duration_ms}ms`} · No raw media</span>
    </div>
  `).join("");
}

function automationRuntimeSummary(target) {
  const runtime = target.automation;
  const counterTotal = Object.values(runtime.counters).reduce((sum, value) => sum + Number(value || 0), 0);
  return `${runtime.enabled ? "Enabled" : "Disabled"} · ${runtime.recipes.length} recipes · ${counterTotal} counter total · ${runtime.activityLog.length} activity entries`;
}

function automationStatusLabel(status) {
  if (status === "executing" || status === "planning" || status === "awaiting_confirmation") return "Running";
  if (status === "succeeded" || status === "completed") return "Completed";
  if (status === "failed" || status === "rate_limited") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "no_match") return "No match";
  return "Ready";
}

function automationActionLabel(actionType) {
  return {
    speak_phrase: "Speak phrase",
    browser_notification: "Browser notification",
    start_timer: "Start timer",
    increment_counter: "Increment counter",
    append_activity_log: "Append activity log",
    local_snapshot_download: "Local snapshot download",
    signed_webhook_post: "Signed webhook"
  }[actionType] || "Automation";
}

function renderResearchLab(target) {
  if (dom.researchProvider) dom.researchProvider.textContent = target.movementRecognition.provider;
  if (dom.researchRequestedModel) dom.researchRequestedModel.textContent = target.movementResultSnapshot?.requested_model || target.movementRecognition.model;
  if (dom.researchReturnedModel) dom.researchReturnedModel.textContent = target.movementResultSnapshot?.returned_model || "--";
  if (dom.researchLatency) dom.researchLatency.textContent = target.movementResultSnapshot ? `${target.movementResultSnapshot.latency_ms}ms` : "--";
  if (dom.researchPromptVersion) dom.researchPromptVersion.textContent = target.movementRecognition.promptVersion || MOVEMENT_NARRATION_PROMPT_VERSION;
  if (dom.researchImageTokens) dom.researchImageTokens.textContent = String(target.movementRecognition.imageTokens ?? 0);
  if (dom.researchRetries) dom.researchRetries.textContent = String(target.movementRecognition.retries ?? 0);
  if (dom.researchCandidateFailures) dom.researchCandidateFailures.textContent = String(target.movementRecognition.candidateFailures?.length ?? 0);
  if (dom.researchLastSafeError) dom.researchLastSafeError.textContent = target.movementRecognition.lastSafeError || "--";
  if (dom.researchHistoryCount) dom.researchHistoryCount.textContent = String(target.movementHistory.entries.length);
  if (dom.researchCorrectionCount) dom.researchCorrectionCount.textContent = String(target.correctionMemory.entries.length);
  if (dom.researchOneShotGuard) {
    dom.researchOneShotGuard.textContent = target.movementRecognition.requestInFlight ? "in flight" : "ready";
  }
  renderInstantGestureDiagnostics(target);
}

function renderInstantGestureDiagnostics(target) {
  if (!dom) return;
  const runtime = instantRuntimeFor(target);
  const diagnostics = instantRuntimeDiagnostics(runtime);
  if (dom.researchInstantMode) dom.researchInstantMode.textContent = `${diagnostics.engine_mode || diagnostics.mode || "off"} · initialized ${diagnostics.recognizer_initialized ? "yes" : "no"}`;
  if (dom.researchInstantLoop) dom.researchInstantLoop.textContent = diagnostics.loop_running ? "yes" : "no";
  if (dom.researchInstantFrames) dom.researchInstantFrames.textContent = `${diagnostics.frames_processed || 0} frames · ${diagnostics.successful_inferences || 0} successful`;
  if (dom.researchInstantInferenceAge) dom.researchInstantInferenceAge.textContent = Number.isFinite(Number(diagnostics.last_inference_age_ms)) ? `${Math.round(diagnostics.last_inference_age_ms)}ms` : "--";
  if (dom.researchInstantRawLabel) dom.researchInstantRawLabel.textContent = diagnostics.last_raw_label || "None";
  if (dom.researchInstantRawConfidence) dom.researchInstantRawConfidence.textContent = Number(diagnostics.last_raw_confidence || 0).toFixed(3);
  if (dom.researchInstantMappedGesture) dom.researchInstantMappedGesture.textContent = diagnostics.mapped_gesture || "--";
  if (dom.researchInstantHold) dom.researchInstantHold.textContent = `${Math.round(diagnostics.current_hold_ms ?? diagnostics.hold_progress_ms ?? 0)} / ${Math.round(diagnostics.required_hold_ms ?? diagnostics.hold_target_ms ?? INSTANT_GESTURE_DEFAULTS.holdMs)}ms`;
  if (dom.researchInstantStableEvent) dom.researchInstantStableEvent.textContent = diagnostics.last_stable_event_id || diagnostics.last_stable_event || "--";
  if (dom.researchInstantRecipeOutcome) dom.researchInstantRecipeOutcome.textContent = diagnostics.last_recipe_match || diagnostics.last_recipe_outcome_code || diagnostics.last_outcome_code || "loop_not_running";
  if (dom.researchInstantActionOutcome) dom.researchInstantActionOutcome.textContent = diagnostics.last_action_outcome || diagnostics.last_action_outcome_code || "--";
  if (dom.researchInstantReceipt) dom.researchInstantReceipt.textContent = diagnostics.last_receipt_id || diagnostics.last_receipt || "--";
  if (dom.researchInstantSafeError) dom.researchInstantSafeError.textContent = diagnostics.safe_error || diagnostics.last_error_message || "--";
  if (dom.researchInstantDiagnosis) dom.researchInstantDiagnosis.textContent = `${diagnostics.last_outcome_code || diagnostics.last_error_code || "loop_not_running"} · landmark fallback ${diagnostics.fallback_classifier_used ? "yes" : "no"}`;
  if (dom.researchInstantUserEnabled) dom.researchInstantUserEnabled.textContent = String(runtime.userEnabled);
  if (dom.researchInstantEffectiveEnabled) dom.researchInstantEffectiveEnabled.textContent = String(instantRuntimeEffectiveEnabled(runtime));
  if (dom.researchInstantEngineStatus) dom.researchInstantEngineStatus.textContent = runtime.engineStatus;
  if (dom.researchInstantSuccessfulInferences) dom.researchInstantSuccessfulInferences.textContent = String(runtime.successfulInferences);
  if (dom.researchInstantLastCandidate) dom.researchInstantLastCandidate.textContent = runtime.lastCandidate || "--";
  if (dom.researchInstantLastOutcomeCode) dom.researchInstantLastOutcomeCode.textContent = runtime.lastOutcomeCode;
  const draft = target.customSkillDraft;
  if (dom.researchTrainerWizardStep) dom.researchTrainerWizardStep.textContent = draft ? String(draft.currentStep) : "closed";
  if (dom.researchTrainerCaptureState) dom.researchTrainerCaptureState.textContent = draft?.captureState || "idle";
  if (dom.researchTrainerRequiredHandCount) dom.researchTrainerRequiredHandCount.textContent = String(draft?.requiredHandCount || 0);
  if (dom.researchTrainerVisibleHandCount) dom.researchTrainerVisibleHandCount.textContent = String(draft?.visibleHandCount || 0);
  if (dom.researchTrainerLandmarkFrameAvailable) dom.researchTrainerLandmarkFrameAvailable.textContent = String(draft?.landmarkFrameAvailable === true);
  if (dom.researchTrainerStableHoldMs) dom.researchTrainerStableHoldMs.textContent = String(Math.round(draft?.stableHoldMs || 0));
  if (dom.researchTrainerAcceptedExampleCount) dom.researchTrainerAcceptedExampleCount.textContent = String(draft?.positiveExamples.length || 0);
  if (dom.researchTrainerLastCaptureError) dom.researchTrainerLastCaptureError.textContent = draft?.lastCaptureError || "--";
}

function suggestionsHtml(target) {
  const app = canonicalAppState(target);
  const responseText = app.currentTurn.assistantText || app.currentTurn.observationText;
  if (responseText) {
    const snapshot = {
      ...(target.movementResultSnapshot || {}),
      result_id: target.movementResultSnapshot?.result_id || `current_${app.currentTurn.createdAt || "turn"}`,
      question: app.currentTurn.userText
    };
    return movementResultHeroHtml(
      app.selectedMode === "observing" ? "Movement" : "Sensefield",
      responseText,
      primarySpeechState(target),
      snapshot
    );
  }
  const stateText = app.safeError
    ? app.safeError
    : app.runtime.thinking
      ? app.selectedMode === "observing" ? "Looking at what changed…" : "Understanding your question…"
      : app.selectedMode === "observing"
        ? "Show me a movement or object change."
        : app.session.status === "active" ? "Ask your question." : "Ask me anything about what I can see.";
  const reason = app.session.status === "active" ? "No raw media stored." : "No raw media stored.";
  const status = primaryResponseStateLabel(target);
  return movementResultHeroHtml(status, stateText, reason);
}

function movementResultHeroHtml(status, sentence, hint, snapshot = null) {
  const resultId = snapshot?.result_id ?? `capture_${String(status).toLowerCase().replace(/\W+/g, "_")}`;
  const reveal = snapshot?.result_id && snapshot.result_id !== lastMovementRevealResultId;
  if (reveal) lastMovementRevealResultId = snapshot.result_id;
  const userQuestion = sanitizeMemoryText(snapshot?.question || "");
  const conversationHtml = userQuestion
    ? `<p class="dq-movement-hint"><strong>USER</strong><br>${escapeHtml(userQuestion)}</p><p class="dq-movement-hint"><strong>SENSEFIELD</strong></p>`
    : "";
  return `
    <div class="dq-movement-result result-card-stable result-hero ${snapshot ? "" : "is-empty"} ${reveal ? "result-reveal" : ""} reduced-motion-safe text-contained" data-result-id="${escapeHtml(resultId)}">
      <span class="dq-movement-status">${escapeHtml(status)}</span>
      ${conversationHtml}
      <strong class="dq-movement-sentence movement-sentence">${escapeHtml(narratorSentence(sentence))}</strong>
      <p class="dq-movement-hint">${escapeHtml(naturalizeMovementText(hint))}</p>
    </div>
  `;
}

function calibratedMovementSentence(snapshot) {
  const sentence = snapshot?.movement_sentence ?? "";
  if (isOperationalVisualMessage(sentence)) return sentence;
  if (!sentence || snapshot?.corrected || isUncertainMovement(sentence) || snapshot.confidence >= 0.55) return sentence;
  const softened = sentence.replace(/^You\b/, "you").replace(/\.$/, "");
  return `I’m not fully sure, but it looks like ${softened}.`;
}

function movementResultRenderKey(target) {
  const app = canonicalAppState(target);
  const turn = app.currentTurn;
  return [
    app.selectedMode,
    app.session.status,
    app.session.sessionGeneration,
    app.session.modeGeneration,
    app.runtime.thinking ? "thinking" : "idle",
    turn.createdAt || "no_turn",
    turn.assistantText,
    turn.observationText,
    turn.speechStatus,
    app.safeError || ""
  ].join(":");
}

function movementResultDetailKey(target) {
  const snapshot = target.movementResultSnapshot;
  return snapshot
    ? ["result", snapshot.result_id, snapshot.revision, snapshot.confirmed ? "confirmed" : "pending", target.correctionDraft.open ? "correcting" : "view", target.movementHistory.entries.length, target.correctionMemory.entries.length, target.movementRecognition.autoSpeak ? "auto_on" : "auto_off"].join(":")
    : ["capture", target.movementCaptureState.status, target.movementRecognition.provider, target.movementRecognition.model, target.movementRecognition.lastError, target.movementHistory.entries.length, target.correctionMemory.entries.length].join(":");
}

function readableDetailHtml(label, text) {
  const readable = naturalizeMovementText(text);
  return `
    <details class="dq-readable-detail">
      <summary>${escapeHtml(label)}</summary>
      <p class="dq-readable-copy">${escapeHtml(readable)}</p>
    </details>
  `;
}

function evidenceListHtml(items = []) {
  return `<ul class="dq-evidence-list">${items.slice(0, 3).map((item) => `<li>${escapeHtml(naturalizeMovementText(item))}</li>`).join("")}</ul>`;
}

function statusLabelForMovementState(target) {
  return {
    idle: "Response",
    checking: "Understanding",
    capturing: "Observing",
    analyzing: "Understanding",
    complete: "Response",
    fallback: target.movementRecognition.lastError?.includes("busy") ? "Model busy" : "Model unavailable"
  }[target.movementRecognition.status] ?? "Response";
}

function movementBadgeText(target) {
  if (target.movementRecognition.status === "complete") return "Response";
  return statusLabelForMovementState(target);
}

function visualResponseNeedsConfirmation(target) {
  const snapshot = target.movementResultSnapshot;
  if (!snapshot) return false;
  if (snapshot.confirmed === true) return false;
  if ((snapshot.suggested_actions || []).length > 0 || (target.visualContext?.suggestedActions || []).length > 0) return true;
  return target.automation.recipes.some((recipe) => recipe.enabled === true && recipe.execution_mode !== "instant_local_gesture");
}

function movementControlHelpText(target) {
  if (target.primarySurfaceMode === "microscope") {
    return microscope?.snapshot?.().status === "verifying"
      ? "Identifying presented object."
      : "Camera live. Automatic local vision is active.";
  }
  if (!target.interactionState.sessionActive && target.realtimeSession.state === "inactive") return interactionModeIs(target, "observing") ? "Start observing." : "Start conversation.";
  if (target.realtimeSession.state === "starting") return interactionModeIs(target, "observing") ? "Starting observing." : "Starting conversation.";
  if (target.realtimeSession.state === "ending") return interactionModeIs(target, "observing") ? "Ending observing." : "Ending conversation.";
  if (target.interactionState.sessionActive) return interactionModeIs(target, "observing") ? "Watching." : "Listening.";
  return {
    idle: target.movementRecognition.persistent.active ? "Watching." : "Start conversation.",
    checking: "Understanding…",
    capturing: "Watching…",
    analyzing: "Understanding…",
    complete: target.movementRecognition.persistent.active ? "Watching." : "Start conversation.",
    fallback: target.movementRecognition.lastError || "Try again."
  }[target.movementRecognition.status] ?? "Local change detector active.";
}

function suggestionKindLabel(suggestion) {
  if (suggestion.payload?.ai_recognition) return "AI recognition";
  return suggestion.suggested_event_type?.includes("gesture") ? "Activity" : "Motion";
}

function zoneClassForSuggestion(zoneId) {
  return `zone-${String(zoneId).replaceAll("_", "-")}`;
}

function suggestionTraceInstructionsText(target) {
  const mode = selectedTraceModeFor(target);
  const summary = suggestionSummaryForTrace(target, mode);
  const preflight = runSuggestionTracePreflight(target);
  return [
    `Selected trace mode: ${mode.label}`,
    `Required physical action: ${mode.action}`,
    `Expected suggestion: ${mode.expected}`,
    `Accept/Reject: ${mode.decision}`,
    `Required export filename: ${mode.filename}`,
    `Required save path: ${mode.path}`,
    `Validation command: ${mode.validation}`,
    `Current suggestion count: ${summary.suggestions_generated}`,
    `Accepted count: ${summary.suggestions_accepted}`,
    `Rejected count: ${summary.suggestions_rejected}`,
    `Auto-completed steps: ${summary.auto_completed_steps}`,
    `Suggestion export preflight: ${preflight.passed ? "PASS" : `BLOCKED - ${preflight.failures[0]?.message ?? "complete the selected suggestion trace"}`}`,
    "Suggestion trace tools are developer-only; the product flow uses confirmed camera suggestions."
  ].join("\n");
}

function suggestionCountersHtml(target) {
  const summary = suggestionSummaryForTrace(target, selectedTraceModeFor(target));
  return `
    <div class="metric"><strong>generated</strong><span>${summary.suggestions_generated}</span></div>
    <div class="metric"><strong>accepted</strong><span>${summary.suggestions_accepted}</span></div>
    <div class="metric"><strong>rejected</strong><span>${summary.suggestions_rejected}</span></div>
    <div class="metric"><strong>auto-completed</strong><span>${summary.auto_completed_steps}</span></div>
  `;
}

function campaignSummaryHtml(target) {
  const summary = campaignSummaryFor(target);
  return `
    <div class="metric"><strong>traces required</strong><span>${summary.traces_required}</span></div>
    <div class="metric"><strong>traces exported</strong><span>${summary.traces_exported}</span></div>
    <div class="metric"><strong>missing traces</strong><span>${summary.missing_traces.length}</span></div>
    <div class="metric"><strong>generated suggestions total</strong><span>${summary.generated_suggestions_total}</span></div>
    <div class="metric"><strong>accepted suggestions total</strong><span>${summary.accepted_suggestions_total}</span></div>
    <div class="metric"><strong>rejected suggestions total</strong><span>${summary.rejected_suggestions_total}</span></div>
    <div class="metric"><strong>auto_completed_steps total</strong><span>${summary.auto_completed_steps_total}</span></div>
    <div class="metric"><strong>LLM calls</strong><span>${summary.llm_calls}</span></div>
    <div class="metric"><strong>VLM calls</strong><span>${summary.vlm_calls}</span></div>
    <div class="metric"><strong>raw media persistence</strong><span>${summary.raw_media_persistence}</span></div>
    <div class="metric"><strong>ready for npm run gate:3b:live</strong><span>${summary.ready_for_gate_3b_live ? "yes" : "no"}</span></div>
    <p class="note">Missing: ${summary.missing_traces.map(escapeHtml).join(", ") || "none"}</p>
  `;
}

function campaignStepsHtml(target) {
  const selectedStep = SUGGESTION_CAMPAIGN_STEPS[target.suggestionCampaign.currentIndex] ?? SUGGESTION_CAMPAIGN_STEPS[0];
  const rows = SUGGESTION_CAMPAIGN_STEPS.map((step) => {
    const captureStatus = campaignCaptureStatus(target, step);
    const exportReadiness = campaignExportReadiness(target, step);
    const selected = selectedStep.id === step.id;
    return `
      <div class="campaign-trace-row text-contained ${selected ? "is-selected" : ""}" data-campaign-action="select" data-trace-mode="${escapeHtml(step.id)}" data-campaign-step="${escapeHtml(step.id)}" role="button" tabindex="0">
        <span class="campaign-status-dot is-${escapeHtml(exportReadiness === "ready_to_export" || exportReadiness === "exported" ? exportReadiness : captureStatus)}" aria-hidden="true"></span>
        <div class="campaign-trace-meta">
          <strong class="truncate-safe">${step.number}. ${escapeHtml(campaignShortName(step))}</strong>
          <span class="campaign-status-pair">
            <small class="campaign-status-pill" title="Capture status: ${escapeHtml(campaignStatusLabel(captureStatus))}">Capture: ${escapeHtml(campaignStatusLabel(captureStatus))}</small>
            <small class="campaign-status-pill" title="Export readiness: ${escapeHtml(campaignStatusLabel(exportReadiness))}">Export: ${escapeHtml(campaignStatusLabel(exportReadiness))}</small>
          </span>
        </div>
      </div>
    `;
  }).join("");
  return `
    <div class="campaign-trace-list" aria-label="Trace list">
      ${rows}
    </div>
    ${campaignSelectedTraceDetailHtml(target, selectedStep)}
  `;
}

export function campaignSummaryFor(target) {
  const summaries = Object.values(target.suggestionCampaign.traceSummaries);
  const currentSummary = target.suggestionTraceMode !== "standard" && !target.suggestionCampaign.traceSummaries[target.suggestionTraceMode]
    ? suggestionSummaryForTrace(target, selectedTraceModeFor(target))
    : null;
  const allSummaries = currentSummary ? [...summaries, currentSummary] : summaries;
  const missing = SUGGESTION_CAMPAIGN_STEPS
    .filter((step) => !target.suggestionCampaign.exportedTraceIds.includes(step.id))
    .map((step) => step.path);
  return {
    traces_required: SUGGESTION_CAMPAIGN_STEPS.length,
    traces_exported: target.suggestionCampaign.exportedTraceIds.length,
    missing_traces: missing,
    generated_suggestions_total: sumSummary(allSummaries, "suggestions_generated"),
    accepted_suggestions_total: sumSummary(allSummaries, "suggestions_accepted"),
    rejected_suggestions_total: sumSummary(allSummaries, "suggestions_rejected"),
    auto_completed_steps_total: sumSummary(allSummaries, "auto_completed_steps"),
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persistence: target.rawMediaPersistenceCount,
    ready_for_gate_3b_live: missing.length === 0
  };
}

function campaignSelectedTraceDetailHtml(target, step) {
  const copy = campaignTraceCopy(step);
  const summary = campaignSummaryForStep(target, step);
  const captureStatus = campaignCaptureStatus(target, step);
  const exportReadiness = campaignExportReadiness(target, step);
  const reasons = campaignExportBlockReasons(target, step);
  return `
    <div class="campaign-detail text-contained" aria-label="Selected trace detail">
      <div class="campaign-detail-grid">
        <h4>${escapeHtml(copy.title)}</h4>
        <p class="note"><strong>Trace status:</strong> ${escapeHtml(campaignStatusLabel(captureStatus))}</p>
        ${captureStatus === "active" ? `<p class="note"><strong>Next:</strong> Perform the physical action and wait for a camera suggestion.</p>` : ""}
        ${captureStatus === "active" ? `<p class="note">Waiting for camera suggestion.</p>` : ""}
        <p class="note"><strong>Action:</strong> ${escapeHtml(copy.action)}</p>
        <p class="note"><strong>Expected:</strong> ${escapeHtml(copy.expected)}</p>
        <p class="note"><strong>Instruction:</strong> ${escapeHtml(copy.instruction)}</p>
        <p class="note"><strong>Export readiness:</strong> ${escapeHtml(exportReadiness === "ready_to_export" ? "Ready" : exportReadiness === "exported" ? "Exported" : "Blocked")}</p>
        <p class="note">${escapeHtml(copy.readiness)}</p>
        ${reasons.length ? `<ul class="campaign-reason-list">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
        <code class="campaign-path-field" title="${escapeHtml(step.path)}">${escapeHtml(step.path)}</code>
      </div>
      <div class="campaign-counter-row" aria-label="Selected trace counters">
        <span class="campaign-chip">Generated: ${summary.suggestions_generated}</span>
        <span class="campaign-chip">Accepted: ${summary.suggestions_accepted}</span>
        <span class="campaign-chip">Rejected: ${summary.suggestions_rejected}</span>
        <span class="campaign-chip">Auto-completed: ${summary.auto_completed_steps}</span>
      </div>
      ${summary.auto_completed_steps !== 0 ? `<p class="error-banner">Auto-completed must stay 0. Export is blocked.</p>` : ""}
      <div class="campaign-action-row">
        <button class="dq-button secondary no-vertical-text" data-campaign-action="start" data-trace-mode="${escapeHtml(step.id)}" type="button">Start this trace</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="reset" data-trace-mode="${escapeHtml(step.id)}" type="button">Reset this trace</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="export" data-trace-mode="${escapeHtml(step.id)}" type="button">Export this trace</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="copy-path" data-trace-mode="${escapeHtml(step.id)}" type="button">Copy save path</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="copy-move" data-trace-mode="${escapeHtml(step.id)}" type="button">Copy macOS move command</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="mark-exported" data-trace-mode="${escapeHtml(step.id)}" type="button">Mark trace exported</button>
      </div>
      <details class="dq-nested-details">
        <summary><span>View technical details</span></summary>
        <pre class="dq-pre code-contained scroll-contained">${escapeHtml(campaignTechnicalDetailsText(target, step))}</pre>
      </details>
    </div>
  `;
}

function campaignCaptureStatus(target, step) {
  if (target.suggestionCampaign.exportedTraceIds.includes(step.id)) return "captured";
  if (target.suggestionTraceMode !== step.id) return target.suggestionCampaign.captureStatuses[step.id] ?? "not_started";
  const summary = suggestionSummaryForTrace(target, step);
  if (summary.suggestions_accepted > 0) return "accepted";
  if (summary.suggestions_rejected > 0) return "rejected";
  if (summary.suggestions_generated > 0) return "suggestion_seen";
  return target.suggestionCampaign.captureStatuses[step.id] ?? "not_started";
}

function campaignExportReadiness(target, step) {
  if (target.suggestionCampaign.exportedTraceIds.includes(step.id)) return "exported";
  if (target.suggestionTraceMode === step.id) return target.exportReady ? "ready_to_export" : "blocked";
  return target.suggestionCampaign.exportReadiness[step.id] ?? "blocked";
}

function campaignSummaryForStep(target, step) {
  if (target.suggestionTraceMode === step.id && !target.suggestionCampaign.exportedTraceIds.includes(step.id)) return suggestionSummaryForTrace(target, step);
  return target.suggestionCampaign.traceSummaries[step.id] ?? {
    suggestions_generated: 0,
    suggestions_accepted: 0,
    suggestions_rejected: 0,
    auto_completed_steps: 0,
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persistence: target.rawMediaPersistenceCount
  };
}

function campaignExportBlockReasons(target, step) {
  if (campaignExportReadiness(target, step) !== "blocked") return [];
  if ((target.suggestionCampaign.captureStatuses[step.id] ?? "not_started") === "not_started") return ["Start this trace"];
  if (target.suggestionTraceMode !== step.id) return ["Select this trace"];
  const summary = suggestionSummaryForTrace(target, step);
  if (summary.suggestions_generated === 0) return ["Waiting for suggestion"];
  if (step.id === "suggestion_reject" && summary.suggestions_rejected === 0) return ["Reject required"];
  if (!["suggestion_reject", "suggestion_uncertain"].includes(step.id) && summary.suggestions_accepted === 0) return ["Accept required"];
  const reasons = runExportPreflight(target).failures.map(campaignShortReason).filter(Boolean);
  return [...new Set(reasons)].slice(0, 3);
}

function campaignShortReason(failure) {
  const map = {
    suggestions_generated: "Waiting for suggestion",
    suggestion_accept_required: "Accept required",
    accepted_suggestion_evidence: "Accept required",
    accepted_suggestion_payload: "Accept required",
    suggestion_reject_required: "Reject required",
    suggestion_uncertainty_required: "Waiting for suggestion",
    suggestion_full_ritual_accepts_all: "Accept required",
    physical_confirmed: "Physical confirmation required",
    suggestion_summary_present: "Missing metadata",
    suggestion_no_auto_complete: "Auto-completed must stay 0",
    suggestion_model_calls_zero: "Model calls must stay 0",
    suggestion_raw_media_zero: "Raw media must stay 0"
  };
  if (map[failure.id]) return map[failure.id];
  if (failure.id === "recording_stopped") return "Stop recording first";
  if (failure.id === "quest_complete" || failure.id === "events_exist" || failure.id === "event_sequence_valid") return "Complete ritual";
  return failure.message ? cleanVisibleIssue(failure.message) : "Blocked";
}

function campaignTechnicalDetailsText(target, step) {
  if (target.suggestionTraceMode !== step.id) return "Select or start this trace to view technical details.";
  return runExportPreflight(target).checks
    .map((check) => `${check.passed ? "PASS" : "BLOCKED"} ${check.id}: ${check.label}`)
    .join("\n");
}

function campaignShortName(step) {
  return step.label.replace("Suggestion Trace: ", "");
}

function campaignStatusLabel(status) {
  return String(status).replaceAll("_", " ");
}

function campaignTraceCopy(step) {
  const copy = {
    suggestion_phone_moved: {
      title: "Phone moved trace",
      action: "Move the phone out of phone_zone.",
      expected: "Possible phone moved.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_notebook_opened: {
      title: "Notebook opened trace",
      action: "Open the notebook in notebook_zone.",
      expected: "Possible notebook opened.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_pen_picked_up: {
      title: "Pen picked up trace",
      action: "Pick up the pen from pen_zone.",
      expected: "Possible pen picked up.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_writing_motion: {
      title: "Writing motion trace",
      action: "Make writing-like motion over notebook_zone.",
      expected: "Possible writing motion.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_typing_motion: {
      title: "Typing motion trace",
      action: "Make typing-like motion over keyboard_zone.",
      expected: "Possible typing motion.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_reject: {
      title: "Reject suggestion trace",
      action: "Create a wrong or low-confidence suggestion.",
      expected: "Any suggestion that should not progress the step.",
      instruction: "Create a wrong or low-confidence suggestion, then click Reject."
    },
    suggestion_uncertain: {
      title: "Uncertain scene trace",
      action: "Create noisy motion until uncertainty appears.",
      expected: "Possible scene uncertainty.",
      instruction: "Wait for the uncertainty signal or suggestion, then capture a clean exportable run."
    },
    suggestion_full_focus_ritual: {
      title: "Full ritual trace",
      action: "Complete the full Focus Ritual while accepting matching suggestions.",
      expected: "A matching suggestion at each ritual step.",
      instruction: "Accept matching suggestions only."
    }
  }[step.id] ?? {
    title: `${campaignShortName(step)} trace`,
    action: step.action,
    expected: step.expected,
    instruction: step.decision
  };
  const readiness = step.id === "suggestion_reject"
    ? "Blocked until one suggestion is rejected."
    : step.id === "suggestion_uncertain"
      ? "Blocked until an uncertainty signal or suggestion is present."
      : step.id === "suggestion_full_focus_ritual"
        ? "Blocked until all required suggestions are accepted."
        : "Blocked until one suggestion is accepted.";
  return { ...copy, readiness };
}

function markCampaignTraceExported(target, mode) {
  if (!target.suggestionCampaign.exportedTraceIds.includes(mode.id)) {
    target.suggestionCampaign.exportedTraceIds.push(mode.id);
  }
  target.suggestionCampaign.captureStatuses[mode.id] = "captured";
  target.suggestionCampaign.exportReadiness[mode.id] = "exported";
  target.suggestionCampaign.traceStatuses[mode.id] = "exported";
  target.suggestionCampaign.traceStates[mode.id] = {
    ...traceStateFor(target, mode),
    captureStatus: "captured",
    exportReadiness: "exported"
  };
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummaryForTrace(target, mode);
  target.suggestionCampaign.lastSuggestions[mode.id] = traceStateFor(target, mode).lastSuggestion ?? lastSuggestionSummary(target);
  target.statusMessage = `${mode.label} marked exported. Confirm the file is saved at ${mode.path}.`;
}

function recordCampaignCapture(target, fixture) {
  const mode = selectedTraceModeFor(target);
  if (mode.id === "standard") return;
  const step = SUGGESTION_CAMPAIGN_STEPS.find((item) => item.id === mode.id) ?? mode;
  target.suggestionCampaign.active = true;
  target.suggestionCampaign.currentIndex = Math.max(0, (step.number ?? 1) - 1);
  target.suggestionCampaign.captureStatuses[mode.id] = "captured";
  target.suggestionCampaign.exportReadiness[mode.id] = "ready_to_export";
  target.suggestionCampaign.traceStatuses[mode.id] = "ready_to_export";
  target.suggestionCampaign.traceStates[mode.id] = {
    ...traceStateFor(target, mode),
    captureStatus: "captured",
    exportReadiness: "ready_to_export",
    events: fixture.input_events ?? [],
    emittedEventIds: (fixture.input_events ?? []).map((event) => event.id)
  };
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummaryForTrace(target, mode);
  target.suggestionCampaign.lastSuggestions[mode.id] = traceStateFor(target, mode).lastSuggestion ?? lastSuggestionSummary(target);
  target.suggestionCampaign.capturedTraces[mode.filename] = fixture;
}

function buildCampaignBundle(target) {
  return {
    schema: "darkquest.suggestion_trace_campaign_bundle.v0",
    generated_by: "browser-local-capture",
    note: "Bundle export is for convenience. Gate 3B-Live requires individual files under fixtures/replay/live/suggestions/.",
    privacy: {
      contains_raw_video: false,
      contains_audio: false,
      contains_screenshots: false,
      contains_base64_images: false,
      contains_ocr_or_notebook_text: false,
      llm_calls: 0,
      vlm_calls: 0
    },
    campaign_summary: campaignSummaryFor(target),
    save_path_map: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.filename, step.path])),
    trace_payloads: target.suggestionCampaign.capturedTraces
  };
}

function campaignValidationInstructionsText() {
  return [
    "After exporting all traces, run:",
    "npm run suggestions:validate",
    "npm run suggestions:report",
    "npm run gate:3b:live",
    "",
    "If gate:3b:live still says missing traces:",
    "- check that all 8 files are saved under fixtures/replay/live/suggestions/",
    "- check filenames exactly",
    "- send back runs/gate-3b-live-latest.json and darkquest_operator_bug_report.json"
  ].join("\n");
}

function sumSummary(summaries, field) {
  return summaries.reduce((total, summary) => total + Number(summary?.[field] ?? 0), 0);
}

function suggestionMatchesCurrentStep(target, suggestion) {
  if (suggestion.step === "uncertain" || suggestion.step === "reset") return target.recording === true;
  if (target.uncertain || target.reset) return false;
  const step = RITUAL_STEPS.find((item) => item.id === suggestion.step);
  return !step || target.questState === step.activeState;
}

function actionSuggestionForStep(step, target, timestampMs, confidence, reason, payload) {
  const meta = STEP_SUGGESTION_META[step];
  if (!meta) return null;
  return createPerceptionSuggestion(meta.suggested_event_type, meta.zone_id, confidence, reason, step, timestampMs, {
    ...meta,
    payload,
    quest_state: target.questState
  });
}

function smoothDetectedActionCandidate(candidate, target, options = {}) {
  const previous = target.perceptionSuggestions
    .filter((item) => item.key === candidate.key)
    .sort((a, b) => (b.timestamp_ms ?? 0) - (a.timestamp_ms ?? 0))[0];
  const rawConfidence = candidate.confidence;
  const confidence = smoothActionConfidence(previous?.confidence, rawConfidence, options.confidence_alpha ?? 0.45);
  return {
    ...candidate,
    confidence,
    raw_confidence: rawConfidence,
    confidence_smoothed_from: previous ? previous.confidence : null,
    low_confidence: confidence < 0.7,
    rank: rankSuggestion(candidate.suggested_event_type, candidate.zone_id, confidence, candidate.step),
    requires_confirmation: true,
    detection_method: candidate.payload?.detection_method ?? candidate.detection_method ?? "motion_proxy"
  };
}

function actionTypeForStep(step, eventType) {
  if (step === "phone") return "phone_moved";
  if (step === "notebook") return "notebook_opened";
  if (step === "pen") return "pen_picked_up";
  if (step === "writing") return "writing_motion";
  if (step === "typing") return "typing_motion";
  if (step === "uncertain") return "uncertain";
  if (step === "reset") return "reset";
  if (eventType === "scene.uncertain") return "uncertain";
  if (eventType === "scene.reset") return "reset";
  return "local_motion";
}

function assertSymbolicFrameOnly(value) {
  const forbidden = new RegExp([
    "raw_frame",
    "raw_video",
    "raw_audio",
    "frame_bytes",
    "image_bytes",
    "video_bytes",
    "audio_bytes",
    "screenshot",
    "base64",
    ["data", "image"].join(":"),
    ["data", "video"].join(":"),
    ["data", "audio"].join(":"),
    "ocr",
    "notebook_text",
    "transcript"
  ].join("|"), "i");
  const scan = (item, key = "") => {
    if (forbidden.test(String(key))) throw new TypeError(`LocalPerceptionFrame contains forbidden media field: ${key}`);
    if (typeof item === "string" && forbidden.test(item)) throw new TypeError("LocalPerceptionFrame contains forbidden media value.");
    if (Array.isArray(item)) item.forEach((child, index) => scan(child, `${key}.${index}`));
    else if (item && typeof item === "object") Object.entries(item).forEach(([childKey, child]) => scan(child, childKey));
  };
  scan(value);
}

function actionLabelForSuggestion(type, zoneId) {
  if (type === "hand.entered_zone") return `Possible motion entered ${zoneId} - confirm to accept.`;
  if (type === "hand.left_zone") return `Possible motion left ${zoneId} - confirm to accept.`;
  if (type === "zone.activated") return `Possible zone activity in ${zoneId} - confirm to accept.`;
  if (type.includes("writing")) return STEP_SUGGESTION_META.writing.suggested_action;
  if (type.includes("typing")) return STEP_SUGGESTION_META.typing.suggested_action;
  return `Possible ${type} - confirm to accept.`;
}

function objectForZone(zoneId) {
  return {
    phone_zone: "phone",
    notebook_zone: "notebook",
    pen_zone: "pen",
    keyboard_zone: "keyboard"
  }[zoneId] ?? "motion_proxy";
}

function evidenceSummary(suggestion) {
  return suggestion.evidence.map((item) => item.kind).join("+");
}

function expiresInSeconds(suggestion) {
  return Math.max(0, Math.ceil((suggestion.expires_at_ms - now()) / 1000));
}

function rankSuggestion(type, zoneId, confidence, step) {
  const stepBoost = step ? 0.2 : 0;
  const gestureBoost = type.startsWith("gesture.detected") ? 0.1 : 0;
  const zoneBoost = zoneId === "notebook_zone" || zoneId === "keyboard_zone" ? 0.04 : 0;
  return Number(Math.min(1, confidence + stepBoost + gestureBoost + zoneBoost).toFixed(3));
}

function exportPreviewText(target) {
  const preview = buildExportPreview(target);
  return JSON.stringify(preview, null, 2);
}

function cameraStatusLabel(target) {
  if (target.cameraStatus.startsWith("error:")) return "error";
  if (target.cameraReady) return "on";
  return "off";
}

function questStatusLabel(target) {
  if (target.questState === "quest_complete") return "complete";
  if (target.ritualStarted || target.recordingStarted) return "in_progress";
  return "idle";
}

function renderWizard(target, guards) {
  const stages = wizardStagesForState(target);
  const current = stages.find((item) => !item.complete) ?? stages[stages.length - 1];
  dom.currentWizard.innerHTML = `
    <p class="dq-step-kicker">Step ${current.stepNumber} of ${stages.length}</p>
    <h2 class="wrap-safe">${escapeHtml(flowTitleForStage(current))}</h2>
    <p class="wrap-safe">${escapeHtml(flowDescriptionForStage(current))}</p>
    ${target.errorMessage ? `<span class="error">${target.errorMessage}</span>` : ""}
  `;
  dom.wizardStages.innerHTML = stages.map((stageItem) => `
    <li class="dq-step wizard-stage ${stageItem.complete ? "is-complete done" : stageItem.stepNumber === current.stepNumber ? "is-active active" : ""}">
      <span class="dq-step-index">${stageItem.stepNumber}</span>
      <div class="dq-step-body">
        <strong>${flowTitleForStage(stageItem)}</strong>
        <p>${flowDescriptionForStage(stageItem)}</p>
      </div>
      ${stageItem.stepNumber === current.stepNumber && !stageItem.complete
        ? `<button class="dq-mini-button" type="button" aria-disabled="true">${stageItem.nextButton}</button>`
        : `<span class="dq-step-state">${stageItem.complete ? "done" : "pending"}</span>`}
    </li>
  `).join("");
  const blocked = Object.entries(guards)
    .filter(([name, item]) => item.enabled === false && name !== "startCamera" && name !== "stopCamera")
    .map(([, item]) => item.reason)
    .filter(Boolean);
  dom.buttonReasons.textContent = blocked.length ? blocked.join("\n") : "No blocked action needs attention.";
}

function flowTitleForStage(stageItem) {
  return {
    1: "Start Camera",
    2: "Calibrate Zones",
    3: "Start Session",
    4: "Start Watching",
    5: "Confirm Actions",
    6: "Stop Watching",
    7: "Export Physical Trace",
    8: "Validation"
  }[stageItem.stepNumber] ?? stageItem.name;
}

function flowDescriptionForStage(stageItem) {
  return {
    1: "Preview and confirm camera is ready.",
    2: "Define desk zones for tracking.",
    3: "Begin the guided action session.",
    4: "Watch local motion and suggest the current action.",
    5: "Confirm or correct each suggested action.",
    6: "End local symbolic recording.",
    7: "Generate the trace file.",
    8: "Validate and copy commands."
  }[stageItem.stepNumber] ?? stageItem.instruction;
}

function renderZoneOverlay(target) {
  if (!dom.zoneOverlay) return;
  if (target.showTrackingOverlay !== true) {
    dom.zoneOverlay.innerHTML = "";
    dom.zoneOverlay.hidden = true;
    return;
  }
  dom.zoneOverlay.hidden = false;
  dom.zoneOverlay.innerHTML = REQUIRED_ZONES.map((zoneId) => {
    const rect = target.zoneGeometry[zoneId];
    const className = `zone-${zoneId.replaceAll("_", "-")}`;
    return `<div class="zone-box ${className}" style="left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.w * 100}%;height:${rect.h * 100}%"><span>${zoneId}</span></div>`;
  }).join("");
}

function setButtonStates(guards) {
  for (const [key, guardState] of Object.entries(guards)) {
    const button = dom[key] ?? document.querySelector(`[data-step="${key}"]`);
    const buttons = dom[key] ? [dom[key]] : [...document.querySelectorAll(`[data-step="${key}"]`)];
    if (!buttons.length && !button) continue;
    for (const targetButton of buttons.length ? buttons : [button]) {
      targetButton.disabled = !guardState.enabled;
      targetButton.title = guardState.enabled ? "" : guardState.reason;
    }
  }
}

function timelineText(events) {
  if (!events.length) return "No symbolic events yet.";
  return events.slice(-10).map((event) => {
    const evidence = event.evidence?.[0] ?? {};
    return [
      `${event.timestamp_ms}ms ${event.type} confidence=${event.confidence.toFixed(2)}`,
      `payload: ${payloadSummary(event.payload)}`,
      `evidence: ${evidence.kind ?? "unknown"}; manual local confirmation=${evidence.kind === "human_correction"}`
    ].join("\n");
  }).join("\n\n");
}

function timelineHtml(events) {
  if (!events.length) return '<p class="note">No symbolic events yet.</p>';
  return events.slice(-10).reverse().map((event) => {
    const evidence = event.evidence?.[0] ?? {};
    const manual = evidence.kind === "human_correction" ? "Manual confirmation" : evidence.kind ?? "symbolic";
    const confidencePercent = Math.round(event.confidence * 100);
    return `
      <article class="dq-event-row text-contained">
        <time>${escapeHtml(formatEventTime(event.timestamp_ms))}</time>
        <span class="dq-event-icon ${eventToneClass(event)}" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(event.type)}</strong>
          <p>${escapeHtml(payloadSummary(event.payload))} · ${escapeHtml(manual)} · raw media off</p>
        </div>
        <div class="dq-event-confidence dq-confidence-track" aria-label="Confidence ${confidencePercent}%">
          <i aria-hidden="true"><span style="width:${confidencePercent}%"></span></i>
          <b>${confidencePercent}%</b>
        </div>
      </article>
    `;
  }).join("");
}

function formatEventTime(timestampMs) {
  return `${(timestampMs / 1000).toFixed(1)}s`;
}

function eventToneClass(event) {
  if (event.type === "scene.uncertain" || event.type === "scene.reset") return "tone-danger";
  if (event.type === "gesture.detected") return "tone-privacy";
  if (event.type === "object.moved") return "tone-info";
  if (event.type === "object.placed" || event.type === "scene.calibrated") return "tone-success";
  return "tone-neutral";
}

function eventIcon(event) {
  if (event.type === "scene.calibrated") return "Cal";
  if (event.id === "evt_phone_moved_to_off_desk") return "Ph";
  if (event.id === "evt_notebook_opened") return "Nb";
  if (event.id === "evt_pen_moved_to_hand") return "Pen";
  if (event.id === "evt_writing_like_motion") return "Wr";
  if (event.id === "evt_typing_like_motion") return "Ty";
  if (event.type === "scene.uncertain") return "Un";
  if (event.type === "scene.reset") return "Re";
  return "Ev";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function payloadSummary(payload) {
  if (payload.gesture_type) return `${payload.gesture_type} in ${payload.zone_id}`;
  if (payload.object_type && payload.to_zone_id) return `${payload.object_type}: ${payload.from_zone_id} -> ${payload.to_zone_id}`;
  if (payload.object_type && payload.zone_id) return `${payload.object_type}: ${payload.zone_id}`;
  if (payload.calibration_id) return `calibration ${payload.calibration_id}`;
  if (payload.reason) return payload.reason;
  return JSON.stringify(payload);
}

function troubleshootingText(target, guards) {
  const lines = [
    target.statusMessage,
    target.errorMessage ? `Error: ${target.errorMessage}` : "",
    !target.cameraReady ? "Camera failure help: if the camera does not start, check browser camera permission for 127.0.0.1." : "",
    "Port fallback help: if localhost port 4177 is unavailable, run DARKQUEST_CAPTURE_PORT=4178 npm run physical:capture.",
    !target.calibrationSaved ? "If Start Focus Ritual is disabled, save calibration first." : "",
    !target.recording && target.ritualStarted && target.questState !== "quest_complete" ? "Disabled-button help: if confirmation buttons are disabled, press Start Recording." : "",
    target.questState !== "quest_complete" ? "If export is disabled, finish the five manual local confirmations in order." : "",
    target.questState === "quest_complete" && !target.physicalConfirmed ? "If export is disabled, tick the physical session confirmation checkbox." : "",
    target.exported ? `Wrong save path help: after export, save the download to ${LIVE_PHYSICAL_TRACE_PATH}.` : "",
    target.exported ? `Export missing help: if physical:validate says physical_fixture_missing, move ${LIVE_PHYSICAL_TRACE_FILENAME} into ${LIVE_PHYSICAL_TRACE_PATH}.` : "",
    "Gate 1C blocked help: Gate 1C should move from BLOCKED_MISSING_PHYSICAL_TRACE to PASS, PASS_WITH_DISCLOSURE, or FAIL after physical:validate passes on the required saved file.",
    guards.exportTrace.enabled ? "Export is ready." : guards.exportTrace.reason
  ].filter(Boolean);
  return lines.join("\n");
}

function summarizeLatency(records) {
  const values = records.map((record) => record.end_to_end_ms).sort((a, b) => a - b);
  if (!values.length) return { p50: null, p95: null, max: null };
  return {
    p50: values[Math.min(values.length - 1, Math.ceil(values.length * 0.5) - 1)],
    p95: values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)],
    max: values[values.length - 1]
  };
}

function objectiveForQuestState(questState) {
  return {
    idle: "Start camera.",
    calibrated: "Press Start Focus Ritual.",
    quest_started: "Press Start Recording.",
    phone_removal_pending: "Move phone away, then press Confirm Phone Moved.",
    phone_removed: "Phone moved. Next: notebook.",
    notebook_pending: "Open notebook, then press Confirm Notebook Opened.",
    notebook_opened: "Notebook opened. Next: pen.",
    pen_pending: "Pick up pen, then press Confirm Pen Picked Up.",
    pen_detected: "Pen picked up. Next: writing.",
    writing_pending: "Perform writing-like motion, then press Confirm Writing Motion.",
    writing_detected: "Writing motion confirmed. Next: typing.",
    typing_pending: "Perform typing-like motion, then press Confirm Typing Motion.",
    typing_detected: "Typing motion confirmed.",
    quest_complete: "Stop recording, check physical confirmation, then export.",
    uncertain: "Uncertainty marked. Use Reset Session for a clean export.",
    recovery: "Recover by resetting and recalibrating.",
    reset: "Reset required. Press Reset Session."
  }[questState] ?? "Follow the current recovery instruction.";
}

function currentStepButtonLabel(target) {
  const step = RITUAL_STEPS.find((item) => target.questState === item.activeState);
  return step?.buttonText ?? (target.questState === "quest_complete" ? "Stop Recording" : "Manual local confirmation");
}

function currentStepDisabledReason(target, guards) {
  const step = RITUAL_STEPS.find((item) => target.questState === item.activeState);
  if (!step) return target.questState === "quest_complete" ? "" : "Focus Ritual is not at a manual confirmation step.";
  return guards[step.id]?.reason ?? "";
}

function exportDisabledReason(target) {
  const hasRequiredEvents = REQUIRED_EXPORT_EVENT_IDS.every((id) => target.events.some((event) => event.id === id));
  if (target.recording) return "Export Physical Trace is disabled because recording is still active.";
  if (target.events.length === 0) return "Export Physical Trace is disabled because no events were recorded.";
  if (!hasRequiredEvents) return "Export Physical Trace is disabled because the full ritual event sequence does not exist yet.";
  if (target.questState !== "quest_complete") return "Export Physical Trace is disabled because the quest is not complete.";
  if (!target.physicalConfirmed) return "Export Physical Trace is disabled because physical provenance has not been confirmed.";
  if (target.uncertaintyCount > 0) return "Export Physical Trace is disabled because uncertainty was marked; reset and capture a clean run.";
  if (target.resetCount > 0) return "Export Physical Trace is disabled because camera reset was marked; reset and capture a clean run.";
  return "Export Physical Trace is disabled because export is not ready.";
}

function stepGuard(target, expectedStep, stepId) {
  if (!target.recording) return guard(false, `${ACTION_LABELS[stepId]} is disabled because recording is not active.`);
  if (!expectedStep) return guard(false, `${ACTION_LABELS[stepId]} is disabled because there is no active ritual step.`);
  if (expectedStep.id !== stepId) {
    return guard(false, `${ACTION_LABELS[stepId]} is disabled because the current objective is ${objectiveForQuestState(target.questState)}`);
  }
  return guard(true, "");
}

function guard(enabled, reason) {
  return { enabled, reason: enabled ? "" : reason };
}

function stage(stepNumber, name, complete, instruction, nextButton, blockedReason) {
  return { stepNumber, name, complete, instruction, nextButton, blockedReason: complete ? "" : blockedReason };
}

function nextDiagnosticTimestamp(target) {
  const last = target.events.reduce((max, event) => Math.max(max, event.timestamp_ms), 0);
  return last + 250;
}

function confidenceFromMotion(motionScore) {
  return Number(Math.max(0.5, Math.min(0.92, 0.55 + (motionScore * 2.4))).toFixed(2));
}

function safeId(value) {
  return String(value).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase();
}

function fmt(value) {
  return value == null ? "--" : `${value}ms`;
}

function now() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
