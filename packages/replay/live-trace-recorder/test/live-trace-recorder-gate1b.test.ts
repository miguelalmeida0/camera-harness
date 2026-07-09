import assert from "node:assert/strict";
import {
  createGate1AHappyPathFrames,
  createLivePerceptionAdapter,
  type TraceOrigin
} from "../../../perception/live-perception-adapter/src/index.ts";
import { createLiveTraceRecorder } from "../src/index.ts";

const traceOrigin: TraceOrigin = {
  source: "browser.local_camera",
  raw_media_persisted: false,
  cloud_calls_enabled: false,
  manual_fixture: false,
  generated_by: "live-perception-adapter",
  capture_mode: "manual_calibration_browser_live",
  browser_latency_recorded: true
};

const adapter = createLivePerceptionAdapter();
const recorder = createLiveTraceRecorder("live_browser_focus_ritual_test", "ses_live_focus_ritual_001", traceOrigin);

for (const frame of createGate1AHappyPathFrames("browser.local_camera").slice(0, 2)) {
  const events = adapter.ingestObservation(frame);
  recorder.appendEvents(events);
  recorder.appendBrowserLatency({
    frame_id: frame.frameId,
    timestamp_ms: frame.timestampMs,
    frame_capture_ms: 8,
    observation_extraction_ms: 18,
    adapter_ms: 6,
    stabilizer_ms: 7,
    event_emission_ms: 3,
    hud_update_ms: 6,
    trace_recorder_ms: 2,
    end_to_end_ms: 50,
    dropped_frames: 0
  });
}

const fixture = recorder.exportFixture({
  fixtureId: "live_browser_focus_ritual_test",
  name: "Gate 1B recorder browser trace"
});

assert.equal(fixture.trace_origin?.source, "browser.local_camera");
assert.equal(fixture.metrics.browser_latency_records?.length, 2);
assert.equal(fixture.metrics.p50_latency_ms, 50);
assert.equal(fixture.metrics.p95_latency_ms, 50);
assert.equal(fixture.metrics.max_latency_ms, 50);

recorder.setTraceOrigin({
  source: "browser.local_camera",
  raw_media_persisted: false,
  cloud_calls_enabled: false,
  manual_fixture: false,
  generated_by: "browser-local-capture",
  capture_mode: "physical_webcam_manual_calibration",
  browser_latency_recorded: true,
  physical_capture: true,
  operator_confirmed_physical_session: true
});
const status = recorder.getStatus();
assert.equal(status.trace_origin?.physical_capture, true);
assert.equal(status.trace_origin?.operator_confirmed_physical_session, true);
assert.equal(status.browser_latency_record_count, 2);

console.log("ok live trace recorder gate1b browser metadata");
