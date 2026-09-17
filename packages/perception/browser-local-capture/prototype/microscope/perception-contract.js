export const PERCEPTION_VOCABULARY_PROFILES = Object.freeze({
  household: Object.freeze([
    "person", "face", "hand", "phone", "remote control", "bottle", "cup",
    "sunglasses", "eyeglasses", "package", "battery package", "medicine package",
    "book", "screen", "lamp", "bed", "pillow", "charger", "cable", "earbuds",
    "keys", "wallet", "food", "plant", "tool", "unknown handheld object"
  ]),
  desk: Object.freeze([
    "person", "hand", "phone", "laptop", "screen", "keyboard", "mouse", "book",
    "notebook", "pen", "charger", "cable", "earbuds", "cup", "bottle", "keys",
    "wallet", "package", "unknown desk object"
  ]),
  kitchen: Object.freeze([
    "person", "hand", "bottle", "cup", "glass", "plate", "bowl", "food",
    "utensil", "pan", "pot", "package", "medicine package", "appliance", "sink",
    "plant", "unknown kitchen object"
  ]),
  electronics: Object.freeze([
    "person", "hand", "phone", "remote control", "screen", "laptop", "tablet",
    "charger", "cable", "earbuds", "battery", "battery package", "keyboard",
    "mouse", "camera", "unknown electronic device"
  ]),
  packaging: Object.freeze([
    "person", "hand", "package", "battery package", "medicine package", "food package",
    "box", "blister pack", "label", "barcode", "bottle", "tube", "bag",
    "unknown consumer package"
  ])
});

export function activeVocabulary(profile = "household", focusTerms = []) {
  const base = PERCEPTION_VOCABULARY_PROFILES[profile] || PERCEPTION_VOCABULARY_PROFILES.household;
  const values = [...focusTerms, ...base, ...PERCEPTION_VOCABULARY_PROFILES.household];
  const unique = [];
  for (const value of values) {
    const term = cleanText(value, 80).toLowerCase();
    if (term && !unique.includes(term)) unique.push(term);
    if (unique.length >= 80) break;
  }
  return Object.freeze(unique);
}

export function validateDiscoveryResponse(value = {}) {
  if (value?.ok !== true || !Array.isArray(value.objects)) throw contractError("Discovery response is incomplete.");
  return Object.freeze({
    source: value.source === "local_open_vocabulary" ? value.source : "local_open_vocabulary",
    model: cleanText(value.model, 180) || "local visual model",
    profile: cleanText(value.profile, 40) || "household",
    activeVocabulary: Object.freeze((Array.isArray(value.active_vocabulary) ? value.active_vocabulary : []).map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 80)),
    objects: Object.freeze(value.objects.map(normalizeDiscoveryObject).filter(Boolean).slice(0, 16)),
    latencyMs: boundedNumber(value.latency_ms, 0, 300_000, 0),
    remoteRequests: 0,
    containsRawMedia: false
  });
}

export function validateVerificationResponse(value = {}, expectedTrackId = "") {
  const trackId = cleanText(value.track_id, 80);
  if (value?.ok !== true || !trackId || trackId !== cleanText(expectedTrackId, 80)) {
    throw contractError("Semantic result does not match the active track.");
  }
  const identity = value.identity && typeof value.identity === "object" ? value.identity : {};
  const label = cleanText(identity.label, 100);
  if (!label) throw contractError("Semantic identity is missing.");
  return Object.freeze({
    trackId,
    identity: Object.freeze({
      label,
      confidence: boundedNumber(identity.confidence, 0, 1, 0),
      alternatives: Object.freeze(normalizeCandidates(identity.alternatives))
    }),
    visibleFacts: Object.freeze(normalizeFacts(value.visible_facts, 10)),
    visibleText: Object.freeze(normalizeVisibleText(value.visible_text, 10)),
    condition: Object.freeze(normalizeFacts(value.condition, 8)),
    relationships: Object.freeze(normalizeSemanticRelationships(value.relationships, trackId)),
    limitations: Object.freeze((Array.isArray(value.limitations) ? value.limitations : []).map((item) => cleanText(item, 240)).filter(Boolean).slice(0, 8)),
    source: "semantic",
    provider: cleanText(value.source, 80) || "local_semantic",
    model: cleanText(value.model, 180) || "local visual model",
    latencyMs: boundedNumber(value.latency_ms, 0, 300_000, 0),
    inspectedAt: Date.now(),
    remoteRequests: 0,
    containsRawMedia: false
  });
}

function normalizeDiscoveryObject(value, index) {
  if (!value || typeof value !== "object") return null;
  const label = cleanText(value.label, 80);
  const box = normalizeBox(value.box);
  if (!label || !box) return null;
  return Object.freeze({
    observationId: cleanText(value.observation_id, 80) || `discovery-${index + 1}`,
    label,
    confidence: boundedNumber(value.confidence, 0, 1, 0),
    box,
    localCandidates: Object.freeze(normalizeCandidates(value.local_candidates).length
      ? normalizeCandidates(value.local_candidates)
      : [{ label, confidence: boundedNumber(value.confidence, 0, 1, 0), source: "local_open_vocabulary" }]),
    appearance: cleanText(value.appearance, 240),
    visibleFacts: Object.freeze((Array.isArray(value.visible_facts) ? value.visible_facts : []).map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 6)),
    missingEvidence: Object.freeze((Array.isArray(value.missing_evidence) ? value.missing_evidence : []).map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 6)),
    source: "local_open_vocabulary"
  });
}

function normalizeCandidates(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    const label = cleanText(value?.label, 100);
    return label ? Object.freeze({
      label,
      confidence: boundedNumber(value?.confidence, 0, 1, 0),
      source: cleanText(value?.source, 40) || "local_open_vocabulary"
    }) : null;
  }).filter(Boolean).slice(0, 8);
}

function normalizeFacts(values, maximum) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    const statement = cleanText(value?.statement, 280);
    return statement ? Object.freeze({ statement, confidence: boundedNumber(value?.confidence, 0, 1, 0) }) : null;
  }).filter(Boolean).slice(0, maximum);
}

function normalizeVisibleText(values, maximum) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    const text = cleanText(value?.text, 300);
    return text ? Object.freeze({ text, confidence: boundedNumber(value?.confidence, 0, 1, 0) }) : null;
  }).filter(Boolean).slice(0, maximum);
}

function normalizeSemanticRelationships(values, subjectId) {
  if (!Array.isArray(values)) return [];
  return values.map((value, index) => {
    const predicate = cleanText(value?.predicate, 80);
    const objectLabel = cleanText(value?.object_label, 100);
    return predicate && objectLabel ? Object.freeze({
      id: `semantic-relation-${index + 1}`,
      subjectId,
      predicate,
      objectId: null,
      objectLabel,
      confidence: boundedNumber(value?.confidence, 0, 1, 0),
      source: "semantic"
    }) : null;
  }).filter(Boolean).slice(0, 8);
}

function normalizeBox(value) {
  if (!value || typeof value !== "object") return null;
  const x = boundedNumber(value.x, 0, 1, 0);
  const y = boundedNumber(value.y, 0, 1, 0);
  const width = Math.min(1 - x, boundedNumber(value.width, 0, 1, 0));
  const height = Math.min(1 - y, boundedNumber(value.height, 0, 1, 0));
  return width > 0 && height > 0 ? Object.freeze({ x, y, width, height }) : null;
}

function cleanText(value, maximum) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function contractError(message) {
  const error = new Error(message);
  error.code = "perception_contract_invalid";
  return error;
}
