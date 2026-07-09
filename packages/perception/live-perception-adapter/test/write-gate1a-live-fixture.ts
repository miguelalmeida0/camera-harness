import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createGate1AHappyPathFixture,
  createGate1AHappyPathTrace,
  createGate1BBrowserFocusRitualFixture,
  createGate1BCameraBumpResetFixture,
  createGate1BOcclusionRecoveryFixture,
  createReplayFixtureFromEvents
} from "../src/index.ts";

const outputPath = resolve(process.argv[2] ?? "fixtures/replay/live/live_focus_ritual_001.v0.json");
const fullTrace = createGate1AHappyPathTrace();
const fixture = createGate1AHappyPathFixture();
const controlledFixtures = [
  {
    path: "fixtures/replay/live/live_phone_moved_001.v0.json",
    cutoffMs: 1000,
    fixtureId: "live_phone_moved_001",
    name: "Gate 1A live phone moved"
  },
  {
    path: "fixtures/replay/live/live_notebook_opened_001.v0.json",
    cutoffMs: 2200,
    fixtureId: "live_notebook_opened_001",
    name: "Gate 1A live notebook opened"
  },
  {
    path: "fixtures/replay/live/live_pen_picked_up_001.v0.json",
    cutoffMs: 3300,
    fixtureId: "live_pen_picked_up_001",
    name: "Gate 1A live pen picked up"
  },
  {
    path: "fixtures/replay/live/live_writing_motion_001.v0.json",
    cutoffMs: 4700,
    fixtureId: "live_writing_motion_001",
    name: "Gate 1A live writing motion"
  },
  {
    path: "fixtures/replay/live/live_typing_motion_001.v0.json",
    cutoffMs: 6200,
    fixtureId: "live_typing_motion_001",
    name: "Gate 1A live typing motion"
  }
];
const gate1BFixtures = [
  {
    path: "fixtures/replay/live/live_browser_focus_ritual_001.v0.json",
    fixture: createGate1BBrowserFocusRitualFixture()
  },
  {
    path: "fixtures/replay/live/live_occlusion_recovery_001.v0.json",
    fixture: createGate1BOcclusionRecoveryFixture()
  },
  {
    path: "fixtures/replay/live/live_camera_bump_reset_001.v0.json",
    fixture: createGate1BCameraBumpResetFixture()
  }
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);

for (const controlled of controlledFixtures) {
  const controlledPath = resolve(controlled.path);
  const events = fullTrace.events.filter((event) => event.timestamp_ms <= controlled.cutoffMs);
  const controlledFixture = createReplayFixtureFromEvents(events, {
    fixtureId: controlled.fixtureId,
    name: controlled.name,
    description: `Controlled symbolic live trace through ${controlled.name}.`
  });
  mkdirSync(dirname(controlledPath), { recursive: true });
  writeFileSync(controlledPath, `${JSON.stringify(controlledFixture, null, 2)}\n`);
}

for (const item of gate1BFixtures) {
  const gate1BPath = resolve(item.path);
  mkdirSync(dirname(gate1BPath), { recursive: true });
  writeFileSync(gate1BPath, `${JSON.stringify(item.fixture, null, 2)}\n`);
}

console.log(`exported ${outputPath}`);
console.log(`events=${fixture.input_events.length} quest_transitions=${fixture.expected.quest_transitions.length} hud_commands=${fixture.expected.hud_commands.length}`);
console.log("raw_video_persisted=false raw_frame_persisted=false raw_audio_persisted=false cloud_calls=0");
