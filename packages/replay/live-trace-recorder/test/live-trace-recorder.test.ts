import assert from "node:assert/strict";
import {
  createGate1AHappyPathFrames,
  createLivePerceptionAdapter
} from "../../../perception/live-perception-adapter/src/index.ts";
import { createLiveTraceRecorder } from "../src/index.ts";

const adapter = createLivePerceptionAdapter();
const recorder = createLiveTraceRecorder("live_focus_ritual_001", "ses_live_focus_ritual_001");

recorder.appendEvents(adapter.confirmCalibration({
  session_id: "ses_live_focus_ritual_001",
  calibration_id: "cal_live_focus_ritual_001",
  timestamp_ms: 0,
  confidence: 0.94,
  zone_ids: ["phone_zone", "notebook_zone", "pen_zone", "keyboard_zone", "off_desk_zone"]
}));

for (const frame of createGate1AHappyPathFrames()) {
  recorder.appendEvents(adapter.ingestObservation(frame));
}

const fixture = recorder.exportFixture({
  fixtureId: "live_focus_ritual_001",
  name: "Gate 1A live symbolic Focus Ritual"
});

assert.equal(fixture.schema, "darkquest.replay_fixture.v0");
assert.equal(fixture.expected.quest_transitions.length, 6);
assert.equal(fixture.expected.model_calls.length, 0);
assert.equal(fixture.metrics.max_llm_calls, 0);
assert.equal(fixture.metrics.max_vlm_calls, 0);
assert.equal(recorder.getStatus().raw_video_persisted, false);
assert.equal(recorder.getStatus().cloud_calls, 0);

console.log(`ok live trace recorder events=${fixture.input_events.length}`);
