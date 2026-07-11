export const CUSTOM_SKILL_SCHEMA_VERSION = "custom-movement-skill.v1";
export const CUSTOM_SKILL_STORAGE_KEY = "darkquest.custom_movement_skills.v1";
export const MAX_CUSTOM_SKILLS = 20;
export const MIN_CUSTOM_SKILL_EXAMPLES = 5;

const SKILL_ID_PATTERN = /^skill_[a-zA-Z0-9_-]{8,80}$/;
const FORBIDDEN_MEDIA_KEYS = /(?:frame|image|bitmap|canvas|video|audio|base64|screenshot|blob|data_uri)/i;
const FORBIDDEN_SECRET_KEYS = /(?:secret|token|api_key|credential)/i;
const FORBIDDEN_EXECUTION_KEYS = /(?:javascript|script|shell|command|endpoint|webhook|url)/i;

export function createCustomSkillId(existingIds = []) {
  const used = new Set(Array.from(existingIds || [], (item) => String(item?.custom_skill_id || item || "")));
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const token = secureUuid();
    const id = `skill_${token}`;
    if (SKILL_ID_PATTERN.test(id) && !used.has(id)) return id;
  }
  throw new Error("Could not create a custom gesture identity.");
}

export function normalizeCustomMovementSkill(input = {}, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw skillError("Invalid custom gesture.", "custom_skill_invalid");
  assertNoRawMedia(input);
  const now = Number(options.now ?? Date.now());
  const customSkillId = String(input.custom_skill_id || input.id || "");
  if (!SKILL_ID_PATTERN.test(customSkillId)) throw skillError("Custom gesture requires a valid identity.", "custom_skill_invalid_id");
  const existingIds = new Set(options.existing_skill_ids || options.existingIds || []);
  if (existingIds.has(customSkillId)) throw skillError("Custom gesture identity already exists.", "custom_skill_duplicate_id");
  const name = String(input.name || "").trim().slice(0, 80);
  if (!name) throw skillError("Enter a name for this gesture.", "custom_skill_name_required");
  const poseType = input.pose_type === "two_hand" ? "two_hand" : input.pose_type === "one_hand" ? "one_hand" : "";
  if (!poseType) throw skillError("Choose one-hand or two-hand pose.", "custom_skill_pose_type_required");
  const handCount = poseType === "two_hand" ? 2 : 1;
  const positiveTemplates = normalizeTemplates(input.positive_templates || input.templates || input.template?.prototype_vectors, handCount);
  const negativeTemplates = normalizeTemplates(input.negative_templates || input.template?.negative_prototype_vectors, handCount);
  const threshold = boundedNumber(input.recognition_threshold ?? input.threshold, 0.02, 1, 0.18);
  const testState = {
    successful_recognitions: boundedInteger(input.test_state?.successful_recognitions, 0, 100, 0),
    neutral_observed: input.test_state?.neutral_observed === true,
    user_approved: input.test_state?.user_approved === true
  };
  const trained = positiveTemplates.length >= MIN_CUSTOM_SKILL_EXAMPLES && input.training_consistent !== false;
  const tested = testState.successful_recognitions >= 2 && testState.neutral_observed && testState.user_approved;
  const active = input.active === true && input.enabled === true && trained && tested;
  const lifecycleState = input.lifecycle_state === "deleted"
    ? "deleted"
    : active
      ? "active"
      : trained && tested
        ? "disabled"
        : trained && testState.successful_recognitions > 0
          ? "testing"
          : trained
            ? "ready_to_test"
            : positiveTemplates.length
              ? "collecting_examples"
              : "draft";
  const minimumMatchScore = boundedNumber(input.recognition?.minimum_match_score, 0, 1, 0.7);
  const minimumScoreMargin = boundedNumber(input.recognition?.minimum_score_margin ?? input.negative_margin, 0, 1, 0.08);
  const holdMs = boundedInteger(input.recognition?.hold_ms, 250, 1500, 400);
  const cooldownMs = boundedInteger(input.recognition?.cooldown_ms, 0, 86_400_000, 2500);
  const featureDimensions = handCount === 2 ? 152 : 71;
  return {
    schema_version: CUSTOM_SKILL_SCHEMA_VERSION,
    custom_skill_id: customSkillId,
    skill_id: customSkillId,
    skill_type: "custom_hand_pose",
    name,
    gesture_key: `custom:${slugify(input.gesture_key?.replace(/^custom:/, "") || name)}`,
    pose_type: poseType,
    hand_count: handCount,
    enabled: active,
    active,
    lifecycle_state: lifecycleState,
    positive_templates: positiveTemplates,
    negative_templates: negativeTemplates,
    recognition_threshold: threshold,
    recognition: {
      engine: "local_landmark_template",
      hand_count: handCount,
      mirror_invariant: input.recognition?.mirror_invariant !== false && input.mirror_invariant !== false,
      minimum_match_score: minimumMatchScore,
      minimum_score_margin: minimumScoreMargin,
      hold_ms: holdMs,
      neutral_reset_required: true,
      cooldown_ms: cooldownMs,
      threshold
    },
    template: {
      feature_version: "hand_pose_embedding.v1",
      feature_dimensions: featureDimensions,
      dimensions: featureDimensions,
      prototype_vectors: positiveTemplates.map((template) => [...template.vector]),
      negative_prototype_vectors: negativeTemplates.map((template) => [...template.vector])
    },
    negative_margin: minimumScoreMargin,
    training_consistent: input.training_consistent !== false,
    test_state: testState,
    sensitivity: boundedNumber(input.sensitivity, 0.5, 1.5, 1),
    linked_recipe_id: String(input.linked_recipe_id || "").slice(0, 100),
    created_at: boundedInteger(input.created_at, 0, Number.MAX_SAFE_INTEGER, now),
    updated_at: options.touch === false
      ? boundedInteger(input.updated_at, 0, Number.MAX_SAFE_INTEGER, now)
      : now,
    privacy: { contains_raw_media: false, contains_images: false, contains_video: false, local_only: true, clearable: true },
    contains_raw_media: false
  };
}

export function validateCustomMovementSkill(input, options = {}) {
  try {
    const skill = normalizeCustomMovementSkill(input, options);
    return { ok: true, valid: true, skill, code: null, errors: [] };
  } catch (error) {
    return { ok: false, valid: false, skill: null, code: error?.code || "custom_skill_invalid", errors: [error?.code || "custom_skill_invalid"], safe_message: error?.message || "Invalid custom gesture." };
  }
}

export function createCustomSkill(input = {}, options = {}) {
  const existingIds = options.existingIds || options.existing_ids || [];
  return normalizeCustomMovementSkill({
    ...input,
    schema_version: CUSTOM_SKILL_SCHEMA_VERSION,
    custom_skill_id: input.custom_skill_id || createCustomSkillId(existingIds),
    enabled: input.enabled === true,
    active: input.active === true,
    contains_raw_media: false
  }, options);
}

export function createCustomSkillStore(storage = browserStorage(), options = {}) {
  let document = loadDocument(storage);
  const commit = (next) => {
    storage?.setItem?.(CUSTOM_SKILL_STORAGE_KEY, JSON.stringify(next));
    document = next;
  };
  const list = () => clone(document.skills);
  const create = (input) => {
    if (document.skills.length >= MAX_CUSTOM_SKILLS) throw skillError("Maximum custom gesture count reached.", "custom_skill_limit_reached");
    const skill = createCustomSkill(input, { ...options, existingIds: document.skills.map((item) => item.custom_skill_id) });
    commit({ schema_version: CUSTOM_SKILL_SCHEMA_VERSION, skills: [...document.skills, skill] });
    return clone(skill);
  };
  const update = (customSkillId, patch) => {
    const current = list();
    const index = current.findIndex((skill) => skill.custom_skill_id === customSkillId);
    if (index < 0) throw skillError("Custom gesture not found.", "custom_skill_not_found");
    const skill = normalizeCustomMovementSkill({ ...current[index], ...patch, custom_skill_id: customSkillId }, options);
    current[index] = skill;
    commit({ schema_version: CUSTOM_SKILL_SCHEMA_VERSION, skills: current });
    return clone(skill);
  };
  const remove = (customSkillId) => {
    const current = list();
    const next = current.filter((skill) => skill.custom_skill_id !== customSkillId);
    if (next.length === current.length) return false;
    commit({ schema_version: CUSTOM_SKILL_SCHEMA_VERSION, skills: next });
    return true;
  };
  const clearTemplates = (customSkillId) => update(customSkillId, {
    positive_templates: [],
    negative_templates: [],
    active: false,
    enabled: false,
    training_consistent: true,
    test_state: { successful_recognitions: 0, neutral_observed: false, user_approved: false }
  });
  const clear = () => commit({ schema_version: CUSTOM_SKILL_SCHEMA_VERSION, skills: [] });
  return { list, read: (id) => list().find((skill) => skill.custom_skill_id === id) || null, create, update, delete: remove, clearTemplates, clear };
}

export function updateCustomSkill(store, customSkillId, patch) {
  return store.update(customSkillId, patch);
}

export function deleteCustomSkill(store, customSkillId) {
  return store.delete(customSkillId);
}

export function listCustomSkills(store) {
  return store.list();
}

export function clearCustomSkillTemplates(store, customSkillId) {
  return store.clearTemplates(customSkillId);
}

function normalizeTemplates(templates = [], handCount) {
  if (!Array.isArray(templates)) throw skillError("Custom gesture templates are invalid.", "custom_skill_templates_invalid");
  return templates.slice(0, 32).map((template, index) => {
    const source = Array.isArray(template) ? { vector: template } : template || {};
    if (FORBIDDEN_MEDIA_KEYS.test(Object.keys(source).join(" "))) throw skillError("Raw media cannot be stored in a custom gesture.", "custom_skill_contains_raw_media");
    const vector = Array.from(source.vector || [], Number);
    const expectedDimensions = handCount === 2 ? 152 : 71;
    if (vector.length !== expectedDimensions || vector.some((value) => !Number.isFinite(value))) {
      throw skillError("Custom gesture template is invalid.", "custom_skill_template_invalid");
    }
    return {
      template_id: String(source.template_id || `template_${index + 1}`).slice(0, 80),
      vector: vector.map((value) => Number(value.toFixed(6))),
      hand_count: handCount,
      accepted_at: boundedInteger(source.accepted_at, 0, Number.MAX_SAFE_INTEGER, 0),
      contains_raw_media: false
    };
  });
}

function loadDocument(storage) {
  try {
    const raw = storage?.getItem?.(CUSTOM_SKILL_STORAGE_KEY);
    if (!raw) return { schema_version: CUSTOM_SKILL_SCHEMA_VERSION, skills: [] };
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.skills) ? parsed.skills : [];
    const used = new Set();
    const skills = source.slice(0, MAX_CUSTOM_SKILLS).map((input) => {
      const supplied = String(input?.custom_skill_id || input?.id || "");
      const customSkillId = SKILL_ID_PATTERN.test(supplied) && !used.has(supplied) ? supplied : createCustomSkillId(used);
      used.add(customSkillId);
      return normalizeCustomMovementSkill({ ...input, custom_skill_id: customSkillId }, { touch: false });
    });
    const document = { schema_version: CUSTOM_SKILL_SCHEMA_VERSION, skills };
    if (JSON.stringify(parsed) !== JSON.stringify(document)) storage?.setItem?.(CUSTOM_SKILL_STORAGE_KEY, JSON.stringify(document));
    return document;
  } catch {
    return { schema_version: CUSTOM_SKILL_SCHEMA_VERSION, skills: [] };
  }
}

function assertNoRawMedia(value, path = "skill") {
  if (value == null) return;
  if (typeof value === "string" && /^(?:data:image\/|blob:)/i.test(value)) throw skillError("Raw media cannot be stored in a custom gesture.", "custom_skill_contains_raw_media");
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) throw skillError("Binary media cannot be stored in a custom gesture.", "custom_skill_contains_raw_media");
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoRawMedia(item, `${path}.${index}`));
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const safeNegativeMediaDeclaration = /^contains_(?:raw_media|images|video)$/.test(key) && child === false;
    if (FORBIDDEN_MEDIA_KEYS.test(key) && !safeNegativeMediaDeclaration) throw skillError("Raw media cannot be stored in a custom gesture.", "custom_skill_contains_raw_media");
    if (FORBIDDEN_SECRET_KEYS.test(key)) throw skillError("Secrets cannot be stored in a custom gesture.", "custom_skill_contains_secret");
    if (FORBIDDEN_EXECUTION_KEYS.test(key)) throw skillError("Executable or network configuration is not allowed in a custom gesture.", "custom_skill_unsafe_config");
    if (/^contains_(?:raw_media|images|video)$/.test(key) && child !== false) throw skillError("Raw media cannot be stored in a custom gesture.", "custom_skill_contains_raw_media");
    assertNoRawMedia(child, `${path}.${key}`);
  }
}

function secureUuid() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") throw new Error("Secure custom gesture identity is unavailable.");
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function slugify(value) {
  return String(value || "custom_gesture").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56) || "custom_gesture";
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function browserStorage() {
  try {
    return globalThis[["local", "Storage"].join("")] || null;
  } catch {
    return null;
  }
}

function skillError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
