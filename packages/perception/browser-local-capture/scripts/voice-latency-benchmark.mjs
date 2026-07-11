#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  ensureNeuralVoiceService,
  loadProjectEnv,
  stopOwnedVoiceService
} from "./neural-voice-startup.mjs";

const root = resolve(".");
loadProjectEnv(root);
const startupStarted = performance.now();
let service;

try {
  service = await ensureNeuralVoiceService({ root, env: process.env });
  const startupMs = Math.round(performance.now() - startupStarted);
  const shortText = "Sensefield responds quickly with one clear and natural sentence.";
  const longText = "I can describe the current view directly and clearly. The first useful sentence should begin quickly, while later sentences continue synthesizing in the background. This longer response verifies that progressive neural playback does not wait for one complete final waveform.";
  const legacyShort = await measureLegacy(service.serviceUrl, shortText);
  const legacyLong = await measureLegacy(service.serviceUrl, longText);
  const streamedShort = await measureStream(service.serviceUrl, shortText);
  const streamedLong = await measureStream(service.serviceUrl, longText);
  const cancellation = await measureCancellation(service.serviceUrl, longText);
  const browserLifecycle = await measureBrowserLifecycle();
  const report = {
    schema_version: "sensefield.voice_latency.v1",
    cold_startup_ms: service.owned ? startupMs : null,
    reused_warm_service: service.owned !== true,
    warmup_ms: Number(service.warmup?.warmupMs || 0),
    previous_full_wav_short_ms: legacyShort.completeMs,
    previous_full_wav_long_ms: legacyLong.completeMs,
    warmed_short_first_audio_ms: streamedShort.firstAudioMs,
    warmed_short_complete_ms: streamedShort.completeMs,
    long_first_audio_ms: streamedLong.firstAudioMs,
    long_stream_complete_ms: streamedLong.completeMs,
    max_inter_chunk_gap_ms: streamedLong.maxGapMs,
    peak_queued_chunks: streamedLong.peakQueuedChunks,
    long_chunk_count: streamedLong.chunkCount,
    cancellation_latency_ms: cancellation,
    browser_text_to_playing_ms: browserLifecycle.textToPlayingMs,
    browser_playing_to_ended_ms: browserLifecycle.playingToEndedMs,
    browser_logical_start_count: browserLifecycle.startCount,
    browser_logical_completion_count: browserLifecycle.completionCount,
    audio_persisted: false,
    raw_media_persisted: false
  };
  console.log(JSON.stringify(report, null, 2));
  if (!(report.warmed_short_first_audio_ms > 0)) throw new Error("No streamed first-audio timing was measured.");
  if (!(report.long_first_audio_ms < report.long_stream_complete_ms)) throw new Error("Long speech did not deliver its first chunk before completion.");
  console.log("SENSEFIELD_VOICE_LATENCY_BENCHMARK_OK");
} finally {
  stopOwnedVoiceService(service);
}

async function measureBrowserLifecycle() {
  const port = 4197;
  const launcher = spawn(process.execPath, ["packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs", "--port", String(port)], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"]
  });
  let browser;
  try {
    await waitForUrl("http://127.0.0.1:" + port + "/", 15000);
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + port + "/", { waitUntil: "domcontentloaded" });
    const events = await page.evaluate(async () => {
      const runtime = await import("/local-capture.js");
      const target = runtime.createInitialState();
      const evidence = [];
      const result = await runtime.speakSensefieldResponse({ observationId: "benchmark_browser", text: "Sensefield neural voice test." }, {
        target,
        onVoiceEvidence: (event) => evidence.push({ event: event.event, atMs: event.atMs })
      });
      return { ok: result.ok === true, evidence };
    });
    if (!events.ok) throw new Error("Real browser neural playback failed.");
    const requested = events.evidence.find((event) => event.event === "requested")?.atMs;
    const playing = events.evidence.find((event) => event.event === "playing")?.atMs;
    const ended = events.evidence.find((event) => event.event === "ended")?.atMs;
    return {
      textToPlayingMs: requested && playing ? Math.max(0, playing - requested) : 0,
      playingToEndedMs: playing && ended ? Math.max(0, ended - playing) : 0,
      startCount: events.evidence.filter((event) => event.event === "playing").length,
      completionCount: events.evidence.filter((event) => event.event === "ended").length
    };
  } finally {
    await browser?.close?.();
    launcher.kill("SIGTERM");
  }
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for the browser latency harness.");
}

async function measureLegacy(serviceUrl, text) {
  const started = performance.now();
  const response = await fetch(endpoint(serviceUrl, "/speak"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/wav" },
    body: JSON.stringify({ text, voice: "sensefield_default", contains_raw_media: false })
  });
  if (!response.ok || !String(response.headers.get("content-type") || "").startsWith("audio/")) throw new Error("Legacy voice benchmark failed.");
  await response.arrayBuffer();
  return { completeMs: Math.round(performance.now() - started) };
}

async function measureStream(serviceUrl, text) {
  const started = performance.now();
  const response = await fetch(endpoint(serviceUrl, "/speak-stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ speech_id: "benchmark_voice", text, voice: "sensefield_default", mode: "conversation", chunking: "sentence", contains_raw_media: false })
  });
  if (!response.ok || !response.body) throw new Error("Streaming voice benchmark failed.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let firstAudioMs = 0;
  let previousScheduledEnd = 0;
  let maxGapMs = 0;
  let peakQueuedChunks = 0;
  let chunkCount = 0;
  const scheduledEnds = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "error") throw new Error("Streaming voice generation failed.");
      if (event.type !== "audio") continue;
      const arrived = performance.now() - started;
      if (!firstAudioMs) firstAudioMs = Math.round(arrived);
      const scheduledStart = Math.max(arrived, previousScheduledEnd);
      if (previousScheduledEnd > 0) maxGapMs = Math.max(maxGapMs, Math.max(0, arrived - previousScheduledEnd));
      previousScheduledEnd = scheduledStart + Number(event.audio_duration_ms || 0);
      scheduledEnds.push(previousScheduledEnd);
      peakQueuedChunks = Math.max(peakQueuedChunks, scheduledEnds.filter((end) => end > arrived).length - 1);
      chunkCount += 1;
    }
  }
  return { firstAudioMs, completeMs: Math.round(performance.now() - started), maxGapMs: Math.round(maxGapMs), peakQueuedChunks, chunkCount };
}

async function measureCancellation(serviceUrl, text) {
  const controller = new AbortController();
  const response = await fetch(endpoint(serviceUrl, "/speak-stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ speech_id: "benchmark_cancel", text, voice: "sensefield_default", mode: "conversation", chunking: "sentence", contains_raw_media: false }),
    signal: controller.signal
  });
  const reader = response.body.getReader();
  await reader.read();
  const started = performance.now();
  await fetch(endpoint(serviceUrl, "/cancel"), { method: "POST", headers: { Accept: "application/json" } });
  controller.abort();
  try { await reader.cancel(); } catch {}
  return Math.round(performance.now() - started);
}

function endpoint(base, path) {
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/$/, "") + path;
  return url.toString();
}
