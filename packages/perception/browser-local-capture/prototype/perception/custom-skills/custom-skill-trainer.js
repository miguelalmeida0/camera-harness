import { medianPoseVectors, normalizeHandPose, poseVectorDistance } from "./hand-pose-normalizer.js";
import { MIN_CUSTOM_SKILL_EXAMPLES, normalizeCustomMovementSkill } from "./custom-skill-store.js";

export const CUSTOM_SKILL_TRAINING_DEFAULTS = Object.freeze({ minimumFrames: 3, minimumHoldMs: 250, maximumJitter: 0.18, duplicateDistance: 0.0025 });

export function acceptCustomSkillDemonstration(skill, frames = [], options = {}) {
  const settings = { ...CUSTOM_SKILL_TRAINING_DEFAULTS, ...options };
  if (!Array.isArray(frames) || frames.length < settings.minimumFrames) return rejection("custom_skill_example_incomplete");
  const timestamps = frames.map((frame) => Number(frame.timestamp_ms)).filter(Number.isFinite);
  if (timestamps.length < 2 || Math.max(...timestamps) - Math.min(...timestamps) < settings.minimumHoldMs) return rejection("custom_skill_example_unstable");
  const vectors = frames.map((frame) => {
    const hands = Array.isArray(frame.hands) ? frame.hands : [];
    return normalizeHandPose({
      landmarks: hands.length ? hands.map((hand) => hand.landmarks) : frame.landmarks || frame.landmark_groups,
      handedness: hands.length ? hands.map((hand) => hand.handedness) : frame.handedness,
      mirrored: frame.mirrored === true,
      expectedHandCount: skill.hand_count
    });
  });
  const invalid = vectors.find((item) => !item.ok);
  if (invalid) return rejection(invalid.code === "custom_skill_hand_count_mismatch" ? "custom_skill_wrong_hand_count" : "custom_skill_example_incomplete");
  const rawVectors = vectors.map((item) => item.vector);
  const prototype = medianPoseVectors(rawVectors);
  const jitter = Math.max(...rawVectors.map((vector) => poseVectorDistance(vector, prototype)));
  if (jitter > settings.maximumJitter) return rejection("custom_skill_example_unstable", { jitter });
  const existing = options.negative === true ? skill.negative_templates : skill.positive_templates;
  const duplicate = (existing || []).some((template) => poseVectorDistance(prototype, template.vector) < settings.duplicateDistance);
  if (duplicate) return rejection("custom_skill_example_duplicate");
  const template = {
    template_id: `template_${options.negative === true ? "negative" : "positive"}_${Date.now()}_${(existing || []).length + 1}`,
    vector: prototype,
    hand_count: skill.hand_count,
    accepted_at: Number(options.now ?? Date.now()),
    contains_raw_media: false
  };
  const patch = options.negative === true
    ? { negative_templates: [...skill.negative_templates, template] }
    : { positive_templates: [...skill.positive_templates, template] };
  return { ok: true, code: "custom_skill_example_accepted", template, jitter, skill: normalizeCustomMovementSkill({ ...skill, ...patch }) };
}

export function calibrateCustomSkillThreshold(skill, options = {}) {
  const positives = skill.positive_templates || [];
  if (positives.length < MIN_CUSTOM_SKILL_EXAMPLES) return { ok: false, code: "custom_skill_insufficient_examples", skill };
  const distances = [];
  for (let a = 0; a < positives.length; a += 1) {
    for (let b = a + 1; b < positives.length; b += 1) distances.push(poseVectorDistance(positives[a].vector, positives[b].vector));
  }
  const maximumWithinClass = Math.max(0, ...distances);
  const consistencyLimit = Number(options.consistencyLimit || 0.32);
  if (maximumWithinClass > consistencyLimit) {
    return { ok: false, code: "custom_skill_examples_inconsistent", maximum_within_class: maximumWithinClass, skill: normalizeCustomMovementSkill({ ...skill, training_consistent: false }) };
  }
  let threshold = Math.max(0.06, maximumWithinClass * 1.35 + 0.025);
  const negatives = skill.negative_templates || [];
  if (negatives.length) {
    const nearestNegative = Math.min(...positives.flatMap((positive) => negatives.map((negative) => poseVectorDistance(positive.vector, negative.vector))));
    threshold = Math.min(threshold, Math.max(0.04, nearestNegative * 0.72));
  }
  threshold = Math.min(0.35, threshold);
  return {
    ok: true,
    code: "custom_skill_threshold_calibrated",
    threshold,
    maximum_within_class: maximumWithinClass,
    skill: normalizeCustomMovementSkill({ ...skill, recognition_threshold: threshold, training_consistent: true })
  };
}

export function recordCustomSkillTestObservation(skill, observation = {}) {
  const current = skill.test_state || {};
  const testState = {
    successful_recognitions: Number(current.successful_recognitions || 0) + (observation.matched === true ? 1 : 0),
    neutral_observed: current.neutral_observed === true || observation.neutral === true,
    user_approved: observation.user_approved === true ? true : current.user_approved === true
  };
  return normalizeCustomMovementSkill({ ...skill, test_state: testState, active: skill.active === true });
}

export function canActivateCustomSkill(skill) {
  return (skill.positive_templates || []).length >= MIN_CUSTOM_SKILL_EXAMPLES
    && skill.training_consistent !== false
    && Number(skill.test_state?.successful_recognitions || 0) >= 2
    && skill.test_state?.neutral_observed === true
    && skill.test_state?.user_approved === true;
}

function rejection(code, details = {}) {
  return { ok: false, code, ...details, contains_raw_media: false };
}
