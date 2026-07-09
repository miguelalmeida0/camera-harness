#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturePath = resolve(process.argv[2] ?? "runs/dev/gate-1d-dry-run-export.json");
const failures = [];
const report = {
  schema: "darkquest.dev_trace_validation_report.v0",
  fixture_path: fixturePath,
  gate_1c_satisfiable: false,
  replay_compatible_except_physical_provenance: false,
  final_verdict: "FAIL",
  failures
};

if (!existsSync(fixturePath)) {
  fail("dev_trace_missing", `Missing dev dry-run trace: ${fixturePath}`);
  finish();
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const origin = fixture.trace_origin;

check(fixture.schema === "darkquest.replay_fixture.v0", "schema_invalid", "Dev trace must use darkquest.replay_fixture.v0.");
check(origin && typeof origin === "object", "trace_origin_missing", "trace_origin must exist.");
if (origin) {
  check(origin.source === "browser.local_camera", "trace_origin_source_invalid", "trace_origin.source must be browser.local_camera.");
  check(origin.dev_dry_run === true, "dev_dry_run_not_true", "trace_origin.dev_dry_run must be true.");
  check(origin.manual_fixture === true, "manual_fixture_not_true", "trace_origin.manual_fixture must be true.");
  check(origin.physical_capture === false, "physical_capture_not_false", "trace_origin.physical_capture must be false.");
  check(origin.operator_confirmed_physical_session === false, "operator_confirmed_not_false", "trace_origin.operator_confirmed_physical_session must be false.");
  check(origin.raw_media_persisted === false, "raw_media_persisted_invalid", "trace_origin.raw_media_persisted must be false.");
  check(origin.cloud_calls_enabled === false, "cloud_calls_enabled_invalid", "trace_origin.cloud_calls_enabled must be false.");
  check(origin.generated_by === "browser-local-capture", "generated_by_invalid", "trace_origin.generated_by must be browser-local-capture.");
  check(origin.capture_mode === "dev_dry_run_manual_confirmation", "capture_mode_invalid", "trace_origin.capture_mode must be dev_dry_run_manual_confirmation.");
  check(origin.browser_latency_recorded === true, "browser_latency_recorded_invalid", "trace_origin.browser_latency_recorded must be true.");
}

check(fixture.privacy?.contains_raw_video === false, "raw_video_privacy_invalid", "privacy.contains_raw_video must be false.");
check(fixture.privacy?.contains_audio === false, "audio_privacy_invalid", "privacy.contains_audio must be false.");
check(fixture.privacy?.cloud_calls_expected === false, "cloud_privacy_invalid", "privacy.cloud_calls_expected must be false.");
check(Array.isArray(fixture.input_events) && fixture.input_events.length >= 6, "input_events_missing", "Dev trace must include Focus Ritual input events.");
check(Array.isArray(fixture.expected?.stable_events) && fixture.expected.stable_events.length >= 6, "expected_stable_events_missing", "Expected stable event matchers must exist.");
check(Array.isArray(fixture.expected?.quest_transitions) && fixture.expected.quest_transitions.length >= 6, "expected_transitions_missing", "Expected quest transitions must exist.");
check(Array.isArray(fixture.expected?.hud_commands) && fixture.expected.hud_commands.length >= 6, "expected_hud_missing", "Expected HUD command matchers must exist.");
check((fixture.expected?.model_calls ?? []).length === 0, "expected_model_calls_nonempty", "expected.model_calls must be empty.");
check((fixture.expected?.memory_writes ?? []).length === 0, "expected_memory_writes_nonempty", "expected.memory_writes must be empty.");
check(fixture.metrics?.max_llm_calls === 0, "llm_budget_nonzero", "metrics.max_llm_calls must be 0.");
check(fixture.metrics?.max_vlm_calls === 0, "vlm_budget_nonzero", "metrics.max_vlm_calls must be 0.");
check(fixture.metrics?.max_cost_usd === 0, "cost_budget_nonzero", "metrics.max_cost_usd must be 0.");
check(Array.isArray(fixture.metrics?.browser_latency_records) && fixture.metrics.browser_latency_records.length >= 6, "browser_latency_missing", "browser latency records must exist.");

checkEvents(fixture.input_events ?? []);
checkLatency(fixture.metrics?.browser_latency_records ?? []);
checkNoModelCalls(fixture);
checkNoRawMedia(fixture);
runReplayRepeat3();

report.replay_compatible_except_physical_provenance = failures.length === 0;
report.gate_1c_satisfiable = false;
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
    check(event.type !== "agent.escalation_requested", "model_call_event_forbidden", `Model escalation event is forbidden: ${event.id}.`);
    check(event.evidence?.every((item) => item.contains_raw_media === false), "evidence_raw_media_invalid", `Event ${event.id} evidence must contain no raw media.`);
    check(event.evidence?.every((item) => ["human_correction", "local_signal", "derived_state"].includes(item.kind)), "evidence_kind_invalid", `Event ${event.id} evidence kind must disclose manual/local/derived evidence.`);
  }
}

function checkLatency(records) {
  for (const [index, record] of records.entries()) {
    check(Number(record.end_to_end_ms) >= 0, "latency_invalid", `Latency record ${index} missing end_to_end_ms.`);
    check((record.llm_calls ?? 0) === 0, "latency_llm_nonzero", `Latency record ${index} has nonzero llm_calls.`);
    check((record.vlm_calls ?? 0) === 0, "latency_vlm_nonzero", `Latency record ${index} has nonzero vlm_calls.`);
    check((record.raw_media_persistence_count ?? 0) === 0, "latency_raw_media_nonzero", `Latency record ${index} has raw media persistence.`);
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
    fail("replay_repeat_failed", `Replay repeat 3 failed: ${(replay.stdout || replay.stderr || "").trim()}`);
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
  report.failure_count = failures.length;
  report.final_verdict = failures.length === 0 ? "DEV_TRACE_VALID" : "FAIL";
  mkdirSync("runs", { recursive: true });
  writeFileSync("runs/dev-trace-validate-latest.json", `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) {
    console.error(`${report.final_verdict} dev dry-run trace validation`);
    console.error("report: runs/dev-trace-validate-latest.json");
    for (const item of failures) console.error(`- ${item.code}: ${item.message}`);
    process.exit(1);
  }
  console.log("DEV_TRACE_VALID dev dry-run trace validation");
  console.log("report: runs/dev-trace-validate-latest.json");
  console.log("gate_1c_satisfiable=false");
}
