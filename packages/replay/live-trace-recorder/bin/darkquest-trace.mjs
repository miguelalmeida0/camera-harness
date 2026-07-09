#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createGate1AHappyPathFixture,
  createGate1BBrowserFocusRitualFixture,
  exportTraceToReplayFixture
} from "../../../perception/live-perception-adapter/src/index.ts";

const [command, flag, outputArg] = process.argv.slice(2);

if (command !== "export" || flag !== "--latest" || !outputArg) {
  console.error("Usage: darkquest-trace export --latest fixtures/replay/live/live_focus_ritual_001.v0.json");
  process.exit(2);
}

const outputPath = resolve(outputArg);
const latestTracePath = resolve("runs/live/latest-trace.json");
let fixture;

if (existsSync(latestTracePath)) {
  const trace = JSON.parse(readFileSync(latestTracePath, "utf8"));
  fixture = exportTraceToReplayFixture(trace, {
    fixtureId: outputPathToFixtureId(outputPath),
    name: "Gate 1A live symbolic trace",
    description: "Symbolic live trace exported by darkquest-trace."
  });
} else {
  const fixtureId = outputPathToFixtureId(outputPath);
  fixture = fixtureId === "live_browser_focus_ritual_001"
    ? createGate1BBrowserFocusRitualFixture()
    : createGate1AHappyPathFixture();
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);

console.log(`exported ${outputPath}`);
console.log(`events=${fixture.input_events.length} quest_transitions=${fixture.expected.quest_transitions.length} hud_commands=${fixture.expected.hud_commands.length}`);
console.log("raw_video_persisted=false raw_frame_persisted=false raw_audio_persisted=false cloud_calls=0");

function outputPathToFixtureId(path) {
  return path.split(/[\\/]/).pop()?.replace(/\.v0\.json$/, "") ?? "live_symbolic_trace";
}
