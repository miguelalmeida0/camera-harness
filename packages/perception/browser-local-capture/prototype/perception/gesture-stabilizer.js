export const DEFAULT_GESTURE_STABILIZER_OPTIONS = Object.freeze({
  minimumConfidence: 0.7,
  holdMs: 350,
  neutralResetMs: 250,
  cooldownMs: 3000
});

export function createGestureStabilizerState() {
  return {
    candidateKey: null,
    candidateSinceMs: null,
    neutralSinceMs: null,
    resetReady: true,
    emittedForHold: false,
    candidateMinConfidence: 1,
    candidateHandCount: 1,
    candidateSource: "mediapipe_gesture",
    candidateCustomSkillId: "",
    candidateSkillName: "",
    candidateMatchScore: 0,
    candidateSecondBestScore: 0,
    candidateScoreMargin: 0,
    cooldownUntilByGesture: {},
    eventSequence: 0
  };
}

export function updateGestureStabilizer(previousState, observation = {}, options = {}) {
  const settings = { ...DEFAULT_GESTURE_STABILIZER_OPTIONS, ...options };
  const state = cloneState(previousState || createGestureStabilizerState());
  const timestampMs = finiteNumber(observation.timestamp_ms, 0);
  const confidence = clamp01(observation.confidence);
  const observedGestureKey = normalizedGestureKey(observation.gesture_key);
  const gestureKey = confidence >= settings.minimumConfidence
    ? observedGestureKey
    : "";

  if (!gestureKey) {
    state.neutralSinceMs ??= timestampMs;
    if (timestampMs - state.neutralSinceMs >= settings.neutralResetMs) {
      state.candidateKey = null;
      state.candidateSinceMs = null;
      state.resetReady = true;
      state.emittedForHold = false;
      state.candidateMinConfidence = 1;
      state.candidateHandCount = 1;
      state.candidateSource = "mediapipe_gesture";
      state.candidateCustomSkillId = "";
      state.candidateSkillName = "";
      state.candidateMatchScore = 0;
      state.candidateSecondBestScore = 0;
      state.candidateScoreMargin = 0;
    }
    return suppression(state, observedGestureKey ? "instant_gesture_below_threshold" : "instant_gesture_neutral_reset_missing");
  }

  state.neutralSinceMs = null;
  if (!state.resetReady || state.emittedForHold) {
    const cooldownUntil = finiteNumber(state.cooldownUntilByGesture[gestureKey], 0);
    return suppression(state, timestampMs < cooldownUntil ? "instant_gesture_duplicate" : "instant_gesture_neutral_reset_missing");
  }

  if (state.candidateKey !== gestureKey) {
    state.candidateKey = gestureKey;
    state.candidateSinceMs = timestampMs;
    state.candidateMinConfidence = confidence;
    state.candidateHandCount = boundedHandCount(observation.hand_count);
    state.candidateSource = normalizedSource(observation.source);
    state.candidateCustomSkillId = state.candidateSource === "custom_local_skill" ? String(observation.custom_skill_id || "") : "";
    state.candidateSkillName = state.candidateSource === "custom_local_skill" ? String(observation.skill_name || gestureKey) : "";
    state.candidateMatchScore = Number(observation.match_score ?? confidence);
    state.candidateSecondBestScore = Number(observation.second_best_score || 0);
    state.candidateScoreMargin = Number(observation.score_margin || 0);
    return suppression(state, "instant_gesture_hold_not_met");
  }

  state.candidateMinConfidence = Math.min(state.candidateMinConfidence, confidence);
  state.candidateHandCount = Math.max(state.candidateHandCount, boundedHandCount(observation.hand_count));
  if (normalizedSource(observation.source) === "mediapipe_gesture") state.candidateSource = "mediapipe_gesture";
  if (normalizedSource(observation.source) === "custom_local_skill") {
    state.candidateSource = "custom_local_skill";
    state.candidateCustomSkillId = String(observation.custom_skill_id || state.candidateCustomSkillId || "");
    state.candidateSkillName = String(observation.skill_name || state.candidateSkillName || gestureKey);
    state.candidateMatchScore = Math.min(state.candidateMatchScore || 1, Number(observation.match_score ?? confidence));
    state.candidateSecondBestScore = Math.max(state.candidateSecondBestScore, Number(observation.second_best_score || 0));
    state.candidateScoreMargin = Math.min(state.candidateScoreMargin || 1, Number(observation.score_margin || 0));
  }
  // Keep the raw elapsed duration for the threshold decision. Rounding belongs in
  // telemetry only; a displayed threshold must correspond to an emitted event.
  const heldForMs = timestampMs - finiteNumber(state.candidateSinceMs, timestampMs);
  const cooldownUntil = finiteNumber(state.cooldownUntilByGesture[gestureKey], 0);
  if (
    !state.emittedForHold
    && confidence >= settings.minimumConfidence
    && heldForMs >= settings.holdMs
  ) {
    if (timestampMs < cooldownUntil) return suppression(state, "instant_gesture_cooldown_active");

    state.eventSequence += 1;
    state.emittedForHold = true;
    state.resetReady = false;
    state.cooldownUntilByGesture[gestureKey] = timestampMs + settings.cooldownMs;
    const eventId = state.candidateSource === "custom_local_skill"
      ? `skill_event_${state.candidateCustomSkillId}_${timestampMs}_${state.eventSequence}`
      : `gesture_${gestureKey}_${timestampMs}_${state.eventSequence}`;
    return {
      state,
      event: Object.freeze({
        schema_version: state.candidateSource === "custom_local_skill" ? "stable-custom-skill-event.v1" : "stable-local-gesture-event.v1",
        gesture_event_id: eventId,
        ...(state.candidateSource === "custom_local_skill" ? {
          skill_event_id: eventId,
          skill_name: state.candidateSkillName,
          skill_type: "custom_hand_pose",
          match_score: state.candidateMatchScore,
          second_best_score: state.candidateSecondBestScore,
          score_margin: state.candidateScoreMargin
        } : {}),
        gesture_key: gestureKey,
        source: state.candidateSource,
        ...(state.candidateSource === "custom_local_skill" ? { custom_skill_id: state.candidateCustomSkillId } : {}),
        confidence: state.candidateMinConfidence,
        first_seen_ms: finiteNumber(state.candidateSinceMs, timestampMs),
        stable_at_ms: timestampMs,
        held_for_ms: heldForMs,
        hand_count: state.candidateHandCount,
        requires_neutral_reset: true,
        neutral_reset_completed: false,
        contains_raw_media: false
      }),
      code: "instant_gesture_stable",
      outcome_codes: ["instant_gesture_stable"]
    };
  }

  if (heldForMs < settings.holdMs) return suppression(state, "instant_gesture_hold_not_met");
  if (timestampMs < cooldownUntil) return suppression(state, "instant_gesture_cooldown_active");
  return suppression(state, "instant_gesture_neutral_reset_missing");
}

export function gestureCooldownRemainingMs(state, gestureKey, timestampMs) {
  return Math.max(0, finiteNumber(state?.cooldownUntilByGesture?.[normalizedGestureKey(gestureKey)], 0) - finiteNumber(timestampMs, 0));
}

function cloneState(state) {
  return {
    ...state,
    cooldownUntilByGesture: { ...(state.cooldownUntilByGesture || {}) }
  };
}

function suppression(state, code) {
  return { state, event: null, code, outcome_codes: [code] };
}

function boundedHandCount(value) {
  return Number(value) === 2 ? 2 : 1;
}

function normalizedGestureKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.startsWith("custom:")) {
    const customKey = normalized.slice(7).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return customKey ? `custom:${customKey}` : "";
  }
  return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizedSource(value) {
  if (value === "custom_local_skill") return "custom_local_skill";
  return value === "mediapipe_landmark_fallback" ? "mediapipe_landmark_fallback" : "mediapipe_gesture";
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finiteNumber(value, 0)));
}
