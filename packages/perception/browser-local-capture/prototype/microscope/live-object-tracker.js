export function createLiveObjectTracker(options = {}) {
  const smoothing = clamp(options.smoothing ?? 0.38, 0.05, 1);
  const staleTrackMs = integer(options.staleTrackMs, 500, 30_000, 4_500);
  const selectedStaleTrackMs = integer(options.selectedStaleTrackMs, staleTrackMs, 60_000, 12_000);
  const semanticObservationMaxAgeMs = integer(options.semanticObservationMaxAgeMs, 500, 30_000, 8_000);
  let nextObjectNumber = 1;
  let selectedObjectId = null;
  let tracks = [];

  function update(values = [], timestamp = Date.now()) {
    const detections = (Array.isArray(values) ? values : [])
      .map(normalizeDetection)
      .filter((item) => item.box.width > 0 && item.box.height > 0);
    const highConfidence = detections.map((detection, index) => ({ detection, index })).filter(({ detection }) => detection.confidence >= 0.45);
    const lowConfidence = detections.map((detection, index) => ({ detection, index })).filter(({ detection }) => detection.confidence < 0.45);
    const matchedTracks = new Set();
    const matchedDetections = new Set();

    associate(highConfidence, timestamp, matchedTracks, matchedDetections, 0.18);
    associate(lowConfidence, timestamp, matchedTracks, matchedDetections, 0.12);

    tracks.forEach((track, index) => {
      if (matchedTracks.has(index)) return;
      track.missedFrames += 1;
      if (!["presented", "selected"].includes(track.lifecycleState)) track.lifecycleState = "occluded";
    });

    detections.forEach((detection, index) => {
      if (matchedDetections.has(index)) return;
      tracks.push(createTrack(detection, timestamp));
    });

    tracks = tracks.filter((track) => timestamp - track.lastSeenAt <= (track.id === selectedObjectId ? selectedStaleTrackMs : staleTrackMs));
    if (selectedObjectId && !tracks.some((track) => track.id === selectedObjectId)) selectedObjectId = null;
    return snapshot();
  }

  function associate(entries, timestamp, matchedTracks, matchedDetections, minimumScore) {
    const candidates = [];
    tracks.forEach((track, trackIndex) => {
      if (matchedTracks.has(trackIndex)) return;
      entries.forEach(({ detection, index: detectionIndex }) => {
        if (matchedDetections.has(detectionIndex)) return;
        const score = associationScore(track, detection, timestamp);
        if (score >= minimumScore) candidates.push({ trackIndex, detectionIndex, detection, score });
      });
    });
    candidates.sort((left, right) => right.score - left.score);
    for (const candidate of candidates) {
      if (matchedTracks.has(candidate.trackIndex) || matchedDetections.has(candidate.detectionIndex)) continue;
      updateTrack(tracks[candidate.trackIndex], candidate.detection, timestamp);
      matchedTracks.add(candidate.trackIndex);
      matchedDetections.add(candidate.detectionIndex);
    }
  }

  function mergeOpenVocabulary(observations = [], capturedAt = Date.now(), receivedAt = Date.now()) {
    const semanticDetections = (Array.isArray(observations) ? observations : []).map((value) => normalizeDetection({
      ...value,
      source: "local_open_vocabulary",
      localCandidates: value.localCandidates || [{ label: value.label, confidence: value.confidence, source: "local_open_vocabulary" }]
    })).filter((item) => item.box.width > 0 && item.box.height > 0);
    const usedTracks = new Set();
    for (const detection of semanticDetections) {
      let best = null;
      tracks.forEach((track, index) => {
        if (usedTracks.has(index)) return;
        const score = semanticAssociationScore(track, detection);
        if (!best || score > best.score) best = { track, index, score };
      });
      if (best?.score >= 0.12) {
        best.track.localCandidates = mergeCandidates(best.track.localCandidates, detection.localCandidates);
        best.track.semanticAppearance = detection.appearance || best.track.semanticAppearance;
        best.track.visibleFacts = detection.visibleFacts || best.track.visibleFacts;
        best.track.missingEvidence = detection.missingEvidence || best.track.missingEvidence;
        best.track.lastSemanticAt = receivedAt;
        best.track.semanticObservationAgeMs = Math.max(0, receivedAt - capturedAt);
        usedTracks.add(best.index);
      } else if (receivedAt - capturedAt <= semanticObservationMaxAgeMs) {
        const track = createTrack(detection, capturedAt);
        track.lastSeenAt = receivedAt;
        track.lastSemanticAt = receivedAt;
        track.semanticObservationAgeMs = Math.max(0, receivedAt - capturedAt);
        tracks.push(track);
      }
    }
    return snapshot();
  }

  function applySemanticVerification(trackId, verification, visualFingerprint = "") {
    const track = tracks.find((item) => item.id === String(trackId));
    if (!track || verification?.trackId !== track.id || !verification?.identity?.label) return false;
    track.resolvedIdentity = Object.freeze({
      label: String(verification.identity.label),
      confidence: clamp(verification.identity.confidence, 0, 1),
      source: "semantic"
    });
    track.semanticMemory = Object.freeze({
      visibleFacts: Object.freeze([...(verification.visibleFacts || [])]),
      visibleText: Object.freeze([...(verification.visibleText || [])]),
      condition: Object.freeze([...(verification.condition || [])]),
      relationships: Object.freeze([...(verification.relationships || [])]),
      limitations: Object.freeze([...(verification.limitations || [])]),
      inspectedAt: verification.inspectedAt || Date.now(),
      visualFingerprint: String(visualFingerprint || ""),
      provider: String(verification.provider || "local_semantic"),
      model: String(verification.model || "local visual model"),
      uncertainty: Math.max(0, 1 - clamp(verification.identity.confidence, 0, 1))
    });
    track.lifecycleState = "stable";
    track.attentionState = "semantically_inspected";
    return true;
  }

  function applyMask(trackId, mask) {
    const track = tracks.find((item) => item.id === String(trackId));
    if (!track || !mask || mask.trackId !== track.id || !Array.isArray(mask.polygon)) return false;
    track.mask = Object.freeze({
      trackId: track.id,
      polygon: Object.freeze(mask.polygon.map((point) => Object.freeze({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }))),
      confidence: clamp(mask.confidence, 0, 1),
      timestamp: Number(mask.timestamp) || Date.now()
    });
    return true;
  }

  function setAttention(scores = []) {
    const byId = new Map((Array.isArray(scores) ? scores : []).map((score) => [score.trackId, score]));
    tracks.forEach((track) => {
      const score = byId.get(track.id);
      track.attention = score ? Object.freeze({ total: clamp(score.total, 0, 1), reasons: Object.freeze([...(score.reasons || [])]) }) : Object.freeze({ total: 0, reasons: Object.freeze([]) });
      if (track.resolvedIdentity && track.attentionState === "semantically_inspected") return;
      if (track.lifecycleState === "presented") track.attentionState = "presented";
      else if (track.id === selectedObjectId) track.attentionState = "attended";
      else if (score?.state) track.attentionState = score.state;
      else track.attentionState = "peripheral";
    });
  }

  function markPresented(trackId, presentedAt = Date.now()) {
    const track = tracks.find((item) => item.id === String(trackId));
    if (!track) return false;
    if (!track.presentationStartedAt) track.presentationStartedAt = presentedAt;
    track.lifecycleState = "presented";
    track.attentionState = "presented";
    return true;
  }

  function select(objectId) {
    const id = String(objectId || "");
    if (!tracks.some((track) => track.id === id)) return false;
    selectedObjectId = id;
    return true;
  }

  function clearSelection() {
    selectedObjectId = null;
  }

  function resolveTarget() {
    const selected = tracks.find((track) => track.id === selectedObjectId);
    if (selected) return publicTrack(selected);
    const presented = [...tracks].filter((track) => track.lifecycleState === "presented").sort((left, right) => right.lastSeenAt - left.lastSeenAt)[0];
    if (presented) return publicTrack(presented);
    const attended = [...tracks].sort((left, right) => (right.attention?.total || 0) - (left.attention?.total || 0))[0];
    return attended ? publicTrack(attended) : null;
  }

  function reset() {
    tracks = [];
    selectedObjectId = null;
    nextObjectNumber = 1;
  }

  function snapshot() {
    const objects = tracks.map(publicTrack);
    return Object.freeze({
      objects: Object.freeze(objects),
      selectedObjectId,
      selectedObject: objects.find((object) => object.id === selectedObjectId) || null,
      targetObject: resolveTarget()
    });
  }

  function createTrack(detection, timestamp) {
    return {
      id: `object-${nextObjectNumber++}`,
      rawBox: detection.box,
      smoothedBox: detection.box,
      mask: null,
      localCandidates: mergeCandidates([], detection.localCandidates),
      resolvedIdentity: null,
      appearanceEmbedding: detection.appearanceEmbedding,
      semanticAppearance: detection.appearance || "",
      visibleFacts: detection.visibleFacts || [],
      missingEvidence: detection.missingEvidence || [],
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      lastSemanticAt: 0,
      semanticObservationAgeMs: 0,
      lifecycleState: "new",
      attentionState: "peripheral",
      attention: Object.freeze({ total: 0, reasons: Object.freeze([]) }),
      motion: { direction: "stationary", velocity: 0, approachingCamera: false, dx: 0, dy: 0 },
      firstArea: area(detection.box),
      previousArea: area(detection.box),
      areaGrowth: 0,
      missedFrames: 0,
      observations: 1,
      presentationStartedAt: 0,
      semanticMemory: null
    };
  }

  function updateTrack(track, detection, timestamp) {
    const elapsed = Math.max(1, timestamp - track.lastSeenAt);
    const previousCenter = center(track.rawBox);
    const nextCenter = center(detection.box);
    const dx = nextCenter.x - previousCenter.x;
    const dy = nextCenter.y - previousCenter.y;
    const velocity = Math.hypot(dx, dy) / elapsed * 1000;
    const nextArea = area(detection.box);
    const areaGrowth = track.previousArea > 0 ? (nextArea - track.previousArea) / track.previousArea : 0;
    const wasOccluded = track.missedFrames > 0;
    track.smoothedBox = smoothBox(track.smoothedBox, detection.box, smoothing);
    track.rawBox = detection.box;
    track.localCandidates = mergeCandidates(track.localCandidates, detection.localCandidates);
    track.appearanceEmbedding = blendEmbedding(track.appearanceEmbedding, detection.appearanceEmbedding, 0.28);
    track.lastSeenAt = timestamp;
    track.missedFrames = 0;
    track.observations += 1;
    track.lifecycleState = wasOccluded ? "reacquired" : track.observations >= 4 ? "stable" : "new";
    track.areaGrowth = areaGrowth;
    track.previousArea = nextArea;
    track.motion = {
      direction: motionDirection(dx, dy, velocity),
      velocity,
      approachingCamera: areaGrowth > 0.035,
      dx,
      dy
    };
  }

  function associationScore(track, detection, timestamp) {
    const predicted = predictedBox(track, timestamp);
    const overlap = intersectionOverUnion(predicted, detection.box);
    const distance = centerDistance(predicted, detection.box);
    const centerScore = 1 - Math.min(1, distance / 0.34);
    const appearance = embeddingSimilarity(track.appearanceEmbedding, detection.appearanceEmbedding);
    if (overlap < 0.015 && distance > 0.34 && appearance < 0.82) return 0;
    return overlap * 0.4
      + centerScore * 0.22
      + appearance * 0.22
      + boxSizeSimilarity(predicted, detection.box) * 0.1
      + detection.confidence * 0.06;
  }

  function semanticAssociationScore(track, detection) {
    const overlap = intersectionOverUnion(track.smoothedBox, detection.box);
    const distance = centerDistance(track.smoothedBox, detection.box);
    return overlap * 0.68 + (1 - Math.min(1, distance / 0.36)) * 0.22 + boxSizeSimilarity(track.smoothedBox, detection.box) * 0.1;
  }

  function predictedBox(track, timestamp) {
    const elapsedSeconds = Math.min(0.45, Math.max(0, timestamp - track.lastSeenAt) / 1000);
    return normalizeBox({
      x: track.rawBox.x + track.motion.dx * elapsedSeconds * 8,
      y: track.rawBox.y + track.motion.dy * elapsedSeconds * 8,
      width: track.rawBox.width,
      height: track.rawBox.height
    });
  }

  function publicTrack(track) {
    const topCandidate = track.localCandidates[0] || { label: "unknown object", confidence: 0, source: "geometry_proposal" };
    const identity = track.resolvedIdentity || null;
    const selected = track.id === selectedObjectId;
    const lifecycleState = selected ? "selected" : track.lifecycleState;
    return Object.freeze({
      id: track.id,
      label: identity?.label || topCandidate.label,
      confidence: identity?.confidence ?? topCandidate.confidence,
      box: Object.freeze({ ...track.smoothedBox }),
      geometry: Object.freeze({
        box: Object.freeze({ ...track.rawBox }),
        smoothedBox: Object.freeze({ ...track.smoothedBox }),
        mask: track.mask
      }),
      localCandidates: Object.freeze(track.localCandidates.map((candidate) => Object.freeze({ ...candidate }))),
      resolvedIdentity: identity ? Object.freeze({ ...identity }) : null,
      appearanceEmbedding: track.appearanceEmbedding ? Object.freeze([...track.appearanceEmbedding]) : null,
      firstSeenAt: track.firstSeenAt,
      lastSeenAt: track.lastSeenAt,
      state: lifecycleState,
      motion: Object.freeze({ ...track.motion }),
      attention: track.attention,
      attentionState: track.attentionState,
      semanticAppearance: track.semanticAppearance,
      visibleFacts: Object.freeze([...(track.visibleFacts || [])]),
      missingEvidence: Object.freeze([...(track.missingEvidence || [])]),
      semanticMemory: track.semanticMemory,
      presentedForMs: track.presentationStartedAt ? Math.max(0, Date.now() - track.presentationStartedAt) : 0,
      areaGrowth: track.areaGrowth,
      missedFrames: track.missedFrames,
      observations: track.observations,
      selected
    });
  }

  return Object.freeze({
    applyMask,
    applySemanticVerification,
    clearSelection,
    markPresented,
    mergeOpenVocabulary,
    reset,
    resolveTarget,
    select,
    setAttention,
    snapshot,
    update
  });
}

export function normalizeObjectDetections(result = {}, source = {}, embeddingProvider) {
  const width = Math.max(1, Number(source.videoWidth || source.width) || 1);
  const height = Math.max(1, Number(source.videoHeight || source.height) || 1);
  return (Array.isArray(result?.detections) ? result.detections : []).map((detection) => {
    const category = Array.isArray(detection?.categories) ? detection.categories[0] : null;
    const box = detection?.boundingBox || {};
    const normalizedBox = normalizeBox({
      x: Number(box.originX) / width,
      y: Number(box.originY) / height,
      width: Number(box.width) / width,
      height: Number(box.height) / height
    });
    const label = clean(category?.displayName || category?.categoryName) || "unknown object";
    const confidence = clamp(category?.score, 0, 1);
    return Object.freeze({
      label,
      confidence,
      box: normalizedBox,
      localCandidates: Object.freeze([{ label, confidence, source: "geometry_proposal" }]),
      appearanceEmbedding: typeof embeddingProvider === "function" ? embeddingProvider(normalizedBox) : null,
      source: "geometry_proposal"
    });
  });
}

export function createCoverTransform(input = {}) {
  const sourceWidth = positive(input.sourceWidth, 1);
  const sourceHeight = positive(input.sourceHeight, 1);
  const viewportWidth = positive(input.viewportWidth, 1);
  const viewportHeight = positive(input.viewportHeight, 1);
  const scale = Math.max(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  return Object.freeze({
    sourceWidth,
    sourceHeight,
    viewportWidth,
    viewportHeight,
    scale,
    offsetX: (viewportWidth - sourceWidth * scale) / 2,
    offsetY: (viewportHeight - sourceHeight * scale) / 2,
    mirrored: input.mirrored !== false
  });
}

export function createContainTransform(input = {}) {
  const sourceWidth = positive(input.sourceWidth, 1);
  const sourceHeight = positive(input.sourceHeight, 1);
  const viewportWidth = positive(input.viewportWidth, 1);
  const viewportHeight = positive(input.viewportHeight, 1);
  const scale = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  return Object.freeze({
    sourceWidth,
    sourceHeight,
    viewportWidth,
    viewportHeight,
    scale,
    offsetX: (viewportWidth - sourceWidth * scale) / 2,
    offsetY: (viewportHeight - sourceHeight * scale) / 2,
    mirrored: input.mirrored !== false
  });
}

export function sourceBoxToViewport(sourceBox = {}, transformInput = {}) {
  const transform = transformInput?.scale ? transformInput : createCoverTransform(transformInput);
  const box = normalizeBox(sourceBox);
  const width = box.width * transform.sourceWidth * transform.scale;
  const height = box.height * transform.sourceHeight * transform.scale;
  const unmirroredX = transform.offsetX + box.x * transform.sourceWidth * transform.scale;
  return Object.freeze({
    x: transform.mirrored ? transform.viewportWidth - unmirroredX - width : unmirroredX,
    y: transform.offsetY + box.y * transform.sourceHeight * transform.scale,
    width,
    height
  });
}

function normalizeDetection(value = {}) {
  const label = clean(value.label) || "unknown object";
  const confidence = clamp(value.confidence, 0, 1);
  return Object.freeze({
    label,
    confidence,
    box: normalizeBox(value.box),
    localCandidates: Object.freeze((Array.isArray(value.localCandidates) ? value.localCandidates : [{ label, confidence, source: value.source }]).map((candidate) => ({
      label: clean(candidate.label) || label,
      confidence: clamp(candidate.confidence, 0, 1),
      source: clean(candidate.source) || clean(value.source) || "geometry_proposal"
    }))),
    appearanceEmbedding: normalizeEmbedding(value.appearanceEmbedding),
    appearance: clean(value.appearance),
    visibleFacts: Array.isArray(value.visibleFacts) ? value.visibleFacts.map(clean).filter(Boolean).slice(0, 6) : [],
    missingEvidence: Array.isArray(value.missingEvidence) ? value.missingEvidence.map(clean).filter(Boolean).slice(0, 6) : []
  });
}

function normalizeBox(value = {}) {
  const width = clamp(value.width, 0, 1);
  const height = clamp(value.height, 0, 1);
  const x = clamp(value.x, 0, Math.max(0, 1 - width));
  const y = clamp(value.y, 0, Math.max(0, 1 - height));
  return Object.freeze({ x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) });
}

function mergeCandidates(existing, incoming) {
  const byLabel = new Map();
  for (const candidate of [...(existing || []), ...(incoming || [])]) {
    const label = clean(candidate?.label);
    if (!label) continue;
    const normalized = {
      label,
      confidence: clamp(candidate.confidence, 0, 1),
      source: clean(candidate.source) || "geometry_proposal"
    };
    const previous = byLabel.get(label.toLowerCase());
    if (!previous || candidatePriority(normalized) >= candidatePriority(previous)) byLabel.set(label.toLowerCase(), normalized);
  }
  return [...byLabel.values()].sort((left, right) => candidatePriority(right) - candidatePriority(left)).slice(0, 8);
}

function candidatePriority(candidate) {
  const sourceWeight = candidate.source === "local_open_vocabulary" ? 2 : candidate.source === "semantic" ? 3 : 1;
  return sourceWeight + candidate.confidence;
}

function smoothBox(previous, next, alpha) {
  return normalizeBox({
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
    width: previous.width + (next.width - previous.width) * alpha,
    height: previous.height + (next.height - previous.height) * alpha
  });
}

function motionDirection(dx, dy, velocity) {
  if (velocity < 0.015) return "stationary";
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const numbers = value.map(Number).filter(Number.isFinite).slice(0, 128);
  return numbers.length ? numbers : null;
}

function blendEmbedding(previous, next, alpha) {
  if (!next) return previous;
  if (!previous || previous.length !== next.length) return next;
  return previous.map((value, index) => value + (next[index] - value) * alpha);
}

function embeddingSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return 0.5;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0.5;
  return clamp((dot / Math.sqrt(leftNorm * rightNorm) + 1) / 2, 0, 1);
}

function intersectionOverUnion(left, right) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = width * height;
  const union = area(left) + area(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

function centerDistance(left, right) {
  const leftCenter = center(left);
  const rightCenter = center(right);
  return Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
}

function boxSizeSimilarity(left, right) {
  const leftArea = Math.max(0.000001, area(left));
  const rightArea = Math.max(0.000001, area(right));
  return Math.min(leftArea, rightArea) / Math.max(leftArea, rightArea);
}

function center(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function area(box) {
  return Math.max(0, box.width * box.height);
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function integer(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}
