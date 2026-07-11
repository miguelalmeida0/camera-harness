import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUTOMATION_PRESETS,
  AUTOMATION_RECIPE_STORAGE_KEY,
  createAutomationRecipeId,
  createRecipeStore,
  normalizeAutomationRecipe,
  presetRecipe,
  validateAutomationRecipe
} from "../prototype/automation/recipe-store.js";
import { matchAutomationRecipes, recipeMatchBlockReason } from "../prototype/automation/recipe-matcher.js";
import {
  createAutomationRuntime,
  dryRunAutomationRecipe,
  executeAutomationRecipesForConfirmedMovement,
  freezeConfirmedMovementSnapshot
} from "../prototype/automation/automation-engine.js";
import { executeLocalAutomationAction } from "../prototype/automation/local-action-adapters.js";
import { buildSafeWebhookPayload, executeSignedWebhookAction } from "../server/webhook-action-adapter.mjs";
import { automationExecutionResponseForRequest } from "../server/automation-server.mjs";
import { isPrivateAddress, validateWebhookDestination } from "../server/webhook-policy.mjs";

export const AUTOMATION_CONTRACT_TEST_IDS = Object.freeze([
  "recipe.valid",
  "recipe.required_id",
  "recipe.duplicate_id",
  "recipe.bounded_name",
  "recipe.schema_version",
  "recipe.trigger_key",
  "recipe.confidence_range",
  "recipe.cooldown_bound",
  "recipe.run_limit_bound",
  "recipe.known_action",
  "recipe.risk_match",
  "recipe.secret",
  "recipe.raw_media",
  "recipe.arbitrary_js",
  "recipe.shell_command",
  "recipe.unrestricted_method",
  "recipe.instant_recipe_confirmation_conflict",
  "confirmation.rejected",
  "confirmation.confirmed",
  "confirmation.corrected_identity",
  "confirmation.duplicate_confirm",
  "matcher.exact",
  "matcher.alias",
  "matcher.ordering",
  "matcher.no_network_or_raw_media",
  "state.all_transitions",
  "state.invalid_transition",
  "idempotency.different_recipe",
  "cost.no_recursion",
  "cost.no_analysis_loop",
  "cost.no_ai_hooks",
  "adapter.speak_phrase",
  "adapter.notification_permission",
  "adapter.timer_once",
  "adapter.counter_and_log",
  "adapter.snapshot_consent",
  "webhook.http",
  "webhook.localhost",
  "webhook.loopback4",
  "webhook.loopback6",
  "webhook.private10",
  "webhook.private172",
  "webhook.private192",
  "webhook.linklocal",
  "webhook.metadata",
  "webhook.not_allowlisted",
  "webhook.post_only",
  "webhook.allowlisted_https",
  "webhook.local_dev_flag",
  "webhook.signed_payload",
  "webhook.payload_limit",
  "webhook.redirect_private",
  "webhook.retry_cap"
]);

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
};

const trackedStorage = () => {
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
};

const recipeInput = (overrides = {}) => {
  const action = {
    type: "increment_counter",
    config: { counter_name: "done" },
    ...(overrides.action || {})
  };
  const riskTier = action.type === "local_snapshot_download" ? 2 : ["browser_notification", "signed_webhook_post"].includes(action.type) ? 1 : 0;
  return {
    schema_version: "movement-automation-recipe.v1",
    recipe_id: overrides.recipe_id || overrides.id || "recipe_peace",
    name: overrides.name || "Peace automation",
    enabled: overrides.enabled ?? true,
    trigger: {
      movement_key: "peace_sign",
      required_tags: [],
      aliases: [],
      minimum_confidence: 0.7,
      require_user_confirmation: true,
      ...(overrides.trigger || {})
    },
    action,
    risk_tier: overrides.risk_tier ?? riskTier,
    execution_policy: {
      cooldown_ms: overrides.cooldown_ms ?? 1000,
      max_runs_per_session: overrides.session_run_limit ?? 2,
      require_per_run_confirmation: overrides.confirmation_policy === "per_run" || riskTier === 2,
      retry_limit: action.type === "signed_webhook_post" ? 1 : 0,
      ...(overrides.execution_policy || {})
    },
    created_at: 0,
    updated_at: 0
  };
};

const snapshot = freezeConfirmedMovementSnapshot({
  result_id: "movement_result_1",
  movement: "You raised your hand and made a peace sign.",
  short_label: "Peace sign",
  movement_key: "peace_sign",
  gesture_tags: ["hand_gesture", "two_fingers_raised", "hand_raised"],
  confidence: 0.87,
  uncertainty: false
}, 1000);

assert.equal(snapshot.contains_raw_media, false);
assert.equal(snapshot.confirmed, true);
assert.equal(Object.isFrozen(snapshot), true, "confirmed movement snapshot is frozen");

const storage = memoryStorage();
const store = createRecipeStore(storage);
const created = store.create(recipeInput());
assert.equal(created.trigger.movement_key, "peace_sign");
assert.equal(store.read(created.recipe_id).name, "Peace automation");
assert.equal(store.update(created.recipe_id, { name: "Updated peace automation" }).name, "Updated peace automation");
assert.equal(store.setEnabled(created.recipe_id, false).enabled, false);
assert.equal(store.list().length, 1);
const exported = store.exportConfiguration();
assert.equal(exported.includes(AUTOMATION_RECIPE_STORAGE_KEY), false, "export contains configuration, not storage internals");
assert.equal(store.importConfiguration(exported).length, 1);
assert.equal(store.delete(created.recipe_id), true);

const generatedId = createAutomationRecipeId();
assert.match(generatedId, /^recipe_[a-zA-Z0-9_-]{1,80}$/, "recipe_id_factory_missing: generated ID satisfies the schema");
assert.equal(/token|secret|hf_|sk-/i.test(generatedId), false, "generated IDs contain no secret material");
const idStorage = trackedStorage();
let idFactoryCalls = 0;
const generatedIds = ["recipe_collision", "recipe_unique_second", "recipe_unique_third"];
const idStore = createRecipeStore(idStorage, {
  idFactory: () => {
    idFactoryCalls += 1;
    return generatedIds.shift();
  }
});
const idlessFirst = recipeInput({ name: "Shared visible name" });
delete idlessFirst.recipe_id;
const generatedFirst = idStore.create(idlessFirst);
assert.equal(generatedFirst.recipe_id, "recipe_collision", "recipe_id_missing_during_create: ID is generated for a normal creation");
const idlessSecond = recipeInput({ name: "Shared visible name" });
delete idlessSecond.recipe_id;
const generatedSecond = idStore.create(idlessSecond);
assert.equal(generatedSecond.recipe_id, "recipe_unique_second", "same visible name receives a different internal ID");
assert.notEqual(generatedFirst.recipe_id, generatedSecond.recipe_id, "recipe_id_duplicate: generated IDs are unique");
const stableEdited = idStore.update(generatedSecond.recipe_id, { name: "Renamed visible recipe" });
assert.equal(stableEdited.recipe_id, generatedSecond.recipe_id, "recipe_id_changed_during_edit: editing preserves identity");
assert.throws(() => idStore.create({ ...recipeInput(), recipe_id: generatedFirst.recipe_id }), (error) => error?.code === "automation_recipe_duplicate_id");

const validationOrderStorage = trackedStorage();
let validationOrderFactoryCalls = 0;
const validationOrderStore = createRecipeStore(validationOrderStorage, {
  idFactory: () => {
    validationOrderFactoryCalls += 1;
    return "recipe_generated_before_validation";
  }
});
const invalidIdless = recipeInput({ name: "" });
delete invalidIdless.recipe_id;
invalidIdless.name = "";
assert.throws(() => validationOrderStore.create(invalidIdless), /name is invalid/i);
assert.equal(validationOrderFactoryCalls, 1, "ID is allocated before recipe validation");
assert.equal(validationOrderStorage.writes.length, 0, "invalid new recipe never reaches storage");
assert.deepEqual(validationOrderStore.list(), [], "invalid new recipe never mutates the in-memory list");

const transactionStorage = trackedStorage();
const transactionStore = createRecipeStore(transactionStorage);
const transactionRecipe = transactionStore.create(recipeInput({ recipe_id: "recipe_transaction" }));
const transactionBefore = transactionStore.list();
const transactionWritesBefore = transactionStorage.writes.length;
assert.throws(() => transactionStore.update(transactionRecipe.recipe_id, { name: "" }), /name is invalid/i);
assert.deepEqual(transactionStore.list(), transactionBefore, "recipe_edit_deleted_existing: failed edit preserves the recipe exactly");
assert.equal(transactionStorage.writes.length, transactionWritesBefore, "recipe_save_non_atomic: failed edit performs no storage write");

const persistedValues = new Map();
let rejectPersistence = false;
const persistenceFailureStorage = {
  getItem: (key) => persistedValues.get(key) ?? null,
  setItem(key, value) {
    if (rejectPersistence) throw new Error("Storage unavailable");
    persistedValues.set(key, value);
  }
};
const persistenceFailureStore = createRecipeStore(persistenceFailureStorage);
const persistedRecipe = persistenceFailureStore.create(recipeInput({ recipe_id: "recipe_persistence_failure" }));
const beforePersistenceFailure = persistenceFailureStore.list();
rejectPersistence = true;
assert.throws(() => persistenceFailureStore.update(persistedRecipe.recipe_id, { name: "Must not commit" }), /storage unavailable/i);
assert.deepEqual(persistenceFailureStore.list(), beforePersistenceFailure, "in-memory recipes change only after persistence succeeds");

const legacyMissingIdStorage = trackedStorage();
const legacyMissingId = recipeInput({ name: "Migrated missing identity" });
delete legacyMissingId.recipe_id;
legacyMissingIdStorage.setItem(AUTOMATION_RECIPE_STORAGE_KEY, JSON.stringify({
  schema_version: "movement-automation-recipe.v1",
  recipes: [legacyMissingId]
}));
const legacyWritesBeforeRepair = legacyMissingIdStorage.writes.length;
const migratedMissingIdStore = createRecipeStore(legacyMissingIdStorage);
assert.match(migratedMissingIdStore.list()[0]?.recipe_id || "", /^recipe_[a-zA-Z0-9_-]{1,80}$/, "recipe_id_migration_failed: legacy missing ID is migrated");
assert.equal(legacyMissingIdStorage.writes.length, legacyWritesBeforeRepair + 1, "legacy ID repair is persisted exactly once on load");
migratedMissingIdStore.list();
assert.equal(legacyMissingIdStorage.writes.length, legacyWritesBeforeRepair + 1, "reading repaired recipes does not rewrite storage");

const contradictoryStorage = memoryStorage();
contradictoryStorage.setItem(AUTOMATION_RECIPE_STORAGE_KEY, JSON.stringify({
  schema_version: "movement-automation-recipe.v1-1",
  recipes: [{
    schema_version: "movement-automation-recipe.v1-1",
    recipe_id: "recipe_persisted_instant_conflict",
    name: "Thumbs up automation",
    enabled: true,
    execution_mode: "instant_local_gesture",
    confirmation_policy: "movement_confirmation",
    trigger: {
      movement_key: "thumbs_up",
      gesture_key: "thumbs_up",
      source: "stale_source",
      minimum_confidence: 0.85,
      hold_ms: 350,
      neutral_reset_required: false,
      aliases: [],
      required_tags: [],
      require_user_confirmation: true
    },
    action: { type: "speak_phrase", config: { text: "Great job" } },
    risk_tier: 0,
    execution_policy: { cooldown_ms: 3000, max_runs_per_session: 20, require_per_run_confirmation: true, retry_limit: 0 },
    consent: { run_instantly: true, consent_version: 1, consented_at: 1 },
    created_at: 1,
    updated_at: 2
  }]
}));
const repairedStore = createRecipeStore(contradictoryStorage);
const repairedRecipe = repairedStore.read("recipe_persisted_instant_conflict");
assert.equal(repairedRecipe.confirmation_policy, "none");
assert.equal(repairedRecipe.execution_policy.require_per_run_confirmation, false);
assert.equal(repairedRecipe.trigger.require_user_confirmation, false);
assert.equal(repairedRecipe.trigger.source, "mediapipe_gesture");
assert.equal(repairedRecipe.trigger.neutral_reset_required, true);
assert.equal(repairedRecipe.trigger.minimum_confidence, 0.85, "explicit stored confidence is preserved");
assert.equal(repairedRecipe.action.config.text, "GREAT JOB", "the built-in encouragement recipe is repaired to its configured v1.2.1 phrase");
const repairedPersistedRecipe = JSON.parse(contradictoryStorage.getItem(AUTOMATION_RECIPE_STORAGE_KEY)).recipes[0];
assert.equal(repairedPersistedRecipe.confirmation_policy, "none", "normalized instant recipe is persisted back to storage");
assert.equal(repairedPersistedRecipe.execution_policy.require_per_run_confirmation, false);
assert.throws(() => normalizeAutomationRecipe(recipeInput({
  action: { type: "signed_webhook_post", config: { destination_id: "hooks.example.com", secret_ref: "hf_abcdefghijklmnop" } }
})), /secret values/i, "recipe storage rejects secret-like values");

assert.equal(AUTOMATION_PRESETS.length >= 7, true, "safe preset templates exist");
assert.equal(AUTOMATION_PRESETS.find((item) => item.recipe_id === "preset_thumbs_up_encouragement")?.execution_mode, "instant_local_gesture", "instant thumbs-up preset exists disabled by default");
assert.equal(AUTOMATION_PRESETS.find((item) => item.recipe_id === "preset_thumbs_up_encouragement")?.trigger.minimum_confidence, 0.7);
assert.equal(AUTOMATION_PRESETS.find((item) => item.recipe_id === "preset_thumbs_up_encouragement")?.execution_policy.cooldown_ms, 3000);
assert.equal(AUTOMATION_PRESETS.find((item) => item.recipe_id === "preset_thumbs_up_encouragement")?.action.config.text, "GREAT JOB");
assert.equal(AUTOMATION_PRESETS.find((item) => item.action.type === "signed_webhook_post").enabled, false, "external preset is disabled by default");
assert.equal(presetRecipe("preset_peace_sign_snapshot").execution_policy.require_per_run_confirmation, true, "snapshot preset always asks again");

const contradictoryInstant = normalizeAutomationRecipe({
  schema: "movement-automation-recipe.v1-1",
  recipe_id: "recipe_confirmation_conflict",
  name: "Contradictory instant recipe",
  enabled: true,
  execution_mode: "instant_local_gesture",
  confirmation_policy: "after_confirmation",
  trigger: {
    movement_key: "thumbs_up",
    source: "mediapipe_gesture",
    gesture_key: "thumbs_up",
    aliases: [],
    required_tags: [],
    minimum_confidence: 0.85,
    hold_ms: 350,
    neutral_reset_required: true,
    require_user_confirmation: true
  },
  action: { type: "speak_phrase", config: { text: "GREAT JOB" } },
  risk_tier: 0,
  execution_policy: { cooldown_ms: 2500, max_runs_per_session: 20, require_per_run_confirmation: true, retry_limit: 0 },
  consent: { run_instantly: true, consent_version: 1, consented_at: 0 }
});
assert.equal(contradictoryInstant.confirmation_policy, "none", "instant_recipe_confirmation_conflict: instant policy normalizes to none");
assert.equal(contradictoryInstant.execution_policy.require_per_run_confirmation, false, "instant recipe cannot retain per-run confirmation");
assert.equal(contradictoryInstant.trigger.require_user_confirmation, false, "instant recipe cannot retain movement confirmation");

const exactRecipe = normalizeAutomationRecipe(recipeInput());
const customSkillRecipe = normalizeAutomationRecipe({
  schema_version: "movement-automation-recipe.v1-1",
  recipe_id: "recipe_custom_heart",
  name: "Heart detected",
  enabled: true,
  execution_mode: "instant_local_gesture",
  confirmation_policy: "none",
  trigger: {
    movement_key: "custom:heart_shape",
    source: "custom_local_skill",
    custom_skill_id: "skill_heartshape01",
    gesture_key: "custom:heart_shape",
    aliases: [],
    required_tags: [],
    minimum_confidence: 0.25,
    hold_ms: 350,
    require_user_confirmation: false
  },
  action: { type: "speak_phrase", config: { text: "Heart detected" } },
  risk_tier: 0,
  execution_policy: { cooldown_ms: 3000, max_runs_per_session: 20, require_per_run_confirmation: false, retry_limit: 0 },
  consent: { run_instantly: true, consent_version: 1, consented_at: 1 }
});
assert.equal(customSkillRecipe.trigger.source, "custom_local_skill");
assert.equal(customSkillRecipe.trigger.custom_skill_id, "skill_heartshape01");
assert.equal(customSkillRecipe.trigger.gesture_key, "custom:heart_shape");
assert.deepEqual(matchAutomationRecipes(snapshot, [exactRecipe]).map((item) => item.recipe_id), [exactRecipe.recipe_id], "exact movement_key matches");
const tagRecipe = normalizeAutomationRecipe(recipeInput({
  id: "recipe_tags",
  trigger: { movement_key: "any_confirmed_movement", required_tags: ["hand_gesture", "two_fingers_raised"] }
}));
assert.deepEqual(matchAutomationRecipes(snapshot, [tagRecipe]).map((item) => item.recipe_id), [tagRecipe.recipe_id], "required tags match deterministically");
const aliasRecipe = normalizeAutomationRecipe(recipeInput({
  id: "recipe_alias",
  trigger: { movement_key: "other", aliases: ["peace sign"] }
}));
assert.deepEqual(matchAutomationRecipes(snapshot, [aliasRecipe]).map((item) => item.recipe_id), [aliasRecipe.recipe_id], "exact alias matches without fuzzy logic");
const lowConfidence = { ...snapshot, confidence: 0.4 };
assert.equal(matchAutomationRecipes(lowConfidence, [exactRecipe]).length, 0, "minimum confidence is enforced");
assert.equal(matchAutomationRecipes({ ...snapshot, uncertainty: true }, [exactRecipe]).length, 0, "uncertain result cannot match");
assert.equal(matchAutomationRecipes({ ...snapshot, confirmed: false }, [exactRecipe]).length, 0, "unconfirmed result cannot match");
assert.equal(matchAutomationRecipes(snapshot, [{ ...exactRecipe, enabled: false }]).length, 0, "disabled recipe cannot match");
assert.equal(recipeMatchBlockReason(snapshot, exactRecipe, { cooldowns: { [exactRecipe.recipe_id]: 5000 }, now: 2000 }), "Recipe is cooling down");
assert.equal(recipeMatchBlockReason(snapshot, exactRecipe, { sessionRuns: { [exactRecipe.recipe_id]: 2 } }), "Recipe run limit reached");
assert.equal(recipeMatchBlockReason({ ...snapshot, confirmed: false }, exactRecipe), "Movement must be confirmed first");

let actionCalls = 0;
const runtime = createAutomationRuntime([exactRecipe]);
const executeOptions = {
  snapshot,
  recipes: [exactRecipe],
  runtime,
  now: 1000,
  userGesture: true,
  actionExecutor: async () => {
    actionCalls += 1;
    return { safe_message: "Counter incremented." };
  }
};
const firstRun = await executeAutomationRecipesForConfirmedMovement(executeOptions);
const duplicateRun = await executeAutomationRecipesForConfirmedMovement(executeOptions);
assert.equal(firstRun.receipts.at(-1).status, "succeeded");
assert.equal(duplicateRun.receipts.length, 0, "duplicate confirm is idempotent");
assert.equal(actionCalls, 1, "duplicate confirm executes once");
assert.equal(runtime.receipts.at(-1).contains_raw_media, false, "receipt contains no raw media");

const unconfirmedRuntime = createAutomationRuntime([exactRecipe]);
await executeAutomationRecipesForConfirmedMovement({ ...executeOptions, snapshot: { ...snapshot, confirmed: false }, runtime: unconfirmedRuntime });
assert.equal(unconfirmedRuntime.totalExecutions, 0, "rejected/unconfirmed movement cannot execute");

const adapterRuntime = createAutomationRuntime();
const counterOutcome = await executeLocalAutomationAction({ recipe: exactRecipe, snapshot, executionId: "exec_counter", runtime: adapterRuntime });
assert.equal(adapterRuntime.counters.done, 1);
assert.match(counterOutcome.safe_message, /counter/i);
const logRecipe = normalizeAutomationRecipe(recipeInput({ id: "recipe_log", action: { type: "append_activity_log", config: { category: "workout" } } }));
await executeLocalAutomationAction({ recipe: logRecipe, snapshot, executionId: "exec_log", runtime: adapterRuntime, context: { now: 1200 } });
assert.equal(adapterRuntime.activityLog[0].contains_raw_media, false);
assert.equal(adapterRuntime.activityLog[0].category, "workout");
let spoken = "";
const speakRecipe = normalizeAutomationRecipe(recipeInput({ id: "recipe_speak", action: { type: "speak_phrase", config: { phrase: "Nice work." } } }));
await executeLocalAutomationAction({
  recipe: speakRecipe,
  snapshot,
  executionId: "exec_speak",
  runtime: adapterRuntime,
  context: {
    speechSynthesis: {
      cancel() {},
      speak(utterance) {
        spoken = utterance.text;
        utterance.onstart?.();
        utterance.onend?.();
      }
    },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
  }
});
assert.equal(spoken, "Nice work.");

const snapshotRecipe = normalizeAutomationRecipe(recipeInput({
  id: "recipe_snapshot",
  action: { type: "local_snapshot_download", config: { filename_prefix: "peace" } },
  confirmation_policy: "per_run"
}));
let snapshotCaptures = 0;
const cancelledSnapshotRuntime = createAutomationRuntime([snapshotRecipe]);
const cancelledSnapshot = await executeAutomationRecipesForConfirmedMovement({
  snapshot,
  recipes: [snapshotRecipe],
  runtime: cancelledSnapshotRuntime,
  requestConsent: () => false,
  context: { captureSnapshot: async () => { snapshotCaptures += 1; } }
});
assert.equal(cancelledSnapshot.receipts.at(-1).status, "cancelled");
assert.equal(snapshotCaptures, 0, "snapshot is not captured without second confirmation");
const acceptedSnapshotRuntime = createAutomationRuntime([snapshotRecipe]);
await executeAutomationRecipesForConfirmedMovement({
  snapshot,
  recipes: [snapshotRecipe],
  runtime: acceptedSnapshotRuntime,
  requestConsent: () => true,
  context: { captureSnapshot: async () => { snapshotCaptures += 1; } }
});
assert.equal(snapshotCaptures, 1, "snapshot stays local and runs only after consent");

const dryRuntime = createAutomationRuntime([exactRecipe]);
const dryReceipt = dryRunAutomationRecipe(exactRecipe, snapshot, dryRuntime, 2000);
assert.equal(dryReceipt.dry_run, true);
assert.equal(dryRuntime.totalExecutions, 0, "dry run has no side effect");

assert.equal(isPrivateAddress("127.0.0.1"), true);
assert.equal(isPrivateAddress("10.0.0.4"), true);
await assert.rejects(
  validateWebhookDestination("https://127.0.0.1/hook", { allowlist: ["https://127.0.0.1"], allowLocal: false }),
  /not approved/i,
  "SSRF/private destination is blocked"
);

const webhookRecipe = normalizeAutomationRecipe(recipeInput({
  id: "recipe_webhook",
  action: { type: "signed_webhook_post", config: { destination_id: "hooks.example.com", secret_ref: "DARKQUEST_WEBHOOK_SECRET_PRESENTATION", payload_label: "next_slide" } },
  confirmation_policy: "per_run"
}));
let outboundRequest;
const webhookInput = {
  recipe_id: webhookRecipe.recipe_id,
  execution_id: "automation_movement_result_1_recipe_webhook",
  confirmed_movement: snapshot,
  action: webhookRecipe.action
};
const webhookOutcome = await executeSignedWebhookAction(webhookInput, {
  DARKQUEST_AUTOMATION_WEBHOOK_ALLOWLIST: "https://hooks.example.com",
  DARKQUEST_WEBHOOK_SECRET_PRESENTATION: "server_only_test_secret",
  ALLOW_LOCAL_AUTOMATION_WEBHOOKS: "false"
}, {
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  fetch: async (_url, request) => {
    outboundRequest = request;
    return { ok: true, status: 200 };
  }
});
assert.equal(webhookOutcome.ok, true);
assert.equal(webhookOutcome.contains_raw_media, false);
const webhookPayload = JSON.parse(outboundRequest.body);
assert.equal(webhookPayload.event, "movement.confirmed");
assert.equal(webhookPayload.movement_key, "peace_sign");
assert.equal(/data:image|;base64,|token|server_only_test_secret/i.test(outboundRequest.body), false, "webhook payload contains no image/base64/token");
assert.equal(outboundRequest.headers["X-DarkQuest-Signature"].startsWith("v1="), true, "HMAC signature is server-generated");
assert.equal(JSON.stringify(webhookOutcome).includes("server_only_test_secret"), false, "receipt does not expose server secret");
assert.equal(JSON.stringify(buildSafeWebhookPayload(webhookInput)).includes("secret_ref"), false, "safe payload excludes secret references");

const blockedResponse = await automationExecutionResponseForRequest({
  ...webhookInput,
  action: { type: "signed_webhook_post", config: { destination_id: "loopback", secret_ref: "DARKQUEST_WEBHOOK_SECRET_PRESENTATION" } }
}, {
  DARKQUEST_AUTOMATION_WEBHOOK_ALLOWLIST: "loopback=https://127.0.0.1",
  DARKQUEST_WEBHOOK_SECRET_PRESENTATION: "server_only_test_secret"
});
assert.equal(blockedResponse.status, 403);
assert.equal(blockedResponse.json.safe_message, "Webhook destination is not approved");
assert.equal(JSON.stringify(blockedResponse).includes("server_only_test_secret"), false);

const html = readFileSync(resolve("packages/perception/browser-local-capture/prototype/index.html"), "utf8");
const clientSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/local-capture.js"), "utf8");
const automationSources = [
  "recipe-store.js",
  "recipe-matcher.js",
  "automation-engine.js",
  "local-action-adapters.js",
  "automation-receipts.js"
].map((file) => readFileSync(resolve(`packages/perception/browser-local-capture/prototype/automation/${file}`), "utf8")).join("\n");
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const defaultMainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;
assert.equal(defaultMainUi.indexOf('id="cameraTitle"') < defaultMainUi.indexOf('id="analyzeMovement"'), true);
assert.equal(defaultMainUi.indexOf('id="analyzeMovement"') < defaultMainUi.indexOf('id="movementResultTitle"'), true);
assert.equal(defaultMainUi.indexOf('id="automateMovement"') > defaultMainUi.indexOf('id="movementResultTitle"'), true, "recipe editor entry is secondary to result");
assert.equal(html.includes('id="automationManagerPanel"'), true);
assert.equal(html.includes('id="gestureRecipesCard"'), true, "gesture recipes are grouped in a compact secondary card");
assert.equal(html.includes('<dialog id="automationManagerPanel"') && html.includes('data-default-state="closed"'), true, "automation manager is closed/secondary");
assert.equal(html.includes('id="automationRecipeEditor"'), true);
assert.equal(html.includes("result-card-stable"), true, "result card stability marker remains");
assert.equal(clientSource.includes('event_name: "movement.confirmed"'), true);
assert.equal(clientSource.includes("executeConfirmedMovementAutomations(state, { userGesture: true })"), true, "automation starts from explicit Confirm handler");
assert.equal(clientSource.includes("captureConfirmedMovementSnapshot"), true);
assert.equal(clientSource.includes("URL.revokeObjectURL"), true, "local snapshot object URL is revoked");
assert.equal(clientSource.includes("requestAutomationExecution"), true);
assert.equal(automationSources.includes("/api/movement-recognition/analyze"), false, "automation modules cannot trigger another AI call");
assert.equal(automationSources.includes("frames:"), false, "automation modules do not inspect or send frames");
assert.equal(/eval\(|new Function|child_process|exec\(|spawn\(/.test(automationSources), false, "recipes cannot execute JavaScript or shell commands");
for (const oldProductTerm of ["Focus Ritual", "Suggestion Trace Campaign", "fixture", "Gate 4A"]) {
  assert.equal(defaultMainUi.includes(oldProductTerm), false, `${oldProductTerm} stays out of main product UI`);
}

console.log("ok automation recipes");
