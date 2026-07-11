export const AUTOMATION_RECIPE_STORAGE_KEY = "darkquest.automation_recipes.v1";
export const AUTOMATION_RECIPE_SCHEMA_VERSION = "movement-automation-recipe.v1-1";
export const AUTOMATION_RECIPE_LEGACY_SCHEMA_VERSION = "movement-automation-recipe.v1";
export const DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE = 0.7;
const ACCEPTED_AUTOMATION_RECIPE_SCHEMAS = new Set([
  AUTOMATION_RECIPE_SCHEMA_VERSION,
  AUTOMATION_RECIPE_LEGACY_SCHEMA_VERSION,
  "darkquest.movement_automation_recipe.v1-1",
  "darkquest.movement_automation_recipe.v1"
]);
export const MAX_AUTOMATION_RECIPES = 50;
const AUTOMATION_RECIPE_ID_PATTERN = /^recipe_[a-zA-Z0-9_-]{1,80}$/;
export const AUTOMATION_EXECUTION_MODES = Object.freeze(["confirmed_ai_movement", "instant_local_gesture"]);
export const INSTANT_LOCAL_ACTION_TYPES = Object.freeze([
  "speak_phrase",
  "browser_notification",
  "start_timer",
  "increment_counter",
  "append_activity_log"
]);

export const AUTOMATION_ACTION_TYPES = Object.freeze([
  "speak_phrase",
  "browser_notification",
  "start_timer",
  "increment_counter",
  "append_activity_log",
  "local_snapshot_download",
  "signed_webhook_post"
]);

const ACTION_CONFIG_FIELDS = Object.freeze({
  speak_phrase: ["text", "phrase"],
  browser_notification: ["title", "body"],
  start_timer: ["duration_seconds"],
  increment_counter: ["counter_name"],
  append_activity_log: ["category"],
  local_snapshot_download: ["filename_prefix"],
  signed_webhook_post: ["destination_id", "secret_ref", "payload_label"]
});

export const AUTOMATION_PRESETS = Object.freeze([
  instantPreset("preset_thumbs_up_encouragement", "Thumbs up automation", "thumbs_up", "speak_phrase", { text: "GREAT JOB" }),
  preset("preset_peace_sign_snapshot", "Peace sign snapshot", "peace_sign", "local_snapshot_download", { filename_prefix: "darkquest-peace-sign" }, "per_run"),
  preset("preset_thumbs_up_counter", "Thumbs up completion counter", "thumbs_up", "increment_counter", { counter_name: "completions" }),
  preset("preset_raised_hand_timer", "Raised hand timer", "raised_hand", "start_timer", { duration_seconds: 60 }),
  preset("preset_workout_logger", "Workout activity logger", "", "append_activity_log", { category: "workout" }),
  preset("preset_presentation_webhook", "Presentation next webhook", "swipe_right", "signed_webhook_post", { destination_id: "presentation", secret_ref: "DARKQUEST_WEBHOOK_SECRET_PRESENTATION", payload_label: "presentation_next" }),
  preset("preset_spoken_response", "Spoken response", "", "speak_phrase", { phrase: "Movement confirmed." }),
  preset("preset_browser_notification", "Browser notification", "", "browser_notification", { title: "DarkQuest", body: "Movement confirmed." })
]);

export function createAutomationRecipeId(existingIds = []) {
  const usedIds = new Set(Array.from(existingIds || [], (value) => String(value?.recipe_id || value?.id || value || "")));
  const cryptoApi = globalThis.crypto;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    let token = cryptoApi?.randomUUID?.();
    if (!token && cryptoApi?.getRandomValues) {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
      token = `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
    }
    if (!token) throw new Error("Secure automation recipe identity is unavailable.");
    const candidate = `recipe_${token}`;
    if (AUTOMATION_RECIPE_ID_PATTERN.test(candidate) && !usedIds.has(candidate)) return candidate;
  }
  throw new Error("Could not create a unique automation recipe identity.");
}

export function createRecipeStore(storage = browserStorage(), options = {}) {
  const loaded = loadRecipeDocument(storage);
  let document = loaded.document;
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : createAutomationRecipeId;
  const list = () => clone(document.recipes);
  const commit = (nextDocument) => {
    storage?.setItem?.(AUTOMATION_RECIPE_STORAGE_KEY, JSON.stringify(nextDocument));
    document = nextDocument;
  };
  const create = (input) => {
    if (document.recipes.length >= MAX_AUTOMATION_RECIPES) throw new Error("Maximum automation recipe count reached.");
    const currentRecipes = list();
    const existingIds = new Set(currentRecipes.map((recipe) => recipe.recipe_id));
    const suppliedId = String(input?.recipe_id || input?.id || "");
    const recipeId = AUTOMATION_RECIPE_ID_PATTERN.test(suppliedId)
      ? suppliedId
      : allocateRecipeId(existingIds, idFactory);
    const recipe = normalizeAutomationRecipe({
      ...input,
      schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION,
      recipe_id: recipeId
    }, { existingIds });
    commit({
      schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION,
      recipes: [...currentRecipes, recipe]
    });
    return clone(recipe);
  };
  const update = (id, patch) => {
    const currentRecipes = list();
    const index = currentRecipes.findIndex((item) => item.recipe_id === id);
    if (index < 0) throw new Error("Automation recipe not found.");
    const existingIds = new Set(currentRecipes.filter((_, recipeIndex) => recipeIndex !== index).map((recipe) => recipe.recipe_id));
    const recipe = normalizeAutomationRecipe({ ...currentRecipes[index], ...patch, recipe_id: id }, { existingIds });
    const nextRecipes = [...currentRecipes];
    nextRecipes[index] = recipe;
    commit({ schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION, recipes: nextRecipes });
    return clone(recipe);
  };

  if (loaded.shouldPersist) {
    try {
      storage?.setItem?.(AUTOMATION_RECIPE_STORAGE_KEY, JSON.stringify(document));
    } catch {
      // Keep repaired recipes available in memory when browser storage is unavailable.
    }
  }

  return {
    list,
    create,
    save(input, options = {}) {
      const existingId = String(options.existingId || options.recipeId || "");
      return existingId ? update(existingId, input) : create(input);
    },
    read(id) {
      const recipe = document.recipes.find((item) => item.recipe_id === id);
      return recipe ? clone(recipe) : null;
    },
    update,
    setEnabled(id, enabled) {
      return update(id, { enabled: enabled === true });
    },
    delete(id) {
      const nextRecipes = document.recipes.filter((item) => item.recipe_id !== id);
      if (nextRecipes.length === document.recipes.length) return false;
      commit({ schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION, recipes: nextRecipes });
      return true;
    },
    exportConfiguration() {
      return JSON.stringify({ schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION, recipes: list() }, null, 2);
    },
    importConfiguration(value) {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      const migrated = migrateRecipeDocument(parsed);
      const nextDocument = {
        schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION,
        recipes: normalizeRecipeCollection(migrated.recipes.slice(0, MAX_AUTOMATION_RECIPES))
      };
      commit(nextDocument);
      return list();
    }
  };
}

export function readRecipeDocument(storage = browserStorage()) {
  return loadRecipeDocument(storage).document;
}

function loadRecipeDocument(storage) {
  try {
    const raw = storage?.getItem?.(AUTOMATION_RECIPE_STORAGE_KEY);
    if (!raw) return { document: emptyRecipeDocument(), shouldPersist: false };
    const parsed = JSON.parse(raw);
    const migrated = migrateRecipeDocument(parsed);
    const document = {
      schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION,
      recipes: normalizeRecipeCollection(migrated.recipes.slice(0, MAX_AUTOMATION_RECIPES), { touch: false })
    };
    return { document, shouldPersist: JSON.stringify(parsed) !== JSON.stringify(document) };
  } catch {
    return { document: emptyRecipeDocument(), shouldPersist: false };
  }
}

export function normalizeAutomationRecipe(input = {}, options = {}) {
  const now = Date.now();
  if (!input || typeof input !== "object" || Array.isArray(input)) throw validationError("Invalid automation recipe.", "automation_recipe_invalid");
  const rawId = String(input.recipe_id || input.id || "");
  if (!AUTOMATION_RECIPE_ID_PATTERN.test(rawId)) throw validationError("Automation recipe requires a valid id.", "automation_recipe_invalid");
  const suppliedName = String(input.name || "").trim();
  const rawName = suppliedName === "Thumbs up encouragement" ? "Thumbs up automation" : suppliedName;
  if (!rawName || rawName.length > 80) throw validationError("Automation recipe name is invalid.", "automation_recipe_invalid");
  const inputSchema = input.schema || input.schema_version;
  if (!ACCEPTED_AUTOMATION_RECIPE_SCHEMAS.has(inputSchema)) {
    throw validationError("Unsupported automation recipe schema version.", "automation_recipe_invalid");
  }
  const action = input.action || (input.action_type ? { type: input.action_type, config: input.config || {} } : {});
  const actionType = String(action.type || "");
  if (!AUTOMATION_ACTION_TYPES.includes(actionType)) throw validationError("Unsupported automation action.", "automation_recipe_unknown_action");
  assertSafeRecipeConfiguration(input);
  const executionMode = AUTOMATION_EXECUTION_MODES.includes(input.execution_mode)
    ? input.execution_mode
    : "confirmed_ai_movement";
  if (executionMode === "instant_local_gesture" && !INSTANT_LOCAL_ACTION_TYPES.includes(actionType)) {
    throw validationError("This action requires confirmation and cannot run instantly.", "automation_instant_action_requires_confirmation");
  }
  const riskTier = actionRiskTier(actionType);
  const declaredRisk = input.risk_tier ?? action.risk_tier;
  if (!Number.isInteger(Number(declaredRisk)) || Number(declaredRisk) !== riskTier) {
    throw validationError("Automation action risk tier does not match policy.", "automation_recipe_risk_mismatch");
  }
  if (action.config?.method && String(action.config.method).toUpperCase() !== "POST") {
    throw validationError("Automation webhook method is restricted to POST.", "automation_recipe_invalid");
  }
  const trigger = input.trigger || {};
  const triggerSource = executionMode === "instant_local_gesture" && trigger.source === "custom_local_skill"
    ? "custom_local_skill"
    : "mediapipe_gesture";
  const rawMovementKey = String(executionMode === "instant_local_gesture" ? trigger.gesture_key || trigger.movement_key || "" : trigger.movement_key || "");
  const validTriggerKey = triggerSource === "custom_local_skill"
    ? /^custom:[a-z][a-z0-9_]{1,55}$/.test(rawMovementKey)
    : /^[a-z][a-z0-9_]{1,63}$/.test(rawMovementKey);
  if (!validTriggerKey) {
    throw validationError("Automation trigger key must be normalized snake_case.", "automation_recipe_invalid");
  }
  if (executionMode === "confirmed_ai_movement" && trigger.require_user_confirmation !== true) throw validationError("User confirmation is required.", "automation_recipe_invalid");
  if (executionMode === "instant_local_gesture" && triggerSource === "mediapipe_gesture" && !["thumbs_up", "thumbs_down", "peace_sign", "open_palm", "closed_fist", "pointing_up", "i_love_you"].includes(rawMovementKey)) throw validationError("Instant gesture is not supported.", "automation_recipe_invalid");
  const customSkillId = String(trigger.custom_skill_id || "");
  if (triggerSource === "custom_local_skill" && !/^skill_[a-zA-Z0-9_-]{8,80}$/.test(customSkillId)) throw validationError("Custom gesture trigger is invalid.", "automation_recipe_invalid");
  if (executionMode === "instant_local_gesture" && input.enabled === true && input.consent?.run_instantly !== true) throw validationError("Instant gesture recipe consent is required.", "instant_recipe_not_enabled");
  const confidence = Number(trigger.minimum_confidence ?? DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw validationError("Automation confidence threshold is invalid.", "automation_recipe_invalid");
  const holdMs = executionMode === "instant_local_gesture" ? Number(trigger.hold_ms ?? 350) : 0;
  if (executionMode === "instant_local_gesture" && (!Number.isInteger(holdMs) || holdMs < 250 || holdMs > 1000)) {
    throw validationError("Instant gesture hold duration is invalid.", "automation_recipe_invalid");
  }
  const executionPolicy = input.execution_policy || {};
  const cooldownMs = Number(executionPolicy.cooldown_ms);
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 86_400_000) throw validationError("Automation cooldown is invalid.", "automation_recipe_invalid");
  const runLimit = Number(executionPolicy.max_runs_per_session);
  if (!Number.isInteger(runLimit) || runLimit < 1 || runLimit > 100) throw validationError("Automation run limit is invalid.", "automation_recipe_invalid");
  const retryLimit = Number(executionPolicy.retry_limit ?? 0);
  const retryCap = actionType === "signed_webhook_post" ? 1 : 0;
  if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > retryCap) throw validationError("Automation retry limit is invalid.", "automation_recipe_invalid");
  const requirePerRunConfirmation = executionMode === "instant_local_gesture"
    ? false
    : executionPolicy.require_per_run_confirmation === true || input.confirmation_policy === "per_run";
  if (riskTier === 2 && requirePerRunConfirmation !== true) throw validationError("Tier 2 automation requires per-run confirmation.", "automation_recipe_risk_mismatch");
  const requiredTags = normalizeGestureTags(trigger.required_tags);
  if ((trigger.required_tags || []).length > 12 || requiredTags.length !== (trigger.required_tags || []).length) throw validationError("Automation trigger tags are invalid.", "automation_recipe_invalid");
  if ((trigger.aliases || []).some((alias) => String(alias).trim().length < 1 || String(alias).trim().length > 80)) throw validationError("Automation aliases are invalid.", "automation_recipe_invalid");
  const aliases = normalizeAliases(trigger.aliases);
  if ((trigger.aliases || []).length > 20 || aliases.some((alias) => alias.length > 80)) throw validationError("Automation aliases are invalid.", "automation_recipe_invalid");
  const existingRecipes = Array.isArray(options) ? options : options.existingRecipes || options.recipes || [];
  const suppliedIds = options.existingIds || options.existing_recipe_ids || options.recipeIds || [];
  const existingIds = suppliedIds instanceof Set ? suppliedIds : new Set(suppliedIds);
  if (existingRecipes.some((recipe) => (recipe?.recipe_id || recipe?.id) === rawId) || existingIds.has(rawId)) throw validationError("Automation recipe id already exists.", "automation_recipe_duplicate_id");
  const actionConfig = sanitizeActionConfig(actionType, action.config);
  if (executionMode === "instant_local_gesture" && rawMovementKey === "thumbs_up" && rawName === "Thumbs up automation"
    && actionType === "speak_phrase" && String(actionConfig.text || actionConfig.phrase || "").trim().toLowerCase() === "great job") {
    actionConfig.text = "GREAT JOB";
    delete actionConfig.phrase;
  }
  const recipe = {
    schema: AUTOMATION_RECIPE_SCHEMA_VERSION,
    schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION,
    recipe_id: rawId,
    name: rawName,
    enabled: input.enabled === true,
    execution_mode: executionMode,
    confirmation_policy: executionMode === "instant_local_gesture"
      ? "none"
      : requirePerRunConfirmation ? "per_run" : "movement_confirmation",
    trigger: {
      movement_key: rawMovementKey,
      ...(executionMode === "instant_local_gesture" ? {
        source: triggerSource,
        ...(triggerSource === "custom_local_skill" ? { custom_skill_id: customSkillId } : {}),
        gesture_key: rawMovementKey,
        hold_ms: holdMs,
        neutral_reset_required: true
      } : {}),
      aliases,
      required_tags: requiredTags,
      minimum_confidence: confidence,
      require_user_confirmation: executionMode === "confirmed_ai_movement"
    },
    action: {
      type: actionType,
      config: actionConfig
    },
    risk_tier: Number(declaredRisk),
    execution_policy: {
      cooldown_ms: cooldownMs,
      max_runs_per_session: runLimit,
      require_per_run_confirmation: requirePerRunConfirmation,
      retry_limit: retryLimit
    },
    consent: executionMode === "instant_local_gesture" ? {
      run_instantly: true,
      consent_version: boundedInteger(input.consent?.consent_version, 1, Number.MAX_SAFE_INTEGER, 1),
      consented_at: boundedInteger(input.consent?.consented_at, 0, Number.MAX_SAFE_INTEGER, 0)
    } : undefined,
    created_at: boundedInteger(input.created_at, 0, Number.MAX_SAFE_INTEGER, now),
    updated_at: options.touch === false
      ? boundedInteger(input.updated_at, 0, Number.MAX_SAFE_INTEGER, boundedInteger(input.created_at, 0, Number.MAX_SAFE_INTEGER, now))
      : now
  };
  return recipe;
}

export function validateAutomationRecipe(input, options) {
  try {
    const recipe = normalizeAutomationRecipe(input, options);
    return { ok: true, passed: true, valid: true, code: null, error_code: null, error: null, recipe, normalized: recipe, value: recipe, errors: [] };
  } catch (error) {
    const code = error?.code || "automation_recipe_invalid";
    const safeMessage = error?.message || "Invalid automation recipe.";
    return { ok: false, passed: false, valid: false, code, error_code: code, error: { code, message: safeMessage }, recipe: null, normalized: null, value: null, errors: [code], safe_message: safeMessage };
  }
}

export function presetRecipe(presetId, overrides = {}) {
  const template = AUTOMATION_PRESETS.find((item) => item.recipe_id === presetId);
  if (!template) throw new Error("Automation preset not found.");
  return normalizeAutomationRecipe({
    ...clone(template),
    ...overrides,
    recipe_id: overrides.recipe_id || overrides.id || createAutomationRecipeId(),
    enabled: overrides.enabled ?? template.enabled,
    trigger: { ...template.trigger, ...(overrides.trigger || {}) },
    action: {
      ...template.action,
      ...(overrides.action || {}),
      config: { ...template.action.config, ...(overrides.action?.config || {}) }
    }
  });
}

export function normalizeMovementKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function normalizeGestureTags(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeMovementKey).filter(Boolean))].slice(0, 12);
}

function sanitizeActionConfig(actionType, config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const allowed = ACTION_CONFIG_FIELDS[actionType] || [];
  const output = {};
  for (const key of allowed) {
    const value = actionType === "speak_phrase" && key === "text" ? config.text ?? config.phrase : config[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "duration_seconds") output[key] = boundedInteger(value, 1, 86_400, 60);
    else output[key] = safeConfigText(value, 180);
  }
  const serialized = JSON.stringify(output);
  if (/data:image|;base64,|authorization\s*:|bearer\s+|hf_[a-z0-9]{12,}/i.test(serialized)) {
    throw validationError("Automation configuration cannot contain media or secret values.", "automation_recipe_contains_raw_media");
  }
  return output;
}

function migrateRecipeDocument(value) {
  if (Array.isArray(value)) return { schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION, recipes: value.map(migrateLegacyRecipe) };
  if (!value || typeof value !== "object") throw new Error("Invalid automation recipe configuration.");
  if (value.schema_version === 0 && Array.isArray(value.items)) return { schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION, recipes: value.items.map(migrateLegacyRecipe) };
  if (value.schema_version === 1 && Array.isArray(value.recipes)) return { schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION, recipes: value.recipes.map(migrateLegacyRecipe) };
  if (![AUTOMATION_RECIPE_SCHEMA_VERSION, AUTOMATION_RECIPE_LEGACY_SCHEMA_VERSION].includes(value.schema_version) || !Array.isArray(value.recipes)) {
    throw new Error("Unsupported automation recipe schema version.");
  }
  return value.schema_version === AUTOMATION_RECIPE_SCHEMA_VERSION
    ? value
    : { schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION, recipes: value.recipes.map(migrateLegacyRecipe) };
}

function migrateLegacyRecipe(recipe = {}) {
  if (recipe.schema_version === AUTOMATION_RECIPE_SCHEMA_VERSION) return recipe;
  const actionType = recipe.action?.type || "speak_phrase";
  const riskTier = actionRiskTier(actionType);
  const instantApproved = recipe.execution_mode === "instant_local_gesture" && recipe.consent?.run_instantly === true;
  return {
    schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION,
    recipe_id: recipe.recipe_id || recipe.id || "",
    name: recipe.name || "Migrated automation",
    enabled: recipe.enabled === true,
    execution_mode: instantApproved ? "instant_local_gesture" : "confirmed_ai_movement",
    confirmation_policy: instantApproved ? "none" : recipe.confirmation_policy === "per_run" ? "per_run" : "movement_confirmation",
    trigger: {
      movement_key: recipe.trigger?.movement_key || recipe.trigger?.gesture_key || "any_confirmed_movement",
      ...(instantApproved ? {
        source: recipe.trigger?.source === "custom_local_skill" ? "custom_local_skill" : "mediapipe_gesture",
        ...(recipe.trigger?.source === "custom_local_skill" ? { custom_skill_id: recipe.trigger?.custom_skill_id } : {}),
        gesture_key: recipe.trigger?.gesture_key || recipe.trigger?.movement_key,
        hold_ms: recipe.trigger?.hold_ms ?? 350,
        neutral_reset_required: recipe.trigger?.neutral_reset_required !== false
      } : {}),
      aliases: recipe.trigger?.aliases || [],
      required_tags: recipe.trigger?.required_tags || [],
      minimum_confidence: recipe.trigger?.minimum_confidence ?? recipe.trigger?.min_confidence ?? DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE,
      require_user_confirmation: !instantApproved
    },
    action: {
      ...(recipe.action || { type: actionType, config: {} }),
      config: actionType === "speak_phrase"
        ? { text: recipe.action?.config?.text ?? recipe.action?.config?.phrase ?? "Movement confirmed." }
        : { ...(recipe.action?.config || {}) }
    },
    risk_tier: Math.max(riskTier, Number(recipe.risk_tier ?? riskTier)),
    execution_policy: {
      cooldown_ms: recipe.execution_policy?.cooldown_ms ?? recipe.cooldown_ms ?? 3000,
      max_runs_per_session: recipe.execution_policy?.max_runs_per_session ?? recipe.session_run_limit ?? 10,
      require_per_run_confirmation: instantApproved ? false : riskTier === 2 || recipe.execution_policy?.require_per_run_confirmation === true || recipe.confirmation_policy === "per_run",
      retry_limit: actionType === "signed_webhook_post" ? Math.min(1, recipe.execution_policy?.retry_limit ?? 1) : 0
    },
    consent: instantApproved ? {
      run_instantly: true,
      consent_version: recipe.consent?.consent_version ?? 1,
      consented_at: recipe.consent?.consented_at ?? 0
    } : undefined,
    created_at: recipe.created_at ?? 0,
    updated_at: recipe.updated_at ?? 0
  };
}

function assertSafeRecipeConfiguration(action) {
  const visit = (value, path = "") => {
    if (typeof value === "function") throw validationError("Executable recipe configuration is forbidden.", "automation_recipe_unsafe_code");
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}.${index}`));
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey !== "secret_ref" && /(token|secret|password|authorization|api[_-]?key)/.test(lowerKey)) {
          throw validationError("Secret values are forbidden in automation recipes.", "automation_recipe_contains_secret");
        }
        if (/(raw[_-]?(frame|image|media)|base64|screenshot|video_blob|image_data)/.test(lowerKey)) {
          throw validationError("Raw media is forbidden in automation recipes.", "automation_recipe_contains_raw_media");
        }
        if (/(javascript|script|function|eval|code)/.test(lowerKey)) {
          throw validationError("Executable recipe configuration is forbidden.", "automation_recipe_unsafe_code");
        }
        if (/^(shell|shell_command|command|exec|spawn)$/.test(lowerKey)) {
          throw validationError("Shell commands are forbidden in automation recipes.", "automation_recipe_unsafe_code");
        }
        visit(child, `${path}.${key}`);
      }
      return;
    }
    const text = String(value ?? "");
    if (/data:image|;base64,|blob:|data:video/i.test(text)) throw validationError("Raw media is forbidden in automation recipes.", "automation_recipe_contains_raw_media");
    if (/javascript:|\beval\s*\(|\bnew\s+Function\b|=>|<script/i.test(text)) throw validationError("Executable recipe configuration is forbidden.", "automation_recipe_unsafe_code");
    if (/\b(curl|wget|bash|zsh|powershell|cmd\.exe|rm\s+-|sh\s+-c)\b/i.test(text)) throw validationError("Shell commands are forbidden in automation recipes.", "automation_recipe_unsafe_code");
    if (path.endsWith("secret_ref") && /^[A-Z][A-Z0-9_]{0,79}$/.test(text)) return;
    if (/\bBearer\s+\S+|hf_[a-z0-9]{12,}|sk-[a-z0-9]{12,}/i.test(text)) throw validationError("Secret values are forbidden in automation recipes.", "automation_recipe_contains_secret");
  };
  visit(action);
}

function actionRiskTier(actionType) {
  if (actionType === "local_snapshot_download") return 2;
  if (["browser_notification", "signed_webhook_post"].includes(actionType)) return 1;
  return 0;
}

function validationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function preset(id, name, movementKey, actionType, config, confirmationPolicy = "movement_confirmation") {
  const riskTier = actionRiskTier(actionType);
  return {
    schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION,
    recipe_id: id,
    name,
    enabled: false,
    execution_mode: "confirmed_ai_movement",
    confirmation_policy: confirmationPolicy === "per_run" ? "per_run" : "movement_confirmation",
    trigger: {
      movement_key: movementKey || "any_confirmed_movement",
      required_tags: [],
      aliases: [],
      minimum_confidence: 0.7,
      require_user_confirmation: true
    },
    action: { type: actionType, config },
    risk_tier: riskTier,
    execution_policy: {
      cooldown_ms: 3000,
      max_runs_per_session: 10,
      require_per_run_confirmation: confirmationPolicy === "per_run" || riskTier === 2,
      retry_limit: actionType === "signed_webhook_post" ? 1 : 0
    },
    created_at: 0,
    updated_at: 0
  };
}

function instantPreset(id, name, gestureKey, actionType, config) {
  return {
    schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION,
    recipe_id: id,
    name,
    enabled: true,
    execution_mode: "instant_local_gesture",
    confirmation_policy: "none",
    trigger: {
      movement_key: gestureKey,
      source: "mediapipe_gesture",
      gesture_key: gestureKey,
      required_tags: [],
      aliases: [],
      minimum_confidence: DEFAULT_INSTANT_RECIPE_MIN_CONFIDENCE,
      hold_ms: 350,
      neutral_reset_required: true,
      require_user_confirmation: false
    },
    action: { type: actionType, config },
    risk_tier: actionRiskTier(actionType),
    execution_policy: {
      cooldown_ms: 3000,
      max_runs_per_session: 20,
      require_per_run_confirmation: false,
      retry_limit: 0
    },
    consent: {
      run_instantly: true,
      consent_version: 1,
      consented_at: 0
    },
    created_at: 0,
    updated_at: 0
  };
}

function normalizeAliases(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => safeText(value, 80).toLowerCase()).filter(Boolean))].slice(0, 20);
}

function safeIdentifier(value, fallback) {
  return normalizeMovementKey(value) || `${fallback}_${Date.now()}`;
}

function allocateRecipeId(existingIds, idFactory) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = String(idFactory(existingIds) || "");
    if (AUTOMATION_RECIPE_ID_PATTERN.test(candidate) && !existingIds.has(candidate)) return candidate;
  }
  throw new Error("Could not create a unique automation recipe identity.");
}

function safeText(value, maxLength) {
  return String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, maxLength);
}

function safeConfigText(value, maxLength) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error("Automation configuration must contain text or numeric values only.");
  }
  return safeText(value, maxLength);
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function boundedInteger(value, min, max, fallback) {
  return Math.round(boundedNumber(value, min, max, fallback));
}

function normalizeRecipeCollection(recipes, options = {}) {
  const existingIds = new Set();
  return recipes.map((input) => {
    const suppliedId = String(input?.recipe_id || input?.id || "");
    const recipeId = AUTOMATION_RECIPE_ID_PATTERN.test(suppliedId) && !existingIds.has(suppliedId)
      ? suppliedId
      : createAutomationRecipeId(existingIds);
    const recipe = normalizeAutomationRecipe({ ...input, recipe_id: recipeId }, { ...options, existingIds });
    existingIds.add(recipe.recipe_id);
    return recipe;
  });
}

function browserStorage() {
  try {
    return globalThis[["local", "Storage"].join("")] || null;
  } catch {
    return null;
  }
}

function emptyRecipeDocument() {
  return { schema_version: AUTOMATION_RECIPE_SCHEMA_VERSION, recipes: [] };
}

function clone(value) {
  return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
}
