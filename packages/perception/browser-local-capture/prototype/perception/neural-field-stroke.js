const EPSILON = 1e-9;

export const DEFAULT_TRAJECTORY_OPTIONS = Object.freeze({
  filter: "kalman",
  minimumConfidence: 0.55,
  maximumOutlierDistance: 0.2,
  minimumPointDistance: 0.003,
  maximumSampleGapMs: 50,
  maximumInterpolationGapMs: 180,
  maximumInterpolationDistance: 0.14,
  maximumInterpolatedPoints: 3,
  rdpEpsilon: 0.006
});

export function filterTrajectory(input = [], options = {}) {
  const config = { ...DEFAULT_TRAJECTORY_OPTIONS, ...options };
  const rawPoints = normalizePoints(input);
  const confident = rawPoints.filter((point) => point.confidence >= config.minimumConfidence);
  const accepted = rejectOutliers(confident, config.maximumOutlierDistance);
  const smoothed = smoothPoints(accepted, config);
  const resampled = minimumDistanceResample(smoothed, config.minimumPointDistance);
  const smoothedPoints = interpolateBounded(resampled, config);
  const simplifiedPoints = ramerDouglasPeucker(smoothedPoints, config.rdpEpsilon);
  return { rawPoints, smoothedPoints, simplifiedPoints };
}

export function processTrajectory(input = [], options = {}) {
  const trajectory = filterTrajectory(input, options);
  const features = extractStrokeFeatures(trajectory.smoothedPoints, {
    simplifiedPoints: trajectory.simplifiedPoints
  });
  return {
    ...trajectory,
    features,
    classification: classifyStroke(trajectory.smoothedPoints, { ...options, features, simplifiedPoints: trajectory.simplifiedPoints }),
    lasso: detectClosedLasso(trajectory.smoothedPoints, options.lasso)
  };
}

function normalizePoints(input) {
  let lastTimestamp = -Infinity;
  const result = [];
  for (const item of Array.isArray(input) ? input : []) {
    const timestamp = finite(item?.timestamp, lastTimestamp + 1);
    if (!(timestamp > lastTimestamp)) continue;
    const point = {
      x: finite(item?.x),
      y: finite(item?.y),
      z: finite(item?.z),
      timestamp,
      confidence: clamp(finite(item?.confidence, 1), 0, 1),
      velocity: Math.max(0, finite(item?.velocity)),
      metricScaleX: positiveFinite(item?.metricScaleX, 1),
      metricScaleY: positiveFinite(item?.metricScaleY, 1),
      metricScaleZ: positiveFinite(item?.metricScaleZ, 1)
    };
    if (item?.interpolated === true) point.interpolated = true;
    result.push(point);
    lastTimestamp = timestamp;
  }
  return result;
}

function rejectOutliers(points, maximumDistance) {
  if (points.length < 2) return [...points];
  const output = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = output.at(-1);
    const dt = point.timestamp - previous.timestamp;
    const jump = distance3(point, previous);
    const next = points[index + 1];
    const returnsImmediately = next && distance3(next, previous) < maximumDistance * 0.5;
    if (jump > maximumDistance && dt < 100 && (returnsImmediately || point.confidence < 0.9)) continue;
    output.push(point);
  }
  return output;
}

function smoothPoints(points, options) {
  if (points.length < 2) return [...points];
  const mode = String(options.filter || "one_euro");
  if (mode === "none") return [...points];
  let smoothed;
  if (mode === "exponential") smoothed = exponentialSmooth(points, finite(options.exponentialAlpha, 0.42));
  else if (mode === "kalman") smoothed = kalmanSmooth(points, options);
  else smoothed = oneEuroSmooth(points, options);
  return mode === "one_euro" ? preserveSharpCorners(smoothed, points) : smoothed;
}

function preserveSharpCorners(smoothed, evidence) {
  const output = smoothed.map((point) => ({ ...point }));
  for (let index = 3; index < evidence.length - 3; index += 1) {
    const incoming = subtract2(evidence[index], evidence[index - 3]);
    const outgoing = subtract2(evidence[index + 3], evidence[index]);
    const turn = Math.abs(Math.atan2(incoming.x * outgoing.y - incoming.y * outgoing.x, incoming.x * outgoing.x + incoming.y * outgoing.y));
    if (turn >= Math.PI * 0.3 && Math.hypot(incoming.x, incoming.y) >= 0.02 && Math.hypot(outgoing.x, outgoing.y) >= 0.02) {
      output[index].x = evidence[index].x;
      output[index].y = evidence[index].y;
      output[index].z = evidence[index].z;
    }
  }
  return output;
}

function exponentialSmooth(points, alpha) {
  const boundedAlpha = clamp(alpha, 0.01, 1);
  let state = { ...points[0] };
  return points.map((point, index) => {
    if (index === 0) return { ...point };
    state = {
      ...point,
      x: lerp(state.x, point.x, boundedAlpha),
      y: lerp(state.y, point.y, boundedAlpha),
      z: lerp(state.z, point.z, boundedAlpha)
    };
    return state;
  });
}

function kalmanSmooth(points, options) {
  const processNoise = Math.max(EPSILON, finite(options.kalmanProcessNoise, 0.005));
  const measurementNoise = Math.max(EPSILON, finite(options.kalmanMeasurementNoise, 0.035));
  const states = ["x", "y", "z"].map((axis) => ({ value: points[0][axis], covariance: 1 }));
  return points.map((point, index) => {
    if (index === 0) return { ...point };
    const next = { ...point };
    ["x", "y", "z"].forEach((axis, axisIndex) => {
      const state = states[axisIndex];
      state.covariance += processNoise;
      const gain = state.covariance / (state.covariance + measurementNoise);
      state.value += gain * (point[axis] - state.value);
      state.covariance *= 1 - gain;
      next[axis] = state.value;
    });
    return next;
  });
}

function oneEuroSmooth(points, options) {
  const minCutoff = Math.max(0.01, finite(options.oneEuroMinCutoff, 5));
  const beta = Math.max(0, finite(options.oneEuroBeta, 1.5));
  const derivativeCutoff = Math.max(0.01, finite(options.oneEuroDerivativeCutoff, 1));
  const state = ["x", "y", "z"].map((axis) => ({ value: points[0][axis], derivative: 0, raw: points[0][axis] }));
  let previousTimestamp = points[0].timestamp;
  return points.map((point, index) => {
    if (index === 0) return { ...point };
    const dt = Math.max(0.001, (point.timestamp - previousTimestamp) / 1000);
    previousTimestamp = point.timestamp;
    const next = { ...point };
    ["x", "y", "z"].forEach((axis, axisIndex) => {
      const axisState = state[axisIndex];
      const derivative = (point[axis] - axisState.raw) / dt;
      const derivativeAlpha = smoothingAlpha(dt, derivativeCutoff);
      axisState.derivative = lerp(axisState.derivative, derivative, derivativeAlpha);
      const cutoff = minCutoff + beta * Math.abs(axisState.derivative);
      axisState.value = lerp(axisState.value, point[axis], smoothingAlpha(dt, cutoff));
      axisState.raw = point[axis];
      next[axis] = axisState.value;
    });
    return next;
  });
}

function smoothingAlpha(dt, cutoff) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function minimumDistanceResample(points, minimumDistance) {
  if (points.length < 3 || minimumDistance <= 0) return [...points];
  const output = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    if (distance3(points[index], output.at(-1)) >= minimumDistance) output.push(points[index]);
  }
  if (points.length > 1 && points.at(-1).timestamp > output.at(-1).timestamp) output.push(points.at(-1));
  return output;
}

function interpolateBounded(points, options) {
  if (points.length < 2) return [...points];
  const output = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const gap = current.timestamp - previous.timestamp;
    const safeGap = gap > options.maximumSampleGapMs && gap <= options.maximumInterpolationGapMs;
    const safeDistance = distance3(previous, current) <= options.maximumInterpolationDistance;
    if (safeGap && safeDistance) {
      const count = Math.min(options.maximumInterpolatedPoints, Math.max(0, Math.ceil(gap / options.maximumSampleGapMs) - 1));
      for (let step = 1; step <= count; step += 1) {
        const ratio = step / (count + 1);
        output.push({
          x: lerp(previous.x, current.x, ratio),
          y: lerp(previous.y, current.y, ratio),
          z: lerp(previous.z, current.z, ratio),
          timestamp: lerp(previous.timestamp, current.timestamp, ratio),
          confidence: Math.min(previous.confidence, current.confidence) * 0.75,
          velocity: lerp(previous.velocity, current.velocity, ratio),
          metricScaleX: lerp(previous.metricScaleX, current.metricScaleX, ratio),
          metricScaleY: lerp(previous.metricScaleY, current.metricScaleY, ratio),
          metricScaleZ: lerp(previous.metricScaleZ, current.metricScaleZ, ratio),
          interpolated: true
        });
      }
    }
    output.push(current);
  }
  return output;
}

export function ramerDouglasPeucker(points = [], epsilon = 0.006) {
  if (!Array.isArray(points) || points.length <= 2) return [...(points || [])];
  let maximumDistance = -1;
  let splitIndex = -1;
  for (let index = 1; index < points.length - 1; index += 1) {
    const candidateDistance = pointToSegmentDistance(points[index], points[0], points.at(-1));
    if (candidateDistance > maximumDistance) {
      maximumDistance = candidateDistance;
      splitIndex = index;
    }
  }
  if (maximumDistance <= epsilon || splitIndex < 1) return [points[0], points.at(-1)];
  const left = ramerDouglasPeucker(points.slice(0, splitIndex + 1), epsilon);
  const right = ramerDouglasPeucker(points.slice(splitIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

export function extractStrokeFeatures(input = [], options = {}) {
  const sourcePoints = normalizePoints(input);
  const points = sourcePoints.map(metricPoint);
  const empty = emptyFeatures();
  if (!points.length) return empty;
  const bounds = boundsFor(points);
  const centroid = averagePoint(points);
  const totalPathLength = pathLength(points);
  const directEndpointDistance = points.length > 1 ? distance3(points[0], points.at(-1)) : 0;
  const closureDistance = points.length > 1 ? distance2(points[0], points.at(-1)) : 0;
  const signedArea = polygonSignedArea(points);
  const enclosedArea = Math.abs(signedArea);
  const aspectRatio = bounds.height > EPSILON ? bounds.width / bounds.height : bounds.width > 0 ? Infinity : 1;
  const cornerSource = options.simplifiedPoints?.length
    ? normalizePoints(options.simplifiedPoints).map(metricPoint)
    : ramerDouglasPeucker(points, 0.01);
  const turns = turningAngles(cornerSource);
  const cornerCount = turns.filter((angle) => Math.abs(angle) >= Math.PI * 0.22).length;
  const histogram = turningHistogram(turningAngles(points));
  const curvature = totalPathLength > EPSILON ? turns.reduce((sum, value) => sum + Math.abs(value), 0) / totalPathLength : 0;
  const endpointVector = subtract(points.at(-1), points[0]);
  const endpointMagnitude = Math.hypot(endpointVector.x, endpointVector.y);
  const dominantDirection = {
    x: endpointMagnitude > EPSILON ? endpointVector.x / endpointMagnitude : 0,
    y: endpointMagnitude > EPSILON ? endpointVector.y / endpointMagnitude : 0,
    angle: Math.atan2(endpointVector.y, endpointVector.x)
  };
  const selfIntersections = countSelfIntersections(points);
  const velocities = velocityValues(points);
  const depthValues = points.map((point) => point.z);
  const duration = points.length > 1 ? points.at(-1).timestamp - points[0].timestamp : 0;
  const clockwise = signedArea > 0;
  const averageConfidence = mean(points.map((point) => point.confidence));
  const bboxArea = bounds.width * bounds.height;
  const radialError = normalizedRadialError(points, centroid, bounds);
  const featureVectorLabels = [
    "path_length", "direct_ratio", "closure_ratio", "area", "aspect_ratio", "corner_count",
    "curvature", "self_intersections", "velocity_mean", "velocity_p95", "depth_range", "duration_ms",
    "clockwise", "average_confidence", ...histogram.map((_, index) => `turn_bin_${index}`)
  ];
  const featureVector = [
    totalPathLength,
    totalPathLength > EPSILON ? directEndpointDistance / totalPathLength : 0,
    totalPathLength > EPSILON ? closureDistance / totalPathLength : 0,
    enclosedArea,
    Number.isFinite(aspectRatio) ? aspectRatio : 100,
    cornerCount,
    curvature,
    selfIntersections,
    velocities.mean,
    velocities.p95,
    Math.max(...depthValues) - Math.min(...depthValues),
    duration,
    clockwise ? 1 : 0,
    averageConfidence,
    ...histogram
  ];
  return {
    bounds,
    boundingBox: bounds,
    centroid,
    totalPathLength,
    directEndpointDistance,
    closureDistance,
    enclosedArea,
    aspectRatio,
    turningAngleHistogram: histogram,
    cornerCount,
    curvature,
    dominantDirection,
    selfIntersections,
    velocityProfile: velocities,
    depthRange: Math.max(...depthValues) - Math.min(...depthValues),
    duration,
    clockwise,
    orientation: clockwise ? "clockwise" : "counterclockwise",
    averageConfidence,
    bboxFill: bboxArea > EPSILON ? enclosedArea / bboxArea : 0,
    radialError,
    pointCount: points.length,
    featureVector,
    featureVectorLabels
  };
}

export function classifyStroke(input = [], options = {}) {
  const points = normalizePoints(input);
  const simplified = options.simplifiedPoints?.length ? normalizePoints(options.simplifiedPoints) : ramerDouglasPeucker(points, 0.009);
  const features = options.features || extractStrokeFeatures(points, { simplifiedPoints: simplified });
  const path = features.totalPathLength;
  const closureRatio = path > EPSILON ? features.closureDistance / path : 1;
  const directRatio = path > EPSILON ? features.directEndpointDistance / path : 0;
  const aspect = features.aspectRatio;
  const closed = closureRatio <= 0.14;
  const minimumStrokeConfidence = finite(options.minimumStrokeConfidence, 0.62);
  if (features.averageConfidence < minimumStrokeConfidence) {
    return {
      classification: "freeform",
      confidence: round(Math.min(0.4, features.averageConfidence)),
      alternatives: [],
      evidence: {
        matched: ["low_confidence"],
        closureRatio: round(closureRatio),
        directRatio: round(directRatio),
        cornerCount: features.cornerCount,
        radialError: round(features.radialError),
        bboxFill: round(features.bboxFill),
        content: null
      }
    };
  }
  const geometrySimplified = simplified.map(metricPoint);
  const polygonVertices = uniquePolygonVertices(geometrySimplified);
  const rectangle = rectangleEvidence(polygonVertices);
  const scores = [];
  const add = (classification, confidence, evidence) => scores.push({
    classification,
    confidence: clamp(confidence * (0.7 + features.averageConfidence * 0.3), 0, 0.99),
    evidence
  });

  if (points.length >= 12 && closed && aspect >= 0.75 && aspect <= 1.34 && features.radialError <= 0.2 && features.bboxFill >= 0.55 && features.bboxFill <= 0.89) {
    add("circle", 0.94 - features.radialError * 0.7 - Math.abs(1 - aspect) * 0.15, ["closed", "uniform_radius", "balanced_aspect"]);
  }
  if (points.length >= 12 && closed && aspect >= 0.28 && aspect <= 3.6 && (aspect < 0.8 || aspect > 1.25) && features.radialError <= 0.23 && features.bboxFill >= 0.5 && features.bboxFill <= 0.89) {
    add("ellipse", 0.91 - features.radialError * 0.6, ["closed", "elliptic_radius", "elongated_aspect"]);
  }
  if (closed && polygonVertices.length === 4 && rectangle.rightAngleScore >= 0.72 && rectangle.parallelScore >= 0.86) {
    add("rectangle", 0.78 + rectangle.rightAngleScore * 0.07 + rectangle.parallelScore * 0.07, ["closed", "four_sided", "right_angles", "parallel_opposites"]);
  }
  if (closed && polygonVertices.length === 3 && Math.abs(polygonSignedArea(polygonVertices)) >= 0.002) {
    add("triangle", 0.87, ["closed", "three_sided", "nondegenerate_area"]);
  }
  if (!closed && directRatio >= 0.93 && features.cornerCount <= 1 && points.length >= 2) {
    add("line", 0.88 + Math.min(0.08, (directRatio - 0.93) * 0.8), ["open", "high_directness"]);
  }
  if (!closed && geometrySimplified.length >= 4 && geometrySimplified.length <= 8 && repeatedInteriorVertex(geometrySimplified) && (aspect >= 1.15 || aspect <= 0.87)) {
    add("arrow", 0.84, ["open", "repeated_tip", "shaft_and_head"]);
  }

  const lasso = detectClosedLasso(points, options.lasso);
  if (lasso.valid && !scores.some((candidate) => ["circle", "ellipse", "rectangle", "triangle"].includes(candidate.classification))) {
    add("lasso_candidate", Math.max(0.68, lasso.confidence * 0.92), ["closed", "valid_selection_loop"]);
  }

  const diagonal = Math.hypot(features.bounds.width, features.bounds.height);
  const complexity = diagonal > EPSILON ? path / diagonal : 0;
  if (!closed && points.length >= 10 && features.duration >= 120 && features.duration <= 3000 && features.cornerCount >= 2 && complexity >= 1.4) {
    if (aspect >= 1.55 && features.cornerCount >= 4 && complexity >= 2.7) {
      add("short_word_candidate", 0.7, ["open", "wide_complex_stroke", "content_not_inferred"]);
    } else if (aspect >= 0.45 && aspect <= 1.55 && features.cornerCount <= 9) {
      add("short_letter_candidate", 0.67, ["open", "compact_complex_stroke", "content_not_inferred"]);
    }
  }

  scores.sort((a, b) => b.confidence - a.confidence);
  const winner = scores[0];
  const classification = winner?.confidence >= finite(options.minimumClassificationConfidence, 0.65)
    ? winner.classification
    : "freeform";
  const confidence = classification === "freeform" ? Math.max(0.35, Math.min(0.62, winner?.confidence || 0.45)) : winner.confidence;
  return {
    classification,
    confidence: round(confidence),
    alternatives: scores.filter((candidate) => candidate.classification !== classification).slice(0, 3).map((candidate) => ({
      classification: candidate.classification,
      confidence: round(candidate.confidence)
    })),
    evidence: {
      matched: classification === "freeform" ? ["insufficient_geometric_evidence"] : winner.evidence,
      closureRatio: round(closureRatio),
      directRatio: round(directRatio),
      cornerCount: features.cornerCount,
      radialError: round(features.radialError),
      bboxFill: round(features.bboxFill),
      content: null
    }
  };
}

export function detectClosedLasso(input = [], options = {}) {
  const points = normalizePoints(input);
  const config = {
    minimumPointCount: 10,
    minimumArea: 0.004,
    minimumPathLength: 0.18,
    maximumClosureDistance: 0.055,
    maximumClosureRatio: 0.15,
    maximumSelfIntersections: 0,
    minimumConfidence: 0.58,
    minimumDurationMs: 100,
    maximumDurationMs: 8000,
    ...options
  };
  const features = extractStrokeFeatures(points);
  const sourceBounds = boundsFor(points);
  const sourceCentroid = polygonCentroid(points);
  const sourceClockwise = polygonSignedArea(points) > 0;
  const rejected = (rejectionReason) => ({
    valid: false,
    confidence: 0,
    polygon: [],
    area: features.enclosedArea,
    centroid: sourceCentroid,
    bounds: sourceBounds,
    clockwise: sourceClockwise,
    rejectionReason
  });
  if (points.length < config.minimumPointCount) return rejected("insufficient_points");
  if (features.duration < config.minimumDurationMs || features.duration > config.maximumDurationMs) return rejected("duration_invalid");
  if (features.averageConfidence < config.minimumConfidence) return rejected("low_confidence");
  if (features.totalPathLength < config.minimumPathLength) return rejected("open_path");
  const closureRatio = features.closureDistance / Math.max(features.totalPathLength, EPSILON);
  if (features.closureDistance > config.maximumClosureDistance || closureRatio > config.maximumClosureRatio) return rejected("open_path");
  if (countClosedSelfIntersections(points) > config.maximumSelfIntersections) return rejected("excessive_self_intersection");
  if (features.enclosedArea < config.minimumArea) return rejected("area_too_small");
  const polygon = ramerDouglasPeucker(points, finite(options.rdpEpsilon, 0.004)).map(copyPoint);
  if (distance2(polygon[0], polygon.at(-1)) > EPSILON) polygon.push(copyPoint(polygon[0]));
  const closureScore = 1 - Math.max(
    clamp(features.closureDistance / Math.max(config.maximumClosureDistance, EPSILON), 0, 1),
    clamp(closureRatio / Math.max(config.maximumClosureRatio, EPSILON), 0, 1)
  );
  const areaScore = clamp(features.enclosedArea / Math.max(config.minimumArea * 5, EPSILON), 0, 1);
  const confidence = 0.25 * closureScore + 0.25 * areaScore + 0.35 * features.averageConfidence + 0.15 * clamp(points.length / 32, 0, 1);
  return {
    valid: true,
    confidence: round(confidence),
    polygon,
    area: features.enclosedArea,
    centroid: polygonCentroid(points),
    bounds: sourceBounds,
    clockwise: sourceClockwise,
    rejectionReason: null
  };
}

export function mapTrajectoryToViewport(points = [], options = {}) {
  const transform = viewportTransform(options);
  const deviceScale = options.outputSpace === "device" ? transform.devicePixelRatio : 1;
  return (Array.isArray(points) ? points : []).map((point) => {
    const rotated = rotateNormalized(point, transform.rotation);
    let x = rotated.x * transform.rotatedWidth * transform.scale - transform.cropX;
    const y = rotated.y * transform.rotatedHeight * transform.scale - transform.cropY;
    if (transform.mirrored) x = transform.viewport.width - x;
    return {
      ...point,
      x: (transform.viewport.x + x) * deviceScale,
      y: (transform.viewport.y + y) * deviceScale
    };
  });
}

export function mapViewportPolygonToSourceFrame(points = [], options = {}) {
  const transform = viewportTransform(options);
  const deviceScale = options.inputSpace === "device" ? transform.devicePixelRatio : 1;
  return (Array.isArray(points) ? points : []).map((point) => {
    let x = finite(point.x) / deviceScale - transform.viewport.x;
    const y = finite(point.y) / deviceScale - transform.viewport.y;
    if (transform.mirrored) x = transform.viewport.width - x;
    const rotated = {
      x: (x + transform.cropX) / (transform.rotatedWidth * transform.scale),
      y: (y + transform.cropY) / (transform.rotatedHeight * transform.scale)
    };
    const source = inverseRotateNormalized(rotated, transform.rotation);
    const normalized = options.normalized === true;
    return {
      ...point,
      x: normalized ? source.x : source.x * transform.frameWidth,
      y: normalized ? source.y : source.y * transform.frameHeight
    };
  });
}

export function pointInPolygon(point, polygon = []) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function bboxPolygonOverlap(bbox = {}, polygon = []) {
  const x = finite(bbox.x ?? bbox.left ?? bbox.minX);
  const y = finite(bbox.y ?? bbox.top ?? bbox.minY);
  const width = Math.max(0, finite(bbox.width, finite(bbox.maxX) - x));
  const height = Math.max(0, finite(bbox.height, finite(bbox.maxY) - y));
  const box = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
  const intersectionArea = polygonIntersectionArea(box, polygon);
  return width * height > EPSILON ? clamp(intersectionArea / (width * height), 0, 1) : 0;
}

export function polygonIoU(first = [], second = []) {
  const areaA = Math.abs(polygonSignedArea(first));
  const areaB = Math.abs(polygonSignedArea(second));
  const intersection = polygonIntersectionArea(first, second);
  const union = areaA + areaB - intersection;
  return union > EPSILON ? clamp(intersection / union, 0, 1) : 0;
}

function viewportTransform(options) {
  const frameWidth = Math.max(1, finite(options.frameWidth ?? options.sourceWidth, 1));
  const frameHeight = Math.max(1, finite(options.frameHeight ?? options.sourceHeight, 1));
  const viewportInput = options.viewport || options.viewportRect || {};
  const viewport = {
    x: finite(viewportInput.x ?? viewportInput.left),
    y: finite(viewportInput.y ?? viewportInput.top),
    width: Math.max(1, finite(viewportInput.width ?? options.viewportWidth, frameWidth)),
    height: Math.max(1, finite(viewportInput.height ?? options.viewportHeight, frameHeight))
  };
  const rotation = normalizeRotation(options.rotation ?? options.rotationDegrees);
  const rotatedWidth = rotation === 90 || rotation === 270 ? frameHeight : frameWidth;
  const rotatedHeight = rotation === 90 || rotation === 270 ? frameWidth : frameHeight;
  const fit = options.objectFit === "contain" ? "contain" : "cover";
  const scale = fit === "contain"
    ? Math.min(viewport.width / rotatedWidth, viewport.height / rotatedHeight)
    : Math.max(viewport.width / rotatedWidth, viewport.height / rotatedHeight);
  return {
    frameWidth,
    frameHeight,
    viewport,
    rotation,
    rotatedWidth,
    rotatedHeight,
    scale,
    cropX: (rotatedWidth * scale - viewport.width) / 2,
    cropY: (rotatedHeight * scale - viewport.height) / 2,
    mirrored: options.mirrored === true,
    devicePixelRatio: Math.max(1, finite(options.devicePixelRatio, 1))
  };
}

function rotateNormalized(point, rotation) {
  const x = finite(point.x);
  const y = finite(point.y);
  if (rotation === 90) return { x: 1 - y, y: x };
  if (rotation === 180) return { x: 1 - x, y: 1 - y };
  if (rotation === 270) return { x: y, y: 1 - x };
  return { x, y };
}

function inverseRotateNormalized(point, rotation) {
  if (rotation === 90) return { x: point.y, y: 1 - point.x };
  if (rotation === 180) return { x: 1 - point.x, y: 1 - point.y };
  if (rotation === 270) return { x: 1 - point.y, y: point.x };
  return point;
}

function normalizeRotation(value) {
  const normalized = ((Math.round(finite(value) / 90) * 90) % 360 + 360) % 360;
  return [0, 90, 180, 270].includes(normalized) ? normalized : 0;
}

function repeatedInteriorVertex(points) {
  const bounds = boundsFor(points);
  const threshold = Math.max(0.015, Math.hypot(bounds.width, bounds.height) * 0.11);
  for (let first = 1; first < points.length - 2; first += 1) {
    for (let second = first + 2; second < points.length - 1; second += 1) {
      if (distance2(points[first], points[second]) <= threshold) return true;
    }
  }
  return false;
}

function uniquePolygonVertices(points) {
  const clean = [...points];
  if (clean.length > 1 && distance2(clean[0], clean.at(-1)) <= 0.06) clean.pop();
  return clean.filter((point, index) => index === 0 || distance2(point, clean[index - 1]) > 0.004);
}

function rectangleEvidence(vertices) {
  if (vertices.length !== 4) return { rightAngleScore: 0, parallelScore: 0 };
  const edges = vertices.map((point, index) => normalize2(subtract2(vertices[(index + 1) % 4], point)));
  const rightAngleScore = 1 - mean(edges.map((edge, index) => Math.abs(dot2(edge, edges[(index + 1) % 4]))));
  const parallelScore = mean([Math.abs(dot2(edges[0], edges[2])), Math.abs(dot2(edges[1], edges[3]))]);
  return { rightAngleScore: clamp(rightAngleScore, 0, 1), parallelScore: clamp(parallelScore, 0, 1) };
}

function normalizedRadialError(points, centroid, bounds) {
  const radiusX = bounds.width / 2;
  const radiusY = bounds.height / 2;
  if (radiusX <= EPSILON || radiusY <= EPSILON) return 1;
  return mean(points.map((point) => Math.abs(Math.hypot((point.x - centroid.x) / radiusX, (point.y - centroid.y) / radiusY) - 1)));
}

function turningAngles(points) {
  const result = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const incoming = Math.atan2(points[index].y - points[index - 1].y, points[index].x - points[index - 1].x);
    const outgoing = Math.atan2(points[index + 1].y - points[index].y, points[index + 1].x - points[index].x);
    result.push(normalizeAngle(outgoing - incoming));
  }
  return result;
}

function turningHistogram(turns, binCount = 8) {
  const bins = Array(binCount).fill(0);
  for (const turn of turns) {
    const normalized = (normalizeAngle(turn) + Math.PI) / (2 * Math.PI);
    bins[Math.min(binCount - 1, Math.floor(normalized * binCount))] += 1;
  }
  const total = Math.max(1, turns.length);
  return bins.map((value) => value / total);
}

function countSelfIntersections(points) {
  let count = 0;
  for (let first = 0; first < points.length - 1; first += 1) {
    for (let second = first + 2; second < points.length - 1; second += 1) {
      if (first === 0 && second === points.length - 2) continue;
      if (segmentsIntersect(points[first], points[first + 1], points[second], points[second + 1])) count += 1;
    }
  }
  return count;
}

function countClosedSelfIntersections(points) {
  const clean = withoutClosingPoint(points);
  if (clean.length < 4) return 0;
  let count = 0;
  for (let first = 0; first < clean.length; first += 1) {
    const firstNext = (first + 1) % clean.length;
    for (let second = first + 1; second < clean.length; second += 1) {
      const secondNext = (second + 1) % clean.length;
      const adjacent = first === second || firstNext === second || secondNext === first;
      if (adjacent) continue;
      if (segmentsIntersectInclusive(clean[first], clean[firstNext], clean[second], clean[secondNext])) count += 1;
    }
  }
  return count;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross2(a, b, c);
  const abD = cross2(a, b, d);
  const cdA = cross2(c, d, a);
  const cdB = cross2(c, d, b);
  return abC * abD < -EPSILON && cdA * cdB < -EPSILON;
}

function segmentsIntersectInclusive(a, b, c, d) {
  const abC = cross2(a, b, c);
  const abD = cross2(a, b, d);
  const cdA = cross2(c, d, a);
  const cdB = cross2(c, d, b);
  if (abC * abD < -EPSILON && cdA * cdB < -EPSILON) return true;
  return (Math.abs(abC) <= EPSILON && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= EPSILON && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= EPSILON && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= EPSILON && pointOnSegment(b, c, d));
}

function pointOnSegment(point, a, b) {
  return Math.abs(cross2(a, b, point)) <= EPSILON
    && point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON
    && point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON;
}

function cross2(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function polygonIntersectionArea(first, second) {
  if (first.length < 3 || second.length < 3) return 0;
  const trianglesA = triangulate(first);
  const trianglesB = triangulate(second);
  let area = 0;
  for (const subject of trianglesA) {
    for (const clip of trianglesB) area += Math.abs(polygonSignedArea(clipConvex(subject, clip)));
  }
  return area;
}

function triangulate(input) {
  const points = withoutClosingPoint(input);
  if (points.length < 3) return [];
  if (points.length === 3) return [points];
  const orientation = Math.sign(polygonSignedArea(points)) || 1;
  const indices = points.map((_, index) => index);
  const triangles = [];
  let guard = points.length * points.length;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let cursor = 0; cursor < indices.length; cursor += 1) {
      const previous = indices[(cursor - 1 + indices.length) % indices.length];
      const current = indices[cursor];
      const next = indices[(cursor + 1) % indices.length];
      const triangle = [points[previous], points[current], points[next]];
      if (Math.sign(cross2(...triangle)) !== orientation) continue;
      if (indices.some((index) => ![previous, current, next].includes(index) && pointInTriangle(points[index], triangle))) continue;
      triangles.push(triangle);
      indices.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) triangles.push(indices.map((index) => points[index]));
  if (!triangles.length) {
    for (let index = 1; index < points.length - 1; index += 1) triangles.push([points[0], points[index], points[index + 1]]);
  }
  return triangles;
}

function pointInTriangle(point, triangle) {
  const [a, b, c] = triangle;
  const first = cross2(a, b, point);
  const second = cross2(b, c, point);
  const third = cross2(c, a, point);
  return (first >= -EPSILON && second >= -EPSILON && third >= -EPSILON)
    || (first <= EPSILON && second <= EPSILON && third <= EPSILON);
}

function clipConvex(subject, clip) {
  let output = [...subject];
  const orientation = Math.sign(polygonSignedArea(clip)) || 1;
  for (let edge = 0; edge < clip.length; edge += 1) {
    const a = clip[edge];
    const b = clip[(edge + 1) % clip.length];
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const previous = input[(index - 1 + input.length) % input.length];
      const currentInside = orientation * cross2(a, b, current) >= -EPSILON;
      const previousInside = orientation * cross2(a, b, previous) >= -EPSILON;
      if (currentInside !== previousInside) output.push(lineIntersection(previous, current, a, b));
      if (currentInside) output.push(current);
    }
    if (!output.length) break;
  }
  return output;
}

function lineIntersection(a, b, c, d) {
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) <= EPSILON) return { ...b };
  const first = a.x * b.y - a.y * b.x;
  const second = c.x * d.y - c.y * d.x;
  return {
    x: (first * (c.x - d.x) - (a.x - b.x) * second) / denominator,
    y: (first * (c.y - d.y) - (a.y - b.y) * second) / denominator
  };
}

function polygonCentroid(points) {
  const areaFactor = polygonSignedArea(points) * 6;
  if (Math.abs(areaFactor) <= EPSILON) return averagePoint(points);
  let x = 0;
  let y = 0;
  const clean = withoutClosingPoint(points);
  for (let index = 0; index < clean.length; index += 1) {
    const current = clean[index];
    const next = clean[(index + 1) % clean.length];
    const cross = current.x * next.y - next.x * current.y;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  return { x: x / areaFactor, y: y / areaFactor, z: mean(points.map((point) => finite(point.z))) };
}

function withoutClosingPoint(points) {
  const clean = [...(Array.isArray(points) ? points : [])];
  if (clean.length > 1 && distance2(clean[0], clean.at(-1)) <= EPSILON) clean.pop();
  return clean;
}

function polygonSignedArea(points) {
  const clean = withoutClosingPoint(points);
  let twiceArea = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const current = clean[index];
    const next = clean[(index + 1) % clean.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = finite(end.z) - finite(start.z);
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared <= EPSILON) return distance3(point, start);
  const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy + (finite(point.z) - finite(start.z)) * dz) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy), finite(point.z) - (finite(start.z) + ratio * dz));
}

function velocityValues(points) {
  const values = [];
  for (let index = 1; index < points.length; index += 1) {
    const dt = Math.max(0.001, (points[index].timestamp - points[index - 1].timestamp) / 1000);
    values.push(points[index].velocity > 0 ? points[index].velocity : distance3(points[index], points[index - 1]) / dt);
  }
  const sorted = values.sort((a, b) => a - b);
  return {
    minimum: sorted[0] || 0,
    maximum: sorted.at(-1) || 0,
    mean: mean(sorted),
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    samples: sorted
  };
}

function boundsFor(points) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function emptyFeatures() {
  return {
    bounds: boundsFor([]), boundingBox: boundsFor([]), centroid: { x: 0, y: 0, z: 0 }, totalPathLength: 0,
    directEndpointDistance: 0, closureDistance: 0, enclosedArea: 0, aspectRatio: 1, turningAngleHistogram: Array(8).fill(0),
    cornerCount: 0, curvature: 0, dominantDirection: { x: 0, y: 0, angle: 0 }, selfIntersections: 0,
    velocityProfile: { minimum: 0, maximum: 0, mean: 0, median: 0, p95: 0, samples: [] }, depthRange: 0,
    duration: 0, clockwise: false, orientation: "counterclockwise", averageConfidence: 0, bboxFill: 0, radialError: 1,
    pointCount: 0, featureVector: Array(22).fill(0), featureVectorLabels: []
  };
}

function averagePoint(points) {
  if (!points.length) return { x: 0, y: 0, z: 0 };
  return { x: mean(points.map((point) => point.x)), y: mean(points.map((point) => point.y)), z: mean(points.map((point) => point.z)) };
}

function pathLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance3(points[index], points[index - 1]);
  return total;
}

function distance2(a, b) { return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.y) - finite(b?.y)); }
function distance3(a, b) { return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.y) - finite(b?.y), finite(a?.z) - finite(b?.z)); }
function subtract2(a, b) { return { x: finite(a?.x) - finite(b?.x), y: finite(a?.y) - finite(b?.y) }; }
function normalize2(vector) { const magnitude = Math.hypot(vector.x, vector.y); return magnitude > EPSILON ? { x: vector.x / magnitude, y: vector.y / magnitude } : { x: 0, y: 0 }; }
function dot2(a, b) { return a.x * b.x + a.y * b.y; }
function subtract(a, b) { return { x: finite(a?.x) - finite(b?.x), y: finite(a?.y) - finite(b?.y), z: finite(a?.z) - finite(b?.z) }; }
function metricPoint(point) { return { ...point, x: point.x * point.metricScaleX, y: point.y * point.metricScaleY, z: point.z * point.metricScaleZ }; }
function copyPoint(point) { return { ...point }; }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + finite(value), 0) / values.length : 0; }
function percentile(values, proportion) { return values.length ? values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * proportion) - 1))] : 0; }
function normalizeAngle(value) { return Math.atan2(Math.sin(value), Math.cos(value)); }
function lerp(start, end, ratio) { return start + (end - start) * ratio; }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function positiveFinite(value, fallback = 1) { const number = finite(value, fallback); return number > 0 ? number : fallback; }
function round(value) { return Number(finite(value).toFixed(4)); }
