#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_BUNDLE_PATH = "runs/live/darkquest_suggestion_trace_campaign_bundle.json";
const OUTPUT_DIR = "fixtures/replay/live/suggestions";
const OUTPUT_REPORT_PATH = "runs/suggestions-bundle-split-latest.json";
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const inputPath = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? DEFAULT_BUNDLE_PATH;
const REQUIRED_TRACES = [
  "live_suggestion_phone_moved_001",
  "live_suggestion_notebook_opened_001",
  "live_suggestion_pen_picked_up_001",
  "live_suggestion_writing_motion_001",
  "live_suggestion_typing_motion_001",
  "live_suggestion_reject_does_not_progress_001",
  "live_suggestion_uncertain_scene_001",
  "live_suggestion_full_focus_ritual_001"
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

const report = {
  schema: "darkquest.suggestions_bundle_split_report.v0",
  generated_at: new Date().toISOString(),
  input_path: inputPath,
  output_dir: OUTPUT_DIR,
  dry_run: DRY_RUN,
  force: FORCE,
  expected_trace_keys: REQUIRED_TRACES,
  missing_trace_keys: [],
  planned_files: [],
  files_written: [],
  refused_reasons: [],
  verdict: "SPLIT_REFUSED"
};

if (!existsSync(resolve(inputPath))) {
  report.missing_trace_keys = [...REQUIRED_TRACES];
  report.refused_reasons.push("campaign bundle missing");
  finish("BUNDLE_MISSING_TRACES", 0);
}

const bundleResult = loadJson(inputPath);
if (!bundleResult.ok) {
  report.refused_reasons.push(`invalid JSON: ${bundleResult.error}`);
  finish("SPLIT_REFUSED_INVALID_BUNDLE", 1);
}

const bundle = bundleResult.value;
const traceEntries = normalizeTraceEntries(bundle);
const traceByKey = new Map();
for (const entry of traceEntries) {
  if (traceByKey.has(entry.key)) report.refused_reasons.push(`duplicate trace key: ${entry.key}`);
  else traceByKey.set(entry.key, entry);
}

report.missing_trace_keys = REQUIRED_TRACES.filter((key) => !traceByKey.has(key));
if (report.missing_trace_keys.length > 0) report.refused_reasons.push("required trace keys missing");
if (containsRawMedia(bundle)) report.refused_reasons.push("raw media/audio/screenshot/base64/OCR/notebook text detected");
if (containsModelCall(bundle)) report.refused_reasons.push("LLM/VLM/cloud model call detected");
if (containsForbiddenClaim(bundle)) report.refused_reasons.push("autonomous vision claim detected");
if (sumAutoCompletedSteps(traceEntries) !== 0) report.refused_reasons.push("auto_completed_steps must be 0 across all bundle traces");

for (const key of REQUIRED_TRACES) {
  const entry = traceByKey.get(key);
  if (!entry) continue;
  if (!entry.fixture?.suggestion_summary) report.refused_reasons.push(`${key}: suggestion_summary missing`);
  if (isDevDryRun(entry)) report.refused_reasons.push(`${key}: dev dry-run trace`);
  if (!hasPhysicalCapture(entry)) report.refused_reasons.push(`${key}: trace_origin.physical_capture is not true`);
  if (!hasOperatorConfirmation(entry)) report.refused_reasons.push(`${key}: operator confirmation missing`);
  report.planned_files.push({
    trace_key: key,
    path: outputPathForKey(key),
    would_overwrite: existsSync(resolve(outputPathForKey(key)))
  });
}

const overwriteRefusals = report.planned_files.filter((file) => file.would_overwrite && !FORCE);
for (const file of overwriteRefusals) report.refused_reasons.push(`${file.path}: exists; use --force to overwrite`);

if (report.refused_reasons.length > 0) finish("SPLIT_REFUSED", inputPath === DEFAULT_BUNDLE_PATH && !existsSync(resolve(inputPath)) ? 0 : 1);
if (DRY_RUN) finish("SPLIT_DRY_RUN_OK", 0);

mkdirSync(resolve(OUTPUT_DIR), { recursive: true });
for (const key of REQUIRED_TRACES) {
  const entry = traceByKey.get(key);
  const outputPath = outputPathForKey(key);
  writeFileSync(resolve(outputPath), `${JSON.stringify(entry.fixture, null, 2)}\n`);
  report.files_written.push(outputPath);
}
finish("SPLIT_COMPLETE", 0);

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

function outputPathForKey(key) {
  return `${OUTPUT_DIR}/${key}.v0.json`;
}

function hasPhysicalCapture(entry) {
  return entry.wrapper?.physical_capture === true || entry.wrapper?.trace_origin?.physical_capture === true || entry.fixture?.trace_origin?.physical_capture === true;
}

function hasOperatorConfirmation(entry) {
  return entry.wrapper?.operator_confirmed === true || entry.wrapper?.trace_origin?.operator_confirmed === true || entry.fixture?.operator_confirmed === true || entry.fixture?.trace_origin?.operator_confirmed === true;
}

function isDevDryRun(entry) {
  const originValues = [entry.wrapper?.capture_mode, entry.wrapper?.trace_origin?.capture_mode, entry.fixture?.capture_mode, entry.fixture?.trace_origin?.capture_mode];
  return entry.wrapper?.dev_dry_run === true || entry.wrapper?.trace_origin?.dev_dry_run === true || entry.fixture?.dev_dry_run === true || entry.fixture?.trace_origin?.dev_dry_run === true || originValues.some((value) => typeof value === "string" && value.toLowerCase().includes("dry"));
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

function sumAutoCompletedSteps(traceEntries) {
  return traceEntries.reduce((sum, entry) => sum + Number(entry.fixture?.suggestion_summary?.auto_completed_steps ?? 0), 0);
}

function scan(value, predicate, key = "") {
  if (predicate(key, value)) return true;
  if (Array.isArray(value)) return value.some((item, index) => scan(item, predicate, `${key}.${index}`));
  if (value && typeof value === "object") return Object.entries(value).some(([childKey, child]) => scan(child, predicate, childKey));
  return false;
}

function finish(verdict, exitCode) {
  report.verdict = verdict;
  report.next_action = nextAction(verdict);
  mkdirSync("runs", { recursive: true });
  writeFileSync(OUTPUT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${verdict} suggestion trace campaign bundle split`);
  console.log(`report: ${OUTPUT_REPORT_PATH}`);
  console.log(`bundle: ${inputPath}`);
  if (report.planned_files.length) {
    console.log(DRY_RUN ? "files planned:" : "files written:");
    const files = DRY_RUN ? report.planned_files.map((file) => file.path) : report.files_written;
    for (const file of files) console.log(`- ${file}`);
  }
  if (report.refused_reasons.length) {
    console.log("refused reasons:");
    for (const reason of report.refused_reasons) console.log(`- ${reason}`);
  }
  console.log("After a successful split, run `npm run gate:3b:live`.");
  process.exit(exitCode);
}

function nextAction(verdict) {
  if (verdict === "SPLIT_DRY_RUN_OK") return "Review planned files, then rerun without `--dry-run` if the import is correct.";
  if (verdict === "SPLIT_COMPLETE") return "Run `npm run gate:3b:live`.";
  if (verdict === "BUNDLE_MISSING_TRACES") return "Export `runs/live/darkquest_suggestion_trace_campaign_bundle.json`, then rerun the splitter.";
  return "Fix refused reasons before splitting the campaign bundle.";
}
