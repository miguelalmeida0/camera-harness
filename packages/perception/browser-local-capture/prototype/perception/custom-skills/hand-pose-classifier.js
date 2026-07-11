import { normalizeHandPose, poseVectorDistance } from "./hand-pose-normalizer.js";

export function classifyCustomMovementSkills(input = {}) {
  if (input.camera_active === false || input.document_hidden === true) return noMatch("custom_skill_no_match");
  const suppliedSkills = input.skills || [];
  const skills = suppliedSkills.filter((skill) => skill?.enabled === true && skill?.active === true && skill?.training_consistent !== false);
  if (!skills.length) return noMatch(suppliedSkills.length ? "custom_skill_disabled" : "custom_skill_none_enabled");
  const normalizedByHandCount = new Map();
  const candidates = [];
  let nearestRejectedDistance = Number.POSITIVE_INFINITY;
  let nearestRejectedThreshold = 0;
  for (const skill of skills) {
    const handCount = Number(skill.hand_count || (skill.pose_type === "two_hand" ? 2 : 1));
    if (!normalizedByHandCount.has(handCount)) normalizedByHandCount.set(handCount, normalizeHandPose({ ...input, expectedHandCount: handCount }));
    const pose = normalizedByHandCount.get(handCount);
    if (!pose?.ok) continue;
    const positiveDistance = nearestTemplateDistance(pose.vector, skill.positive_templates);
    const negativeDistance = nearestTemplateDistance(pose.vector, skill.negative_templates);
    const threshold = Number(skill.recognition_threshold || 0.18) * Number(skill.sensitivity || 1);
    if (!Number.isFinite(positiveDistance) || positiveDistance > threshold) {
      if (positiveDistance < nearestRejectedDistance) {
        nearestRejectedDistance = positiveDistance;
        nearestRejectedThreshold = threshold;
      }
      continue;
    }
    if (Number.isFinite(negativeDistance) && negativeDistance <= positiveDistance + Number(skill.negative_margin || 0.04)) continue;
    const matchScore = Math.max(0, Math.min(1, 1 - positiveDistance / Math.max(threshold * 4, 0.001)));
    if (matchScore < Number(skill.recognition?.minimum_match_score ?? 0.7)) continue;
    candidates.push({
      source: "custom_local_skill",
      custom_skill_id: skill.custom_skill_id,
      gesture_key: skill.gesture_key,
      label: skill.name,
      confidence: Number(matchScore.toFixed(2)),
      match_score: Number(matchScore.toFixed(2)),
      distance: positiveDistance,
      threshold,
      minimum_score_margin: Number(skill.recognition?.minimum_score_margin ?? 0.08),
      hand_count: handCount,
      contains_raw_media: false
    });
  }
  candidates.sort((a, b) => a.distance - b.distance || b.confidence - a.confidence || a.custom_skill_id.localeCompare(b.custom_skill_id));
  if (!candidates.length) {
    const nearKnownPose = nearestRejectedThreshold <= 0.05 && Number.isFinite(nearestRejectedDistance) && nearestRejectedDistance <= 0.5;
    return noMatch(nearKnownPose ? "custom_skill_below_threshold" : "custom_skill_no_match");
  }
  const best = candidates[0];
  const second = candidates[1];
  if (second && best.confidence - second.confidence < Math.max(best.minimum_score_margin, second.minimum_score_margin)) {
    return { code: "custom_skill_ambiguous", candidate: null, candidates: candidates.slice(0, 2), contains_raw_media: false };
  }
  return {
    code: "custom_skill_candidate",
    candidate: Object.freeze({
      ...best,
      second_best_score: Number(second?.confidence || 0),
      score_margin: Number((best.confidence - Number(second?.confidence || 0)).toFixed(2))
    }),
    candidates,
    contains_raw_media: false
  };
}

export function nearestTemplateDistance(vector, templates = []) {
  return (templates || []).reduce((best, template) => Math.min(best, poseVectorDistance(vector, template?.vector || template)), Number.POSITIVE_INFINITY);
}

function noMatch(code) {
  return { code, candidate: null, candidates: [], contains_raw_media: false };
}
