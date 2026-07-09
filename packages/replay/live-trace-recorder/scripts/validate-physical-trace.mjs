#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturePath = resolve(process.argv[2] ?? "fixtures/replay/live/live_physical_focus_ritual_001.v0.json");
const REQUIRED_PHYSICAL_TRACE_PATH = "fixtures/replay/live/live_physical_focus_ritual_001.v0.json";
const MISSING_TRACE_GUIDANCE = [
  "Missing required physical trace:",
  REQUIRED_PHYSICAL_TRACE_PATH,
  "",
  "If you downloaded the trace from the browser, move it to:",
  REQUIRED_PHYSICAL_TRACE_PATH,
  "",
  "Then rerun:",
  "npm run physical:validate",
  "npm run gate:1c"
].join("\n");
const failures = [];
const REQUIRED_SEQUENCE = [
  ["evt_scene_calibrated", "scene.calibrated"],
  ["evt_phone_moved_to_off_desk", "object.moved"],
  ["evt_notebook_opened", "object.placed"],
  ["evt_pen_moved_to_hand", "object.moved"],
  ["evt_writing_like_motion", "gesture.detected"],
  ["evt_typing_like_motion", "gesture.detected"]
];
const REQUIRED_STEP_IDS = [
  "step_phone_away",
  "step_notebook_open",
  "step_pen_pickup",
  "step_write_three_bullets",
  "step_start_typing",
  "step_quest_complete"
];

if (!existsSync(fixturePath)) {
  fail("physical_trace_missing", MISSING_TRACE_GUIDANCE);
  finish();
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const origin = fixture.trace_origin;

check(origin && typeof origin === "object", "trace_origin_missing", "trace_origin must exist.");
if (origin) {
  check(origin.source === "browser.local_camera", "trace_origin_source_invalid", "trace_origin.source must be browser.local_camera.");
  check(origin.dev_dry_run !== true, "dev_dry_run_invalid", "dev_dry_run exports cannot satisfy physical validation.");
  check(origin.physical_capture === true, "physical_capture_missing", "physical_capture must be true.");
  check(origin.operator_confirmed_physical_session === true, "operator_confirmation_missing", "operator_confirmed_physical_session must be true.");
  check(origin.manual_fixture === false, "manual_fixture_invalid", "manual_fixture must be false.");
  check(origin.raw_media_persisted === false, "raw_media_persisted_invalid", "raw_media_persisted must be false.");
  check(origin.cloud_calls_enabled === false, "cloud_calls_enabled_invalid", "cloud_calls_enabled must be false.");
  check(origin.browser_latency_recorded === true, "browser_latency_recorded_invalid", "browser_latency_recorded must be true.");
  check(origin.generated_by === "browser-local-capture", "generated_by_invalid", "generated_by must be browser-local-capture.");
  check(origin.capture_mode === "physical_webcam_manual_calibration", "capture_mode_invalid", "capture_mode must be physical_webcam_manual_calibration.");
}

check(fixture.privacy?.contains_raw_video === false, "raw_video_privacy_invalid", "privacy.contains_raw_video must be false.");
check(fixture.privacy?.contains_audio === false, "audio_privacy_invalid", "privacy.contains_audio must be false.");
check(fixture.privacy?.cloud_calls_expected === false, "cloud_privacy_invalid", "privacy.cloud_calls_expected must be false.");
check((fixture.expected?.model_calls ?? []).length === 0, "expected_model_calls_nonempty", "expected.model_calls must be empty.");
check((fixture.expected?.memory_writes ?? []).length === 0, "expected_memory_writes_nonempty", "expected.memory_writes must be empty unless policy-valid.");
check(fixture.metrics?.max_llm_calls === 0, "llm_budget_nonzero", "metrics.max_llm_calls must be 0.");
check(fixture.metrics?.max_vlm_calls === 0, "vlm_budget_nonzero", "metrics.max_vlm_calls must be 0.");
check(fixture.metrics?.max_cost_usd === 0, "cost_budget_nonzero", "metrics.max_cost_usd must be 0.");
check(Array.isArray(fixture.metrics?.browser_latency_records) && fixture.metrics.browser_latency_records.length >= REQUIRED_SEQUENCE.length, "browser_latency_records_missing", "browser latency records must exist for every ritual event.");

checkNoRawMedia(fixture);
checkNoModelCalls(fixture);
checkEvents(fixture.input_events ?? []);
checkFullRitualSequence(fixture.input_events ?? []);
checkExpectedMatchers(fixture);
checkLatency(fixture.metrics?.browser_latency_records ?? []);
runReplayRepeat3();

finish();

function checkEvents(events) {
  const ids = new Set();
  let previousTimestamp = -1;
  for (const [index, event] of events.entries()) {
    check(typeof event.id === "string" && event.id, "event_id_missing", `input_events[${index}].id missing.`);
    check(!ids.has(event.id), "duplicate_event_id", `Duplicate event id ${event.id}.`);
    ids.add(event.id);
    check(Number.isInteger(event.timestamp_ms) && event.timestamp_ms >= 0, "timestamp_invalid", `Invalid timestamp for ${event.id}.`);
    check(event.timestamp_ms >= previousTimestamp, "timestamps_non_monotonic", `Timestamp moved backwards at ${event.id}.`);
    previousTimestamp = event.timestamp_ms;
    check(event.producer === "perception.local", "producer_invalid", `Event ${event.id} producer must be perception.local.`);
    check(event.type !== "agent.escalation_requested", "model_call_event_forbidden", `Model escalation event is forbidden: ${event.id}.`);
    check(event.evidence?.every((item) => item.contains_raw_media === false), "evidence_raw_media_invalid", `Event ${event.id} evidence must contain no raw media.`);
  }
}

function checkLatency(records) {
  for (const [eventId] of REQUIRED_SEQUENCE) {
    check(records.some((record) => record.event_id === eventId), "latency_event_missing", `Missing browser latency record for ${eventId}.`);
  }
  for (const [index, record] of records.entries()) {
    check(Number(record.end_to_end_ms) >= 0, "latency_invalid", `Latency record ${index} missing end_to_end_ms.`);
    check((record.llm_calls ?? 0) === 0, "latency_llm_nonzero", `Latency record ${index} has nonzero llm_calls.`);
    check((record.vlm_calls ?? 0) === 0, "latency_vlm_nonzero", `Latency record ${index} has nonzero vlm_calls.`);
    check((record.raw_media_persistence_count ?? 0) === 0, "latency_raw_media_nonzero", `Latency record ${index} has raw media persistence.`);
  }
}

function checkFullRitualSequence(events) {
  let previousIndex = -1;
  for (const [eventId, eventType] of REQUIRED_SEQUENCE) {
    const index = events.findIndex((event) => event.id === eventId && event.type === eventType);
    check(index >= 0, "ritual_sequence_missing", `Missing ritual event ${eventId} (${eventType}).`);
    check(index > previousIndex, "ritual_sequence_out_of_order", `Ritual event ${eventId} is out of order.`);
    previousIndex = index;
  }
}

function checkExpectedMatchers(targetFixture) {
  const stableEvents = targetFixture.expected?.stable_events;
  const transitions = targetFixture.expected?.quest_transitions;
  const hudCommands = targetFixture.expected?.hud_commands;
  check(Array.isArray(stableEvents) && stableEvents.length >= REQUIRED_SEQUENCE.length, "expected_stable_matchers_missing", "Expected stable event matchers must exist for the full ritual.");
  check(Array.isArray(transitions) && transitions.length >= REQUIRED_STEP_IDS.length, "expected_transition_matchers_missing", "Expected quest transition matchers must exist for the full ritual.");
  check(Array.isArray(hudCommands) && hudCommands.length >= REQUIRED_STEP_IDS.length, "expected_hud_matchers_missing", "Expected HUD command matchers must exist for the full ritual.");

  if (Array.isArray(stableEvents)) {
    for (const [eventId, eventType] of REQUIRED_SEQUENCE) {
      const matcher = stableEvents.find((item) => item.event_id === eventId && item.type === eventType);
      check(matcher && matcher.payload_match && Array.isArray(matcher.evidence_includes), "expected_stable_matcher_missing", `Missing exact stable matcher for ${eventId}.`);
    }
  }
  if (Array.isArray(transitions)) {
    for (const stepId of REQUIRED_STEP_IDS) {
      check(transitions.some((item) => item.step_id === stepId), "expected_transition_matcher_missing", `Missing transition matcher for ${stepId}.`);
    }
  }
  if (Array.isArray(hudCommands)) {
    for (const stepId of REQUIRED_STEP_IDS) {
      check(hudCommands.some((item) => item.related_step_id === stepId), "expected_hud_matcher_missing", `Missing HUD matcher for ${stepId}.`);
    }
  }
}

function runReplayRepeat3() {
  if (failures.length) return;
  const replay = spawnSync(process.execPath, [
    "packages/evals/bin/darkquest-eval.mjs",
    "replay",
    "--repeat",
    "3",
    fixturePath
  ], {
    cwd: resolve("."),
    encoding: "utf8"
  });
  if (replay.status !== 0) {
    fail("physical_replay_repeat_failed", `Replay repeat 3 failed: ${(replay.stdout || replay.stderr || "").trim()}`);
  }
}

function checkNoModelCalls(value, path = "$") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => checkNoModelCalls(child, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "type" && child === "agent.escalation_requested") {
      fail("unexpected_model_call", `${path}.type contains agent.escalation_requested.`);
    }
    if (key === "llm_calls" && Number(child) !== 0) {
      fail("unexpected_model_call", `${path}.llm_calls must be 0.`);
    }
    if (key === "vlm_calls" && Number(child) !== 0) {
      fail("unexpected_model_call", `${path}.vlm_calls must be 0.`);
    }
    checkNoModelCalls(child, `${path}.${key}`);
  }
}

function checkNoRawMedia(value, path = "$") {
  if (path === "$.forbidden" || path.startsWith("$.forbidden.")) return;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (/^data:(image|audio|video)\//.test(lowered) ||
      lowered.includes("base64") ||
      lowered.includes("raw_frame") ||
      lowered.includes("raw_video") ||
      lowered.includes("raw_audio") ||
      lowered.includes("screenshot") ||
      lowered.includes("ocr") ||
      lowered.includes("notebook_text") ||
      /\.(png|jpe?g|webp|gif|mp4|mov|webm|wav|mp3)$/i.test(value)) {
      fail("raw_media_marker_found", `${path} contains forbidden raw media marker.`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => checkNoRawMedia(child, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (child === false && [
      "raw_media_persisted",
      "raw_video_persisted",
      "raw_audio_persisted",
      "raw_frame_persisted",
      "contains_raw_media",
      "contains_raw_video",
      "contains_audio",
      "contains_raw_frames",
      "contains_screenshots"
    ].includes(key)) {
      continue;
    }
    checkNoRawMedia(key, `${path}.${key}`);
    checkNoRawMedia(child, `${path}.${key}`);
  }
}

function check(condition, code, message) {
  if (!condition) fail(code, message);
}

function fail(code, message) {
  failures.push({ code, message });
}

function finish() {
  const finalVerdict = failures.length
    ? failures.some((item) => item.code === "physical_trace_missing")
      ? "BLOCKED_MISSING_PHYSICAL_TRACE"
      : "FAIL"
    : "PASS";
  mkdirSync("runs", { recursive: true });
  writeFileSync("runs/physical-validate-latest.json", `${JSON.stringify({
    schema: "darkquest.physical_trace_validation_report.v0",
    fixture_path: fixturePath,
    required_physical_trace_path: REQUIRED_PHYSICAL_TRACE_PATH,
    recovery_instructions: failures.some((item) => item.code === "physical_trace_missing")
      ? MISSING_TRACE_GUIDANCE.split("\n")
      : [],
    final_verdict: finalVerdict,
    failure_count: failures.length,
    failures
  }, null, 2)}\n`);
  if (failures.length) {
    console.error(`${finalVerdict} physical trace validation`);
    console.error("report: runs/physical-validate-latest.json");
    for (const item of failures) console.error(`- ${item.code}: ${item.message}`);
    process.exit(1);
  }
  console.log("PASS physical trace validation");
  console.log("report: runs/physical-validate-latest.json");
  console.log(`fixture: ${fixturePath}`);
}
