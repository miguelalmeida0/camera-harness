import { SPATIAL_LIMITS, sanitizeTextNumericData } from "./spatial-contract.mjs";

export function createSpatialScene(options = {}) {
  return {
    schema_version: "sensefield.spatial_scene.v1",
    session_id: String(options.sessionId || "").slice(0, 128),
    revision: 0,
    objects: [],
    relations: [],
    moments: [],
    last_suggested_view: null,
    evidence_signature: "",
    contains_raw_media: false,
    limits: {
      max_objects: positiveInt(options.maxObjects, SPATIAL_LIMITS.maxObjects),
      max_relations: positiveInt(options.maxRelations, SPATIAL_LIMITS.maxRelations),
      max_moments: positiveInt(options.maxMoments, SPATIAL_LIMITS.maxMoments)
    }
  };
}

export function updateSpatialScene(previousScene, analysis = {}) {
  const scene = previousScene?.schema_version === "sensefield.spatial_scene.v1"
    ? sanitizeTextNumericData(previousScene)
    : createSpatialScene();
  const limits = { ...createSpatialScene().limits, ...(scene.limits || {}) };
  const byId = new Map((scene.objects || []).map((object) => [object.id, object]));
  for (const object of analysis.objects || []) {
    byId.set(object.id, {
      ...(byId.get(object.id) || {}),
      ...sanitizeTextNumericData(object),
      first_seen: byId.get(object.id)?.first_seen ?? object.first_seen,
      last_seen: object.last_seen
    });
  }
  const objects = [...byId.values()]
    .sort((a, b) => Number(b.last_seen || 0) - Number(a.last_seen || 0))
    .slice(0, limits.max_objects);
  const objectIds = new Set(objects.map((object) => object.id));
  const relations = (analysis.relations || [])
    .filter((relation) => objectIds.has(relation.subject_id) && objectIds.has(relation.object_id))
    .slice(0, limits.max_relations)
    .map((relation) => sanitizeTextNumericData(relation));
  const moment = {
    scene_id: analysis.scene_id,
    observed_at: Date.now(),
    movements: (analysis.movements || []).slice(0, 16),
    interactions: (analysis.interactions || []).slice(0, 16),
    claim_count: (analysis.claims || []).length
  };
  return {
    ...scene,
    revision: Number(scene.revision || 0) + 1,
    objects,
    relations,
    moments: [...(scene.moments || []), sanitizeTextNumericData(moment)].slice(-limits.max_moments),
    last_suggested_view: analysis.uncertainty?.suggested_view || scene.last_suggested_view || null,
    evidence_signature: analysis.uncertainty?.evidence_signature || evidenceSignature(analysis),
    limits,
    contains_raw_media: false
  };
}

export function summarizeSpatialScene(scene = {}) {
  const safe = sanitizeTextNumericData(scene);
  return {
    schema_version: "sensefield.spatial_scene_summary.v1",
    revision: Number(safe?.revision || 0),
    objects: (safe?.objects || []).slice(0, SPATIAL_LIMITS.maxObjects).map((object) => ({
      id: object.id,
      label: object.label,
      center: object.center,
      relative_depth: object.relative_depth,
      confidence: object.confidence,
      first_seen: object.first_seen,
      last_seen: object.last_seen
    })),
    relations: (safe?.relations || []).slice(0, SPATIAL_LIMITS.maxRelations),
    recent_moments: (safe?.moments || []).slice(-5),
    last_suggested_view: safe?.last_suggested_view || null,
    evidence_signature: safe?.evidence_signature || "",
    contains_raw_media: false
  };
}

export function clearSpatialScene(scene) {
  if (scene && typeof scene === "object") {
    scene.objects = [];
    scene.relations = [];
    scene.moments = [];
    scene.last_suggested_view = null;
    scene.evidence_signature = "";
    scene.revision = 0;
  }
  return createSpatialScene({ sessionId: scene?.session_id });
}

function evidenceSignature(analysis) {
  return (analysis.evidence || []).map((item) => `${item.frame_index}:${(item.object_ids || []).join(",")}`).join("|").slice(0, 500);
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
