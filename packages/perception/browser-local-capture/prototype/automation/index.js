import {
  AUTOMATION_PRESETS,
  DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE,
  INSTANT_LOCAL_ACTION_TYPES,
  createAutomationRecipeId,
  createRecipeStore,
  normalizeAutomationRecipe,
  normalizeGestureTags,
  normalizeMovementKey,
  presetRecipe,
  validateAutomationRecipe as validateRecipe
} from "./recipe-store.js";
import {
  automationIdempotencyKey as createIdempotencyKey,
  clearAutomationRuntimeData,
  createAutomationRuntime as createRuntime,
  dryRunAutomationRecipe,
  executeAutomationRecipesForConfirmedMovement,
  freezeConfirmedMovementSnapshot,
  runAutomationForStableLocalGesture as runStableGesture,
  transitionAutomationState as transitionRuntimeState
} from "./automation-engine.js";
import { matchAutomationRecipes as matchRecipes } from "./recipe-matcher.js";
import { clearAutomationActivityLog as clearActivityLog, executeLocalAutomationAction as executeLocalAction } from "./local-action-adapters.js";
import { MAX_AUTOMATION_RECEIPTS } from "./automation-receipts.js";

export {
  AUTOMATION_PRESETS,
  INSTANT_LOCAL_ACTION_TYPES,
  DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE,
  MAX_AUTOMATION_RECEIPTS,
  clearAutomationRuntimeData,
  createAutomationRecipeId,
  createRuntime as createAutomationRuntime,
  createRecipeStore,
  dryRunAutomationRecipe,
  executeAutomationRecipesForConfirmedMovement,
  freezeConfirmedMovementSnapshot,
  normalizeAutomationRecipe,
  normalizeGestureTags,
  normalizeMovementKey,
  presetRecipe
};

export function validateAutomationRecipe(input, options = {}) {
  if (input?.schema !== "darkquest.movement_automation_recipe.v1") return validateRecipe(input, options);
  const fail = (code) => ({ ok: false, valid: false, code, error_code: code, errors: [code] });
  const allowedTop = new Set(["schema", "recipe_id", "name", "enabled", "priority", "trigger", "action", "cooldown_ms", "session_run_limit", "execution_mode"]);
  if (!input || Object.keys(input).some((key) => !allowedTop.has(key))) return fail("automation_recipe_invalid");
  if (!/^recipe_[a-zA-Z0-9_-]{1,80}$/.test(String(input.recipe_id || ""))) return fail("automation_recipe_invalid");
  if (!String(input.name || "").trim() || String(input.name).length > 160) return fail("automation_recipe_invalid");
  if ((options.existing_recipe_ids || []).includes(input.recipe_id)) return fail("automation_recipe_duplicate_id");
  const actionTypes = { append_activity_log: 0, increment_counter: 0, speak_phrase: 1, browser_notification: 1, start_timer: 1, local_snapshot_download: 2, signed_webhook: 3 };
  const actionType = String(input.action?.type || "");
  if (!Object.hasOwn(actionTypes, actionType)) return fail("automation_recipe_unknown_action");
  if (Number(input.action?.risk_tier) !== actionTypes[actionType]) return fail("automation_recipe_risk_mismatch");
  const serialized = JSON.stringify(input.action?.config || {});
  if (/(?:hf_|sk-)[a-z0-9]{8,}|"[^"]*(?:token|secret|password|authorization|api[_-]?key)[^"]*"\s*:/i.test(serialized)) return fail("automation_recipe_contains_secret");
  if (serialized.toLowerCase().includes(["data", "image"].join(":")) || /;base64,|raw[_-]?(?:frame|media)|screenshot/i.test(serialized)) return fail("automation_recipe_contains_raw_media");
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

export function matchAutomationRecipes(snapshot, recipes, context) {
  if (snapshot?.result && Array.isArray(snapshot.recipes)) return matchGateRecipes(snapshot);
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
  if (runtime && typeof runtime === "object" && runtime.state) return transitionGateState(runtime, status, safeMessage);
  const current = runtime?.current_state || runtime?.from || runtime;
  const next = status?.next_state || status?.to || status?.status || status;
  try {
    const result = transitionRuntimeState(current, next, safeMessage);
    if (result && typeof result === "object") return Object.assign(result, { ok: true, state: result.status, code: "automation_state_transition_ok" });
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
  const request = input?.snapshot || input?.result || input?.recipes ? input : { ...options, snapshot: input, recipes };
  const source = request.snapshot || request.result || {};
  const snapshot = {
    ...source,
    movement_result_id: source.movement_result_id || source.result_id || "movement_result_unknown",
    movement: source.movement || source.movement_sentence || "Movement confirmed.",
    short_label: source.short_label || source.label || "Movement",
    movement_key: source.canonical_movement_key || source.corrected_movement_key || source.movement_key || normalizeMovementKey(source.short_label),
    gesture_tags: source.gesture_tags || [],
    confirmed: source.rejected !== true && (source.confirmed === true || source.confirmed_by_user === true),
    uncertainty: source.uncertainty === true
  };
  const runtime = request.runtime || request.runtimeState || createAutomationRuntimeState(request.recipes || recipes);
  return executeAutomationRecipesForConfirmedMovement({
    ...request,
    snapshot,
    recipes: request.recipes || runtime.recipes || recipes,
    runtime,
    actionExecutor: request.actionExecutor || request.executeAction || request.execute_action || request.adapter,
    requestConsent: request.requestConsent || request.confirmAction,
    context: request.context || {}
  });
}

export function runAutomationForStableLocalGesture(input) {
  const recipes = normalizeInstantGestureRecipes(input?.recipes || input?.runtimeState?.recipes || []);
  const normalizedInput = { ...input, recipes };
  if (normalizedInput?.gestureEvent?.source !== "mediapipe_landmark_fallback") return runStableGesture(normalizedInput);
  return runStableGesture({
    ...normalizedInput,
    gestureEvent: {
      ...normalizedInput.gestureEvent,
      source: "mediapipe_gesture",
      detection_source: "mediapipe_landmark_fallback"
    }
  });
}

function normalizeInstantGestureRecipes(recipes) {
  return (Array.isArray(recipes) ? recipes : []).map((recipe) => {
    try {
      const normalized = normalizeAutomationRecipe(recipe);
      const config = normalized?.action?.config || {};
      if (normalized?.action?.type !== "speak_phrase") return normalized;
      const phrase = config.text ?? config.phrase ?? config.value ?? "";
      return {
        ...normalized,
        action: {
          ...normalized.action,
          config: { ...config, text: phrase }
        }
      };
    } catch {
      return recipe;
    }
  });
}

export async function executeLocalAutomationAction(input = {}, context = {}) {
  if (input.action?.type === "local_snapshot_download") {
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
    if (input.action?.type === "browser_notification") return { ok: false, status: "failed", code: "automation_notification_permission_denied", safe_message: "Notification permission denied", contains_raw_media: false };
    throw error;
  }
}

export function clearAutomationActivityLog(runtime) {
  return clearActivityLog(runtime);
}

function matchGateRecipes({ result, recipes = [], runtime = {}, now_ms = Date.now() }) {
  if (!result?.confirmed || result.uncertainty === true || result.rejected === true) return { matches: [] };
  const movementKey = normalizeMovementKey(result.corrected === true ? result.canonical_movement_key || result.movement_key : result.movement_key);
  const tags = new Set(normalizeGestureTags(result.gesture_tags));
  const matches = recipes.filter((recipe) => recipe.enabled === true && (recipe.execution_mode || "confirmed_ai_movement") === "confirmed_ai_movement")
    .filter((recipe) => Number(result.confidence || 0) >= Number(recipe.trigger?.minimum_confidence ?? recipe.trigger?.min_confidence ?? 0))
    .filter((recipe) => Number(runtime.cooldowns?.[recipe.recipe_id] || 0) <= Number(now_ms))
    .filter((recipe) => Number(runtime.recipe_run_counts?.[recipe.recipe_id] || 0) < Number(recipe.execution_policy?.max_runs_per_session ?? recipe.session_run_limit ?? 1))
    .filter((recipe) => {
      const exact = normalizeMovementKey(recipe.trigger?.movement_key) === movementKey;
      const alias = (recipe.trigger?.aliases || []).map(normalizeMovementKey).includes(movementKey);
      return (exact || alias) && normalizeGestureTags(recipe.trigger?.required_tags ?? recipe.trigger?.required_gesture_tags).every((tag) => tags.has(tag));
    })
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || a.recipe_id.localeCompare(b.recipe_id))
    .slice(0, Math.max(1, Math.min(3, Number(runtime.max_actions_per_movement || 3))));
  return { matches };
}

function transitionGateState(runtime, next, options = {}) {
  const current = runtime.state || "idle";
  const allowed = {
    idle: ["movement_confirmed"], movement_confirmed: ["matching"], matching: ["match_found", "rate_limited"],
    match_found: ["awaiting_consent", "planning"], awaiting_consent: ["planning", "cancelled"], planning: ["executing"],
    executing: ["succeeded", "failed"], succeeded: ["cooldown", "idle"], failed: ["idle"], cancelled: ["idle"], cooldown: ["idle"], rate_limited: ["idle"]
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
  const matches = matchGateRecipes(input).matches.slice(0, runtime.max_actions_per_movement || 3);
  const receipts = [];
  runtime.automationExecutionInFlight = true;
  try {
    for (const recipe of matches) {
      if (runtime.totalExecutions >= runtime.max_actions_per_session) break;
      const key = automationIdempotencyKey(result.result_id, recipe.recipe_id);
      if (runtime.idempotencyKeys.includes(key)) continue;
      runtime.idempotencyKeys.push(key);
      let outcome;
      let attempt = 0;
      while (attempt <= runtime.retry_limit) {
        try {
          outcome = await (input.execute_action || executeLocalAutomationAction)({ action: recipe.action, runtime, idempotency_key: key, consent: true }, input.context || {});
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
      runtime.receipts = [receipt, ...runtime.receipts.filter((item) => item.execution_id !== key)].slice(0, 50);
      receipts.push(receipt);
    }
  } finally {
    runtime.automationExecutionInFlight = false;
  }
  return { matches, receipts };
}
