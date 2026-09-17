export function createFoveatedAttentionEngine(options = {}) {
  const presentedDwellMs = bounded(options.presentedDwellMs, 250, 3_000, 650);
  const candidateSince = new Map();
  const presentedTracks = new Set();

  function score(tracks = [], timestamp = Date.now()) {
    const scores = tracks.map((track) => attentionScore(track, timestamp));
    scores.sort((left, right) => right.total - left.total);
    const attendedIds = new Set(scores.slice(0, 2).map((item) => item.trackId));
    const presented = [];
    for (const item of scores) {
      const track = tracks.find((candidate) => candidate.id === item.trackId);
      const presentationSignal = presentationCandidate(track, item);
      if (!presentationSignal) {
        candidateSince.delete(item.trackId);
        continue;
      }
      const since = candidateSince.get(item.trackId) || timestamp;
      candidateSince.set(item.trackId, since);
      if (!presentedTracks.has(item.trackId) && timestamp - since >= presentedDwellMs) {
        presentedTracks.add(item.trackId);
        presented.push(Object.freeze({ trackId: item.trackId, presentedAt: timestamp, reasons: Object.freeze([...item.reasons]) }));
      }
    }
    return Object.freeze({
      scores: Object.freeze(scores.map((item, index) => Object.freeze({
        ...item,
        state: item.presented
          ? "presented"
          : attendedIds.has(item.trackId)
            ? index === 0 ? "attended" : "candidate"
            : "peripheral"
      }))),
      attendedTrackIds: Object.freeze([...attendedIds]),
      presented: Object.freeze(presented)
    });
  }

  function reset(activeTrackIds = []) {
    const active = new Set(activeTrackIds);
    for (const id of candidateSince.keys()) if (!active.has(id)) candidateSince.delete(id);
    for (const id of presentedTracks) if (!active.has(id)) presentedTracks.delete(id);
    if (!active.size) {
      candidateSince.clear();
      presentedTracks.clear();
    }
  }

  return Object.freeze({ reset, score });
}

export function computeGroundedRelationships(tracks = []) {
  const relations = [];
  for (let leftIndex = 0; leftIndex < tracks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tracks.length; rightIndex += 1) {
      const left = tracks[leftIndex];
      const right = tracks[rightIndex];
      const leftCenter = center(left.box);
      const rightCenter = center(right.box);
      const overlap = intersectionOverUnion(left.box, right.box);
      const distance = Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
      if (overlap > 0.12) addRelation(relations, left.id, "overlapping", right.id, Math.min(0.98, 0.65 + overlap), "geometry");
      if (distance < 0.28) addRelation(relations, left.id, "near", right.id, Math.min(0.94, 1 - distance), "geometry");
      if (Math.abs(leftCenter.x - rightCenter.x) > 0.08) {
        const [subject, object] = leftCenter.x < rightCenter.x ? [left, right] : [right, left];
        addRelation(relations, subject.id, "left of", object.id, Math.min(0.95, 0.58 + Math.abs(leftCenter.x - rightCenter.x)), "geometry");
      }
      if (Math.abs(leftCenter.y - rightCenter.y) > 0.1) {
        const [subject, object] = leftCenter.y < rightCenter.y ? [left, right] : [right, left];
        addRelation(relations, subject.id, "above", object.id, Math.min(0.95, 0.56 + Math.abs(leftCenter.y - rightCenter.y)), "geometry");
      }
    }
  }
  for (const track of tracks) {
    if (track.motion?.approachingCamera) addRelation(relations, track.id, "approaching camera", "camera", Math.min(0.94, 0.62 + Math.max(0, track.areaGrowth || 0)), "temporal");
    if ((track.areaGrowth || 0) < -0.06) addRelation(relations, track.id, "moving away", "camera", Math.min(0.9, 0.6 + Math.abs(track.areaGrowth)), "temporal");
  }
  return Object.freeze(relations.slice(0, 40));
}

export function createTemporalEventModel(options = {}) {
  const previous = new Map();
  const lastEventAt = new Map();
  const movementCooldownMs = bounded(options.movementCooldownMs, 250, 10_000, 1_500);
  let sequence = 0;

  function update(tracks = [], timestamp = Date.now()) {
    const current = new Map(tracks.map((track) => [track.id, track]));
    const events = [];
    for (const track of tracks) {
      const prior = previous.get(track.id);
      if (!prior) push(events, "object_appeared", track, timestamp);
      else {
        if (track.state === "occluded" && prior.state !== "occluded") push(events, "object_occluded", track, timestamp);
        if (track.state === "reacquired" && prior.state === "occluded") push(events, "object_reacquired", track, timestamp);
        if (track.state === "presented" && prior.state !== "presented") push(events, "object_presented", track, timestamp);
        if (track.resolvedIdentity && !prior.resolvedIdentity) push(events, "object_identified", track, timestamp);
        if ((track.motion?.velocity || 0) > 0.08 && shouldEmit(`${track.id}:moved`, timestamp, movementCooldownMs)) {
          push(events, "object_moved", track, timestamp);
        }
      }
    }
    for (const [trackId, prior] of previous) {
      if (!current.has(trackId)) push(events, "object_disappeared", prior, timestamp);
    }
    previous.clear();
    tracks.forEach((track) => previous.set(track.id, track));
    return Object.freeze(events);
  }

  function push(events, type, track, timestamp) {
    const key = `${track.id}:${type}`;
    if (!shouldEmit(key, timestamp, type === "object_moved" ? movementCooldownMs : 400)) return;
    events.push(Object.freeze({
      id: `perception-event-${++sequence}`,
      type,
      trackId: track.id,
      label: track.label,
      timestamp,
      source: type === "object_identified" ? "semantic" : type.includes("moved") || type.includes("presented") ? "temporal" : "tracking"
    }));
  }

  function shouldEmit(key, timestamp, cooldown) {
    const previousAt = lastEventAt.get(key) || 0;
    if (timestamp - previousAt < cooldown) return false;
    lastEventAt.set(key, timestamp);
    return true;
  }

  function reset() {
    previous.clear();
    lastEventAt.clear();
    sequence = 0;
  }

  return Object.freeze({ reset, update });
}

function attentionScore(track, timestamp) {
  const boxCenter = center(track.box);
  const centrality = 1 - Math.min(1, Math.hypot(boxCenter.x - 0.5, boxCenter.y - 0.5) / 0.71);
  const size = Math.min(1, area(track.box) / 0.24);
  const growth = Math.min(1, Math.max(0, track.areaGrowth || 0) * 5);
  const uncertainty = 1 - Math.min(1, Math.max(0, track.confidence || 0));
  const novelty = 1 - Math.min(1, Math.max(0, timestamp - track.firstSeenAt) / 4_000);
  const dwell = Math.min(1, Math.max(0, timestamp - track.firstSeenAt) / 3_000);
  const selected = track.selected ? 1 : 0;
  const approaching = track.motion?.approachingCamera ? 1 : 0;
  const reasons = [];
  if (selected) reasons.push("user click");
  if (centrality > 0.7) reasons.push("frame centrality");
  if (growth > 0.25) reasons.push("box growth");
  if (approaching) reasons.push("approaching camera");
  if (uncertainty > 0.45) reasons.push("local uncertainty");
  if (novelty > 0.55) reasons.push("visual novelty");
  if (dwell > 0.65) reasons.push("dwell duration");
  const total = Math.min(1,
    centrality * 0.18
    + size * 0.16
    + growth * 0.13
    + uncertainty * 0.1
    + novelty * 0.08
    + dwell * 0.09
    + selected * 0.2
    + approaching * 0.14
  );
  return {
    trackId: track.id,
    total,
    reasons,
    presented: track.state === "presented" || track.attentionState === "presented"
  };
}

function presentationCandidate(track, score) {
  if (!track || track.state === "occluded" || track.missedFrames > 0 || track.observations < 4) return false;
  const boxCenter = center(track.box);
  const central = Math.hypot(boxCenter.x - 0.5, boxCenter.y - 0.5) < 0.34;
  const foregroundDominant = area(track.box) > 0.13;
  const approaching = track.motion?.approachingCamera || (track.areaGrowth || 0) > 0.025;
  const stabilized = (track.motion?.velocity || 0) < 0.2;
  return central && stabilized && score.total > 0.48 && (approaching || foregroundDominant || track.selected);
}

function addRelation(collection, subjectId, predicate, objectId, confidence, source) {
  collection.push(Object.freeze({
    id: `relation-${collection.length + 1}`,
    subjectId,
    predicate,
    objectId,
    confidence: Math.min(1, Math.max(0, confidence)),
    source
  }));
}

function intersectionOverUnion(left, right) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = width * height;
  const union = area(left) + area(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

function center(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function area(box) {
  return Math.max(0, box.width * box.height);
}

function bounded(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}
