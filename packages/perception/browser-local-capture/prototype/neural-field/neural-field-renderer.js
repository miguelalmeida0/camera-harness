const MAX_STROKES = 6;
const LOST_GRACE_MS = 1_800;
const STATUS = Object.freeze({
  ready: "Ready",
  tracking: "Tracking hand",
  pinch: "Pinch to draw",
  drawing: "Drawing",
  complete: "Stroke complete",
  grounding: "Grounding object",
  selected: "Object selected",
  relation: "Relation found",
  uncertain: "Tracking uncertain",
  unavailable: "Neural Field unavailable"
});

const RELATIONS = Object.freeze({
  left_of: { phrase: "left of", directional: true },
  right_of: { phrase: "right of", directional: true },
  above: { phrase: "above", directional: true },
  below: { phrase: "below", directional: true },
  in_front_of: { phrase: "in front of", directional: true },
  behind: { phrase: "behind", directional: true },
  near: { phrase: "near", directional: false },
  far: { phrase: "far from", directional: false },
  inside: { phrase: "inside", directional: false },
  contains: { phrase: "around", directional: false },
  closer_than: { phrase: "closer than", directional: true },
  farther_than: { phrase: "farther than", directional: true },
  closest_to_camera: { phrase: "closest to camera", directional: false },
  approaching: { phrase: "approaching", directional: true },
  moving_away: { phrase: "moving away from", directional: true }
});

export function velocityWidth(velocity, confidence = 1, options = {}) {
  const min = finite(options.min, 1.4);
  const max = Math.max(min, finite(options.max, 11));
  const base = clamp(finite(options.base, 6.5), min, max);
  const speed = clamp01(finite(velocity, 0) / 1.5);
  const confidenceScale = 0.55 + clamp01(confidence) * 0.45;
  return clamp((base * (1.15 - speed * 0.5)) * confidenceScale, min, max);
}

export function depthVisual(depth = 0.5, confidence = 0) {
  const normalized = clamp01(depth);
  const strength = smoothstep(0.32, 0.78, clamp01(confidence));
  const signed = (0.5 - normalized) * 2;
  return {
    scale: 1 + signed * 0.22 * strength,
    opacity: clamp(0.76 + signed * 0.2 * strength, 0.42, 1),
    glow: clamp(0.55 + signed * 0.28 * strength, 0.2, 0.95),
    flattened: strength < 0.35
  };
}

export function classifyStroke(points = [], options = {}) {
  const clean = safePoints(points);
  if (options.recognizedText && options.recognitionSupported === true) {
    return { label: cleanText(options.recognizedText, 18), confidence: clamp01(options.confidence ?? 0.8), supported: true, kind: "text" };
  }
  if (clean.length >= 12) {
    const closure = lassoClosure(clean, { minimumArea: 0.012, maximumGap: 0.12 });
    const bounds = pointBounds(clean);
    const ratio = Math.min(bounds.width, bounds.height) / Math.max(bounds.width, bounds.height, 0.001);
    if (closure.valid && ratio > 0.58) return { label: "CIRCLE", confidence: clamp(0.72 + ratio * 0.23, 0, 0.96), supported: true, kind: "circle" };
  }
  if (looksLikeArrow(clean)) return { label: "ARROW", confidence: 0.84, supported: true, kind: "arrow" };
  return { label: "FREEFORM STROKE", confidence: 0.66, supported: true, kind: "freeform" };
}

export function lassoClosure(points = [], options = {}) {
  const clean = safePoints(points);
  const minimumArea = finite(options.minimumArea, 0.008);
  const maximumGap = finite(options.maximumGap, 0.085);
  if (clean.length < 4) return { valid: false, closed: false, area: 0, gap: 1, feedback: "Close the loop gently to select an object." };
  const bounds = pointBounds(clean);
  const gap = distance(clean[0], clean.at(-1));
  const adaptiveGap = Math.max(maximumGap, Math.hypot(bounds.width, bounds.height) * 0.18);
  const closed = gap <= adaptiveGap;
  const area = polygonArea(clean);
  const valid = closed && area >= minimumArea && bounds.width >= 0.06 && bounds.height >= 0.06;
  return {
    valid,
    closed,
    area,
    gap,
    feedback: valid ? "Loop closed" : closed ? "Make the loop a little wider." : "Close the loop gently to select an object."
  };
}

export function placeLabel(anchor = {}, size = {}, obstacles = [], viewport = {}) {
  const width = Math.max(24, finite(size.width, 120));
  const height = Math.max(18, finite(size.height, 32));
  const maxX = Math.max(0, finite(viewport.width, 1) - width);
  const maxY = Math.max(0, finite(viewport.height, 1) - height);
  const x = finite(anchor.x, 0);
  const y = finite(anchor.y, 0);
  const candidates = [
    { x: x + 14, y: y - height - 12 },
    { x: x + 18, y: y + 12 },
    { x: x - width - 18, y: y - height / 2 },
    { x: x - width / 2, y: y - height - 20 },
    { x: x - width / 2, y: y + 22 }
  ];
  for (let radius = 0; radius <= Math.max(finite(viewport.width, 1), finite(viewport.height, 1)); radius += 28) {
    if (radius) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        candidates.push({ x: x + Math.cos(angle) * radius - width / 2, y: y + Math.sin(angle) * radius - height / 2 });
      }
    }
    const available = candidates.splice(0);
    for (const candidate of available) {
      const rect = { x: clamp(candidate.x, 0, maxX), y: clamp(candidate.y, 0, maxY), width, height };
      if (!obstacles.some((item) => overlaps(rect, item))) return { ...rect, collides: false };
    }
  }
  return { x: clamp(x - width / 2, 0, maxX), y: clamp(y + 14, 0, maxY), width, height, collides: true };
}

export function normalizeRelations(result = {}, anchors = []) {
  const byId = new Map();
  for (const anchor of anchors) {
    if (anchor?.id) byId.set(String(anchor.id), anchor);
  }
  const output = [];
  const append = (raw, interaction = false) => {
    const predicate = normalizePredicate(raw?.predicate || raw?.relation || raw?.type, interaction);
    const definition = RELATIONS[predicate];
    if (!definition) return;
    const subjectId = cleanText(raw?.subject_id || raw?.hand_id || raw?.subject, 96);
    const referenceId = cleanText(raw?.object_id || raw?.reference_id || raw?.reference, 96);
    const subjectAnchor = byId.get(subjectId);
    const referenceAnchor = byId.get(referenceId);
    const subjectLabel = safeLabel(raw?.subject_label || raw?.hand_label || subjectAnchor?.label || (raw?.hand_id ? "Hand" : raw?.subject));
    const referenceLabel = safeLabel(raw?.object_label || raw?.reference_label || referenceAnchor?.label || raw?.reference);
    if (!subjectLabel || (!referenceLabel && predicate !== "closest_to_camera")) return;
    const label = predicate === "closest_to_camera"
      ? `${subjectLabel} — ${definition.phrase}`
      : `${subjectLabel} — ${definition.phrase} — ${referenceLabel}`;
    output.push({
      predicate,
      label,
      phrase: definition.phrase,
      directional: definition.directional,
      subjectId,
      referenceId,
      subjectLabel,
      referenceLabel,
      confidence: clamp01(raw?.confidence ?? 0.5)
    });
  };
  for (const relation of Array.isArray(result.relations) ? result.relations : []) append(relation, false);
  for (const interaction of Array.isArray(result.interactions) ? result.interactions : []) append(interaction, true);
  return dedupe(output, (item) => `${item.subjectId}:${item.predicate}:${item.referenceId}`).slice(0, 8);
}

export function createNeuralFieldRenderer(canvas, options = {}) {
  if (!canvas?.getContext) throw new TypeError("Neural Field requires a canvas.");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Neural Field Canvas2D is unavailable.");
  const clock = typeof options.now === "function" ? options.now : () => globalThis.performance?.now?.() ?? Date.now();
  const requestFrame = options.requestAnimationFrame || globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame = options.cancelAnimationFrame || globalThis.cancelAnimationFrame?.bind(globalThis);
  const maxPathPoints = clamp(Math.round(finite(options.maxPathPoints, 512)), 64, 1_024);
  const anchorSmoothing = clamp01(options.anchorSmoothing ?? 0.28);
  const state = {
    active: false,
    running: false,
    disposed: false,
    loopStarts: 0,
    rafId: null,
    dpr: 1,
    width: 0,
    height: 0,
    tool: "airscript",
    status: STATUS.ready,
    message: "",
    reducedMotion: options.reducedMotion === true,
    paths: { liveEvidence: [], liveStabilized: [], completed: [] },
    lasso: { points: [], valid: false, feedback: "", completedAt: 0 },
    anchors: [],
    relations: [],
    faceBounds: [],
    labelLayouts: [],
    pinching: false,
    trackingFrames: 0,
    trackingAvailable: true,
    relationSignature: "",
    relationPulseUntil: 0,
    renderTimes: [],
    frameTimes: [],
    lastTimestamp: 0,
    labelLayoutMs: 0,
    relationUpdateMs: 0,
    frameConsumers: new Set(),
    lastNotified: ""
  };

  const api = {
    start,
    stop,
    dispose,
    setActive,
    setTool,
    setReducedMotion,
    ingestHandFrame,
    ingestSpatialResult,
    setTrackingAvailability,
    setFaceBounds,
    dismissOverlay,
    loadFixture,
    renderOnce,
    getSnapshot,
    getMetrics,
    getCanvas: () => canvas,
    registerFrameConsumer
  };
  return api;

  function start() {
    if (state.disposed || state.running) return api;
    state.running = true;
    state.loopStarts += 1;
    if (typeof requestFrame === "function") state.rafId = requestFrame(tick);
    return api;
  }

  function tick(timestamp) {
    state.rafId = null;
    if (!state.running || state.disposed) return;
    try {
      renderOnce(timestamp);
    } finally {
      if (state.running && typeof requestFrame === "function") state.rafId = requestFrame(tick);
    }
  }

  function stop() {
    if (state.rafId != null && typeof cancelFrame === "function") cancelFrame(state.rafId);
    state.rafId = null;
    state.running = false;
    return api;
  }

  function dispose() {
    if (state.disposed) return;
    stop();
    state.active = false;
    state.disposed = true;
    state.paths.liveEvidence.length = 0;
    state.paths.liveStabilized.length = 0;
    state.paths.completed.length = 0;
    state.lasso = { points: [], valid: false, feedback: "", completedAt: 0 };
    state.anchors.length = 0;
    state.relations.length = 0;
    state.labelLayouts.length = 0;
    state.frameConsumers.clear();
    context.clearRect?.(0, 0, canvas.width || 0, canvas.height || 0);
    canvas.width = 0;
    canvas.height = 0;
    notify(true);
  }

  function setActive(active) {
    if (state.disposed && active) return api;
    state.active = active === true;
    if (!state.active) {
      state.pinching = false;
      state.status = STATUS.ready;
      state.message = "";
      stop();
    }
    notify();
    return api;
  }

  function setTool(tool) {
    const normalized = tool === "spatial-lasso" ? "spatial-lasso" : "airscript";
    if (state.tool === normalized) return api;
    state.tool = normalized;
    state.pinching = false;
    state.paths.liveEvidence = [];
    state.paths.liveStabilized = [];
    state.lasso = { points: [], valid: false, feedback: "", completedAt: 0 };
    setStatus(STATUS.ready, "");
    return api;
  }

  function setReducedMotion(value) {
    state.reducedMotion = value === true;
    if (state.reducedMotion) state.relationPulseUntil = 0;
    notify();
    return api;
  }

  function ingestHandFrame(frame = {}) {
    if (!state.active || state.disposed || !state.trackingAvailable) return api;
    const hand = Array.isArray(frame.hands) ? frame.hands[0] : null;
    const suppliedLandmarks = Array.isArray(frame.landmarks)
      ? (Array.isArray(frame.landmarks[0]) ? frame.landmarks[0] : frame.landmarks)
      : [];
    const landmarks = Array.isArray(hand?.landmarks) ? hand.landmarks : suppliedLandmarks;
    const index = landmarks[8];
    const thumb = landmarks[4];
    if (!index || !finitePoint(index)) {
      if (state.pinching) completeLivePath(finite(frame.timestamp_ms, clock()));
      state.trackingFrames = 0;
      setStatus(STATUS.ready, "");
      return api;
    }
    const confidence = clamp01(hand?.confidence ?? frame.confidence ?? index.visibility ?? index.presence ?? 0.8);
    const timestamp = finite(frame.timestamp_ms, clock());
    const x = clamp01(frame.mirrored === true ? 1 - Number(index.x) : Number(index.x));
    const rawDepth = Number(index.z);
    const hasNormalizedDepth = Number.isFinite(rawDepth) && rawDepth >= 0 && rawDepth <= 1;
    const point = {
      x,
      y: clamp01(index.y),
      depth: hasNormalizedDepth ? rawDepth : 0.5,
      confidence,
      depthConfidence: hasNormalizedDepth ? confidence * 0.72 : 0,
      timestamp
    };
    const pinching = typeof frame.pinching === "boolean"
      ? frame.pinching
      : Boolean(thumb && finitePoint(thumb) && distance(index, thumb) <= 0.065);
    if (confidence < 0.42) {
      if (state.pinching) completeLivePath(timestamp);
      setStatus(STATUS.uncertain, "Keep your hand steady in view.");
      return api;
    }
    state.trackingFrames += 1;
    if (pinching) {
      if (!state.pinching) {
        state.paths.liveEvidence = [];
        state.paths.liveStabilized = [];
        state.lasso = { points: [], valid: false, feedback: "", completedAt: 0 };
      }
      appendPoint(point);
      state.pinching = true;
      setStatus(STATUS.drawing, "");
    } else if (state.pinching) {
      completeLivePath(timestamp);
    } else {
      state.pinching = false;
      setStatus(state.trackingFrames < 2 ? STATUS.tracking : STATUS.pinch, "");
    }
    return api;
  }

  function appendPoint(point) {
    const evidence = state.paths.liveEvidence;
    const previous = evidence.at(-1);
    if (previous && distance(previous, point) < 0.0015 && point.timestamp - previous.timestamp < 24) return;
    evidence.push(point);
    if (evidence.length > maxPathPoints) evidence.splice(0, evidence.length - maxPathPoints);
    const stabilized = state.paths.liveStabilized;
    const last = stabilized.at(-1);
    const alpha = last ? clamp(0.24 + point.confidence * 0.34, 0.24, 0.62) : 1;
    stabilized.push(last ? {
      ...point,
      x: lerp(last.x, point.x, alpha),
      y: lerp(last.y, point.y, alpha),
      depth: lerp(last.depth, point.depth, point.depthConfidence > 0.35 ? alpha * 0.72 : 0.12)
    } : { ...point });
    if (stabilized.length > maxPathPoints) stabilized.splice(0, stabilized.length - maxPathPoints);
    if (state.tool === "spatial-lasso") state.lasso.points = stabilized.map(copyPoint);
  }

  function completeLivePath(timestamp) {
    state.pinching = false;
    const evidence = state.paths.liveEvidence.map(copyPoint);
    const polished = simplifyPath(state.paths.liveStabilized, 0.0045);
    if (state.tool === "spatial-lasso") {
      const closure = lassoClosure(polished);
      state.lasso = { points: polished, valid: closure.valid, feedback: closure.feedback, completedAt: timestamp };
      if (!closure.valid) setStatus(STATUS.uncertain, closure.feedback);
      else {
        setStatus(STATUS.grounding, "");
        resolveLassoSelection(timestamp);
      }
    } else if (polished.length >= 2) {
      const classification = classifyStroke(polished);
      state.paths.completed.push({
        evidence,
        points: polished,
        label: classification.label,
        confidence: classification.confidence,
        createdAt: timestamp,
        evidenceUntil: timestamp + (state.reducedMotion ? 1 : 1_400),
        expiresAt: timestamp + 6_000
      });
      if (state.paths.completed.length > MAX_STROKES) state.paths.completed.splice(0, state.paths.completed.length - MAX_STROKES);
      setStatus(STATUS.complete, classification.confidence >= 0.7 ? `${classification.label} · ${Math.round(classification.confidence * 100)}%` : "");
      state.paths.liveEvidence = [];
      state.paths.liveStabilized = [];
    } else {
      setStatus(STATUS.pinch, "");
    }
  }

  function ingestSpatialResult(result = {}) {
    if (state.disposed) return api;
    const relationStarted = clock();
    const selectionOutcome = String(result.selection_status || result.selection?.status || result.lasso?.status || result.code || "").toLowerCase();
    const unsupportedSelection = /unsupported|no[_-]?object|not[_-]?grounded/.test(selectionOutcome);
    if (result.lasso && typeof result.lasso === "object") {
      const points = safePoints(result.lasso.points);
      const closure = result.lasso.valid === true ? { valid: true, feedback: "Loop closed" } : lassoClosure(points);
      state.lasso = {
        points,
        valid: result.lasso.valid === true || closure.valid,
        feedback: cleanText(result.lasso.feedback || closure.feedback, 160),
        completedAt: finite(result.timestamp_ms, clock())
      };
    }
    const timestamp = finite(result.timestamp_ms, state.lastTimestamp || clock());
    updateAvoidanceBounds(result);
    if (unsupportedSelection) {
      state.anchors = [];
      state.relations = [];
      state.relationSignature = "";
      if (state.lasso.points.length) state.lasso.fadeUntil = timestamp + (state.reducedMotion ? 1 : 620);
      state.relationUpdateMs = Math.max(0, clock() - relationStarted);
      setStatus(STATUS.uncertain, "No visible object could be grounded there.");
      notify();
      return api;
    }
    const entities = normalizeEntities(result);
    const seen = new Set();
    const selectedId = selectedObjectId(result);
    for (const entity of entities) {
      seen.add(entity.id);
      const existing = state.anchors.find((anchor) => anchor.id === entity.id);
      const selected = selectedId != null && String(selectedId) === entity.id;
      const uncertain = entity.confidence < 0.58 || result.uncertainty?.level === "high";
      const nextState = selected ? "selected" : uncertain ? "tracking uncertain" : "tracking";
      if (existing) {
        existing.targetBounds = entity.bounds;
        existing.confidence = entity.confidence;
        existing.depth = entity.depth;
        existing.depthConfidence = entity.depthConfidence;
        existing.state = nextState;
        existing.lastSeenAt = timestamp;
        existing.lostAt = 0;
      } else {
        state.anchors.push({ ...entity, targetBounds: { ...entity.bounds }, bounds: { ...entity.bounds }, state: nextState, lastSeenAt: timestamp, lostAt: 0 });
      }
    }
    for (const anchor of state.anchors) {
      if (!seen.has(anchor.id)) {
        anchor.state = "lost";
        anchor.lostAt ||= timestamp;
      }
    }
    const relations = normalizeRelations(result, state.anchors);
    const signature = relations.map((item) => `${item.subjectId}:${item.predicate}:${item.referenceId}`).join("|");
    if (signature && signature !== state.relationSignature && !state.reducedMotion) state.relationPulseUntil = timestamp + 650;
    state.relationSignature = signature;
    state.relations = relations;
    state.relationUpdateMs = Math.max(0, clock() - relationStarted);
    if (state.lasso.valid) resolveLassoSelection(timestamp);
    else if (relations.length) setStatus(STATUS.relation, relations[0].label);
    else if (state.anchors.some((item) => item.state === "selected")) setStatus(STATUS.selected, "");
    else if (state.anchors.some((item) => item.state === "tracking uncertain")) setStatus(STATUS.uncertain, "Keep the object steady in view.");
    notify();
    return api;
  }

  function resolveLassoSelection(timestamp) {
    if (!state.lasso.valid || state.lasso.points.length < 4) return;
    const candidates = state.anchors.filter((anchor) => anchor.state !== "lost" && pointInPolygon(centerOf(anchor.bounds), state.lasso.points));
    if (candidates.length === 1) {
      for (const anchor of state.anchors) anchor.state = anchor === candidates[0] ? "selected" : anchor.state === "selected" ? "tracking" : anchor.state;
      state.lasso.feedback = "Object selected";
      state.lasso.completedAt = timestamp;
      state.lasso.resolvedAnchorId = candidates[0].id;
      setStatus(STATUS.selected, candidates[0].label);
    } else if (candidates.length > 1) {
      state.lasso.feedback = "Tighten the loop around one object.";
      setStatus(STATUS.uncertain, state.lasso.feedback);
    } else if (state.anchors.length) {
      state.lasso.feedback = "No visible object could be grounded there.";
      setStatus(STATUS.uncertain, state.lasso.feedback);
    } else {
      setStatus(STATUS.grounding, "");
    }
  }

  function setTrackingAvailability(value) {
    const available = typeof value === "object" ? value.available !== false : value !== false;
    state.trackingAvailable = available;
    if (!available) {
      const timestamp = state.lastTimestamp || clock();
      for (const anchor of state.anchors) {
        anchor.state = "lost";
        anchor.lostAt ||= timestamp;
      }
      setStatus(STATUS.unavailable, typeof value === "object" ? cleanText(value.reason, 120) : "");
    } else if (state.active && state.status === STATUS.unavailable) {
      setStatus(STATUS.ready, "");
    }
    return api;
  }

  function setFaceBounds(bounds) {
    const list = Array.isArray(bounds) ? bounds : bounds ? [bounds] : [];
    state.faceBounds = list.map((item) => rectObject(item)).filter(Boolean).slice(0, 4);
    notify();
    return api;
  }

  function updateAvoidanceBounds(result) {
    const suppliesFaceBounds = ["faces", "people"].some((key) => Object.hasOwn(result, key));
    const hands = safeArray(result.hands);
    if (!suppliesFaceBounds && hands.length === 0) return;
    const candidates = [
      ...safeArray(result.faces),
      ...safeArray(result.people).filter((item) => /face|person/i.test(String(item?.label || "person"))),
      ...hands
    ];
    setFaceBounds(candidates.map((item) => bboxRect(item.bbox || item.bounds)).filter(Boolean));
  }

  function avoidanceBoundsInPixels() {
    return state.faceBounds.map((rect) => {
      const normalized = rect.x >= 0 && rect.y >= 0
        && rect.x + rect.width <= 1.0001
        && rect.y + rect.height <= 1.0001;
      return normalized ? normalizedToPixels(rect, state.width, state.height) : rect;
    });
  }

  function dismissOverlay() {
    state.message = "";
    if (state.lasso.feedback && !state.lasso.valid) state.lasso.feedback = "";
    notify(true);
    return api;
  }

  function loadFixture(name) {
    state.paths = { liveEvidence: [], liveStabilized: [], completed: [] };
    state.lasso = { points: [], valid: false, feedback: "", completedAt: 0 };
    state.anchors = [];
    state.relations = [];
    state.faceBounds = [];
    state.labelLayouts = [];
    const timestamp = clock();
    if (name === "reduced-motion") {
      state.reducedMotion = true;
      name = "airscript";
    }
    if (name === "airscript") {
      const circle = fixtureCircle();
      const arrow = fixtureArrow();
      const ai = fixtureAi();
      state.paths.liveEvidence = circle.map((item, index) => ({ ...item, x: item.x + Math.sin(index * 1.7) * 0.004 }));
      state.paths.liveStabilized = circle.map(copyPoint);
      state.paths.completed = [
        fixtureStroke(circle, "CIRCLE", 0.94),
        fixtureStroke(arrow, "ARROW", 0.88),
        fixtureStroke(ai, "AI", 0.91)
      ];
      setStatus(STATUS.complete, "CIRCLE · 94%");
    } else if (name === "lasso-selected") {
      state.tool = "spatial-lasso";
      state.anchors = [fixtureAnchor("mug", "Mug", [0.38, 0.31, 0.57, 0.67], "selected", 0.93)];
      state.lasso = { points: fixtureLasso([0.33, 0.25, 0.62, 0.74]), valid: true, feedback: "Object selected", completedAt: timestamp, resolvedAnchorId: "mug" };
      setStatus(STATUS.selected, "Mug");
    } else if (name === "relation") {
      state.anchors = [
        fixtureAnchor("mug", "Mug", [0.18, 0.38, 0.34, 0.68], "selected", 0.94, 0.42),
        fixtureAnchor("laptop", "Laptop", [0.61, 0.34, 0.87, 0.7], "selected", 0.91, 0.62),
        fixtureAnchor("hand", "Hand", [0.37, 0.49, 0.49, 0.72], "tracking", 0.88, 0.36)
      ];
      state.relations = normalizeRelations({
        relations: [{ subject_id: "mug", relation: "left_of", reference_id: "laptop", confidence: 0.94 }],
        interactions: [{ hand_id: "hand", predicate: "hand_approaching_object", object_id: "mug", confidence: 0.88 }]
      }, state.anchors);
      state.relationSignature = state.relations.map((item) => `${item.subjectId}:${item.predicate}:${item.referenceId}`).join("|");
      state.relationPulseUntil = state.reducedMotion ? 0 : timestamp + 650;
      setStatus(STATUS.relation, state.relations.map((item) => item.label).join(". "));
    } else if (name === "ambiguous") {
      state.tool = "spatial-lasso";
      state.anchors = [
        fixtureAnchor("mug", "Mug", [0.34, 0.34, 0.49, 0.65], "tracking", 0.78),
        fixtureAnchor("bottle", "Bottle", [0.51, 0.3, 0.64, 0.67], "tracking", 0.74)
      ];
      state.lasso = { points: fixtureLasso([0.27, 0.22, 0.7, 0.74]), valid: true, feedback: "Tighten the loop around one object.", completedAt: timestamp };
      setStatus(STATUS.uncertain, state.lasso.feedback);
    } else if (name === "uncertain") {
      state.anchors = [fixtureAnchor("mug", "Mug", [0.4, 0.34, 0.61, 0.68], "tracking uncertain", 0.44)];
      setStatus(STATUS.uncertain, "Keep the object steady in view.");
    }
    notify(true);
    return api;
  }

  function renderOnce(timestamp = clock()) {
    if (state.disposed) return getSnapshot();
    const started = clock();
    state.lastTimestamp = finite(timestamp, clock());
    resizeCanvas();
    updateAnchors(state.lastTimestamp);
    pruneStrokes(state.lastTimestamp);
    context.save?.();
    context.setTransform?.(state.dpr, 0, 0, state.dpr, 0, 0);
    context.clearRect?.(0, 0, state.width, state.height);
    state.labelLayouts = [];
    drawCompletedStrokes(state.lastTimestamp);
    drawLivePath();
    drawLasso(state.lastTimestamp);
    drawRelations(state.lastTimestamp);
    drawAnchors();
    context.restore?.();
    for (const consumer of state.frameConsumers) {
      try {
        consumer({ timestamp: state.lastTimestamp, sourceCanvas: canvas, renderer: api });
      } catch {
        // Optional local consumers must never interrupt the sole renderer loop.
      }
    }
    const elapsed = Math.max(0, clock() - started);
    state.renderTimes.push(elapsed);
    if (state.renderTimes.length > 180) state.renderTimes.shift();
    state.frameTimes.push(state.lastTimestamp);
    if (state.frameTimes.length > 120) state.frameTimes.shift();
    notify();
    return getSnapshot();
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect?.() || {};
    const width = Math.max(1, Math.round(finite(canvas.clientWidth, rect.width || canvas.width || 1)));
    const height = Math.max(1, Math.round(finite(canvas.clientHeight, rect.height || canvas.height || 1)));
    const dpr = clamp(finite(options.devicePixelRatio, globalThis.devicePixelRatio || 1), 1, 3);
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    state.width = width;
    state.height = height;
    state.dpr = dpr;
  }

  function updateAnchors(timestamp) {
    for (const anchor of state.anchors) {
      if (anchor.state === "lost") continue;
      const alpha = state.reducedMotion ? 1 : clamp(anchorSmoothing * (0.75 + anchor.confidence * 0.5), 0.08, 0.58);
      for (const key of ["x", "y", "width", "height"]) anchor.bounds[key] = lerp(anchor.bounds[key], anchor.targetBounds[key], alpha);
    }
    state.anchors = state.anchors.filter((anchor) => anchor.state !== "lost" || timestamp - anchor.lostAt <= LOST_GRACE_MS);
  }

  function pruneStrokes(timestamp) {
    state.paths.completed = state.paths.completed.filter((stroke) => !Number.isFinite(stroke.expiresAt) || timestamp <= stroke.expiresAt);
  }

  function drawCompletedStrokes(timestamp) {
    for (const stroke of state.paths.completed) {
      const age = Math.max(0, timestamp - finite(stroke.createdAt, timestamp));
      const fade = Number.isFinite(stroke.expiresAt) ? clamp01((stroke.expiresAt - timestamp) / 1_000) : 1;
      if (timestamp <= finite(stroke.evidenceUntil, 0)) drawPath(stroke.evidence, { evidence: true, alpha: 0.32 * fade });
      const resolveProgress = state.reducedMotion ? 1 : smoothstep(0, 480, age);
      drawPath(stroke.points, { alpha: (0.58 + resolveProgress * 0.38) * fade, polished: true, resolved: resolveProgress });
      if (stroke.label && stroke.points.length) drawStrokeLabel(stroke, fade);
    }
  }

  function drawLivePath() {
    if (state.paths.liveEvidence.length > 1) drawPath(state.paths.liveEvidence, { evidence: true, alpha: 0.42 });
    if (state.paths.liveStabilized.length > 1) drawPath(state.paths.liveStabilized, { polished: true, alpha: 1 });
  }

  function drawPath(points, options = {}) {
    if (!Array.isArray(points) || points.length < 2) return;
    const pixel = points.map((item) => ({ ...item, x: item.x * state.width, y: item.y * state.height }));
    context.save?.();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.globalAlpha = options.alpha ?? 1;
    if (options.evidence) {
      context.setLineDash?.([3, 7]);
      context.lineWidth = 1.15;
      context.strokeStyle = "rgba(207, 199, 255, 0.55)";
      trace(pixel);
      context.stroke?.();
      context.restore?.();
      return;
    }
    if (options.polished && !state.reducedMotion) {
      context.setLineDash?.([]);
      context.lineWidth = 13;
      context.strokeStyle = "rgba(94, 70, 222, 0.16)";
      context.shadowBlur = 18;
      context.shadowColor = "rgba(104, 78, 239, 0.5)";
      trace(pixel);
      context.stroke?.();
      context.shadowBlur = 0;
    }
    context.setLineDash?.([]);
    for (let index = 1; index < pixel.length; index += 1) {
      const from = pixel[index - 1];
      const to = pixel[index];
      const dt = Math.max(8, finite(to.timestamp, index * 16) - finite(from.timestamp, (index - 1) * 16));
      const velocity = distance(from, to) / dt * 80;
      const depth = depthVisual(to.depth, to.depthConfidence ?? to.confidence * 0.5);
      const taper = clamp(Math.min(index / 4, (pixel.length - index) / 4), 0.18, 1);
      context.beginPath?.();
      context.moveTo?.(from.x, from.y);
      context.lineTo?.(to.x, to.y);
      context.lineWidth = velocityWidth(velocity, to.confidence, { min: 1.3, max: 10, base: 6.2 }) * depth.scale * taper;
      context.globalAlpha = (options.alpha ?? 1) * depth.opacity;
      const mix = index / Math.max(1, pixel.length - 1);
      context.strokeStyle = mix < 0.5 ? "#5f45e6" : "#343ad1";
      context.stroke?.();
    }
    if (!state.reducedMotion) drawSparks(pixel, options.alpha ?? 1);
    context.restore?.();
  }

  function trace(points) {
    context.beginPath?.();
    context.moveTo?.(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) context.lineTo?.(points[index].x, points[index].y);
  }

  function drawSparks(points, alpha) {
    for (const [point, radius] of [[points[0], 2], [points.at(-1), 2.6]]) {
      context.beginPath?.();
      context.globalAlpha = 0.6 * alpha;
      context.fillStyle = "#c6bfff";
      context.arc?.(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill?.();
    }
  }

  function drawStrokeLabel(stroke, alpha) {
    const point = stroke.points.at(-1);
    const label = `${stroke.label}${stroke.confidence >= 0.7 ? ` · ${Math.round(stroke.confidence * 100)}%` : ""}`;
    const width = Math.min(180, 28 + label.length * 6.6);
    const layout = placeLabel({ x: point.x * state.width, y: point.y * state.height }, { width, height: 25 }, [...avoidanceBoundsInPixels(), ...state.labelLayouts], { width: state.width, height: state.height });
    state.labelLayouts.push(layout);
    drawLabel(layout, label, alpha * 0.88);
  }

  function drawLasso(timestamp) {
    if (state.tool !== "spatial-lasso" || state.lasso.points.length < 2) return;
    if (state.lasso.fadeUntil && timestamp >= state.lasso.fadeUntil) return;
    let normalizedPoints = state.lasso.points;
    const resolvedAnchor = state.anchors.find((anchor) => anchor.id === state.lasso.resolvedAnchorId && anchor.state !== "lost");
    const resolvedElapsed = resolvedAnchor ? Math.max(0, timestamp - state.lasso.completedAt) : 0;
    let alpha = state.lasso.fadeUntil
      ? clamp((state.lasso.fadeUntil - timestamp) / 620, 0, 1)
      : 1;
    if (resolvedAnchor) {
      const progress = state.reducedMotion ? 1 : smoothstep(0, 520, resolvedElapsed);
      const center = centerOf(resolvedAnchor.bounds);
      const radiusX = Math.min(0.48, resolvedAnchor.bounds.width / 2 + 0.025);
      const radiusY = Math.min(0.48, resolvedAnchor.bounds.height / 2 + 0.035);
      normalizedPoints = state.lasso.points.map((point, index) => {
        const angle = index / Math.max(1, state.lasso.points.length - 1) * Math.PI * 2;
        const target = { x: center.x + Math.cos(angle) * radiusX, y: center.y + Math.sin(angle) * radiusY };
        return { ...point, x: lerp(point.x, target.x, progress), y: lerp(point.y, target.y, progress) };
      });
      if (!state.reducedMotion && resolvedElapsed > 520) alpha *= clamp(1 - (resolvedElapsed - 520) / 900, 0, 1);
      else if (state.reducedMotion) alpha *= 0.42;
    }
    if (alpha <= 0.01) return;
    const points = normalizedPoints.map((item) => ({ ...item, x: item.x * state.width, y: item.y * state.height }));
    context.save?.();
    context.globalAlpha = alpha;
    if (state.lasso.valid) {
      trace(points);
      context.closePath?.();
      context.fillStyle = "rgba(92, 70, 220, 0.11)";
      context.globalAlpha = alpha;
      context.fill?.();
    }
    context.setLineDash?.(state.lasso.valid ? [] : [7, 8]);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = state.lasso.valid ? 3 : 2;
    context.strokeStyle = state.lasso.valid ? "rgba(139, 117, 255, 0.94)" : "rgba(198, 188, 255, 0.7)";
    trace(points);
    if (state.lasso.valid) context.closePath?.();
    context.stroke?.();
    if (state.lasso.valid && !state.reducedMotion && timestamp - state.lasso.completedAt < 520) {
      context.globalAlpha = 0.28 * alpha;
      context.lineWidth = 8;
      context.stroke?.();
    }
    context.restore?.();
  }

  function drawAnchors() {
    const started = clock();
    const obstacles = avoidanceBoundsInPixels();
    const sorted = [...state.anchors].sort((first, second) => second.depth - first.depth);
    for (const anchor of sorted) {
      const rect = normalizedToPixels(anchor.bounds, state.width, state.height);
      const uncertain = anchor.state === "tracking uncertain" || anchor.state === "lost";
      context.save?.();
      context.globalAlpha = anchor.state === "lost" ? 0.24 : uncertain ? 0.64 : 0.92;
      context.lineWidth = anchor.state === "selected" ? 2 : 1.25;
      context.strokeStyle = anchor.state === "selected" ? "rgba(173, 159, 255, 0.96)" : "rgba(197, 190, 255, 0.72)";
      context.setLineDash?.(uncertain ? [5, 6] : []);
      context.beginPath?.();
      if (typeof context.roundRect === "function") context.roundRect(rect.x, rect.y, rect.width, rect.height, 12);
      else context.rect?.(rect.x, rect.y, rect.width, rect.height);
      context.stroke?.();
      const center = centerOf(rect);
      context.setLineDash?.([]);
      context.beginPath?.();
      context.fillStyle = anchor.state === "selected" ? "#a999ff" : "rgba(223, 218, 255, 0.82)";
      context.arc?.(center.x, center.y, anchor.state === "selected" ? 3.2 : 2.3, 0, Math.PI * 2);
      context.fill?.();
      context.restore?.();
      const stateLabel = uncertain ? ` · ${anchor.state === "lost" ? "Lost" : "Tracking uncertain"}` : "";
      const label = `${anchor.label}${stateLabel}`;
      const layout = placeLabel({ x: rect.x + rect.width, y: rect.y }, { width: Math.min(190, 28 + label.length * 6.5), height: 27 }, [...obstacles, ...state.labelLayouts], { width: state.width, height: state.height });
      state.labelLayouts.push(layout);
      drawLabel(layout, label, anchor.state === "lost" ? 0.38 : 0.94);
    }
    state.labelLayoutMs = Math.max(0, clock() - started);
  }

  function drawRelations(timestamp) {
    const obstacles = avoidanceBoundsInPixels();
    for (const relation of state.relations) {
      const subject = state.anchors.find((item) => item.id === relation.subjectId || item.label === relation.subjectLabel);
      const reference = state.anchors.find((item) => item.id === relation.referenceId || item.label === relation.referenceLabel);
      if (!subject || (!reference && relation.predicate !== "closest_to_camera")) continue;
      const from = centerOf(normalizedToPixels(subject.bounds, state.width, state.height));
      const to = reference ? centerOf(normalizedToPixels(reference.bounds, state.width, state.height)) : { x: from.x, y: Math.max(20, from.y - state.height * 0.2) };
      let control = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - Math.min(60, Math.abs(to.x - from.x) * 0.12 + 24) };
      for (const face of obstacles) {
        if (containsPoint(face, control) || containsPoint(face, quadraticPoint(from, control, to, 0.5)) || segmentIntersectsRect(from, to, face)) {
          const routedY = face.y >= 28 ? face.y - 24 : Math.min(state.height - 24, face.y + face.height + 24);
          control = { x: clamp(face.x + face.width / 2, 18, state.width - 18), y: routedY };
        }
      }
      const pulse = !state.reducedMotion && timestamp < state.relationPulseUntil ? (state.relationPulseUntil - timestamp) / 650 : 0;
      context.save?.();
      context.beginPath?.();
      context.moveTo?.(from.x, from.y);
      context.quadraticCurveTo?.(control.x, control.y, to.x, to.y);
      context.lineWidth = 1.6 + Math.max(0, pulse) * 1.4;
      context.strokeStyle = "rgba(166, 151, 255, 0.86)";
      context.globalAlpha = 0.74 + Math.max(0, pulse) * 0.2;
      context.stroke?.();
      if (relation.directional) drawArrow(control, to);
      context.restore?.();
      const midpoint = quadraticPoint(from, control, to, 0.5);
      const layout = placeLabel(midpoint, { width: Math.min(230, 34 + relation.label.length * 6.2), height: 27 }, [...obstacles, ...state.labelLayouts], { width: state.width, height: state.height });
      state.labelLayouts.push(layout);
      drawLabel(layout, relation.label, 0.94);
    }
  }

  function drawArrow(from, to) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 8;
    context.beginPath?.();
    context.moveTo?.(to.x, to.y);
    context.lineTo?.(to.x - Math.cos(angle - 0.48) * size, to.y - Math.sin(angle - 0.48) * size);
    context.lineTo?.(to.x - Math.cos(angle + 0.48) * size, to.y - Math.sin(angle + 0.48) * size);
    context.closePath?.();
    context.fillStyle = "rgba(181, 168, 255, 0.92)";
    context.fill?.();
  }

  function drawLabel(rect, text, alpha) {
    context.save?.();
    context.globalAlpha = alpha;
    context.fillStyle = "rgba(13, 13, 31, 0.86)";
    context.beginPath?.();
    if (typeof context.roundRect === "function") context.roundRect(rect.x, rect.y, rect.width, rect.height, 8);
    else context.rect?.(rect.x, rect.y, rect.width, rect.height);
    context.fill?.();
    context.fillStyle = "#f7f5ff";
    context.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText?.(cleanText(text, 80), rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width - 12);
    context.restore?.();
  }

  function registerFrameConsumer(consumer) {
    if (typeof consumer !== "function" || state.disposed) return () => {};
    state.frameConsumers.add(consumer);
    return () => state.frameConsumers.delete(consumer);
  }

  function setStatus(status, message) {
    state.status = status;
    state.message = cleanText(message, 180);
    notify();
  }

  function notify(force = false) {
    if (typeof options.onStateChange !== "function") return;
    const signature = `${state.active}|${state.disposed}|${state.tool}|${state.status}|${state.message}|${state.relations.map((item) => item.label).join("|")}`;
    if (!force && signature === state.lastNotified) return;
    state.lastNotified = signature;
    options.onStateChange(getSnapshot());
  }

  function getSnapshot() {
    return clone({
      active: state.active,
      running: state.running,
      disposed: state.disposed,
      loopStarts: state.loopStarts,
      dpr: state.dpr,
      width: state.width,
      height: state.height,
      tool: state.tool,
      status: state.status,
      message: state.message,
      reducedMotion: state.reducedMotion,
      paths: state.paths,
      lasso: state.lasso,
      anchors: state.anchors.map(({ id, label, state: anchorState, bounds, confidence }) => ({ id, label, state: anchorState, bounds, confidence })),
      relations: state.relations,
      faceBounds: state.faceBounds,
      labelLayouts: state.labelLayouts
    });
  }

  function getMetrics() {
    const renderTimes = [...state.renderTimes].sort((a, b) => a - b);
    const duration = state.frameTimes.length > 1 ? state.frameTimes.at(-1) - state.frameTimes[0] : 0;
    const fps = duration > 0 ? (state.frameTimes.length - 1) * 1_000 / duration : 0;
    return {
      fps: finite(fps, 0),
      p95RenderMs: percentile(renderTimes, 0.95),
      pathPointCount: countPoints(state),
      canvasMemoryBytes: Math.max(0, Number(canvas.width || 0) * Number(canvas.height || 0) * 4),
      labelLayoutMs: state.labelLayoutMs,
      relationUpdateMs: state.relationUpdateMs,
      disposed: state.disposed
    };
  }
}

function normalizeEntities(result) {
  const list = [];
  for (const item of safeArray(result.objects)) {
    const bounds = bboxRect(item.bbox || item.bounds || item.normalized_region);
    const id = cleanText(item.id || item.track_id || item.label, 96);
    const label = safeLabel(item.label);
    if (!bounds || !id || !label) continue;
    list.push({ id, label, bounds, confidence: clamp01(item.confidence ?? 0.5), depth: clamp01(item.relative_depth ?? 0.5), depthConfidence: clamp01(item.depth_confidence ?? 0.2), role: "object" });
  }
  for (const item of safeArray(result.hands)) {
    const bounds = bboxRect(item.bbox || item.bounds);
    const id = cleanText(item.id || item.hand_id || item.handedness || `hand_${list.length}`, 96);
    if (!bounds || !id) continue;
    list.push({ id, label: safeLabel(item.label || `${item.handedness || ""} Hand`) || "Hand", bounds, confidence: clamp01(item.confidence ?? 0.5), depth: clamp01(item.relative_depth ?? 0.5), depthConfidence: clamp01(item.depth_confidence ?? 0.2), role: "hand" });
  }
  return list.slice(0, 24);
}

function selectedObjectId(result) {
  return result.selected_object_id
    ?? result.selection?.object_id
    ?? result.selection?.selected_object_id
    ?? result.lasso?.object_id
    ?? result.lasso?.selected_object_id
    ?? null;
}

function normalizePredicate(value, interaction) {
  const raw = cleanText(value, 64).toLowerCase().replace(/\s+/g, "_");
  if (["hand_approaches_object", "hand_approaching_object", "approaches", "approaching"].includes(raw)) return "approaching";
  if (["hand_moves_away", "hand_moving_away_from_object", "moves_away", "moving_away"].includes(raw)) return "moving_away";
  if (interaction && raw === "hand_holding_object") return "near";
  return raw;
}

function looksLikeArrow(points) {
  if (points.length < 6) return false;
  const start = points[0];
  let tipIndex = 1;
  let tipDistance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const current = distance(start, points[index]);
    if (current > tipDistance) {
      tipDistance = current;
      tipIndex = index;
    }
  }
  if (tipDistance < 0.24 || tipIndex < Math.floor(points.length * 0.45)) return false;
  const tip = points[tipIndex];
  const revisited = points.slice(tipIndex + 1).some((item) => distance(item, tip) < 0.035);
  const tailTurns = pathTurnCount(points.slice(Math.max(0, tipIndex - 1))) >= 2;
  return revisited && tailTurns;
}

function pathTurnCount(points) {
  let turns = 0;
  for (let index = 2; index < points.length; index += 1) {
    const first = Math.atan2(points[index - 1].y - points[index - 2].y, points[index - 1].x - points[index - 2].x);
    const second = Math.atan2(points[index].y - points[index - 1].y, points[index].x - points[index - 1].x);
    if (Math.abs(angleDelta(first, second)) > 0.45) turns += 1;
  }
  return turns;
}

function simplifyPath(points, epsilon) {
  if (points.length <= 2) return points.map(copyPoint);
  let farthest = 0;
  let index = 0;
  for (let candidate = 1; candidate < points.length - 1; candidate += 1) {
    const distanceToLine = perpendicularDistance(points[candidate], points[0], points.at(-1));
    if (distanceToLine > farthest) {
      farthest = distanceToLine;
      index = candidate;
    }
  }
  if (farthest <= epsilon) return [copyPoint(points[0]), copyPoint(points.at(-1))];
  const left = simplifyPath(points.slice(0, index + 1), epsilon);
  const right = simplifyPath(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right].slice(0, 256);
}

function perpendicularDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return distance(point, start);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy);
}

function fixtureStroke(points, label, confidence) {
  return { evidence: points.map(copyPoint), points: simplifyPath(points, 0.003), label, confidence, createdAt: 0, evidenceUntil: Infinity, expiresAt: Infinity };
}

function fixtureAnchor(id, label, bbox, state, confidence, depth = 0.5) {
  const bounds = bboxRect(bbox);
  return { id, label, bounds, targetBounds: { ...bounds }, state, confidence, depth, depthConfidence: 0.72, lastSeenAt: 0, lostAt: 0 };
}

function fixtureCircle() {
  return Array.from({ length: 42 }, (_, index) => {
    const angle = index / 41 * Math.PI * 2;
    return { x: 0.28 + Math.cos(angle) * 0.11, y: 0.4 + Math.sin(angle) * 0.17, depth: 0.42 + Math.sin(angle) * 0.08, confidence: 0.94, depthConfidence: 0.76, timestamp: index * 16 };
  });
}

function fixtureArrow() {
  return [
    [0.44, 0.36], [0.52, 0.4], [0.61, 0.44], [0.7, 0.48], [0.78, 0.52], [0.7, 0.43], [0.78, 0.52], [0.67, 0.58]
  ].map(([x, y], index) => ({ x, y, depth: 0.4 + index * 0.015, confidence: 0.9, depthConfidence: 0.7, timestamp: index * 20 }));
}

function fixtureAi() {
  return [[0.33, 0.7], [0.37, 0.58], [0.41, 0.7], [0.39, 0.64], [0.35, 0.64], [0.49, 0.58], [0.49, 0.7]]
    .map(([x, y], index) => ({ x, y, depth: 0.48, confidence: 0.91, depthConfidence: 0.68, timestamp: index * 24 }));
}

function fixtureLasso([x1, y1, x2, y2]) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1) / 2;
  const ry = (y2 - y1) / 2;
  return Array.from({ length: 36 }, (_, index) => {
    const angle = index / 35 * Math.PI * 2;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry, depth: 0.48, confidence: 0.9, depthConfidence: 0.62, timestamp: index * 16 };
  });
}

function bboxRect(value) {
  if (Array.isArray(value) && value.length === 4) {
    const [x1, y1, x2, y2] = value.map(clamp01);
    if (x2 <= x1 || y2 <= y1) return null;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }
  if (!value || typeof value !== "object") return null;
  const x = clamp01(value.x ?? value.left);
  const y = clamp01(value.y ?? value.top);
  const width = clamp01(value.width ?? (Number(value.right) - x));
  const height = clamp01(value.height ?? (Number(value.bottom) - y));
  return width > 0 && height > 0 ? { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) } : null;
}

function rectObject(value) {
  if (!value || typeof value !== "object") return null;
  const x = finite(value.x ?? value.left, NaN);
  const y = finite(value.y ?? value.top, NaN);
  const width = finite(value.width ?? (Number(value.right) - x), NaN);
  const height = finite(value.height ?? (Number(value.bottom) - y), NaN);
  return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0 ? { x, y, width, height } : null;
}

function normalizedToPixels(rect, width, height) {
  return { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height };
}

function segmentIntersectsRect(start, end, rect) {
  if (containsPoint(rect, start) || containsPoint(rect, end)) return true;
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const edges = [
    [{ x: left, y: top }, { x: right, y: top }],
    [{ x: right, y: top }, { x: right, y: bottom }],
    [{ x: right, y: bottom }, { x: left, y: bottom }],
    [{ x: left, y: bottom }, { x: left, y: top }]
  ];
  return edges.some(([edgeStart, edgeEnd]) => segmentsIntersect(start, end, edgeStart, edgeEnd));
}

function segmentsIntersect(a, b, c, d) {
  const cross = (first, second, third) => (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC <= 0 && abD >= 0) || (abC >= 0 && abD <= 0))
    && ((cdA <= 0 && cdB >= 0) || (cdA >= 0 && cdB <= 0));
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    sum += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(sum) / 2;
}

function pointBounds(points) {
  const xs = points.map((item) => item.x);
  const ys = points.map((item) => item.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function centerOf(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function quadraticPoint(from, control, to, t) {
  const inverse = 1 - t;
  return { x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x, y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y };
}

function containsPoint(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function overlaps(first, second) {
  return first && second && first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function finitePoint(point) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

function safePoints(points) {
  return (Array.isArray(points) ? points : []).filter(finitePoint).map((item, index) => ({
    x: clamp01(item.x),
    y: clamp01(item.y),
    depth: clamp01(item.depth ?? item.z ?? 0.5),
    confidence: clamp01(item.confidence ?? 0.8),
    depthConfidence: clamp01(item.depthConfidence ?? item.depth_confidence ?? 0.2),
    timestamp: finite(item.timestamp, index * 16)
  })).slice(0, 1_024);
}

function copyPoint(point) {
  return { ...point };
}

function distance(first, second) {
  return Math.hypot(Number(second?.x || 0) - Number(first?.x || 0), Number(second?.y || 0) - Number(first?.y || 0));
}

function angleDelta(first, second) {
  return Math.atan2(Math.sin(second - first), Math.cos(second - first));
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function safeLabel(value) {
  return cleanText(value, 48).replace(/[^a-z0-9 .'-]/gi, "").trim();
}

function cleanText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

function clamp01(value) {
  return clamp(finite(value, 0), 0, 1);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function percentile(values, amount) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * amount) - 1))];
}

function dedupe(values, key) {
  const seen = new Set();
  return values.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function countPoints(state) {
  return state.paths.liveEvidence.length + state.paths.liveStabilized.length + state.paths.completed.reduce((sum, item) => sum + item.evidence.length + item.points.length, 0) + state.lasso.points.length;
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
