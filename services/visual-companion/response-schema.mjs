import { containsRawMedia } from "./observation-window.mjs";

export const CONTEXTUAL_VISUAL_RESPONSE_SCHEMA = "darkquest.contextual_visual_response.v1";

export const REQUIRED_VISUAL_RESPONSE_FIELDS = Object.freeze([
  "observation",
  "scene_before",
  "scene_after",
  "visible_changes",
  "visible_objects",
  "visible_action",
  "response_type",
  "spoken_response",
  "confidence",
  "uncertainty",
  "safety_flags",
  "suggested_actions"
]);

const RESPONSE_TYPES = new Set(["narrate", "ask", "assist", "uncertain", "silence"]);
const ALLOWED_SUGGESTED_ACTIONS = new Set(["start_timer", "speak_phrase", "append_activity_log", "browser_notification"]);
const SENSITIVE_TERMS = /\b(ethnicity|race|religion|disabled|disability|sexuality|gay|straight|pregnant|diagnosis|disease|depressed|anxious|autistic|adhd)\b/i;
const IDENTITY_TERMS = /\b(named|identity|identified as|this is [a-z]+|person is [a-z]+)\b/i;
const EMOTION_OVERCLAIM_TERMS = /\b(is angry|is sad|is happy|looks depressed|seems anxious|feels)\b/i;
const PRIVATE_TEXT_TERMS = /\b(private document says|the document says|reads:|ocr|transcribed text)\b/i;

export function normalizeContextualVisualResponse(input = {}) {
  const responseType = RESPONSE_TYPES.has(input.response_type) ? input.response_type : "uncertain";
  const safetyFlags = Array.isArray(input.safety_flags) ? input.safety_flags.map(String) : [];
  const spokenResponse = String(input.spoken_response || "").slice(0, 240);
  const normalized = {
    schema: CONTEXTUAL_VISUAL_RESPONSE_SCHEMA,
    observation: sanitizeText(input.observation || ""),
    scene_before: sanitizeText(input.scene_before || ""),
    scene_after: sanitizeText(input.scene_after || ""),
    visible_changes: toTextArray(input.visible_changes),
    visible_objects: toTextArray(input.visible_objects),
    visible_action: sanitizeText(input.visible_action || ""),
    response_type: responseType,
    spoken_response: spokenResponse,
    confidence: clamp01(input.confidence),
    uncertainty: sanitizeText(input.uncertainty || ""),
    safety_flags: safetyFlags,
    suggested_actions: normalizeSuggestedActions(input.suggested_actions),
    contains_raw_media: false
  };
  return {
    ...normalized,
    safety_flags: [...new Set([...normalized.safety_flags, ...safetyFlagsFor(normalized)])]
  };
}

export function validateContextualVisualResponse(response = {}) {
  const failures = [];
  for (const field of REQUIRED_VISUAL_RESPONSE_FIELDS) {
    if (!(field in response)) failures.push(`visual_response_missing_${field}`);
  }
  if (!RESPONSE_TYPES.has(response.response_type)) failures.push("visual_response_type_invalid");
  if (Number(response.confidence) < 0 || Number(response.confidence) > 1) failures.push("visual_response_confidence_invalid");
  if (containsRawMedia(response)) failures.push("visual_raw_media_persisted");
  for (const failure of safetyFailureCodes(response)) failures.push(failure);
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

export function normalizeMalformedVisualOutput(input) {
  if (typeof input !== "object" || input == null || Array.isArray(input)) {
    return normalizeContextualVisualResponse({
      observation: "",
      response_type: "uncertain",
      spoken_response: "I am not sure what changed.",
      confidence: 0,
      uncertainty: "model output was malformed",
      safety_flags: ["malformed_output"],
      suggested_actions: []
    });
  }
  return normalizeContextualVisualResponse(input);
}

export function safetyFailureCodes(response = {}) {
  const text = JSON.stringify(response);
  const failures = [];
  if (IDENTITY_TERMS.test(text)) failures.push("visual_identity_inference");
  if (SENSITIVE_TERMS.test(text)) failures.push("visual_sensitive_attribute_inference");
  if (EMOTION_OVERCLAIM_TERMS.test(text)) failures.push("visual_emotion_overclaim");
  if (PRIVATE_TEXT_TERMS.test(text)) failures.push("visual_private_text_exposure");
  if (response.suggested_actions?.some?.((action) => action.execute === true || action.requires_confirmation === false)) failures.push("visual_action_without_confirmation");
  if (response.suggested_actions?.some?.((action) => !ALLOWED_SUGGESTED_ACTIONS.has(action.action_type))) failures.push("visual_unsafe_action");
  if (containsRawMedia(response)) failures.push("visual_raw_media_persisted");
  if (response.response_type === "uncertain" && !response.uncertainty) failures.push("visual_uncertainty_hidden");
  return [...new Set(failures)];
}

function safetyFlagsFor(response) {
  return safetyFailureCodes(response).map((code) => code.replace(/^visual_/, ""));
}

function normalizeSuggestedActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.slice(0, 3).map((action) => ({
    action_type: String(action.action_type || "unknown"),
    label: sanitizeText(action.label || action.action_type || ""),
    requires_confirmation: true,
    execute: false
  }));
}

function toTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item) => sanitizeText(item));
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 360);
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}
