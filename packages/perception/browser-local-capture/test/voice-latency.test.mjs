import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  cancelVisualSpeech,
  createInitialState,
  endInteractionSession,
  setInteractionModeInState,
  speakSensefieldResponse,
  startRealtimeObserving
} from "../prototype/local-capture.js";
import { visualCompanionObserveResponseForRequest } from "../server/visual-companion-provider.mjs";

const chunkProbe = spawnSync("python3", ["-c", [
  "import json,sys",
  "sys.path.insert(0,'services/visual-companion')",
  "from voice_chunking import chunk_spoken_text",
  "text='Dr. Lee measured 3.14 meters. See https://example.com/a.b for details. Yes, I can hear you clearly. I can see you sitting on a sofa, with a dark object behind you and a drying rack in the background.'",
  "print(json.dumps(chunk_spoken_text(text)))"
].join("\n")], { encoding: "utf8" });
assert.equal(chunkProbe.status, 0, chunkProbe.stderr);
const naturalChunks = JSON.parse(chunkProbe.stdout);
assert.ok(naturalChunks.length >= 4, "long speech is split into natural chunks");
assert.ok(naturalChunks.some((chunk) => chunk.includes("3.14")), "decimals stay intact");
assert.ok(naturalChunks.some((chunk) => chunk.includes("https://example.com/a.b")), "URLs stay intact");
assert.ok(naturalChunks.some((chunk) => chunk.includes("Dr. Lee")), "abbreviations stay intact");
assert.ok(naturalChunks.every((chunk) => chunk.length <= 240), "chunks respect the hard character ceiling");

const warmupSource = readFileSync(new URL("../scripts/neural-voice-startup.mjs", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../../../../services/visual-companion/app.py", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("../../../../services/visual-companion/voice_runtime.py", import.meta.url), "utf8");
assert.equal(serviceSource.includes('@app.post("/warmup")'), true);
assert.equal(serviceSource.includes('@app.post("/speak-stream")'), true);
assert.equal(runtimeSource.includes('self.synthesize("Sensefield is ready.")'), true, "warm-up uses only the fixed phrase");
assert.equal(warmupSource.includes('endpointUrl(serviceUrl, "/warmup")'), true);
assert.equal(/new\s+Audio|audio\.play/.test(warmupSource + serviceSource), false, "warm-up audio is never played");

const shortHarness = createProgressiveHarness({ chunks: ["Yes, I can hear you clearly."] });
const shortState = createInitialState();
const shortEvidence = [];
const shortResult = await speakSensefieldResponse({ observationId: "short_response", text: "Yes, I can hear you clearly." }, {
  target: shortState,
  ...shortHarness.options,
  onVoiceEvidence: (event) => shortEvidence.push(event)
});
assert.equal(shortResult.ok, true);
assert.equal(shortHarness.requests.filter((request) => request.endsWith("/speak-stream")).length, 1);
assert.equal(shortHarness.maxActiveCount, 1, "one Audio element plays at a time");
assert.equal(shortEvidence.filter((event) => event.event === "playing").length, 1, "one logical speech start");
assert.equal(shortEvidence.filter((event) => event.event === "ended").length, 1, "one logical speech completion");
assert.equal(shortHarness.revokedUrls.length, 1, "short response object URL is released");

const longHarness = createProgressiveHarness({
  chunks: [
    "Yes, I can hear you clearly.",
    "I can see you sitting on a sofa,",
    "with a dark object behind you and a drying rack in the background."
  ],
  holdAfterFirst: true
});
const longState = createInitialState();
const longEvidence = [];
const longPromise = speakSensefieldResponse({
  observationId: "long_response",
  text: "Yes, I can hear you clearly. I can see you sitting on a sofa, with a dark object behind you and a drying rack in the background."
}, { target: longState, ...longHarness.options, onVoiceEvidence: (event) => longEvidence.push(event) });
await waitFor(() => longEvidence.some((event) => event.event === "playing"));
assert.equal(longHarness.finalChunksReleased, false, "first chunk plays before final synthesis completes");
assert.notEqual(longState.movementRecognition.voiceStatus, "Voice complete");
longHarness.releaseFinalChunks();
const longResult = await longPromise;
assert.equal(longResult.ok, true);
assert.deepEqual(longEvidence.filter((event) => event.event === "chunk_ready").map((event) => event.chunkIndex), [0, 1, 2]);
assert.deepEqual(longEvidence.filter((event) => /playing/.test(event.event)).map((event) => event.chunkIndex), [0, 1, 2]);
assert.equal(longEvidence.filter((event) => event.event === "playing").length, 1);
assert.equal(longEvidence.filter((event) => event.event === "ended").length, 1);
assert.ok(Math.max(...longEvidence.filter((event) => event.peakQueuedChunks).map((event) => event.peakQueuedChunks)) <= 2, "prefetch queue is bounded");
assert.equal(longHarness.maxActiveCount, 1, "chunks never overlap");
assert.equal(longHarness.revokedUrls.length, 3, "all chunk object URLs are released");
assert.equal(longState.movementRecognition.latestSpokenResponse.includes("drying rack"), true, "complete text remains available as one response");

const failureHarness = createProgressiveHarness({ chunks: ["First useful sentence.", "Later sentence fails."], failAt: 1 });
const failureState = createInitialState();
const failed = await speakSensefieldResponse({ observationId: "later_failure", text: "First useful sentence. Later sentence fails." }, { target: failureState, ...failureHarness.options });
assert.equal(failed.ok, false);
assert.equal(failureState.movementRecognition.voiceStatus, "Voice unavailable");
const recovered = await speakSensefieldResponse({ observationId: "recovered", text: "The next response works." }, { target: failureState, ...createProgressiveHarness({ chunks: ["The next response works."] }).options });
assert.equal(recovered.ok, true, "later-chunk failure releases all locks for the next turn");

const staleHarness = createProgressiveHarness({ chunks: ["Old first.", "Old second."], holdAfterFirst: true });
const staleState = createInitialState();
const staleEvidence = [];
const stalePromise = speakSensefieldResponse({ observationId: "stale", text: "Old first. Old second." }, { target: staleState, ...staleHarness.options, onVoiceEvidence: (event) => staleEvidence.push(event) });
await waitFor(() => staleEvidence.some((event) => event.event === "playing"));
const freshResult = await speakSensefieldResponse({ observationId: "fresh", text: "Fresh response." }, { target: staleState, ...createProgressiveHarness({ chunks: ["Fresh response."] }).options });
staleHarness.releaseFinalChunks();
assert.equal((await stalePromise).ok, false);
assert.equal(freshResult.ok, true);
assert.equal(staleEvidence.some((event) => event.event === "ended"), false, "stale chunks cannot complete after new speech starts");

await assertSessionCancellation("mode_switch");
await assertSessionCancellation("session_end");

const explicitQuestion = "What can you see around me?";
const frame = { mime_type: "image/jpeg", encoded_frame: "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==", captured_at_ms: 10, width: 1, height: 1 };
const conversationResult = await visualCompanionObserveResponseForRequest({
  frames: [frame, { ...frame, captured_at_ms: 20 }],
  user_question: explicitQuestion,
  interaction_mode: "conversation",
  requested_response_mode: "conversation"
}, {}, { fetch: async () => ({ ok: false, status: 503, async json() { return {}; } }) });
assert.equal(conversationResult.json.spoken_response.includes("what changed"), false);
assert.equal(conversationResult.json.spoken_response.includes("Try showing me again"), false);
assert.match(conversationResult.json.spoken_response, /current view|camera|visible area/i, "exact question receives Conversation behavior");

const adapterSource = readFileSync(new URL("../prototype/automation/local-action-adapters.js", import.meta.url), "utf8");
const spatialSource = readFileSync(new URL("../prototype/spatial/spatial-experience.js", import.meta.url), "utf8");
assert.equal(/speechSynthesis|SpeechSynthesisUtterance/.test(adapterSource), false, "no browser speech fallback");
assert.equal(adapterSource.includes("context.speakPhrase"), true, "Saved Actions remain on canonical voice");
assert.equal(/new\s+Audio|speak-stream|visual-companion\/speak/.test(spatialSource), false, "Spatial cannot create a voice owner");

console.log("realtime neural voice latency tests passed");

async function assertSessionCancellation(kind) {
  const target = createInitialState();
  await setInteractionModeInState(target, "observing");
  await startRealtimeObserving(target, { mediaStream: fakeStream() });
  const harness = createProgressiveHarness({ chunks: ["Current chunk.", "Future chunk."], holdAfterFirst: true });
  const evidence = [];
  const speech = speakSensefieldResponse({ observationId: kind, text: "Current chunk. Future chunk." }, { target, ...harness.options, onVoiceEvidence: (event) => evidence.push(event) });
  await waitFor(() => evidence.some((event) => event.event === "playing"));
  if (kind === "mode_switch") await setInteractionModeInState(target, "conversation", { mediaStream: fakeStream() });
  else await endInteractionSession(target, harness.options);
  harness.releaseFinalChunks();
  const result = await speech;
  assert.equal(result.ok, false, kind + " cancels current and queued chunks");
  assert.equal(evidence.some((event) => event.event === "ended"), false);
}

function createProgressiveHarness({ chunks, holdAfterFirst = false, failAt = -1 }) {
  const requests = [];
  const revokedUrls = [];
  const instances = [];
  let nextUrl = 0;
  let activeCount = 0;
  let maxActiveCount = 0;
  let releaseFinal;
  let finalChunksReleased = !holdAfterFirst;
  const finalGate = new Promise((resolve) => { releaseFinal = () => { finalChunksReleased = true; resolve(); }; });
  class TestAudio {
    constructor(src) { this.src = src; this.duration = 0.5; this.playing = false; instances.push(this); }
    play() {
      queueMicrotask(() => {
        if (!this.src) return;
        this.onloadedmetadata?.();
        this.playing = true;
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        this.onplaying?.();
        queueMicrotask(() => this.end());
      });
      return Promise.resolve();
    }
    end() { if (!this.playing) return; this.playing = false; activeCount -= 1; this.onended?.(); }
    pause() { if (this.playing) activeCount -= 1; this.playing = false; }
    removeAttribute(name) { if (name === "src") this.src = ""; }
    load() {}
  }
  const fetch = async (input, init = {}) => {
    const pathname = new URL(String(input), "http://sensefield.test").pathname;
    requests.push(pathname);
    if (pathname.endsWith("/cancel")) return jsonResponse({ ok: true, cancelled: true });
    if (!pathname.endsWith("/speak-stream")) throw new Error("Unexpected voice request: " + pathname);
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        init.signal?.addEventListener?.("abort", () => { try { controller.close(); } catch {} }, { once: true });
        for (let index = 0; index < chunks.length; index += 1) {
          if (index === 1 && holdAfterFirst) await finalGate;
          if (init.signal?.aborted) return;
          if (index === failAt) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "error", index, code: "test_later_failure" }) + "\n"));
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(JSON.stringify(audioEvent(index, chunks.length)) + "\n"));
          await new Promise((resolve) => queueMicrotask(resolve));
        }
        controller.close();
      }
    });
    return { ok: true, status: 200, body, headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "application/x-ndjson" : "" } };
  };
  const URLApi = { createObjectURL: () => "blob:voice-" + (++nextUrl), revokeObjectURL: (url) => revokedUrls.push(url) };
  return {
    requests,
    revokedUrls,
    instances,
    releaseFinalChunks: releaseFinal,
    get finalChunksReleased() { return finalChunksReleased; },
    get maxActiveCount() { return maxActiveCount; },
    options: { fetch, AudioCtor: TestAudio, URLApi, maxQueuedVoiceChunks: 2 }
  };
}

function audioEvent(index, total) {
  return { type: "audio", index, total_chunks: total, mime_type: "audio/wav", audio_base64: Buffer.from(testWav()).toString("base64"), audio_bytes: 48, audio_duration_ms: 500, generation_ms: 40, contains_raw_media: false };
}

function testWav() {
  const buffer = Buffer.alloc(48);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(40, 4); buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(4, 40);
  return buffer;
}

function jsonResponse(body) { return { ok: true, status: 200, headers: { get: () => "application/json" }, async json() { return body; } }; }
function fakeStream() { const track = { kind: "video", readyState: "live", stop() { this.readyState = "ended"; } }; return { getTracks: () => [track], getAudioTracks: () => [], getVideoTracks: () => [track] }; }
async function waitFor(predicate, timeoutMs = 1500) { const deadline = Date.now() + timeoutMs; while (!predicate()) { if (Date.now() >= deadline) throw new Error("Timed out waiting for voice lifecycle state."); await new Promise((resolve) => setTimeout(resolve, 5)); } }
