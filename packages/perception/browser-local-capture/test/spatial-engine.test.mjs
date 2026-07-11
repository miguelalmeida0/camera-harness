import assert from "node:assert/strict";
import { once } from "node:events";
import {
  aggregateSpatialConfidence,
  analyzeSpatialWindow,
  associateEvidenceFrames,
  detectSpatialContradictions,
  inferRelations
} from "../../../../services/visual-companion/spatial-engine.mjs";
import { createSpatialAwarenessClient } from "../../../../services/visual-companion/spatial-client.mjs";
import { SPATIAL_DIRECTIONS, SPATIAL_INTERACTIONS, SPATIAL_RELATIONS, containsRawMedia } from "../../../../services/visual-companion/spatial-contract.mjs";
import { clearSpatialScene, createSpatialScene, summarizeSpatialScene, updateSpatialScene } from "../../../../services/visual-companion/spatial-scene.mjs";
import { resetSpatialProviderStateForTests, spatialAwarenessResponseForRequest } from "../server/spatial-awareness-provider.mjs";
import { createMovementRecognitionServer } from "../server/movement-recognition-server.mjs";

const relationCases = [
  [entity("a", [0.1, 0.2, 0.2, 0.3], 0.2), entity("b", [0.6, 0.6, 0.8, 0.8], 0.7), ["left_of", "right_of", "above", "below", "in_front_of", "behind", "far", "separated_from"]],
  [entity("a", [0.1, 0.1, 0.3, 0.3], 0.4), entity("b", [0.24, 0.12, 0.4, 0.3], 0.42), ["near", "overlapping"]],
  [entity("a", [0.2, 0.2, 0.3, 0.3], 0.4), entity("b", [0.1, 0.1, 0.5, 0.5], 0.45), ["inside", "contains"]],
  [entity("a", [0.1, 0.1, 0.2, 0.2], 0.4), entity("b", [0.2, 0.1, 0.3, 0.2], 0.42), ["touching"]]
];
const supportedRelations = new Set();
for (const [first, second, expected] of relationCases) {
  const relations = inferRelations([first, second], 2, 0.55);
  for (const predicate of relations.map((relation) => relation.predicate)) supportedRelations.add(predicate);
  for (const predicate of expected) assert.equal(relations.some((relation) => relation.predicate === predicate), true, `${predicate} is inferred`);
  assert.equal(relations.every((relation) => relation.confidence >= 0.55 && relation.evidence_frames.includes(2)), true);
}
for (const predicate of SPATIAL_RELATIONS) assert.equal(supportedRelations.has(predicate), true, `${predicate} has deterministic coverage`);

const movementResult = await analyzeSpatialWindow(windowInput([
  frame([
    observation("moving", "mug", [0.1, 0.6, 0.2, 0.8], 0.65),
    observation("away", "phone", [0.75, 0.2, 0.85, 0.3], 0.2),
    observation("leaving", "bottle", [0.4, 0.4, 0.5, 0.6], 0.5),
    observation("lowered", "book", [0.55, 0.15, 0.7, 0.3], 0.55)
  ], [hand("right", [0.75, 0.75, 0.9, 0.95], 0.4)]),
  frame([
    observation("moving", "mug", [0.42, 0.25, 0.55, 0.45], 0.3),
    observation("away", "phone", [0.45, 0.2, 0.55, 0.3], 0.62),
    observation("entered", "cup", [0.68, 0.5, 0.8, 0.7], 0.45),
    observation("lowered", "book", [0.55, 0.6, 0.7, 0.78], 0.58)
  ], [hand("right", [0.4, 0.22, 0.58, 0.48], 0.32)])
]));
assert.equal(movementResult.ok, true);
for (const direction of ["right", "left", "upward", "downward", "toward_camera", "away_from_camera", "entered_frame", "left_frame"]) {
  assert.equal(movementResult.movements.some((movement) => movement.direction === direction), true, `${direction} movement is inferred`);
}
for (const predicate of ["hand_approaching_object", "hand_holding_object", "object_raised", "object_lowered", "object_entered_frame", "object_left_frame", "object_placed", "object_removed"]) {
  assert.equal(movementResult.interactions.some((item) => item.predicate === predicate), true, `${predicate} is inferred`);
}
assert.equal(movementResult.interactions.some((item) => item.predicate === "object_repositioned"), true);
assert.equal(movementResult.movements.every((item) => item.evidence_frames.length > 0), true);
assert.equal(movementResult.interactions.every((item) => item.evidence_frames.length > 0), true);
assert.equal(movementResult.claims.every((claim) => claim.evidence_frames.length > 0), true);
assert.equal(movementResult.evidence.length > 0, true);
assert.equal(containsRawMedia(movementResult), false);

const stationary = await analyzeSpatialWindow(windowInput([
  frame([observation("still", "lamp", [0.2, 0.2, 0.4, 0.5], 0.5)]),
  frame([observation("still", "lamp", [0.21, 0.2, 0.41, 0.5], 0.51)])
]));
assert.equal(stationary.movements.some((movement) => movement.direction === "approximately_stationary"), true);

const releaseResult = await analyzeSpatialWindow(windowInput([
  frame([observation("held", "tool", [0.3, 0.3, 0.45, 0.55], 0.4)], [hand("right", [0.28, 0.28, 0.47, 0.58], 0.38)]),
  frame([observation("held", "tool", [0.3, 0.3, 0.45, 0.55], 0.4)], [hand("right", [0.75, 0.72, 0.92, 0.92], 0.5)])
]));
assert.equal(releaseResult.interactions.some((item) => item.predicate === "hand_moving_away_from_object"), true);
assert.equal(releaseResult.interactions.some((item) => item.predicate === "hand_releasing_object"), true);

const behind = await analyzeSpatialWindow(windowInput([
  frame([observation("mug", "mug", [0.2, 0.3, 0.35, 0.55], 0.25), observation("laptop", "laptop", [0.55, 0.3, 0.85, 0.65], 0.55)]),
  frame([observation("mug", "mug", [0.45, 0.35, 0.6, 0.58], 0.75), observation("laptop", "laptop", [0.55, 0.3, 0.85, 0.65], 0.5)])
]));
const mugId = behind.objects.find((object) => object.label === "mug").id;
const laptopId = behind.objects.find((object) => object.label === "laptop").id;
assert.equal(behind.relations.some((relation) => relation.subject_id === mugId && relation.predicate === "behind" && relation.object_id === laptopId), true);

const stable = await analyzeSpatialWindow(windowInput([
  frame([observation("", "cup", [0.2, 0.2, 0.35, 0.5], 0.4)]),
  frame([observation("", "cup", [0.26, 0.2, 0.41, 0.5], 0.42)])
]));
assert.equal(stable.objects[0].id, "object_1");
assert.equal(stable.objects[0].first_seen, 0);
assert.equal(stable.objects[0].last_seen, 1);
assert.equal(JSON.stringify(stable).includes("track_hint"), false);

const uncertainFrame = frame([observation("uncertain", "unknown object", [0.62, 0.25, 0.82, 0.68], 0.45, {
  confidence: 0.45,
  appearance: "A dark cylindrical object with a metallic top",
  missing_evidence: ["front_surface", "controls"]
})]);
const partial = await analyzeSpatialWindow(windowInput([uncertainFrame]));
assert.match(partial.partial_observation, /dark cylindrical object/i);
assert.deepEqual(partial.uncertainty.missing_evidence, ["front_surface", "controls"]);
assert.match(partial.uncertainty.suggested_view, /front surface/i);
assert.equal(/^(i'm not sure|uncertain)$/i.test(partial.partial_observation), false);
const partialScene = updateSpatialScene(createSpatialScene(), partial);
const repeatedPartial = await analyzeSpatialWindow({ ...windowInput([uncertainFrame]), previousScene: partialScene });
assert.equal(repeatedPartial.uncertainty.suggested_view, null);

const metricFrames = [frame([observation("a", "mug", [0.1, 0.2, 0.3, 0.5], 0.3), observation("b", "phone", [0.6, 0.2, 0.75, 0.4], 0.5)])];
const uncalibrated = await analyzeSpatialWindow({ ...windowInput(metricFrames), calibration: { unit: "cm", units_per_normalized: 50, confidence: 1 } });
assert.equal(uncalibrated.scale.type, "relative");
assert.equal(uncalibrated.scale.unit, null);
assert.deepEqual(uncalibrated.metric_estimates, []);
assert.equal(JSON.stringify(uncalibrated).includes('"unit":"cm"'), false);
const calibrated = await analyzeSpatialWindow({
  ...windowInput(metricFrames),
  calibration: { verified: true, unit: "cm", units_per_normalized: 50, confidence: 0.9, evidence: "Known 10 cm calibration target in the same plane." }
});
assert.equal(calibrated.scale.type, "metric");
assert.equal(calibrated.metric_estimates.length, 1);
assert.equal(calibrated.metric_estimates[0].unit, "cm");
assert.equal(calibrated.metric_estimates[0].approximate, true);

assert.equal((await analyzeSpatialWindow({ frames: [], timestamps: [], mode: "observing" })).code, "spatial_empty_frames");
assert.equal((await analyzeSpatialWindow({ frames: [{ width: 640, height: 480 }], timestamps: [1], mode: "observing" })).code, "spatial_frame_empty");
assert.equal((await analyzeSpatialWindow({ ...windowInput([frame([]), frame([])]), timestamps: [2, 1] })).code, "spatial_timestamps_not_ordered");
assert.equal((await analyzeSpatialWindow({ ...windowInput([frame([])]), bodyBytes: 6_000_000 })).code, "spatial_request_too_large");

const evidence = associateEvidenceFrames([
  { subject_id: "object_1", object_id: "object_2", predicate: "left_of", confidence: 0.8, evidence_frames: [1, 3] },
  { subject_id: "object_1", object_id: "object_2", predicate: "right_of", confidence: 0.7, evidence_frames: [4] }
]);
assert.deepEqual(evidence.map((item) => item.frame_index), [1, 3, 4]);
assert.equal(aggregateSpatialConfidence([{ confidence: 0.8 }, { confidence: 0.6 }]), 0.7);
assert.equal(detectSpatialContradictions([
  { subject_id: "object_1", object_id: "object_2", predicate: "left_of", evidence_frames: [1] },
  { subject_id: "object_1", object_id: "object_2", predicate: "right_of", evidence_frames: [3] }
]).length, 1);

let scene = createSpatialScene({ maxObjects: 2, maxRelations: 2, maxMoments: 2 });
for (let index = 0; index < 4; index += 1) {
  scene = updateSpatialScene(scene, {
    scene_id: `scene_${index}`,
    objects: [0, 1, 2].map((item) => ({ id: `object_${item}`, label: `item ${item}`, center: [0.1, 0.1], relative_depth: 0.5, confidence: 0.8, first_seen: 0, last_seen: index })),
    relations: [0, 1, 2].map((item) => ({ subject_id: "object_0", predicate: "left_of", object_id: `object_${item}`, confidence: 0.8, evidence_frames: [0] })),
    movements: [], interactions: [], claims: [], evidence: []
  });
}
assert.equal(scene.objects.length, 2);
assert.equal(scene.relations.length <= 2, true);
assert.equal(scene.moments.length, 2);
assert.equal(containsRawMedia(summarizeSpatialScene(scene)), false);
scene = clearSpatialScene(scene);
assert.deepEqual([scene.objects.length, scene.relations.length, scene.moments.length], [0, 0, 0]);

resetSpatialProviderStateForTests();
const rawBody = requestBody();
rawBody.frames[0].encoded_frame = "temporary-frame-payload";
const providerResult = await spatialAwarenessResponseForRequest(rawBody, { SPATIAL_TIMEOUT_MS: "1000" }, {
  sessionId: "session_spatial_001",
  observationProvider: async () => providerObservations()
});
assert.equal(providerResult.status, 200);
assert.equal(providerResult.json.ok, true);
assert.equal(rawBody.frames.length, 0);
assert.equal(/temporary-frame|token|authorization|model_path/i.test(JSON.stringify(providerResult.json)), false);

let releaseProvider;
const heldProvider = new Promise((resolve) => { releaseProvider = resolve; });
const firstInFlight = spatialAwarenessResponseForRequest(requestBody(), {}, { sessionId: "session_spatial_lock", observationProvider: () => heldProvider });
await new Promise((resolve) => setTimeout(resolve, 0));
const duplicateInFlight = await spatialAwarenessResponseForRequest(requestBody(), {}, { sessionId: "session_spatial_lock", observationProvider: async () => providerObservations() });
assert.equal(duplicateInFlight.status, 409);
releaseProvider(providerObservations());
assert.equal((await firstInFlight).status, 200);

const timeoutResult = await spatialAwarenessResponseForRequest(requestBody(), { SPATIAL_TIMEOUT_MS: "500" }, {
  sessionId: "session_timeout_001",
  observationProvider: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })), { once: true }))
});
assert.equal(timeoutResult.json.code, "spatial_timeout");
const timeoutRecovery = await spatialAwarenessResponseForRequest(requestBody(), {}, { sessionId: "session_timeout_001", observationProvider: async () => providerObservations() });
assert.equal(timeoutRecovery.status, 200);

const server = createMovementRecognitionServer({ healthResult: { ready: true }, observationProvider: async () => providerObservations() });
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/spatial-awareness/health`).then((response) => response.json());
  assert.equal(health.ready, true);
  assert.deepEqual(health.capabilities, ["relative_depth", "object_relations", "hand_object_relations", "multi_frame_movement"]);
  assert.equal("model_path" in health, false);
  const apiResponse = await fetch(`${base}/api/spatial-awareness/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DarkQuest-Session-Id": "session_api_001" },
    body: JSON.stringify(requestBody())
  });
  assert.equal(apiResponse.status, 200);
  assert.equal((await apiResponse.json()).source, "local_spatial");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const clientResponses = [];
const client = createSpatialAwarenessClient({
  endpoint: "/api/spatial-awareness/analyze",
  timeoutMs: 1000,
  fetch: async (url, init) => {
    clientResponses.push({ url, init });
    if (String(url).endsWith("/health")) return jsonResponse({ ready: true, source: "local_spatial", capabilities: [] });
    return jsonResponse({ ...stable, ok: true });
  }
});
assert.equal((await client.health()).ready, true);
assert.equal((await client.analyzeSpatialWindow({ ...windowInput([frame([observation("a", "cup", [0.1, 0.1, 0.2, 0.3], 0.4)])]), sessionId: "session_client_001" })).ok, true);
assert.equal(clientResponses.some((item) => item.url === "/api/spatial-awareness/analyze"), true);
client.dispose();

let cancelledSignal;
const cancellableClient = createSpatialAwarenessClient({
  timeoutMs: 1000,
  fetch: async (_url, init) => new Promise((_resolve, reject) => {
    cancelledSignal = init.signal;
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
  })
});
const cancelledRequest = cancellableClient.analyzeSpatialWindow({ ...requestBody(), sessionId: "session_cancel_001" });
await new Promise((resolve) => setTimeout(resolve, 0));
cancellableClient.cancel();
assert.equal(cancelledSignal.aborted, true);
assert.equal((await cancelledRequest).code, "spatial_cancelled");

for (const direction of SPATIAL_DIRECTIONS) assert.equal(typeof direction, "string");
for (const interaction of SPATIAL_INTERACTIONS) assert.equal(typeof interaction, "string");
console.log("spatial engine tests passed");

function windowInput(frames) {
  return { frames, timestamps: frames.map((_, index) => 1000 + index * 500), query: null, mode: "observing", calibration: null, previousScene: null };
}

function frame(objects, hands = []) {
  return { width: 640, height: 480, observations: { objects, hands } };
}

function observation(track, label, bbox, depth, extra = {}) {
  return { track_hint: track, label, bbox, relative_depth: depth, confidence: extra.confidence ?? 0.92, ...extra };
}

function hand(handedness, bbox, depth) {
  return { handedness, bbox, relative_depth: depth, confidence: 0.94 };
}

function entity(id, bbox, depth) {
  return { id, label: id, bbox, center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2], relative_depth: depth, confidence: 0.95 };
}

function requestBody() {
  return {
    frames: [
      { width: 640, height: 480, captured_at_ms: 1000, encoded_frame: "bounded-test-frame-1" },
      { width: 640, height: 480, captured_at_ms: 1500, encoded_frame: "bounded-test-frame-2" }
    ],
    timestamps: [1000, 1500], query: null, mode: "observing", calibration: null, previousScene: null
  };
}

function providerObservations() {
  return [
    { objects: [observation("cup", "cup", [0.1, 0.2, 0.3, 0.5], 0.5)], hands: [] },
    { objects: [observation("cup", "cup", [0.35, 0.2, 0.55, 0.5], 0.4)], hands: [] }
  ];
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
