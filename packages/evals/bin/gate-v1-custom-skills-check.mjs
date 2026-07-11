#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(".");
const REPORT_PATH = "runs/gate-v1-custom-skills-latest.json";
const PHYSICAL_PATH = "runs/custom-skills-physical-latest.json";
const paths = {
  package: "package.json",
  html: "packages/perception/browser-local-capture/prototype/index.html",
  runtime: "packages/perception/browser-local-capture/prototype/local-capture.js",
  engine: "packages/perception/browser-local-capture/prototype/perception/custom-skills/index.js",
  trainer: "packages/perception/browser-local-capture/prototype/perception/custom-skills/custom-skill-trainer.js",
  classifier: "packages/perception/browser-local-capture/prototype/perception/custom-skills/hand-pose-classifier.js",
  skillRuntime: "packages/perception/browser-local-capture/prototype/perception/custom-skills/custom-skill-runtime.js",
  store: "packages/perception/browser-local-capture/prototype/perception/custom-skills/custom-skill-store.js",
  automation: "packages/perception/browser-local-capture/prototype/automation/index.js",
  automationEngine: "packages/perception/browser-local-capture/prototype/automation/automation-engine.js",
  test: "packages/perception/browser-local-capture/test/custom-movement-skills.test.mjs",
  contract: "docs/contracts/custom-movement-skill.v1.md",
  protocol: "docs/evals/darkquest-v1-3-custom-skill-physical-protocol.md"
};

const report = {
  schema: "darkquest.gate_v1_custom_skills_report.v0",
  gate: "v1_custom_skills",
  claim: "A user-trained two-hand landmark skill can trigger a safe local action without raw-media persistence or model calls.",
  generated_at: new Date().toISOString(),
  files_checked: paths,
  checks: [],
  behavior_checks_executed: 0,
  physical_evidence: { present: false, valid: false, path: PHYSICAL_PATH },
  final_verdict: "FAIL"
};

const add = (category, code, passed, evidence = null, severity = "critical") => report.checks.push({ category, code, passed: passed === true, severity, evidence: safeEvidence(evidence) });
const packageJson = JSON.parse(read(paths.package));
const html = read(paths.html);
const runtimeSource = read(paths.runtime);
const engineSource = [paths.engine, paths.trainer, paths.classifier, paths.skillRuntime, paths.store].map(read).join("\n");
const automationSource = `${read(paths.automation)}\n${read(paths.automationEngine)}`;

checkPackage();
checkFiles();
checkUi();
checkPrivacyBoundary();

let behavior = { blocked_code: "BLOCKED_MISSING_CUSTOM_SKILL_TEST", checks: [], evidence: "test missing" };
if (exists(paths.test)) {
  const testModule = await import(pathToFileURL(resolve(paths.test)).href);
  if (typeof testModule.runCustomMovementSkillBehaviorSuite === "function") behavior = await testModule.runCustomMovementSkillBehaviorSuite();
}
report.behavior_checks_executed = behavior.checks?.length || 0;
report.behavior_blocker = behavior.blocked_code || null;
for (const item of behavior.checks || []) add("behavior", item.id, item.passed, item.evidence);

const physical = validatePhysicalEvidence();
report.physical_evidence = physical;
add("physical", "physical_heart_protocol", physical.valid, physical.evidence, "disclosure");

const engineFiles = [paths.engine, paths.classifier, paths.skillRuntime, paths.store].every(exists);
const trainerPresent = exists(paths.trainer);
const testPresent = exists(paths.test) && report.behavior_checks_executed > 0;
const criticalFailures = report.checks.filter((item) => item.severity === "critical" && !item.passed);

if (!engineFiles || behavior.blocked_code === "BLOCKED_MISSING_CUSTOM_SKILL_ENGINE") report.final_verdict = "BLOCKED_MISSING_CUSTOM_SKILL_ENGINE";
else if (!trainerPresent || behavior.blocked_code === "BLOCKED_MISSING_CUSTOM_SKILL_TRAINER") report.final_verdict = "BLOCKED_MISSING_CUSTOM_SKILL_TRAINER";
else if (!testPresent || behavior.blocked_code === "BLOCKED_MISSING_CUSTOM_SKILL_TEST") report.final_verdict = "BLOCKED_MISSING_CUSTOM_SKILL_TEST";
else if (criticalFailures.length) report.final_verdict = "FAIL";
else report.final_verdict = physical.valid ? "PASS" : "PASS_WITH_DISCLOSURE";

report.failure_count = criticalFailures.length;
report.failures = criticalFailures;
mkdirSync("runs", { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.final_verdict} Gate v1.3 custom movement skills check`);
console.log(`report: ${REPORT_PATH}`);
console.log(`checks: ${report.checks.filter((item) => item.passed).length}/${report.checks.length}`);
console.log(`behavior checks: ${report.behavior_checks_executed}`);
console.log(`physical evidence: ${physical.valid ? "verified" : "not verified"}`);
for (const failure of criticalFailures.slice(0, 12)) console.log(`- ${failure.category}.${failure.code}`);
process.exit(report.final_verdict === "PASS" || report.final_verdict === "PASS_WITH_DISCLOSURE" ? 0 : 1);

function checkPackage() {
  const scripts = packageJson.scripts || {};
  add("package", "custom_skill_test_script", scripts["test:custom-skills"] === "node packages/perception/browser-local-capture/test/custom-movement-skills.test.mjs", scripts["test:custom-skills"]);
  add("package", "custom_skill_gate_script", scripts["gate:v1:custom-skills"] === "node packages/evals/bin/gate-v1-custom-skills-check.mjs", scripts["gate:v1:custom-skills"]);
  add("package", "custom_skill_typecheck", scripts.typecheck?.includes("gate-v1-custom-skills-check.mjs") && scripts.typecheck?.includes("custom-movement-skills.test.mjs"), "typecheck coverage");
}

function checkFiles() {
  add("engine", "custom_skill_engine", exists(paths.engine), paths.engine);
  add("engine", "custom_skill_trainer", exists(paths.trainer), paths.trainer);
  add("engine", "custom_skill_classifier", exists(paths.classifier), paths.classifier);
  add("engine", "custom_skill_runtime", exists(paths.skillRuntime), paths.skillRuntime);
  add("engine", "custom_skill_store", exists(paths.store), paths.store);
  add("test", "custom_skill_behavior_test", exists(paths.test), paths.test);
  add("contract", "custom_skill_contract", exists(paths.contract), paths.contract);
  add("protocol", "custom_skill_physical_protocol", exists(paths.protocol), paths.protocol);
  add("runtime", "canonical_custom_skill_import", runtimeSource.includes('from "./perception/custom-skills/index.js"') || runtimeSource.includes("from './perception/custom-skills/index.js'"), "local-capture canonical import");
  add("runtime", "canonical_automation_import", runtimeSource.includes('from "./automation/index.js"') || runtimeSource.includes("from './automation/index.js'"), "local-capture automation import");
  add("runtime", "custom_source_supported", automationSource.includes("custom_local_skill"), "canonical instant runner source allowlist");
}

function checkUi() {
  const mainBody = bodyBeforeDeveloperTools(html);
  const cameraIndex = mainBody.indexOf('id="cameraTitle"');
  const movementIndex = mainBody.indexOf('id="analyzeMovement"');
  const resultIndex = mainBody.indexOf('id="movementResultTitle"');
  add("ui", "frozen_hierarchy", cameraIndex >= 0 && movementIndex > cameraIndex && resultIndex > movementIndex, { cameraIndex, movementIndex, resultIndex });
  add("ui", "custom_skill_wizard", ["Create custom gesture", "Choose a preset", "Test your skill", "Retrain", "Delete"].every((marker) => `${html}\n${runtimeSource}`.includes(marker)), "required wizard controls");
  add("ui", "custom_skill_form", ["customGestureName", "customGesturePoseType", "customGestureExampleCount", "customGestureActionType", "customGestureSave"].every((marker) => html.includes(marker)), "required form controls");
  add("ui", "custom_skill_runtime_wiring", ["acceptCustomSkillDemonstration", "processCustomSkillLandmarks", "handleCustomSkillLandmarksInState"].every((marker) => runtimeSource.includes(marker)), "browser runtime calls canonical API");
  add("ui", "custom_skill_mobile_safe", html.includes("custom-gesture-modal") && html.includes("@media (max-width: 760px)") && html.includes(".dq-automation-dialog") && /overflow-wrap:\s*(?:anywhere|break-word)/i.test(html), "bounded wizard layout");
  add("ui", "no_raw_media_copy", !/store (?:your )?(?:video|frames|images)|save (?:your )?(?:video|frames|images)/i.test(mainBody), "no misleading persistence copy");
}

function checkPrivacyBoundary() {
  add("privacy", "no_model_calls", !/movement-recognition\/analyze|HF_TOKEN|Cerebras|huggingface/i.test(engineSource), "custom skill modules only");
  add("privacy", "no_raw_media_persistence", !/indexedDB|MediaRecorder|toDataURL|readAsDataURL|\.srcObject\s*=|localStorage\.setItem\([^,]+,\s*(?:frame|image|video)/i.test(engineSource), "custom skill modules only");
  add("privacy", "bounded_numeric_templates", engineSource.includes("contains_raw_media") && /Number\.isFinite|isFinite/.test(engineSource), "finite numerical template validation");
}

function validatePhysicalEvidence() {
  if (!existsSync(resolve(PHYSICAL_PATH))) return { present: false, valid: false, path: PHYSICAL_PATH, evidence: "physical protocol not run" };
  try {
    const value = JSON.parse(readFileSync(resolve(PHYSICAL_PATH), "utf8"));
    const serialized = JSON.stringify(value);
    const valid = value.schema === "darkquest.custom_skill_physical_evidence.v1"
      && value.skill_name === "Heart shape"
      && Number(value.valid_examples) >= 5
      && Number(value.live_test_matches) >= 2
      && Number(value.heart_trigger_receipts) >= 2
      && Number(value.open_hand_false_positives) === 0
      && Number(value.open_hand_attempts) >= 3
      && Number(value.prayer_hand_false_positives) === 0
      && Number(value.prayer_hand_attempts) >= 3
      && value.contains_raw_media === false
      && Number(value.vlm_calls) === 0
      && !/data:image|base64|jpeg|png|video|screenshot|HF_TOKEN/i.test(serialized);
    return { present: true, valid, path: PHYSICAL_PATH, evidence: safeEvidence(value) };
  } catch (error) {
    return { present: true, valid: false, path: PHYSICAL_PATH, evidence: String(error?.message || error) };
  }
}

function bodyBeforeDeveloperTools(source) {
  const body = source.replace(/^[\s\S]*<body>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  const index = body.indexOf('id="developerTools"');
  return index >= 0 ? body.slice(0, index) : body;
}

function read(path) {
  return exists(path) ? readFileSync(resolve(path), "utf8") : "";
}

function exists(path) {
  return existsSync(resolve(path));
}

function safeEvidence(value) {
  const serialized = JSON.stringify(value ?? null);
  if (/data:image|base64|HF_TOKEN|provider[_ -]?token|raw[_ -]?(?:frame|image)/i.test(serialized)) return "forbidden evidence removed";
  return serialized.length > 1600 ? `${serialized.slice(0, 1600)}...` : value;
}
