#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = "fixtures/replay/live/suggestions";
const MANIFEST_PATH = "fixtures/replay/gate_3b_live_manifest.json";
const OUTPUT_PATH = "runs/suggestions-report-latest.json";
const OPTIONAL_BUNDLE_PATH = "runs/live/darkquest_suggestion_trace_campaign_bundle.json";

const manifest = readJson(MANIFEST_PATH) ?? { required_traces: [] };
const requiredTraces = manifest.required_traces ?? [];
const tracesFound = existsSync(resolve(ROOT)) ? listJson(ROOT) : [];
const liveTraces = tracesFound.filter((path) => !path.includes("/adversarial/"));
const missingRequiredTraces = requiredTraces.filter((path) => !existsSync(resolve(path)));
const presentRequiredTraces = requiredTraces.filter((path) => existsSync(resolve(path)));

const totals = {
  suggestions_generated: 0,
  suggestions_accepted: 0,
  suggestions_rejected: 0,
  auto_completed_steps: 0,
  llm_calls: 0,
  vlm_calls: 0,
  raw_media_count: 0
};
const perActionCounts = {};
const traceSummaries = [];

for (const path of liveTraces) {
  const fixture = readJson(path);
  const summary = fixture?.suggestion_summary ?? {};
  const action = actionFromPath(path);
  perActionCounts[action] ??= { traces: 0, suggestions_generated: 0, accepted: 0, rejected: 0 };
  perActionCounts[action].traces += 1;
  perActionCounts[action].suggestions_generated += Number(summary.suggestions_generated ?? 0);
  perActionCounts[action].accepted += Number(summary.suggestions_accepted ?? 0);
  perActionCounts[action].rejected += Number(summary.suggestions_rejected ?? 0);
  totals.suggestions_generated += Number(summary.suggestions_generated ?? 0);
  totals.suggestions_accepted += Number(summary.suggestions_accepted ?? 0);
  totals.suggestions_rejected += Number(summary.suggestions_rejected ?? 0);
  totals.auto_completed_steps += Number(summary.auto_completed_steps ?? 0);
  totals.llm_calls += Number(summary.llm_calls ?? 0);
  totals.vlm_calls += Number(summary.vlm_calls ?? 0);
  totals.raw_media_count += Number(summary.raw_media_persistence_count ?? summary.raw_media_persistence ?? 0);
  if (fixture?.privacy?.contains_raw_video !== false || fixture?.trace_origin?.raw_media_persisted !== false) totals.raw_media_count += 1;
  traceSummaries.push({
    path,
    action,
    suggestions_generated: Number(summary.suggestions_generated ?? 0),
    suggestions_accepted: Number(summary.suggestions_accepted ?? 0),
    suggestions_rejected: Number(summary.suggestions_rejected ?? 0),
    auto_completed_steps: Number(summary.auto_completed_steps ?? 0),
    llm_calls: Number(summary.llm_calls ?? 0),
    vlm_calls: Number(summary.vlm_calls ?? 0),
    raw_media_persistence_count: Number(summary.raw_media_persistence_count ?? summary.raw_media_persistence ?? 0)
  });
}

const readiness = missingRequiredTraces.length
  ? "blocked"
  : totals.auto_completed_steps || totals.llm_calls || totals.vlm_calls || totals.raw_media_count
    ? "fail"
    : "pass_with_disclosure";

const report = {
  schema: "darkquest.suggestions_report.v0",
  generated_at: new Date().toISOString(),
  root: ROOT,
  optional_campaign_bundle_path: OPTIONAL_BUNDLE_PATH,
  traces_found: tracesFound,
  live_traces_found: liveTraces,
  adversarial_traces_found: tracesFound.filter((path) => path.includes("/adversarial/")),
  present_required_traces: presentRequiredTraces,
  missing_required_traces: missingRequiredTraces,
  present_required_count: presentRequiredTraces.length,
  missing_required_count: missingRequiredTraces.length,
  totals,
  per_action_counts: perActionCounts,
  trace_summaries: traceSummaries,
  readiness_for_gate_3b_live: readiness,
  next_action: nextAction(readiness)
};

mkdirSync("runs", { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`suggestions report: ${OUTPUT_PATH}`);
console.log(`traces found: ${tracesFound.length}`);
console.log(`missing required traces: ${missingRequiredTraces.length}`);
console.log(`auto_completed_steps: ${totals.auto_completed_steps}`);
console.log(`llm/vlm calls: ${totals.llm_calls}/${totals.vlm_calls}`);
console.log(`raw media count: ${totals.raw_media_count}`);
console.log(`readiness_for_gate_3b_live: ${readiness}`);
console.log(`next action: ${report.next_action}`);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    return null;
  }
}

function listJson(dir) {
  const out = [];
  for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJson(path));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(path);
  }
  return out.sort();
}

function actionFromPath(path) {
  if (path.includes("phone_moved")) return "phone_moved";
  if (path.includes("notebook_opened")) return "notebook_opened";
  if (path.includes("pen_picked_up")) return "pen_picked_up";
  if (path.includes("writing_motion")) return "writing_motion";
  if (path.includes("typing_motion")) return "typing_motion";
  if (path.includes("reject")) return "reject";
  if (path.includes("uncertain")) return "uncertain_scene";
  if (path.includes("full_focus_ritual")) return "full_focus_ritual";
  return "unknown";
}

function nextAction(readiness) {
  if (readiness === "pass_with_disclosure") return "Run `npm run gate:3b:live` for the canonical gate verdict.";
  if (readiness === "fail") return "Fix unsafe present suggestion traces, then run `npm run suggestions:validate`.";
  return "Capture/export required suggestion traces under `fixtures/replay/live/suggestions/`, or validate a campaign bundle at `runs/live/darkquest_suggestion_trace_campaign_bundle.json`.";
}
