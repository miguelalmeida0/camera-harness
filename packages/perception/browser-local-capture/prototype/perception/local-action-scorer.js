import { confidenceFromMotionScore, smoothConfidence } from "./action-confidence.js";
import { expireCooldowns, isCandidateCoolingDown } from "./action-cooldowns.js";

const STEP_BY_STATE = {
  phone_removal_pending: "phone",
  notebook_pending: "notebook",
  pen_pending: "pen",
  writing_pending: "writing",
  typing_pending: "typing"
};

const ACTION_META = {
  phone: { action_type: "phone_moved", label: "Possible phone moved", zone_id: "phone_zone" },
  notebook: { action_type: "notebook_opened", label: "Possible notebook opened", zone_id: "notebook_zone" },
  pen: { action_type: "pen_picked_up", label: "Possible pen picked up", zone_id: "pen_zone" },
  writing: { action_type: "writing_motion", label: "Possible writing motion", zone_id: "notebook_zone" },
  typing: { action_type: "typing_motion", label: "Possible typing motion", zone_id: "keyboard_zone" },
  uncertain: { action_type: "uncertain", label: "Uncertain", zone_id: null }
};

export function scoreLocalActions(frame, options = {}) {
  const currentStep = normalizeStep(frame.current_step);
  const history = options.historyByZone ?? {};
  const previous = options.previousConfidenceByAction ?? {};
  const cooldowns = expireCooldowns(options.cooldowns ?? {}, frame.timestamp_ms);
  const candidates = [];
  const uncertain = scoreUncertain(frame);
  if (uncertain) candidates.push(uncertain);

  const candidate = currentStep === "phone" ? scorePhoneMoved(frame)
    : currentStep === "notebook" ? scoreNotebookOpened(frame, history)
      : currentStep === "pen" ? scorePenPickedUp(frame)
        : currentStep === "writing" ? scoreWritingMotion(frame, history)
          : currentStep === "typing" ? scoreTypingMotion(frame, history)
            : null;
  if (candidate) candidates.push(candidate);

  return candidates
    .map((item) => ({
      ...item,
      confidence: smoothConfidence(previous[item.action_type], item.confidence),
      evidence: item.evidence ?? evidenceFor(frame, item.zone_id, item.reason)
    }))
    .filter((item) => !isCandidateCoolingDown(item, cooldowns, frame.timestamp_ms))
    .sort((a, b) => b.confidence - a.confidence);
}

export function normalizeStep(step) {
  return STEP_BY_STATE[step] ?? step;
}

function scorePhoneMoved(frame) {
  const phone = zone(frame, "phone_zone");
  const offDesk = zone(frame, "off_desk_zone");
  const hand = overlap(frame, "phone_zone");
  if (phone.motion_score < 0.052 && !offDesk.active && hand.overlap < 0.1) return null;
  const confidence = Math.max(confidenceFromMotionScore(phone.motion_score, 0.62), offDesk.active ? 0.72 : 0, hand.confidence);
  return candidate(frame, "phone", confidence, "phone_zone motion with off_desk transition proxy");
}

function scoreNotebookOpened(frame, history) {
  const notebook = zone(frame, "notebook_zone");
  const dwell = dwellMs(history.notebook_zone);
  if (notebook.motion_score < 0.052 && dwell < 420) return null;
  return candidate(frame, "notebook", Math.max(confidenceFromMotionScore(notebook.motion_score, 0.63), dwell >= 420 ? 0.72 : 0), "notebook_zone hand or motion dwell");
}

function scorePenPickedUp(frame) {
  const pen = zone(frame, "pen_zone");
  const notebook = zone(frame, "notebook_zone");
  const neutral = zone(frame, "neutral_zone");
  if (pen.motion_score < 0.052 || (!notebook.active && !neutral.active && overlap(frame, "pen_zone").overlap < 0.1)) return null;
  return candidate(frame, "pen", Math.max(confidenceFromMotionScore(pen.motion_score, 0.62), notebook.active || neutral.active ? 0.7 : 0), "pen_zone motion followed by nearby hand or desk activity");
}

function scoreWritingMotion(frame, history) {
  const notebook = zone(frame, "notebook_zone");
  const samples = activeSamples(history.notebook_zone);
  if (samples < 3 && notebook.motion_score < 0.06) return null;
  if (zone(frame, "keyboard_zone").active) return null;
  return candidate(frame, "writing", Math.max(confidenceFromMotionScore(notebook.motion_score, 0.64), samples >= 3 ? 0.74 : 0), "repeated small activity in notebook_zone");
}

function scoreTypingMotion(frame, history) {
  const keyboard = zone(frame, "keyboard_zone");
  const samples = activeSamples(history.keyboard_zone);
  const twoHands = new Set((frame.hand_zone_overlap ?? []).filter((item) => item.zone_id === "keyboard_zone").map((item) => item.hand_id)).size >= 2;
  if (samples < 3 && keyboard.motion_score < 0.06 && !twoHands) return null;
  return candidate(frame, "typing", Math.max(confidenceFromMotionScore(keyboard.motion_score, 0.64), samples >= 3 ? 0.74 : 0, twoHands ? 0.8 : 0), "repeated small activity in keyboard_zone");
}

function scoreUncertain(frame) {
  if (!frame.uncertainty?.uncertain && !frame.scene_reset?.reset_detected) return null;
  return candidate(frame, "uncertain", Math.max(0.7, frame.confidence), frame.active_zone, frame.uncertainty?.reason || frame.scene_reset?.reason || "local uncertainty");
}

function candidate(frame, step, confidence, reasonZoneOrReason, maybeReason = null) {
  const meta = ACTION_META[step];
  const zoneId = maybeReason == null ? meta.zone_id : reasonZoneOrReason;
  const reason = maybeReason ?? reasonZoneOrReason;
  return {
    id: `cand_${meta.action_type}_${Math.round(frame.timestamp_ms)}`,
    action_type: meta.action_type,
    label: meta.label,
    current_step: step,
    confidence: Number(Math.min(0.96, confidence).toFixed(3)),
    zone_id: zoneId,
    reason,
    evidence: evidenceFor(frame, zoneId, reason),
    requires_confirmation: true,
    detection_method: frame.detection_method,
    timestamp_ms: frame.timestamp_ms
  };
}

function evidenceFor(frame, zoneId, reason) {
  const motion = zoneId ? zone(frame, zoneId) : null;
  return [{
    id: `ev_local_action_${Math.round(frame.timestamp_ms)}_${zoneId ?? "scene"}`,
    kind: "local_signal",
    description: `${reason}; motion=${motion?.motion_score ?? frame.uncertainty?.max_motion_score ?? 0}`,
    contains_raw_media: false
  }];
}

function zone(frame, zoneId) {
  return frame.zone_motion?.[zoneId] ?? { zone_id: zoneId, motion_score: 0, active: false, confidence: 0 };
}

function overlap(frame, zoneId) {
  return (frame.hand_zone_overlap ?? []).find((item) => item.zone_id === zoneId) ?? { overlap: 0, confidence: 0 };
}

function activeSamples(history = []) {
  return history.filter((item) => item.active).length;
}

function dwellMs(history = []) {
  const active = history.filter((item) => item.active);
  return active.length ? active[active.length - 1].timestamp_ms - active[0].timestamp_ms : 0;
}
