export function candidateKey(candidate) {
  return `${candidate.action_type}:${candidate.current_step}:${candidate.zone_id ?? "scene"}`;
}

export function expireCooldowns(cooldowns = {}, timestampMs = 0) {
  return Object.fromEntries(
    Object.entries(cooldowns).filter(([, expiresAt]) => Number(expiresAt) > timestampMs)
  );
}

export function isCandidateCoolingDown(candidate, cooldowns = {}, timestampMs = 0) {
  return Number(cooldowns[candidateKey(candidate)] ?? 0) > timestampMs;
}

export function withRejectedCooldown(cooldowns = {}, candidate, timestampMs = 0, durationMs = 3200) {
  return {
    ...expireCooldowns(cooldowns, timestampMs),
    [candidateKey(candidate)]: Math.round(timestampMs + durationMs)
  };
}
