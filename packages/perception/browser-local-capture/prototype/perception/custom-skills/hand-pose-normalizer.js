const LANDMARK_COUNT = 21;
const PALM_INDICES = [0, 5, 9, 13, 17];
const DISTANCE_PAIRS = [[4, 8], [4, 12], [4, 16], [4, 20], [8, 12], [8, 20], [5, 17], [0, 9]];

export function normalizeHandPose(input = {}) {
  const groups = landmarkGroups(input.landmarks || input.hand_landmarks || input.landmark_groups);
  const expectedHandCount = Number(input.expectedHandCount || input.hand_count || groups.length);
  if (![1, 2].includes(expectedHandCount) || groups.length !== expectedHandCount) {
    return { ok: false, code: "custom_skill_hand_count_mismatch", hand_count: groups.length, vector: null, contains_raw_media: false };
  }
  const labels = handednessLabels(input.handedness, groups.length, input.mirrored === true);
  const prepared = groups.map((group, index) => prepareHand(group, labels[index], input.mirrored === true));
  if (prepared.some((hand) => !hand)) return { ok: false, code: "custom_skill_landmarks_incomplete", hand_count: groups.length, vector: null, contains_raw_media: false };
  prepared.sort((a, b) => a.wrist.x - b.wrist.x || a.label.localeCompare(b.label));
  const vector = prepared.flatMap((hand) => hand.vector);
  if (prepared.length === 2) vector.push(...twoHandRelationship(prepared[0], prepared[1]));
  return {
    ok: true,
    code: "custom_skill_pose_normalized",
    vector: vector.map((value) => Number(value.toFixed(6))),
    hand_count: prepared.length,
    dimensions: vector.length,
    handedness: prepared.map((hand) => hand.label),
    contains_raw_media: false
  };
}

export function averagePoseVectors(vectors = []) {
  if (!vectors.length || vectors.some((vector) => !Array.isArray(vector) || vector.length !== vectors[0].length)) return null;
  return vectors[0].map((_, index) => vectors.reduce((sum, vector) => sum + Number(vector[index]), 0) / vectors.length);
}

export function medianPoseVectors(vectors = []) {
  if (!vectors.length || vectors.some((vector) => !Array.isArray(vector) || vector.length !== vectors[0].length)) return null;
  return vectors[0].map((_, index) => {
    const values = vectors.map((vector) => Number(vector[index])).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  });
}

export function poseVectorDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return Number.POSITIVE_INFINITY;
  const squareMean = a.reduce((sum, value, index) => {
    const delta = Number(value) - Number(b[index]);
    return sum + delta * delta;
  }, 0) / a.length;
  return Math.sqrt(squareMean);
}

function prepareHand(group, label, mirrored) {
  if (!Array.isArray(group) || group.length < LANDMARK_COUNT) return null;
  const points = group.slice(0, LANDMARK_COUNT).map((point) => ({
    x: mirrored ? 1 - Number(point?.x) : Number(point?.x),
    y: Number(point?.y),
    z: Number(point?.z || 0)
  }));
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z))) return null;
  const center = centroid(PALM_INDICES.map((index) => points[index]));
  const axis = { x: points[9].x - points[0].x, y: points[9].y - points[0].y };
  const angle = Math.atan2(axis.y, axis.x) + Math.PI / 2;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const scale = PALM_INDICES.slice(1).reduce((sum, index) => sum + distance3(points[0], points[index]), 0) / 4;
  if (!Number.isFinite(scale) || scale < 0.0001) return null;
  const aligned = points.map((point) => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    return { x: (x * cos - y * sin) / scale, y: (x * sin + y * cos) / scale, z: (point.z - center.z) / scale };
  });
  const distances = DISTANCE_PAIRS.map(([a, b]) => distance3(points[a], points[b]) / scale);
  return {
    label,
    wrist: points[0],
    scale,
    points,
    vector: [...aligned.flatMap((point) => [point.x, point.y, point.z]), ...distances]
  };
}

function twoHandRelationship(left, right) {
  const scale = (left.scale + right.scale) / 2;
  const dx = (right.wrist.x - left.wrist.x) / scale;
  const dy = (right.wrist.y - left.wrist.y) / scale;
  const angle = Math.atan2(dy, dx);
  return [
    dx,
    dy,
    Math.sin(angle),
    Math.cos(angle),
    distance3(left.points[4], right.points[4]) / scale,
    distance3(left.points[8], right.points[8]) / scale,
    distance3(left.points[4], right.points[8]) / scale,
    distance3(left.points[8], right.points[4]) / scale,
    distance3(left.wrist, right.wrist) / scale,
    (left.scale - right.scale) / scale
  ];
}

function landmarkGroups(value) {
  if (!Array.isArray(value) || !value.length) return [];
  return Array.isArray(value[0]) ? value.slice(0, 2) : [value];
}

function handednessLabels(value, count, mirrored) {
  const groups = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const item = Array.isArray(groups[index]) ? groups[index][0] : groups[index];
    let label = String(item?.categoryName || item?.displayName || item?.label || item || `hand_${index + 1}`).toLowerCase();
    if (mirrored && label === "left") label = "right";
    else if (mirrored && label === "right") label = "left";
    return label;
  });
}

function centroid(points) {
  return points.reduce((total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length, z: total.z + point.z / points.length }), { x: 0, y: 0, z: 0 });
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}
