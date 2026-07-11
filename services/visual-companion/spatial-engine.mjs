import {
  SPATIAL_DIRECTIONS,
  SPATIAL_INTERACTIONS,
  SPATIAL_LIMITS,
  SPATIAL_RELATIONS,
  SPATIAL_SOURCE,
  clamp01,
  sanitizeIdentifier,
  sanitizeSpatialResult,
  sanitizeText,
  spatialFailure,
  validateSpatialInput
} from "./spatial-contract.mjs";

const DEFAULT_THRESHOLD = 0.55;
const INVERSE_RELATIONS = Object.freeze({
  left_of: "right_of",
  right_of: "left_of",
  above: "below",
  below: "above",
  in_front_of: "behind",
  behind: "in_front_of",
  inside: "contains",
  contains: "inside",
  near: "far",
  far: "near"
});

export async function analyzeSpatialWindow(input = {}, options = {}) {
  const validation = validateSpatialInput(input, options.limits || SPATIAL_LIMITS);
  if (!validation.ok) return validation;
  const threshold = clampThreshold(options.confidenceThreshold ?? input.confidenceThreshold);
  let observations;
  try {
    observations = await resolveObservations(validation.frames, validation, options);
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return spatialFailure("spatial_timeout", "Spatial precision timed out. Try a shorter window.");
    }
    return spatialFailure("spatial_model_unavailable", "Spatial precision is temporarily unavailable.");
  }
  if (!Array.isArray(observations) || observations.length !== validation.frames.length) {
    return spatialFailure("spatial_model_unavailable", "Spatial precision is temporarily unavailable.");
  }

  const tracked = trackWindow(observations, validation.previousScene, threshold);
  const finalFrameIndex = tracked.length - 1;
  const finalFrame = tracked[finalFrameIndex] || { objects: [], hands: [] };
  const relations = inferRelations(finalFrame.objects, finalFrameIndex, threshold);
  const movements = inferMovements(tracked, threshold);
  const interactions = inferInteractions(tracked, movements, threshold);
  const claims = extractSpatialClaims({ relations, movements, interactions });
  const contradictions = detectSpatialContradictions(claims);
  const evidence = associateEvidenceFrames(claims);
  const partial = partialEvidence(finalFrame, validation.previousScene);
  const metric = metricEstimates(finalFrame.objects, validation.calibration);
  const scale = metric.scale;

  const result = {
    ok: true,
    source: SPATIAL_SOURCE,
    scene_id: `scene_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    scale,
    objects: finalFrame.objects.slice(0, SPATIAL_LIMITS.maxObjects),
    hands: finalFrame.hands.slice(0, 4),
    relations: relations.slice(0, SPATIAL_LIMITS.maxRelations),
    movements,
    interactions,
    metric_estimates: metric.estimates,
    claims,
    evidence,
    contradictions,
    partial_observation: partial.partial_observation,
    uncertainty: partial.uncertainty,
    contains_raw_media: false
  };
  return sanitizeSpatialResult(result);
}

export function inferRelations(objects = [], frameIndex = 0, threshold = DEFAULT_THRESHOLD) {
  const relations = [];
  for (let leftIndex = 0; leftIndex < objects.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < objects.length; rightIndex += 1) {
      const first = objects[leftIndex];
      const second = objects[rightIndex];
      const confidence = Math.min(first.confidence, second.confidence);
      if (confidence < threshold) continue;
      const horizontalGap = Math.abs(first.center[0] - second.center[0]);
      const verticalGap = Math.abs(first.center[1] - second.center[1]);
      const distance = centerDistance(first, second);
      const overlap = intersectionOverUnion(first.bbox, second.bbox);
      const firstInsideSecond = bboxInside(first.bbox, second.bbox);
      const secondInsideFirst = bboxInside(second.bbox, first.bbox);
      if (firstInsideSecond) addRelation(relations, first, "inside", second, confidence, frameIndex);
      if (firstInsideSecond) addRelation(relations, second, "contains", first, confidence, frameIndex);
      if (secondInsideFirst) addRelation(relations, second, "inside", first, confidence, frameIndex);
      if (secondInsideFirst) addRelation(relations, first, "contains", second, confidence, frameIndex);
      if (overlap >= 0.08) addSymmetric(relations, first, "overlapping", second, confidence * Math.min(1, overlap + 0.55), frameIndex);
      if (!firstInsideSecond && !secondInsideFirst && bboxGap(first.bbox, second.bbox) <= 0.025) {
        addSymmetric(relations, first, "touching", second, confidence * 0.9, frameIndex);
      }
      if (horizontalGap >= 0.08) {
        const [left, right] = first.center[0] < second.center[0] ? [first, second] : [second, first];
        addRelation(relations, left, "left_of", right, confidenceForDelta(confidence, horizontalGap), frameIndex);
        addRelation(relations, right, "right_of", left, confidenceForDelta(confidence, horizontalGap), frameIndex);
      }
      if (verticalGap >= 0.08) {
        const [above, below] = first.center[1] < second.center[1] ? [first, second] : [second, first];
        addRelation(relations, above, "above", below, confidenceForDelta(confidence, verticalGap), frameIndex);
        addRelation(relations, below, "below", above, confidenceForDelta(confidence, verticalGap), frameIndex);
      }
      const depthGap = Math.abs(first.relative_depth - second.relative_depth);
      if (depthGap >= 0.08) {
        const [front, behind] = first.relative_depth < second.relative_depth ? [first, second] : [second, first];
        addRelation(relations, front, "in_front_of", behind, confidenceForDelta(confidence, depthGap), frameIndex);
        addRelation(relations, behind, "behind", front, confidenceForDelta(confidence, depthGap), frameIndex);
      }
      if (distance <= 0.3) addSymmetric(relations, first, "near", second, confidenceForDelta(confidence, 0.3 - distance + 0.1), frameIndex);
      if (distance >= 0.58) addSymmetric(relations, first, "far", second, confidenceForDelta(confidence, distance - 0.48), frameIndex);
      if (distance >= 0.35 && overlap === 0) addSymmetric(relations, first, "separated_from", second, confidenceForDelta(confidence, distance - 0.25), frameIndex);
    }
  }
  return relations.filter((relation) => relation.confidence >= threshold).slice(0, SPATIAL_LIMITS.maxRelations);
}

export function inferMovements(frames = [], threshold = DEFAULT_THRESHOLD) {
  if (!frames.length) return [];
  const firstIndex = 0;
  const lastIndex = frames.length - 1;
  const first = new Map(frames[firstIndex].objects.map((object) => [object.id, object]));
  const last = new Map(frames[lastIndex].objects.map((object) => [object.id, object]));
  const movements = [];
  for (const id of new Set([...first.keys(), ...last.keys()])) {
    const before = first.get(id);
    const after = last.get(id);
    if (!before && after) {
      addMovement(movements, after, "entered_frame", firstIndex, lastIndex, after.confidence, [lastIndex]);
      continue;
    }
    if (before && !after) {
      addMovement(movements, before, "left_frame", firstIndex, lastIndex, before.confidence, [firstIndex]);
      continue;
    }
    if (!before || !after) continue;
    const confidence = Math.min(before.confidence, after.confidence);
    if (confidence < threshold) continue;
    const dx = after.center[0] - before.center[0];
    const dy = after.center[1] - before.center[1];
    const depthDelta = after.relative_depth - before.relative_depth;
    let changed = false;
    if (Math.abs(dx) >= 0.08) {
      addMovement(movements, after, dx > 0 ? "right" : "left", firstIndex, lastIndex, confidenceForDelta(confidence, Math.abs(dx)), [firstIndex, lastIndex]);
      changed = true;
    }
    if (Math.abs(dy) >= 0.08) {
      addMovement(movements, after, dy > 0 ? "downward" : "upward", firstIndex, lastIndex, confidenceForDelta(confidence, Math.abs(dy)), [firstIndex, lastIndex]);
      changed = true;
    }
    if (Math.abs(depthDelta) >= 0.08) {
      addMovement(movements, after, depthDelta < 0 ? "toward_camera" : "away_from_camera", firstIndex, lastIndex, confidenceForDelta(confidence, Math.abs(depthDelta)), [firstIndex, lastIndex]);
      changed = true;
    }
    if (!changed) addMovement(movements, after, "approximately_stationary", firstIndex, lastIndex, confidence * 0.9, [firstIndex, lastIndex]);
  }
  return movements.filter((movement) => movement.confidence >= threshold);
}

export function inferInteractions(frames = [], movements = [], threshold = DEFAULT_THRESHOLD) {
  if (!frames.length) return [];
  const firstIndex = 0;
  const lastIndex = frames.length - 1;
  const first = frames[firstIndex];
  const last = frames[lastIndex];
  const interactions = [];
  for (const finalHand of last.hands) {
    const initialHand = first.hands.find((hand) => hand.id === finalHand.id);
    for (const finalObject of last.objects) {
      const initialObject = first.objects.find((object) => object.id === finalObject.id);
      const finalDistance = centerDistance(finalHand, finalObject);
      const initialDistance = initialHand && initialObject ? centerDistance(initialHand, initialObject) : null;
      const confidence = Math.min(finalHand.confidence, finalObject.confidence);
      if (confidence < threshold) continue;
      if (initialDistance != null && initialDistance - finalDistance >= 0.08) {
        addInteraction(interactions, finalHand.id, "hand_approaching_object", finalObject.id, confidenceForDelta(confidence, initialDistance - finalDistance), [firstIndex, lastIndex]);
      }
      if (initialDistance != null && finalDistance - initialDistance >= 0.08) {
        addInteraction(interactions, finalHand.id, "hand_moving_away_from_object", finalObject.id, confidenceForDelta(confidence, finalDistance - initialDistance), [firstIndex, lastIndex]);
      }
      if (finalDistance <= 0.14 || intersectionOverUnion(finalHand.bbox, finalObject.bbox) >= 0.03) {
        addInteraction(interactions, finalHand.id, "hand_holding_object", finalObject.id, confidence * 0.9, [lastIndex]);
      } else if (initialDistance != null && initialDistance <= 0.14 && finalDistance >= 0.24) {
        addInteraction(interactions, finalHand.id, "hand_releasing_object", finalObject.id, confidence * 0.85, [firstIndex, lastIndex]);
      }
    }
  }
  for (const movement of movements) {
    const map = {
      upward: "object_raised",
      downward: "object_lowered",
      entered_frame: "object_entered_frame",
      left_frame: "object_left_frame"
    };
    const predicate = map[movement.direction];
    if (predicate) addInteraction(interactions, null, predicate, movement.subject_id, movement.confidence, movement.evidence_frames);
    if (!["approximately_stationary", "entered_frame", "left_frame"].includes(movement.direction)) {
      addInteraction(interactions, null, "object_repositioned", movement.subject_id, movement.confidence * 0.9, movement.evidence_frames);
    }
    if (movement.direction === "entered_frame") addInteraction(interactions, null, "object_placed", movement.subject_id, movement.confidence * 0.85, movement.evidence_frames);
    if (movement.direction === "left_frame") addInteraction(interactions, null, "object_removed", movement.subject_id, movement.confidence * 0.85, movement.evidence_frames);
  }
  return dedupeClaims(interactions).filter((item) => item.confidence >= threshold);
}

export function extractSpatialClaims({ relations = [], movements = [], interactions = [] } = {}) {
  const claims = [];
  for (const relation of relations) claims.push({
    claim: `${relation.subject_id} ${relation.predicate} ${relation.object_id}`,
    claim_type: "relation",
    subject_id: relation.subject_id,
    predicate: relation.predicate,
    object_id: relation.object_id,
    confidence: relation.confidence,
    evidence_frames: relation.evidence_frames
  });
  for (const movement of movements) claims.push({
    claim: `${movement.subject_id} moved ${movement.direction}`,
    claim_type: "movement",
    subject_id: movement.subject_id,
    predicate: movement.direction,
    object_id: null,
    confidence: movement.confidence,
    evidence_frames: movement.evidence_frames
  });
  for (const interaction of interactions) claims.push({
    claim: `${interaction.hand_id || interaction.object_id} ${interaction.predicate} ${interaction.hand_id ? interaction.object_id : ""}`.trim(),
    claim_type: "interaction",
    subject_id: interaction.hand_id || interaction.object_id,
    predicate: interaction.predicate,
    object_id: interaction.hand_id ? interaction.object_id : null,
    confidence: interaction.confidence,
    evidence_frames: interaction.evidence_frames
  });
  return dedupeClaims(claims);
}

export function associateEvidenceFrames(claims = []) {
  const byFrame = new Map();
  for (const claim of claims) {
    for (const frameIndex of claim.evidence_frames || []) {
      const entry = byFrame.get(frameIndex) || { frame_index: frameIndex, object_ids: new Set(), supports: [] };
      if (claim.subject_id) entry.object_ids.add(claim.subject_id);
      if (claim.object_id) entry.object_ids.add(claim.object_id);
      if (!entry.supports.includes(claim.predicate)) entry.supports.push(claim.predicate);
      byFrame.set(frameIndex, entry);
    }
  }
  return [...byFrame.values()].sort((a, b) => a.frame_index - b.frame_index).map((entry) => ({
    frame_index: entry.frame_index,
    object_ids: [...entry.object_ids],
    supports: entry.supports
  }));
}

export function aggregateSpatialConfidence(claims = []) {
  const values = claims.map((claim) => clamp01(claim.confidence)).filter((value) => value > 0);
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

export function detectSpatialContradictions(claims = []) {
  const contradictions = [];
  for (let index = 0; index < claims.length; index += 1) {
    const first = claims[index];
    for (let nextIndex = index + 1; nextIndex < claims.length; nextIndex += 1) {
      const second = claims[nextIndex];
      if (first.subject_id !== second.subject_id || first.object_id !== second.object_id) continue;
      if (INVERSE_RELATIONS[first.predicate] !== second.predicate) continue;
      contradictions.push({
        subject_id: first.subject_id,
        object_id: first.object_id,
        predicates: [first.predicate, second.predicate],
        evidence_frames: [...new Set([...(first.evidence_frames || []), ...(second.evidence_frames || [])])]
      });
    }
  }
  return contradictions;
}

function trackWindow(observations, previousScene, threshold) {
  const previousObjects = Array.isArray(previousScene?.objects) ? previousScene.objects : [];
  let nextObjectNumber = Math.max(0, ...previousObjects.map((object) => Number(String(object.id || "").match(/object_(\d+)/)?.[1] || 0))) + 1;
  let priorFrame = previousObjects.map(normalizePreviousObject).filter(Boolean);
  const trackHintIds = new Map();
  return observations.map((observation, frameIndex) => {
    const objects = [];
    const usedPriorIds = new Set();
    for (const raw of Array.isArray(observation?.objects) ? observation.objects.slice(0, SPATIAL_LIMITS.maxObjects) : []) {
      const object = normalizeEntity(raw, frameIndex, "object");
      if (!object || object.confidence < threshold * 0.55) continue;
      const trackHint = sanitizeIdentifier(raw.id || raw.track_id || raw.track_hint);
      const hintedId = trackHintIds.get(trackHint);
      const match = hintedId
        ? priorFrame.find((candidate) => candidate.id === hintedId)
        : nearestLabelMatch(object, priorFrame, usedPriorIds);
      object.id = match?.id || hintedId || `object_${nextObjectNumber++}`;
      if (trackHint) trackHintIds.set(trackHint, object.id);
      object.first_seen = Number(match?.first_seen ?? frameIndex);
      object.last_seen = frameIndex;
      usedPriorIds.add(object.id);
      objects.push(object);
    }
    priorFrame = objects;
    const hands = (Array.isArray(observation?.hands) ? observation.hands : []).slice(0, 4).map((raw, handIndex) => {
      const hand = normalizeEntity(raw, frameIndex, "hand");
      if (!hand) return null;
      const handedness = sanitizeIdentifier(raw.handedness || raw.label);
      hand.id = handedness.includes("right") ? "right_hand" : handedness.includes("left") ? "left_hand" : `hand_${handIndex + 1}`;
      hand.handedness = handedness || "unknown";
      return hand;
    }).filter(Boolean);
    return { frame_index: frameIndex, objects, hands };
  });
}

async function resolveObservations(frames, validation, options) {
  if (typeof options.observationProvider === "function") {
    const result = await options.observationProvider({
      frames,
      timestamps: validation.timestamps,
      query: validation.query,
      mode: validation.mode,
      signal: options.signal
    });
    return Array.isArray(result) ? result : result?.frame_observations;
  }
  if (frames.every((frame) => frame?.observations && typeof frame.observations === "object")) {
    return frames.map((frame) => frame.observations);
  }
  throw new Error("spatial observation provider unavailable");
}

function normalizePreviousObject(raw) {
  if (!raw?.id || !Array.isArray(raw.bbox)) return null;
  return normalizeEntity(raw, Number(raw.last_seen || 0), "object", raw.id);
}

function normalizeEntity(raw = {}, frameIndex = 0, type = "object", id = "") {
  const bbox = normalizeBbox(raw.bbox);
  if (!bbox) return null;
  const center = Array.isArray(raw.center) && raw.center.length === 2
    ? [clamp01(raw.center[0]), clamp01(raw.center[1])]
    : [round((bbox[0] + bbox[2]) / 2), round((bbox[1] + bbox[3]) / 2)];
  return {
    id: id || sanitizeIdentifier(raw.id || raw.track_id || raw.track_hint),
    label: sanitizeText(raw.label || (type === "hand" ? "hand" : "unknown object"), 80) || "unknown object",
    bbox,
    center,
    relative_depth: clamp01(raw.relative_depth ?? raw.depth ?? 0.5),
    confidence: clamp01(raw.confidence ?? 0),
    appearance: sanitizeText(raw.appearance || raw.description, 180),
    missing_evidence: (Array.isArray(raw.missing_evidence) ? raw.missing_evidence : []).map((item) => sanitizeIdentifier(item)).filter(Boolean).slice(0, 6),
    first_seen: frameIndex,
    last_seen: frameIndex
  };
}

function nearestLabelMatch(object, candidates, usedIds) {
  return candidates
    .filter((candidate) => !usedIds.has(candidate.id) && candidate.label.toLowerCase() === object.label.toLowerCase())
    .map((candidate) => ({ candidate, distance: centerDistance(object, candidate) }))
    .filter((item) => item.distance <= 0.35)
    .sort((a, b) => a.distance - b.distance)[0]?.candidate || null;
}

function metricEstimates(objects, calibration) {
  const valid = validMetricCalibration(calibration);
  if (!valid) return { scale: { type: "relative", unit: null, confidence: aggregateObjectConfidence(objects) }, estimates: [] };
  const estimates = [];
  for (let firstIndex = 0; firstIndex < objects.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < objects.length; secondIndex += 1) {
      const first = objects[firstIndex];
      const second = objects[secondIndex];
      estimates.push({
        subject_id: first.id,
        object_id: second.id,
        distance: round(centerDistance(first, second) * valid.unitsPerNormalized, 2),
        unit: valid.unit,
        confidence: round(Math.min(first.confidence, second.confidence, valid.confidence)),
        calibration_evidence: valid.evidence,
        approximate: true
      });
    }
  }
  return { scale: { type: "metric", unit: valid.unit, confidence: valid.confidence }, estimates };
}

function validMetricCalibration(calibration) {
  if (!calibration || calibration.verified !== true) return null;
  if (!["cm", "m"].includes(calibration.unit)) return null;
  const unitsPerNormalized = Number(calibration.units_per_normalized ?? calibration.unitsPerNormalized);
  const confidence = clamp01(calibration.confidence);
  const evidence = sanitizeText(calibration.evidence || calibration.procedure, 160);
  if (!Number.isFinite(unitsPerNormalized) || unitsPerNormalized <= 0 || confidence < 0.7 || !evidence) return null;
  return { unit: calibration.unit, unitsPerNormalized, confidence, evidence };
}

function partialEvidence(finalFrame, previousScene) {
  const uncertain = finalFrame.objects.find((object) => object.confidence < 0.6 || /unknown|object$/i.test(object.label));
  if (!uncertain) return { partial_observation: null, uncertainty: { level: "low", missing_evidence: [], suggested_view: null } };
  const missing = uncertain.missing_evidence.length ? uncertain.missing_evidence : ["object_identity"];
  const appearance = uncertain.appearance || "An object with partially visible features";
  const suggested = suggestedViewFor(missing[0]);
  const evidenceSignature = `${uncertain.id}:${uncertain.label}:${missing.join(",")}`;
  const repeated = previousScene?.last_suggested_view === suggested && previousScene?.evidence_signature === evidenceSignature;
  return {
    partial_observation: `${appearance.replace(/[.!?]+$/, "")} is visible ${relativePositionPhrase(uncertain.center)}.`,
    uncertainty: {
      level: "high",
      missing_evidence: missing,
      suggested_view: repeated ? null : suggested,
      evidence_signature: evidenceSignature
    }
  };
}

function suggestedViewFor(missing) {
  const views = {
    front_surface: "Rotate the object slightly so its front surface is visible.",
    controls: "Tilt the object so its controls are visible.",
    object_identity: "Hold the object steady and show one distinctive side.",
    depth_separation: "Shift the camera slightly sideways to separate the objects in depth.",
    lower_edge: "Raise the object slightly so its lower edge is visible."
  };
  return views[missing] || "Move the camera slightly so the hidden side becomes visible.";
}

function relativePositionPhrase(center) {
  const horizontal = center[0] < 0.4 ? "on the left" : center[0] > 0.6 ? "on the right" : "near the center";
  return ` ${horizontal} side of the frame`;
}

function addRelation(list, subject, predicate, object, confidence, frameIndex) {
  if (!SPATIAL_RELATIONS.includes(predicate)) return;
  list.push({ subject_id: subject.id, predicate, object_id: object.id, confidence: round(confidence), evidence_frames: [frameIndex] });
}

function addSymmetric(list, first, predicate, second, confidence, frameIndex) {
  addRelation(list, first, predicate, second, confidence, frameIndex);
  addRelation(list, second, predicate, first, confidence, frameIndex);
}

function addMovement(list, subject, direction, fromFrame, toFrame, confidence, evidenceFrames) {
  if (!SPATIAL_DIRECTIONS.includes(direction)) return;
  list.push({ subject_id: subject.id, direction, from_frame: fromFrame, to_frame: toFrame, confidence: round(confidence), evidence_frames: evidenceFrames });
}

function addInteraction(list, handId, predicate, objectId, confidence, evidenceFrames) {
  if (!SPATIAL_INTERACTIONS.includes(predicate)) return;
  list.push({ hand_id: handId, predicate, object_id: objectId, confidence: round(confidence), evidence_frames: evidenceFrames });
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map(clamp01);
  if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) return null;
  return bbox.map((item) => round(item));
}

function centerDistance(first, second) {
  return Math.hypot(first.center[0] - second.center[0], first.center[1] - second.center[1]);
}

function intersectionOverUnion(first, second) {
  const width = Math.max(0, Math.min(first[2], second[2]) - Math.max(first[0], second[0]));
  const height = Math.max(0, Math.min(first[3], second[3]) - Math.max(first[1], second[1]));
  const intersection = width * height;
  const firstArea = (first[2] - first[0]) * (first[3] - first[1]);
  const secondArea = (second[2] - second[0]) * (second[3] - second[1]);
  return intersection / Math.max(0.000001, firstArea + secondArea - intersection);
}

function bboxInside(inner, outer) {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

function bboxGap(first, second) {
  const horizontal = Math.max(0, Math.max(first[0], second[0]) - Math.min(first[2], second[2]));
  const vertical = Math.max(0, Math.max(first[1], second[1]) - Math.min(first[3], second[3]));
  return Math.hypot(horizontal, vertical);
}

function confidenceForDelta(confidence, delta) {
  return Math.min(confidence, 0.6 + Math.min(0.38, delta));
}

function aggregateObjectConfidence(objects) {
  if (!objects.length) return 0;
  return round(objects.reduce((sum, object) => sum + object.confidence, 0) / objects.length);
}

function dedupeClaims(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.claim_type || ""}:${value.subject_id || value.hand_id || ""}:${value.predicate || value.direction || ""}:${value.object_id || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampThreshold(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(0.95, Math.max(0.35, number)) : DEFAULT_THRESHOLD;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}
