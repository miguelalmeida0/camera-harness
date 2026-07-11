#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { visualCompanionHealth, visualCompanionObserveResponseForRequest } from "../server/visual-companion-provider.mjs";

const startedAt = Date.now();
const outputPath = resolve("runs/visual-benchmark-latest.json");
const frame = tinyJpegFrame();
const health = await visualCompanionHealth(process.env);
const response = await visualCompanionObserveResponseForRequest({
  frames: [frame, { ...frame, captured_at_ms: frame.captured_at_ms + 400 }],
  client_scene_change_score: 0,
  previous_context: {},
  requested_response_mode: "auto",
  memory_mode: "session"
}, process.env);

const report = {
  schema_version: "darkquest.visual_benchmark.v1",
  generated_at: new Date().toISOString(),
  health,
  status: response.status,
  response_type: response.json.response_type,
  confidence: response.json.confidence,
  latency_ms: Date.now() - startedAt,
  model: response.json.model,
  contains_raw_media: false
};

mkdirSync(resolve("runs"), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
console.log(`${report.response_type} · ${report.latency_ms}ms · ${report.model}`);

function tinyJpegFrame() {
  return {
    mime_type: "image/jpeg",
    encoded_frame: "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==",
    captured_at_ms: Date.now(),
    width: 1,
    height: 1
  };
}
