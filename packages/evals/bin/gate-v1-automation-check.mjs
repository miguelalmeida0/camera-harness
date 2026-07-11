#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPORT_PATH = "runs/gate-v1-automation-latest.json";
const APP_PATH = "packages/perception/browser-local-capture/prototype/automation/index.js";
const SOURCE_PATH = "packages/perception/browser-local-capture/prototype/local-capture.js";
const SERVER_PATH = "packages/perception/browser-local-capture/server/automation/index.mjs";
const ENGINE_EXPORTS = [
  "validateAutomationRecipe",
  "matchAutomationRecipes",
  "createAutomationRuntimeState",
  "transitionAutomationState",
  "automationIdempotencyKey",
  "runAutomationForConfirmedMovement"
];
const LOCAL_ADAPTER_EXPORTS = ["executeLocalAutomationAction", "clearAutomationActivityLog"];
const SERVER_ADAPTER_EXPORTS = [
  "validateAutomationWebhookDestination",
  "buildSignedAutomationWebhookRequest",
  "executeSignedAutomationWebhook"
];
const ACTION_RISK = {
  append_activity_log: 0,
  increment_counter: 0,
  speak_phrase: 0,
  browser_notification: 1,
  start_timer: 0,
  local_snapshot_download: 2,
  signed_webhook_post: 1
};

const packageJson = JSON.parse(read("package.json"));
const html = read("packages/perception/browser-local-capture/prototype/index.html");
const source = read(SOURCE_PATH);
const serverSource = read(SERVER_PATH);
const app = await import(`../../perception/browser-local-capture/prototype/automation/index.js`);
const server = await import(`../../perception/browser-local-capture/server/automation/index.mjs`);
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const mainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;

const report = {
  schema: "darkquest.gate_v1_automation_report.v0",
  gate: "v1_automation",
  claim: "Only a user-confirmed canonical movement may enter deterministic recipe matching, policy authorization, and bounded action execution.",
  generated_at: new Date().toISOString(),
  required_interfaces: {
    app_engine_exports: ENGINE_EXPORTS,
    local_adapter_exports: LOCAL_ADAPTER_EXPORTS,
    server_adapter_exports: SERVER_ADAPTER_EXPORTS
  },
  checks: [],
  final_verdict: "FAIL"
};

checkPackageWiring();
checkRequiredInterfaces();
checkProductFreeze();
checkAutomationUiBoundary();
checkStaticSafetyBoundary();

const missingEngine = ENGINE_EXPORTS.filter((name) => typeof app[name] !== "function");
const missingLocalAdapters = LOCAL_ADAPTER_EXPORTS.filter((name) => typeof app[name] !== "function");
const missingServerAdapters = SERVER_ADAPTER_EXPORTS.filter((name) => typeof server[name] !== "function");
const missingAutomationUi = automationUiBlockers();

if (missingEngine.length === 0) {
  await runRecipeValidationTests();
  await runConfirmationBoundaryTests();
  await runMatcherTests();
  await runStateAndIdempotencyTests();
  await runCostGuardTests();
} else {
  blocked("engine", "behavior_not_executed", `Missing pure engine exports: ${missingEngine.join(", ")}`);
}

if (missingEngine.length === 0 && missingLocalAdapters.length === 0) {
  await runLocalAdapterTests();
} else {
  blocked("adapters", "local_behavior_not_executed", `Missing local adapter exports: ${missingLocalAdapters.join(", ") || "engine unavailable"}`);
}

if (missingEngine.length === 0 && missingServerAdapters.length === 0) {
  await runWebhookTests();
} else {
  blocked("webhook", "behavior_not_executed", `Missing server adapter exports: ${missingServerAdapters.join(", ") || "engine unavailable"}`);
}

const criticalFailures = report.checks.filter((check) => !check.passed && check.severity === "critical");
report.missing_engine_exports = missingEngine;
report.missing_local_adapter_exports = missingLocalAdapters;
report.missing_server_adapter_exports = missingServerAdapters;
report.missing_automation_ui = missingAutomationUi;
report.failure_count = criticalFailures.length;
report.failures = criticalFailures;
report.executed_behavior_checks = report.checks.filter((check) => check.kind === "behavior").length;

if (missingEngine.length > 0) {
  report.final_verdict = "BLOCKED_MISSING_AUTOMATION_ENGINE";
} else if (missingLocalAdapters.length > 0 || missingServerAdapters.length > 0 || missingAutomationUi.length > 0) {
  report.final_verdict = "BLOCKED_MISSING_ACTION_ADAPTERS";
} else if (criticalFailures.length > 0) {
  report.final_verdict = "FAIL";
} else {
  report.final_verdict = "PASS_WITH_DISCLOSURE";
}

mkdirSync("runs", { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.final_verdict} Gate v1.2 movement automation check`);
console.log(`report: ${REPORT_PATH}`);
console.log(`checks: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}`);
for (const failure of criticalFailures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
if (missingEngine.length) console.log(`missing engine: ${missingEngine.join(", ")}`);
if (missingLocalAdapters.length || missingServerAdapters.length) {
  console.log(`missing adapters: ${[...missingLocalAdapters, ...missingServerAdapters].join(", ")}`);
}
if (missingAutomationUi.length) console.log(`missing automation UI: ${missingAutomationUi.join(", ")}`);
process.exit(report.final_verdict.startsWith("PASS") ? 0 : 1);

function checkPackageWiring() {
  const scripts = packageJson.scripts ?? {};
  check("package", "script_exists", scripts["gate:v1:automation"]?.includes("gate-v1-automation-check.mjs") === true, "npm run gate:v1:automation is wired", "package script");
  check("package", "typecheck_includes_gate", scripts.typecheck?.includes("gate-v1-automation-check.mjs") === true, "typecheck includes the automation gate", "typecheck script");
}

function checkRequiredInterfaces() {
  for (const name of ENGINE_EXPORTS) check("engine", `export_${safeCode(name)}`, typeof app[name] === "function", `${name} is an executable export`, typeof app[name], "blocking");
  for (const name of LOCAL_ADAPTER_EXPORTS) check("adapters", `export_${safeCode(name)}`, typeof app[name] === "function", `${name} is an executable local adapter export`, typeof app[name], "blocking");
  for (const name of SERVER_ADAPTER_EXPORTS) check("webhook", `export_${safeCode(name)}`, typeof server[name] === "function", `${name} is an executable server-only export`, typeof server[name], "blocking");
}

function checkProductFreeze() {
  const camera = mainUi.indexOf('id="cameraTitle"');
  const control = mainUi.indexOf('id="analyzeMovement"');
  const result = mainUi.indexOf('id="movementResultTitle"');
  check("ui", "camera_before_control", camera >= 0 && camera < control, "Camera remains before movement control", `${camera}<${control}`);
  check("ui", "control_before_result", control >= 0 && control < result, "Movement control remains before result", `${control}<${result}`);
  for (const text of ["Focus Ritual", "trace", "fixture", "JSON", "Gate 1C", "Gate 3B", "Gate 4A", "Recent Events"]) {
    check("ui", `forbidden_${safeCode(text)}`, !mainUi.toLowerCase().includes(text.toLowerCase()), `Main UI excludes ${text}`, text);
  }
  check("ui", "no_zone_internals", !/hand\.(?:left|entered)_zone|zone\.activated|neutral_zone|phone_zone|notebook_zone|pen_zone|keyboard_zone/i.test(mainUi), "Main UI excludes perception internals", "known zone and hand event labels");
  const sentenceCss = sliceBetween(html, ".dq-movement-sentence", ".dq-movement-hint");
  check("ui", "result_no_ellipsis", !/ellipsis|-webkit-line-clamp/.test(sentenceCss), "Movement result remains untruncated", sentenceCss.slice(0, 180));
  check("ui", "text_containment", html.includes("overflow-wrap: anywhere"), "Text containment guard remains present", "overflow-wrap: anywhere");
}

function checkAutomationUiBoundary() {
  const automateIndex = mainUi.indexOf('id="automateMovement"');
  const resultIndex = mainUi.indexOf('id="movementResultTitle"');
  const editor = bodyHtml.match(/<(dialog|section|aside|div)[^>]+id="automationRecipeEditor"[^>]*>/i)?.[0] ?? "";
  check("ui", "automate_after_result", automateIndex > resultIndex && resultIndex >= 0, "Automate this movement is secondary to the result", `${automateIndex}>${resultIndex}`, "adapter");
  check("ui", "editor_bounded_surface", /<dialog|hidden|drawer|sheet|modal/i.test(editor), "Recipe editor is a closed modal, sheet, or drawer", editor || "missing", "adapter");
  check("ui", "receipt_small_status", mainUi.includes('id="automationReceipt"'), "A bounded execution receipt/status exists", "automationReceipt", "adapter");
  check("ui", "no_raw_webhook_or_secret", !/hf_[A-Za-z0-9]{12,}|webhook secret|Authorization|Bearer|data:image|base64/i.test(mainUi), "Main result exposes no webhook secret or raw payload", "main UI");
  check("ui", "no_automation_dashboard", !/automation dashboard|automation debug log/i.test(mainUi), "No automation dashboard or debug log is in the main UI", "main UI");
}

function checkStaticSafetyBoundary() {
  check("safety", "frontend_no_secret", !/process\.env\.(?:HF_TOKEN|AUTOMATION_WEBHOOK_SECRET)|hf_[A-Za-z0-9]{12,}/.test(source), "Frontend source contains no provider or webhook secret", "source scan");
  check("safety", "server_secret_not_returned", !/json[^\n]*(?:AUTOMATION_WEBHOOK_SECRET|HF_TOKEN)/i.test(serverSource), "Server response code does not return secret environment values", "server source scan");
  check("safety", "no_unsafe_eval", !/\beval\s*\(|new Function\s*\(/.test(source + serverSource), "Automation path has no eval or Function constructor", "source scan");
}

async function runRecipeValidationTests() {
  const validate = app.validateAutomationRecipe;
  const valid = recipe();
  await behavior("recipe", "valid", "Valid bounded recipe passes", () => isValid(validate(valid)));
  const cases = [
    ["required_id", { recipe_id: "" }, "automation_recipe_invalid"],
    ["duplicate_id", {}, "automation_recipe_duplicate_id", { existing_recipe_ids: [valid.recipe_id] }],
    ["bounded_name", { name: "x".repeat(161) }, "automation_recipe_invalid"],
    ["schema_version", { schema: "" }, "automation_recipe_invalid"],
    ["trigger_key", { trigger: { ...valid.trigger, movement_key: "" } }, "automation_recipe_invalid"],
    ["confidence_range", { trigger: { ...valid.trigger, minimum_confidence: 1.1 } }, "automation_recipe_invalid"],
    ["cooldown_bound", { execution_policy: { ...valid.execution_policy, cooldown_ms: -1 } }, "automation_recipe_invalid"],
    ["run_limit_bound", { execution_policy: { ...valid.execution_policy, max_runs_per_session: 0 } }, "automation_recipe_invalid"],
    ["known_action", { action: { type: "launch_missiles", risk_tier: 3, config: {} } }, "automation_recipe_unknown_action"],
    ["risk_match", { risk_tier: 1, action: { ...valid.action, risk_tier: 1 } }, "automation_recipe_risk_mismatch"],
    ["secret", { action: { ...valid.action, config: { phrase: "hello", HF_TOKEN: "hf_secret_value" } } }, "automation_recipe_contains_secret"],
    ["raw_media", { action: { ...valid.action, config: { phrase: "data:image/jpeg;base64,AAAA" } } }, "automation_recipe_contains_raw_media"],
    ["arbitrary_js", { action: { ...valid.action, config: { javascript: "alert(1)" } } }, "automation_recipe_unsafe_code"],
    ["shell_command", { action: { ...valid.action, config: { command: "rm -rf /" } } }, "automation_recipe_unsafe_code"],
    ["unrestricted_method", { risk_tier: 1, action: { type: "signed_webhook_post", risk_tier: 1, config: { destination_id: "approved", method: "DELETE" } } }, "automation_recipe_invalid"]
  ];
  for (const [code, patch, expected, options] of cases) {
    await behavior("recipe", code, `${code} returns ${expected}`, () => hasCode(validate(mergeRecipe(valid, patch), options), expected));
  }
  await behavior("recipe", "instant_recipe_confirmation_conflict", "Instant recipes cannot retain confirmation policy conflicts or unknown fields", () => {
    const result = validate({
      ...valid,
      recipe_id: "recipe_instant_confirmation_conflict",
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
      action: { type: "speak_phrase", config: { phrase: "GREAT JOB" } },
      risk_tier: 0,
      execution_policy: { cooldown_ms: 2500, max_runs_per_session: 20, require_per_run_confirmation: true, retry_limit: 0 },
      consent: { run_instantly: true, consent_version: 1, consented_at: 0 },
      surprise_field: "ignored"
    });
    const normalized = result.recipe ?? result.normalized ?? {};
    return isValid(result) && normalized.confirmation_policy === "none"
      && normalized.execution_policy?.require_per_run_confirmation === false
      && normalized.trigger?.require_user_confirmation === false
      && !Object.hasOwn(normalized, "surprise_field");
  });
}

async function runConfirmationBoundaryTests() {
  const run = app.runAutomationForConfirmedMovement;
  const cases = [
    ["unconfirmed", result({ confirmed: false }), 0, "automation_before_confirmation"],
    ["uncertain", result({ confirmed: true, uncertainty: true }), 0, "automation_from_uncertain_result"],
    ["rejected", result({ confirmed: true, rejected: true }), 0, "automation_from_rejected_result"]
  ];
  for (const [code, movement, expectedCount, expectedCode] of cases) {
    await behavior("confirmation", code, `${code} result cannot execute`, async () => {
      let executions = 0;
      const output = await run({ result: movement, recipes: [recipe()], runtime: runtime(), now_ms: 5000, execute_action: async () => { executions += 1; return receipt(); } });
      return executions === expectedCount && (hasCode(output, expectedCode) || matchesOf(output).length === 0);
    });
  }
  await behavior("confirmation", "confirmed", "Confirmed result may match and execute", async () => {
    let executions = 0;
    await run({ result: result({ confirmed: true }), recipes: [recipe()], runtime: runtime(), now_ms: 5000, execute_action: async () => { executions += 1; return receipt(); } });
    return executions === 1;
  });
  await behavior("confirmation", "corrected_identity", "Corrected result uses canonical movement identity", async () => {
    let executions = 0;
    await run({ result: result({ movement_key: "wrong", canonical_movement_key: "wave", corrected: true, confirmed: true }), recipes: [recipe()], runtime: runtime(), now_ms: 5000, execute_action: async () => { executions += 1; return receipt(); } });
    return executions === 1;
  });
  await behavior("confirmation", "duplicate_confirm", "Duplicate confirmation executes once", async () => {
    const state = runtime();
    let executions = 0;
    const input = { result: result({ confirmed: true }), recipes: [recipe()], runtime: state, now_ms: 5000, execute_action: async () => { executions += 1; return receipt(); } };
    await run(input);
    await run(input);
    return executions === 1;
  });
  const renderBlock = sliceBetween(source, "function renderLiveCameraState", "function renderMovementResultDetails") + sliceBetween(source, "function renderMovementResultDetails", "function suggestionsHtml");
  check("confirmation", "rerender_no_execution", !renderBlock.includes("runAutomationForConfirmedMovement"), "Camera/result rerenders cannot execute automation", "render source");
}

async function runMatcherTests() {
  const match = app.matchAutomationRecipes;
  const baseResult = result({ confirmed: true });
  const call = (recipes, movement = baseResult, runtimeState = runtime(), now = 5000) => matchesOf(match({ result: movement, recipes, runtime: runtimeState, now_ms: now }));
  await behavior("matcher", "exact", "Exact movement_key matches", () => call([recipe()]).length === 1);
  await behavior("matcher", "required_tags", "Required gesture tags are enforced", () => call([recipe({ trigger: { ...recipe().trigger, required_tags: ["two_hands"] } })]).length === 0);
  await behavior("matcher", "alias", "Aliases match deterministically", () => call([recipe({ trigger: { ...recipe().trigger, movement_key: "salute", aliases: ["wave"] } })]).length === 1);
  await behavior("matcher", "confidence", "Below-threshold result does not match", () => call([recipe()], result({ confirmed: true, confidence: 0.2 })).length === 0);
  await behavior("matcher", "disabled", "Disabled recipe does not match", () => call([recipe({ enabled: false })]).length === 0);
  await behavior("matcher", "cooldown", "Recipe in cooldown does not match", () => {
    const state = runtime();
    state.cooldowns = { recipe_wave_speak: 6000 };
    return call([recipe()], baseResult, state, 5000).length === 0;
  });
  await behavior("matcher", "session_cap", "Recipe session run cap is enforced", () => {
    const state = runtime();
    state.recipe_run_counts = { recipe_wave_speak: 3 };
    return call([recipe()], baseResult, state).length === 0;
  });
  await behavior("matcher", "no_match", "Unrelated movement has no match", () => call([recipe()], result({ confirmed: true, movement_key: "jump" })).length === 0);
  await behavior("matcher", "ordering", "Multiple matches sort by priority then recipe_id", () => {
    const matches = call([recipe({ recipe_id: "recipe_b", priority: 1 }), recipe({ recipe_id: "recipe_a", priority: 2 })]);
    return matches.length === 2 && matches[0].recipe_id === "recipe_a";
  });
  await behavior("matcher", "no_network_or_raw_media", "Matcher makes no network call and never reads raw media", async () => {
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => { fetches += 1; throw new Error("automation_matcher_ai_call"); };
    const guarded = result({ confirmed: true });
    for (const key of ["frame", "frames", "raw_media", "data_uri", "screenshot"]) Object.defineProperty(guarded, key, { get() { throw new Error("automation_matcher_raw_media_access"); } });
    try {
      return call([recipe()], guarded).length === 1 && fetches === 0;
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

async function runStateAndIdempotencyTests() {
  const transition = app.transitionAutomationState;
  await behavior("state", "all_transitions", "All required state transitions execute", () => {
    let state = runtime();
    for (const next of ["movement_confirmed", "matching", "match_found", "awaiting_consent", "planning", "executing", "succeeded", "cooldown", "idle"]) state = transitionState(transition, state, next);
    let failed = runtime();
    for (const next of ["movement_confirmed", "matching", "match_found", "awaiting_consent", "planning", "executing", "failed"]) failed = transitionState(transition, failed, next);
    let cancelled = runtime();
    for (const next of ["movement_confirmed", "matching", "match_found", "awaiting_consent", "cancelled"]) cancelled = transitionState(transition, cancelled, next);
    let limited = runtime();
    for (const next of ["movement_confirmed", "matching", "rate_limited"]) limited = transitionState(transition, limited, next);
    return stateName(state) === "idle" && stateName(failed) === "failed" && stateName(cancelled) === "cancelled" && stateName(limited) === "rate_limited";
  });
  await behavior("state", "invalid_transition", "Invalid transition is rejected", () => {
    const state = runtime();
    const output = transition(state, "succeeded", { now_ms: 1000 });
    return hasCode(output, "automation_invalid_transition") && stateName(state) === "idle";
  });
  await behavior("idempotency", "key", "Idempotency key is stable and includes result and recipe IDs", () => {
    const first = app.automationIdempotencyKey("movement_result_1", "recipe_1");
    const second = app.automationIdempotencyKey("movement_result_1", "recipe_1");
    const other = app.automationIdempotencyKey("movement_result_1", "recipe_2");
    return first === second && first !== other && first.includes("movement_result_1") && first.includes("recipe_1");
  });
  await behavior("idempotency", "receipt_and_retry", "Receipt is stable and retries are capped", async () => {
    const state = runtime({ retry_limit: 1 });
    let attempts = 0;
    const output = await app.runAutomationForConfirmedMovement({ result: result({ confirmed: true }), recipes: [recipe()], runtime: state, now_ms: 5000, execute_action: async () => { attempts += 1; throw new Error("synthetic failure"); } });
    return attempts <= 2 && (state.receipts?.length ?? output?.receipts?.length ?? 0) <= 1;
  });
  await behavior("idempotency", "different_recipe", "Different recipe may execute separately", async () => {
    const state = runtime();
    let executions = 0;
    await app.runAutomationForConfirmedMovement({ result: result({ confirmed: true }), recipes: [recipe(), recipe({ recipe_id: "recipe_wave_log", action: { type: "append_activity_log", risk_tier: 0, config: { text: "wave" } } })], runtime: state, now_ms: 5000, execute_action: async () => { executions += 1; return receipt(); } });
    return executions === 2;
  });
}

async function runLocalAdapterTests() {
  const execute = app.executeLocalAutomationAction;
  await behavior("adapter", "speak_phrase", "speak_phrase cancels prior speech and speaks configured text only", async () => {
    const spoken = [];
    let cancelled = 0;
    let providerCalls = 0;
    await execute({ action: { type: "speak_phrase", config: { phrase: "Stand tall." } }, runtime: runtime(), idempotency_key: "speak:1", consent: true }, {
      speechSynthesis: {
        cancel: () => { cancelled += 1; },
        speak: (utterance) => {
          spoken.push(utterance.text);
          utterance.onstart?.();
          utterance.onend?.();
        }
      },
      SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
      providerCall: () => { providerCalls += 1; }
    });
    return cancelled === 1 && spoken.join("") === "Stand tall." && providerCalls === 0;
  });
  await behavior("adapter", "notification_permission", "Browser notification requires permission without request spam", async () => {
    let prompts = 0;
    let notices = 0;
    const deps = { Notification: class { static permission = "default"; static async requestPermission() { prompts += 1; return "denied"; } constructor() { notices += 1; } } };
    const state = runtime();
    const input = { action: { type: "browser_notification", config: { title: "Movement" } }, runtime: state, idempotency_key: "notice:1", consent: true };
    const first = await execute(input, deps);
    await execute({ ...input, idempotency_key: "notice:2" }, deps);
    return prompts <= 1 && notices === 0 && hasCode(first, "automation_notification_permission_denied");
  });
  await behavior("adapter", "timer_once", "start_timer creates exactly one timer per idempotency key", async () => {
    let timers = 0;
    const state = runtime();
    const input = { action: { type: "start_timer", config: { duration_ms: 1000 } }, runtime: state, idempotency_key: "timer:1", consent: true };
    const deps = { setTimeout: () => { timers += 1; return 1; }, clearTimeout: () => {} };
    await execute(input, deps);
    await execute(input, deps);
    return timers === 1;
  });
  await behavior("adapter", "counter_and_log", "Counter is capped and activity log is text-only and clearable", async () => {
    const state = runtime({ max_actions_per_session: 2 });
    await execute({ action: { type: "increment_counter", config: { counter_id: "moves", amount: 1 } }, runtime: state, idempotency_key: "count:1", consent: true }, {});
    await execute({ action: { type: "append_activity_log", config: { text: "wave data:image/jpeg;base64,AAAA" } }, runtime: state, idempotency_key: "log:1", consent: true }, {});
    const safeLog = !/data:image|base64|frame|screenshot/i.test(JSON.stringify(state.activity_log ?? []));
    app.clearAutomationActivityLog(state);
    return state.counters?.moves === 1 && safeLog && (state.activity_log?.length ?? 0) === 0;
  });
  await behavior("adapter", "snapshot_consent", "Snapshot requires Tier 2 consent, stays local, and revokes object URL", async () => {
    const state = runtime();
    let captures = 0;
    let uploads = 0;
    let revoked = 0;
    const deps = {
      captureFreshFrame: async () => { captures += 1; return new Blob(["jpeg"], { type: "image/jpeg" }); },
      createObjectURL: () => "blob:local-snapshot",
      revokeObjectURL: () => { revoked += 1; },
      downloadBlob: () => {},
      upload: () => { uploads += 1; }
    };
    const action = { type: "local_snapshot_download", risk_tier: 2, config: {} };
    const denied = await execute({ action, runtime: state, idempotency_key: "snap:1", consent: false }, deps);
    const approved = await execute({ action, runtime: state, idempotency_key: "snap:2", consent: true }, deps);
    return hasCode(denied, "automation_snapshot_without_confirmation") && captures === 1 && uploads === 0 && revoked === 1 && !/data:image|base64/.test(JSON.stringify(approved)) && !/frame|screenshot|base64/.test(JSON.stringify(state.movementHistory ?? {}));
  });
}

async function runWebhookTests() {
  const validate = server.validateAutomationWebhookDestination;
  const allowlist = ["https://hooks.example.test/darkquest"];
  const blockedUrls = [
    ["http", "http://hooks.example.test/darkquest", "automation_webhook_http_forbidden"],
    ["localhost", "https://localhost/hook", "automation_webhook_ssrf_blocked"],
    ["loopback4", "https://127.0.0.1/hook", "automation_webhook_ssrf_blocked"],
    ["loopback6", "https://[::1]/hook", "automation_webhook_ssrf_blocked"],
    ["private10", "https://10.1.2.3/hook", "automation_webhook_ssrf_blocked"],
    ["private172", "https://172.20.1.2/hook", "automation_webhook_ssrf_blocked"],
    ["private192", "https://192.168.1.2/hook", "automation_webhook_ssrf_blocked"],
    ["linklocal", "https://169.254.1.2/hook", "automation_webhook_ssrf_blocked"],
    ["metadata", "https://169.254.169.254/latest/meta-data", "automation_webhook_ssrf_blocked"],
    ["not_allowlisted", "https://other.example.test/hook", "automation_webhook_not_allowlisted"]
  ];
  for (const [code, url, expected] of blockedUrls) await behavior("webhook", code, `${url} is blocked`, async () => hasCode(await validate({ url, method: "POST", allowlist }), expected));
  await behavior("webhook", "post_only", "Non-POST webhook method is blocked", async () => hasCode(await validate({ url: allowlist[0], method: "GET", allowlist }), "automation_webhook_http_forbidden"));
  await behavior("webhook", "allowlisted_https", "Explicit allowlisted HTTPS destination passes", async () => isValid(await validate({ url: allowlist[0], method: "POST", allowlist })));
  await behavior("webhook", "local_dev_flag", "Local destination requires explicit development flag", async () => isValid(await validate({ url: "http://localhost:9999/hook", method: "POST", allowlist: ["http://localhost:9999/hook"], env: { ALLOW_LOCAL_AUTOMATION_WEBHOOKS: "true" } })));
  await behavior("webhook", "signed_payload", "Signed request is bounded and contains no secret or media", async () => {
    const built = await server.buildSignedAutomationWebhookRequest({ destination: allowlist[0], payload: { movement_key: "wave" }, secret: "server-only-secret", timeout_ms: 2000, retry_limit: 1 });
    const json = JSON.stringify(built);
    const signature = headerOf(built, "x-darkquest-signature");
    return Boolean(signature) && !json.includes("server-only-secret") && !/data:image|base64|frame|screenshot|token|provider_request/i.test(json) && Number(built.timeout_ms ?? built.timeoutMs) <= 5000 && Number(built.retry_limit ?? built.retryLimit) <= 1;
  });
  await behavior("webhook", "payload_limit", "Overlarge payload is rejected", async () => hasCode(await server.buildSignedAutomationWebhookRequest({ destination: allowlist[0], payload: { text: "x".repeat(70_000) }, secret: "server-only-secret" }), "automation_webhook_payload_too_large"));
  await behavior("webhook", "redirect_private", "Redirect to private IP is blocked", async () => {
    let calls = 0;
    const output = await server.executeSignedAutomationWebhook({ destination: allowlist[0], payload: { movement_key: "wave" }, secret: "server-only-secret", allowlist, timeout_ms: 100, retry_limit: 0 }, { fetch: async () => { calls += 1; return { status: 302, headers: { get: () => "http://127.0.0.1/private" } }; } });
    return calls === 1 && hasCode(output, "automation_webhook_redirect_blocked");
  });
  await behavior("webhook", "retry_cap", "Webhook timeout and retry count are capped", async () => {
    let calls = 0;
    const output = await server.executeSignedAutomationWebhook({ destination: allowlist[0], payload: { movement_key: "wave" }, secret: "server-only-secret", allowlist, timeout_ms: 100, retry_limit: 1 }, { fetch: async () => { calls += 1; throw new Error("timeout"); } });
    return calls <= 2 && (hasCode(output, "automation_webhook_timeout") || hasCode(output, "automation_webhook_retry_limit"));
  });
}

async function runCostGuardTests() {
  await behavior("cost", "bounded_actions", "Actions per movement and session are bounded", async () => {
    const state = runtime({ max_actions_per_movement: 2, max_actions_per_session: 3 });
    let executions = 0;
    const recipes = Array.from({ length: 5 }, (_, index) => recipe({ recipe_id: `recipe_${index}`, priority: 5 - index }));
    await app.runAutomationForConfirmedMovement({ result: result({ confirmed: true }), recipes, runtime: state, now_ms: 5000, execute_action: async () => { executions += 1; return receipt(); } });
    return executions <= 2;
  });
  await behavior("cost", "no_recursion", "Recipe execution cannot recursively execute recipes", async () => {
    const state = runtime();
    let executions = 0;
    const input = { result: result({ confirmed: true }), recipes: [recipe()], runtime: state, now_ms: 5000 };
    input.execute_action = async () => { executions += 1; await app.runAutomationForConfirmedMovement(input); return receipt(); };
    await app.runAutomationForConfirmedMovement(input);
    return executions === 1;
  });
  const automationBlocks = ENGINE_EXPORTS.map((name, index) => sliceBetween(source, `export function ${name}`, `export function ${ENGINE_EXPORTS[index + 1] ?? "__end__"}`)).join("\n");
  check("cost", "no_analysis_loop", !/analyzeMovementInState|movement-recognition\/analyze|setInterval|requestAnimationFrame/.test(automationBlocks), "Automation engine cannot start another movement analysis or loop", "engine source");
  check("cost", "no_ai_hooks", !/buildMovementRecognitionPrompt|movementRecognitionResponseForRequest|OpenAI|LLM|VLM/.test(automationBlocks), "Recipe matching and actions contain no AI hooks", "engine source");
}

function automationUiBlockers() {
  const blockers = [];
  if (!mainUi.includes('id="automateMovement"')) blockers.push("automateMovement control after confirmation");
  if (!bodyHtml.includes('id="automationRecipeEditor"')) blockers.push("closed recipe editor modal/sheet/drawer");
  if (!mainUi.includes('id="automationReceipt"')) blockers.push("bounded execution receipt/status");
  return blockers;
}

function recipe(patch = {}) {
  const base = {
    schema: "movement-automation-recipe.v1-1",
    recipe_id: "recipe_wave_speak",
    name: "Speak after wave",
    enabled: true,
    priority: 1,
    execution_mode: "confirmed_ai_movement",
    trigger: { movement_key: "wave", aliases: ["waving"], required_tags: ["hand"], minimum_confidence: 0.7, require_user_confirmation: true },
    action: { type: "speak_phrase", risk_tier: ACTION_RISK.speak_phrase, config: { phrase: "Wave confirmed." } },
    risk_tier: ACTION_RISK.speak_phrase,
    execution_policy: { cooldown_ms: 1000, max_runs_per_session: 3, require_per_run_confirmation: false, retry_limit: 0 }
  };
  return mergeRecipe(base, patch);
}

function result(patch = {}) {
  return {
    result_id: "movement_result_1",
    movement_key: "wave",
    canonical_movement_key: "wave",
    movement_sentence: "You waved your hand.",
    gesture_tags: ["hand"],
    confidence: 0.92,
    uncertainty: false,
    confirmed: false,
    rejected: false,
    corrected: false,
    ...patch
  };
}

function runtime(patch = {}) {
  return app.createAutomationRuntimeState?.({ max_actions_per_movement: 3, max_actions_per_session: 20, retry_limit: 1, ...patch }) ?? { state: "idle", ...patch };
}

function receipt(patch = {}) {
  return { receipt_id: "receipt_1", status: "succeeded", contains_raw_media: false, model_calls: 0, ...patch };
}

function mergeRecipe(base, patch) {
  return {
    ...base,
    ...patch,
    trigger: patch.trigger ? { ...base.trigger, ...patch.trigger } : base.trigger,
    action: patch.action ? { ...base.action, ...patch.action, config: patch.action.config ?? base.action.config } : base.action
  };
}

function transitionState(transition, state, next) {
  const output = transition(state, next, { now_ms: 1000 });
  if (hasCode(output, "automation_invalid_transition")) return output;
  return output?.runtime ?? output ?? state;
}

function stateName(value) {
  return value?.automation_state ?? value?.state ?? value?.status;
}

function matchesOf(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.matches) ? value.matches : [];
}

function isValid(value) {
  return value?.valid === true || value?.ok === true;
}

function hasCode(value, code) {
  if (value?.error_code === code || value?.code === code) return true;
  const errors = Array.isArray(value?.errors) ? value.errors : [];
  return errors.some((error) => error === code || error?.code === code);
}

function headerOf(value, name) {
  const headers = value?.headers ?? value?.request?.headers ?? {};
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

async function behavior(category, code, name, execute) {
  try {
    check(category, code, Boolean(await execute()), name, "executed", "critical", "behavior");
  } catch (error) {
    check(category, code, false, name, error?.message ?? String(error), "critical", "behavior");
  }
}

function blocked(category, code, evidence) {
  check(category, code, false, "Behavior suite could not execute", evidence, "blocking", "blocked");
}

function check(category, code, passed, name, evidence, severity = "critical", kind = "source") {
  report.checks.push({ category, code, name, passed: Boolean(passed), evidence, severity, kind });
}

function read(path) {
  return readFileSync(resolve(path), "utf8");
}

function safeCode(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sliceBetween(haystack, start, end) {
  const startIndex = haystack.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = haystack.indexOf(end, startIndex + start.length);
  return haystack.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}
