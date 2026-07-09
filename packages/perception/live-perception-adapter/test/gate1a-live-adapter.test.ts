import assert from "node:assert/strict";
import {
  appendTraceEvents,
  createGate1AHappyPathFrames,
  createLivePerceptionAdapter,
  createLiveSymbolicTrace,
  exportTraceToReplayFixture,
  validateStableEvent
} from "../src/index.ts";

const adapter = createLivePerceptionAdapter();
const trace = createLiveSymbolicTrace("live_focus_ritual_001");

appendTraceEvents(trace, adapter.confirmCalibration({
  session_id: "ses_live_focus_ritual_001",
  calibration_id: "cal_live_focus_ritual_001",
  timestamp_ms: 0,
  confidence: 0.94,
  zone_ids: ["phone_zone", "notebook_zone", "pen_zone", "keyboard_zone", "off_desk_zone"]
}));

for (const frame of createGate1AHappyPathFrames()) {
  const events = adapter.ingestObservation(frame);
  for (const event of events) assert.deepEqual(validateStableEvent(event), { valid: true });
  appendTraceEvents(trace, events);
}

const diagnostics = adapter.getDiagnostics();
assert.equal(diagnostics.raw_media_persisted, false);
assert.equal(diagnostics.raw_frame_persisted, false);
assert.equal(diagnostics.raw_audio_persisted, false);
assert.equal(diagnostics.notebook_text_persisted, false);
assert.equal(diagnostics.cloud_fallback_enabled, false);
assert.equal(diagnostics.llm_calls, 0);
assert.equal(diagnostics.vlm_calls, 0);
assert.equal(diagnostics.estimated_cost_usd, 0);

const fixture = exportTraceToReplayFixture(trace, {
  fixtureId: "live_focus_ritual_001",
  name: "Gate 1A live symbolic Focus Ritual",
  description: "Symbolic-only live local perception trace exported into the replay harness format."
});

assert.equal(fixture.schema, "darkquest.replay_fixture.v0");
assert.equal(fixture.privacy.contains_raw_video, false);
assert.equal(fixture.privacy.contains_audio, false);
assert.equal(fixture.privacy.cloud_calls_expected, false);
assert.equal(fixture.metrics.max_llm_calls, 0);
assert.equal(fixture.metrics.max_vlm_calls, 0);
assert.equal(fixture.metrics.max_cost_usd, 0);
assert.equal(fixture.expected.model_calls.length, 0);
assert.equal(fixture.expected.memory_writes.length, 0);
assert.equal(fixture.expected.quest_transitions.length, 6);
assert.equal(fixture.expected.hud_commands.length, 6);
assert.ok(fixture.input_events.every((event) => event.producer === "perception.local"));
assert.ok(fixture.expected.stable_events.every((matcher) => matcher.event_id && matcher.payload_match && matcher.evidence_includes.length > 0));

console.log(`ok gate1a live adapter events=${fixture.input_events.length} transitions=${fixture.expected.quest_transitions.length}`);
