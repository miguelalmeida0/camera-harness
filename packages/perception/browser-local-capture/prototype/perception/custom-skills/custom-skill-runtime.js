import { classifyCustomMovementSkills } from "./hand-pose-classifier.js";

export function createCustomSkillRuntimeState() {
  return { last_candidate_id: "", last_outcome_code: "custom_skill_idle", classifications: 0, contains_raw_media: false };
}

export function processCustomSkillLandmarks(runtimeState, input = {}) {
  const runtime = runtimeState || createCustomSkillRuntimeState();
  runtime.classifications += 1;
  const classification = classifyCustomMovementSkills(input);
  runtime.last_outcome_code = classification.code;
  runtime.last_candidate_id = classification.candidate?.custom_skill_id || "";
  return { ...classification, runtimeState: runtime };
}

export function createCustomSkillObservation(candidate, timestampMs) {
  if (!candidate || candidate.source !== "custom_local_skill") return null;
  return Object.freeze({
    source: "custom_local_skill",
    custom_skill_id: candidate.custom_skill_id,
    skill_name: candidate.label || candidate.gesture_key,
    skill_type: "custom_hand_pose",
    gesture_key: candidate.gesture_key,
    confidence: Number(candidate.confidence || 0),
    match_score: Number(candidate.match_score ?? candidate.confidence ?? 0),
    second_best_score: Number(candidate.second_best_score || 0),
    score_margin: Number(candidate.score_margin || 0),
    hand_count: Number(candidate.hand_count || 1),
    timestamp_ms: Number(timestampMs),
    raw_label: candidate.label || candidate.gesture_key,
    detection_method: "normalized_landmark_template",
    contains_raw_media: false
  });
}
