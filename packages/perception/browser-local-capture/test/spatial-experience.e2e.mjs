import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";
import { SPATIAL_TEST_SCENARIOS } from "./spatial-test-adapter.mjs";

await import(new URL("../../../../fixtures/sensefield-av/generate-fixtures.mjs", import.meta.url));

const root = resolve("packages/perception/browser-local-capture/prototype");
const video = resolve("fixtures/sensefield-av/video/neutral_peace_neutral_thumbs.y4m");
const audio = resolve("fixtures/sensefield-av/audio/what_am_i_holding.wav");
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  const file = resolve(root, pathname === "/" ? "index.html" : pathname.replace(/^\//, ""));
  const rel = relative(root, file);
  if (rel === ".." || rel.startsWith(`..${sep}`)) return response.writeHead(404).end();
  try {
    await stat(file);
    response.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "text/javascript", ".json": "application/json" })[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolveListen, rejectListen) => server.listen(0, "127.0.0.1", resolveListen).once("error", rejectListen));

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`, `--use-file-for-fake-audio-capture=${audio}`, "--autoplay-policy=no-user-gesture-required"]
});

try {
  const context = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1024, height: 768 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const spatialRequests = [];
  const conversationRequests = [];
  const observationRequests = [];
  let observingSpatialCall = 0;

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/spatial-awareness/analyze") {
      const request = route.request().postDataJSON();
      spatialRequests.push(request);
      if (/service unavailable/i.test(request.query)) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
      const scenario = request.mode === "observing"
        ? ["mug_in_front_of_laptop", "hand_toward_camera", "object_leaves_frame_right"][observingSpatialCall++ % 3]
        : spatialScenarioForQuery(request.query);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SPATIAL_TEST_SCENARIOS[scenario]) });
    }
    if (url.pathname.endsWith("/health")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "ready", observe_endpoint_ready: true, provider: "local_visual_companion", model: "spatial-experience-state-provider" }) });
    if (url.pathname.endsWith("/cancel")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    if (url.pathname.endsWith("/speak")) return route.fulfill({
      status: 200,
      contentType: "audio/wav",
      headers: { "x-sensefield-audio-duration-ms": "240", "x-sensefield-voice-engine": "sensefield_neural_voice" },
      body: Buffer.from([82, 73, 70, 70, 1, 0, 0, 0, 87, 65, 86, 69])
    });
    if (url.pathname.endsWith("/conversation")) {
      const request = route.request().postDataJSON();
      conversationRequests.push(request);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(providerResponse(conversationAnswer(request.user_question), `conversation_${conversationRequests.length}`, false)) });
    }
    if (url.pathname.endsWith("/observe")) {
      observationRequests.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(providerResponse("A visible movement occurred.", `observation_${observationRequests.length}`, true)) });
    }
    if (url.pathname.endsWith("/usage")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: {}, day: {}, month: {}, concurrent: {} }) });
    return route.fulfill({ status: 404, body: "not found" });
  });

  await page.addInitScript(() => {
    let recognition;
    class SpatialRecognition {
      start() { recognition = this; this.onstart?.(); }
      abort() { this.onend?.(); }
      stop() {}
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: SpatialRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: SpatialRecognition });
    window.__emitFinalTranscript = (text) => recognition?.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
    class NeuralVoiceAudio {
      constructor(src) { this.src = src; this.muted = false; this.volume = 1; }
      play() {
        queueMicrotask(() => {
          this.onplaying?.();
          queueMicrotask(() => this.onended?.());
        });
        return Promise.resolve();
      }
      pause() {}
      removeAttribute() {}
      load() {}
    }
    Object.defineProperty(window, "Audio", { configurable: true, value: NeuralVoiceAudio });
  });

  await page.goto(`http://127.0.0.1:${server.address().port}/?sensefield-test=1`);
  await page.getByRole("button", { name: "Start conversation", exact: true }).click();
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().runtime?.listening === true);

  await ask(page, "What is to the left of the laptop?", "The mug is to the left of the laptop.", 1);
  assert.equal(spatialRequests.length, 1);
  assert.equal(conversationRequests[0].previous_context.spatial_facts.available, true);
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getSpatialExperienceSummary?.().overlay_visible === true);
  assert.equal(await page.locator("#spatialEvidenceLabel").innerText(), "mug");
  assert.equal(/mug_1|laptop_1/.test(await page.locator("#spatialEvidenceOverlay").innerText()), false, "overlay exposes safe labels only");
  const qaDir = "/tmp/sensefield-spatial-experience-qa";
  await mkdir(qaDir, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      selectorVisible: document.querySelector("#interactionModeSelector")?.getBoundingClientRect().width > 0,
      savedActionsVisible: document.querySelector("#savedActionsCard")?.getBoundingClientRect().width > 0,
      recentMomentsVisible: document.querySelector("#recentMomentsCard")?.getBoundingClientRect().width > 0,
      overlayVisible: !document.querySelector("#spatialEvidenceOverlay")?.hidden,
      labelContained: (document.querySelector("#spatialEvidenceLabel")?.scrollWidth || 0) <= (document.querySelector("#spatialEvidenceLabel")?.clientWidth || 0)
    }));
    assert.deepEqual(layout, { horizontalOverflow: false, selectorVisible: true, savedActionsVisible: true, recentMomentsVisible: true, overlayVisible: true, labelContained: true });
    await page.screenshot({ path: `${qaDir}/spatial-overlay-${viewport.width}x${viewport.height}.png`, fullPage: viewport.width === 390 });
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "Dismiss evidence", exact: true }).click();
  assert.equal(await page.locator("#spatialEvidenceOverlay").isHidden(), true, "overlay can be dismissed");

  await ask(page, "Can you hear me?", "Yes, I can hear you.", 2);
  assert.equal(spatialRequests.length, 1, "ordinary Conversation bypasses spatial service");

  await ask(page, "Which object is closest to me?", "The mug appears closest.", 3);
  await ask(page, "Did I move it closer?", "Yes. The mug moved closer to the camera.", 4);
  assert.match(spatialRequests.at(-1).query, /Referenced object.*mug/i, "follow-up carries bounded object reference");
  await ask(page, "How many centimetres apart are they?", "They are moderately separated in the image, but I do not have metric calibration for centimetres.", 5);
  assert.equal(conversationRequests.at(-1).previous_context.spatial_facts.scale, "relative");
  await ask(page, "What is behind the partly hidden object?", "I can see a dark handle and part of a metallic body. Rotate the object slightly so its front is visible.", 6);
  assert.equal(await page.locator("#movementSummaryRow").innerText(), "Additional view needed");

  await ask(page, "What is to the left of the laptop when the spatial service unavailable?", "I can still use the current view, but precise spatial analysis is unavailable.", 7);
  assert.equal(await page.getByRole("button", { name: "End conversation", exact: true }).isEnabled(), true, "spatial failure preserves Conversation");
  await waitFor(page, () => document.querySelector("#movementSummaryRow")?.textContent?.trim() === "Spatial precision unavailable");
  assert.equal(await page.locator("#movementSummaryRow").innerText(), "Spatial precision unavailable");
  const speechAfterConversation = await page.evaluate(() => window.__SENSEFIELD_TEST__.getSpeechTimeline());
  assert.equal(speechAfterConversation.filter((item) => item.event_type === "speech_started").length, 7);
  assert.equal(speechAfterConversation.filter((item) => item.event_type === "speech_completed").length, 7);
  assert.equal(speechAfterConversation.every((item) => item.metadata?.path === "local_tts"), true, "single neural voice remains the exclusive speech path");
  assert.match(await page.locator("#recentMomentsList").innerText(), /SPATIAL/, "spatial Conversation answer becomes a text-only Recent Moment");

  await page.getByRole("button", { name: "End conversation", exact: true }).click();
  await page.getByRole("button", { name: "Observing", exact: true }).click();
  await page.getByRole("button", { name: "Start observing", exact: true }).click();
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().selectedMode === "observing" && window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().session?.status === "active");
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRequestTimeline?.().filter((item) => item.event_type === "request_completed" && item.metadata?.endpoint === "/api/visual-companion/observe").length >= 2, 30000);
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().persistentMemory?.observationMoments?.length >= 2, 30000);
  assert.equal(observingSpatialCall >= 2, true, "two meaningful visual events invoke spatial analysis without restart");
  assert.equal(observationRequests.length >= 2, true);
  const observingState = await page.evaluate(() => ({
    runtime: window.__SENSEFIELD_TEST__.getRuntimeControllerState(),
    speech: window.__SENSEFIELD_TEST__.getSpeechTimeline(),
    recent: document.querySelector("#recentMomentsList")?.textContent || "",
    spatial: window.__SENSEFIELD_TEST__.getSpatialExperienceSummary()
  }));
  assert.equal(observingState.runtime.media.microphoneActive, false, "Observing never activates STT microphone ownership");
  assert.equal(observingState.runtime.runtime.proactiveObservationActive, true);
  assert.match(observingState.recent, /MOVEMENT/);
  assert.equal(observingState.runtime.persistentMemory.observationMoments.length >= 2, true);
  assert.match(observingState.runtime.persistentMemory.observationMoments.map((item) => item.text).join(" "), /mug.*front|right hand.*camera/i);
  assert.equal(observingState.speech.filter((item) => item.event_type === "speech_started").length, observingState.speech.filter((item) => item.event_type === "speech_completed").length, "one speech owner completes every started narration");

  await page.getByRole("button", { name: "End observing", exact: true }).click();
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().session?.status === "inactive");
  assert.equal(await page.locator("#spatialEvidenceOverlay").isHidden(), true, "session end clears overlay");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "spatial UI creates no mobile horizontal overflow");
  assert.equal(await page.locator("#interactionModeSelector").isVisible(), true);
  assert.equal(await page.locator("#savedActionsCard").isVisible(), true);
  assert.equal(await page.locator("#recentMomentsCard").isVisible(), true);

  console.log("spatial experience browser scenarios passed");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

function spatialScenarioForQuery(query = "") {
  const text = String(query).toLowerCase();
  if (/partly hidden/.test(text)) return "partial_unknown_object";
  if (/centimet/.test(text)) return "uncalibrated_relative_distance";
  if (/closest/.test(text)) return "uncalibrated_relative_distance";
  if (/move it closer/.test(text)) return "mug_in_front_of_laptop";
  return "mug_left_of_laptop";
}

function conversationAnswer(question = "") {
  if (question === "Can you hear me?") return "Yes, I can hear you.";
  if (/closest/i.test(question)) return "The mug appears closest.";
  if (/move it closer/i.test(question)) return "Yes. The mug moved closer to the camera.";
  if (/centimetres/i.test(question)) return "They are moderately separated in the image, but I do not have metric calibration for centimetres.";
  if (/partly hidden/i.test(question)) return "The spatial facts include a partial observation.";
  if (/service unavailable/i.test(question)) return "I can still use the current view, but precise spatial analysis is unavailable.";
  return "The mug is to the left of the laptop.";
}

function providerResponse(text, label, meaningful) {
  return { response_type: "narrate", observation_summary: text, spoken_response: text, movement: text, confidence: 0.9, uncertainty: false, meaningful_change: meaningful, movement_label: label, evidence: ["ordered frames"], evidence_frames: meaningful ? [1, 3, 5] : [1], provider: "deterministic_test_fixture", model: "spatial-experience-state-provider", response_source: "deterministic_test_fixture", latency_ms: 120 };
}

async function ask(page, question, expected, speechCount) {
  await page.evaluate((text) => window.__emitFinalTranscript(text), question);
  await waitFor(page, (count) => window.__SENSEFIELD_TEST__?.getSpeechTimeline?.().filter((item) => item.event_type === "speech_completed").length === count, 15000, speechCount);
  assert.equal(await page.locator(".movement-sentence").innerText(), expected);
  assert.equal((await page.getByRole("button", { name: "End conversation", exact: true }).count()), 1);
}

async function waitFor(page, predicate, timeout = 12000, arg = null) {
  try {
    await page.waitForFunction(predicate, arg, { timeout });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      runtime: window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.(),
      spatial: window.__SENSEFIELD_TEST__?.getSpatialExperienceSummary?.(),
      events: window.__SENSEFIELD_TEST__?.getEventTimeline?.().slice(-12).map((item) => ({ event_type: item.event_type, metadata: item.metadata })),
      requests: window.__SENSEFIELD_TEST__?.getRequestTimeline?.().slice(-8).map((item) => ({ event_type: item.event_type, metadata: item.metadata })),
      speech: window.__SENSEFIELD_TEST__?.getSpeechTimeline?.().slice(-8).map((item) => ({ event_type: item.event_type, metadata: item.metadata })),
      response: document.querySelector(".movement-sentence")?.textContent?.trim()
    }));
    throw new Error(`Spatial browser wait failed: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
}
