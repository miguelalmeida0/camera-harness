import assert from "node:assert/strict";
import {
  createGate1BBrowserFocusRitualFixture,
  createGate1BCameraBumpResetFixture,
  createGate1BOcclusionRecoveryFixture
} from "../src/index.ts";

const browserFixture = createGate1BBrowserFocusRitualFixture();
assert.equal(browserFixture.trace_origin?.source, "browser.local_camera");
assert.equal(browserFixture.trace_origin?.raw_media_persisted, false);
assert.equal(browserFixture.trace_origin?.cloud_calls_enabled, false);
assert.equal(browserFixture.trace_origin?.manual_fixture, false);
assert.ok((browserFixture.metrics.browser_latency_records?.length ?? 0) > 0);
assert.equal(browserFixture.metrics.max_llm_calls, 0);
assert.equal(browserFixture.metrics.max_vlm_calls, 0);
assert.equal(browserFixture.expected.quest_transitions.length, 6);

const occlusionFixture = createGate1BOcclusionRecoveryFixture();
assert.ok(occlusionFixture.input_events.some((event) => event.type === "scene.uncertain"));
assert.ok(occlusionFixture.input_events.some((event) => event.type === "confidence.changed"));
assert.ok(occlusionFixture.expected.hud_commands.some((command) => command.command_type === "show_uncertain_state"));

const resetFixture = createGate1BCameraBumpResetFixture();
assert.ok(resetFixture.input_events.some((event) => event.type === "scene.reset"));
assert.ok(resetFixture.input_events.some((event) => event.type === "scene.calibrated" && event.timestamp_ms > 1400));
assert.ok(resetFixture.expected.hud_commands.some((command) => command.command_type === "show_recovery_state"));

console.log("ok gate1b live adapter fixtures");
