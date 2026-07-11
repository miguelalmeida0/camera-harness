import { executeLocalAutomationAction, actionRiskTier } from "./local-action-adapters.js";
import { matchAutomationRecipes as matchRecipes } from "./recipe-matcher.js";
import { appendAutomationReceipt, createAutomationReceipt } from "./automation-receipts.js";
import { INSTANT_LOCAL_ACTION_TYPES, validateAutomationRecipe as validateRecipe } from "./recipe-store.js";

export const MAX_AUTOMATION_EXECUTIONS_PER_SESSION = 30;

export function createAutomationRuntime(recipes = []) {
  return {
    enabled: true,
    recipes: Array.isArray(recipes) ? recipes : [],
    receipts: [],
    executionReceipts: { max_items: 50, entries: [] },
    executionStatus: "Automation ready",
    counters: {},
    activityLog: [],
    timers: {},
    cooldowns: {},
    sessionRuns: {},
    recipe_run_counts: {},
    idempotencyKeys: [],
    executed_idempotency_keys: [],
    totalExecutions: 0,
    maxExecutions: MAX_AUTOMATION_EXECUTIONS_PER_SESSION,
    matchedCount: 0,
    status: "idle",
    lastStatus: "idle",
    lastSafeMessage: "No automation has run.",
    lastConfirmedSnapshot: null,
    lastEvent: null,
    notificationPermissionAsked: false,
    automationExecutionInFlight: false
  };
}

export function createAutomationRuntimeState(recipes = []) {
  const options = Array.isArray(recipes) ? {} : recipes || {};
  const runtime = createAutomationRuntime(Array.isArray(recipes) ? recipes : options.recipes || []);
  runtime.state = "idle";
  runtime.automation_state = "idle";
  runtime.max_actions_per_movement = boundedInteger(options.max_actions_per_movement, 1, 3, 3);
  runtime.max_actions_per_session = boundedInteger(options.max_actions_per_session, 1, MAX_AUTOMATION_EXECUTIONS_PER_SESSION, 20);
  runtime.maxExecutions = runtime.max_actions_per_session;
  runtime.retry_limit = boundedInteger(options.retry_limit, 0, 1, 0);
  return runtime;
}

export function validateAutomationRecipe(input, options) {
  return validateRecipe(input, options);
}

export function matchAutomationRecipes(snapshot, recipes, context) {
  if (snapshot?.result && Array.isArray(snapshot.recipes)) {
    const result = canonicalResult(snapshot.result);
    const matches = matchRecipes(result, snapshot.recipes, {
      now: snapshot.now_ms,
      cooldowns: snapshot.runtime?.cooldowns,
      sessionRuns: snapshot.runtime?.recipe_run_counts || snapshot.runtime?.sessionRuns,
      maxMatches: snapshot.runtime?.max_actions_per_movement
    });
    return { matches };
  }
  return matchRecipes(snapshot, recipes, context);
}

export function transitionAutomationState(runtime, status, safeMessage = "") {
  const transitions = {
    idle: ["movement_confirmed", "awaiting_confirmation", "planning", "cooldown", "rate_limited"],
    movement_confirmed: ["matching"],
    matching: ["match_found", "rate_limited", "failed"],
    match_found: ["awaiting_consent", "planning"],
    awaiting_consent: ["planning", "cancelled"],
    awaiting_confirmation: ["planning", "executing", "cancelled"],
    planning: ["awaiting_confirmation", "executing", "cancelled", "cooldown", "rate_limited", "failed"],
    executing: ["succeeded", "failed", "cancelled"],
    succeeded: ["awaiting_confirmation", "planning", "cooldown", "rate_limited", "idle"],
    failed: ["awaiting_confirmation", "planning", "cooldown", "rate_limited", "idle"],
    cancelled: ["awaiting_confirmation", "planning", "cooldown", "rate_limited", "idle"],
    cooldown: ["awaiting_confirmation", "planning", "idle"],
    rate_limited: ["awaiting_confirmation", "planning", "idle"]
  };
  if (typeof runtime === "string") {
    const current = runtime;
    if (!transitions[current]?.includes(status)) return invalidTransition(current, runtime);
    return { ok: true, state: status, status, code: "automation_state_transition_ok" };
  }
  const current = runtime.state || runtime.status || runtime.lastStatus || "idle";
  if (current !== status && !transitions[current]?.includes(status)) return invalidTransition(current, runtime);
  runtime.state = String(status || "idle");
  runtime.automation_state = runtime.state;
  runtime.status = String(status || "idle");
  runtime.lastStatus = runtime.status;
  runtime.state_updated_at = Number(safeMessage?.now_ms ?? Date.now());
  if (typeof safeMessage === "string" && safeMessage) runtime.lastSafeMessage = safeMessage.slice(0, 240);
  return runtime;
}

export function freezeConfirmedMovementSnapshot(snapshot, confirmedAt = Date.now()) {
  if (!snapshot) throw new Error("Movement must be confirmed first");
  const frozen = {
    schema_version: "canonical-movement-result.v1",
    movement_result_id: String(snapshot.movement_result_id || snapshot.result_id || "movement_result_unknown"),
    movement: String(snapshot.movement || snapshot.movement_sentence || "Movement confirmed."),
    short_label: String(snapshot.short_label || "Movement"),
    movement_key: String(snapshot.movement_key || "movement"),
    gesture_tags: Object.freeze([...(snapshot.gesture_tags || [])].map(String).slice(0, 12)),
    confidence: Math.max(0, Math.min(1, Number(snapshot.confidence || 0))),
    uncertainty: snapshot.uncertainty === true,
    provider: String(snapshot.provider || "unknown"),
    model: String(snapshot.model || "unknown"),
    confirmed: true,
    confirmed_at: Number(confirmedAt),
    contains_raw_media: false
  };
  return Object.freeze(frozen);
}

export function deterministicExecutionId(resultId, recipeId) {
  return `execution_${safeId(resultId)}_${safeId(recipeId)}`;
}

export function automationIdempotencyKey(resultId, recipeId) {
  const resolvedResultId = typeof resultId === "object" ? resultId.movement_result_id || resultId.result_id || resultId.id : resultId;
  const resolvedRecipeId = typeof recipeId === "object" ? recipeId.recipe_id || recipeId.id : recipeId;
  return `${String(resolvedResultId || "unknown")}:${String(resolvedRecipeId || "unknown")}`;
}

export function automationPolicyDecision(snapshot, recipe, runtime, currentTime = Date.now()) {
  if (runtime?.enabled !== true) return { allowed: false, status: "failed", safe_message: "Automation is disabled" };
  if (!snapshot?.confirmed) return { allowed: false, status: "failed", safe_message: "Movement must be confirmed first" };
  if (snapshot.uncertainty === true) return { allowed: false, status: "cancelled", safe_message: "Uncertain movement cannot run automations" };
  if (runtime.totalExecutions >= runtime.maxExecutions) return { allowed: false, status: "rate_limited", safe_message: "Recipe run limit reached" };
  const recipeId = recipe.recipe_id;
  if (Number(runtime.cooldowns[recipeId] ?? 0) > Number(currentTime)) return { allowed: false, status: "cooldown", safe_message: "Recipe is cooling down" };
  if (Number(runtime.sessionRuns[recipeId] ?? 0) >= Number(recipe.execution_policy?.max_runs_per_session ?? 1)) return { allowed: false, status: "rate_limited", safe_message: "Recipe run limit reached" };
  const riskTier = actionRiskTier(recipe.action.type);
  return {
    allowed: true,
    risk_tier: riskTier,
    requires_additional_confirmation: riskTier === 2 || recipe.execution_policy?.require_per_run_confirmation === true
  };
}

export async function executeAutomationRecipesForConfirmedMovement(options = {}) {
  const snapshot = options.snapshot;
  const runtime = options.runtime;
  const recipes = options.recipes || runtime?.recipes || [];
  if (!runtime) throw new Error("Automation runtime is required.");
  if (options.context?.documentHidden === true || options.context?.document?.hidden === true) {
    runtime.matchedCount = 0;
    runtime.lastSafeMessage = "Automation failed — view safe details";
    return { matches: [], receipts: [] };
  }
  if (!snapshot?.confirmed || snapshot.uncertainty === true || snapshot.movement_key === "uncertain" || runtime.enabled !== true) {
    runtime.matchedCount = 0;
    runtime.lastSafeMessage = !snapshot?.confirmed ? "Movement must be confirmed first" : snapshot?.uncertainty ? "Uncertain movement cannot run automations" : "Automation is disabled";
    return { matches: [], receipts: [] };
  }

  const matches = matchRecipes(snapshot, recipes, {
    now: options.now,
    cooldowns: runtime.cooldowns,
    sessionRuns: runtime.sessionRuns,
    maxMatches: options.maxMatches
  });
  runtime.matchedCount = matches.length;
  const receipts = [];
  for (const recipe of matches) {
    const resultId = snapshot.movement_result_id || snapshot.result_id;
    const recipeId = recipe.recipe_id;
    const idempotencyKey = automationIdempotencyKey(resultId, recipeId);
    if (runtime.idempotencyKeys.includes(idempotencyKey)) continue;
    runtime.idempotencyKeys = [...runtime.idempotencyKeys, idempotencyKey].slice(-100);
    const executionId = deterministicExecutionId(resultId, recipeId);
    const startedAt = Number(options.now ?? Date.now());
    const policy = automationPolicyDecision(snapshot, recipe, runtime, startedAt);
    if (!policy.allowed) {
      receipts.push(record(runtime, receiptFor(recipe, snapshot, executionId, policy.status, startedAt, policy.safe_message)));
      continue;
    }

    let additionalConsentGranted = false;
    if (policy.requires_additional_confirmation) {
      record(runtime, receiptFor(recipe, snapshot, executionId, "awaiting_confirmation", startedAt, consentPromptFor(recipe)));
      const accepted = options.requestConsent?.(consentPromptFor(recipe), recipe) === true;
      if (!accepted) {
        const message = recipe.action.type === "local_snapshot_download" ? "Snapshot confirmation cancelled" : "Automation cancelled";
        receipts.push(record(runtime, receiptFor(recipe, snapshot, executionId, "cancelled", startedAt, message)));
        continue;
      }
      additionalConsentGranted = true;
    }

    record(runtime, receiptFor(recipe, snapshot, executionId, "planning", startedAt, "Automation action planned."));
    runtime.totalExecutions += 1;
    runtime.sessionRuns[recipeId] = Number(runtime.sessionRuns[recipeId] || 0) + 1;
    record(runtime, receiptFor(recipe, snapshot, executionId, "executing", startedAt, "Automation is running."));
    try {
      const outcome = await (options.actionExecutor || executeLocalAutomationAction)({
        recipe,
        snapshot,
        executionId,
        runtime,
        context: { ...options.context, userGesture: options.userGesture === true, additionalConsentGranted }
      });
      runtime.cooldowns[recipeId] = Date.now() + Number(recipe.execution_policy?.cooldown_ms || 0);
      receipts.push(record(runtime, receiptFor(recipe, snapshot, executionId, "succeeded", startedAt, outcome?.safe_message || "Automation completed.")));
    } catch (error) {
      receipts.push(record(runtime, receiptFor(recipe, snapshot, executionId, "failed", startedAt, safeAutomationErrorMessage(error))));
    }
  }
  runtime.lastStatus = receipts.at(-1)?.status || (matches.length ? "completed" : "no_match");
  runtime.lastSafeMessage = receipts.at(-1)?.safe_message || (matches.length ? "Automation already handled." : "No automation recipe matched.");
  return { matches, receipts };
}

export async function runAutomationForConfirmedMovement(options = {}) {
  const source = options.result || options.snapshot || {};
  if (!source.confirmed) return { matches: [], receipts: [], code: "automation_before_confirmation" };
  if (source.uncertainty === true) return { matches: [], receipts: [], code: "automation_from_uncertain_result" };
  if (source.rejected === true) return { matches: [], receipts: [], code: "automation_from_rejected_result" };
  const runtime = options.runtime || options.runtimeState || createAutomationRuntimeState(options.recipes || []);
  if (runtime.automationExecutionInFlight === true) return { matches: [], receipts: [], code: "automation_recursive_execution" };
  runtime.automationExecutionInFlight = true;
  try {
    return await executeAutomationRecipesForConfirmedMovement({
      ...options,
      snapshot: canonicalResult(source),
      runtime,
      now: options.now ?? options.now_ms,
      maxMatches: runtime.max_actions_per_movement,
      actionExecutor: options.actionExecutor || options.execute_action || options.executeAction
    });
  } finally {
    runtime.automationExecutionInFlight = false;
  }
}

export async function runAutomationForStableLocalGesture({
  gestureEvent,
  recipes = [],
  runtimeState,
  adapters,
  context = {}
} = {}) {
  const runtime = runtimeState;
  if (!runtime) throw new Error("Automation runtime is required.");
  if (context.instantGesturesEnabled !== true) return instantOutcome("instant_gesture_not_enabled");
  if ((context.cameraActive ?? context.cameraReady) !== true) return instantOutcome("instant_camera_inactive");
  if (context.documentHidden === true || context.documentVisible === false) return instantOutcome("instant_document_hidden");
  if (context.engineStatus && !String(context.engineStatus).startsWith("ready")) return instantOutcome("instant_engine_unavailable");
  if (!validStableGestureEvent(gestureEvent)) return instantOutcome("instant_gesture_invalid_event");
  if (runtime.enabled !== true) return instantOutcome("instant_recipe_not_enabled");
  if (runtime.automationExecutionInFlight === true) return instantOutcome("instant_recursive_analysis");
  if (runtime.totalExecutions >= runtime.maxExecutions) return instantOutcome("instant_session_limit_reached");

  const timestampMs = Number(gestureEvent.stable_at_ms ?? Date.now());
  const duplicate = recipes.some((recipe) => recipe?.enabled === true && recipe.execution_mode === "instant_local_gesture" && recipe.trigger?.gesture_key === gestureEvent.gesture_key
    && (gestureEvent.source !== "custom_local_skill" || recipe.trigger?.custom_skill_id === gestureEvent.custom_skill_id)
    && runtime.idempotencyKeys.includes(automationIdempotencyKey(gestureEvent.gesture_event_id, recipe.recipe_id)));
  if (duplicate) return instantOutcome("instant_gesture_duplicate");
  const matches = recipes
    .filter((recipe) => recipe?.enabled === true)
    .filter((recipe) => recipe.execution_mode === "instant_local_gesture")
    .filter((recipe) => recipe.consent?.run_instantly === true)
    .filter((recipe) => recipe.trigger?.source === gestureEvent.source)
    .filter((recipe) => gestureEvent.source !== "custom_local_skill" || recipe.trigger?.custom_skill_id === gestureEvent.custom_skill_id)
    .filter((recipe) => recipe.trigger?.gesture_key === gestureEvent.gesture_key)
    .filter((recipe) => Number(gestureEvent.confidence || 0) >= Number(recipe.trigger?.minimum_confidence ?? 0.7))
    .filter((recipe) => Number(gestureEvent.held_for_ms || 0) >= Number(recipe.trigger?.hold_ms ?? 350))
    .filter((recipe) => INSTANT_LOCAL_ACTION_TYPES.includes(recipe.action?.type))
    .filter((recipe) => recipe.action?.type !== "browser_notification" || notificationPermission(context) === "granted")
    .filter((recipe) => Number(runtime.cooldowns?.[recipe.recipe_id] || 0) <= timestampMs)
    .filter((recipe) => Number(runtime.sessionRuns?.[recipe.recipe_id] || 0) < Number(recipe.execution_policy?.max_runs_per_session ?? 10))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || a.recipe_id.localeCompare(b.recipe_id))
    .slice(0, 3);

  if (!matches.length) return instantOutcome(instantSuppressionCode({ gestureEvent, recipes, runtime, context, timestampMs }));

  const receipts = [];
  let lastFailureCode = "";
  const execute = typeof adapters === "function"
    ? adapters
    : adapters?.executeLocalAutomationAction || executeLocalAutomationAction;
  runtime.automationExecutionInFlight = true;
  try {
    for (const recipe of matches) {
      const idempotencyKey = automationIdempotencyKey(gestureEvent.gesture_event_id, recipe.recipe_id);
      runtime.idempotencyKeys = [...runtime.idempotencyKeys, idempotencyKey].slice(-100);
      runtime.executed_idempotency_keys = [...runtime.idempotencyKeys];
      const executionId = deterministicExecutionId(gestureEvent.gesture_event_id, recipe.recipe_id);
      runtime.totalExecutions += 1;
      runtime.sessionRuns[recipe.recipe_id] = Number(runtime.sessionRuns[recipe.recipe_id] || 0) + 1;
      runtime.recipe_run_counts[recipe.recipe_id] = runtime.sessionRuns[recipe.recipe_id];
      runtime.status = "executing";
      runtime.lastStatus = "executing";
      try {
        const outcome = await execute({
          recipe,
          snapshot: {
            movement_result_id: gestureEvent.gesture_event_id,
            movement: gestureEvent.gesture_key,
            movement_key: gestureEvent.gesture_key,
            confidence: gestureEvent.confidence,
            confirmed: false,
            contains_raw_media: false
          },
          executionId,
          idempotency_key: idempotencyKey,
          runtime,
          context: { ...context, instantLocalGesture: true }
        }, context);
        runtime.cooldowns[recipe.recipe_id] = timestampMs + Number(recipe.execution_policy?.cooldown_ms ?? 3000);
        const message = recipe.action.type === "speak_phrase"
          ? `Completed: said “${String(recipe.action.config?.text ?? recipe.action.config?.phrase ?? recipe.action.config?.value ?? "").trim().slice(0, 180)}”`
          : outcome?.safe_message || "Automation completed.";
        receipts.push(record(runtime, createAutomationReceipt({
          execution_id: executionId,
          recipe_id: recipe.recipe_id,
          movement_result_id: gestureEvent.gesture_event_id,
          action_type: recipe.action.type,
          status: "succeeded",
          started_at: timestampMs,
          finished_at: Date.now(),
          safe_message: message,
          contains_raw_media: false
        })));
      } catch (error) {
        lastFailureCode = error?.code === "speech_phrase_missing"
          ? "instant_speech_phrase_missing"
          : ["voice_unavailable", "speech_not_started"].includes(error?.code)
            ? "instant_speech_failed"
            : "instant_action_failed";
        receipts.push(record(runtime, createAutomationReceipt({
          execution_id: executionId,
          recipe_id: recipe.recipe_id,
          movement_result_id: gestureEvent.gesture_event_id,
          action_type: recipe.action.type,
          status: "failed",
          started_at: timestampMs,
          finished_at: Date.now(),
          safe_message: safeAutomationErrorMessage(error),
          contains_raw_media: false
        })));
      }
    }
  } finally {
    runtime.automationExecutionInFlight = false;
  }
  runtime.matchedCount = matches.length;
  runtime.lastStatus = receipts.at(-1)?.status || (matches.length ? "completed" : "no_match");
  runtime.lastSafeMessage = receipts.at(-1)?.safe_message || "No instant gesture recipe matched.";
  const succeeded = receipts.some((receipt) => receipt.status === "succeeded");
  const code = succeeded ? "instant_action_executed" : lastFailureCode || "instant_action_failed";
  return {
    matches,
    receipts,
    code,
    outcome_codes: succeeded
      ? ["instant_gesture_stable", "instant_recipe_matched", "instant_action_executed", "instant_action_receipt_created"]
      : [code]
  };
}

function instantSuppressionCode({ gestureEvent, recipes, runtime, context, timestampMs }) {
  const relevant = recipes.filter((recipe) => recipe?.trigger?.gesture_key === gestureEvent.gesture_key
    && (gestureEvent.source !== "custom_local_skill" || recipe.trigger?.custom_skill_id === gestureEvent.custom_skill_id));
  if (!relevant.length) return "instant_recipe_not_enabled";
  const instant = relevant.filter((recipe) => recipe.execution_mode === "instant_local_gesture");
  if (!instant.length) return "instant_recipe_wrong_mode";
  const enabled = instant.filter((recipe) => recipe.enabled === true && recipe.consent?.run_instantly === true);
  if (!enabled.length) return "instant_recipe_not_enabled";
  const actionTypes = enabled.map((recipe) => recipe.action?.type);
  if (actionTypes.includes("local_snapshot_download")) return "instant_snapshot_forbidden";
  if (actionTypes.includes("signed_webhook_post")) return "instant_webhook_forbidden";
  if (actionTypes.some((type) => /(?:ai|llm|vlm|movement_recognition|provider)/i.test(String(type)))) return "instant_ai_call_forbidden";
  if (actionTypes.some((type) => !INSTANT_LOCAL_ACTION_TYPES.includes(type))) return "instant_action_not_allowlisted";
  if (enabled.some((recipe) => recipe.action?.type === "browser_notification") && notificationPermission(context) !== "granted") return "instant_notification_permission_required";
  if (enabled.every((recipe) => Number(gestureEvent.confidence) < Number(recipe.trigger?.minimum_confidence ?? 0.7))) return "instant_gesture_below_threshold";
  if (enabled.every((recipe) => Number(gestureEvent.held_for_ms || 0) < Number(recipe.trigger?.hold_ms ?? 350))) return "instant_gesture_hold_not_met";
  if (enabled.every((recipe) => Number(runtime.cooldowns?.[recipe.recipe_id] || 0) > timestampMs)) return "instant_gesture_cooldown_active";
  if (enabled.every((recipe) => Number(runtime.sessionRuns?.[recipe.recipe_id] || 0) >= Number(recipe.execution_policy?.max_runs_per_session ?? 20))) return "instant_session_limit_reached";
  return "instant_recipe_not_enabled";
}

function validStableGestureEvent(event) {
  return Boolean(event)
    && (event.schema_version === "stable-local-gesture-event.v1" || (event.source === "custom_local_skill" && event.schema_version === "stable-custom-skill-event.v1"))
    && typeof event.gesture_event_id === "string" && event.gesture_event_id.length > 0
    && typeof event.gesture_key === "string" && event.gesture_key.length > 0
    && ["mediapipe_gesture", "custom_local_skill"].includes(event.source)
    && (event.source !== "custom_local_skill" || /^skill_[a-zA-Z0-9_-]{8,80}$/.test(String(event.custom_skill_id || "")))
    && Number.isFinite(Number(event.confidence))
    && Number.isFinite(Number(event.first_seen_ms))
    && Number.isFinite(Number(event.stable_at_ms))
    && Number(event.held_for_ms) === Number(event.stable_at_ms) - Number(event.first_seen_ms)
    && [1, 2].includes(Number(event.hand_count))
    && event.requires_neutral_reset === true
    && event.neutral_reset_completed === false
    && event.contains_raw_media === false;
}

function notificationPermission(context) {
  return context.Notification?.permission || context.notificationPermission || "default";
}

function instantOutcome(code) {
  return { matches: [], receipts: [], code, outcome_codes: [code] };
}

export function dryRunAutomationRecipe(recipe, snapshot, runtime, timestamp = Date.now()) {
  const confirmed = snapshot?.confirmed ? snapshot : { ...snapshot, confirmed: true };
  const policy = automationPolicyDecision(confirmed, recipe, runtime);
  const resultId = snapshot?.movement_result_id || snapshot?.result_id || "movement";
  const executionId = `dry_run_${safeId(resultId)}_${safeId(recipe.recipe_id)}`;
  const destinationHost = recipe.action.type === "signed_webhook_post" ? String(recipe.action.config?.destination_id || "unconfigured") : "";
  const receipt = receiptFor(
    recipe,
    confirmed,
    executionId,
    "planning",
    timestamp,
    `Dry run: ${recipe.action.type}; risk tier ${policy.risk_tier || actionRiskTier(recipe.action.type)}; additional confirmation ${policy.requires_additional_confirmation ? "required" : "not required"}${destinationHost ? `; destination ${destinationHost}` : ""}.`,
    true
  );
  return record(runtime, receipt);
}

export function clearAutomationRuntimeData(runtime) {
  runtime.receipts = [];
  runtime.counters = {};
  runtime.activityLog = [];
  runtime.status = "idle";
  runtime.lastStatus = "idle";
  runtime.lastSafeMessage = "Automation data cleared.";
  return runtime;
}

function record(runtime, receipt) {
  runtime.receipts = appendAutomationReceipt(runtime.receipts, receipt);
  runtime.executionReceipts ||= { max_items: 50, entries: [] };
  runtime.executionReceipts.entries = appendAutomationReceipt(runtime.executionReceipts.entries, receipt, runtime.executionReceipts.max_items);
  runtime.executionStatus = receipt.status === "executing" || receipt.status === "planning" || receipt.status === "awaiting_confirmation"
    ? "Running"
    : receipt.status === "succeeded" ? "Completed" : receipt.status === "failed" || receipt.status === "rate_limited" ? "Failed" : "Automation ready";
  transitionAutomationState(runtime, receipt.status, receipt.safe_message);
  return receipt;
}

function receiptFor(recipe, snapshot, executionId, status, startedAt, message, dryRun = false) {
  return createAutomationReceipt({
    execution_id: executionId,
    recipe_id: recipe.recipe_id,
    movement_result_id: snapshot.movement_result_id || snapshot.result_id,
    action_type: recipe.action.type,
    status,
    started_at: startedAt,
    finished_at: Date.now(),
    safe_message: message,
    contains_raw_media: false,
    dry_run: dryRun
  });
}

function consentPromptFor(recipe) {
  if (recipe.action.type === "local_snapshot_download") return "Download a snapshot for this confirmed movement?";
  return `Run ${recipe.name}?`;
}

function safeAutomationErrorMessage(error) {
  const allowed = new Set([
    "Automation is disabled",
    "Movement must be confirmed first",
    "Recipe is cooling down",
    "Recipe run limit reached",
    "Notification permission denied",
    "Snapshot confirmation cancelled",
    "Webhook destination is not approved",
    "Webhook timed out",
    "Voice unavailable",
    "Speech phrase missing"
  ]);
  return allowed.has(error?.message) ? error.message : "Automation failed — view safe details";
}

function safeId(value) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
}

function canonicalResult(source = {}) {
  return {
    ...source,
    movement_result_id: source.movement_result_id || source.result_id || "movement_result_unknown",
    movement: source.movement || source.movement_sentence || source.corrected_movement || "Movement confirmed.",
    short_label: source.short_label || source.label || "Movement",
    movement_key: source.corrected === true
      ? source.canonical_movement_key || source.corrected_movement_key || source.movement_key
      : source.movement_key,
    gesture_tags: source.gesture_tags || [],
    confirmed: source.confirmed === true,
    uncertainty: source.uncertainty === true
  };
}

function invalidTransition(current, runtime) {
  return { ok: false, code: "automation_invalid_transition", state: current, status: current, runtime };
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function stateTransitionError(current, next) {
  const error = new Error(`Invalid automation state transition: ${current} -> ${next}`);
  error.code = "automation_state_transition_invalid";
  return error;
}

function safeDestinationHost(value) {
  try {
    return new URL(String(value || "")).host;
  } catch {
    return "unconfigured";
  }
}
