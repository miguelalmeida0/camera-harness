export const SPATIAL_ANALYZE_ENDPOINT = "/api/spatial-awareness/analyze";

export const SUPPORTED_SPATIAL_PREDICATES = Object.freeze([
  "object_enters_region",
  "object_leaves_region",
  "object_moves_closer",
  "object_moves_farther",
  "object_placed_left_of",
  "object_placed_right_of",
  "object_placed_behind",
  "hand_approaches_object",
  "hand_moves_away",
  "object_enters_frame",
  "object_leaves_frame"
]);

const INTENT_RULES = [
  {
    intent: "metric_distance",
    pattern: /\b(how (?:many|far)|centimet(?:er|re)s?|meters?|metres?|inches?|feet|distance apart)\b/i,
    capabilities: ["metric_scale", "object_relations"]
  },
  {
    intent: "movement_direction",
    pattern: /\b(did .*move|moved?|closer|farther|toward|towards|away from|where was|previously|before|left the frame|leave the frame|entered? the frame|position change)\b/i,
    capabilities: ["object_tracking", "temporal_relations"]
  },
  {
    intent: "hand_object_relation",
    pattern: /\b(?:left|right)?\s*hand\b.*\b(?:closer|near|far|approach|away|to|from)\b|\b(?:closer|near|far|approach|away)\b.*\bhand\b/i,
    capabilities: ["hand_tracking", "object_relations"]
  },
  {
    intent: "relative_distance",
    pattern: /\b(closest|farthest|nearest|nearer|farther|near|far|distance|how far apart)\b/i,
    capabilities: ["relative_depth", "object_relations"]
  },
  {
    intent: "relative_position",
    pattern: /\b(left of|right of|above|below|in front of|behind|inside|contains?|relative (?:position|layout)|where is|where are)\b/i,
    capabilities: ["object_relations"]
  },
  {
    intent: "scene_change",
    pattern: /\b(what changed|scene change|entered? view|left view|out of view|what left|what entered)\b/i,
    capabilities: ["scene_differencing", "object_tracking"]
  }
];

export function detectSpatialIntent(text) {
  const query = cleanText(text, 500);
  if (!query) return { isSpatial: false, intent: null, requiredCapabilities: [] };
  const handRule = /\bhand\b/i.test(query) ? INTENT_RULES.find((rule) => rule.intent === "hand_object_relation" && rule.pattern.test(query)) : null;
  const match = handRule || INTENT_RULES.find((rule) => rule.pattern.test(query));
  return match
    ? { isSpatial: true, intent: match.intent, requiredCapabilities: [...match.capabilities] }
    : { isSpatial: false, intent: null, requiredCapabilities: [] };
}

export function createSpatialExperienceState() {
  return {
    status: "idle",
    lastResult: null,
    lastSafeError: "",
    metadata: null,
    activeAbortController: null,
    currentResponseIsSpatial: false,
    memory: {
      lastReferencedObjectIds: [],
      lastReferencedLabels: [],
      lastRelation: "",
      lastSceneId: "",
      lastSpatialAnswer: "",
      lastRelativePosition: "",
      lastSuggestedView: ""
    },
    overlay: {
      visible: false,
      generation: 0,
      label: "",
      relation: "",
      confidence: null,
      suggestedView: "",
      region: null,
      timer: null
    }
  };
}

export async function analyzeSpatialWindow(input = {}, options = {}) {
  const frames = Array.isArray(input.frames) ? input.frames : [];
  const timestamps = Array.isArray(input.timestamps) ? input.timestamps.map(Number) : [];
  if (!frames.length || timestamps.length !== frames.length) throw spatialError("Spatial evidence is unavailable.", "invalid_spatial_window");
  if (timestamps.some((value, index) => !Number.isFinite(value) || (index > 0 && value < timestamps[index - 1]))) {
    throw spatialError("Spatial evidence is unavailable.", "unordered_spatial_window");
  }
  const send = options.fetch || globalThis.fetch;
  if (typeof send !== "function") throw spatialError("Precise spatial analysis is unavailable.", "spatial_service_unavailable");
  const response = await send(SPATIAL_ANALYZE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      frames,
      timestamps,
      query: cleanText(input.query, 500),
      mode: input.mode === "observing" ? "observing" : "conversation",
      calibration: safeCalibration(input.calibration),
      previousScene: safePreviousScene(input.previousScene)
    }),
    signal: options.signal
  });
  if (!response.ok) throw spatialError("Precise spatial analysis is unavailable.", "spatial_service_unavailable");
  const result = await response.json().catch(() => null);
  return validateSpatialResult(result);
}

export function validateSpatialResult(value) {
  if (!value || value.ok !== true || value.source !== "local_spatial" || !cleanText(value.scene_id, 120)) {
    throw spatialError("Precise spatial analysis is unavailable.", "invalid_spatial_response");
  }
  const normalized = {
    ok: true,
    source: "local_spatial",
    scene_id: cleanText(value.scene_id, 120),
    scale: normalizeScale(value.scale),
    objects: safeItems(value.objects),
    hands: safeItems(value.hands),
    relations: safeItems(value.relations),
    movements: safeItems(value.movements),
    interactions: safeItems(value.interactions),
    metric_estimates: safeItems(value.metric_estimates),
    evidence: safeItems(value.evidence),
    partial_observation: normalizePartialObservation(value.partial_observation),
    uncertainty: normalizeUncertainty(value.uncertainty)
  };
  return normalized;
}

export function resolveSpatialQuery(query, memory = {}) {
  const text = cleanText(query, 500);
  const labels = Array.isArray(memory.lastReferencedLabels) ? memory.lastReferencedLabels.filter(Boolean).slice(-2) : [];
  if (!labels.length || !/\b(it|they|them|that object|those objects)\b/i.test(text)) return text;
  return `${text}\nReferenced object${labels.length > 1 ? "s" : ""}: ${labels.join(", ")}.`;
}

export function spatialFactsBlock(result, options = {}) {
  if (!result?.ok) return options.unavailable ? ["precise spatial analysis unavailable"] : [];
  const facts = [];
  for (const relation of result.relations.slice(0, 6)) {
    const subject = safeLabel(relation.subject_label || relation.subject);
    const reference = safeLabel(relation.reference_label || relation.reference);
    const type = safeRelation(relation.relation || relation.type);
    if (subject && reference && type) facts.push(`${subject} ${type} ${reference}, confidence ${formatConfidence(relation.confidence)}`);
  }
  for (const movement of result.movements.slice(0, 4)) {
    const label = safeLabel(movement.subject_label || movement.label || movement.subject);
    const direction = cleanText(movement.direction || movement.change || movement.description, 120);
    if (label && direction) facts.push(`${label} movement: ${direction}, confidence ${formatConfidence(movement.confidence)}`);
  }
  for (const interaction of result.interactions.slice(0, 3)) {
    const description = cleanText(interaction.description, 160);
    if (description) facts.push(`${description}, confidence ${formatConfidence(interaction.confidence)}`);
  }
  facts.push(`current scale: ${result.scale.type}`);
  if (result.scale.type !== "metric") facts.push("no metric calibration available");
  const evidenceFrames = result.evidence.map((item) => Number(item.frame_index)).filter(Number.isInteger).slice(0, 8);
  if (evidenceFrames.length) facts.push(`evidence frames: ${evidenceFrames.join(", ")}`);
  if (result.partial_observation?.visible) facts.push(`partial observation: ${result.partial_observation.visible}`);
  if (result.uncertainty.missing_evidence.length) facts.push(`missing evidence: ${result.uncertainty.missing_evidence.join(", ")}`);
  return facts.slice(0, 12);
}

export function spatialContextForRequest(result, options = {}) {
  return {
    requested: options.requested === true,
    available: result?.ok === true,
    intent: options.intent || null,
    facts: spatialFactsBlock(result, { unavailable: options.unavailable === true }),
    scene_id: result?.scene_id || null,
    scale: result?.scale?.type || null,
    uncertainty: result?.uncertainty?.level || null,
    spatial_precision_unavailable: options.unavailable === true
  };
}

export function spatialNarration(result, options = {}) {
  if (!result?.ok) return "";
  const partial = result.partial_observation;
  if (partial?.visible) {
    const view = result.uncertainty.suggested_view || partial.suggested_view;
    return view ? `${sentence(partial.visible)} ${sentence(view)}` : sentence(partial.visible);
  }
  const metric = result.scale.type === "metric" ? result.metric_estimates.find(validMetricEstimate) : null;
  if (metric) return sentence(metric.description || `${safeLabel(metric.subject_label)} is approximately ${Number(metric.value)} ${metric.unit}.`);
  const movement = result.movements.find((item) => cleanText(item.description || item.direction || item.change, 180));
  if (movement) return sentence(movement.description || movement.change || `${safeLabel(movement.subject_label || movement.label)} moved ${cleanText(movement.direction, 80)}.`);
  const interaction = result.interactions.find((item) => cleanText(item.description, 180));
  if (interaction) return sentence(interaction.description);
  const relation = result.relations[0];
  if (relation) {
    const subject = safeLabel(relation.subject_label || relation.subject);
    const reference = safeLabel(relation.reference_label || relation.reference);
    const phrase = relationPhrase(relation.relation || relation.type);
    if (subject && reference && phrase) return sentence(`${article(subject)} ${subject} is ${phrase} ${article(reference)} ${reference}`);
  }
  const suggestion = result.uncertainty.suggested_view;
  return suggestion ? `I have partial spatial evidence. ${sentence(suggestion)}` : "";
}

export function updateSpatialMemory(spatialState, result, answer = "") {
  if (!spatialState || !result?.ok) return spatialState;
  const priorScene = spatialState.memory.lastSceneId;
  const objectIds = result.objects.map((item) => cleanText(item.id, 120)).filter(Boolean);
  if (priorScene && priorScene !== result.scene_id && !spatialState.memory.lastReferencedObjectIds.some((id) => objectIds.includes(id))) {
    spatialState.memory.lastReferencedObjectIds = [];
    spatialState.memory.lastReferencedLabels = [];
    spatialState.memory.lastRelation = "";
    spatialState.memory.lastRelativePosition = "";
  }
  const referenced = [
    ...result.relations.flatMap((item) => [
      { id: item.subject_id, label: item.subject_label || item.subject },
      { id: item.reference_id, label: item.reference_label || item.reference }
    ]),
    ...result.movements.map((item) => ({ id: item.subject_id, label: item.subject_label || item.label }))
  ].filter((item) => cleanText(item.label, 80));
  spatialState.memory.lastReferencedObjectIds = unique(referenced.map((item) => cleanText(item.id, 120)).filter(Boolean)).slice(-4);
  spatialState.memory.lastReferencedLabels = unique(referenced.map((item) => safeLabel(item.label)).filter(Boolean)).slice(-4);
  spatialState.memory.lastRelation = safeRelation(result.relations[0]?.relation || result.relations[0]?.type);
  spatialState.memory.lastRelativePosition = cleanText(result.movements[0]?.direction || result.relations[0]?.relation, 100);
  spatialState.memory.lastSceneId = result.scene_id;
  spatialState.memory.lastSpatialAnswer = cleanText(answer, 500);
  return spatialState;
}

export function spatialOverlayModel(result) {
  if (!result?.ok) return null;
  const evidence = result.evidence.find((item) => item.normalized_region && safeLabel(item.label)) || result.evidence[0] || {};
  const relation = result.relations[0] || {};
  const label = safeLabel(evidence.label || relation.subject_label || result.movements[0]?.subject_label || result.objects[0]?.label);
  const relationText = relationPhrase(relation.relation || relation.type) || cleanText(result.movements[0]?.direction, 60);
  const suggestedView = cleanText(result.uncertainty.suggested_view || result.partial_observation?.suggested_view, 160);
  if (!label && !relationText && !suggestedView) return null;
  return {
    label,
    relation: relationText,
    confidence: Number.isFinite(Number(evidence.confidence ?? relation.confidence)) ? clamp01(evidence.confidence ?? relation.confidence) : null,
    suggestedView,
    region: normalizeRegion(evidence.normalized_region)
  };
}

export function spatialMetadata(result) {
  if (!result?.ok) return null;
  if (result.uncertainty.level === "high" || result.uncertainty.suggested_view) return "Additional view needed";
  if (result.scale.type === "metric" && result.metric_estimates.some(validMetricEstimate)) return "Metric estimate";
  if (result.relations.length || result.movements.length || result.interactions.length) return "Spatial evidence available";
  return null;
}

export function clearSpatialTransient(spatialState, options = {}) {
  if (!spatialState) return;
  spatialState.activeAbortController?.abort?.();
  spatialState.activeAbortController = null;
  if (spatialState.overlay.timer) globalThis.clearTimeout?.(spatialState.overlay.timer);
  const generation = Number(spatialState.overlay.generation || 0) + 1;
  spatialState.status = "idle";
  spatialState.lastResult = null;
  spatialState.lastSafeError = "";
  spatialState.metadata = null;
  spatialState.currentResponseIsSpatial = false;
  spatialState.overlay = { visible: false, generation, label: "", relation: "", confidence: null, suggestedView: "", region: null, timer: null };
  if (options.clearMemory !== false) spatialState.memory = createSpatialExperienceState().memory;
}

export function validateSpatialPredicateDefinition(value) {
  if (!value || value.type !== "spatial_predicate" || !SUPPORTED_SPATIAL_PREDICATES.includes(String(value.predicate))) {
    return { ok: false, code: "unsupported_spatial_predicate" };
  }
  const subjectLabel = safeLabel(value.subject_label);
  const referenceLabel = safeLabel(value.reference_label);
  const minimumConfidence = Number(value.minimum_confidence);
  if (!subjectLabel || !referenceLabel || !Number.isFinite(minimumConfidence) || minimumConfidence < 0.5 || minimumConfidence > 1) {
    return { ok: false, code: "invalid_spatial_predicate" };
  }
  return {
    ok: true,
    value: {
      type: "spatial_predicate",
      predicate: String(value.predicate),
      subject_label: subjectLabel,
      reference_label: referenceLabel,
      minimum_confidence: minimumConfidence
    }
  };
}

function normalizeScale(value = {}) {
  const type = ["relative", "metric"].includes(String(value.type)) ? String(value.type) : "relative";
  return { type, unit: type === "metric" ? cleanText(value.unit, 24) || null : null, confidence: clamp01(value.confidence) };
}

function normalizeUncertainty(value = {}) {
  return {
    level: ["low", "medium", "high"].includes(String(value.level)) ? String(value.level) : "medium",
    missing_evidence: Array.isArray(value.missing_evidence) ? value.missing_evidence.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 6) : [],
    suggested_view: cleanText(value.suggested_view, 180) || null
  };
}

function normalizePartialObservation(value) {
  if (!value) return null;
  if (typeof value === "string") return { visible: cleanText(value, 240), suggested_view: null };
  const visible = cleanText(value.visible || value.description, 240);
  return visible ? { visible, suggested_view: cleanText(value.suggested_view, 180) || null } : null;
}

function safeItems(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").slice(0, 24).map((item) => ({ ...item })) : [];
}

function safeCalibration(value) {
  if (!value || typeof value !== "object") return null;
  return { type: value.type === "metric" ? "metric" : "relative", unit: cleanText(value.unit, 24) || null };
}

function safePreviousScene(value) {
  if (!value || typeof value !== "object") return null;
  return { scene_id: cleanText(value.scene_id, 120), referenced_object_ids: Array.isArray(value.referenced_object_ids) ? value.referenced_object_ids.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 4) : [] };
}

function normalizeRegion(value) {
  if (!value || typeof value !== "object") return null;
  const x = clamp01(value.x);
  const y = clamp01(value.y);
  const width = Math.min(1 - x, Math.max(0.08, clamp01(value.width)));
  const height = Math.min(1 - y, Math.max(0.08, clamp01(value.height)));
  return { x, y, width, height };
}

function validMetricEstimate(value) {
  return value && Number.isFinite(Number(value.value)) && Number(value.value) >= 0 && cleanText(value.unit, 24) && cleanText(value.description || value.subject_label, 180);
}

function safeLabel(value) {
  return cleanText(value, 60).replace(/[^a-z0-9 .'-]/gi, "").trim();
}

function safeRelation(value) {
  const relation = cleanText(value, 60).toLowerCase().replace(/\s+/g, "_");
  return ["left_of", "right_of", "above", "below", "in_front_of", "behind", "inside", "contains", "closer_than", "farther_than", "near", "far"].includes(relation) ? relation : "";
}

function relationPhrase(value) {
  return ({ left_of: "to the left of", right_of: "to the right of", above: "above", below: "below", in_front_of: "in front of", behind: "behind", inside: "inside", contains: "around", closer_than: "closer than", farther_than: "farther than", near: "near", far: "far from" })[safeRelation(value)] || "";
}

function article(label) {
  return /^(?:your|this|that|the)\b/i.test(label) ? "" : "the";
}

function formatConfidence(value) {
  return clamp01(value).toFixed(2);
}

function sentence(value) {
  const text = cleanText(value, 500);
  if (!text) return "";
  const capitalized = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function cleanText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function unique(values) {
  return [...new Set(values)];
}

function spatialError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
