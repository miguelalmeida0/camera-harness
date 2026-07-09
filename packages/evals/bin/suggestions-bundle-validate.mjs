#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_BUNDLE_PATH = "runs/live/darkquest_suggestion_trace_campaign_bundle.json";
const OUTPUT_PATH = "runs/suggestions-bundle-validate-latest.json";
const REQUIRED_TRACES = [
  { key: "live_suggestion_phone_moved_001", accepted: true, rejected: false },
  { key: "live_suggestion_notebook_opened_001", accepted: true, rejected: false },
  { key: "live_suggestion_pen_picked_up_001", accepted: true, rejected: false },
  { key: "live_suggestion_writing_motion_001", accepted: true, rejected: false },
  { key: "live_suggestion_typing_motion_001", accepted: true, rejected: false },
  { key: "live_suggestion_reject_does_not_progress_001", accepted: false, rejected: true },
  { key: "live_suggestion_uncertain_scene_001", accepted: false, rejected: false },
  { key: "live_suggestion_full_focus_ritual_001", accepted: true, rejected: false }
];
const FORBIDDEN_CLAIMS = [
  "autonomous vision",
  "automatic action recognition",
  "camera understands your task",
  "object detection proven",
  "gesture recognition proven",
  "production perception",
  "ai sees what you are doing",
  "vlm-powered",
  "cloud vision"
];

const inputPath = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? DEFAULT_BUNDLE_PATH;
const report = {
  schema: "darkquest.suggestions_bundle_validate_report.v0",
  generated_at: new Date().toISOString(),
  input_path: inputPath,
  expected_trace_keys: REQUIRED_TRACES.map((trace) => trace.key),
  present_trace_keys: [],
  missing_trace_keys: [],
  trace_results: [],
  total_auto_completed_steps: 0,
  bundle_can_satisfy_gate_3b_live: false,
  bundle_gate_note: "A campaign bundle is an import source only; split it into individual fixtures before running Gate 3B-Live.",
  checks: [],
  next_action: "",
  verdict: "BUNDLE_INVALID"
};

if (!existsSync(resolve(inputPath))) {
  report.missing_trace_keys = [...report.expected_trace_keys];
  addCheck("bundle", "bundle_exists", inputPath, false, "missing bundle", "info");
  finish("BUNDLE_MISSING_TRACES");
}

const bundleResult = loadJson(inputPath);
addCheck("bundle", "valid_json", inputPath, bundleResult.ok, bundleResult.ok ? "valid JSON" : bundleResult.error, "critical");
if (!bundleResult.ok) finish("BUNDLE_INVALID");

const bundle = bundleResult.value;
const traceEntries = normalizeTraceEntries(bundle);
const traceByKey = new Map();
for (const entry of traceEntries) {
  if (traceByKey.has(entry.key)) addCheck("bundle", "duplicate_trace_key", entry.key, false, "duplicate trace key", "critical");
  else traceByKey.set(entry.key, entry);
}

report.present_trace_keys = [...traceByKey.keys()].sort();
report.missing_trace_keys = REQUIRED_TRACES.map((trace) => trace.key).filter((key) => !traceByKey.has(key));
report.total_auto_completed_steps = traceEntries.reduce((sum, entry) => sum + Number(entry.fixture?.suggestion_summary?.auto_completed_steps ?? 0), 0);
for (const key of report.missing_trace_keys) addCheck("bundle", "required_trace_key_present", key, false, "missing expected trace key", "info");

addCheck("privacy", "symbolic_only", inputPath, !containsRawMedia(bundle), "no raw frames/screenshots/base64/audio/OCR/notebook text", "critical");
addCheck("model", "no_llm_vlm_or_cloud_calls", inputPath, !containsModelCall(bundle), "no LLM/VLM/cloud model calls", "critical");
addCheck("claims", "no_autonomous_claims", inputPath, !containsForbiddenClaim(bundle), "no autonomous vision claims", "critical");

for (const required of REQUIRED_TRACES) {
  const entry = traceByKey.get(required.key);
  if (!entry) continue;
  const traceResult = validateTrace(entry.fixture, required);
  report.trace_results.push({
    trace_key: required.key,
    failure_codes: traceResult.failure_codes,
    suggestion_summary_present: traceResult.suggestion_summary_present,
    auto_completed_steps: traceResult.auto_completed_steps
  });
  addCheck("trace", "trace_is_safe_import_source", required.key, traceResult.failure_codes.length === 0, traceResult.failure_codes.join(",") || "safe", "critical");
}

addCheck("suggestion", "total_auto_completed_steps_zero", "campaign bundle", report.total_auto_completed_steps === 0, String(report.total_auto_completed_steps), "critical");
addCheck("gate", "bundle_requires_split_for_gate_3b_live", inputPath, report.bundle_can_satisfy_gate_3b_live === false, "split into individual fixtures before gate", "info");

const invalid = report.checks.some((check) => !check.passed && check.severity === "critical");
if (invalid) finish("BUNDLE_INVALID");
if (report.missing_trace_keys.length > 0) finish("BUNDLE_MISSING_TRACES");
finish("BUNDLE_VALID");

function validateTrace(fixture, required) {
  const failureCodes = [];
  const summary = fixture?.suggestion_summary;
  const autoCompletedSteps = Number(summary?.auto_completed_steps ?? 0);
  if (!fixture || fixture.schema !== "darkquest.replay_fixture.v0") failureCodes.push("trace_schema_invalid");
  if (!summary || typeof summary !== "object") failureCodes.push("suggestion_summary_missing");
  if (autoCompletedSteps !== 0) failureCodes.push("auto_completed_steps_nonzero");
  if ((summary?.llm_calls ?? 0) !== 0 || (summary?.vlm_calls ?? 0) !== 0) failureCodes.push("unexpected_model_call");
  if ((summary?.raw_media_persistence_count ?? summary?.raw_media_persistence ?? 0) !== 0) failureCodes.push("raw_media_persistence_violation");
  if (containsRawMedia(fixture)) failureCodes.push("raw_media_persistence_violation");
  if (containsModelCall(fixture)) failureCodes.push("unexpected_model_call");
  if (containsForbiddenClaim(fixture)) failureCodes.push("forbidden_autonomous_vision_claim");

  if (required.accepted && Number(summary?.suggestions_accepted ?? 0) < 1) failureCodes.push("accepted_suggestion_missing");
  if (required.rejected && Number(summary?.suggestions_rejected ?? 0) < 1) failureCodes.push("rejected_suggestion_missing");

  const acceptedEvents = acceptedSuggestionEvents(fixture);
  if (required.accepted && acceptedEvents.length === 0) failureCodes.push("accepted_suggestion_missing_suggestion_id");
  for (const event of acceptedEvents) {
    if (!event.payload?.accepted_from_suggestion_id) failureCodes.push("accepted_suggestion_missing_suggestion_id");
    if (!eventHasEvidence(event, "local_signal")) failureCodes.push("accepted_suggestion_missing_local_signal");
    if (!eventHasEvidence(event, "human_correction")) failureCodes.push("accepted_suggestion_missing_human_correction");
    if (event.payload?.detection_method !== "motion_proxy") failureCodes.push("accepted_suggestion_missing_motion_proxy");
    if (event.payload?.suggestion_only === true) failureCodes.push("suggestion_auto_completed_without_confirmation");
  }

  if (required.rejected && ((fixture?.expected?.quest_transitions ?? []).length > 0 || summary?.rejected_suggestion_progressed_quest === true)) {
    failureCodes.push("rejected_suggestion_progressed_quest");
  }

  return {
    suggestion_summary_present: Boolean(summary && typeof summary === "object"),
    auto_completed_steps: autoCompletedSteps,
    failure_codes: [...new Set(failureCodes)]
  };
}

function normalizeTraceEntries(bundle) {
  const source = Array.isArray(bundle?.traces)
    ? bundle.traces.map((trace) => [trace.trace_key ?? trace.key ?? trace.fixture_id, trace])
    : bundle?.traces && typeof bundle.traces === "object"
      ? Object.entries(bundle.traces)
      : Array.isArray(bundle?.fixtures)
        ? bundle.fixtures.map((trace) => [trace.trace_key ?? trace.key ?? trace.fixture_id, trace])
        : [];
  return source.map(([rawKey, value]) => {
    const fixture = value?.fixture ?? value?.trace ?? value?.replay_fixture ?? value;
    const key = normalizeKey(rawKey ?? fixture?.fixture_id ?? fixture?.trace_id ?? value?.path);
    return { key, wrapper: value, fixture };
  }).filter((entry) => entry.key);
}

function acceptedSuggestionEvents(fixture) {
  return (fixture?.input_events ?? []).filter((event) => event?.payload?.accepted_from_suggestion_id || event?.payload?.suggestion_only === true || event?.payload?.detection_method === "motion_proxy");
}

function eventHasEvidence(event, kind) {
  return (event?.evidence ?? []).some((evidence) => evidence?.kind === kind && evidence?.contains_raw_media === false);
}

function normalizeKey(value) {
  return String(value ?? "").split("/").pop().replace(/\.v0\.json$/, "").replace(/\.json$/, "");
}

function loadJson(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(resolve(path), "utf8")) };
  } catch (error) {
    return { ok: false, error: error?.message ?? "JSON load failed" };
  }
}

function containsRawMedia(value) {
  return scan(value, (key, item) => {
    const normalizedKey = key.toLowerCase();
    if (["contains_raw_video", "contains_audio", "raw_media_persisted"].includes(normalizedKey)) return item !== false;
    if (["raw_media_persistence", "raw_media_persistence_count"].includes(normalizedKey)) return Number(item ?? 0) !== 0;
    if (/raw_frame|frame_bytes|image_bytes|video_bytes|raw_audio|audio_bytes|base64|screenshot|notebook_text|ocr/i.test(normalizedKey)) return true;
    return typeof item === "string" && /data:image|data:video|data:audio|base64|raw frame|raw video|raw audio|screenshot|notebook text|ocr/i.test(item);
  });
}

function containsModelCall(value) {
  return scan(value, (key, item) => {
    const normalizedKey = key.toLowerCase();
    if (["llm_calls", "vlm_calls"].includes(normalizedKey)) return Number(item ?? 0) !== 0;
    if (normalizedKey === "cloud_calls_expected") return item !== false;
    if (normalizedKey === "model_calls" && Array.isArray(item)) return item.length > 0;
    return false;
  });
}

function containsForbiddenClaim(value) {
  return scan(value, (_key, item) => typeof item === "string" && FORBIDDEN_CLAIMS.some((claim) => item.toLowerCase().includes(claim)));
}

function scan(value, predicate, key = "") {
  if (predicate(key, value)) return true;
  if (Array.isArray(value)) return value.some((item, index) => scan(item, predicate, `${key}.${index}`));
  if (value && typeof value === "object") return Object.entries(value).some(([childKey, child]) => scan(child, predicate, childKey));
  return false;
}

function addCheck(category, code, name, passed, evidence, severity) {
  report.checks.push({ category, code, name, passed, evidence, severity });
}

function finish(verdict) {
  report.verdict = verdict;
  report.ready_for_split = verdict === "BUNDLE_VALID";
  report.next_action = nextAction(verdict);
  mkdirSync("runs", { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${verdict} suggestion trace campaign bundle`);
  console.log(`report: ${OUTPUT_PATH}`);
  console.log(`bundle: ${inputPath}`);
  console.log(`present trace keys: ${report.present_trace_keys.length}`);
  console.log(`missing trace keys: ${report.missing_trace_keys.length}`);
  if (report.missing_trace_keys.length) {
    for (const key of report.missing_trace_keys) console.log(`- ${key}`);
  }
  console.log("bundle cannot satisfy Gate 3B-Live until split into individual fixtures");
  process.exit(verdict === "BUNDLE_INVALID" ? 1 : 0);
}

function nextAction(verdict) {
  if (verdict === "BUNDLE_VALID") return "Run `npm run suggestions:bundle:split -- --dry-run`; if the plan is correct, rerun with `--force` only when overwriting is intended.";
  if (verdict === "BUNDLE_MISSING_TRACES") return "Capture or export the complete Suggestion Trace Campaign bundle, then rerun `npm run suggestions:bundle:validate`.";
  return "Fix unsafe or malformed bundle content before splitting or running Gate 3B-Live.";
}
