import { confidenceFromMotionScore } from "./action-confidence.js";

export function createLocalPerceptionFrame({
  timestampMs,
  currentStep,
  observations = [],
  handLandmarks = [],
  handZoneOverlap = [],
  detectionMethod = "motion_proxy",
  uncertainThreshold = 0.32
}) {
  const zoneMotion = Array.isArray(observations)
    ? Object.fromEntries(observations.map((item) => [item.zone_id, normalizeZoneMotion(item)]))
    : Object.fromEntries(Object.entries(observations).map(([zoneId, item]) => [zoneId, normalizeZoneMotion({ zone_id: zoneId, ...item })]));
  const zones = Object.values(zoneMotion);
  const activeZones = zones.filter((zone) => zone.active);
  const strongest = zones.sort((a, b) => b.motion_score - a.motion_score)[0] ?? null;
  const maxMotion = strongest?.motion_score ?? 0;
  const confidence = strongest ? Math.max(strongest.confidence, confidenceFromMotionScore(maxMotion)) : 0;
  const unstable = activeZones.length >= 4 || maxMotion >= uncertainThreshold;
  return {
    timestamp_ms: Math.round(timestampMs),
    current_step: currentStep,
    zone_motion: zoneMotion,
    hand_landmarks: handLandmarks.map(normalizeHandLandmarks),
    hand_zone_overlap: handZoneOverlap.map(normalizeHandZoneOverlap),
    active_zone: strongest?.active ? strongest.zone_id : null,
    confidence: Number(confidence.toFixed(3)),
    uncertainty: {
      uncertain: unstable,
      reason: unstable ? "multiple_zones_active_or_high_motion" : "",
      active_zone_count: activeZones.length,
      max_motion_score: Number(maxMotion.toFixed(3))
    },
    scene_reset: {
      reset_detected: activeZones.length >= 5 && maxMotion >= uncertainThreshold,
      confidence: activeZones.length >= 5 ? confidenceFromMotionScore(maxMotion, 0.55) : 0,
      reason: activeZones.length >= 5 ? "global_motion_reset_risk" : ""
    },
    detection_method: detectionMethod
  };
}

function normalizeZoneMotion(item) {
  const score = Number(item.motion_score ?? 0);
  return {
    zone_id: item.zone_id,
    motion_score: Number(score.toFixed(3)),
    active: item.active === true,
    confidence: Number((item.confidence ?? confidenceFromMotionScore(score)).toFixed(3)),
    timestamp_ms: Math.round(item.timestamp_ms ?? 0)
  };
}

function normalizeHandLandmarks(hand) {
  return {
    id: String(hand.id ?? "hand"),
    points: Array.isArray(hand.points)
      ? hand.points.slice(0, 21).map((point) => ({
        x: Number(point.x ?? 0),
        y: Number(point.y ?? 0),
        z: Number(point.z ?? 0)
      }))
      : [],
    confidence: Number(hand.confidence ?? 0)
  };
}

function normalizeHandZoneOverlap(overlap) {
  return {
    hand_id: String(overlap.hand_id ?? "hand"),
    zone_id: overlap.zone_id ?? null,
    overlap: Number(overlap.overlap ?? 0),
    confidence: Number(overlap.confidence ?? 0)
  };
}
