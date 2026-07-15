import {
  DEFAULT_TRAJECTORY_OPTIONS,
  bboxPolygonOverlap,
  classifyStroke,
  detectClosedLasso,
  extractStrokeFeatures,
  filterTrajectory,
  mapTrajectoryToViewport,
  mapViewportPolygonToSourceFrame,
  pointInPolygon,
  polygonIoU,
  processTrajectory,
  ramerDouglasPeucker
} from "./neural-field-stroke.js";

export {
  DEFAULT_TRAJECTORY_OPTIONS,
  bboxPolygonOverlap,
  classifyStroke,
  detectClosedLasso,
  extractStrokeFeatures,
  filterTrajectory,
  mapTrajectoryToViewport,
  mapViewportPolygonToSourceFrame,
  pointInPolygon,
  polygonIoU,
  processTrajectory,
  ramerDouglasPeucker
};

const EPSILON = 1e-7;
const PALM_INDICES = Object.freeze([0, 5, 9, 13, 17]);

export function createHandGeometryTracker(options = {}) {
  const previousHands = new Map();
  let lastTimestamp = -Infinity;
  let disposed = false;

  function process(result = {}, metadata = {}) {
    const timestamp = finite(metadata.timestamp ?? metadata.timestampMs, lastTimestamp + 1);
    const frameWidth = positive(metadata.frameWidth, 1);
    const frameHeight = positive(metadata.frameHeight, 1);
    const mirrored = metadata.mirrored === true;
    if (disposed || timestamp <= lastTimestamp) {
      return { type: "hand_frame", timestamp, hands: [], frameWidth, frameHeight, mirrored, stale: true };
    }
    lastTimestamp = timestamp;
    const landmarkGroups = array(result.landmarks ?? result.handLandmarks).slice(0, 2);
    const worldGroups = array(result.worldLandmarks ?? result.handWorldLandmarks).slice(0, 2);
    const handednessGroups = array(result.handedness ?? result.handednesses).slice(0, 2);
    const descriptors = landmarkGroups.map((group, index) => {
      const category = firstCategory(handednessGroups[index]);
      return { group, index, category, handedness: normalizeHandedness(category?.categoryName ?? category?.displayName ?? category?.label) };
    });
    const handednessTotals = descriptors.reduce((counts, descriptor) => ({ ...counts, [descriptor.handedness]: (counts[descriptor.handedness] || 0) + 1 }), {});
    const handednessOccurrences = {};
    const hands = descriptors.map(({ group, index, category, handedness }) => {
      const occurrence = handednessOccurrences[handedness] || 0;
      handednessOccurrences[handedness] = occurrence + 1;
      return normalizeHand({
        landmarks: group,
        worldLandmarks: worldGroups[index],
        category,
        handedness,
        trackingKey: handednessTotals[handedness] === 1 ? handedness : `${handedness}:${occurrence}`,
        timestamp,
        frameWidth,
        frameHeight,
        previousHands,
        minimumConfidence: finite(options.minimumConfidence, 0)
      });
    }).filter(Boolean);
    hands.sort((first, second) => first.handedness.localeCompare(second.handedness) || first.palmCenter.x - second.palmCenter.x);
    const seen = new Set(hands.map((hand) => hand.trackingKey));
    for (const [key, state] of previousHands) {
      if (!seen.has(key) && timestamp - state.timestamp > finite(options.stateRetentionMs, 500)) previousHands.delete(key);
    }
    return {
      type: "hand_frame",
      timestamp,
      frameWidth,
      frameHeight,
      mirrored,
      coordinateSpace: "source_normalized",
      hands: hands.map(({ trackingKey, ...hand }) => hand),
      containsRawMedia: false
    };
  }

  function reset() {
    previousHands.clear();
    lastTimestamp = -Infinity;
  }

  function dispose() {
    reset();
    disposed = true;
  }

  return { process, processFrame: process, normalize: process, normalizeFrame: process, reset, dispose };
}

function normalizeHand({ landmarks: rawLandmarks, worldLandmarks: rawWorld, category, handedness, trackingKey, timestamp, frameWidth, frameHeight, previousHands, minimumConfidence }) {
  const landmarks = array(rawLandmarks).slice(0, 21).map(normalizeLandmark);
  if (landmarks.length < 21) return null;
  const worldLandmarks = array(rawWorld).slice(0, 21).map(normalizeLandmark);
  const landmarkConfidence = mean(landmarks.map((point) => Math.min(point.visibility, point.presence)));
  const confidence = clamp(category ? mean([finite(category.score ?? category.confidence, 1), landmarkConfidence]) : landmarkConfidence, 0, 1);
  if (confidence < minimumConfidence) return null;
  const wrist = copyPoint(landmarks[0]);
  const thumbTip = copyPoint(landmarks[4]);
  const indexTip = copyPoint(landmarks[8]);
  const middleTip = copyPoint(landmarks[12]);
  const palmCenter = average(PALM_INDICES.map((pointIndex) => landmarks[pointIndex]));
  const maximumDimension = Math.max(frameWidth, frameHeight, 1);
  const metricScale = { x: frameWidth / maximumDimension, y: frameHeight / maximumDimension, z: frameWidth / maximumDimension };
  const metricLandmarks = landmarks.map((point) => scalePoint(point, metricScale));
  const orientationLandmarks = worldLandmarks.length === 21 ? worldLandmarks : metricLandmarks;
  const metricPalmCenter = average(PALM_INDICES.map((pointIndex) => metricLandmarks[pointIndex]));
  const palmWidth = Math.max(EPSILON, distance3(metricLandmarks[5], metricLandmarks[17]));
  const palmNormal = normalize3(cross3(subtract3(orientationLandmarks[5], orientationLandmarks[0]), subtract3(orientationLandmarks[17], orientationLandmarks[0])));
  const wristDirection = normalize3(subtract3(orientationLandmarks[9], orientationLandmarks[0]));
  const palmOrientation = {
    yaw: Math.atan2(palmNormal.x, palmNormal.z || EPSILON),
    pitch: Math.atan2(-palmNormal.y, Math.hypot(palmNormal.x, palmNormal.z)),
    roll: Math.atan2(wristDirection.y, wristDirection.x)
  };
  const relativeDepth = metricPalmCenter.z / palmWidth;
  const metricIndexTip = metricLandmarks[8];
  const previous = previousHands.get(trackingKey);
  const dt = previous ? Math.max(0.001, (timestamp - previous.timestamp) / 1000) : 0;
  const velocity = previous ? scale3(subtract3(metricIndexTip, previous.indexTip), 1 / dt) : vectorWithMagnitude({ x: 0, y: 0, z: 0 });
  const acceleration = previous ? scale3(subtract3(velocity, previous.velocity), 1 / dt) : vectorWithMagnitude({ x: 0, y: 0, z: 0 });
  const angularVelocity = previous ? normalizeAngle(palmOrientation.roll - previous.roll) / dt : 0;
  const hand = {
    trackingKey,
    handedness,
    confidence,
    landmarks,
    worldLandmarks,
    thumbTip,
    indexTip,
    middleTip,
    wrist,
    palmCenter,
    palmWidth,
    palmNormal,
    wristDirection,
    palmOrientation,
    relativeDepth,
    velocity: vectorWithMagnitude(velocity),
    acceleration: vectorWithMagnitude(acceleration),
    angularVelocity,
    frameWidth,
    frameHeight,
    metricScale,
    coordinateSpace: "source_normalized"
  };
  previousHands.set(trackingKey, { timestamp, indexTip: metricIndexTip, velocity: hand.velocity, roll: palmOrientation.roll, palmCenter });
  return hand;
}

export function createPinchDetector(options = {}) {
  const config = {
    startThreshold: 0.32,
    releaseThreshold: 0.46,
    minimumConfidence: 0.6,
    minimumStableFrames: 2,
    debounceMs: 30,
    missingHandGraceMs: 90,
    maximumOcclusionMs: 240,
    dominantHand: "auto",
    ...options
  };
  if (!(config.startThreshold < config.releaseThreshold)) throw new Error("Pinch start threshold must be below release threshold.");
  let active = false;
  let activeHandedness = null;
  let candidateFrames = 0;
  let candidateSince = null;
  let candidateHandedness = null;
  let releaseFrames = 0;
  let releaseSince = null;
  let lastSeenTimestamp = null;
  let lastTimestamp = -Infinity;

  function update(frame = {}) {
    const timestamp = finite(frame.timestamp, lastTimestamp + 1);
    if (timestamp <= lastTimestamp) return [];
    lastTimestamp = timestamp;
    const hand = selectHand(frame.hands, active ? activeHandedness : config.dominantHand, config.minimumConfidence);
    if (!hand) return updateMissing(timestamp);
    if (active && lastSeenTimestamp != null && timestamp - lastSeenTimestamp > config.maximumOcclusionMs) {
      const event = {
        type: "pinch_cancelled",
        timestamp,
        handedness: activeHandedness,
        confidence: 0,
        pinchDistance: null,
        reason: "hand_occluded"
      };
      clearActive();
      return [event];
    }
    lastSeenTimestamp = timestamp;
    const pinchDistance = metricDistance(hand.indexTip, hand.thumbTip, hand.metricScale) / Math.max(EPSILON, finite(hand.palmWidth, EPSILON));
    const base = { timestamp, handedness: hand.handedness, confidence: hand.confidence, pinchDistance, hand };

    if (!active) {
      if (pinchDistance < config.startThreshold) {
        if (candidateHandedness !== hand.handedness) {
          candidateFrames = 0;
          candidateSince = null;
          candidateHandedness = hand.handedness;
        }
        candidateFrames += 1;
        candidateSince ??= timestamp;
        const stable = candidateFrames >= config.minimumStableFrames && timestamp - candidateSince >= config.debounceMs;
        if (stable) {
          active = true;
          activeHandedness = hand.handedness;
          candidateFrames = 0;
          candidateSince = null;
          candidateHandedness = null;
          releaseFrames = 0;
          return [{ type: "pinch_started", ...base }];
        }
      } else {
        candidateFrames = 0;
        candidateSince = null;
        candidateHandedness = null;
      }
      return [];
    }

    if (hand.handedness !== activeHandedness) return updateMissing(timestamp);
    if (pinchDistance > config.releaseThreshold) {
      releaseFrames += 1;
      releaseSince ??= timestamp;
      const released = releaseFrames >= config.minimumStableFrames && timestamp - releaseSince >= config.debounceMs;
      if (released) {
        const event = { type: "pinch_ended", ...base };
        clearActive();
        return [event];
      }
      return [];
    }
    releaseFrames = 0;
    releaseSince = null;
    return [{ type: "pinch_updated", ...base }];
  }

  function updateMissing(timestamp) {
    if (!active) {
      candidateFrames = 0;
      candidateSince = null;
      candidateHandedness = null;
      return [];
    }
    const missingFor = lastSeenTimestamp == null ? Infinity : timestamp - lastSeenTimestamp;
    if (missingFor <= config.missingHandGraceMs) return [];
    if (missingFor <= config.maximumOcclusionMs) return [];
    const event = {
      type: "pinch_cancelled",
      timestamp,
      handedness: activeHandedness,
      confidence: 0,
      pinchDistance: null,
      reason: "hand_occluded"
    };
    clearActive();
    return [event];
  }

  function clearActive() {
    active = false;
    activeHandedness = null;
    candidateFrames = 0;
    candidateSince = null;
    candidateHandedness = null;
    releaseFrames = 0;
    releaseSince = null;
    lastSeenTimestamp = null;
  }

  function reset(reason = "reset", timestamp = lastTimestamp) {
    const event = active ? { type: "pinch_cancelled", timestamp, handedness: activeHandedness, confidence: 0, pinchDistance: null, reason } : null;
    clearActive();
    lastTimestamp = -Infinity;
    return event ? [event] : [];
  }

  return {
    update,
    process: update,
    reset,
    setDominantHand(value) { config.dominantHand = normalizeDominantHand(value); },
    getState() { return { active, activeHandedness, candidateFrames, releaseFrames, lastSeenTimestamp }; }
  };
}

export function createNeuralFieldPerceptionPipeline(options = {}) {
  const config = {
    minimumPointDistance: 0.003,
    maximumPointCount: 512,
    maximumDurationMs: 8000,
    minimumDurationMs: 100,
    minimumPathLength: 0.03,
    minimumPointCount: 3,
    maximumGapMs: 80,
    maximumOcclusionGapMs: 220,
    maximumInterpolationDistance: 0.14,
    ...options.stroke
  };
  const pinch = createPinchDetector(options.pinch);
  let activeStroke = null;
  let strokeSequence = 0;

  function processFrame(frame = {}) {
    const pinchEvents = pinch.update(frame);
    const events = [...pinchEvents];
    for (const event of pinchEvents) {
      if (event.type === "pinch_started") startStroke(event, events);
      else if (event.type === "pinch_updated") updateStroke(event, events);
      else if (event.type === "pinch_ended") endStroke(event, events);
      else if (event.type === "pinch_cancelled") cancelStroke(event.reason || "pinch_cancelled", event.timestamp, events);
    }
    if (activeStroke && finite(frame.timestamp) - activeStroke.startedAt > config.maximumDurationMs) {
      cancelStroke("maximum_duration", frame.timestamp, events);
    }
    return { events, activeStroke: publicStroke(activeStroke), pinchState: pinch.getState() };
  }

  function startStroke(event, events) {
    if (activeStroke) cancelStroke("replaced_active_stroke", event.timestamp, events);
    const point = trajectoryPoint(event);
    activeStroke = { id: `stroke_${++strokeSequence}`, startedAt: event.timestamp, handedness: event.handedness, points: point ? [point] : [] };
    events.push({ type: "stroke_started", timestamp: event.timestamp, strokeId: activeStroke.id, handedness: event.handedness });
  }

  function updateStroke(event, events) {
    if (!activeStroke || event.handedness !== activeStroke.handedness) return;
    const point = trajectoryPoint(event);
    if (!point) return;
    const previous = activeStroke.points.at(-1);
    if (previous && point.timestamp <= previous.timestamp) return;
    if (previous) {
      const gap = point.timestamp - previous.timestamp;
      const jump = distance3(point, previous);
      if (gap > config.maximumOcclusionGapMs || (gap > config.maximumGapMs && jump > config.maximumInterpolationDistance)) {
        cancelStroke("trajectory_gap", event.timestamp, events);
        return;
      }
      if (jump < config.minimumPointDistance && gap <= config.maximumGapMs) return;
    }
    if (activeStroke.points.length >= config.maximumPointCount) {
      cancelStroke("maximum_points", event.timestamp, events);
      return;
    }
    activeStroke.points.push(point);
    events.push({ type: "stroke_updated", timestamp: event.timestamp, strokeId: activeStroke.id, pointCount: activeStroke.points.length });
  }

  function endStroke(event, events) {
    if (!activeStroke) return;
    updateStroke(event, events);
    if (!activeStroke) return;
    const stroke = activeStroke;
    activeStroke = null;
    const duration = event.timestamp - stroke.startedAt;
    const length = pathLength(stroke.points);
    if (duration < config.minimumDurationMs || stroke.points.length < config.minimumPointCount || length < config.minimumPathLength) {
      events.push({
        type: "stroke_cancelled",
        timestamp: event.timestamp,
        strokeId: stroke.id,
        reason: duration < config.minimumDurationMs ? "minimum_duration" : stroke.points.length < config.minimumPointCount ? "insufficient_points" : "minimum_path_length",
        rawPoints: stroke.points
      });
      return;
    }
    const result = processTrajectory(stroke.points, {
      ...options.trajectory,
      maximumInterpolationGapMs: config.maximumOcclusionGapMs,
      maximumInterpolationDistance: config.maximumInterpolationDistance,
      lasso: options.lasso
    });
    events.push({
      type: "stroke_completed",
      timestamp: event.timestamp,
      strokeId: stroke.id,
      handedness: stroke.handedness,
      ...result
    });
  }

  function cancelStroke(reason, timestamp, events) {
    if (!activeStroke) return;
    const stroke = activeStroke;
    activeStroke = null;
    events.push({ type: "stroke_cancelled", timestamp, strokeId: stroke.id, reason, rawPoints: stroke.points });
  }

  function reset(reason = "reset", timestamp = 0) {
    const events = pinch.reset(reason, timestamp);
    if (activeStroke) cancelStroke(reason, timestamp, events);
    return events;
  }

  return { processFrame, process: processFrame, reset, getState: () => ({ activeStroke: publicStroke(activeStroke), pinch: pinch.getState() }) };
}

function trajectoryPoint(event) {
  const hand = event.hand;
  if (!hand?.indexTip) return null;
  const palmWidth = Math.max(EPSILON, finite(hand.palmWidth, EPSILON));
  return {
    x: finite(hand.indexTip.x),
    y: finite(hand.indexTip.y),
    z: finite(hand.relativeDepth) + (finite(hand.indexTip.z) - finite(hand.palmCenter?.z)) * finite(hand.metricScale?.z, 1) / palmWidth,
    timestamp: finite(event.timestamp),
    confidence: clamp(finite(hand.confidence), 0, 1),
    velocity: Math.max(0, finite(hand.velocity?.magnitude)),
    metricScaleX: finite(hand.metricScale?.x, 1),
    metricScaleY: finite(hand.metricScale?.y, 1),
    metricScaleZ: finite(hand.metricScale?.z, 1)
  };
}

function selectHand(hands, preference, minimumConfidence) {
  const candidates = array(hands).filter((hand) => finite(hand?.confidence) >= minimumConfidence && hand?.indexTip && hand?.thumbTip && finite(hand?.palmWidth) > EPSILON);
  if (!candidates.length) return null;
  const normalized = normalizeDominantHand(preference);
  if (normalized !== "auto") return candidates.filter((hand) => hand.handedness === normalized).sort((a, b) => b.confidence - a.confidence)[0] || null;
  return candidates.sort((a, b) => b.confidence - a.confidence)[0];
}

function firstCategory(group) {
  if (Array.isArray(group)) return group[0] || null;
  if (Array.isArray(group?.categories)) return group.categories[0] || null;
  return group || null;
}

function normalizeLandmark(point = {}) {
  return {
    x: finite(point.x),
    y: finite(point.y),
    z: finite(point.z),
    visibility: clamp(finite(point.visibility, 1), 0, 1),
    presence: clamp(finite(point.presence, 1), 0, 1)
  };
}

function normalizeHandedness(value) {
  return String(value || "").trim().toLowerCase() === "left" ? "left" : "right";
}

function normalizeDominantHand(value) {
  const normalized = String(value || "auto").toLowerCase();
  return normalized === "left" || normalized === "right" ? normalized : "auto";
}

function publicStroke(stroke) {
  return stroke ? { id: stroke.id, startedAt: stroke.startedAt, handedness: stroke.handedness, pointCount: stroke.points.length } : null;
}

function vectorWithMagnitude(vector) {
  return { x: finite(vector.x), y: finite(vector.y), z: finite(vector.z), magnitude: Math.hypot(finite(vector.x), finite(vector.y), finite(vector.z)) };
}

function average(points) {
  return { x: mean(points.map((point) => point.x)), y: mean(points.map((point) => point.y)), z: mean(points.map((point) => point.z)) };
}

function cross3(first, second) {
  return { x: first.y * second.z - first.z * second.y, y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x };
}

function normalize3(vector) {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  return magnitude > EPSILON ? { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude } : { x: 0, y: 0, z: 1 };
}

function subtract3(first, second) { return { x: finite(first?.x) - finite(second?.x), y: finite(first?.y) - finite(second?.y), z: finite(first?.z) - finite(second?.z) }; }
function scale3(vector, scale) { return vectorWithMagnitude({ x: vector.x * scale, y: vector.y * scale, z: vector.z * scale }); }
function copyPoint(point) { return { ...point }; }
function scalePoint(point, scale) { return { x: finite(point?.x) * scale.x, y: finite(point?.y) * scale.y, z: finite(point?.z) * scale.z }; }
function metricDistance(first, second, scale = {}) { return Math.hypot((finite(first?.x) - finite(second?.x)) * finite(scale.x, 1), (finite(first?.y) - finite(second?.y)) * finite(scale.y, 1), (finite(first?.z) - finite(second?.z)) * finite(scale.z, 1)); }
function distance3(first, second) { return Math.hypot(finite(first?.x) - finite(second?.x), finite(first?.y) - finite(second?.y), finite(first?.z) - finite(second?.z)); }
function pathLength(points) { let length = 0; for (let index = 1; index < points.length; index += 1) length += distance3(points[index], points[index - 1]); return length; }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + finite(value), 0) / values.length : 0; }
function array(value) { return Array.isArray(value) ? value : []; }
function positive(value, fallback) { const number = finite(value, fallback); return number > 0 ? number : fallback; }
function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function normalizeAngle(value) { return Math.atan2(Math.sin(value), Math.cos(value)); }
