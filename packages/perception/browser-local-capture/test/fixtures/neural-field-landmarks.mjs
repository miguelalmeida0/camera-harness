const DEFAULT_FRAME = Object.freeze({ frameWidth: 1280, frameHeight: 720, mirrored: false });

export function makeLandmarks({
  indexTip = { x: 0.5, y: 0.35, z: -0.03 },
  palmCenter = { x: indexTip.x, y: Math.min(0.88, indexTip.y + 0.16), z: 0 },
  pinchRatio = 0.2,
  confidence = 0.96
} = {}) {
  const x = palmCenter.x;
  const y = palmCenter.y;
  const points = Array.from({ length: 21 }, () => point(x, y, 0, confidence));
  points[0] = point(x, y + 0.11, 0.015, confidence);
  points[1] = point(x - 0.055, y + 0.055, 0, confidence);
  points[2] = point(x - 0.075, y + 0.015, -0.005, confidence);
  points[3] = point(indexTip.x + 0.1 * pinchRatio * 0.55, indexTip.y + 0.006, indexTip.z, confidence);
  points[4] = point(indexTip.x + 0.1 * pinchRatio, indexTip.y, indexTip.z, confidence);
  points[5] = point(x - 0.045, y - 0.025, 0, confidence);
  points[6] = point(x - 0.04, y - 0.085, -0.01, confidence);
  points[7] = point(indexTip.x, indexTip.y + 0.045, indexTip.z, confidence);
  points[8] = point(indexTip.x, indexTip.y, indexTip.z, confidence);
  points[9] = point(x - 0.012, y - 0.045, -0.005, confidence);
  points[10] = point(x - 0.01, y - 0.11, -0.015, confidence);
  points[11] = point(x - 0.008, y - 0.16, -0.02, confidence);
  points[12] = point(x - 0.006, y - 0.2, -0.025, confidence);
  points[13] = point(x + 0.022, y - 0.035, 0, confidence);
  points[14] = point(x + 0.03, y - 0.095, -0.01, confidence);
  points[15] = point(x + 0.035, y - 0.14, -0.015, confidence);
  points[16] = point(x + 0.04, y - 0.175, -0.02, confidence);
  points[17] = point(x + 0.055, y - 0.015, 0.005, confidence);
  points[18] = point(x + 0.07, y - 0.065, 0, confidence);
  points[19] = point(x + 0.075, y - 0.1, -0.005, confidence);
  points[20] = point(x + 0.08, y - 0.13, -0.01, confidence);
  return points;
}

export function makeRawHandFrame({
  timestamp = 0,
  hands = [{ handedness: "right" }],
  frameWidth = DEFAULT_FRAME.frameWidth,
  frameHeight = DEFAULT_FRAME.frameHeight,
  mirrored = false
} = {}) {
  const landmarks = hands.map((hand) => makeLandmarks(hand));
  return {
    timestamp,
    frameWidth,
    frameHeight,
    mirrored,
    result: {
      landmarks,
      worldLandmarks: landmarks.map((group) => group.map((item) => ({ ...item, x: (item.x - 0.5) * 0.22, y: (item.y - 0.5) * 0.22, z: item.z * 0.22 }))),
      handedness: hands.map((hand) => [{ categoryName: title(hand.handedness || "right"), score: hand.confidence ?? 0.96 }])
    }
  };
}

export function makeTrajectoryFromVertices(vertices, {
  samplesPerSegment = 6,
  startTimestamp = 0,
  intervalMs = 24,
  confidence = 0.96,
  z = 0
} = {}) {
  const output = [];
  for (let segment = 0; segment < vertices.length - 1; segment += 1) {
    const start = vertices[segment];
    const end = vertices[segment + 1];
    for (let sample = segment === 0 ? 0 : 1; sample <= samplesPerSegment; sample += 1) {
      const ratio = sample / samplesPerSegment;
      const previous = output.at(-1);
      const next = {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        z: (start.z ?? z) + ((end.z ?? z) - (start.z ?? z)) * ratio,
        timestamp: startTimestamp + output.length * intervalMs,
        confidence,
        velocity: 0
      };
      if (previous) next.velocity = Math.hypot(next.x - previous.x, next.y - previous.y) / (intervalMs / 1000);
      output.push(next);
    }
  }
  return output;
}

export function makeRadialTrajectory({
  center = { x: 0.5, y: 0.5 },
  radiusX = 0.2,
  radiusY = radiusX,
  turns = 1,
  samples = 64,
  startAngle = 0,
  intervalMs = 24,
  jitter = 0,
  confidence = 0.96
} = {}) {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const ratio = index / samples;
    const angle = startAngle + ratio * Math.PI * 2 * turns;
    const noiseX = jitter ? Math.sin(index * 7.13) * jitter : 0;
    const noiseY = jitter ? Math.cos(index * 5.77) * jitter : 0;
    return {
      x: center.x + Math.cos(angle) * radiusX + noiseX,
      y: center.y + Math.sin(angle) * radiusY + noiseY,
      z: Math.sin(angle * 0.5) * 0.01,
      timestamp: index * intervalMs,
      confidence,
      velocity: index ? Math.hypot(radiusX, radiusY) * (2 * Math.PI / (samples * intervalMs / 1000)) : 0
    };
  });
}

function handSequence(points, { startTimestamp = 0, intervalMs = 40, pinchRatios = [], confidence = 0.96, mirrored = false } = {}) {
  return points.map((indexTip, index) => makeRawHandFrame({
    timestamp: startTimestamp + index * intervalMs,
    mirrored,
    hands: [{ handedness: "right", indexTip, pinchRatio: pinchRatios[index] ?? 0.2, confidence }]
  }));
}

const stablePoint = { x: 0.5, y: 0.35, z: -0.03 };
const stablePinch = handSequence(Array(5).fill(stablePoint));
const pinchFlicker = handSequence(Array(6).fill(stablePoint), { pinchRatios: [0.2, 0.55, 0.21, 0.56, 0.2, 0.57] });
const pinchRelease = handSequence(Array(7).fill(stablePoint), { pinchRatios: [0.2, 0.2, 0.2, 0.25, 0.65, 0.68, 0.7] });
const circlePoints = Array.from({ length: 34 }, (_, index) => ({
  x: 0.5 + Math.cos((index / 33) * Math.PI * 2) * 0.18,
  y: 0.48 + Math.sin((index / 33) * Math.PI * 2) * 0.18,
  z: -0.025
}));
const slowCircle = makeRadialTrajectory({ samples: 72, intervalMs: 32, radiusX: 0.18, radiusY: 0.18 });
const fastCircle = makeRadialTrajectory({ samples: 40, intervalMs: 10, radiusX: 0.18, radiusY: 0.18 });
const ellipse = makeRadialTrajectory({ samples: 64, intervalMs: 22, radiusX: 0.26, radiusY: 0.12 });
const roughRectangle = makeTrajectoryFromVertices([
  { x: 0.25, y: 0.3 }, { x: 0.77, y: 0.305 }, { x: 0.76, y: 0.7 }, { x: 0.245, y: 0.695 }, { x: 0.25, y: 0.3 }
], { samplesPerSegment: 10 });
const sharpArrow = makeTrajectoryFromVertices([
  { x: 0.18, y: 0.52 }, { x: 0.78, y: 0.52 }, { x: 0.61, y: 0.34 }, { x: 0.78, y: 0.52 }, { x: 0.61, y: 0.7 }
], { samplesPerSegment: 6 });
const triangle = makeTrajectoryFromVertices([
  { x: 0.5, y: 0.22 }, { x: 0.78, y: 0.72 }, { x: 0.22, y: 0.72 }, { x: 0.5, y: 0.22 }
], { samplesPerSegment: 10 });
const openLasso = makeRadialTrajectory({ samples: 50, turns: 0.72, radiusX: 0.2, radiusY: 0.17 });
const validLasso = makeRadialTrajectory({ samples: 58, radiusX: 0.22, radiusY: 0.17, jitter: 0.003 });
const tinyLasso = makeRadialTrajectory({ samples: 36, radiusX: 0.03, radiusY: 0.03 });
const selfIntersectingLasso = makeTrajectoryFromVertices([
  { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 0.3, y: 0.7 }, { x: 0.7, y: 0.3 }, { x: 0.3, y: 0.3 }
], { samplesPerSegment: 9 });
const aiStrokeA = makeTrajectoryFromVertices([{ x: 0.2, y: 0.72 }, { x: 0.36, y: 0.28 }, { x: 0.52, y: 0.72 }, { x: 0.44, y: 0.5 }, { x: 0.28, y: 0.5 }], { samplesPerSegment: 5 });
const aiStrokeI = makeTrajectoryFromVertices([{ x: 0.62, y: 0.3 }, { x: 0.82, y: 0.3 }, { x: 0.72, y: 0.3 }, { x: 0.72, y: 0.7 }, { x: 0.62, y: 0.7 }, { x: 0.82, y: 0.7 }], { samplesPerSegment: 4 });
const jitteryHand = handSequence(Array.from({ length: 40 }, (_, index) => ({
  x: 0.5 + Math.sin(index * 4.1) * 0.012,
  y: 0.35 + Math.cos(index * 3.7) * 0.01,
  z: -0.03 + Math.sin(index * 2.9) * 0.004
})), { intervalMs: 16 });

export const NEURAL_FIELD_FIXTURES = Object.freeze({
  noHand: makeRawHandFrame({ hands: [] }),
  oneStableHand: makeRawHandFrame({ hands: [{ handedness: "right", indexTip: stablePoint }] }),
  twoHands: makeRawHandFrame({ hands: [
    { handedness: "left", indexTip: { x: 0.3, y: 0.35, z: -0.02 } },
    { handedness: "right", indexTip: { x: 0.7, y: 0.34, z: -0.03 } }
  ] }),
  stablePinch,
  pinchFlicker,
  pinchRelease,
  handOcclusion: [...stablePinch.slice(0, 3), makeRawHandFrame({ timestamp: 160, hands: [] }), makeRawHandFrame({ timestamp: 360, hands: [] })],
  slowCircle,
  fastCircle,
  ellipse,
  roughRectangle,
  sharpArrow,
  triangle,
  aiLikeCharacterStrokes: [aiStrokeA, aiStrokeI],
  openLasso,
  validLasso,
  tinyLasso,
  selfIntersectingLasso,
  mirroredCamera: makeRawHandFrame({ mirrored: true, hands: [{ handedness: "right", indexTip: { x: 0.25, y: 0.35, z: -0.03 } }] }),
  mobileAspectRatio: { frameWidth: 1920, frameHeight: 1080, viewport: { x: 0, y: 0, width: 390, height: 844 }, mirrored: true, rotation: 90, devicePixelRatio: 3 },
  lowConfidenceLandmarks: makeRawHandFrame({ hands: [{ handedness: "right", confidence: 0.2, indexTip: stablePoint }] }),
  jitteryHand,
  circleHandSequence: handSequence(circlePoints, { intervalMs: 32 })
});

function point(x, y, z, confidence) { return { x, y, z, visibility: confidence, presence: confidence }; }
function title(value) { const text = String(value); return text.slice(0, 1).toUpperCase() + text.slice(1).toLowerCase(); }
