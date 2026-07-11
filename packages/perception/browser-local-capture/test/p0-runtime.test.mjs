import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROTOTYPE_DIR = resolve(TEST_DIR, "../prototype");
const CHROME_CANDIDATES = [
  process.env.DARKQUEST_CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8"
};
const MEDIA_PIPE_MODULE = `
  export class FilesetResolver {
    static async forVisionTasks() {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { test_runtime: true };
    }
  }
  export class GestureRecognizer {
    static async createFromOptions(_vision, options) {
      globalThis.__dqP0RecognizerOptions = options;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        recognizeForVideo(_video, timestampMs) {
          const scenario = globalThis.__dqP0RecognizerScenario || { mode: "neutral" };
          scenario.calls = Number(scenario.calls || 0) + 1;
          const hand = globalThis.__dqP0MakeHand?.("heart", 0, 0, 0) || [];
          if (scenario.mode === "thumbs_up") {
            return {
              gestures: [[{ categoryName: "Thumb_Up", score: 0.96 }]],
              landmarks: [hand],
              handedness: [[{ categoryName: "Right" }]],
              timestamp_ms: timestampMs
            };
          }
          return { gestures: [], landmarks: [], handedness: [], timestamp_ms: timestampMs };
        },
        close() {}
      };
    }
  }
`;

const BOOTSTRAP_SOURCE = String.raw`
  (() => {
    const storageWrites = [];
    const storageViolations = [];
    const originalSetItem = Storage.prototype.setItem;
    const inspectStorageWrite = (key, value) => {
      const text = String(value || "");
      const unsafe = /data:(?:image|video)|;base64,|blob:|encoded[_-]?frame|raw[_-]?frame/i.test(text);
      storageWrites.push({ key: String(key), length: text.length });
      if (unsafe) storageViolations.push({ key: String(key), reason: "raw_media_value" });
    };
    Storage.prototype.setItem = function(key, value) {
      inspectStorageWrite(key, value);
      return originalSetItem.call(this, key, value);
    };

    const fakeTrack = { kind: "video", readyState: "live", stop() { this.readyState = "ended"; } };
    const fakeStream = { active: true, getTracks() { return [fakeTrack]; }, getVideoTracks() { return [fakeTrack]; } };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { async getUserMedia(constraints) {
        globalThis.__dqP0CameraConstraints = constraints;
        return fakeStream;
      } }
    });
    for (const [property, value] of [["readyState", 4], ["videoWidth", 640], ["videoHeight", 480]]) {
      try {
        Object.defineProperty(HTMLMediaElement.prototype, property, { configurable: true, get: () => value });
      } catch {}
    }
    try {
      let assignedStream = null;
      Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
        configurable: true,
        get: () => assignedStream,
        set: (value) => { assignedStream = value; }
      });
    } catch {}
    HTMLMediaElement.prototype.play = async function() {
      this.dispatchEvent(new Event("loadeddata"));
    };
    globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16);
    globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
    try {
      HTMLVideoElement.prototype.requestVideoFrameCallback = (callback) => setTimeout(() => callback(performance.now(), { mediaTime: performance.now() / 1000 }), 16);
      HTMLVideoElement.prototype.cancelVideoFrameCallback = (handle) => clearTimeout(handle);
    } catch {}
    try {
      CanvasRenderingContext2D.prototype.drawImage = function() {};
    } catch {}

    const speech = {
      spoken: [],
      cancelCalls: 0,
      cancel() { this.cancelCalls += 1; },
      speak(utterance) {
        utterance.onstart?.();
        this.spoken.push(String(utterance.text || ""));
        utterance.onend?.();
      }
    };
    class TestUtterance { constructor(text) { this.text = text; } }
    try { Object.defineProperty(globalThis, "speechSynthesis", { configurable: true, value: speech }); } catch {}
    try { Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: TestUtterance }); } catch {}

    const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value)));
    globalThis.__dqP0MakeHand = (kind, hand, variant, frame) => {
      const side = hand === 0 ? -1 : 1;
      return Array.from({ length: 21 }, (_, index) => {
        const finger = Math.floor(Math.max(0, index - 1) / 4);
        const joint = index === 0 ? 0 : ((index - 1) % 4) + 1;
        const variation = Number(variant) * 0.0013 * ((index % 5) - 2);
        const temporal = kind === "jitter"
          ? Number(frame) * 0.18 * (index % 2 ? 1 : -1)
          : Number(frame) * 0.00015 * ((index % 3) - 1);
        return {
          x: clamp(0.5 + side * (0.12 - joint * 0.012 + finger * 0.006) + variation + temporal),
          y: clamp(0.72 - joint * 0.075 + Math.abs(finger - 2) * 0.015 - variation),
          z: clamp(variation, -1, 1)
        };
      });
    };
    globalThis.__dqP0MakeFrame = (variant, handCount, timestampMs, kind = "heart") => {
      const hands = Array.from({ length: handCount }, (_, index) => ({
        handedness: index === 0 ? "Left" : "Right",
        landmarks: globalThis.__dqP0MakeHand(kind, index, variant, 0)
      }));
      return {
        timestamp_ms: Number(timestampMs),
        hands,
        landmarks: hands.map((hand) => hand.landmarks),
        handedness: hands.map((hand) => [{ categoryName: hand.handedness }]),
        mirrored: false,
        contains_raw_media: false
      };
    };
    globalThis.__dqP0RecognizerScenario = { mode: "neutral", calls: 0 };
    globalThis.__dqP0StorageWrites = storageWrites;
    globalThis.__dqP0StorageViolations = storageViolations;
    globalThis.__dqP0StatusHistory = [];
    globalThis.__dqP0FrameClock = 1000;
    document.addEventListener("DOMContentLoaded", () => {
      const node = document.querySelector("#instantGestureStatus");
      if (!node) return;
      const record = () => {
        const value = String(node.textContent || "").trim();
        if (value && globalThis.__dqP0StatusHistory.at(-1) !== value) globalThis.__dqP0StatusHistory.push(value);
      };
      record();
      new MutationObserver(record).observe(node, { childList: true, characterData: true, subtree: true });
    }, { once: true });
  })();
`;

const checks = [];
let server;
let chrome;
let profileDir;
let cdp;
const USE_REAL_MEDIAPIPE = process.env.DARKQUEST_P0_REAL_MEDIAPIPE === "1";

class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const handler of this.handlers.get(message.method) || []) handler(message);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("Chrome DevTools connection closed."));
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, { method, resolve: resolveCommand, reject: rejectCommand });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}

try {
  const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  assert.ok(chromePath, "P0 runtime test requires Chrome/Chromium; set DARKQUEST_CHROME_BIN when it is not in a standard location.");

  const hosted = await startPrototypeServer();
  server = hosted.server;
  profileDir = await mkdtemp(join(tmpdir(), "darkquest-p0-runtime-"));
  const launched = await launchChrome(chromePath, profileDir);
  chrome = launched.process;
  cdp = await CdpClient.connect(launched.webSocketUrl);

  const { targetInfos } = await cdp.send("Target.getTargets");
  const pageTarget = targetInfos.find((target) => target.type === "page");
  assert.ok(pageTarget?.targetId, "Chrome did not expose a page target.");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOTSTRAP_SOURCE }, sessionId);

  let mediaPipeRequestId = "";
  let releaseMediaPipeRequest;
  let deferMediaPipeFulfillment = true;
  const mediaPipeRequestSeen = new Promise((resolveSeen) => { releaseMediaPipeRequest = resolveSeen; });
  const runtimeExceptions = [];
  cdp.on("Runtime.exceptionThrown", ({ params, sessionId: eventSession }) => {
    if (eventSession === sessionId) runtimeExceptions.push(params.exceptionDetails?.text || "browser exception");
  });
  cdp.on("Fetch.requestPaused", ({ params, sessionId: eventSession }) => {
    if (eventSession !== sessionId) return;
    if (params.request.url.includes("@mediapipe/tasks-vision") && params.request.url.endsWith("vision_bundle.mjs")) {
      mediaPipeRequestId = params.requestId;
      releaseMediaPipeRequest();
      if (USE_REAL_MEDIAPIPE) {
        void cdp.send("Fetch.continueRequest", { requestId: params.requestId }, sessionId);
      } else if (!deferMediaPipeFulfillment) {
        void fulfillMediaPipeRequest(params.requestId);
      }
      return;
    }
    void cdp.send("Fetch.continueRequest", { requestId: params.requestId }, sessionId);
  });
  const fulfillMediaPipeRequest = (requestId) => cdp.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: 200,
    responseHeaders: [
      { name: "Content-Type", value: "text/javascript; charset=utf-8" },
      { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Cache-Control", value: "no-store" }
    ],
    body: Buffer.from(MEDIA_PIPE_MODULE).toString("base64")
  }, sessionId);

  const evaluate = async (expression) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, sessionId);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Browser evaluation failed.");
    }
    return response.result?.value;
  };
  const waitFor = async (expression, predicate, label, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    let value;
    while (Date.now() < deadline) {
      value = await evaluate(expression);
      if (predicate(value)) return value;
      await delay(50);
    }
    throw new Error(`${label}; last value: ${JSON.stringify(value)}`);
  };
  const snapshot = () => evaluate("globalThis.__darkquestP0Runtime?.snapshot?.() || null");
  const instant = (value) => value?.instantGestureRuntimeState || value?.instant_gesture_runtime || value?.instant || value || {};
  const trainer = (value) => value?.customSkillTrainer || value?.custom_skill_trainer || value?.customSkillDraft || value?.trainer || {};
  const record = (name) => checks.push(name);

  await cdp.send("Page.navigate", { url: `${hosted.origin}/index.html?p0-runtime-test=1` }, sessionId);
  await waitFor(
    "Boolean(document.querySelector('#instantGestures') && globalThis.__darkquestP0Runtime?.snapshot)",
    Boolean,
    "prototype runtime did not boot"
  );

  await evaluate(`(() => {
    const details = document.querySelector('#automationManagerPanel');
    if (details) details.open = true;
    const toggle = document.querySelector('#instantGestures');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const cameraOffStatus = await waitFor(
    "document.querySelector('#instantGestureStatus').textContent.trim()",
    (value) => /enabled.*waiting for camera/i.test(value),
    "checked + camera off did not show Enabled — waiting for camera"
  );
  assert.match(cameraOffStatus, /enabled.*waiting for camera/i);
  assert.equal(await evaluate("document.querySelector('#instantGestures').checked"), true);
  let runtimeSnapshot = await snapshot();
  assert.equal(instant(runtimeSnapshot).user_enabled ?? instant(runtimeSnapshot).userEnabled, true);
  assert.equal(instant(runtimeSnapshot).effective_enabled ?? instant(runtimeSnapshot).effectiveEnabled, false);
  assert.equal(instant(runtimeSnapshot).loop_running ?? instant(runtimeSnapshot).loopRunning, false);
  record("instant.camera_off_waiting");

  await evaluate(`(() => {
    const overlay = document.querySelector('#showTrackingOverlay');
    overlay.checked = !overlay.checked;
    overlay.dispatchEvent(new Event('change', { bubbles: true }));
    window.dispatchEvent(new Event('resize'));
  })()`);
  assert.equal(await evaluate("document.querySelector('#instantGestures').checked"), true, "full render/resize reset the instant preference");
  assert.doesNotMatch(await evaluate("document.querySelector('#instantGestureStatus').textContent.trim()"), /^Off$/i);
  record("instant.rerender_resize_preserved");

  await openTwoHandWizard(evaluate);
  assert.equal(await evaluate("document.querySelector('#captureCustomGestureExample').type"), "button");
  assert.equal(await evaluate("document.querySelector('#captureCustomGestureExample').textContent.trim()"), "Capture example");
  assert.equal(await evaluate("document.querySelector('#customGestureNext').disabled"), true, "Next must remain disabled before five accepted examples");
  await evaluate("document.querySelector('#captureCustomGestureExample').click()");
  const missingCamera = await waitFor(
    "document.querySelector('#customGestureFormError').textContent.trim() || document.querySelector('#customGestureTrainingStatus').textContent.trim()",
    (value) => /start the camera/i.test(value),
    "capture without camera did not expose a visible reason"
  );
  assert.match(missingCamera, /start the camera/i);
  assert.equal(await evaluate("document.querySelector('#customGestureExampleCount').textContent"), "0 of 5 examples accepted");
  assert.equal(await evaluate("document.querySelector('#instantGestures').checked"), true, "opening the custom modal reset instant gestures");
  await evaluate("document.querySelector('#cancelCustomGesture').click()");
  record("custom.capture_missing_camera_visible");

  await evaluate("document.querySelector('#startCamera').click()");
  await Promise.race([
    mediaPipeRequestSeen,
    delay(5000).then(async () => { throw new Error(`MediaPipe recognizer was not requested after camera start; exceptions=${JSON.stringify(runtimeExceptions)} snapshot=${JSON.stringify(await snapshot())} camera=${JSON.stringify(await evaluate("({ready:document.querySelector('#cameraStatus')?.textContent,status:document.querySelector('#statusCamera')?.textContent,error:document.querySelector('#errorMessage')?.textContent})"))}`); })
  ]);
  const loadingStatus = await evaluate("document.querySelector('#instantGestureStatus').textContent.trim()");
  assert.match(loadingStatus, /loading|starting/i, "camera start did not enter a loading/starting state");
  if (!USE_REAL_MEDIAPIPE) {
    deferMediaPipeFulfillment = false;
    await fulfillMediaPipeRequest(mediaPipeRequestId);
  }
  runtimeSnapshot = await waitFor(
    "globalThis.__darkquestP0Runtime.snapshot()",
    (value) => {
      const state = instant(value);
      const status = String(state.engine_status ?? state.engineStatus ?? "");
      return /ready/i.test(status) && Number(state.frames_processed ?? state.framesProcessed ?? 0) >= 5;
    },
    "instant engine did not reach Ready with processed frames",
    10000
  );
  const readyFrames = Number(instant(runtimeSnapshot).frames_processed ?? instant(runtimeSnapshot).framesProcessed);
  await delay(400);
  const increasingSnapshot = await snapshot();
  assert.ok(Number(instant(increasingSnapshot).frames_processed ?? instant(increasingSnapshot).framesProcessed) > readyFrames, "frames_processed did not increase");
  assert.equal(instant(increasingSnapshot).loop_running ?? instant(increasingSnapshot).loopRunning, true);
  assert.equal(instant(increasingSnapshot).enabled_recipe_count ?? instant(increasingSnapshot).enabledRecipeCount ?? 0, 0, "no-recipe inference regression must run before recipes exist");
  assert.equal(instant(increasingSnapshot).effective_enabled ?? instant(increasingSnapshot).effectiveEnabled, false, "no-recipe inference must not be execution-effective");
  assert.doesNotMatch(await evaluate("document.querySelector('#instantGestureStatus').textContent.trim()"), /^Off$/i);
  const statusHistory = await evaluate("globalThis.__dqP0StatusHistory");
  assert.ok(statusHistory.some((value) => /loading/i.test(value)), `missing Loading status: ${JSON.stringify(statusHistory)}`);
  assert.ok(statusHistory.some((value) => /starting inference/i.test(value)), `missing Starting inference status: ${JSON.stringify(statusHistory)}`);
  assert.ok(statusHistory.some((value) => /ready|scanning/i.test(value)), `missing Ready status: ${JSON.stringify(statusHistory)}`);
  record("instant.no_recipe_starts_inference");
  record("instant.camera_ready_loop_running");

  await evaluate(`(() => {
    const select = document.querySelector('#automationPresetSelect');
    select.value = 'preset_thumbs_up_encouragement';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#addAutomationPreset').click();
  })()`);
  await evaluate("globalThis.__dqP0RecognizerScenario.mode = 'thumbs_up'");
  await waitFor("globalThis.speechSynthesis.spoken.length", (value) => value >= 1, "thumbs-up did not execute speech", 8000);
  await waitFor(
    "document.querySelector('#automationManagerList').textContent",
    (value) => /Last run:\s*Completed/i.test(value),
    "thumbs-up receipt did not update Last run"
  );
  assert.match(await evaluate("document.querySelector('#automationReceiptList').textContent"), /Completed/i);
  assert.equal(await evaluate("globalThis.speechSynthesis.spoken[0]"), "GREAT JOB");
  await evaluate("globalThis.__dqP0RecognizerScenario.mode = 'neutral'");
  record("instant.thumbs_up_receipt_speech");

  await evaluate("document.querySelector('#createCustomGesture').click()");
  assert.equal(await evaluate("document.querySelector('#instantGestures').checked"), true, "modal open reset instant gestures");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  await evaluate("window.dispatchEvent(new Event('resize'))");
  assert.equal(await evaluate("document.querySelector('#instantGestures').checked"), true, "390px resize reset instant gestures");
  assert.doesNotMatch(await evaluate("document.querySelector('#instantGestureStatus').textContent.trim()"), /^Off$/i);
  await evaluate("document.querySelector('#cancelCustomGesture').click()");
  await evaluate(`(() => {
    const toggle = document.querySelector('#instantGestures');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#instantGestureStatus').textContent.trim()", (value) => /^Off$/i.test(value), "turning instant gestures off did not show Off");
  const offSnapshot = await snapshot();
  assert.equal(instant(offSnapshot).loop_running ?? instant(offSnapshot).loopRunning, false, "turning off did not stop inference");
  const offFrames = Number(instant(offSnapshot).frames_processed ?? instant(offSnapshot).framesProcessed ?? 0);
  await delay(400);
  const stoppedSnapshot = await snapshot();
  assert.equal(Number(instant(stoppedSnapshot).frames_processed ?? instant(stoppedSnapshot).framesProcessed ?? 0), offFrames, "frames advanced after instant engine stop");
  record("instant.modal_resize_off_stops");

  await openTwoHandWizard(evaluate);
  await evaluate("document.querySelector('#captureCustomGestureExample').click()");
  assert.match(await evaluate("document.querySelector('#customGestureTrainingStatus').textContent.trim()"), /checking hands|waiting for both hands/i);
  await pushFrame(evaluate, 0, 1, 0);
  const missingHands = await waitFor(
    "document.querySelector('#customGestureTrainingStatus').textContent.trim()",
    (value) => /waiting for both hands|both hands.*not.*visible|both hands.*detected/i.test(value),
    "one-hand frame did not produce visible two-hand feedback"
  );
  assert.match(missingHands, /waiting for both hands|both hands.*not.*visible/i);
  assert.equal(await evaluate("document.querySelector('#customGestureExampleCount').textContent"), "0 of 5 examples accepted");
  assert.equal(await evaluate("document.querySelector('#customGestureNext').disabled"), true);
  record("custom.missing_hands_atomic");

  for (let variant = 0; variant < 5; variant += 1) {
    await captureStableExample(evaluate, waitFor, variant, variant + 1);
    assert.equal(
      await evaluate("document.querySelector('#customGestureExampleCount').textContent"),
      `${variant + 1} of 5 examples accepted`
    );
    assert.equal(await evaluate("document.querySelector('#customGestureNext').disabled"), variant < 4);
  }
  runtimeSnapshot = await snapshot();
  const trainerSnapshot = trainer(runtimeSnapshot);
  assert.equal(Number(trainerSnapshot.accepted_example_count ?? trainerSnapshot.acceptedExampleCount), 5);
  assert.equal(trainerSnapshot.accepted_examples_numeric ?? trainerSnapshot.acceptedExamplesNumeric, true, "accepted example is not a finite numerical template");
  assert.ok(Number(trainerSnapshot.latest_template_dimension ?? trainerSnapshot.latestTemplateDimension ?? 0) > 0, "numerical template dimension was not reported");
  record("custom.five_numeric_templates");

  await evaluate("document.querySelector('#customGestureBack').click()");
  assert.match(await evaluate("document.querySelector('#customGestureStepStatus').textContent"), /Step 2 of 6/);
  await evaluate("document.querySelector('#customGestureNext').click()");
  assert.match(await evaluate("document.querySelector('#customGestureStepStatus').textContent"), /Step 3 of 6/);
  assert.equal(await evaluate("document.querySelector('#customGestureExampleCount').textContent"), "5 of 5 examples accepted");
  await evaluate(`(() => {
    const overlay = document.querySelector('#showTrackingOverlay');
    overlay.checked = !overlay.checked;
    overlay.dispatchEvent(new Event('change', { bubbles: true }));
    window.dispatchEvent(new Event('resize'));
  })()`);
  assert.equal(await evaluate("document.querySelector('#customGestureEditor').open"), true);
  assert.equal(await evaluate("document.querySelector('#customGestureExampleCount').textContent"), "5 of 5 examples accepted");
  assert.equal(await evaluate("document.querySelector('#customGestureNext').disabled"), false);
  record("custom.rerender_back_resize_preserved");

  const privacy = await evaluate(`(() => {
    const violations = [...globalThis.__dqP0StorageViolations];
    const inspect = (value, path, seen = new Set()) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const childPath = path ? path + '.' + key : key;
        if (/^(?:landmarks?|raw_frames?|encoded_frames?|data_uri|image_data|video_data)$/i.test(key)) violations.push({ key: childPath, reason: 'forbidden_key' });
        if (/^contains_raw_media$/i.test(key) && child !== false) violations.push({ key: childPath, reason: 'raw_media_flag' });
        if (typeof child === 'string' && /data:(?:image|video)|;base64,|blob:/i.test(child)) violations.push({ key: childPath, reason: 'raw_media_value' });
        inspect(child, childPath, seen);
      }
    };
    const stores = {};
    for (const [name, storage] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) {
      stores[name] = {};
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        const raw = storage.getItem(key);
        stores[name][key] = raw;
        try { inspect(JSON.parse(raw), name + '.' + key); } catch {
          if (/data:(?:image|video)|;base64,|blob:/i.test(String(raw))) violations.push({ key: name + '.' + key, reason: 'raw_media_value' });
        }
      }
    }
    const runtime = globalThis.__darkquestP0Runtime.snapshot();
    inspect(runtime, 'runtime');
    return { violations, stores, runtimeText: JSON.stringify(runtime), writes: globalThis.__dqP0StorageWrites };
  })()`);
  assert.deepEqual(privacy.violations, [], `raw media entered storage/runtime telemetry: ${JSON.stringify(privacy.violations)}`);
  assert.doesNotMatch(privacy.runtimeText, /landmarks|data:(?:image|video)|;base64,/i, "runtime snapshot exposed landmark/raw-media data");
  assert.equal(runtimeExceptions.length, 0, `browser runtime exceptions: ${runtimeExceptions.join(" | ")}`);
  record("privacy.no_raw_media_storage");

  console.log(JSON.stringify({ status: "PASS", checks }, null, 2));
} finally {
  try { await cdp?.send("Browser.close"); } catch {}
  cdp?.close();
  if (chrome && chrome.exitCode == null) chrome.kill("SIGTERM");
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  if (profileDir) {
    try { await rm(profileDir, { recursive: true, force: true }); } catch {}
  }
}

async function openTwoHandWizard(evaluate) {
  await evaluate(`(() => {
    document.querySelector('#createCustomGesture').click();
    const name = document.querySelector('#customGestureName');
    name.value = 'Heart shape';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#customGestureNext').click();
    const pose = document.querySelector('#customGesturePoseType');
    pose.value = 'two_hand';
    pose.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#customGestureNext').click();
  })()`);
  assert.match(await evaluate("document.querySelector('#customGestureStepStatus').textContent"), /Step 3 of 6/);
}

async function pushFrame(evaluate, variant, handCount, offsetMs) {
  return evaluate(`(async () => {
    globalThis.__dqP0FrameClock += ${Number(offsetMs)};
    return globalThis.__darkquestP0Runtime.pushLandmarkFrame(
      globalThis.__dqP0MakeFrame(${Number(variant)}, ${Number(handCount)}, globalThis.__dqP0FrameClock)
    );
  })()`);
}

async function captureStableExample(evaluate, waitFor, variant, expectedCount) {
  await evaluate("document.querySelector('#captureCustomGestureExample').click()");
  const initial = await evaluate("document.querySelector('#customGestureTrainingStatus').textContent.trim()");
  assert.match(initial, /checking hands|waiting for both hands/i, "capture click produced no immediate feedback");
  await pushFrame(evaluate, variant, 2, 1000);
  const holding = await evaluate("document.querySelector('#customGestureTrainingStatus').textContent.trim()");
  assert.match(holding, /both hands.*hold steady|capturing/i, "two-hand frame did not enter stable hold");
  await pushFrame(evaluate, variant, 2, 140);
  await pushFrame(evaluate, variant, 2, 160);
  await waitFor(
    "document.querySelector('#customGestureExampleCount').textContent",
    (value) => value === `${expectedCount} of 5 examples accepted`,
    `stable example ${expectedCount} was not accepted`
  );
  assert.match(
    await evaluate("document.querySelector('#customGestureTrainingStatus').textContent.trim()"),
    expectedCount === 5 ? /five examples captured|example accepted/i : /example accepted|move slightly/i
  );
}

async function startPrototypeServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const requested = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const file = resolve(PROTOTYPE_DIR, requested);
      const insideRoot = file === PROTOTYPE_DIR || !relative(PROTOTYPE_DIR, file).startsWith(`..${sep}`) && relative(PROTOTYPE_DIR, file) !== "..";
      if (!insideRoot || !(await stat(file)).isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES[extname(file)] || "application/octet-stream"
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function launchChrome(chromePath, userDataDir) {
  const process = spawn(chromePath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-gpu",
    "--no-default-browser-check",
    "--no-first-run",
    "--no-sandbox",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const webSocketUrl = await new Promise((resolveUrl, rejectUrl) => {
    let stderr = "";
    const timeout = setTimeout(() => rejectUrl(new Error(`Chrome DevTools endpoint timed out. ${stderr.slice(-1000)}`)), 10000);
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolveUrl(match[1]);
    });
    process.once("error", (error) => { clearTimeout(timeout); rejectUrl(error); });
    process.once("exit", (code) => {
      if (!stderr.includes("DevTools listening on")) {
        clearTimeout(timeout);
        rejectUrl(new Error(`Chrome exited before DevTools connected (${code}). ${stderr.slice(-1000)}`));
      }
    });
  });
  return { process, webSocketUrl };
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
