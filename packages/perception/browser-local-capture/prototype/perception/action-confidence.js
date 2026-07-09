export function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function confidenceFromMotionScore(motionScore, floor = 0.5) {
  return Number(Math.min(0.96, Math.max(floor, floor + (Number(motionScore) || 0))).toFixed(3));
}

export function smoothConfidence(previous, next, alpha = 0.62) {
  if (previous == null) return clamp01(next);
  return Number(clamp01((previous * alpha) + (next * (1 - alpha))).toFixed(3));
}
