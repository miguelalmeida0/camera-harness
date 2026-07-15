import assert from "node:assert/strict";
import test from "node:test";
import {
  LANDMARK_FIXTURES,
  SCENE_FIXTURES
} from "../../../../../fixtures/neural-field/fixture-library.mjs";
import { createNeuralFieldRuntime } from "./runtime.mjs";

const stablePinch = frames(requiredFixture(LANDMARK_FIXTURES, "stable pinch"));
const release = frames(requiredFixture(LANDMARK_FIXTURES, "release"));
const slowCircle = frames(requiredFixture(LANDMARK_FIXTURES, "slow circle"));
const sceneFixture = requiredFixture(SCENE_FIXTURES, "mug left of laptop");
const scene = sceneFixture.scene ?? sceneFixture;
const mug = requiredObject(scene, "mug");
const relation = requiredRelation(scene, "left_of");

test("rapid pinch start/end cannot duplicate resources or retain a stroke", async () => {
  const runtime = await enterAirScript();
  for (let index = 0; index < 20; index += 1) {
    await runtime.feedLandmarkFrame(structuredClone(stablePinch[index % stablePinch.length]));
    await runtime.feedLandmarkFrame(structuredClone(release[index % release.length]));
    assertActiveResourceBounds(runtime);
  }
  assert.equal(strokeIsActive(runtime.snapshot()), false);
  await assertSafeAndRestartable(runtime);
});

test("tool switch during active stroke cancels the old stroke", async () => {
  const runtime = await enterAirScript();
  await beginStroke(runtime);
  assert.equal(strokeIsActive(runtime.snapshot()), true, "fixture must start a real stroke");
  await runtime.selectTool("spatial_lasso");
  assert.equal(strokeIsActive(runtime.snapshot()), false);
  assert.equal(selectedTool(runtime.snapshot()), "spatial_lasso");
  await assertSafeAndRestartable(runtime);
});

test("exit during active stroke clears stroke and render resources", async () => {
  const runtime = await enterAirScript();
  await beginStroke(runtime);
  assert.equal(strokeIsActive(runtime.snapshot()), true);
  await runtime.exit({ returnMode: "ask" });
  assert.equal(strokeIsActive(runtime.snapshot()), false);
  assertInactive(runtime.snapshot(), "ask");
  assertCleanResources(runtime);
  await assertSafeAndRestartable(runtime);
});

test("semantic response after exit is rejected by generation", async () => {
  const runtime = await enterAirScript();
  const request = await runtime.requestSemantic("semantic", { commit: true });
  await runtime.exit({ returnMode: "ask" });
  const renderCount = runtime.getRenderTimeline().length;
  const eventCount = runtime.getEventTimeline().length;
  await runtime.dispatch({
    type: "semantic_resolved",
    requestId: request.requestId,
    generation: request.generation,
    payload: { classification: "circle", confidence: 0.99 }
  });
  assert.equal(runtime.getRenderTimeline().length, renderCount, "late semantic work must not render");
  assertStaleIgnored(runtime.getEventTimeline().slice(eventCount));
  assert.equal(runtime.snapshot().classification, null);
  await assertSafeAndRestartable(runtime);
});

test("lasso response after switching tool cannot ground an object", async () => {
  const runtime = await enterSpatialLasso();
  const request = await runtime.requestSemantic("lasso", { commit: true });
  await runtime.selectTool("airscript");
  const renderCount = runtime.getRenderTimeline().length;
  const eventCount = runtime.getEventTimeline().length;
  await runtime.dispatch({
    type: "lasso_resolved",
    requestId: request.requestId,
    generation: request.generation,
    payload: { objectId: mug.id, object: structuredClone(mug), objects: [structuredClone(mug)] }
  });
  assert.equal(runtime.getRenderTimeline().length, renderCount, "old lasso response must not render");
  assertStaleIgnored(runtime.getEventTimeline().slice(eventCount));
  assert.notEqual(selectedObjectId(runtime.snapshot()), mug.id);
  await assertSafeAndRestartable(runtime);
});

test("camera track ends without leaving media or lifecycle locks", async () => {
  const runtime = await enterAirScript();
  await runtime.injectFailure("camera_track_ended");
  assertFailureObserved(runtime, "camera_track_ended");
  await assertSafeAndRestartable(runtime);
});

test("worker crashes cleanly and never duplicates on restart", async () => {
  const runtime = await enterAirScript();
  await runtime.injectFailure("worker_crash");
  assertFailureObserved(runtime, "worker_crash");
  await assertSafeAndRestartable(runtime);
});

test("renderer initialization failure releases renderer resources", async () => {
  const runtime = await enterAirScript();
  await runtime.injectFailure("renderer_initialization_failed");
  assertFailureObserved(runtime, "renderer_initialization_failed");
  await assertSafeAndRestartable(runtime);
});

test("spatial service timeout releases the pending lasso request", async () => {
  const runtime = await enterSpatialLasso();
  await runtime.requestSemantic("lasso", { commit: true });
  await runtime.injectFailure("spatial_timeout");
  assert.equal(pendingRequests(runtime.snapshot()).length, 0);
  assertFailureObserved(runtime, "spatial_timeout");
  await assertSafeAndRestartable(runtime);
});

test("cloud limit reached does not lock ordinary local drawing", async () => {
  const runtime = await enterSpatialLasso();
  await runtime.requestSemantic("lasso", { commit: true });
  await runtime.injectFailure("cloud_limit");
  assert.equal(pendingRequests(runtime.snapshot()).length, 0);
  if (!isActive(runtime.snapshot())) await runtime.enter({ returnMode: "ask" });
  await runtime.selectTool("airscript");
  await beginStroke(runtime);
  assert.equal(strokePointCount(runtime.snapshot()) > 1, true, "local stroke processing remains available");
  assertFailureObserved(runtime, "cloud_limit");
  await assertSafeAndRestartable(runtime);
});

test("voice failure cannot overlap audio or leave speech active", async () => {
  const runtime = await enterAirScript();
  const started = await runtime.dispatch({ type: "speech_started", generation: runtime.snapshot().generation });
  assert.notEqual(started?.accepted, false, "first speech event is accepted");
  const duplicate = await runtime.dispatch({ type: "speech_started", generation: runtime.snapshot().generation });
  assert.equal(duplicate?.accepted, false, "overlapping speech is rejected");
  await runtime.injectFailure("voice_failure");
  assertFailureObserved(runtime, "voice_failure");
  assertResourceAtMost(runtime, ["activeSpeech", "speechInFlight"], 0);
  assertResourceAtMost(runtime, ["audioElements", "activeAudioElements"], 0);
  await assertSafeAndRestartable(runtime);
});

test("user exits during speech and late voice events stay inert", async () => {
  const runtime = await enterAirScript();
  const generation = runtime.snapshot().generation;
  await runtime.dispatch({ type: "speech_started", generation });
  await runtime.exit({ returnMode: "ask" });
  const renderCount = runtime.getRenderTimeline().length;
  await runtime.dispatch({ type: "speech_stopped", generation });
  assert.equal(runtime.getRenderTimeline().length, renderCount);
  assertResourceAtMost(runtime, ["activeSpeech", "speechInFlight"], 0);
  assertResourceAtMost(runtime, ["audioElements", "activeAudioElements"], 0);
  await assertSafeAndRestartable(runtime);
});

test("unexpected replay stop revokes recorder resources", async () => {
  const runtime = await enterAirScript();
  const replay = await runtime.startReplay({ consent: true });
  assert.notEqual(replay?.accepted, false, "consented replay may start");
  await runtime.stopReplay({ unexpected: true });
  assertResourceAtMost(runtime, ["activeRecorders", "recorders"], 0);
  assertResourceAtMost(runtime, ["objectUrls", "activeObjectUrls"], 0);
  assertFailureObserved(runtime, "replay_stopped");
  await assertSafeAndRestartable(runtime);
});

test("five rapid mode changes retain one runtime of each resource", async () => {
  const runtime = createNeuralFieldRuntime();
  for (let index = 0; index < 5; index += 1) {
    const returnMode = index % 2 === 0 ? "ask" : "watch";
    await runtime.enter({ returnMode });
    await runtime.selectTool(index % 2 === 0 ? "airscript" : "spatial_lasso");
    assertActiveResourceBounds(runtime);
    await runtime.exit({ returnMode });
    assertInactive(runtime.snapshot(), returnMode);
    assertCleanResources(runtime);
  }
  await assertSafeAndRestartable(runtime);
});

test("tab hidden and resumed does not resurrect the old stroke", async () => {
  const runtime = await enterAirScript();
  await beginStroke(runtime);
  const oldGeneration = runtime.snapshot().generation;
  await runtime.handleVisibilityChange("hidden");
  assert.equal(strokeIsActive(runtime.snapshot()), false);
  assertResourceAtMost(runtime, ["animationFrames", "activeAnimationFrames"], 0);
  await runtime.handleVisibilityChange("visible");
  assert.ok(runtime.snapshot().generation >= oldGeneration);
  assert.equal(strokeIsActive(runtime.snapshot()), false);
  assertActiveResourceBounds(runtime);
  await assertSafeAndRestartable(runtime);
});

test("mobile rotation preserves state without duplicate renderer", async () => {
  const runtime = await enterSpatialLasso();
  await runtime.resizeViewport({ width: 390, height: 844, orientation: "portrait" });
  await runtime.resizeViewport({ width: 844, height: 390, orientation: "landscape" });
  const viewport = runtime.snapshot().state?.viewport ?? runtime.snapshot().viewport;
  assert.deepEqual(
    { width: viewport?.width, height: viewport?.height, orientation: viewport?.orientation },
    { width: 844, height: 390, orientation: "landscape" }
  );
  assert.equal(selectedTool(runtime.snapshot()), "spatial_lasso");
  assertActiveResourceBounds(runtime);
  await assertSafeAndRestartable(runtime);
});

test("stale relation update cannot render in a later generation", async () => {
  const runtime = await enterSpatialLasso();
  const generation = runtime.snapshot().generation;
  await runtime.exit({ returnMode: "watch" });
  await runtime.enter({ returnMode: "watch" });
  await runtime.selectTool("spatial_lasso");
  const renderCount = runtime.getRenderTimeline().length;
  const eventCount = runtime.getEventTimeline().length;
  await runtime.dispatch({
    type: "relation_update",
    generation,
    payload: { relation: structuredClone(relation), relations: [structuredClone(relation)] }
  });
  assert.equal(runtime.getRenderTimeline().length, renderCount);
  assert.deepEqual(relationTypes(runtime.snapshot()), []);
  assertStaleIgnored(runtime.getEventTimeline().slice(eventCount));
  await assertSafeAndRestartable(runtime);
});

test("stale object tracking update cannot restore an old anchor", async () => {
  const runtime = await enterSpatialLasso();
  const generation = runtime.snapshot().generation;
  await runtime.exit({ returnMode: "watch" });
  await runtime.enter({ returnMode: "watch" });
  await runtime.selectTool("spatial_lasso");
  const renderCount = runtime.getRenderTimeline().length;
  const eventCount = runtime.getEventTimeline().length;
  await runtime.dispatch({
    type: "object_tracking_update",
    generation,
    payload: { objectId: mug.id, object: structuredClone(mug), status: "tracked" }
  });
  assert.equal(runtime.getRenderTimeline().length, renderCount);
  assert.notEqual(selectedObjectId(runtime.snapshot()), mug.id);
  assertStaleIgnored(runtime.getEventTimeline().slice(eventCount));
  await assertSafeAndRestartable(runtime);
});

async function enterAirScript() {
  const runtime = createNeuralFieldRuntime();
  await runtime.enter({ returnMode: "ask" });
  await runtime.selectTool("airscript");
  return runtime;
}

async function enterSpatialLasso() {
  const runtime = createNeuralFieldRuntime();
  await runtime.enter({ returnMode: "watch" });
  await runtime.selectTool("spatial_lasso");
  await runtime.setScene(structuredClone(scene));
  return runtime;
}

async function beginStroke(runtime) {
  for (const frame of stablePinch) await runtime.feedLandmarkFrame(structuredClone(frame));
  for (const frame of slowCircle.slice(0, Math.min(4, slowCircle.length))) {
    await runtime.feedLandmarkFrame(structuredClone(frame));
  }
}

async function assertSafeAndRestartable(runtime) {
  await runtime.exit({ returnMode: "ask" });
  assertInactive(runtime.snapshot(), "ask");
  assertCleanResources(runtime);
  assertNoPersistedMedia(runtime.snapshot());

  for (const returnMode of ["ask", "watch"]) {
    await runtime.enter({ returnMode });
    assertActive(runtime.snapshot());
    assertActiveResourceBounds(runtime);
    assert.equal(strokeIsActive(runtime.snapshot()), false, "old stroke cannot return on restart");
    assert.deepEqual(relationTypes(runtime.snapshot()), [], "old relation cannot return on restart");
    await runtime.exit({ returnMode });
    assertInactive(runtime.snapshot(), returnMode);
    assertCleanResources(runtime);
  }
}

function assertActiveResourceBounds(runtime) {
  assertResourceAtMost(runtime, ["activeWorkers", "workers"], 1);
  assertResourceAtMost(runtime, ["rendererResourceCount", "activeRenderers"], 1);
  assertResourceAtMost(runtime, ["activeMediaStreams", "mediaStreams"], 1);
  assertResourceAtMost(runtime, ["mediaTracks", "activeMediaTracks"], 1);
  assertResourceAtMost(runtime, ["animationFrames", "activeAnimationFrames"], 1);
  assertResourceAtMost(runtime, ["canvases"], 1);
  assertResourceAtMost(runtime, ["eventListeners"], 1);
  assertResourceAtMost(runtime, ["activeSpeech", "speechInFlight"], 1);
  assertResourceAtMost(runtime, ["audioElements", "activeAudioElements"], 1);
  assertResourceAtMost(runtime, ["activeRecorders", "recorders"], 1);
  assertResourceAtMost(runtime, ["objectUrls", "activeObjectUrls"], 1);
}

function assertCleanResources(runtime) {
  assertResourceAtMost(runtime, ["activeWorkers", "workers"], 0);
  assertResourceAtMost(runtime, ["rendererResourceCount", "activeRenderers"], 0);
  assertResourceAtMost(runtime, ["activeMediaStreams", "mediaStreams"], 0);
  assertResourceAtMost(runtime, ["mediaTracks", "activeMediaTracks"], 0);
  assertResourceAtMost(runtime, ["animationFrames", "activeAnimationFrames"], 0);
  assertResourceAtMost(runtime, ["canvases"], 0);
  assertResourceAtMost(runtime, ["eventListeners"], 0);
  assertResourceAtMost(runtime, ["activeSpeech", "speechInFlight"], 0);
  assertResourceAtMost(runtime, ["audioElements", "activeAudioElements"], 0);
  assertResourceAtMost(runtime, ["activeRecorders", "recorders"], 0);
  assertResourceAtMost(runtime, ["objectUrls", "activeObjectUrls"], 0);
  assertResourceAtMost(runtime, ["activeRequests", "requestLocks"], 0);
  assert.equal(pendingRequests(runtime.snapshot()).length, 0, "no pending request may survive cleanup");
}

function assertResourceAtMost(runtime, names, maximum) {
  const resources = runtime.getResourceSnapshot();
  const value = resourceValue(resources, names);
  assert.ok(value <= maximum, `${names.join("|")} must be <= ${maximum}, received ${value}`);
}

function resourceValue(resources, names) {
  for (const name of names) {
    if (Number.isFinite(resources?.[name])) return resources[name];
  }
  const unavailable = new Set(resources?.unavailable ?? resources?.unavailableResources ?? []);
  if (names.some((name) => unavailable.has(name))) return 0;
  assert.fail(`resource instrumentation unavailable: ${names.join("|")}`);
}

function assertFailureObserved(runtime, failure) {
  const normalized = normalize(failure);
  assert.ok(
    runtime.getEventTimeline().some((event) => normalize(event.type).includes(normalized)),
    `failure event must be observable: ${failure}`
  );
}

function assertStaleIgnored(events) {
  assert.ok(
    events.some((event) => String(event.type).includes("stale_ignored")),
    "stale event must be explicitly recorded as ignored"
  );
}

function assertNoPersistedMedia(snapshot) {
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /"(?:encoded_frame|rawFrame|mediaPayload|audioPayload|videoPayload|dataUrl)"\s*:/i);
  assert.doesNotMatch(serialized, /(?:data:(?:image|video|audio)\/|blob:)/i);
}

function assertActive(snapshot) {
  assert.ok(isActive(snapshot), "Neural Field must be active");
}

function isActive(snapshot) {
  const active = snapshot.state?.active ?? snapshot.active;
  const mode = snapshot.state?.mode ?? snapshot.mode;
  return active === true || mode === "neural_field";
}

function assertInactive(snapshot, returnMode) {
  const active = snapshot.state?.active ?? snapshot.active;
  const mode = snapshot.state?.mode ?? snapshot.mode;
  assert.ok(active === false || mode === returnMode, `Neural Field must return to ${returnMode}`);
}

function selectedTool(snapshot) {
  return snapshot.state?.tool ?? snapshot.tool ?? null;
}

function strokeIsActive(snapshot) {
  return Boolean(snapshot.stroke?.active ?? snapshot.state?.stroke?.active);
}

function strokePointCount(snapshot) {
  return snapshot.stroke?.points?.length
    ?? snapshot.stroke?.segments?.length
    ?? snapshot.state?.stroke?.points?.length
    ?? 0;
}

function selectedObjectId(snapshot) {
  return snapshot.selection?.objectId
    ?? snapshot.selection?.selectedObjectId
    ?? snapshot.selection?.targetId
    ?? snapshot.selection?.anchorId
    ?? snapshot.state?.selection?.objectId
    ?? null;
}

function relationTypes(snapshot) {
  return (snapshot.relations ?? snapshot.state?.relations ?? []).map((item) => item.type ?? item.relation);
}

function pendingRequests(snapshot) {
  return Array.isArray(snapshot.pendingRequests)
    ? snapshot.pendingRequests
    : Object.values(snapshot.pendingRequests ?? {});
}

function requiredFixture(catalog, requestedId) {
  const requested = normalize(requestedId);
  for (const [key, value] of Object.entries(catalog)) {
    const ids = [key, value?.id, value?.name, value?.scenario].filter(Boolean).map(normalize);
    if (ids.includes(requested)) return value;
  }
  assert.fail(`required fixture unavailable: ${requestedId}`);
}

function frames(fixture) {
  const value = Array.isArray(fixture)
    ? fixture
    : fixture?.frames ?? fixture?.landmarkFrames ?? fixture?.sequence;
  assert.ok(Array.isArray(value) && value.length > 0, `fixture ${fixture?.id ?? "unknown"} must contain frames`);
  return value;
}

function requiredObject(targetScene, label) {
  const object = (targetScene.objects ?? []).find((candidate) => normalize(candidate.label ?? candidate.name ?? candidate.id) === normalize(label));
  assert.ok(object?.id, `scene must contain object: ${label}`);
  return object;
}

function requiredRelation(targetScene, type) {
  const targetRelation = (targetScene.relations ?? []).find((candidate) => (candidate.type ?? candidate.relation) === type);
  assert.ok(targetRelation, `scene must contain relation: ${type}`);
  return targetRelation;
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
