#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createBrowserLocalCaptureSession,
  PHYSICAL_BROWSER_TRACE_ORIGIN
} from "../../../perception/browser-local-capture/src/index.ts";

const DEFAULT_INPUT = "runs/live/physical-symbolic-observations.json";
const DEFAULT_OUTPUT = "fixtures/replay/live/live_physical_focus_ritual_001.v0.json";
const args = process.argv.slice(2);
const inputPath = resolve(valueAfter("--input") ?? DEFAULT_INPUT);
const outputPath = resolve(valueAfter("--output") ?? DEFAULT_OUTPUT);
const operatorConfirmed = args.includes("--operator-confirmed");

if (!operatorConfirmed) {
  die("Refusing export: pass --operator-confirmed after completing a real physical browser webcam session.");
}

const input = JSON.parse(readFileSync(inputPath, "utf8"));
assertInputAllowed(input);

const session = createBrowserLocalCaptureSession({
  traceId: "live_physical_focus_ritual_001",
  sessionId: "ses_live_physical_focus_ritual_001",
  physicalCapture: true,
  operatorConfirmedPhysicalSession: true
});
session.startTrace("live_physical_focus_ritual_001", "ses_live_physical_focus_ritual_001", PHYSICAL_BROWSER_TRACE_ORIGIN);

for (const observation of input.local_observation_frames) {
  session.ingestObservation({
    frameId: observation.frameId,
    timestampMs: observation.timestampMs,
    hands: observation.hands,
    objects: observation.objects,
    zones: observation.zones,
    scene: observation.scene
  }, timingFor(observation, input.browser_latency_records));
}

const fixture = session.exportReplayFixture({
  fixtureId: "live_physical_focus_ritual_001",
  name: "Gate 1C physical browser Focus Ritual",
  description: "Operator-confirmed physical browser webcam symbolic trace exported without raw media persistence."
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);

console.log(`exported ${outputPath}`);
console.log("trace_origin.physical_capture=true");
console.log("trace_origin.operator_confirmed_physical_session=true");
console.log("raw_media_persisted=false cloud_calls_enabled=false llm_calls=0 vlm_calls=0");

function assertInputAllowed(input) {
  const origin = input.trace_origin;
  if (!origin || typeof origin !== "object") die("Refusing export: missing trace_origin.");
  if (origin.source !== "browser.local_camera") die("Refusing export: trace_origin.source must be browser.local_camera.");
  if (origin.raw_media_persisted !== false) die("Refusing export: raw_media_persisted must be false.");
  if (origin.cloud_calls_enabled !== false) die("Refusing export: cloud_calls_enabled must be false.");
  if (origin.manual_fixture !== false) die("Refusing export: manual_fixture must be false.");
  if (origin.generated_by !== "browser-local-capture") die("Refusing export: generated_by must be browser-local-capture.");
  if (origin.capture_mode !== "physical_webcam_manual_calibration") die("Refusing export: capture_mode must be physical_webcam_manual_calibration.");
  if (origin.browser_latency_recorded !== true) die("Refusing export: browser_latency_recorded must be true.");
  if (origin.physical_capture !== true) die("Refusing export: physical_capture must be true.");
  if (origin.operator_confirmed_physical_session !== true) die("Refusing export: operator_confirmed_physical_session must be true.");
  if (input.model_calls?.llm_calls !== 0 || input.model_calls?.vlm_calls !== 0) die("Refusing export: model call counts must be 0.");
  if (!Array.isArray(input.local_observation_frames) || input.local_observation_frames.length === 0) die("Refusing export: local_observation_frames are required.");
  if (!Array.isArray(input.browser_latency_records) || input.browser_latency_records.length === 0) die("Refusing export: browser_latency_records are required.");
  if (!input.local_observation_frames.every((frame) => frame.source === "browser.local_camera")) die("Refusing export: every observation source must be browser.local_camera.");
  if (containsForbiddenRawMedia(input)) die("Refusing export: symbolic input contains raw media, screenshot, audio, base64, OCR, or notebook text markers.");
}

function timingFor(observation, records) {
  const record = records.find((item) => item.frame_id === observation.frameId || item.timestamp_ms === observation.timestampMs) ?? {};
  return {
    frame_capture_ms: Number(record.frame_capture_ms ?? 8),
    observation_extraction_ms: Number(record.observation_extraction_ms ?? 18),
    adapter_ms: typeof record.adapter_ms === "number" ? record.adapter_ms : 6,
    stabilizer_ms: typeof record.stabilizer_ms === "number" ? record.stabilizer_ms : 7,
    event_emission_ms: typeof record.event_emission_ms === "number" ? record.event_emission_ms : 3,
    hud_update_ms: typeof record.hud_update_ms === "number" ? record.hud_update_ms : 6,
    trace_recorder_ms: typeof record.trace_recorder_ms === "number" ? record.trace_recorder_ms : 2,
    dropped_frames: Number(record.dropped_frames ?? 0)
  };
}

function containsForbiddenRawMedia(value) {
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    return /^data:(image|audio|video)\//.test(lowered) ||
      lowered.includes("base64") ||
      lowered.includes("raw_frame") ||
      lowered.includes("raw_video") ||
      lowered.includes("raw_audio") ||
      lowered.includes("screenshot") ||
      lowered.includes("ocr") ||
      lowered.includes("notebook_text") ||
      /\.(png|jpe?g|webp|gif|mp4|mov|webm|wav|mp3)$/i.test(value);
  }
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenRawMedia);
  return Object.entries(value).some(([key, child]) => {
    if (child === false && [
      "raw_media_persisted",
      "screenshots_persisted",
      "base64_media_persisted",
      "audio_requested",
      "cloud_calls_enabled",
      "contains_raw_media",
      "contains_raw_video",
      "contains_audio"
    ].includes(key)) {
      return false;
    }
    return containsForbiddenRawMedia(key) || containsForbiddenRawMedia(child);
  });
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function die(message) {
  console.error(message);
  process.exit(2);
}
