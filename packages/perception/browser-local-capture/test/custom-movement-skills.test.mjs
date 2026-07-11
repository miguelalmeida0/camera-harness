import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createGestureStabilizerState, updateGestureStabilizer } from "../prototype/perception/gesture-stabilizer.js";
import { createAutomationRuntimeState, createRecipeStore, runAutomationForStableLocalGesture } from "../prototype/automation/index.js";
import {
  advanceCustomGestureWizard,
  createInitialState,
  openCustomGestureEditor,
  saveCustomGestureFromWizard
} from "../prototype/local-capture.js";

const ENGINE_URL = new URL("../prototype/perception/custom-skills/index.js", import.meta.url);
const REQUIRED_EXPORTS = [
  "createCustomSkillId",
  "createCustomSkill",
  "validateCustomMovementSkill",
  "createCustomSkillStore",
  "deleteCustomSkill",
  "acceptCustomSkillDemonstration",
  "calibrateCustomSkillThreshold",
  "recordCustomSkillTestObservation",
  "canActivateCustomSkill",
  "classifyCustomMovementSkills",
  "createCustomSkillRuntimeState",
  "processCustomSkillLandmarks",
  "createCustomSkillObservation"
];

export async function runCustomMovementSkillBehaviorSuite() {
  let api;
  try {
    api = await import(ENGINE_URL.href);
  } catch (error) {
    return { blocked_code: "BLOCKED_MISSING_CUSTOM_SKILL_ENGINE", checks: [], evidence: safeError(error) };
  }
  const missing = REQUIRED_EXPORTS.filter((name) => typeof api[name] !== "function");
  if (missing.length) {
    const trainerMissing = ["acceptCustomSkillDemonstration", "calibrateCustomSkillThreshold"].some((name) => missing.includes(name));
    return {
      blocked_code: trainerMissing ? "BLOCKED_MISSING_CUSTOM_SKILL_TRAINER" : "BLOCKED_MISSING_CUSTOM_SKILL_ENGINE",
      checks: [],
      evidence: { missing_exports: missing }
    };
  }

  const checks = [];
  const check = (id, passed, evidence = null) => checks.push({ id, passed: passed === true, evidence: safeEvidence(evidence) });
  const expectCode = (id, result, code) => check(id, result?.code === code, result);

  try {
    const firstId = api.createCustomSkillId([]);
    const secondId = api.createCustomSkillId([firstId]);
    check("schema.internal_unique_id", /^skill_[a-zA-Z0-9_-]{8,80}$/.test(firstId) && firstId !== secondId, { firstId, secondId });

    let skill = api.createCustomSkill({ name: "Heart shape", pose_type: "two_hand", mirror_invariant: true }, { existingIds: [] });
    check("schema.version_and_type", skill.schema_version === "custom-movement-skill.v1" && skill.hand_count === 2 && skill.pose_type === "two_hand", skill);
    check("schema.contract_shape", typeof skill.skill_id === "string" && skill.skill_type === "custom_hand_pose"
      && skill.recognition?.engine === "local_landmark_template" && skill.template?.feature_version === "hand_pose_embedding.v1"
      && skill.privacy?.contains_raw_media === false, skill);
    check("schema.bounded_name", skill.name === "Heart shape" && skill.name.length <= 80, skill.name);
    const valid = api.validateCustomMovementSkill(skill);
    check("schema.valid", valid.ok === true && valid.skill.contains_raw_media === false, valid);
    expectCode("schema.duplicate_id", api.validateCustomMovementSkill(skill, { existing_skill_ids: [skill.custom_skill_id] }), "custom_skill_duplicate_id");
    expectCode("schema.raw_media", api.validateCustomMovementSkill({ ...skill, raw_frame: "data:image/jpeg;base64,AA==" }), "custom_skill_contains_raw_media");
    expectCode("schema.secret", api.validateCustomMovementSkill({ ...skill, provider_token: "hf_secret_value" }), "custom_skill_contains_secret");
    expectCode("schema.unsafe_code", api.validateCustomMovementSkill({ ...skill, javascript: "alert(1)", endpoint: "https://example.com" }), "custom_skill_unsafe_config");
    expectCode("schema.template_dimensions", api.validateCustomMovementSkill({ ...skill, positive_templates: [{ template_id: "bad", vector: [0], hand_count: 2 }] }), "custom_skill_template_invalid");

    expectCode("trainer.insufficient_examples", api.calibrateCustomSkillThreshold(skill), "custom_skill_insufficient_examples");
    expectCode("trainer.wrong_hand_count", api.acceptCustomSkillDemonstration(skill, demonstration("heart", 0, { handCount: 1 })), "custom_skill_wrong_hand_count");
    expectCode("trainer.unstable", api.acceptCustomSkillDemonstration(skill, demonstration("jitter", 0)), "custom_skill_example_unstable");
    expectCode("trainer.incomplete", api.acceptCustomSkillDemonstration(skill, demonstration("incomplete", 0)), "custom_skill_example_incomplete");
    expectCode("trainer.short_hold", api.acceptCustomSkillDemonstration(skill, demonstration("heart", 0, { durationMs: 100 })), "custom_skill_example_unstable");

    for (let index = 0; index < 5; index += 1) {
      const accepted = api.acceptCustomSkillDemonstration(skill, demonstration("heart", index), { now: 1000 + index });
      check(`trainer.positive_${index + 1}`, accepted.ok === true && accepted.template?.contains_raw_media === false, accepted);
      if (accepted.ok) skill = accepted.skill;
    }
    const duplicate = api.acceptCustomSkillDemonstration(skill, demonstration("heart", 0));
    check("trainer.duplicate_handled", duplicate.ok === false && skill.positive_templates.length === 5, duplicate);

    const inconsistentSkill = await collectSkill(api, "Random mix", ["heart", "heart", "heart", "heart", "open"]);
    expectCode("trainer.inconsistent", api.calibrateCustomSkillThreshold(inconsistentSkill, { consistencyLimit: 0.08 }), "custom_skill_examples_inconsistent");

    const negative = api.acceptCustomSkillDemonstration(skill, demonstration("open", 0), { negative: true, now: 2000 });
    check("trainer.optional_negative", negative.ok === true && negative.skill.negative_templates.length === 1, negative);
    if (negative.ok) skill = negative.skill;
    const calibrated = api.calibrateCustomSkillThreshold(skill);
    check("trainer.threshold_calibration", calibrated.ok === true && Number(calibrated.threshold) > 0 && Number(calibrated.threshold) <= 1, calibrated);
    if (calibrated.ok) skill = calibrated.skill;

    skill = api.recordCustomSkillTestObservation(skill, { matched: true });
    skill = api.recordCustomSkillTestObservation(skill, { matched: true, neutral: true, user_approved: true });
    check("trainer.activation_gate", api.canActivateCustomSkill(skill) === true, skill.test_state);
    skill = api.createCustomSkill({ ...skill, custom_skill_id: skill.custom_skill_id, enabled: true, active: true }, { existingIds: [] });

    const heart = api.classifyCustomMovementSkills(classifierInput([skill], "heart", 8));
    check("classifier.positive_match", heart.candidate?.custom_skill_id === skill.custom_skill_id && heart.candidate?.gesture_key === skill.gesture_key, heart);
    const openRejected = api.classifyCustomMovementSkills(classifierInput([skill], "open", 3));
    check("classifier.open_rejected", ["custom_skill_no_match", "custom_skill_below_threshold"].includes(openRejected.code) && !openRejected.candidate, openRejected);
    const prayerRejected = api.classifyCustomMovementSkills(classifierInput([skill], "prayer", 3));
    check("classifier.prayer_rejected", ["custom_skill_no_match", "custom_skill_below_threshold"].includes(prayerRejected.code) && !prayerRejected.candidate, prayerRejected);
    expectCode("classifier.partial_rejected", api.classifyCustomMovementSkills(classifierInput([skill], "heart", 3, { handCount: 1 })), "custom_skill_no_match");
    const strict = { ...skill, custom_skill_id: api.createCustomSkillId([skill.custom_skill_id]), recognition_threshold: 0.02 };
    expectCode("classifier.below_threshold", api.classifyCustomMovementSkills(classifierInput([strict], "heart", 8)), "custom_skill_below_threshold");
    const twin = { ...skill, custom_skill_id: api.createCustomSkillId([skill.custom_skill_id]), name: "Heart twin" };
    expectCode("classifier.ambiguous", api.classifyCustomMovementSkills(classifierInput([skill, twin], "heart", 8)), "custom_skill_ambiguous");
    expectCode("classifier.disabled", api.classifyCustomMovementSkills(classifierInput([{ ...skill, enabled: false }], "heart", 8)), "custom_skill_disabled");
    expectCode("classifier.camera_stopped", api.classifyCustomMovementSkills({ ...classifierInput([skill], "heart", 8), camera_active: false }), "custom_skill_no_match");
    expectCode("classifier.hidden_tab", api.classifyCustomMovementSkills({ ...classifierInput([skill], "heart", 8), document_hidden: true }), "custom_skill_no_match");
    const mirrored = api.classifyCustomMovementSkills(classifierInput([skill], "heart", 8, { mirrored: true, mirrorLandmarks: true }));
    check("classifier.mirror_invariant", mirrored.candidate?.custom_skill_id === skill.custom_skill_id, mirrored);

    const runtimeState = api.createCustomSkillRuntimeState();
    const runtimeResult = api.processCustomSkillLandmarks(runtimeState, classifierInput([skill], "heart", 8));
    const observation = api.createCustomSkillObservation(runtimeResult.candidate, 100);
    check("runtime.symbolic_observation", observation?.source === "custom_local_skill" && observation.contains_raw_media === false, observation);
    const stabilized = stabilizeCustomObservation(observation, skill);
    check("runtime.one_event_per_hold", Boolean(stabilized.firstEvent && !stabilized.duplicateEvent && stabilized.secondEvent), stabilized);
    await automationBehavior(check, skill, stabilized);

    const storage = memoryStorage();
    const store = api.createCustomSkillStore(storage);
    const stored = store.create({ ...skill, custom_skill_id: undefined, active: true, enabled: true });
    const serialized = storage.dump();
    check("privacy.numeric_templates_only", !forbiddenMedia(serialized) && store.list()[0].contains_raw_media === false, serialized.slice(0, 500));
    api.deleteCustomSkill(store, stored.custom_skill_id);
    check("schema.deletion_clears_templates", store.list().length === 0 && !storage.dump().includes(stored.custom_skill_id), storage.dump());
    runWizardBehavior(check, api, skill);
  } catch (error) {
    check("suite.unexpected_error", false, safeError(error));
  }

  return { blocked_code: null, checks, evidence: { physical_evidence: false } };
}

function runWizardBehavior(check, api, trainedSkill) {
  const skillStorage = memoryStorage();
  const recipeStorage = memoryStorage();
  const skillStore = api.createCustomSkillStore(skillStorage);
  const recipeStore = createRecipeStore(recipeStorage);
  const target = createInitialState();
  target.cameraReady = true;
  const fakeDom = customWizardDom();
  openCustomGestureEditor(target, "", { store: skillStore, dom: fakeDom });
  const opened = target.customSkillWizard.open === true && target.customSkillWizard.step === 1;
  fakeDom.customGestureName.value = "Heart shape";
  const named = advanceCustomGestureWizard(target, { dom: fakeDom });
  fakeDom.customGesturePoseType.value = "two_hand";
  const handsSelected = advanceCustomGestureWizard(target, { dom: fakeDom });
  target.customSkillWizard.draft = api.normalizeCustomMovementSkill({
    ...trainedSkill,
    enabled: false,
    active: false,
    test_state: { successful_recognitions: 2, neutral_observed: true, user_approved: true }
  });
  const trainingAdvanced = advanceCustomGestureWizard(target, { dom: fakeDom });
  const testAdvanced = advanceCustomGestureWizard(target, { dom: fakeDom });
  fakeDom.customGestureActionType.value = "speak_phrase";
  fakeDom.customGestureActionValue.value = "Heart detected";
  const actionAdvanced = advanceCustomGestureWizard(target, { dom: fakeDom });
  const saved = saveCustomGestureFromWizard(target, { dom: fakeDom, skillStore, recipeStore });
  check("ui.wizard_complete_flow", opened && named && handsSelected && trainingAdvanced && testAdvanced && actionAdvanced
    && saved?.name === "Heart shape" && saved?.pose_type === "two_hand" && target.customSkillWizard.open === false, { saved, error: fakeDom.customGestureFormError.textContent, step: target.customSkillWizard.step, open: target.customSkillWizard.open });
  check("ui.wizard_transactional_save", skillStore.list().length === 1 && recipeStore.list().length === 1
    && recipeStore.list()[0].action?.config?.text === "Heart detected" && !forbiddenMedia(skillStorage.dump()), { skills: skillStore.list().length, recipes: recipeStore.list().length });
}

function customWizardDom() {
  const field = (value = "") => ({ value, hidden: false, disabled: false, checked: true, focus() {}, setAttribute() {}, removeAttribute() {} });
  return {
    customGestureEditor: { open: false, showModal() { this.open = true; }, close() { this.open = false; }, querySelectorAll() { return []; } },
    customGestureName: field(""),
    customGesturePoseType: field("one_hand"),
    customGestureActionType: field("speak_phrase"),
    customGestureActionValue: field(""),
    customGestureSensitivity: field("1"),
    customGestureEnabled: field(""),
    customGestureActionLabel: field("Phrase"),
    customGestureStepStatus: field(),
    customGestureTrainingStatus: field(),
    customGestureExampleCount: field(),
    customGestureTestStatus: field(),
    customGestureMatchStatus: field(),
    customGestureSaveSummary: field(),
    customGestureFormError: field(),
    customGestureBack: field(),
    customGestureNext: field(),
    customGestureSave: field(),
    approveCustomGestureTest: field(),
    captureCustomGestureExample: field(),
    startCustomGestureTest: field()
  };
}

async function collectSkill(api, name, kinds) {
  let skill = api.createCustomSkill({ name, pose_type: "two_hand", mirror_invariant: true });
  for (let index = 0; index < kinds.length; index += 1) {
    const result = api.acceptCustomSkillDemonstration(skill, demonstration(kinds[index], index + 20), { now: 3000 + index });
    if (result.ok) skill = result.skill;
  }
  return skill;
}

function stabilizeCustomObservation(observation, skill) {
  const options = { minimumConfidence: 0.25, holdMs: 350, neutralResetMs: 250, cooldownMs: 2500 };
  let state = createGestureStabilizerState();
  let result = updateGestureStabilizer(state, { ...observation, timestamp_ms: 100 }, options);
  state = result.state;
  result = updateGestureStabilizer(state, { ...observation, timestamp_ms: 450 }, options);
  state = result.state;
  const firstEvent = result.event;
  result = updateGestureStabilizer(state, { ...observation, timestamp_ms: 700 }, options);
  state = result.state;
  const duplicateEvent = result.event;
  state = updateGestureStabilizer(state, { gesture_key: null, confidence: 0, timestamp_ms: 800 }, options).state;
  state = updateGestureStabilizer(state, { gesture_key: null, confidence: 0, timestamp_ms: 1050 }, options).state;
  state = updateGestureStabilizer(state, { ...observation, timestamp_ms: 3200 }, options).state;
  result = updateGestureStabilizer(state, { ...observation, timestamp_ms: 3550 }, options);
  return { firstEvent, duplicateEvent, secondEvent: result.event, duplicateCode: result.code, skillId: skill.custom_skill_id };
}

async function automationBehavior(check, skill, stabilized) {
  const recipe = {
    schema: "movement-automation-recipe.v1-1",
    recipe_id: "recipe_custom_heart_speech",
    name: "Heart detected",
    enabled: true,
    priority: 10,
    execution_mode: "instant_local_gesture",
    trigger: {
      movement_key: skill.gesture_key,
      source: "custom_local_skill",
      gesture_key: skill.gesture_key,
      custom_skill_id: skill.custom_skill_id,
      minimum_confidence: 0.7,
      hold_ms: 350,
      require_user_confirmation: false
    },
    action: { type: "speak_phrase", risk_tier: 0, config: { text: "Heart detected" } },
    risk_tier: 0,
    execution_policy: { cooldown_ms: 2500, max_runs_per_session: 20, require_per_run_confirmation: false, retry_limit: 0 },
    consent: { run_instantly: true, consent_version: 1, consented_at: 1 },
    created_at: 1,
    updated_at: 1
  };
  const runtime = createAutomationRuntimeState([recipe]);
  runtime.recipes = [recipe];
  const spoken = [];
  let networkCalls = 0;
  let providerCalls = 0;
  let confirmCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("network forbidden"); };
  const context = {
    instantGesturesEnabled: true,
    cameraReady: true,
    documentHidden: false,
    engineStatus: "ready",
    providerCall: () => { providerCalls += 1; },
    confirm: () => { confirmCalls += 1; },
    speechSynthesis: { cancel() {}, speak(utterance) { spoken.push(utterance.text); utterance.onstart?.(); utterance.onend?.(); } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
  };
  try {
    const first = await runAutomationForStableLocalGesture({ gestureEvent: stabilized.firstEvent, recipes: [recipe], runtimeState: runtime, context });
    const second = await runAutomationForStableLocalGesture({ gestureEvent: stabilized.secondEvent, recipes: [recipe], runtimeState: runtime, context });
    check("runtime.heart_automation", first.receipts?.length === 1 && second.receipts?.length === 1 && spoken.join("|") === "Heart detected|Heart detected", { first, second, spoken });
    check("runtime.no_confirm_vlm_network", confirmCalls === 0 && providerCalls === 0 && networkCalls === 0, { confirmCalls, providerCalls, networkCalls });
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function demonstration(kind, variant, options = {}) {
  const durationMs = options.durationMs ?? 400;
  return [0, durationMs / 2, durationMs].map((timestamp, frame) => ({
    timestamp_ms: timestamp,
    landmarks: landmarkGroups(kind, variant, options.handCount ?? 2, frame),
    handedness: handedness(options.handCount ?? 2),
    mirrored: false,
    contains_raw_media: false
  }));
}

function classifierInput(skills, kind, variant, options = {}) {
  let landmarks = landmarkGroups(kind, variant, options.handCount ?? 2, 0);
  if (options.mirrorLandmarks) landmarks = [...landmarks].reverse().map((hand) => hand.map((point) => ({ ...point, x: 1 - point.x })));
  return {
    skills,
    landmarks,
    handedness: handedness(options.handCount ?? 2),
    mirrored: options.mirrored === true,
    camera_active: true,
    document_hidden: false,
    contains_raw_media: false
  };
}

function landmarkGroups(kind, variant, handCount, frame) {
  if (kind === "incomplete") return [landmarkHand("heart", 0, variant, frame).slice(0, 20), landmarkHand("heart", 1, variant, frame)];
  return Array.from({ length: handCount }, (_, hand) => landmarkHand(kind, hand, variant, frame));
}

function landmarkHand(kind, hand, variant, frame) {
  const side = hand === 0 ? -1 : 1;
  return Array.from({ length: 21 }, (_, index) => {
    const finger = Math.floor(Math.max(0, index - 1) / 4);
    const joint = index === 0 ? 0 : ((index - 1) % 4) + 1;
    const variation = variant * 0.0013 * ((index % 5) - 2);
    const temporal = kind === "jitter" ? frame * 0.18 * (index % 2 ? 1 : -1) : frame * 0.00015 * ((index % 3) - 1);
    if (kind === "heart" || kind === "incomplete" || kind === "jitter") return point(0.5 + side * (0.12 - joint * 0.012 + finger * 0.006) + variation + temporal, 0.72 - joint * 0.075 + Math.abs(finger - 2) * 0.015 - variation, variation);
    if (kind === "open") return point(0.5 + side * (0.18 + finger * 0.02) + variation, 0.82 - joint * 0.12, variation);
    if (kind === "prayer") return point(0.5 + side * (0.025 + finger * 0.002), 0.84 - joint * 0.1 + variation, variation);
    return point(0.2 + ((index * 17 + hand * 13 + variant) % 59) / 100, 0.2 + ((index * 23 + hand * 7 + variant) % 61) / 100, variation);
  });
}

function point(x, y, z) {
  return { x: clamp(x), y: clamp(y), z: clamp(z, -1, 1) };
}

function handedness(count) {
  return Array.from({ length: count }, (_, index) => [{ categoryName: index === 0 ? "Left" : "Right" }]);
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value)));
}

function forbiddenMedia(value) {
  const serialized = String(value)
    .replace(/\\?"contains_(?:raw_media|images|video)\\?":false/gi, "")
    .replace(/\\?"local_only\\?":true/gi, "");
  return /data:image|base64|jpeg|png|imagebitmap|canvas(?:data)?|video(?:data|_bytes)?|screenshot|raw[_ -]?frame|hf_token|provider[_ -]?token/i.test(serialized);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    dump: () => JSON.stringify([...values.entries()])
  };
}

function safeEvidence(value) {
  const serialized = JSON.stringify(value ?? null);
  if (forbiddenMedia(serialized)) return "forbidden evidence removed";
  return serialized.length > 1800 ? `${serialized.slice(0, 1800)}...` : value;
}

function safeError(error) {
  return { code: error?.code || "error", message: String(error?.message || error).slice(0, 400) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await runCustomMovementSkillBehaviorSuite();
  if (result.blocked_code) {
    console.error(`${result.blocked_code} custom movement skill behavior test`);
    console.error(JSON.stringify(result.evidence));
    process.exit(1);
  }
  const failures = result.checks.filter((check) => !check.passed);
  assert.equal(failures.length, 0, failures.map((check) => check.id).join(", "));
  console.log(`ok custom movement skills ${result.checks.length}/${result.checks.length}`);
}
