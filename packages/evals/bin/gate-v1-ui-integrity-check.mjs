#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAutomationRecipeId, createRecipeStore } from "../../perception/browser-local-capture/prototype/automation/index.js";
import { AUTOMATION_RECIPE_STORAGE_KEY } from "../../perception/browser-local-capture/prototype/automation/recipe-store.js";
import {
  createInitialState,
  handleAutomationGestureChange,
  openAutomationRecipeEditor,
  saveAutomationRecipeFromForm,
  updateAutomationActionFields,
  updateAutomationRecipeModeFields
} from "../../perception/browser-local-capture/prototype/local-capture.js";

const REPORT_PATH = "runs/gate-v1-ui-integrity-latest.json";
const HTML_PATH = "packages/perception/browser-local-capture/prototype/index.html";
const SOURCE_PATH = "packages/perception/browser-local-capture/prototype/local-capture.js";
const STORE_PATH = "packages/perception/browser-local-capture/prototype/automation/recipe-store.js";
const VIEWPORTS = Object.freeze([
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 }
]);
const packageJson = JSON.parse(read("package.json"));
const html = read(HTML_PATH);
const source = read(SOURCE_PATH);
const storeSource = read(STORE_PATH);
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const developerToolsIndex = bodyHtml.indexOf('id="developerTools"');
const mainUi = developerToolsIndex >= 0 ? bodyHtml.slice(0, developerToolsIndex) : bodyHtml;

const report = {
  schema: "darkquest.gate_v1_ui_integrity_report.v0",
  gate: "v1_ui_integrity",
  claim: "Recipe identity, transactional editor behavior, and responsive product geometry remain valid across mobile, tablet, and desktop browser runtimes.",
  generated_at: new Date().toISOString(),
  viewports: VIEWPORTS,
  checks: [],
  browser_evidence: null,
  final_verdict: "FAIL"
};

async function main() {
  checkWiring();
  checkStaticProductBoundary();
  const missingFactory = typeof createAutomationRecipeId !== "function" || !storeSource.includes("createAutomationRecipeId");
  if (!missingFactory) {
    await runRecipeIdentityBehavior();
    await runTransactionalBehavior();
    await runConditionalFormBehavior();
  } else {
    blocked("identity", "recipe_id_factory_missing", "Canonical recipe ID factory is unavailable.");
  }

  const chromePath = findChrome();
  let responsiveBlocked = false;
  if (!chromePath) {
    responsiveBlocked = true;
    blocked("responsive", "responsive_browser_missing", "No supported local Chromium browser was found.");
  } else {
    try {
      report.browser_evidence = await runBrowserBehavior(chromePath);
      recordBrowserChecks(report.browser_evidence);
    } catch (error) {
      responsiveBlocked = true;
      blocked("responsive", "responsive_browser_failed", safeError(error));
    }
  }

  const failures = report.checks.filter((item) => !item.passed && item.severity === "critical");
  report.failure_count = failures.length;
  report.failures = failures;
  report.recipe_behavior_checks = report.checks.filter((item) => item.kind === "behavior").length;
  report.browser_behavior_checks = report.checks.filter((item) => item.kind === "browser").length;
  if (missingFactory) report.final_verdict = "BLOCKED_MISSING_RECIPE_ID_FACTORY";
  else if (responsiveBlocked) report.final_verdict = "BLOCKED_MISSING_RESPONSIVE_TEST";
  else if (failures.length) report.final_verdict = "FAIL";
  else report.final_verdict = "PASS_WITH_DISCLOSURE";

  mkdirSync("runs", { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.final_verdict} Gate v1 UI integrity check`);
  console.log(`report: ${REPORT_PATH}`);
  console.log(`checks: ${report.checks.filter((item) => item.passed).length}/${report.checks.length}`);
  for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
  process.exit(report.final_verdict.startsWith("PASS") ? 0 : 1);
}

function checkWiring() {
  const scripts = packageJson.scripts || {};
  check("package", "ui_integrity_script", scripts["gate:v1:ui-integrity"]?.includes("gate-v1-ui-integrity-check.mjs"), "UI-integrity gate script is wired", "package.json");
  check("package", "ui_integrity_typecheck", scripts.typecheck?.includes("gate-v1-ui-integrity-check.mjs"), "Typecheck includes UI-integrity gate", "package.json");
}

function checkStaticProductBoundary() {
  const camera = mainUi.indexOf('id="cameraTitle"');
  const control = mainUi.indexOf('id="analyzeMovement"');
  const result = mainUi.indexOf('id="movementResultTitle"');
  check("desktop_freeze", "hierarchy", camera >= 0 && camera < control && control < result, "Capture Studio -> Observe -> Visual Response hierarchy is present", `${camera}<${control}<${result}`);
  check("desktop_freeze", "result_stability", html.includes("result-card-stable") && source.includes("snapshot.result_id !== lastMovementRevealResultId"), "Result stability markers remain intact", "result-card-stable; result_id animation key");
  check("desktop_freeze", "secondary_automation", mainUi.indexOf('id="gestureRecipesCard"') > result && html.includes('<dialog id="automationManagerPanel"') && html.includes('data-default-state="closed"'), "Gesture recipe management remains secondary and closed by default", "gestureRecipesCard; automationManagerPanel dialog");
  check("identity", "recipe_id_exposed_to_user", !html.includes('id="automationRecipeId"') && source.includes("automationEditor") && !/<label[^>]*>[^<]*recipe\s+id/i.test(mainUi), "Internal recipe ID is never an editable field", "identity held in runtime editor state only");
  check("conditional", "conditional_fields", ["automationConfigLabel", "automationSecretRefField", "automationSnapshotPolicy"].every((marker) => html.includes(`id="${marker}"`)), "Action-specific fields have bounded conditional containers", "conditional field IDs");
  check("responsive", "mobile_css", /max-height:\s*calc\(100dvh - (?:16|24)px\)/.test(html) && /max-width:\s*calc\(100vw - (?:16|24)px\)/.test(html), "Mobile dialog has viewport containment", "mobile-only dialog rules");
  check("security", "favicon_embedded", /<link rel="icon"[^>]+href="\.\/favicon\.ico"/.test(html) && existsSync(resolve("packages/perception/browser-local-capture/prototype/favicon.ico")), "Favicon route has a concrete local asset", "prototype/favicon.ico");
  check("security", "no_frontend_token", !/process\.env\.HF_TOKEN|Authorization:\s*`Bearer|hf_[A-Za-z0-9]{12,}/.test(source), "Frontend exposes no HF token", "source scan");
  check("security", "no_recipe_media", !/\b(?:raw_frame|image_data|base64)\s*:/.test(storeSource) && storeSource.includes("automation_recipe_contains_raw_media"), "Recipe store rejects rather than retains raw frame or base64 fields", "store schema and validation scan");
}

async function runRecipeIdentityBehavior() {
  await behavior("identity", "recipe_id_factory_missing", "Factory returns a valid secret-free internal identity", () => {
    const id = createAutomationRecipeId();
    return /^recipe_[a-zA-Z0-9_-]{1,80}$/.test(id) && !/token|secret|hf_|sk-/i.test(id);
  });
  await behavior("identity", "recipe_id_missing_during_create", "ID is allocated before validation and normal creation never exposes a missing ID", () => {
    const storage = trackedStorage();
    let calls = 0;
    const store = createRecipeStore(storage, { idFactory: () => { calls += 1; return "recipe_generated_before_validation"; } });
    const invalid = instantRecipe({ recipe_id: undefined, name: "" });
    delete invalid.recipe_id;
    let failed = false;
    try { store.create(invalid); } catch { failed = true; }
    const valid = instantRecipe({ recipe_id: undefined, name: "Visible name" });
    delete valid.recipe_id;
    const created = store.create(valid);
    return failed && calls === 2 && created.recipe_id === "recipe_generated_before_validation" && storage.writes.length === 1;
  });
  await behavior("identity", "recipe_id_duplicate", "Generated identities are unique and duplicate supplied IDs are rejected", () => {
    const sequence = ["recipe_first", "recipe_first", "recipe_second"];
    const store = createRecipeStore(trackedStorage(), { idFactory: () => sequence.shift() });
    const firstInput = instantRecipe({ recipe_id: undefined, name: "Same name" });
    const secondInput = instantRecipe({ recipe_id: undefined, name: "Same name" });
    delete firstInput.recipe_id;
    delete secondInput.recipe_id;
    const first = store.create(firstInput);
    const second = store.create(secondInput);
    let duplicateRejected = false;
    try { store.create(instantRecipe({ recipe_id: first.recipe_id, name: "Duplicate" })); } catch (error) { duplicateRejected = error?.code === "automation_recipe_duplicate_id"; }
    return first.recipe_id === "recipe_first" && second.recipe_id === "recipe_second" && duplicateRejected;
  });
  await behavior("identity", "recipe_id_changed_during_edit", "Editing preserves the original internal identity", () => {
    const store = createRecipeStore(trackedStorage());
    const created = store.create(instantRecipe({ recipe_id: undefined }));
    const edited = store.update(created.recipe_id, { name: "Renamed recipe" });
    return edited.recipe_id === created.recipe_id;
  });
  await behavior("identity", "recipe_id_migration_failed", "Legacy missing identities are migrated without losing recipes", () => {
    const storage = trackedStorage();
    const legacy = instantRecipe({ recipe_id: undefined });
    delete legacy.recipe_id;
    legacy.schema_version = "movement-automation-recipe.v1";
    storage.setItem(AUTOMATION_RECIPE_STORAGE_KEY, JSON.stringify({ schema_version: "movement-automation-recipe.v1", recipes: [legacy] }));
    const migrated = createRecipeStore(storage).list();
    return migrated.length === 1 && /^recipe_[a-zA-Z0-9_-]{1,80}$/.test(migrated[0].recipe_id);
  });
}

async function runTransactionalBehavior() {
  const storage = trackedStorage();
  const store = createRecipeStore(storage);
  const created = store.create(instantRecipe({ recipe_id: undefined }));
  await behavior("transaction", "recipe_save_non_atomic", "Invalid create/edit performs no storage write or in-memory mutation", () => {
    const before = store.list();
    const writes = storage.writes.length;
    const invalid = instantRecipe({ recipe_id: undefined, name: "" });
    delete invalid.recipe_id;
    let createFailed = false;
    let editFailed = false;
    try { store.create(invalid); } catch { createFailed = true; }
    try { store.update(created.recipe_id, { name: "" }); } catch { editFailed = true; }
    return createFailed && editFailed && storage.writes.length === writes && JSON.stringify(store.list()) === JSON.stringify(before);
  });
  await behavior("transaction", "recipe_save_corrupted_store", "Storage failure cannot commit the next in-memory document", () => {
    const failing = trackedStorage();
    const transactional = createRecipeStore(failing);
    const seed = transactional.create(instantRecipe({ recipe_id: "recipe_atomic_seed" }));
    const before = transactional.list();
    failing.failWrites = true;
    let failed = false;
    try { transactional.update(seed.recipe_id, { name: "Should not commit" }); } catch { failed = true; }
    return failed && JSON.stringify(transactional.list()) === JSON.stringify(before);
  });
  await behavior("transaction", "recipe_edit_deleted_existing", "Failed modal edit preserves recipe, draft, and open dialog", () => {
    const target = createInitialState();
    target.automation.recipes = store.list();
    const dom = editorDom();
    openAutomationRecipeEditor(target, created.recipe_id, { store, dom });
    const before = store.read(created.recipe_id);
    dom.automationRecipeName.value = "";
    dom.automationConfigValue.value = "DRAFT REMAINS";
    const result = saveAutomationRecipeFromForm(target, dom, { store });
    return result === null && dom.automationRecipeDialog.open && dom.automationConfigValue.value === "DRAFT REMAINS"
      && !dom.automationFormError.hidden && !target.errorMessage && JSON.stringify(store.read(created.recipe_id)) === JSON.stringify(before);
  });
  await behavior("transaction", "recipe_draft_lost_on_error", "Modal error stays local and successful retry closes with the same ID", () => {
    const target = createInitialState();
    const dom = editorDom();
    openAutomationRecipeEditor(target, created.recipe_id, { store, dom });
    const stableId = target.automationEditor?.recipeId || "";
    dom.automationRecipeName.value = "Valid retry";
    const saved = saveAutomationRecipeFromForm(target, dom, { store });
    const assertions = {
      stable_id: saved?.recipe_id === stableId,
      dialog_closed: dom.automationRecipeDialog.open === false,
      error_hidden: dom.automationFormError.hidden === true,
      list_updated: target.automation.recipes.some((recipe) => recipe.recipe_id === stableId && recipe.name === "Valid retry")
    };
    if (!Object.values(assertions).every(Boolean)) throw new Error(JSON.stringify({ assertions, stableId, savedId: saved?.recipe_id, recipes: target.automation.recipes.map(({ recipe_id, name }) => ({ recipe_id, name })) }));
    return true;
  });
  await behavior("transaction", "recipe_error_scope_invalid", "Validation errors are bounded and redact token-like values", () => {
    const target = createInitialState();
    const dom = editorDom();
    dom.automationInstantMode.checked = true;
    dom.automationRecipeName.value = "Unsafe draft";
    dom.automationConfigValue.value = "hf_abcdefghijklmnop";
    const result = saveAutomationRecipeFromForm(target, dom, { store });
    return result === null && dom.automationFormError.hidden === false && !/hf_abcdefghijklmnop/.test(dom.automationFormError.textContent) && target.errorMessage === "";
  });
}

async function runConditionalFormBehavior() {
  await behavior("conditional", "recipe_irrelevant_field_visible", "Each action exposes only its relevant configuration fields", () => {
    const dom = editorDom();
    const matrix = [
      ["speak_phrase", "Phrase", false, false],
      ["signed_webhook_post", "Approved destination ID", true, false],
      ["start_timer", "Duration seconds", false, false],
      ["increment_counter", "Counter name", false, false],
      ["append_activity_log", "Activity category or template", false, false],
      ["local_snapshot_download", "Filename prefix", false, true]
    ];
    return matrix.every(([type, label, secret, snapshot]) => {
      dom.automationActionType.value = type;
      updateAutomationActionFields(dom);
      return dom.automationConfigLabel.textContent === label && dom.automationSecretRefField.hidden === !secret
        && dom.automationSecretRef.disabled === !secret && dom.automationSnapshotPolicy.hidden === !snapshot;
    });
  });
  await behavior("conditional", "recipe_alias_contamination", "Changing gesture clears aliases from the prior gesture", () => {
    const dom = editorDom();
    dom.automationGestureKey.dataset.previousGesture = "thumbs_up";
    dom.automationAliases.value = "thumb gesture";
    dom.automationGestureKey.value = "peace_sign";
    handleAutomationGestureChange(dom);
    return dom.automationAliases.value === "" && dom.automationGestureKey.dataset.previousGesture === "peace_sign";
  });
  await behavior("conditional", "recipe_instant_confirmation_conflict", "Instant timing hides and disables after-confirm policy", () => {
    const dom = editorDom();
    dom.automationInstantMode.checked = true;
    dom.automationActionType.value = "speak_phrase";
    updateAutomationRecipeModeFields(dom);
    return dom.automationConfirmationPolicyField.hidden && dom.automationConfirmationPolicy.disabled && dom.automationConfirmationPolicy.value === "none";
  });
}

async function runBrowserBehavior(chromePath) {
  const serverFixture = await startFixtureServer();
  const userDataDir = mkdtempSync(join(tmpdir(), "darkquest-ui-integrity-"));
  const debugPort = await reservePort();
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  chrome.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let client;
  try {
    const target = await waitForPageTarget(debugPort);
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Log.enable"), client.send("Network.enable")]);
    const runtimeErrors = [];
    const consoleErrors = [];
    const networkErrors = [];
    const faviconStatuses = [];
    client.on("Runtime.exceptionThrown", (params) => runtimeErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "runtime exception"));
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") consoleErrors.push(params.args?.map((arg) => arg.value || arg.description || "error").join(" "));
    });
    client.on("Log.entryAdded", ({ entry }) => {
      if (entry?.level === "error") consoleErrors.push(entry.text || "log error");
    });
    client.on("Network.responseReceived", ({ response }) => {
      if (Number(response?.status) >= 400) networkErrors.push(`${response.status} ${response.url}`);
      if (String(response?.url || "").endsWith("/favicon.ico")) faviconStatuses.push(Number(response.status));
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: browserPrelude() });
    await setViewport(client, VIEWPORTS[0]);
    await client.send("Page.navigate", { url: serverFixture.url });
    await waitFor(client, "document.readyState === 'complete' && !!document.querySelector('#startCamera')", 8000);
    const viewportResults = [];
    for (const viewport of VIEWPORTS) {
      await setViewport(client, viewport);
      await delay(80);
      await evaluate(client, "document.querySelector('#automationRecipeEditor').showModal()");
      const geometry = await evaluate(client, `(${measureLayout.toString()})(${JSON.stringify(viewport)})`);
      await evaluate(client, "document.querySelector('#automationRecipeEditor').close()");
      viewportResults.push({ ...viewport, ...geometry });
    }
    await setViewport(client, VIEWPORTS[0]);
    const mobileFlow = await runMobileFlow(client);
    return {
      chrome: chromePath,
      viewport_results: viewportResults,
      mobile_flow: mobileFlow,
      runtime_errors: runtimeErrors,
      console_errors: consoleErrors,
      network_errors: networkErrors,
      favicon_statuses: faviconStatuses,
      chrome_stderr: stderr.split("\n").filter((line) => /ERROR|WARNING/i.test(line)).slice(0, 10)
    };
  } finally {
    client?.close();
    chrome.kill("SIGTERM");
    await serverFixture.close();
    await Promise.race([
      new Promise((resolveExit) => chrome.exitCode == null ? chrome.once("exit", resolveExit) : resolveExit()),
      delay(1000)
    ]);
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  }
}

function recordBrowserChecks(evidence) {
  for (const viewport of evidence.viewport_results) {
    const key = `${viewport.width}x${viewport.height}`;
    browserCheck("responsive", `responsive_horizontal_overflow_${key}`, viewport.scroll_width <= viewport.inner_width + 1, `${key} has no horizontal document overflow`, `${viewport.scroll_width} <= ${viewport.inner_width + 1}`);
    browserCheck("responsive", `responsive_container_escape_${key}`, viewport.container_escapes.length === 0, `${key} cards and controls stay inside the viewport`, viewport.container_escapes);
    browserCheck("responsive", `responsive_text_escape_${key}`, viewport.text_escapes.length === 0, `${key} text stays inside its containing surface`, viewport.text_escapes);
    browserCheck("responsive", `responsive_modal_out_of_bounds_${key}`, viewport.modal_reachable && viewport.modal_actions_reachable, `${key} modal and Save/Cancel remain reachable`, { modal: viewport.modal_rect, actions: viewport.modal_action_rects });
    browserCheck("responsive", `responsive_pathological_word_wrap_${key}`, viewport.pathological_wrap.length === 0, `${key} has no one-character-per-line text`, viewport.pathological_wrap);
    browserCheck("responsive", `responsive_mobile_not_stacked_${key}`, viewport.stack_valid, `${key} uses the expected stacked/desktop layout`, viewport.stack_geometry);
    browserCheck("responsive", `responsive_action_unreachable_${key}`, viewport.camera_visible && viewport.result_visible && viewport.buttons_tappable, `${key} camera, result, and actions remain usable`, { camera: viewport.camera_visible, result: viewport.result_visible, buttons: viewport.buttons_tappable });
  }
  const flow = evidence.mobile_flow;
  browserCheck("mobile_flow", "mobile_complete_flow", flow.completed, "390x844 completes create, save, reopen, edit, and close", flow.steps);
  browserCheck("identity", "mobile_recipe_id_stable", flow.generated_id_valid && flow.same_id_after_reopen && !flow.id_visible_to_user, "Mobile creation generates a hidden stable ID", flow.recipe_id);
  browserCheck("responsive", "mobile_flow_no_overflow", flow.max_overflow_px <= 1 && flow.container_escapes.length === 0, "Mobile flow has no horizontal overflow or escaped surface", flow);
  browserCheck("resize", "resize_state_stable", flow.resize_state_stable, "Orientation change preserves camera, result, draft, instant toggle, recipes, and receipts", flow.resize_snapshot);
  browserCheck("resize", "resize_no_duplicate_execution", flow.receipts_before_resize === flow.receipts_after_resize && flow.animation_events_after_resize === flow.animation_events_before_resize, "Resize creates no automation execution or result animation", flow.resize_snapshot);
  browserCheck("desktop_freeze", "desktop_geometry", evidence.viewport_results.find((item) => item.width === 1440)?.stack_valid === true, "Desktop remains a two-column camera/result composition", evidence.viewport_results.find((item) => item.width === 1440)?.stack_geometry);
  browserCheck("security", "browser_console_clean", evidence.runtime_errors.length === 0 && evidence.console_errors.length === 0 && evidence.network_errors.length === 0, "Mobile flow has no uncaught, console, network, or favicon error", { runtime: evidence.runtime_errors, console: evidence.console_errors, network: evidence.network_errors });
  browserCheck("security", "favicon_route_ok", evidence.favicon_statuses.length >= 1 && evidence.favicon_statuses.every((status) => status === 200), "Browser favicon request returns 200", evidence.favicon_statuses);
  browserCheck("security", "browser_warnings_bounded", evidence.chrome_stderr.length <= 10, "Browser process warnings are bounded; app console remains clean", evidence.chrome_stderr);
}

async function runMobileFlow(client) {
  const steps = [];
  const layouts = [];
  const record = async (name) => {
    steps.push(name);
    layouts.push(await evaluate(client, `(${measureLayout.toString()})({width: innerWidth, height: innerHeight})`));
  };
  await evaluate(client, "document.querySelector('#startCamera').click()");
  await waitFor(client, "document.body.classList.contains('dq-camera-live')", 4000);
  await record("camera_started");
  await evaluate(client, "document.querySelector('#analyzeMovement').click()");
  await waitFor(client, "document.querySelector('#cameraSuggestionCount')?.textContent.includes('Response ready') && !!document.querySelector('.dq-movement-sentence')", 7000);
  await record("visual_response_ready");
  await evaluate(client, "document.querySelector('#openGestureRecipes').click()");
  await waitFor(client, "document.querySelector('#automationManagerPanel').open", 2000);
  await evaluate(client, `(() => {
    const select = document.querySelector('#automationPresetSelect');
    select.selectedIndex = Math.min(1, select.options.length - 1);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#addAutomationPreset').click();
  })()`);
  await waitFor(client, "!!document.querySelector('[data-automation-action=\"edit\"]')", 3000);
  await record("recipe_created_from_preset");
  await evaluate(client, "document.querySelector('[data-automation-action=\"edit\"]').click()");
  await waitFor(client, "document.querySelector('#automationRecipeEditor').open", 2000);
  await record("editor_open");
  await evaluate(client, `(() => {
    const set = (selector, value) => { const node = document.querySelector(selector); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); };
    set('#automationGestureKey', 'thumbs_up');
    set('#automationActionType', 'speak_phrase');
    document.querySelector('#automationRecipeName').value = 'Mobile thumbs up';
    document.querySelector('#automationConfigValue').value = 'GREAT JOB';
    const instant = document.querySelector('#automationInstantMode');
    instant.checked = true;
    instant.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await record("instant_draft_ready");
  await evaluate(client, "document.querySelector('#automationRecipeForm').requestSubmit()");
  await waitFor(client, "!document.querySelector('#automationRecipeEditor').open && !!document.querySelector('[data-automation-action=\"edit\"]')", 3000);
  const recipeId = await evaluate(client, "document.querySelector('[data-automation-action=\"edit\"]').getAttribute('data-recipe-id')");
  await record("recipe_saved");
  await evaluate(client, "document.querySelector('[data-automation-action=\"edit\"]').click()");
  await waitFor(client, "document.querySelector('#automationRecipeEditor').open", 2000);
  await evaluate(client, "document.querySelector('#automationRecipeName').value = 'Mobile thumbs up edited'; document.querySelector('#automationRecipeForm').requestSubmit()");
  await waitFor(client, "!document.querySelector('#automationRecipeEditor').open", 2000);
  const sameId = await evaluate(client, `document.querySelector('[data-automation-action="edit"]').getAttribute('data-recipe-id') === ${JSON.stringify(recipeId)}`);
  await evaluate(client, "document.querySelector('[data-automation-action=\"edit\"]').click()");
  await waitFor(client, "document.querySelector('#automationRecipeEditor').open", 2000);
  await evaluate(client, `(() => {
    document.querySelector('#automationRecipeName').value = 'Unsaved orientation draft';
    const toggle = document.querySelector('#instantGestures');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const beforeResize = await evaluate(client, resizeSnapshotExpression());
  await setViewport(client, { width: 844, height: 390 });
  await delay(120);
  const afterResize = await evaluate(client, resizeSnapshotExpression());
  const resizedLayout = await evaluate(client, `(${measureLayout.toString()})({width: innerWidth, height: innerHeight})`);
  layouts.push(resizedLayout);
  await evaluate(client, "document.querySelector('#cancelAutomationRecipe').click()");
  const idVisible = await evaluate(client, `document.body.innerText.includes(${JSON.stringify(recipeId)})`);
  const maxOverflow = Math.max(...layouts.map((item) => Math.max(0, item.scroll_width - item.inner_width)));
  return {
    completed: Boolean(recipeId) && sameId && !(await evaluate(client, "document.querySelector('#automationRecipeEditor').open")),
    steps,
    recipe_id: recipeId,
    generated_id_valid: /^recipe_[a-zA-Z0-9_-]{1,80}$/.test(recipeId || ""),
    same_id_after_reopen: sameId,
    id_visible_to_user: idVisible,
    max_overflow_px: maxOverflow,
    container_escapes: layouts.flatMap((item) => item.container_escapes),
    resize_state_stable: ["camera_live", "movement", "draft", "instant_enabled", "recipe_count"].every((key) => JSON.stringify(beforeResize[key]) === JSON.stringify(afterResize[key])),
    receipts_before_resize: beforeResize.receipt_count,
    receipts_after_resize: afterResize.receipt_count,
    animation_events_before_resize: beforeResize.animation_events,
    animation_events_after_resize: afterResize.animation_events,
    resize_snapshot: { before: beforeResize, after: afterResize }
  };
}

function resizeSnapshotExpression() {
  return `(() => ({
    camera_live: document.body.classList.contains('dq-camera-live'),
    movement: document.querySelector('.dq-movement-sentence')?.textContent || '',
    draft: document.querySelector('#automationRecipeName')?.value || '',
    instant_enabled: document.querySelector('#instantGestures')?.checked === true,
    recipe_count: JSON.parse(localStorage.getItem('${AUTOMATION_RECIPE_STORAGE_KEY}') || '{"recipes":[]}').recipes.length,
    receipt_count: document.querySelectorAll('#automationReceiptList .dq-history-item').length,
    animation_events: globalThis.__dqResultAnimationEvents || 0
  }))()`;
}

function measureLayout(viewport) {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return !element.hidden && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const roundRect = (rect) => ({ left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) });
  const escapeSelectors = ".dq-card,.dq-camera-frame,.dq-button,button,input,select,dialog[open],.dq-history-item";
  const containerEscapes = [...document.querySelectorAll(escapeSelectors)].filter(visible).flatMap((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left < -1 || rect.right > innerWidth + 1 ? [`${element.id || element.className || element.tagName}:${Math.round(rect.left)}..${Math.round(rect.right)}`] : [];
  });
  const textEscapes = [];
  const pathologicalWrap = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.replace(/\s+/g, " ").trim();
    const parent = node.parentElement;
    if (!text || !parent || parent.closest(".sr-only,[hidden],details:not([open]) > :not(summary)")) continue;
    if (!visible(parent)) continue;
    const container = parent.closest("button,label,.dq-card,.dq-camera-frame,dialog,.dq-history-item,.dq-pill,.dq-badge,.dq-inline-note");
    if (!container || !visible(container)) continue;
    const containerRect = container.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    const lineRects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    if (lineRects.some((rect) => rect.left < containerRect.left - 1 || rect.right > containerRect.right + 1)) textEscapes.push(text.slice(0, 60));
    const words = text.split(/\s+/).filter((word) => word.length >= 4);
    if (words.length && lineRects.length >= 4 && Math.max(...lineRects.map((rect) => rect.width)) < 24) pathologicalWrap.push(text.slice(0, 60));
  }
  const main = document.querySelector(".dq-camera-card")?.getBoundingClientRect();
  const flow = document.querySelector("#cameraSuggestionsPanel")?.getBoundingClientRect();
  const shouldStack = Number(viewport.width) <= 1180;
  const stackValid = Boolean(main && flow) && (shouldStack
    ? Math.abs(main.left - flow.left) <= 2 && flow.top >= main.bottom - 2
    : flow.left >= main.right - 2 && Math.abs(flow.top - main.top) <= 24);
  const modal = document.querySelector("#automationRecipeEditor");
  const modalRect = modal?.getBoundingClientRect();
  const actionRects = [...(modal?.querySelectorAll("button") || [])].filter(visible).map((button) => roundRect(button.getBoundingClientRect()));
  const visibleButtons = [...document.querySelectorAll("button")].filter(visible);
  return {
    inner_width: innerWidth,
    scroll_width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    container_escapes: [...new Set(containerEscapes)],
    text_escapes: [...new Set(textEscapes)],
    pathological_wrap: [...new Set(pathologicalWrap)],
    stack_valid: stackValid,
    stack_geometry: { should_stack: shouldStack, main: main ? roundRect(main) : null, flow: flow ? roundRect(flow) : null },
    camera_visible: visible(document.querySelector(".dq-camera-frame")),
    result_visible: visible(document.querySelector("#cameraSuggestionsPanel")),
    buttons_tappable: visibleButtons.every((button) => button.getBoundingClientRect().height >= 32 && button.getBoundingClientRect().width >= 32),
    modal_reachable: Boolean(modalRect) && modalRect.left >= -1 && modalRect.right <= innerWidth + 1 && modalRect.top >= -1 && modalRect.bottom <= innerHeight + 1,
    modal_actions_reachable: actionRects.length >= 2 && actionRects.every((rect) => rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1),
    modal_rect: modalRect ? roundRect(modalRect) : null,
    modal_action_rects: actionRects
  };
}

function browserPrelude() {
  return `(() => {
    globalThis.__dqResultAnimationEvents = 0;
    document.addEventListener('animationstart', (event) => { if (event.target?.classList?.contains('result-reveal')) globalThis.__dqResultAnimationEvents += 1; }, true);
    class FakeWorker {
      constructor() { this.listeners = {}; }
      addEventListener(type, listener) { this.listeners[type] = listener; }
      emit(data) { this.listeners.message?.({ data }); }
      postMessage(message) {
        if (message.type === 'init') queueMicrotask(() => { this.emit({ type: 'gesture_engine_loading' }); this.emit({ type: 'gesture_engine_initialized' }); this.emit({ type: 'gesture_engine_ready' }); });
        if (message.type === 'frame') queueMicrotask(() => { message.image?.close?.(); this.emit({ type: 'gesture_result', gestures: [], timestamp_ms: message.timestamp_ms }); this.emit({ type: 'gesture_frame_complete' }); });
      }
      terminate() {}
    }
    globalThis.Worker = FakeWorker;
    globalThis.createImageBitmap = async () => ({ close() {} });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get() { return this.__dqStream || null; }, set(value) { this.__dqStream = value; } });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    HTMLMediaElement.prototype.play = async function play() {};
    HTMLCanvasElement.prototype.getContext = function getContext() {
      return { save() {}, restore() {}, translate() {}, scale() {}, drawImage() {}, fillRect() {}, fillStyle: '', getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) };
    };
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type = 'image/jpeg') { callback(new Blob([new Uint8Array([255, 216, 255, 217])], { type })); };
    Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(utterance) { queueMicrotask(() => { utterance?.onstart?.(); utterance?.onend?.(); }); } } });
    globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  })();`;
}

async function startFixtureServer() {
  const root = resolve("packages/perception/browser-local-capture/prototype");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/movement-recognition/health") return json(response, 200, { ok: true, provider: "harness", model: "ui-integrity-mock", mode: "vlm_frames", has_token: true, token_exposed_to_frontend: false, analyze_endpoint_ready: true });
    if (url.pathname === "/api/movement-recognition/usage") return json(response, 200, {
      ok: true,
      cloud_enabled: true,
      session: { used: 0, limit: 20, remaining: 20 },
      day: { used: 0, limit: 50, remaining: 50 },
      month: { used: 0, limit: 100, remaining: 100 },
      concurrent: { used: 0, limit: 1, remaining: 1 }
    });
    if (url.pathname === "/api/visual-companion/health") return json(response, 200, {
      ok: true,
      provider: "local_visual_companion",
      status: "model_not_installed",
      model: "ui-integrity-local-model",
      token_exposed_to_frontend: false
    });
    if (url.pathname === "/api/movement-recognition/analyze") {
      await readRequestBody(request);
      return json(response, 200, { movement: "You raised your hand and made a peace sign.", short_label: "Peace sign", action_type: "peace_sign", confidence: 0.92, reason: "Mocked temporal movement for UI integrity.", evidence: ["hand raised", "two fingers visible"], provider: "harness", model: "ui-integrity-mock", requested_model: "ui-integrity-mock", returned_model: "ui-integrity-mock", latency_ms: 12 });
    }
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const path = resolve(root, relative);
    if (path !== root && !path.startsWith(`${root}${sep}`)) return json(response, 403, { error: "forbidden" });
    if (!existsSync(path) || !statSync(path).isFile()) return json(response, 404, { error: "not_found" });
    response.writeHead(200, { "Content-Type": contentType(path), "Cache-Control": "no-store" });
    response.end(readFileSync(path));
  });
  await new Promise((resolveListen, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolveListen()));
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise((resolveClose) => server.close(resolveClose)) };
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForPageTarget(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await delay(100);
  }
  throw new Error("Headless browser did not expose a page target.");
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message));
        else pending?.resolve(message.result || {});
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
      }
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }
  close() { this.socket.close(); }
}

async function setViewport(client, viewport) {
  await client.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 640 });
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function waitFor(client, expression, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await delay(50);
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}

function editorDom() {
  return {
    automationRecipeId: { value: "" }, automationRecipeName: { value: "" },
    automationMovementSentence: { textContent: "" }, automationShortLabel: { textContent: "" },
    automationMovementKey: { value: "", readOnly: false }, automationInstantMode: { checked: false, disabled: false },
    automationInstantPolicy: { hidden: true, textContent: "" }, automationInstantUpgrade: { hidden: true },
    automationGestureKey: { value: "thumbs_up", disabled: false, dataset: {} }, automationConfidence: { textContent: "" },
    automationActionType: { value: "speak_phrase" }, automationAliases: { value: "" },
    automationMinConfidence: { value: "0.7" }, automationHoldMs: { value: "350", disabled: false },
    automationCooldown: { value: "2.5" }, automationConfirmationPolicy: { value: "none", disabled: false },
    automationConfirmationPolicyField: { hidden: false }, automationConfigField: { hidden: false },
    automationConfigLabel: { textContent: "Phrase" }, automationConfigValue: { value: "GREAT JOB", placeholder: "" },
    automationSecretRefField: { hidden: true }, automationSecretRef: { value: "", disabled: true },
    automationSnapshotPolicy: { hidden: true }, automationFormError: { hidden: true, textContent: "" },
    automationEnabled: { checked: true },
    automationRecipeDialog: { open: false, showModal() { this.open = true; }, close() { this.open = false; } }
  };
}

function instantRecipe(patch = {}) {
  return {
    schema: "movement-automation-recipe.v1-1",
    recipe_id: patch.recipe_id === undefined ? "recipe_ui_integrity" : patch.recipe_id,
    name: patch.name === undefined ? "UI integrity recipe" : patch.name,
    enabled: true,
    execution_mode: "instant_local_gesture",
    confirmation_policy: "none",
    trigger: { movement_key: "thumbs_up", source: "mediapipe_gesture", gesture_key: "thumbs_up", aliases: [], required_tags: [], minimum_confidence: 0.7, hold_ms: 350, neutral_reset_required: true, require_user_confirmation: false },
    action: { type: "speak_phrase", config: { text: patch.text || "GREAT JOB" } },
    risk_tier: 0,
    execution_policy: { cooldown_ms: 2500, max_runs_per_session: 20, require_per_run_confirmation: false, retry_limit: 0 },
    consent: { run_instantly: true, consent_version: 1, consented_at: 0 },
    created_at: 0,
    updated_at: 0
  };
}

function trackedStorage() {
  const values = new Map();
  const storage = {
    writes: [], failWrites: false,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (storage.failWrites) throw new Error("synthetic storage failure");
      storage.writes.push({ key, value });
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key)
  };
  return storage;
}

function findChrome() {
  return [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium"
  ].find((candidate) => candidate && existsSync(candidate)) || "";
}

function contentType(path) {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm" })[extname(path)] || "application/octet-stream";
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readRequestBody(request) {
  for await (const _chunk of request) {}
}

async function behavior(category, code, name, execute) {
  try { check(category, code, Boolean(await execute()), name, "executed", "critical", "behavior"); }
  catch (error) { check(category, code, false, name, safeError(error), "critical", "behavior"); }
}

function browserCheck(category, code, passed, name, evidence) {
  check(category, code, passed, name, evidence, "critical", "browser");
}

function blocked(category, code, evidence) {
  check(category, code, false, "Required behavior could not execute", evidence, "blocking", "blocked");
}

function check(category, code, passed, name, evidence, severity = "critical", kind = "source") {
  report.checks.push({ category, code, name, passed: Boolean(passed), evidence, severity, kind });
}

function safeError(error) {
  return String(error?.message || error || "unknown error").replace(/\b(?:hf_|sk-)[a-z0-9_-]+\b/gi, "[redacted]").slice(0, 500);
}

function read(path) {
  return readFileSync(resolve(path), "utf8");
}

await main();
