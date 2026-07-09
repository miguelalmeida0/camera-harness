import assert from "node:assert/strict";
import { createBrowserLocalCaptureSession, PHYSICAL_BROWSER_TRACE_ORIGIN } from "../src/index.ts";

const session = createBrowserLocalCaptureSession({
  traceId: "live_browser_focus_ritual_test",
  sessionId: "ses_browser_test"
});

session.startTrace("live_browser_focus_ritual_test", "ses_browser_test");

const result = session.ingestObservation({
  frameId: "browser_test_0001",
  timestampMs: 0,
  hands: [],
  objects: [
    { object_id: "obj_phone", zone_id: "phone_zone", present: true, confidence: 0.92 }
  ],
  zones: [
    { zone_id: "phone_zone", active: true, confidence: 0.94 },
    { zone_id: "notebook_zone", active: true, confidence: 0.94 },
    { zone_id: "pen_zone", active: true, confidence: 0.94 },
    { zone_id: "keyboard_zone", active: true, confidence: 0.94 },
    { zone_id: "off_desk_zone", active: true, confidence: 0.94 }
  ],
  scene: {
    calibrated: true,
    uncertain: false,
    reset_detected: false,
    confidence: 0.94
  }
});

assert.equal(result.frame.source, "browser.local_camera");
assert.equal(result.latency.dropped_frames, 0);
assert.equal(session.privacy.raw_media_persisted, false);
assert.equal(session.privacy.audio_requested, false);
assert.equal(session.privacy.llm_calls, 0);
assert.equal(session.privacy.vlm_calls, 0);

const fixture = session.exportReplayFixture() as {
  trace_origin?: { source?: string; raw_media_persisted?: boolean; cloud_calls_enabled?: boolean };
  metrics?: { browser_latency_records?: unknown[] };
};

assert.equal(fixture.trace_origin?.source, "browser.local_camera");
assert.equal(fixture.trace_origin?.raw_media_persisted, false);
assert.equal(fixture.trace_origin?.cloud_calls_enabled, false);
assert.equal(Array.isArray(fixture.metrics?.browser_latency_records), true);
assert.equal(fixture.metrics?.browser_latency_records?.length, 1);

const physicalSession = createBrowserLocalCaptureSession({
  traceId: "live_physical_focus_ritual_test",
  sessionId: "ses_physical_test",
  physicalCapture: true,
  operatorConfirmedPhysicalSession: true
});

physicalSession.startTrace("live_physical_focus_ritual_test", "ses_physical_test", PHYSICAL_BROWSER_TRACE_ORIGIN);
const physicalFrame = physicalSession.ingestObservation({
  frameId: "physical_test_0001",
  timestampMs: 0,
  hands: [],
  objects: [],
  zones: [
    { zone_id: "phone_zone", active: true, confidence: 0.94 },
    { zone_id: "notebook_zone", active: true, confidence: 0.94 },
    { zone_id: "pen_zone", active: true, confidence: 0.94 },
    { zone_id: "keyboard_zone", active: true, confidence: 0.94 },
    { zone_id: "neutral_zone", active: true, confidence: 0.94 },
    { zone_id: "off_desk_zone", active: true, confidence: 0.94 }
  ],
  scene: {
    calibrated: true,
    uncertain: false,
    reset_detected: false,
    confidence: 0.94
  }
});
const physicalHud = physicalFrame.hud;
assert.equal(physicalHud.physical_capture_status, "operator_confirmed");
assert.equal(physicalHud.calibration_status, "calibrated");
assert.equal(physicalHud.raw_media_persisted, false);

const physicalFixture = physicalSession.exportReplayFixture({
  fixtureId: "live_physical_focus_ritual_test",
  name: "Gate 1C physical metadata test"
}) as {
  trace_origin?: {
    capture_mode?: string;
    physical_capture?: boolean;
    operator_confirmed_physical_session?: boolean;
    generated_by?: string;
  };
};
assert.equal(physicalFixture.trace_origin?.generated_by, "browser-local-capture");
assert.equal(physicalFixture.trace_origin?.capture_mode, "physical_webcam_manual_calibration");
assert.equal(physicalFixture.trace_origin?.physical_capture, true);
assert.equal(physicalFixture.trace_origin?.operator_confirmed_physical_session, true);

console.log("ok browser-local-capture symbolic boundary");
