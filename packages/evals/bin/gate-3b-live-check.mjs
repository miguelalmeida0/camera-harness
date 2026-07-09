#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST_PATH = "fixtures/replay/gate_3b_live_manifest.json";
const GATE_REPORT_PATH = "runs/gate-3b-live-latest.json";
const SUGGESTIONS_VALIDATE_REPORT_PATH = "runs/suggestions-validate-latest.json";
const OPTIONAL_BUNDLE_PATH = "runs/live/darkquest_suggestion_trace_campaign_bundle.json";
const REPEAT = 3;
const PRESENT_ONLY = process.argv.includes("--present-only");
const MISSING_TRACE_FIX_STEPS = [
  "Run `npm run physical:capture`",
  "Select Suggestion Trace Campaign",
  "Export each trace",
  "Save files under `fixtures/replay/live/suggestions/`",
  "Run `npm run suggestions:validate`",
  "Run `npm run gate:3b:live`"
];
const REQUIRED_TRACES = [
  "fixtures/replay/live/suggestions/live_suggestion_phone_moved_001.v0.json",
  "fixtures/replay/live/suggestions/live_suggestion_notebook_opened_001.v0.json",
  "fixtures/replay/live/suggestions/live_suggestion_pen_picked_up_001.v0.json",
  "fixtures/replay/live/suggestions/live_suggestion_writing_motion_001.v0.json",
  "fixtures/replay/live/suggestions/live_suggestion_typing_motion_001.v0.json",
  "fixtures/replay/live/suggestions/live_suggestion_reject_does_not_progress_001.v0.json",
  "fixtures/replay/live/suggestions/live_suggestion_uncertain_scene_001.v0.json",
  "fixtures/replay/live/suggestions/live_suggestion_full_focus_ritual_001.v0.json"
];
const EXPECTED_ADVERSARIAL = {
  "fixtures/replay/live/suggestions/adversarial/suggestion_auto_completes_without_confirmation.v0.json": "suggestion_auto_completed_without_confirmation",
  "fixtures/replay/live/suggestions/adversarial/suggestion_reject_progresses_quest.v0.json": "rejected_suggestion_progressed_quest",
  "fixtures/replay/live/suggestions/adversarial/suggestion_accept_missing_human_correction.v0.json": "accepted_suggestion_missing_human_correction",
  "fixtures/replay/live/suggestions/adversarial/suggestion_accept_missing_local_signal.v0.json": "accepted_suggestion_missing_local_signal",
  "fixtures/replay/live/suggestions/adversarial/suggestion_accept_missing_suggestion_id.v0.json": "accepted_suggestion_missing_suggestion_id",
  "fixtures/replay/live/suggestions/adversarial/suggestion_raw_media_violation.v0.json": "raw_media_persistence_violation",
  "fixtures/replay/live/suggestions/adversarial/suggestion_model_call_violation.v0.json": "unexpected_model_call",
  "fixtures/replay/live/suggestions/adversarial/suggestion_autonomous_vision_claim.v0.json": "forbidden_autonomous_vision_claim",
  "fixtures/replay/live/suggestions/adversarial/suggestion_future_step_bypass.v0.json": "future_step_suggestion_bypassed_order",
  "fixtures/replay/live/suggestions/adversarial/suggestion_auto_completed_steps_nonzero.v0.json": "auto_completed_steps_nonzero",
  "fixtures/replay/live/suggestions/adversarial/suggestion_missing_summary.v0.json": "suggestion_summary_missing",
  "fixtures/replay/live/suggestions/adversarial/suggestion_missing_motion_proxy.v0.json": "accepted_suggestion_missing_motion_proxy"
};
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
  schema: PRESENT_ONLY ? "darkquest.suggestions_validate_report.v0" : "darkquest.gate_3b_live_report.v0",
  gate: "3B-Live",
  mode: PRESENT_ONLY ? "present_only" : "gate",
  claim: "Physical browser sessions can produce suggestion traces that replay safely, preserve confirmation gating, reject unsafe progression, keep zero raw media/model calls, and avoid autonomous vision claims.",
  generated_at: new Date().toISOString(),
  manifest_path: MANIFEST_PATH,
  optional_campaign_bundle_path: OPTIONAL_BUNDLE_PATH,
  required_traces: REQUIRED_TRACES,
  missing_traces: [],
  present_traces: [],
  unsafe_traces: [],
  trace_results: [],
  adversarial_results: [],
  missing_trace_recovery: {
    to_fix: MISSING_TRACE_FIX_STEPS,
    optional_campaign_bundle_path: OPTIONAL_BUNDLE_PATH,
    optional_campaign_bundle_note: "A campaign bundle is an import source only; it cannot satisfy Gate 3B-Live until split into individual replay fixtures."
  },
  checks: [],
  ready_for_gate_3b_live: false,
  next_action: "",
  final_verdict: "FAIL"
};

const manifestResult = safeLoadJson(MANIFEST_PATH);
addCheck("manifest", "manifest_exists", MANIFEST_PATH, manifestResult.ok, manifestResult.ok ? "present" : manifestResult.error, "critical");
const manifest = manifestResult.ok ? manifestResult.value : { required_traces: [], adversarial_traces: [] };

checkPackageWiring();
checkManifestShape();
checkRequiredTraces();
checkAdversarialTraces();

const failures = report.checks.filter((check) => !check.passed && check.severity !== "info");
report.failure_count = failures.length;
report.failures = failures;

if (!PRESENT_ONLY && report.missing_traces.length > 0) {
  report.final_verdict = "BLOCKED_MISSING_SUGGESTION_TRACES";
} else if (failures.length > 0) {
  report.final_verdict = "FAIL";
} else if (PRESENT_ONLY && report.missing_traces.length > 0) {
  report.final_verdict = "PRESENT_TRACES_VALID_MISSING_REQUIRED";
} else {
  report.final_verdict = "PASS_WITH_DISCLOSURE";
}

report.ready_for_gate_3b_live = report.final_verdict === "PASS_WITH_DISCLOSURE" && report.missing_traces.length === 0 && report.unsafe_traces.length === 0;
report.next_action = nextAction(report);

mkdirSync("runs", { recursive: true });
const reportPath = PRESENT_ONLY ? SUGGESTIONS_VALIDATE_REPORT_PATH : GATE_REPORT_PATH;
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.final_verdict} Gate 3B-Live suggestion trace check`);
console.log(`report: ${reportPath}`);
console.log(`checks: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}`);
console.log(`missing suggestion traces: ${report.missing_traces.length}`);
if (report.missing_traces.length) {
  console.log("missing trace paths:");
  for (const tracePath of report.missing_traces) console.log(`- ${tracePath}`);
  console.log("To fix:");
  MISSING_TRACE_FIX_STEPS.forEach((step, index) => console.log(`${index + 1}. ${step}`));
  console.log(`Optional campaign bundle path: ${OPTIONAL_BUNDLE_PATH}`);
  console.log("Optional bundle workflow: run `npm run suggestions:bundle:validate`, then `npm run suggestions:bundle:split -- --dry-run` before splitting.");
}
if (report.unsafe_traces.length) {
  console.log("unsafe present traces:");
  for (const trace of report.unsafe_traces) console.log(`- ${trace.path}: ${trace.failure_codes.join(",") || `replay_status=${trace.replay_status}`}`);
}
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure.category}.${failure.code}: ${failure.name}`);
}

process.exit(report.final_verdict === "FAIL" ? 1 : 0);

function checkPackageWiring() {
  const packageResult = safeLoadJson("package.json");
  const scripts = packageResult.ok ? packageResult.value.scripts ?? {} : {};
  addCheck("source", "gate_3b_script", "npm run gate:3b", typeof scripts["gate:3b"] === "string", "package script", "critical");
  addCheck("source", "gate_3b_live_script", "npm run gate:3b:live", typeof scripts["gate:3b:live"] === "string", "package script", "critical");
  addCheck("source", "suggestions_validate_script", "npm run suggestions:validate", typeof scripts["suggestions:validate"] === "string", "package script", "critical");
  addCheck("source", "suggestions_report_script", "npm run suggestions:report", typeof scripts["suggestions:report"] === "string", "package script", "critical");
  addCheck("source", "suggestions_bundle_validate_script", "npm run suggestions:bundle:validate", typeof scripts["suggestions:bundle:validate"] === "string", "package script", "critical");
  addCheck("source", "suggestions_bundle_split_script", "npm run suggestions:bundle:split", typeof scripts["suggestions:bundle:split"] === "string", "package script", "critical");
  addCheck("source", "typecheck_includes_gate_3b_live", "typecheck includes gate-3b-live-check.mjs", scripts.typecheck?.includes("gate-3b-live-check.mjs") === true, "typecheck script", "critical");
  addCheck("source", "typecheck_includes_bundle_validator", "typecheck includes suggestions-bundle-validate.mjs", scripts.typecheck?.includes("suggestions-bundle-validate.mjs") === true, "typecheck script", "critical");
  addCheck("source", "typecheck_includes_bundle_splitter", "typecheck includes suggestions-bundle-split.mjs", scripts.typecheck?.includes("suggestions-bundle-split.mjs") === true, "typecheck script", "critical");
}

function checkManifestShape() {
  const required = manifest.required_traces;
  const adversarial = manifest.adversarial_traces;
  addCheck("manifest", "required_trace_list_exists", "required_traces array", Array.isArray(required), "manifest.required_traces", "critical");
  addCheck("manifest", "adversarial_list_exists", "adversarial_traces array", Array.isArray(adversarial), "manifest.adversarial_traces", "critical");
  addCheck("manifest", "required_trace_list_exact", "required trace list is canonical", sameSet(required ?? [], REQUIRED_TRACES), "canonical required traces", "critical");
  const actualAdversarial = Object.fromEntries((adversarial ?? []).map((entry) => [entry.path, entry.expected_failure_code]));
  for (const [path, expectedCode] of Object.entries(EXPECTED_ADVERSARIAL)) {
    addCheck("manifest", "adversarial_expected_code_listed", path, actualAdversarial[path] === expectedCode, `expected ${expectedCode}`, "critical");
  }
}

function checkRequiredTraces() {
  for (const tracePath of REQUIRED_TRACES) {
    const exists = existsSync(resolve(tracePath));
    if (!exists) {
      report.missing_traces.push(tracePath);
      addCheck("required_trace", "trace_exists", tracePath, false, "missing", "info");
      continue;
    }
    report.present_traces.push(tracePath);
    const loaded = safeLoadJson(tracePath);
    addCheck("required_trace", "valid_json", tracePath, loaded.ok, loaded.ok ? "valid JSON" : loaded.error, "critical");
    if (!loaded.ok) {
      report.unsafe_traces.push({ path: tracePath, replay_status: null, failure_codes: ["invalid_json"] });
      continue;
    }
    const fixture = loaded.value;
    const result = evaluateSuggestionFixture(fixture, {
      acceptedRequired: !tracePath.includes("reject") && !tracePath.includes("uncertain"),
      rejectedRequired: tracePath.includes("reject"),
      rejectedTrace: tracePath.includes("reject")
    });
    const replay = runReplay(tracePath);
    const passed = result.failure_codes.length === 0 && replay.status === 0;
    report.trace_results.push({
      path: tracePath,
      replay_status: replay.status,
      replay_repeat: REPEAT,
      failure_codes: result.failure_codes
    });
    if (!passed) {
      report.unsafe_traces.push({ path: tracePath, replay_status: replay.status, failure_codes: result.failure_codes });
    }
    addCheck("required_trace", "trace_safety", tracePath, passed, `${result.failure_codes.join(",") || "safe"}; replay_status=${replay.status}`, "critical");
  }
}

function checkAdversarialTraces() {
  for (const [path, expectedCode] of Object.entries(EXPECTED_ADVERSARIAL)) {
    const exists = existsSync(resolve(path));
    addCheck("adversarial", "fixture_exists", path, exists, exists ? "present" : "missing", "critical");
    if (!exists) continue;
    const loaded = safeLoadJson(path);
    addCheck("adversarial", "valid_json", path, loaded.ok, loaded.ok ? "valid JSON" : loaded.error, "critical");
    if (!loaded.ok) continue;
    const result = evaluateSuggestionFixture(loaded.value, { acceptedRequired: false, rejectedRequired: false, rejectedTrace: false });
    const passed = result.failure_codes.includes(expectedCode);
    report.adversarial_results.push({ path, expected_failure_code: expectedCode, failure_codes: result.failure_codes, passed });
    addCheck("adversarial", "expected_failure_code", expectedCode, passed, result.failure_codes.join(",") || "no failure", "critical");
  }
}

function evaluateSuggestionFixture(fixture, options) {
  const failureCodes = [];
  if (!fixture || fixture.schema !== "darkquest.replay_fixture.v0") failureCodes.push("trace_schema_invalid");
  const summary = fixture?.suggestion_summary;
  if (!summary || typeof summary !== "object") failureCodes.push("suggestion_summary_missing");
  if (summary && (summary.suggestions_generated ?? 0) < 1) failureCodes.push("suggestions_not_generated");
  if (options.acceptedRequired && (summary?.suggestions_accepted ?? 0) < 1) failureCodes.push("accepted_suggestion_missing");
  if (options.rejectedRequired && (summary?.suggestions_rejected ?? 0) < 1) failureCodes.push("rejected_suggestion_missing");
  if ((summary?.auto_completed_steps ?? 0) !== 0) failureCodes.push("auto_completed_steps_nonzero");
  if (summary?.confirmation_required === false) failureCodes.push("suggestion_auto_completed_without_confirmation");
  if (summary?.future_step_bypassed_order === true) failureCodes.push("future_step_suggestion_bypassed_order");
  const rejectedSuggestionProgressed = summary?.rejected_suggestion_progressed_quest === true
    || (
      options.rejectedTrace
      && (summary?.suggestions_rejected ?? 0) > 0
      && summary?.rejected_suggestion_progressed_quest !== false
      && (fixture?.expected?.quest_transitions ?? []).length > 0
    );
  if (rejectedSuggestionProgressed) {
    failureCodes.push("rejected_suggestion_progressed_quest");
  }
  if ((summary?.llm_calls ?? 0) !== 0 || (summary?.vlm_calls ?? 0) !== 0 || (fixture?.metrics?.max_llm_calls ?? 0) !== 0 || (fixture?.metrics?.max_vlm_calls ?? 0) !== 0 || (fixture?.expected?.model_calls ?? []).length > 0) {
    failureCodes.push("unexpected_model_call");
  }
  if (fixture?.privacy?.contains_raw_video !== false || fixture?.trace_origin?.raw_media_persisted !== false || (summary?.raw_media_persistence_count ?? summary?.raw_media_persistence ?? 0) !== 0 || containsRawMedia(fixture)) {
    failureCodes.push("raw_media_persistence_violation");
  }
  if (containsForbiddenClaim(fixture)) failureCodes.push("forbidden_autonomous_vision_claim");

  const acceptedEvents = (fixture?.input_events ?? []).filter((event) => event?.payload?.accepted_from_suggestion_id || event?.payload?.suggestion_only === true || event?.payload?.detection_method === "motion_proxy");
  if ((summary?.suggestions_accepted ?? 0) > 0 && !acceptedEvents.some((event) => event?.payload?.accepted_from_suggestion_id)) {
    failureCodes.push("accepted_suggestion_missing_suggestion_id");
  }
  for (const event of acceptedEvents) {
    const evidence = event.evidence ?? [];
    const hasHuman = evidence.some((item) => item.kind === "human_correction" && item.contains_raw_media === false);
    const hasLocal = evidence.some((item) => item.kind === "local_signal" && item.contains_raw_media === false);
    if (event.payload?.suggestion_only === true) failureCodes.push("suggestion_auto_completed_without_confirmation");
    if (!hasHuman) failureCodes.push("accepted_suggestion_missing_human_correction");
    if (!hasLocal) failureCodes.push("accepted_suggestion_missing_local_signal");
    if (!event.payload?.accepted_from_suggestion_id) failureCodes.push("accepted_suggestion_missing_suggestion_id");
    if (event.payload?.detection_method !== "motion_proxy") failureCodes.push("accepted_suggestion_missing_motion_proxy");
  }
  return { failure_codes: [...new Set(failureCodes)] };
}

function runReplay(tracePath) {
  return spawnSync(process.execPath, ["packages/evals/bin/darkquest-eval.mjs", "replay", "--repeat", String(REPEAT), tracePath], {
    cwd: resolve("."),
    encoding: "utf8"
  });
}

function safeLoadJson(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(resolve(path), "utf8")) };
  } catch (error) {
    return { ok: false, error: error?.message ?? "JSON load failed" };
  }
}

function containsRawMedia(value) {
  return scan(value, (key, item) => (
    key === "contains_raw_media" && item !== false
  ) || /raw_frame|raw_video|raw_audio|base64|data:image|data:video|data:audio|screenshot|notebook_text|ocr/i.test(String(key)) || /data:image|data:video|data:audio|base64|screenshot|raw_frame|raw_video|raw_audio|notebook_text|ocr/i.test(String(item)));
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

function sameSet(a, b) {
  return Array.isArray(a) && a.length === b.length && b.every((item) => a.includes(item));
}

function addCheck(category, code, name, passed, evidence, severity) {
  report.checks.push({ category, code, name, passed, evidence, severity });
}

function nextAction(currentReport) {
  if (currentReport.unsafe_traces.length > 0) return "Fix unsafe present traces, then run `npm run suggestions:validate`.";
  if (currentReport.final_verdict === "FAIL") return "Fix failing Gate 3B-Live checks, then rerun `npm run gate:3b:live`.";
  if (currentReport.missing_traces.length > 0) {
    return "Run `npm run physical:capture`, select Suggestion Trace Campaign, export each required trace under `fixtures/replay/live/suggestions/`, then rerun `npm run gate:3b:live`.";
  }
  if (PRESENT_ONLY) return "Run `npm run gate:3b:live` for the canonical gate verdict.";
  return "Gate 3B-Live is ready with disclosure; keep cinematic demo work blocked until this report is reviewed.";
}
