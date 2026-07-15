import { createNeuralFieldRuntime } from "../runtime.mjs";
import { LANDMARK_FIXTURES, SCENE_FIXTURES } from "/fixtures/fixture-library.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const runtime = await createNeuralFieldRuntime();
const fixtureIds = new Set();
const metrics = { feedDurations: [], renderDurations: [], actionDurations: [] };
const listenerLedger = new Set();
let baseMode = "ask";
let currentScene = null;
let sourceViewport = { width: 1000, height: 600 };

const elements = Object.freeze({
  app: document.querySelector("#app"),
  home: document.querySelector("#home-view"),
  field: document.querySelector("#neural-field-view"),
  homeTitle: document.querySelector("#home-title"),
  homeDescription: document.querySelector("#home-description"),
  ask: document.querySelector("#base-ask"),
  watch: document.querySelector("#base-watch"),
  enter: document.querySelector("#enter-neural-field"),
  exit: document.querySelector("#exit-neural-field"),
  airscript: document.querySelector("#tool-airscript"),
  spatialLasso: document.querySelector("#tool-spatial-lasso"),
  fieldTitle: document.querySelector("#field-title"),
  fieldStage: document.querySelector("#field-stage"),
  cameraState: document.querySelector("#camera-state"),
  trackingState: document.querySelector("#tracking-state"),
  sceneLayer: document.querySelector("#scene-layer"),
  relationLayer: document.querySelector("#relation-layer"),
  selectionLayer: document.querySelector("#selection-layer"),
  activeTrajectory: document.querySelector("#active-trajectory"),
  stableTrajectory: document.querySelector("#stable-trajectory"),
  classificationChip: document.querySelector("#classification-chip"),
  classificationValue: document.querySelector("#classification-value"),
  uncertaintyChip: document.querySelector("#uncertainty-chip"),
  stepTitle: document.querySelector("#step-title"),
  stepDetail: document.querySelector("#step-detail"),
  summaryTool: document.querySelector("#summary-tool"),
  summaryStroke: document.querySelector("#summary-stroke"),
  summarySelection: document.querySelector("#summary-selection"),
  summaryRelation: document.querySelector("#summary-relation"),
  stateOutput: document.querySelector("#state-output")
});

listen(elements.ask, "click", () => setBaseMode("ask"));
listen(elements.watch, "click", () => setBaseMode("watch"));
listen(elements.enter, "click", () => safeAction(() => enter(baseMode)));
listen(elements.exit, "click", () => safeAction(() => exit(baseMode)));
listen(elements.airscript, "click", () => safeAction(() => selectTool("airscript")));
listen(elements.spatialLasso, "click", () => safeAction(() => selectTool("spatial_lasso")));

setBaseMode("ask");
render();

window.__NEURAL_FIELD_TEST__ = Object.freeze({
  ready: true,
  enter,
  exit,
  selectTool,
  feedLandmarkFixture,
  feedLandmarkFrame,
  setScene,
  moveObject,
  moveObjectByLabel,
  snapshot: () => runtime.snapshot(),
  getEventTimeline: () => runtime.getEventTimeline(),
  getRenderTimeline: () => runtime.getRenderTimeline(),
  getResourceSnapshot: getBrowserResourceSnapshot,
  getPersistedState,
  getFixtureIds: () => [...fixtureIds],
  getMetrics,
  render
});

async function enter(returnMode = baseMode) {
  setBaseMode(returnMode);
  await measuredAction("enter", () => runtime.enter({ returnMode }));
  elements.home.hidden = true;
  elements.field.hidden = false;
  render();
  return runtime.snapshot();
}

async function exit(returnMode = baseMode) {
  await measuredAction("exit", () => runtime.exit({ returnMode }));
  currentScene = null;
  sourceViewport = { width: 1000, height: 600 };
  setBaseMode(returnMode);
  elements.field.hidden = true;
  elements.home.hidden = false;
  render();
  return runtime.snapshot();
}

async function selectTool(tool) {
  await measuredAction("select_tool", () => runtime.selectTool(tool));
  render();
  return runtime.snapshot();
}

async function setScene(sceneOrId) {
  const entry = typeof sceneOrId === "string" ? fixtureById(SCENE_FIXTURES, sceneOrId) : sceneOrId;
  if (!entry) throw new Error(`Unknown synthetic scene fixture: ${sceneOrId}`);
  const scene = entry.scene || entry;
  fixtureIds.add(entry.id || scene.id || String(sceneOrId));
  currentScene = structuredClone(scene);
  sourceViewport = normalizeViewport(scene.viewport);
  await measuredAction("set_scene", () => runtime.setScene(structuredClone(scene)));
  render();
  return runtime.snapshot();
}

async function feedLandmarkFixture(fixtureId, options = {}) {
  const fixture = fixtureById(LANDMARK_FIXTURES, fixtureId);
  if (!fixture) throw new Error(`Unknown synthetic landmark fixture: ${fixtureId}`);
  fixtureIds.add(fixture.id || fixtureId);
  sourceViewport = normalizeViewport(fixture.viewport || fixture.frames[0]?.viewport);

  const total = fixture.frames.length;
  const requestedStart = Number(options.start || 0);
  const start = requestedStart < 0 ? Math.max(0, total + requestedStart) : Math.max(0, requestedStart);
  const requestedEnd = options.end == null ? total : Number(options.end);
  const end = requestedEnd < 0 ? Math.max(start, total + requestedEnd) : Math.min(total, requestedEnd);
  const alignment = options.aroundObject
    ? alignmentForObject(fixture.frames.slice(start, end), options.aroundObject)
    : { x: 0, y: 0 };

  for (const frame of fixture.frames.slice(start, end)) {
    const transformed = transformFrame(frame, {
      offsetX: alignment.x + Number(options.offsetX || 0),
      offsetY: alignment.y + Number(options.offsetY || 0)
    });
    await feedLandmarkFrame(transformed);
    if (options.animate) await nextAnimationFrame();
  }
  return runtime.snapshot();
}

async function feedLandmarkFrame(frame) {
  const startedAt = performance.now();
  await runtime.feedLandmarkFrame(frame);
  pushBounded(metrics.feedDurations, performance.now() - startedAt);
  render();
  return runtime.snapshot();
}

async function moveObject(id, patch) {
  await measuredAction("move_object", () => runtime.moveObject(id, structuredClone(patch)));
  if (currentScene) {
    const object = currentScene.objects?.find((candidate) => candidate.id === id);
    if (object) Object.assign(object, structuredClone(patch));
  }
  render();
  return runtime.snapshot();
}

async function moveObjectByLabel(label, patch) {
  const object = runtime.snapshot().objects?.find((candidate) => candidate.label?.toLowerCase() === label.toLowerCase());
  if (!object) throw new Error(`Synthetic object not found: ${label}`);
  return moveObject(object.id, patch);
}

function setBaseMode(mode) {
  baseMode = mode === "watch" ? "watch" : "ask";
  elements.ask.classList.toggle("is-selected", baseMode === "ask");
  elements.watch.classList.toggle("is-selected", baseMode === "watch");
  elements.ask.setAttribute("aria-pressed", String(baseMode === "ask"));
  elements.watch.setAttribute("aria-pressed", String(baseMode === "watch"));
  elements.homeTitle.textContent = titleCase(baseMode);
  elements.homeDescription.textContent = baseMode === "ask"
    ? "Ask remains ready before and after the Neural Field session."
    : "Watch remains ready before and after the Neural Field session.";
  elements.app.dataset.view = baseMode;
}

function render() {
  const startedAt = performance.now();
  const snapshot = runtime.snapshot();
  const active = Boolean(snapshot.active);
  const tool = snapshot.tool || "none";
  elements.app.dataset.active = String(active);
  elements.app.dataset.tool = tool;
  elements.app.dataset.generation = String(snapshot.generation ?? 0);
  elements.airscript.classList.toggle("is-selected", tool === "airscript");
  elements.spatialLasso.classList.toggle("is-selected", tool === "spatial_lasso");
  elements.airscript.setAttribute("aria-pressed", String(tool === "airscript"));
  elements.spatialLasso.setAttribute("aria-pressed", String(tool === "spatial_lasso"));
  elements.fieldTitle.textContent = tool === "airscript" ? "AirScript" : tool === "spatial_lasso" ? "Spatial Lasso" : "Choose a tool";
  elements.summaryTool.textContent = tool === "none" ? "None" : tool === "airscript" ? "AirScript" : "Spatial Lasso";
  elements.cameraState.textContent = snapshot.objects?.length ? "Synthetic scene active" : "Synthetic camera ready";
  elements.trackingState.textContent = handSummary(snapshot.hand);
  renderScene(snapshot);
  renderTrajectory(snapshot);
  renderRelations(snapshot);
  renderSelection(snapshot);
  renderStatus(snapshot);
  elements.stateOutput.textContent = JSON.stringify(safeState(snapshot), null, 2);
  pushBounded(metrics.renderDurations, performance.now() - startedAt);
  return snapshot;
}

function renderScene(snapshot) {
  elements.sceneLayer.replaceChildren();
  for (const object of snapshot.objects || []) {
    const tracking = object.tracking || object.status || "tracked";
    const box = projectBox(object.bbox || {});
    const group = svg("g", {
      class: "scene-object",
      "data-object-id": object.id,
      "data-object-label": object.label,
      "data-tracking": tracking
    });
    group.append(svg("rect", {
      class: "object-box",
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rx: 12
    }));
    if (!/face/i.test(object.label || "")) appendObjectLabel(group, object.label || "object", box);
    else group.setAttribute("aria-label", "Privacy-sensitive region; label overlay withheld");
    elements.sceneLayer.append(group);
  }
  for (const face of currentScene?.faces || []) {
    const box = projectBox(face.bbox || {});
    const group = svg("g", { class: "face-safe-region", "data-face-id": face.id, "aria-label": "Privacy-sensitive region" });
    group.append(svg("rect", { class: "face-safe-box", x: box.x, y: box.y, width: box.width, height: box.height, rx: 24 }));
    elements.sceneLayer.append(group);
  }
}

function appendObjectLabel(group, label, box) {
  const width = clamp(70 + label.length * 8, 96, 210);
  const x = clamp(box.x, 8, 992 - width);
  let y = clamp(box.y - 34, 8, 554);
  const labelRect = () => ({ x, y, width, height: 28 });
  const faceBoxes = (currentScene?.faces || []).map((face) => projectBox(face.bbox || {}));
  if (faceBoxes.some((face) => boxesIntersect(labelRect(), face))) {
    y = clamp(box.y + box.height + 6, 8, 554);
  }
  group.append(svg("rect", { class: "object-label-backdrop", x, y, width, height: 28, rx: 8 }));
  const text = svg("text", { class: "object-label", x: x + 10, y: y + 20 });
  text.textContent = label;
  group.append(text);
}

function boxesIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function renderTrajectory(snapshot) {
  const stroke = snapshot.stroke;
  const lasso = snapshot.lasso;
  const trajectory = stroke?.points?.length ? stroke : lasso;
  const points = (trajectory?.points || []).map(projectPoint).map((point) => `${point.x},${point.y}`).join(" ");
  const status = trajectory?.status || "idle";
  const stable = /stable|complete|classified|committed/i.test(status);
  elements.activeTrajectory.toggleAttribute("hidden", !points || stable);
  elements.stableTrajectory.toggleAttribute("hidden", !points || !stable);
  elements.activeTrajectory.setAttribute("points", points);
  elements.stableTrajectory.setAttribute("points", points);
  elements.fieldStage.dataset.renderState = !points ? "idle" : stable ? "stable" : "live";

  const classification = classificationFor(snapshot);
  elements.classificationChip.hidden = !classification.label;
  elements.classificationValue.textContent = classification.label || "Waiting";
  elements.classificationChip.dataset.confidence = String(classification.confidence ?? "unknown");
}

function renderRelations(snapshot) {
  elements.relationLayer.replaceChildren();
  for (const relation of snapshot.relations || []) {
    const subject = snapshot.objects?.find((object) => object.id === relation.subjectId);
    const object = snapshot.objects?.find((candidate) => candidate.id === (relation.objectId || relation.referenceId));
    if (!subject || !object || /lost|cleared|stale/i.test(relation.status || "")) continue;
    const from = centerOf(projectBox(subject.bbox || {}));
    const to = centerOf(projectBox(object.bbox || {}));
    const group = svg("g", { class: "relation-connector", "data-relation": relation.type, "data-relation-id": relation.id });
    group.append(svg("line", { class: "relation-line", x1: from.x, y1: from.y, x2: to.x, y2: to.y }));
    const label = relation.type || "relation";
    const width = clamp(70 + label.length * 8, 100, 220);
    const x = clamp((from.x + to.x) / 2 - width / 2, 8, 992 - width);
    const y = clamp((from.y + to.y) / 2 - 16, 8, 560);
    group.append(svg("rect", { class: "relation-label-backdrop", x, y, width, height: 30, rx: 8 }));
    const text = svg("text", { class: "relation-label", x: x + 10, y: y + 21 });
    text.textContent = label;
    group.append(text);
    elements.relationLayer.append(group);
  }
}

function renderSelection(snapshot) {
  elements.selectionLayer.replaceChildren();
  const selection = snapshot.selection || {};
  const selectedIds = [selection.anchorId, selection.targetId, ...(selection.candidates || []).map((candidate) => candidate.id || candidate)]
    .filter(Boolean);
  for (const id of new Set(selectedIds)) {
    const object = snapshot.objects?.find((candidate) => candidate.id === id);
    if (!object) continue;
    const box = projectBox(object.bbox || {});
    elements.selectionLayer.append(svg("rect", {
      class: "selection-ring",
      "data-selection-id": id,
      x: clamp(box.x - 8, 2, 998),
      y: clamp(box.y - 8, 2, 598),
      width: clamp(box.width + 16, 1, 996 - clamp(box.x - 8, 2, 998)),
      height: clamp(box.height + 16, 1, 596 - clamp(box.y - 8, 2, 598)),
      rx: 16
    }));
  }
}

function renderStatus(snapshot) {
  const strokeStatus = snapshot.stroke?.status || snapshot.lasso?.status || "idle";
  const selectionStatus = snapshot.selection?.status || (snapshot.selection?.anchorId ? "anchored" : "none");
  const relation = snapshot.relations?.find((item) => !/cleared|stale/i.test(item.status || ""));
  const classification = classificationFor(snapshot);
  const uncertain = /ambiguous|uncertain|low/i.test(selectionStatus)
    || (classification.label && classification.confidence != null && classification.confidence < 0.72)
    || /freeform|uncertain/i.test(classification.label || "");
  elements.uncertaintyChip.hidden = !uncertain;
  elements.summaryStroke.textContent = titleCase(strokeStatus);
  elements.summarySelection.textContent = titleCase(selectionStatus);
  elements.summaryRelation.textContent = relation?.type || "None";

  if (snapshot.tool === "airscript") {
    elements.stepTitle.textContent = classification.label
      ? `${titleCase(classification.label)} ready for confirmation`
      : /stable|complete/i.test(strokeStatus) ? "Stroke stabilized" : /active|drawing|live/i.test(strokeStatus) ? "Drawing live stroke" : "Pinch to begin a stroke";
    elements.stepDetail.textContent = "Release stabilizes the trajectory before a local classification is shown.";
  } else if (snapshot.tool === "spatial_lasso") {
    elements.stepTitle.textContent = /lost|cleared/i.test(selectionStatus)
      ? "Tracking lost; anchor cleared"
      : relation ? `${relation.type} relation updated`
        : /ambiguous|uncertain/i.test(selectionStatus) ? "Selection needs manual confirmation"
          : snapshot.selection?.anchorId ? "Anchor set; select another object" : "Draw a lasso around an object";
    elements.stepDetail.textContent = "Grounding and relations come from the synthetic scene contract and remain manually confirmable.";
  } else {
    elements.stepTitle.textContent = "Select AirScript or Spatial Lasso";
    elements.stepDetail.textContent = "Synthetic fixtures will follow the same hand-event and renderer contracts.";
  }
}

function alignmentForObject(frames, objectIdOrLabel) {
  const object = (currentScene?.objects || []).find((candidate) => candidate.id === objectIdOrLabel
    || candidate.label?.toLowerCase() === String(objectIdOrLabel).toLowerCase());
  if (!object) throw new Error(`Cannot align trajectory: synthetic object not found: ${objectIdOrLabel}`);
  const tips = frames.flatMap((frame) => (frame.hands || []).flatMap((hand) => {
    const landmarks = hand.landmarks || [];
    const tip = landmarks.find((landmark) => landmark.index === 8 || /index.*tip/i.test(landmark.name || ""));
    return tip ? [tip] : [];
  }));
  if (!tips.length) return { x: 0, y: 0 };
  const centroid = tips.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  centroid.x /= tips.length;
  centroid.y /= tips.length;
  const target = normalizedBox(object.bbox || {}, normalizeViewport(currentScene.viewport));
  return { x: target.x + target.width / 2 - centroid.x, y: target.y + target.height / 2 - centroid.y };
}

function transformFrame(frame, offset) {
  const clone = structuredClone(frame);
  for (const hand of clone.hands || []) {
    for (const landmark of hand.landmarks || []) {
      landmark.x = landmark.x + offset.offsetX;
      landmark.y = landmark.y + offset.offsetY;
    }
  }
  return clone;
}

function fixtureById(catalog, id) {
  if (Array.isArray(catalog)) return catalog.find((fixture) => fixture.id === id);
  if (catalog instanceof Map) return catalog.get(id);
  return catalog?.[id] || Object.values(catalog || {}).find((fixture) => fixture.id === id);
}

function classificationFor(snapshot) {
  const value = snapshot.stroke?.classification || snapshot.classification;
  if (!value) return { label: "", confidence: null };
  if (typeof value === "string") return { label: value, confidence: null };
  return { label: value.label || value.type || value.name || "", confidence: value.confidence ?? null };
}

function projectPoint(point) {
  const width = sourceViewport.width || 1;
  const height = sourceViewport.height || 1;
  return {
    x: clamp(Math.abs(point.x) <= 1.5 ? point.x * 1000 : point.x / width * 1000, 0, 1000),
    y: clamp(Math.abs(point.y) <= 1.5 ? point.y * 600 : point.y / height * 600, 0, 600)
  };
}

function projectBox(box) {
  const normalized = normalizedBox(box, sourceViewport);
  return {
    x: clamp(normalized.x * 1000, 0, 1000),
    y: clamp(normalized.y * 600, 0, 600),
    width: clamp(normalized.width * 1000, 1, 1000),
    height: clamp(normalized.height * 600, 1, 600)
  };
}

function normalizedBox(box, viewport) {
  const alreadyNormalized = Math.abs(box.x || 0) <= 1.5 && Math.abs(box.y || 0) <= 1.5
    && Math.abs(box.width || 0) <= 1.5 && Math.abs(box.height || 0) <= 1.5;
  return alreadyNormalized
    ? { x: box.x || 0, y: box.y || 0, width: box.width || 0, height: box.height || 0 }
    : {
        x: (box.x || 0) / viewport.width,
        y: (box.y || 0) / viewport.height,
        width: (box.width || 0) / viewport.width,
        height: (box.height || 0) / viewport.height
      };
}

function normalizeViewport(viewport) {
  return { width: viewport?.width || 1000, height: viewport?.height || 600 };
}

function centerOf(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function handSummary(hand) {
  if (!hand) return "No hand";
  if (Array.isArray(hand.hands)) return hand.hands.length ? `${hand.hands.length} hand${hand.hands.length === 1 ? "" : "s"}` : "No hand";
  if (hand.present === false || hand.status === "absent") return "No hand";
  return titleCase(hand.handedness || hand.status || "Hand event active");
}

function safeState(snapshot) {
  return {
    mode: snapshot.mode,
    active: snapshot.active,
    tool: snapshot.tool,
    generation: snapshot.generation,
    stroke: snapshot.stroke ? { id: snapshot.stroke.id, status: snapshot.stroke.status, pointCount: snapshot.stroke.points?.length || 0, classification: snapshot.stroke.classification || null } : null,
    lasso: snapshot.lasso ? { id: snapshot.lasso.id, status: snapshot.lasso.status, pointCount: snapshot.lasso.points?.length || 0 } : null,
    selection: snapshot.selection,
    objects: (snapshot.objects || []).map((object) => ({ id: object.id, label: object.label, tracking: object.tracking || object.status })),
    relations: snapshot.relations,
    pendingRequests: snapshot.pendingRequests,
    resources: snapshot.resources
  };
}

async function measuredAction(name, action) {
  const startedAt = performance.now();
  const result = await action();
  pushBounded(metrics.actionDurations, { name, durationMs: performance.now() - startedAt });
  return result;
}

function getMetrics() {
  return {
    feed: summarize(metrics.feedDurations),
    render: summarize(metrics.renderDurations),
    actions: metrics.actionDurations.slice(-100),
    semanticRequestCount: runtime.getResourceSnapshot()?.semanticRequests ?? runtime.snapshot().resources?.semanticRequests ?? 0
  };
}

function getBrowserResourceSnapshot() {
  const runtimeResources = runtime.getResourceSnapshot() || {};
  const mediaElements = [...document.querySelectorAll("video,audio")];
  const liveMediaTracks = mediaElements.flatMap((element) => element.srcObject?.getTracks?.() || [])
    .filter((track) => track.readyState === "live").length;
  return {
    ...runtimeResources,
    domCanvases: document.querySelectorAll("canvas").length,
    domAudioElements: document.querySelectorAll("audio").length,
    domVideoElements: document.querySelectorAll("video").length,
    liveMediaTracks,
    domEventListeners: listenerLedger.size,
    jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    strokeObjects: runtime.snapshot().stroke ? 1 : 0,
    relationObjects: runtime.snapshot().relations?.length || 0
  };
}

function getPersistedState() {
  return {
    runtime: runtime.getPersistedState?.() || {},
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return [key, localStorage.getItem(key)];
    })),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index);
      return [key, sessionStorage.getItem(key)];
    }))
  };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (ratio) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] : 0;
  return { count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: sorted.at(-1) || 0 };
}

function pushBounded(target, value, limit = 500) {
  target.push(value);
  if (target.length > limit) target.splice(0, target.length - limit);
}

function svg(name, attributes) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function titleCase(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function listen(target, type, handler) {
  target.addEventListener(type, handler);
  listenerLedger.add(`${target.id || target.tagName}:${type}`);
}

async function safeAction(action) {
  try {
    await action();
  } catch (error) {
    console.error("Synthetic Neural Field action failed", error);
    elements.stepTitle.textContent = "Fixture action unavailable";
    elements.stepDetail.textContent = "The current deterministic contract did not complete this action.";
  }
}
