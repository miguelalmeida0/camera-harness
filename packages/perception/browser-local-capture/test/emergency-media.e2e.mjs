import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

await import(new URL("../../../../fixtures/sensefield-av/generate-fixtures.mjs", import.meta.url));

const root = resolve("packages/perception/browser-local-capture/prototype");
const video = resolve("fixtures/sensefield-av/video/neutral_peace_neutral_thumbs.y4m");
const audio = resolve("fixtures/sensefield-av/audio/what_am_i_holding.wav");
const speechAudio = await readFile(audio);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  const file = resolve(root, pathname === "/" ? "index.html" : pathname.replace(/^\//, ""));
  const rel = relative(root, file);
  if (rel === ".." || rel.startsWith(`..${sep}`)) return response.writeHead(404).end();
  try {
    await stat(file);
    response.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "text/javascript", ".json": "application/json" })[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolveListen, rejectListen) => server.listen(0, "127.0.0.1", resolveListen).once("error", rejectListen));

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`, `--use-file-for-fake-audio-capture=${audio}`, "--autoplay-policy=no-user-gesture-required"]
});

try {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  let conversationCalls = 0;
  let observationCalls = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/health")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "ready", observe_endpoint_ready: true, provider: "local_visual_companion", model: "emergency-state-provider" }) });
    if (url.pathname.endsWith("/cancel")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    if (url.pathname.endsWith("/speak")) return route.fulfill({
      status: 200,
      contentType: "audio/wav",
      headers: { "x-sensefield-audio-duration-ms": "1800", "x-sensefield-voice-engine": "kokoro_82m" },
      body: speechAudio
    });
    if (url.pathname.endsWith("/conversation")) {
      conversationCalls += 1;
      const request = route.request().postDataJSON();
      const text = request.user_question === "Can you hear me?"
        ? "Yes, I can hear you."
        : request.user_question === "What can you see?"
          ? "I can see the current camera view."
          : "Yes, this is a fresh conversation.";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response(text, `conversation_${conversationCalls}`, false)) });
    }
    if (url.pathname.endsWith("/observe")) {
      observationCalls += 1;
      const peace = observationCalls === 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response(peace ? "You raised your hand and made a peace sign." : "You raised your hand and gave a thumbs up.", peace ? "peace_sign" : "thumbs_up", true)) });
    }
    if (url.pathname.endsWith("/usage")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: {}, day: {}, month: {}, concurrent: {} }) });
    return route.fulfill({ status: 404, body: "not found" });
  });
  await page.addInitScript(() => {
    let recognition;
    class EmergencyRecognition {
      start() { recognition = this; this.onstart?.(); }
      abort() { this.onend?.(); }
      stop() {}
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: EmergencyRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: EmergencyRecognition });
    window.__emitFinalTranscript = (text) => recognition?.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?sensefield-test=1`);
  await page.getByRole("button", { name: "Start conversation", exact: true }).click();
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().runtime?.listening === true);
  await page.evaluate(() => window.__emitFinalTranscript("Can you hear me?"));
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getSpeechTimeline?.().filter((item) => item.event_type === "speech_completed").length === 1);
  assert.equal(await page.locator(".movement-sentence").innerText(), "Yes, I can hear you.");
  await page.evaluate(() => window.__emitFinalTranscript("What can you see?"));
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getSpeechTimeline?.().filter((item) => item.event_type === "speech_completed").length === 2);
  assert.equal(await page.locator(".movement-sentence").innerText(), "I can see the current camera view.");
  assert.equal(conversationCalls, 2);
  const conversationSpeech = await page.evaluate(() => window.__SENSEFIELD_TEST__.getSpeechTimeline());
  assert.equal(conversationSpeech.filter((item) => item.event_type === "speech_started").length, 2);
  assert.equal(conversationSpeech.filter((item) => item.event_type === "speech_completed").length, 2);

  await page.getByRole("button", { name: "End conversation", exact: true }).click();
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().session?.status === "inactive");
  assert.equal(await page.locator(".movement-sentence").innerText(), "Ask me anything about what I can see.");
  assert.equal((await page.locator("#recentMomentsList").innerText()).includes("Yes, I can hear you."), true);

  await page.getByRole("button", { name: "Observing", exact: true }).click();
  await page.getByRole("button", { name: "Start observing", exact: true }).click();
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().selectedMode === "observing" && window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().session?.status === "active");
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRequestTimeline?.().filter((item) => item.event_type === "request_completed" && item.metadata?.endpoint === "/api/visual-companion/observe").length >= 2, 25000);
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getSpeechTimeline?.().filter((item) => item.event_type === "speech_completed").length >= 4, 25000);
  const observingRuntime = await page.evaluate(() => ({ runtime: window.__SENSEFIELD_TEST__.getRuntimeControllerState(), requests: window.__SENSEFIELD_TEST__.getRequestTimeline(), speech: window.__SENSEFIELD_TEST__.getSpeechTimeline() }));
  assert.equal(observationCalls >= 2, true);
  assert.equal(observingRuntime.runtime.selectedMode, "observing");
  assert.equal(observingRuntime.runtime.media.microphoneActive, false);
  assert.equal(observingRuntime.runtime.runtime.proactiveObservationActive, true);
  assert.equal(observingRuntime.requests.filter((item) => item.event_type === "request_completed" && item.metadata?.endpoint === "/api/visual-companion/observe").length >= 2, true);
  assert.equal(observingRuntime.speech.filter((item) => item.event_type === "speech_completed").length >= 4, true);
  const fourthCompletion = observingRuntime.speech.filter((item) => item.event_type === "speech_completed")[3];
  assert.equal(fourthCompletion.metadata.path, "local_tts");
  assert.match(fourthCompletion.metadata.response_id, /thumbs_up|observation/i);
  assert.match(fourthCompletion.metadata.speech_id, /^speech_/);
  assert.equal(Number.isInteger(fourthCompletion.metadata.session_generation), true);
  assert.equal(Number.isInteger(fourthCompletion.metadata.mode_generation), true);

  await page.getByRole("button", { name: "End observing", exact: true }).click();
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().session?.status === "inactive");
  assert.equal(await page.locator(".movement-sentence").innerText(), "Show me a movement or object change.");

  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await page.getByRole("button", { name: "Start conversation", exact: true }).click();
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().runtime?.listening === true);
  assert.equal(await page.locator(".movement-sentence").innerText(), "Ask your question.");
  await page.evaluate(() => window.__emitFinalTranscript("Are we in a fresh session?"));
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getSpeechTimeline?.().filter((item) => item.event_type === "speech_completed").length === 5);
  assert.equal(await page.locator(".movement-sentence").innerText(), "Yes, this is a fresh conversation.");
  assert.equal(conversationCalls, 3);
  await page.getByRole("button", { name: "End conversation", exact: true }).click();
  await waitFor(page, () => window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.().session?.status === "inactive");
  console.log("emergency media Playwright proof passed");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

function response(text, label, meaningful) {
  return { response_type: "narrate", observation_summary: text, spoken_response: text, confidence: 0.9, uncertainty: false, meaningful_change: meaningful, movement_label: label, evidence: ["ordered frames"], evidence_frames: meaningful ? [1, 3, 5] : [1], provider: "deterministic_test_fixture", model: "emergency-state-provider", response_source: "deterministic_test_fixture", latency_ms: 120 };
}

async function waitFor(page, predicate, timeout = 12000) {
  try {
    await page.waitForFunction(predicate, null, { timeout });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      runtime: window.__SENSEFIELD_TEST__?.getRuntimeControllerState?.(),
      events: window.__SENSEFIELD_TEST__?.getEventTimeline?.().slice(-12).map((item) => ({ event_type: item.event_type, metadata: item.metadata })),
      requests: window.__SENSEFIELD_TEST__?.getRequestTimeline?.().slice(-8).map((item) => ({ event_type: item.event_type, metadata: item.metadata })),
      speech: window.__SENSEFIELD_TEST__?.getSpeechTimeline?.().slice(-8).map((item) => ({ event_type: item.event_type, metadata: item.metadata })),
      response: document.querySelector(".movement-sentence")?.textContent?.trim(),
      error: document.querySelector("#errorMessage")?.textContent?.trim()
    }));
    throw new Error(`Emergency media wait failed: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
}
