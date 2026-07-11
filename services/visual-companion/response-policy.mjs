import { normalizeContextualVisualResponse, safetyFailureCodes } from "./response-schema.mjs";

const ALLOWLISTED_ACTIONS = new Set(["start_timer", "speak_phrase", "append_activity_log", "browser_notification"]);

export function applyContextualResponsePolicy(rawResponse = {}, context = {}) {
  const response = normalizeContextualVisualResponse(rawResponse);
  const safetyFailures = safetyFailureCodes(response);
  if (safetyFailures.length) {
    return policyResult("silence", "unsafe_or_private_interpretation", response, safetyFailures);
  }
  if (response.confidence < 0.45 || response.uncertainty || context.conflictingEvidence === true) {
    return policyResult("uncertain", "low_confidence_or_conflict", response, []);
  }
  if (!response.visible_changes.length || context.repeatedObservation === true) {
    return policyResult("silence", "no_meaningful_change", response, []);
  }
  if (context.ambiguousIntent === true || response.response_type === "ask") {
    return policyResult("ask", "ambiguous_intent", response, []);
  }
  const relevantAction = response.suggested_actions.find((action) => ALLOWLISTED_ACTIONS.has(action.action_type));
  if (response.response_type === "assist" && relevantAction) {
    return policyResult("assist", "allowlisted_action_suggested_confirmation_required", response, []);
  }
  return policyResult("narrate", "clear_visible_change", response, []);
}

export function suggestedActionsRequireConfirmation(response = {}) {
  return normalizeContextualVisualResponse(response).suggested_actions.every((action) => action.requires_confirmation === true && action.execute === false);
}

function policyResult(responseType, reason, response, failures) {
  return {
    response_type: responseType,
    reason,
    spoken_response: responseType === "silence" ? "" : response.spoken_response,
    suggested_actions: response.suggested_actions.map((action) => ({
      ...action,
      requires_confirmation: true,
      execute: false
    })),
    failures
  };
}
