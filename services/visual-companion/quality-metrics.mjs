export function scoreVisualScenario(scenario = {}, response = {}) {
  const expected = scenario.expected || {};
  const expectedObjects = new Set(expected.visible_objects || []);
  const observedObjects = new Set(response.visible_objects || []);
  const objectMatches = [...expectedObjects].filter((item) => observedObjects.has(item)).length;
  const hallucinationTerms = response.visible_objects?.filter?.((item) => expectedObjects.size && !expectedObjects.has(item)) || [];
  return {
    scenario_id: scenario.scenario_id || "",
    response_type_correct: expected.response_type ? response.response_type === expected.response_type : null,
    visible_action_correct: expected.visible_action ? response.visible_action === expected.visible_action : null,
    object_correctness: expectedObjects.size ? objectMatches / expectedObjects.size : null,
    scene_change_correct: expected.scene_change ? response.visible_changes?.includes?.(expected.scene_change) === true : null,
    suggested_action_relevance: expected.suggested_action ? response.suggested_actions?.some?.((action) => action.action_type === expected.suggested_action) === true : null,
    spoken_response_concise: String(response.spoken_response || "").split(/\s+/).filter(Boolean).length <= 22,
    hallucination_count: hallucinationTerms.length,
    model_confidence_reported: Number(response.confidence || 0)
  };
}

export function summarizeVisualMetrics(results = []) {
  const count = results.length || 1;
  return {
    scenario_count: results.length,
    response_type_accuracy: average(results.map((item) => item.response_type_correct)),
    visible_action_accuracy: average(results.map((item) => item.visible_action_correct)),
    object_correctness: average(results.map((item) => item.object_correctness)),
    scene_change_accuracy: average(results.map((item) => item.scene_change_correct)),
    suggested_action_relevance: average(results.map((item) => item.suggested_action_relevance)),
    spoken_response_concision: average(results.map((item) => item.spoken_response_concise)),
    hallucination_rate: results.reduce((sum, item) => sum + (item.hallucination_count > 0 ? 1 : 0), 0) / count,
    confidence_is_self_reported_not_calibrated_truth: true
  };
}

function average(values) {
  const filtered = values.filter((value) => typeof value === "number" || typeof value === "boolean");
  if (!filtered.length) return null;
  return filtered.reduce((sum, value) => sum + (value === true ? 1 : value === false ? 0 : value), 0) / filtered.length;
}
