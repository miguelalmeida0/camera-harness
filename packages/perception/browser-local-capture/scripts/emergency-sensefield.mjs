#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { createMovementRecognitionServer } from "../server/movement-recognition-server.mjs";
import { movementRecognitionHealth, movementRecognitionResponseForRequest } from "../server/movement-recognition-provider.mjs";
import { visualCompanionHealth, visualCompanionObserveResponseForRequest, visualCompanionSpeakResponseForRequest } from "../server/visual-companion-provider.mjs";
import { createEmergencyRuntimeController } from "../prototype/emergency-runtime-controller.js";

const mode = process.argv[2] || "doctor";
mkdirSync(resolve(".darkquest"), { recursive: true });
const emergencyUsageRoot = mkdtempSync(resolve(".darkquest/emergency-hf-usage-"));
const env = { ...loadProjectEnv(), HF_USAGE_STATE_PATH: resolve(emergencyUsageRoot, "usage.json") };
process.on("exit", () => rmSync(emergencyUsageRoot, { recursive: true, force: true }));

try {
  if (mode === "doctor") await doctor();
  else if (mode === "providers") await providers();
  else if (mode === "voice") await voice();
  else if (mode === "conversation") await conversation();
  else if (mode === "observing") await observing();
  else throw new Error(`Unknown emergency check: ${mode}`);
} catch (error) {
  process.stderr.write(`EMERGENCY_${mode.toUpperCase()}_FAIL ${safe(error?.message)}\n`);
  process.exitCode = 1;
}

async function doctor() {
  const server = createMovementRecognitionServer({ env });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const routeChecks = await Promise.all([
      getJson(`${origin}/api/movement-recognition/health`),
      getJson(`${origin}/api/movement-recognition/usage`),
      postJson(`${origin}/api/visual-companion/conversation`, { frames: [] })
    ]);
    const local = await visualCompanionHealth(env);
    const cloud = movementRecognitionHealth(env);
    const localReady = local.ok === true && local.status === "ready" && local.observe_endpoint_ready === true;
    const cloudReady = cloud.ok === true && cloud.has_token === true && cloud.cloud_enabled === true && cloud.live_call_enabled === true;
    const resultSource = localReady ? "local_vlm" : cloudReady ? "cloud_vlm" : "unavailable";
    const report = {
      server: {
        main_server_starts: true,
        movement_recognition_endpoint: routeChecks[0].status === 200,
        conversation_endpoint: routeChecks[2].status !== 404,
        usage_endpoint: routeChecks[1].status === 200
      },
      visual_inference: {
        local_service_health: local.status || "unavailable",
        local_model: local.model || env.VISUAL_COMPANION_MODEL || "not configured",
        hugging_face_fallback_available: cloudReady,
        hf_token_loaded: Boolean(cloud.has_token),
        cloud_inference_enabled: cloud.cloud_enabled === true,
        cloud_model: cloud.model || "not configured",
        result_source: resultSource
      },
      stt: { configured_path: "browser SpeechRecognition", transcript_finalization_capability: true, runtime_browser_capability_required: true },
      tts: {
        local_service_health: local.voice_ready === true ? "ready" : local.voice_status || "unavailable",
        browser_speech_fallback: true,
        usable_fallback_count: local.voice_ready === true ? 2 : 1
      },
      configuration: {
        endpoints: ["/api/movement-recognition/analyze", "/api/movement-recognition/usage", "/api/visual-companion/conversation", "/api/visual-companion/observe", "/api/visual-companion/speak"],
        request_limits: cloud.limits || {},
        secrets_displayed: false
      }
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (resultSource === "unavailable") throw new Error("No real visual inference path is available.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function providers() {
  const local = await visualCompanionHealth(env);
  const cloud = movementRecognitionHealth(env);
  const useLocal = local.ok === true && local.status === "ready" && local.observe_endpoint_ready === true;
  if (!useLocal && !(cloud.ok && cloud.has_token && cloud.cloud_enabled && cloud.live_call_enabled)) throw new Error("No real provider is available.");
  const image = readFileSync("packages/perception/browser-local-capture/test/fixtures/vlm-control-image.jpg").toString("base64");
  const conversationFrames = [frame("image/jpeg", image, 1)];
  const observationFrames = movementPngFrames();
  const conversationResult = await callRealProvider({
    mode: "conversation",
    frames: conversationFrames,
    question: "What can you see?",
    useLocal
  });
  const observingResult = await callRealProvider({ mode: "observing", frames: observationFrames, useLocal });
  validateProviderResult(conversationResult, "conversation");
  validateProviderResult(observingResult, "observing");
  process.stdout.write(`${JSON.stringify({ deterministic_fixture_mode: false, conversation: publicResult(conversationResult), observing: publicResult(observingResult) }, null, 2)}\n`);
}

async function callRealProvider({ mode, frames, question = "", useLocal }) {
  const started = Date.now();
  let response;
  if (useLocal) {
    response = await visualCompanionObserveResponseForRequest({
      frames,
      frame_timestamps_ms: frames.map((item) => item.captured_at_ms),
      interaction_mode: mode,
      requested_response_mode: mode === "conversation" ? "conversation" : "movement_observation",
      user_question: question,
      client_scene_change_score: mode === "observing" ? 0.5 : 0,
      contains_raw_media: false
    }, env);
  } else {
    response = await movementRecognitionResponseForRequest({
      frames,
      interaction_mode: mode,
      requested_response_mode: mode === "conversation" ? "conversation" : "movement_observation",
      user_question: question,
      current_step: mode === "conversation" ? "visual_conversation" : "movement_narration",
      previous_context: {},
      allowed_actions: ["uncertain"],
      window_ms: Math.max(0, frames.at(-1).captured_at_ms - frames[0].captured_at_ms)
    }, env, { sessionId: `darkquest_session_emergency_${mode}_${Date.now()}`, bodyBytes: 0 });
  }
  const body = response.json || {};
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    provider: body.provider || (useLocal ? "local_visual_companion" : "huggingface"),
    model: body.returned_model || body.provider_model || body.model || "",
    spoken_response: body.spoken_response || body.movement || "",
    meaningful_change: body.meaningful_change,
    movement_label: body.movement_label || body.movement_key || "",
    evidence_frames: body.evidence_frames || [],
    response_source: useLocal ? "local_vlm" : "cloud_vlm",
    duration_ms: Date.now() - started,
    frame_count: frames.length
  };
}

function validateProviderResult(result, checkMode) {
  if (!result.ok) throw new Error(`${checkMode} provider returned HTTP ${result.status}.`);
  if (!result.provider || !result.model) throw new Error(`${checkMode} provider/model metadata is missing.`);
  if (!result.spoken_response.trim()) throw new Error(`${checkMode} provider returned empty assistant text.`);
  if (/^(No meaningful change detected|Uncertain — try again)\.?$/i.test(result.spoken_response.trim())) throw new Error(`${checkMode} provider returned a canned response.`);
  if (result.duration_ms < 10) throw new Error(`${checkMode} provider duration is not credible.`);
  if (checkMode === "observing" && result.frame_count < 3) throw new Error("Observing provider did not receive ordered frames.");
}

async function voice() {
  const local = await visualCompanionSpeakResponseForRequest({ text: "Sensefield emergency voice test.", observation_id: "emergency_voice", contains_raw_media: false }, env);
  const localAudio = Boolean(local.body?.length > 0 && Number(local.headers?.["x-sensefield-audio-duration-ms"] || 0) > 0);
  const browser = await browserSpeechProof();
  const report = { local_tts: { available: localAudio, bytes: local.body?.length || 0, duration_ms: Number(local.headers?.["x-sensefield-audio-duration-ms"] || 0) }, browser_speech: browser, audio_persisted: false };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!browser.started || !browser.completed) throw new Error("Browser playback lifecycle did not complete.");
}

async function browserSpeechProof() {
  const { chromium } = await import("@playwright/test");
  const executablePath = chromeExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async () => {
      const synth = speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance !== "function") return { started: false, completed: false, error: "unavailable" };
      if (!synth.getVoices().length) await new Promise((resolve) => { const timer = setTimeout(resolve, 1000); synth.addEventListener("voiceschanged", () => { clearTimeout(timer); resolve(); }, { once: true }); });
      synth.cancel();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return await new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance("Sensefield emergency voice test.");
        utterance.volume = 1;
        let started = false;
        const timer = setTimeout(() => resolve({ started, completed: false, error: "timeout", voices: synth.getVoices().length }), 8000);
        utterance.onstart = () => { started = true; };
        utterance.onend = () => { clearTimeout(timer); resolve({ started: true, completed: true, error: "", voices: synth.getVoices().length }); };
        utterance.onerror = (event) => { clearTimeout(timer); resolve({ started, completed: false, error: event.error || "speech_error", voices: synth.getVoices().length }); };
        synth.speak(utterance);
      });
    });
  } finally {
    await browser.close();
  }
}

async function conversation() {
  const controller = createEmergencyRuntimeController();
  controller.activate("conversation", { cameraActive: true, microphoneActive: true });
  const results = [];
  for (const text of ["Can you hear me?", "What can you see?"]) {
    const accepted = controller.queueFinalTranscript(text, Date.now());
    if (!accepted.ok) throw new Error(`Transcript rejected: ${accepted.code}`);
    const task = controller.takeNextTask();
    if (!task) throw new Error("Conversation inference did not start.");
    controller.finishInference(task);
    const speech = controller.beginSpeech();
    controller.markSpeechStarted(speech);
    if (!controller.finishSpeech(speech, { completed: true })) throw new Error("Conversation speech did not complete.");
    results.push({ transcript: text, inference_request: task.requestId, speech: "completed", listening: controller.snapshot().runtime.listening });
  }
  if (controller.snapshot().runtime.queuedVisualEvent) throw new Error("Conversation accepted a proactive observation.");
  process.stdout.write(`${JSON.stringify({ deterministic_state_proof: true, turns: results }, null, 2)}\n`);
}

async function observing() {
  const controller = createEmergencyRuntimeController();
  controller.activate("observing", { cameraActive: true, microphoneActive: false });
  const results = [];
  for (const movement of ["peace_sign", "thumbs_up"]) {
    controller.heartbeat(Date.now());
    const queued = controller.queueVisualEvent({ movement });
    if (!queued.ok) throw new Error(`Observation rejected: ${queued.code}`);
    const task = controller.takeNextTask();
    controller.finishInference(task);
    const speech = controller.beginSpeech();
    controller.markSpeechStarted(speech);
    controller.finishSpeech(speech, { completed: true });
    results.push({ movement, request: task.requestId, speech: "completed", observing: controller.snapshot().runtime.proactiveObservationActive });
  }
  const snapshot = controller.snapshot();
  if (snapshot.media.microphoneActive || snapshot.runtime.listening || !snapshot.runtime.detectorHeartbeatAtMs) throw new Error("Observing ownership invariant failed.");
  process.stdout.write(`${JSON.stringify({ deterministic_state_proof: true, events: results }, null, 2)}\n`);
}

function movementPngFrames() {
  const base = Date.now();
  return [pngFrame("neutral", base), pngFrame("raised_hand", base + 700), pngFrame("peace_sign", base + 1400)];
}

function pngFrame(kind, timestamp) {
  const width = 320;
  const height = 240;
  const rgb = Buffer.alloc(width * height * 3, 238);
  const paint = (x, y, w, h, color) => {
    for (let row = Math.max(0, y); row < Math.min(height, y + h); row += 1) for (let col = Math.max(0, x); col < Math.min(width, x + w); col += 1) {
      const offset = (row * width + col) * 3;
      rgb[offset] = color[0]; rgb[offset + 1] = color[1]; rgb[offset + 2] = color[2];
    }
  };
  paint(125, 45, 70, 150, [90, 115, 145]);
  if (kind !== "neutral") paint(205, 70, 35, 115, [196, 142, 105]);
  if (kind === "peace_sign") { paint(205, 35, 12, 55, [196, 142, 105]); paint(228, 30, 12, 60, [196, 142, 105]); }
  return frame("image/png", encodePng(width, height, rgb).toString("base64"), timestamp, width, height);
}

function encodePng(width, height, rgb) {
  const rows = [];
  for (let y = 0; y < height; y += 1) rows.push(Buffer.from([0]), rgb.subarray(y * width * 3, (y + 1) * width * 3));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function frame(mime, encoded, timestamp, width = 640, height = 480) {
  return { mime_type: mime, encoded_frame: encoded, data_uri: `data:${mime};base64,${encoded}`, captured_at_ms: timestamp, width, height };
}

function publicResult(result) {
  return { provider: result.provider, model: result.model, duration_ms: result.duration_ms, response_source: result.response_source, frame_count: result.frame_count, spoken_response: result.spoken_response, deterministic_fixture_mode: false };
}

function loadProjectEnv() {
  const merged = { ...process.env };
  if (!existsSync(".env")) return merged;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && merged[match[1]] === undefined) merged[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return merged;
}

async function getJson(url) {
  const response = await fetch(url);
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function chromeExecutable() {
  return [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((candidate) => candidate && existsSync(candidate));
}

function safe(value) {
  return String(value || "unknown").replace(/(?:hf_|sk-)[a-z0-9_-]+/gi, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
}
