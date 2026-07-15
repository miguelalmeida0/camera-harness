const FRAME_MS = 1000 / 30;
const PINCH_DISTANCE = 0.018;
const OPEN_DISTANCE = 0.09;

export const LANDMARK_FIXTURES = deepFreeze({
  no_hand: fixture("no_hand", emptyFrames(4)),
  left_hand: fixture("left_hand", [handFrame([0.34, 0.55], { handedness: "left" })]),
  right_hand: fixture("right_hand", [handFrame([0.66, 0.55])]),
  two_hands: fixture("two_hands", [twoHandFrame([0.3, 0.55], [0.7, 0.55])]),
  stable_pinch: fixture("stable_pinch", pointsToFrames([[0.7, 0.5], [0.702, 0.501], [0.701, 0.499]], { pinch: true })),
  pinch_flicker: fixture("pinch_flicker", [
    handFrame([0.45, 0.5], { pinch: true, frameIndex: 0 }),
    handFrame([0.46, 0.5], { pinch: false, frameIndex: 1 }),
    handFrame([0.47, 0.5], { pinch: true, frameIndex: 2 }),
    handFrame([0.48, 0.5], { pinch: false, frameIndex: 3 })
  ]),
  release: fixture("release", [handFrame([0.5, 0.5], { pinch: false })]),
  temporary_occlusion: fixture("temporary_occlusion", [
    handFrame([0.42, 0.5], { pinch: true, frameIndex: 0 }),
    emptyFrame(1),
    emptyFrame(2),
    handFrame([0.46, 0.5], { pinch: true, frameIndex: 3 })
  ]),
  long_occlusion: fixture("long_occlusion", [handFrame([0.42, 0.5], { pinch: true }), ...emptyFrames(12, 1)]),
  slow_circle: fixture("slow_circle", pointsToFrames(ellipsePoints(0.5, 0.5, 0.2, 0.2, 32), { pinch: true })),
  fast_circle: fixture("fast_circle", pointsToFrames(ellipsePoints(0.5, 0.5, 0.2, 0.2, 12), { pinch: true })),
  ellipse: fixture("ellipse", pointsToFrames(ellipsePoints(0.5, 0.5, 0.24, 0.13, 28), { pinch: true })),
  rectangle: fixture("rectangle", pointsToFrames(polyline([[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7], [0.3, 0.3]], 6), { pinch: true })),
  triangle: fixture("triangle", pointsToFrames(polyline([[0.5, 0.24], [0.74, 0.7], [0.26, 0.7], [0.5, 0.24]], 8), { pinch: true })),
  arrow: fixture("arrow", pointsToFrames(polyline([[0.25, 0.5], [0.72, 0.5], [0.58, 0.38], [0.72, 0.5], [0.58, 0.62]], 5), { pinch: true })),
  letter_a: fixture("letter_a", pointsToFrames(polyline([[0.3, 0.72], [0.5, 0.28], [0.7, 0.72], [0.61, 0.53], [0.39, 0.53]], 5), { pinch: true })),
  letter_i: fixture("letter_i", pointsToFrames(polyline([[0.35, 0.3], [0.65, 0.3], [0.5, 0.3], [0.5, 0.7], [0.35, 0.7], [0.65, 0.7]], 4), { pinch: true })),
  letters_a_and_i: fixture("letters_a_and_i", pointsToFrames(polyline([[0.18, 0.72], [0.32, 0.28], [0.46, 0.72], [0.4, 0.53], [0.24, 0.53], [0.62, 0.3], [0.82, 0.3], [0.72, 0.3], [0.72, 0.7], [0.62, 0.7], [0.82, 0.7]], 3), { pinch: true })),
  open_lasso: fixture("open_lasso", committedLasso([[0.22, 0.3], [0.22, 0.7], [0.55, 0.7], [0.65, 0.45]])),
  valid_lasso_around_one_object: fixture("valid_lasso_around_one_object", committedLasso(ellipsePoints(0.3, 0.5, 0.19, 0.25, 24))),
  valid_lasso_around_two_objects: fixture("valid_lasso_around_two_objects", committedLasso(ellipsePoints(0.5, 0.5, 0.43, 0.34, 28))),
  tiny_lasso: fixture("tiny_lasso", committedLasso(ellipsePoints(0.3, 0.5, 0.012, 0.012, 10))),
  self_intersecting_lasso: fixture("self_intersecting_lasso", committedLasso(polyline([[0.2, 0.25], [0.75, 0.72], [0.2, 0.72], [0.75, 0.25], [0.2, 0.25]], 5))),
  lasso_at_viewport_edge: fixture("lasso_at_viewport_edge", committedLasso(ellipsePoints(0.06, 0.5, 0.055, 0.22, 22))),
  lasso_on_mobile_aspect_ratio: fixture("lasso_on_mobile_aspect_ratio", committedLasso(ellipsePoints(0.5, 0.43, 0.31, 0.18, 24), { viewport: { width: 390, height: 844 } })),
  jitter: fixture("jitter", pointsToFrames([[0.35, 0.45], [0.62, 0.41], [0.39, 0.67], [0.68, 0.3], [0.31, 0.58], [0.64, 0.69]], { pinch: true })),
  low_confidence: fixture("low_confidence", pointsToFrames([[0.42, 0.5], [0.48, 0.52], [0.55, 0.54]], { pinch: true, confidence: 0.28 })),
  sudden_hand_jump: fixture("sudden_hand_jump", pointsToFrames([[0.2, 0.5], [0.23, 0.5], [0.82, 0.2], [0.84, 0.2]], { pinch: true })),
  hand_leaves_frame: fixture("hand_leaves_frame", [...pointsToFrames([[0.42, 0.5], [0.47, 0.5]], { pinch: true }), ...emptyFrames(10, 2)])
});

const mug = object("mug", "mug", { x: 0.17, y: 0.32, width: 0.24, height: 0.34 }, 0.56);
const laptop = object("laptop", "laptop", { x: 0.58, y: 0.29, width: 0.32, height: 0.38 }, 0.62);

export const SCENE_FIXTURES = deepFreeze({
  mug_and_laptop: sceneFixture("mug_and_laptop", [mug, laptop]),
  mug_left_of_laptop: sceneFixture("mug_left_of_laptop", [mug, laptop], [relation("mug", "laptop", "left_of")]),
  mug_in_front_of_laptop: sceneFixture("mug_in_front_of_laptop", [{ ...mug, depth: 0.24 }, laptop], [relation("mug", "laptop", "in_front_of")]),
  mug_moving_toward_camera: sceneFixture("mug_moving_toward_camera", [{ ...mug, motion: { dz: -0.24 }, depth: 0.2 }, laptop]),
  hand_approaching_mug: sceneFixture("hand_approaching_mug", [mug, object("right_hand", "right hand", { x: 0.47, y: 0.42, width: 0.16, height: 0.25 }, 0.3)], [], [{ type: "approaching", subjectId: "right_hand", objectId: "mug" }]),
  two_overlapping_objects: sceneFixture("two_overlapping_objects", [mug, object("bottle", "bottle", { x: 0.29, y: 0.31, width: 0.18, height: 0.4 }, 0.42)]),
  ambiguous_lasso_region: sceneFixture("ambiguous_lasso_region", [mug, object("cup", "cup", { x: 0.31, y: 0.34, width: 0.2, height: 0.31 }, 0.4)]),
  unsupported_empty_lasso: sceneFixture("unsupported_empty_lasso", []),
  object_leaves_frame: sceneFixture("object_leaves_frame", [{ ...mug, tracking: "out_of_frame", bbox: { x: 1.04, y: 0.32, width: 0.24, height: 0.34 } }, laptop]),
  object_tracking_loss: sceneFixture("object_tracking_loss", [{ ...mug, tracking: "lost", confidence: 0.2 }, laptop]),
  face_in_central_region: sceneFixture("face_in_central_region", [mug, laptop], [], [], [{ id: "face_region", bbox: { x: 0.38, y: 0.16, width: 0.24, height: 0.28 }, identity: null }]),
  low_light_hand: sceneFixture("low_light_hand", [object("right_hand", "right hand", { x: 0.42, y: 0.33, width: 0.2, height: 0.38 }, 0.4, { confidence: 0.41 })], [], [], [], { lighting: "low" }),
  cluttered_desk: sceneFixture("cluttered_desk", [mug, laptop, object("notebook", "notebook", { x: 0.38, y: 0.65, width: 0.28, height: 0.2 }, 0.58), object("pen", "pen", { x: 0.47, y: 0.58, width: 0.2, height: 0.04 }, 0.52)])
});

export const CAMERA_FIXTURES = deepFreeze(Object.fromEntries(Object.entries(SCENE_FIXTURES).map(([id, value]) => [id, {
  id,
  source: "synthetic_vector_scene",
  containsPrivateUserRecording: false,
  containsRawMedia: false,
  viewport: value.scene.viewport,
  lighting: value.scene.lighting,
  sceneId: value.scene.id
}])));

export const EXPECTED_FIXTURES = deepFreeze({
  slow_circle: { classification: "circle", confidenceAtLeast: 0.75 },
  fast_circle: { classification: "circle", confidenceAtLeast: 0.65 },
  ellipse: { classification: "ellipse", confidenceAtLeast: 0.65 },
  jitter: { classification: "uncertain_freeform", manualConfirmation: true },
  valid_lasso_around_one_object: { grounding: "mug" },
  valid_lasso_around_two_objects: { grounding: "ambiguous" },
  mug_left_of_laptop: { relation: "left_of" },
  object_leaves_frame: { anchorCleared: true }
});

export const SCENARIO_FIXTURES = deepFreeze({
  airscript: { id: "airscript_circle", returnMode: "ask", fixtureIds: ["stable_pinch", "slow_circle", "release"] },
  spatial_lasso: { id: "spatial_lasso_relation", returnMode: "watch", fixtureIds: ["mug_left_of_laptop", "valid_lasso_around_one_object", "object_leaves_frame"] },
  leak_cycle: { id: "leak_cycle", cycles: 25, modes: ["ask", "airscript", "watch", "spatial_lasso", "ask"] }
});

function fixture(id, frames) {
  return { id, synthetic: true, containsRawMedia: false, frames: frames.map((frame, index) => ({ ...frame, fixtureId: id, frameIndex: index, timestampMs: Math.round(index * FRAME_MS * 1000) / 1000 })) };
}

function handFrame(point, options = {}) {
  const pinch = options.pinch === true;
  const confidence = options.confidence ?? 0.96;
  const handedness = options.handedness || "right";
  const indexTip = { x: point[0], y: point[1], z: 0 };
  const thumbTip = { x: point[0] - (pinch ? PINCH_DISTANCE : OPEN_DISTANCE), y: point[1], z: 0 };
  const landmarks = Array.from({ length: 21 }, (_, index) => ({ index, x: point[0], y: point[1] + index * 0.0001, z: 0 }));
  landmarks[0] = { index: 0, name: "wrist", x: point[0], y: Math.min(0.98, point[1] + 0.25), z: 0 };
  landmarks[4] = { index: 4, name: "thumb_tip", ...thumbTip };
  landmarks[8] = { index: 8, name: "index_tip", ...indexTip };
  return { hands: [{ id: `hand_${handedness}`, handedness, confidence, landmarks, thumb_tip: thumbTip, index_tip: indexTip }], viewport: options.viewport || { width: 1000, height: 600 } };
}

function twoHandFrame(left, right) {
  return { hands: [...handFrame(left, { handedness: "left" }).hands, ...handFrame(right, { handedness: "right" }).hands], viewport: { width: 1000, height: 600 } };
}

function emptyFrame() {
  return { hands: [], viewport: { width: 1000, height: 600 } };
}

function emptyFrames(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({ ...emptyFrame(), frameIndex: index + offset }));
}

function pointsToFrames(points, options = {}) {
  return points.map((point) => handFrame(point, options));
}

function committedLasso(points, options = {}) {
  const frames = pointsToFrames(points, { ...options, pinch: true });
  const last = points.at(-1) || [0.5, 0.5];
  frames.push(handFrame(last, { ...options, pinch: false }));
  return frames;
}

function ellipsePoints(cx, cy, rx, ry, count) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry];
  });
}

function polyline(vertices, samplesPerSegment) {
  const points = [];
  for (let segment = 0; segment < vertices.length - 1; segment += 1) {
    const [ax, ay] = vertices[segment];
    const [bx, by] = vertices[segment + 1];
    for (let index = 0; index < samplesPerSegment; index += 1) {
      const t = index / samplesPerSegment;
      points.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  points.push(vertices.at(-1));
  return points;
}

function object(id, label, bbox, depth, extra = {}) {
  return { id, label, bbox, depth, confidence: 0.94, tracking: "tracked", ...extra };
}

function relation(subjectId, referenceId, type) {
  return { id: `${subjectId}_${type}_${referenceId}`, subjectId, referenceId, type, confidence: 0.91 };
}

function sceneFixture(id, objects, relations = [], interactions = [], faces = [], extra = {}) {
  return { id, synthetic: true, containsRawMedia: false, scene: { id, viewport: { width: 1000, height: 600 }, lighting: "normal", objects, relations, interactions, faces, ...extra } };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
