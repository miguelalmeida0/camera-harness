export const NEURAL_FIELD_TOOLS = Object.freeze(["airscript", "spatial_lasso"]);

export function assertTestOnlyActivation() {
  const nodeTest = globalThis.process?.env?.SENSEFIELD_NEURAL_FIELD_TEST === "1";
  const browserTest = typeof globalThis.location !== "undefined"
    && ["127.0.0.1", "localhost", "::1"].includes(globalThis.location.hostname)
    && globalThis.location.pathname.startsWith("/neural-field/");
  if (globalThis.__SENSEFIELD_PRODUCTION__ === true
    || globalThis.process?.env?.NODE_ENV === "production"
    || (!nodeTest && !browserTest)) {
    throw new Error("neural_field_runtime_is_test_only");
  }
}

export function createNeuralFieldStateContract() {
  return Object.freeze({
    modes: Object.freeze(["ask", "watch", "neural_field"]),
    tools: NEURAL_FIELD_TOOLS,
    validate(value) {
      return Boolean(value) && ["ask", "watch", "neural_field"].includes(value.mode)
        && typeof value.active === "boolean"
        && (value.tool === null || NEURAL_FIELD_TOOLS.includes(value.tool))
        && Number.isInteger(value.generation) && value.generation >= 0;
    }
  });
}

export function createHandWorkerContract(options = {}) {
  const startDistance = options.pinchStartDistance ?? 0.045;
  const endDistance = options.pinchEndDistance ?? 0.072;
  const minimumConfidence = options.minimumConfidence ?? 0.45;
  const maxOcclusionFrames = options.maxOcclusionFrames ?? 7;
  const maxJumpDistance = options.maxJumpDistance ?? 0.35;
  let pinched = false;
  let occlusionFrames = 0;
  let lastPointer = null;
  return {
    process(frame) {
      assertLandmarkFrame(frame);
      const hand = [...frame.hands].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
      if (!hand) {
        occlusionFrames += 1;
        const released = pinched && occlusionFrames > maxOcclusionFrames;
        if (released) pinched = false;
        return result(frame, { present: false, accepted: false, occluded: true, occlusionFrames, pointer: lastPointer, pinched, transition: released ? "pinch_end" : null, reason: released ? "long_occlusion" : "temporary_occlusion" });
      }
      occlusionFrames = 0;
      const index = hand.landmarks[8] ?? hand.index_tip;
      const thumb = hand.landmarks[4] ?? hand.thumb_tip;
      if (!index || !thumb) throw new Error("hand_worker_contract_missing_pinch_landmarks");
      const pointer = { x: Number(index.x), y: Number(index.y), z: Number(index.z ?? 0) };
      const confidence = Number(hand.confidence ?? 0);
      const inFrame = pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1;
      const suddenJump = Boolean(pinched && lastPointer && Math.hypot(pointer.x - lastPointer.x, pointer.y - lastPointer.y) > maxJumpDistance);
      const accepted = confidence >= minimumConfidence && inFrame && !suddenJump;
      const pinchDistance = Math.hypot(index.x - thumb.x, index.y - thumb.y, (index.z ?? 0) - (thumb.z ?? 0));
      const next = accepted && (pinched ? pinchDistance < endDistance : pinchDistance <= startDistance);
      const transition = next === pinched ? null : next ? "pinch_start" : "pinch_end";
      pinched = next;
      if (accepted) lastPointer = pointer;
      return result(frame, { present: inFrame, accepted, occluded: false, occlusionFrames: 0, handedness: hand.handedness ?? "unknown", confidence, pointer, pinchDistance, pinched, transition, reason: accepted ? null : suddenJump ? "sudden_hand_jump" : inFrame ? "low_confidence" : "hand_left_frame" });
    },
    reset() { pinched = false; occlusionFrames = 0; lastPointer = null; },
    snapshot() { return { pinched, occlusionFrames, lastPointer: lastPointer ? { ...lastPointer } : null }; }
  };
}

export function createPerceptionEventContract() {
  return eventContract(["hand.frame", "pinch.started", "pinch.ended", "stroke.started", "stroke.point", "stroke.committed", "gesture.classified", "lasso.started", "lasso.point", "lasso.completed", "object.grounded", "selection.ambiguous", "relation.updated", "tracking.uncertain", "tracking.lost", "anchor.cleared"]);
}

export function createRendererEventContract() {
  return eventContract(["scene.rendered", "stroke.started", "stroke.updated", "stroke.stabilized", "classification.rendered", "lasso.started", "lasso.updated", "lasso.completed", "object.grounded", "selection.ambiguous", "relation.rendered", "relation.updated", "tracking.uncertain", "tracking.lost", "anchor.cleared", "renderer.cleared"]);
}

export function createObjectGroundingContract() {
  return Object.freeze({ ground(objects, polygon) {
    const geometry = inspectPolygon(polygon);
    if (!geometry.closed) return { status: "open", candidates: [], geometry };
    if (geometry.selfIntersecting) return { status: "self_intersecting", candidates: [], geometry };
    if (geometry.area < 0.0015) return { status: "too_small", candidates: [], geometry };
    const candidates = objects.filter((object) => !["lost", "out_of_frame"].includes(object.tracking) && pointInPolygon(centerOf(object.bbox), polygon));
    return { status: candidates.length > 1 ? "ambiguous" : candidates.length === 1 ? "grounded" : "empty", candidates: candidates.map((item) => item.id), geometry };
  } });
}

export function createRelationContract() {
  return Object.freeze({ infer(subject, object) {
    if (!subject || !object || [subject.tracking, object.tracking].some((value) => ["lost", "out_of_frame"].includes(value))) return null;
    const subjectCenter = centerOf(subject.bbox);
    const objectCenter = centerOf(object.bbox);
    const depthDelta = (subject.depth ?? 0.5) - (object.depth ?? 0.5);
    const type = Math.abs(depthDelta) > 0.16 ? (depthDelta < 0 ? "in_front_of" : "behind") : subjectCenter.x <= objectCenter.x ? "left_of" : "right_of";
    return { id: `relation_${subject.id}_${type}_${object.id}`, subjectId: subject.id, objectId: object.id, referenceId: object.id, type, confidence: Math.min(subject.confidence ?? 0.8, object.confidence ?? 0.8), status: subject.tracking === "uncertain" || object.tracking === "uncertain" ? "uncertain" : "tracked", subjectCenter, objectCenter };
  } });
}

export function assertNoMediaPayload(value, path = "root", seen = new WeakSet()) {
  if (value == null) return;
  if (typeof value === "string") {
    if (/^(?:data:(?:image|video|audio)|blob:|[A-Za-z0-9+/]{512,}={0,2}$)/i.test(value)) throw new Error(`raw_media_payload_rejected:${path}`);
    if (/(?:Bearer\s+[A-Za-z0-9._~-]+|sk-[A-Za-z0-9_-]{8,}|api[_ -]?key|model[_ -]?path|\/Users\/|[A-Za-z]:\\)/i.test(value)) throw new Error(`sensitive_payload_value_rejected:${path}`);
    return;
  }
  if (typeof value !== "object") return;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || (typeof Blob !== "undefined" && value instanceof Blob)) throw new Error(`raw_media_payload_rejected:${path}`);
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (/(?:encoded[_-]?frame|raw[_-]?frame|frame[_-]?data|media[_-]?payload|audio[_-]?payload|video[_-]?payload|data[_-]?url|object[_-]?url|microphone|authorization|token|secret|api[_-]?key|model[_-]?path)/i.test(key) && item) throw new Error(`sensitive_payload_key_rejected:${path}.${key}`);
    assertNoMediaPayload(item, `${path}.${key}`, seen);
  }
}

export const cloneSafe = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function assertLandmarkFrame(frame) { if (!frame || !Array.isArray(frame.hands)) throw new Error("invalid_hand_worker_frame"); assertNoMediaPayload(frame); for (const hand of frame.hands) if (!hand || !Array.isArray(hand.landmarks) || hand.landmarks.some((item) => !item || ![item.x, item.y, item.z ?? 0].every(Number.isFinite))) throw new Error("invalid_hand_landmarks"); }
function result(frame, patch) { return { frameId: frame.id ?? null, timestampMs: Number(frame.timestampMs ?? 0), ...patch }; }
function eventContract(types) { const allowed = new Set(types); return Object.freeze({ types: Object.freeze(types), validate: (event) => Boolean(event) && allowed.has(event.type) && Number.isInteger(event.sequence) && Number.isFinite(event.timestampMs) && Number.isInteger(event.generation) && event.payload !== undefined }); }
function centerOf(box) { const b = Array.isArray(box) ? { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] } : box; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
function inspectPolygon(points) { if (!Array.isArray(points) || points.length < 3) return { closed: false, area: 0, selfIntersecting: false }; const closed = Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) <= 0.1; const area = Math.abs(points.reduce((sum, item, index) => { const next = points[(index + 1) % points.length]; return sum + item.x * next.y - next.x * item.y; }, 0)) / 2; return { closed, area, selfIntersecting: intersects(points) }; }
function intersects(points) { const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); for (let a = 0; a < points.length - 1; a += 1) for (let b = a + 2; b < points.length - 1; b += 1) if (!(a === 0 && b === points.length - 2) && cross(points[a], points[a + 1], points[b]) * cross(points[a], points[a + 1], points[b + 1]) < 0 && cross(points[b], points[b + 1], points[a]) * cross(points[b], points[b + 1], points[a + 1]) < 0) return true; return false; }
function pointInPolygon(point, polygon) { let inside = false; for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) if ((polygon[i].y > point.y) !== (polygon[j].y > point.y) && point.x < ((polygon[j].x - polygon[i].x) * (point.y - polygon[i].y)) / ((polygon[j].y - polygon[i].y) || Number.EPSILON) + polygon[i].x) inside = !inside; return inside; }
