#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const VERSION = "gate-0b-replay-harness-v0";
const REPORT_SCHEMA = "darkquest.replay_report.v0";
const FIXTURE_SCHEMA = "darkquest.replay_fixture.v0";
const DEFAULT_GATE_0B_MANIFEST = "fixtures/replay/gate_0b_manifest.json";
const DEFAULT_GATE_1A_MANIFEST = "fixtures/replay/gate_1a_manifest.json";
const DEFAULT_GATE_1B_MANIFEST = "fixtures/replay/gate_1b_manifest.json";
const DEFAULT_GATE_1C_MANIFEST = "fixtures/replay/gate_1c_manifest.json";
const DEFAULT_PHYSICAL_TRACE_FIXTURE = "fixtures/replay/live/live_physical_focus_ritual_001.v0.json";
const STATIC_VALIDATION_WAIVER_PATH = "docs/evals/static-validation-waiver.md";
const BROWSER_LATENCY_THRESHOLDS_MS = {
  p50: 75,
  p95: 150,
  max: 300
};

const REQUIRED_TOP_LEVEL = new Set([
  "schema",
  "fixture_id",
  "name",
  "description",
  "created_by",
  "privacy",
  "input_events",
  "expected",
  "forbidden",
  "metrics"
]);

const ALLOWED_TOP_LEVEL = new Set([...REQUIRED_TOP_LEVEL, "trace_origin", "suggestion_summary"]);

const STATE_CHANGING_STABLE_TYPES = new Set([
  "object.moved",
  "object.placed",
  "gesture.detected",
  "zone.activated",
  "confidence.changed",
  "scene.uncertain",
  "scene.reset"
]);

const ALLOWED_PRODUCERS = new Set([
  "perception.local",
  "event_stabilizer",
  "quest_engine",
  "hud_engine",
  "memory_gate",
  "model_router",
  "human_correction"
]);

const REQUIRED_PAYLOAD_FIELDS = {
  "scene.calibrated": ["session_id", "zone_ids", "calibration_id", "scene_confidence"],
  "hand.entered_zone": ["hand_id", "zone_id", "tracking_id"],
  "hand.left_zone": ["hand_id", "zone_id", "tracking_id", "dwell_ms"],
  "object.moved": ["object_id", "object_type", "from_zone_id", "to_zone_id", "duration_ms"],
  "object.placed": ["object_id", "object_type", "zone_id", "dwell_ms"],
  "gesture.detected": ["gesture_id", "gesture_type", "zone_id", "actor_ref", "evidence_window_ms"],
  "zone.activated": ["zone_id", "activation_reason", "trigger_event_id"],
  "confidence.changed": ["target_ref", "previous_confidence", "current_confidence", "reason_code"],
  "scene.uncertain": ["uncertainty_kind", "affected_refs", "resolver_hint", "escalation_recommended"],
  "scene.reset": ["reset_reason", "reset_scope", "previous_state_id"],
  "quest.step_started": ["quest_id", "step_id", "step_name", "expected_evidence"],
  "quest.step_completed": [
    "quest_id",
    "step_id",
    "completion_reason",
    "accepted_evidence_event_ids",
    "elapsed_ms"
  ],
  "hud.command_emitted": ["command_id", "command_type", "target_surface", "visual_state", "priority"],
  "memory.write_requested": [
    "memory_id",
    "memory_scope",
    "memory_subject",
    "memory_value",
    "evidence_event_ids",
    "ttl_days",
    "privacy_classification"
  ],
  "agent.escalation_requested": [
    "escalation_id",
    "requested_tier",
    "reason_code",
    "source_event_ids",
    "privacy_scope",
    "user_visible",
    "max_cost_usd"
  ]
};

const STABLE_EVENT_TYPES = new Set([
  "scene.calibrated",
  "hand.entered_zone",
  "hand.left_zone",
  "object.moved",
  "object.placed",
  "gesture.detected",
  "zone.activated",
  "confidence.changed",
  "scene.uncertain",
  "scene.reset"
]);

const QUEST_STEPS = [
  {
    step_id: "step_phone_away",
    from_state: "phone_removal_pending",
    to_state: "phone_removed",
    hud_command_id: "hud_mark_phone_away",
    hud_command_type: "mark_step_complete",
    completion_reason: "phone_removed_from_focus_zone",
    guard: (event) =>
      event.type === "object.moved" &&
      event.confidence >= 0.86 &&
      event.payload.object_type === "phone" &&
      event.payload.from_zone_id === "zone_focus" &&
      event.payload.to_zone_id !== "zone_focus"
  },
  {
    step_id: "step_notebook_open",
    from_state: "notebook_pending",
    to_state: "notebook_opened",
    hud_command_id: "hud_mark_notebook_open",
    hud_command_type: "mark_step_complete",
    completion_reason: "notebook_opened",
    guard: (event) =>
      (event.type === "object.placed" &&
        event.confidence >= 0.86 &&
        event.payload.object_type === "notebook" &&
        event.payload.zone_id === "zone_notebook" &&
        event.payload.dwell_ms >= 500) ||
      (event.type === "gesture.detected" &&
        event.confidence >= 0.86 &&
        event.payload.gesture_type === "notebook_opened" &&
        event.payload.zone_id === "zone_notebook")
  },
  {
    step_id: "step_pen_pickup",
    from_state: "pen_pending",
    to_state: "pen_detected",
    hud_command_id: "hud_mark_pen_pickup",
    hud_command_type: "mark_step_complete",
    completion_reason: "pen_detected",
    guard: (event) =>
      (event.type === "object.moved" || event.type === "object.placed") &&
      event.confidence >= 0.86 &&
      event.payload.object_type === "pen" &&
      (event.payload.to_zone_id === "zone_notebook" ||
        event.payload.to_zone_id === "hand" ||
        event.payload.to_zone_id === "zone_focus" ||
        event.payload.zone_id === "zone_notebook" ||
        event.payload.zone_id === "zone_focus")
  },
  {
    step_id: "step_write_three_bullets",
    from_state: "writing_pending",
    to_state: "writing_detected",
    hud_command_id: "hud_mark_write_three_bullets",
    hud_command_type: "mark_step_complete",
    completion_reason: "writing_detected",
    guard: (event) =>
      event.type === "gesture.detected" &&
      event.confidence >= 0.82 &&
      (event.payload.gesture_type === "writing_motion" || event.payload.gesture_type === "writing_like_motion") &&
      event.payload.zone_id === "zone_notebook" &&
      event.payload.evidence_window_ms >= 900 &&
      (event.payload.gesture_repetition_count ?? 0) >= 3
  },
  {
    step_id: "step_start_typing",
    from_state: "typing_pending",
    to_state: "typing_detected",
    hud_command_id: "hud_mark_start_typing",
    hud_command_type: "mark_step_complete",
    completion_reason: "typing_detected",
    guard: (event) =>
      event.type === "gesture.detected" &&
      event.confidence >= 0.82 &&
      (event.payload.gesture_type === "typing_motion" || event.payload.gesture_type === "typing_like_motion") &&
      (event.payload.zone_id === "zone_keyboard" || event.payload.zone_id === "zone_laptop") &&
      event.payload.evidence_window_ms >= 900
  }
];

const FINAL_STEP = {
  step_id: "step_quest_complete",
  from_state: "typing_detected",
  to_state: "quest_complete",
  hud_command_id: "hud_quest_complete",
  hud_command_type: "quest_complete",
  completion_reason: "all_required_steps_complete"
};

function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "replay") {
    const { fixturePath, repeat } = parseReplayArgs(args);
    const report = runReplay(fixturePath, repeat);
    writeReport(report);
    printReplaySummary(report);
    process.exit(report.verdict === "FAIL" ? 1 : 0);
  }

  if (command === "report") {
    const [reportPath] = args;
    if (!reportPath) die("Usage: darkquest-eval report runs/latest.json");
    const report = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
    printReport(report);
    process.exit(report.verdict === "FAIL" ? 1 : 0);
  }

  if (command === "gate-0b") {
    const manifestPath = resolve(args[0] ?? DEFAULT_GATE_0B_MANIFEST);
    const suite = runGate0B(manifestPath);
    writeSuiteReport(suite);
    printSuiteSummary(suite);
    process.exit(suite.passed ? 0 : 1);
  }

  if (command === "gate-1a") {
    const manifestPath = resolve(args[0] ?? DEFAULT_GATE_1A_MANIFEST);
    const suite = runGate1A(manifestPath);
    writeGate1AReport(suite);
    printGate1ASummary(suite);
    process.exit(suite.final_verdict === "PASS" || suite.final_verdict === "PASS_WITH_DISCLOSURE" ? 0 : 1);
  }

  if (command === "gate-1b") {
    const manifestPath = resolve(args[0] ?? DEFAULT_GATE_1B_MANIFEST);
    const suite = runGate1B(manifestPath);
    writeGate1BReport(suite);
    printGate1BSummary(suite);
    process.exit(suite.final_verdict === "PASS" || suite.final_verdict === "PASS_WITH_DISCLOSURE" ? 0 : 1);
  }

  if (command === "gate-1c") {
    const manifestPath = resolve(args[0] ?? DEFAULT_GATE_1C_MANIFEST);
    const suite = runGate1C(manifestPath);
    writeGate1CReport(suite);
    printGate1CSummary(suite);
    process.exit(suite.final_verdict === "PASS" || suite.final_verdict === "PASS_WITH_DISCLOSURE" ? 0 : 1);
  }

  if (command === "physical-validate") {
    const fixturePath = args[0] ?? DEFAULT_PHYSICAL_TRACE_FIXTURE;
    const report = runPhysicalValidation(fixturePath);
    writePhysicalValidationReport(report);
    printPhysicalValidationSummary(report);
    process.exit(report.final_verdict === "PASS" ? 0 : 1);
  }

  die(`Usage:
  darkquest-eval replay [--repeat N] fixtures/replay/focus_ritual_happy_path.v0.json
  darkquest-eval report runs/latest.json
  darkquest-eval gate-0b [fixtures/replay/gate_0b_manifest.json]
  darkquest-eval gate-1a [fixtures/replay/gate_1a_manifest.json]
  darkquest-eval gate-1b [fixtures/replay/gate_1b_manifest.json]
  darkquest-eval gate-1c [fixtures/replay/gate_1c_manifest.json]
  darkquest-eval physical-validate [fixtures/replay/live/live_physical_focus_ritual_001.v0.json]`);
}

function parseReplayArgs(args) {
  let repeat = 1;
  const remaining = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repeat") {
      repeat = Number(args[index + 1]);
      index += 1;
    } else {
      remaining.push(arg);
    }
  }

  if (!Number.isInteger(repeat) || repeat < 1) die("--repeat must be a positive integer");
  if (remaining.length !== 1) die("Replay requires exactly one fixture path");

  return { fixturePath: resolve(remaining[0]), repeat };
}

function runReplay(fixturePath, repeat) {
  const raw = readFileSync(fixturePath, "utf8");
  const fixture = JSON.parse(raw);
  const buildHash = sha256(`${VERSION}\n${raw}`);
  const runs = [];

  for (let index = 0; index < repeat; index += 1) {
    runs.push(runOnce(fixture, fixturePath, buildHash, index + 1));
  }

  const primary = runs[0];
  const deterministic = compareRepeatedRuns(runs, repeat);
  primary.deterministic_replay_result = deterministic;

  if (!deterministic.passed) {
    primary.failures.push(failure("nondeterministic_replay", "Replay output changed across repeated runs.", "deterministic_replay_result", "critical"));
  }

  primary.verdict = verdictFor(primary);
  return primary;
}

function runGate0B(manifestPath) {
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const manifestDir = dirname(manifestPath);
  const results = [];

  for (const fixture of manifest.fixtures ?? []) {
    const resolvedFixturePath = resolveFixturePath(manifestDir, fixture.path);
    const report = runReplay(resolvedFixturePath, fixture.repeat ?? manifest.repeat ?? 3);
    const actualCodes = new Set(report.failures.map((item) => item.code));
    const expectedVerdict = fixture.expected_verdict;
    const expectedCodes = fixture.expected_failure_codes ?? [];
    const verdictMatches = report.verdict === expectedVerdict;
    const missingFailureCodes = expectedCodes.filter((code) => !actualCodes.has(code));
    const unexpectedFailureCodes = fixture.allow_additional_failure_codes === true
      ? []
      : [...actualCodes].filter((code) => !expectedCodes.includes(code));
    const codesMatch = missingFailureCodes.length === 0 && unexpectedFailureCodes.length === 0;

    results.push({
      fixture_id: report.fixture_id,
      path: fixture.path,
      resolved_path: resolvedFixturePath,
      expected_verdict: expectedVerdict,
      actual_verdict: report.verdict,
      expected_failure_codes: expectedCodes,
      actual_failure_codes: [...actualCodes].sort(),
      missing_failure_codes: missingFailureCodes.sort(),
      unexpected_failure_codes: unexpectedFailureCodes.sort(),
      passed: verdictMatches && codesMatch,
      report
    });
  }

  return {
    schema: "darkquest.gate_0b_suite_report.v0",
    manifest_path: manifestPath,
    repeat: manifest.repeat ?? 3,
    passed: results.every((result) => result.passed),
    results
  };
}

function resolveFixturePath(manifestDir, fixturePath) {
  const workspaceRelative = resolve(fixturePath);
  if (existsSync(workspaceRelative)) return workspaceRelative;
  if (fixturePath.startsWith("fixtures/")) return resolve(manifestDir, "..", "..", fixturePath);
  return resolve(manifestDir, fixturePath);
}

function runGate1A(manifestPath) {
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const manifestDir = dirname(manifestPath);
  const repeat = manifest.repeat ?? 3;
  const runId = `run_gate_1a_${Date.now()}`;
  const buildHash = `sha256:${sha256(`${VERSION}\n${raw}`).slice(0, 16)}`;
  const entries = [
    ...(manifest.required_fixtures ?? []).map((entry) => ({ ...entry, category: "required" })),
    ...(manifest.recommended_fixtures ?? []).map((entry) => ({ ...entry, category: "recommended" })),
    ...(manifest.adversarial_fixtures ?? []).map((entry) => ({ ...entry, category: "adversarial" }))
  ];
  const results = entries.map((entry) => runGate1AEntry(entry, manifestDir, repeat));
  const missingRequired = results.filter((result) => result.status === "missing_required");
  const missingRecommended = results.filter((result) => result.status === "missing_recommended");
  const missingAdversarial = results.filter((result) => result.status === "missing_adversarial");
  const presentResults = results.filter((result) => result.status === "evaluated");
  const acceptanceResults = presentResults.filter((result) => result.expected_result === "PASS");
  const failedExactChecks = presentResults.filter((result) => !result.exact_failure_code_matching_result.passed);
  const failedPositiveChecks = presentResults.filter((result) => result.expected_result === "PASS" && result.actual_result !== "PASS");
  const failedAdversarialChecks = presentResults.filter((result) => result.expected_result === "FAIL" && result.actual_result !== "FAIL");
  const requiredResults = results.filter((result) => result.category === "required");
  const recommendedResults = results.filter((result) => result.category === "recommended");
  const adversarialResults = results.filter((result) => result.category === "adversarial");
  const allDeterministicHashes = presentResults.flatMap((result) => result.deterministic_hashes ?? []);
  const observedLlmCalls = acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.observed_llm_calls ?? 0), 0);
  const observedVlmCalls = acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.observed_vlm_calls ?? 0), 0);
  const observedCostUsd = acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.observed_cost_usd ?? 0), 0);
  const rawMediaPersistenceCount = acceptanceResults.reduce((sum, result) => sum + (result.privacy_check?.raw_media_persistence_count ?? 0), 0);

  let finalVerdict = "PASS";
  const knownLimitations = [];
  if (missingRequired.length > 0) {
    finalVerdict = "BLOCKED_MISSING_LIVE_TRACE";
  } else if (
    missingAdversarial.length > 0 ||
    failedExactChecks.length > 0 ||
    failedPositiveChecks.length > 0 ||
    failedAdversarialChecks.length > 0
  ) {
    finalVerdict = "FAIL";
  } else if (missingRecommended.length > 0) {
    finalVerdict = "PASS_WITH_DISCLOSURE";
    knownLimitations.push("Recommended live trace fixtures are missing.");
  }

  return {
    schema: "darkquest.gate_1a_report.v0",
    run_id: runId,
    build_hash: buildHash,
    manifest_path: manifestPath,
    gate: manifest.gate ?? "1A",
    fixture_count: entries.length,
    missing_fixture_count: missingRequired.length + missingRecommended.length + missingAdversarial.length,
    required_fixture_count: requiredResults.length,
    recommended_fixture_count: recommendedResults.length,
    adversarial_fixture_count: adversarialResults.length,
    missing_fixtures: [
      ...missingRequired.map((result) => ({ category: result.category, fixture: result.fixture, status: result.status })),
      ...missingRecommended.map((result) => ({ category: result.category, fixture: result.fixture, status: result.status })),
      ...missingAdversarial.map((result) => ({ category: result.category, fixture: result.fixture, status: result.status }))
    ],
    schema_validation_result: aggregateBoolean(acceptanceResults, "schema_validation_result"),
    event_validation_result: aggregateBoolean(acceptanceResults, "event_validation_result"),
    replay_result: aggregateBoolean(acceptanceResults, "replay_result"),
    deterministic_repeat_result: aggregateBoolean(acceptanceResults, "deterministic_repeat_result"),
    raw_media_check: aggregateBoolean(acceptanceResults, "raw_media_check"),
    model_call_check: aggregateBoolean(acceptanceResults, "model_call_check"),
    memory_policy_check: aggregateBoolean(acceptanceResults, "memory_policy_check"),
    hud_honesty_check: aggregateBoolean(acceptanceResults, "hud_honesty_check"),
    exact_failure_code_matching_result: {
      passed: failedExactChecks.length === 0,
      failed_fixtures: failedExactChecks.map((result) => result.fixture_id)
    },
    cost_result: {
      passed: acceptanceResults.every((result) => result.cost_result?.passed !== false),
      observed_llm_calls: observedLlmCalls,
      observed_vlm_calls: observedVlmCalls,
      observed_cost_usd: observedCostUsd,
      raw_media_persistence_count: rawMediaPersistenceCount
    },
    latency_result: {
      passed: acceptanceResults.every((result) => result.latency_result?.passed !== false),
      replay_runtime_ms: acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.replay_runtime_ms ?? 0), 0),
      p50_latency_ms: null,
      p95_latency_ms: null
    },
    deterministic_hashes: allDeterministicHashes,
    known_limitations: knownLimitations,
    results,
    final_verdict: finalVerdict
  };
}

function runGate1B(manifestPath) {
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const manifestDir = dirname(manifestPath);
  const repeat = manifest.repeat ?? 3;
  const runId = `run_gate_1b_${Date.now()}`;
  const buildHash = `sha256:${sha256(`${VERSION}\n${raw}`).slice(0, 16)}`;
  const entries = [
    ...(manifest.required_fixtures ?? []).map((entry) => ({ ...entry, category: "required" })),
    ...(manifest.recommended_fixtures ?? []).map((entry) => ({ ...entry, category: "recommended" })),
    ...(manifest.adversarial_fixtures ?? []).map((entry) => ({ ...entry, category: "adversarial" }))
  ];
  const results = entries.map((entry) => runGate1BEntry(entry, manifestDir, repeat));
  const missingRequired = results.filter((result) => result.status === "missing_required");
  const missingRecommended = results.filter((result) => result.status === "missing_recommended");
  const missingAdversarial = results.filter((result) => result.status === "missing_adversarial");
  const presentResults = results.filter((result) => result.status === "evaluated");
  const acceptanceResults = presentResults.filter((result) => result.expected_result === "PASS");
  const browserAcceptanceResults = acceptanceResults.filter((result) => result.browser_generated === true);
  const failedExactChecks = presentResults.filter((result) => !result.exact_failure_code_matching_result.passed);
  const failedPositiveChecks = presentResults.filter((result) => result.expected_result === "PASS" && result.actual_result !== "PASS");
  const failedAdversarialChecks = presentResults.filter((result) => result.expected_result === "FAIL" && result.actual_result !== "FAIL");
  const requiredResults = results.filter((result) => result.category === "required");
  const recommendedResults = results.filter((result) => result.category === "recommended");
  const adversarialResults = results.filter((result) => result.category === "adversarial");
  const missingBrowserTrace = missingRequired.filter((result) => result.browser_generated === true);
  const missingRecoveryFixtures = missingRequired.filter((result) => result.recovery_kind === "occlusion" || result.recovery_kind === "camera_bump");
  const requiredBrowserOriginFailures = presentResults.filter(
    (result) =>
      result.category === "required" &&
      result.browser_generated === true &&
      result.browser_trace_check?.failure_codes?.includes("browser_trace_origin_missing")
  );
  const staticValidation = gate1BStaticValidationResult();
  const gate1BDisclosures = [
    ...presentResults.flatMap((result) => result.gate_1b_disclosures ?? []),
    ...staticValidation.disclosures
  ];
  const allDeterministicHashes = presentResults.flatMap((result) => result.deterministic_hashes ?? []);
  const observedLlmCalls = acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.observed_llm_calls ?? 0), 0);
  const observedVlmCalls = acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.observed_vlm_calls ?? 0), 0);
  const observedCostUsd = acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.observed_cost_usd ?? 0), 0);
  const rawMediaPersistenceCount = acceptanceResults.reduce(
    (sum, result) =>
      sum +
      (result.actual_failure_codes ?? []).filter((code) =>
        ["raw_media_persistence_violation", "raw_media_evidence", "base64_media_detected", "screenshot_detected"].includes(code)
      ).length,
    0
  );

  let finalVerdict = "PASS";
  const knownLimitations = [];
  if (missingBrowserTrace.length > 0 || requiredBrowserOriginFailures.length > 0) {
    finalVerdict = "BLOCKED_MISSING_BROWSER_TRACE";
  } else if (missingRecoveryFixtures.length > 0) {
    finalVerdict = "BLOCKED_MISSING_RECOVERY_FIXTURES";
  } else if (
    missingAdversarial.length > 0 ||
    failedExactChecks.length > 0 ||
    failedPositiveChecks.length > 0 ||
    failedAdversarialChecks.length > 0
  ) {
    finalVerdict = "FAIL";
  } else if (missingRecommended.length > 0 || staticValidation.passed !== true || gate1BDisclosures.length > 0) {
    finalVerdict = "PASS_WITH_DISCLOSURE";
  }

  if (missingRecommended.length > 0) knownLimitations.push("Recommended live trace fixtures are missing.");
  for (const item of staticValidation.disclosures) knownLimitations.push(item.message);
  for (const item of gate1BDisclosures.filter((item) => item.code !== "typescript_compile_disclosed")) {
    knownLimitations.push(item.message);
  }

  return {
    schema: "darkquest.gate_1b_report.v0",
    run_id: runId,
    build_hash: buildHash,
    manifest_path: manifestPath,
    gate: manifest.gate ?? "1B",
    fixture_count: entries.length,
    missing_fixture_count: missingRequired.length + missingRecommended.length + missingAdversarial.length,
    required_fixture_count: requiredResults.length,
    recommended_fixture_count: recommendedResults.length,
    adversarial_fixture_count: adversarialResults.length,
    missing_required_fixtures: missingRequired.map((result) => ({
      category: result.category,
      fixture: result.fixture,
      status: result.status,
      browser_generated: result.browser_generated,
      recovery_kind: result.recovery_kind
    })),
    missing_fixtures: [
      ...missingRequired.map((result) => ({ category: result.category, fixture: result.fixture, status: result.status })),
      ...missingRecommended.map((result) => ({ category: result.category, fixture: result.fixture, status: result.status })),
      ...missingAdversarial.map((result) => ({ category: result.category, fixture: result.fixture, status: result.status }))
    ],
    browser_trace_result: {
      passed:
        missingBrowserTrace.length === 0 &&
        requiredBrowserOriginFailures.length === 0 &&
        browserAcceptanceResults.length > 0 &&
        browserAcceptanceResults.every((result) => result.browser_trace_check?.passed === true),
      required_browser_fixture_count: requiredResults.filter((result) => result.browser_generated === true).length,
      evaluated_browser_fixture_count: browserAcceptanceResults.length,
      failed_fixtures: [
        ...missingBrowserTrace.map((result) => result.fixture),
        ...requiredBrowserOriginFailures.map((result) => result.fixture_id ?? result.fixture)
      ]
    },
    occlusion_recovery_result: aggregateRecoveryResult(results, "occlusion"),
    camera_bump_reset_result: aggregateRecoveryResult(results, "camera_bump"),
    schema_validation_result: aggregateBoolean(acceptanceResults, "schema_validation_result"),
    event_validation_result: aggregateBoolean(acceptanceResults, "event_validation_result"),
    replay_result: aggregateBoolean(acceptanceResults, "replay_result"),
    deterministic_repeat_result: aggregateBoolean(acceptanceResults, "deterministic_repeat_result"),
    exact_failure_code_result: {
      passed: failedExactChecks.length === 0,
      failed_fixtures: failedExactChecks.map((result) => result.fixture_id ?? result.fixture)
    },
    privacy_result: aggregateBoolean(acceptanceResults, "raw_media_check"),
    model_call_result: aggregateBoolean(acceptanceResults, "model_call_check"),
    memory_result: aggregateBoolean(acceptanceResults, "memory_policy_check"),
    hud_honesty_result: aggregateBoolean(acceptanceResults, "hud_honesty_check"),
    cost_result: {
      passed: acceptanceResults.every((result) => result.cost_result?.passed !== false),
      observed_llm_calls: observedLlmCalls,
      observed_vlm_calls: observedVlmCalls,
      observed_cost_usd: observedCostUsd,
      raw_media_persistence_count: rawMediaPersistenceCount
    },
    latency_result: {
      passed: acceptanceResults.every((result) => result.latency_result?.passed !== false),
      replay_runtime_ms: acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.replay_runtime_ms ?? 0), 0),
      p50_latency_ms: null,
      p95_latency_ms: null
    },
    browser_latency_result: aggregateBrowserLatencyResult(browserAcceptanceResults),
    static_validation_result: staticValidation,
    deterministic_hashes: allDeterministicHashes,
    known_limitations: [...new Set(knownLimitations)],
    results,
    final_verdict: finalVerdict
  };
}

function runGate1C(manifestPath) {
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const manifestDir = dirname(manifestPath);
  const repeat = manifest.repeat ?? 3;
  const runId = `run_gate_1c_${Date.now()}`;
  const buildHash = `sha256:${sha256(`${VERSION}\n${raw}`).slice(0, 16)}`;
  const entries = [
    ...(manifest.required_fixtures ?? []).map((entry) => ({ ...entry, category: "required" })),
    ...(manifest.regression_fixtures ?? []).map((entry) => ({ ...entry, category: "regression" })),
    ...(manifest.adversarial_fixtures ?? []).map((entry) => ({ ...entry, category: "adversarial" }))
  ];
  const results = entries.map((entry) => runGate1CEntry(entry, manifestDir, repeat));
  const missingRequired = results.filter((result) => result.status === "missing_required");
  const missingRegression = results.filter((result) => result.status === "missing_regression");
  const missingAdversarial = results.filter((result) => result.status === "missing_adversarial");
  const missingPhysicalTrace = results.filter(
    (result) => result.category === "required" && result.physical_capture_required === true && result.status !== "evaluated"
  );
  const presentResults = results.filter((result) => result.status === "evaluated");
  const acceptanceResults = presentResults.filter((result) => result.expected_result === "PASS");
  const physicalAcceptanceResults = acceptanceResults.filter((result) => result.physical_capture_required === true);
  const failedExactChecks = presentResults.filter((result) => !result.exact_failure_code_matching_result.passed);
  const failedPositiveChecks = presentResults.filter((result) => result.expected_result === "PASS" && result.actual_result !== "PASS");
  const failedAdversarialChecks = presentResults.filter((result) => result.expected_result === "FAIL" && result.actual_result !== "FAIL");
  const requiredResults = results.filter((result) => result.category === "required");
  const regressionResults = results.filter((result) => result.category === "regression");
  const adversarialResults = results.filter((result) => result.category === "adversarial");
  const physicalOriginFailures = physicalAcceptanceResults.filter((result) => result.physical_trace_check?.passed !== true);
  const staticValidation = gate1CStaticValidationResult();
  const waiver = gate1CWaiverResult(staticValidation);
  const allDeterministicHashes = presentResults.flatMap((result) => result.deterministic_hashes ?? []);
  const observedLlmCalls = acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.observed_llm_calls ?? 0), 0);
  const observedVlmCalls = acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.observed_vlm_calls ?? 0), 0);
  const observedCostUsd = acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.observed_cost_usd ?? 0), 0);
  const rawMediaPersistenceCount = acceptanceResults.reduce(
    (sum, result) => sum + (result.privacy_check?.raw_media_persistence_count ?? 0),
    0
  );

  let finalVerdict = "PASS";
  if (missingPhysicalTrace.length > 0) {
    finalVerdict = "BLOCKED_MISSING_PHYSICAL_TRACE";
  } else if (
    missingRequired.length > 0 ||
    missingRegression.length > 0 ||
    missingAdversarial.length > 0 ||
    physicalOriginFailures.length > 0 ||
    failedExactChecks.length > 0 ||
    failedPositiveChecks.length > 0 ||
    failedAdversarialChecks.length > 0
  ) {
    finalVerdict = "FAIL";
  } else if (staticValidation.passed !== true && waiver.accepted !== true) {
    finalVerdict = "BLOCKED_STATIC_VALIDATION";
  } else if (staticValidation.passed !== true && waiver.accepted === true) {
    finalVerdict = "PASS_WITH_DISCLOSURE";
  }

  const physicalTraceResult = {
    passed:
      missingPhysicalTrace.length === 0 &&
      physicalAcceptanceResults.length > 0 &&
      physicalAcceptanceResults.every((result) => result.actual_result === "PASS"),
    required_fixture_count: requiredResults.filter((result) => result.physical_capture_required === true).length,
    evaluated_count: physicalAcceptanceResults.length,
    missing_fixtures: missingPhysicalTrace.map((result) => result.fixture),
    failed_fixtures: physicalAcceptanceResults
      .filter((result) => result.actual_result !== "PASS")
      .map((result) => result.fixture_id ?? result.fixture),
    failure_codes: missingPhysicalTrace.length > 0 ? ["physical_trace_missing"] : []
  };
  const physicalTraceOriginResult = {
    passed:
      physicalAcceptanceResults.length > 0 &&
      physicalAcceptanceResults.every((result) => result.physical_trace_check?.passed === true),
    evaluated_count: physicalAcceptanceResults.length,
    failed_fixtures: physicalOriginFailures.map((result) => result.fixture_id ?? result.fixture)
  };
  const polishApproval = gate1CPolishApprovalResult(finalVerdict, {
    physicalTraceResult,
    staticValidation,
    waiver
  });

  return {
    schema: "darkquest.gate_1c_report.v0",
    run_id: runId,
    build_hash: buildHash,
    manifest_path: manifestPath,
    gate: manifest.gate ?? "1C",
    fixture_count: entries.length,
    required_fixture_count: requiredResults.length,
    regression_fixture_count: regressionResults.length,
    adversarial_fixture_count: adversarialResults.length,
    missing_required_fixtures: missingRequired.map((result) => ({
      category: result.category,
      fixture: result.fixture,
      status: result.status,
      physical_capture_required: result.physical_capture_required,
      browser_generated_required: result.browser_generated_required
    })),
    physical_trace_result: physicalTraceResult,
    physical_trace_origin_result: physicalTraceOriginResult,
    replay_result: aggregateBoolean(acceptanceResults, "replay_result"),
    deterministic_repeat_result: aggregateBoolean(acceptanceResults, "deterministic_repeat_result"),
    exact_failure_code_result: {
      passed: failedExactChecks.length === 0,
      failed_fixtures: failedExactChecks.map((result) => result.fixture_id ?? result.fixture)
    },
    privacy_result: aggregateBoolean(acceptanceResults, "raw_media_check"),
    model_call_result: aggregateBoolean(acceptanceResults, "model_call_check"),
    memory_result: aggregateBoolean(acceptanceResults, "memory_policy_check"),
    HUD_honesty_result: aggregateBoolean(acceptanceResults, "hud_honesty_check"),
    cost_result: {
      passed: acceptanceResults.every((result) => result.cost_result?.passed !== false),
      observed_llm_calls: observedLlmCalls,
      observed_vlm_calls: observedVlmCalls,
      observed_cost_usd: observedCostUsd,
      raw_media_persistence_count: rawMediaPersistenceCount
    },
    latency_result: {
      passed: acceptanceResults.every((result) => result.latency_result?.passed !== false),
      replay_runtime_ms: acceptanceResults.reduce((sum, result) => sum + (result.cost_latency?.replay_runtime_ms ?? 0), 0),
      physical_browser_latency: physicalAcceptanceResults.map((result) => ({
        fixture_id: result.fixture_id,
        latency: result.physical_trace_check?.observed_latency ?? null
      }))
    },
    static_validation_result: staticValidation,
    waiver_result: waiver,
    polish_approval_result: polishApproval,
    deterministic_hashes: allDeterministicHashes,
    results,
    final_verdict: finalVerdict
  };
}

function runPhysicalValidation(fixturePath) {
  const resolvedPath = resolve(fixturePath);
  const runId = `run_physical_validate_${Date.now()}`;
  const baseReport = {
    schema: "darkquest.physical_trace_validation_report.v0",
    run_id: runId,
    fixture_path: fixturePath,
    resolved_path: resolvedPath,
    repeat: 3,
    required_checks: [
      "file_exists",
      "trace_origin_exists",
      "source_browser_local_camera",
      "generated_by_browser_local_capture",
      "capture_mode_physical_webcam_manual_calibration",
      "physical_capture_true",
      "operator_confirmed_physical_session_true",
      "manual_fixture_false",
      "raw_media_persisted_false",
      "cloud_calls_enabled_false",
      "browser_latency_recorded_true",
      "browser_latency_records_exist",
      "not_browser_origin_synthetic_substitution",
      "no_raw_video",
      "no_screenshots",
      "no_base64_images",
      "no_audio",
      "no_ocr",
      "no_notebook_text",
      "no_llm_calls",
      "no_vlm_calls",
      "raw_media_persistence_count_zero",
      "event_ids_unique",
      "timestamps_monotonic",
      "replay_repeat_3_passes"
    ]
  };

  if (!existsSync(resolvedPath)) {
    return {
      ...baseReport,
      file_exists: false,
      final_verdict: "BLOCKED_MISSING_PHYSICAL_TRACE",
      actual_failure_codes: ["physical_trace_missing"],
      failures: [
        failure("physical_trace_missing", "Required physical trace fixture is missing.", fixturePath, "critical")
      ]
    };
  }

  const result = runGate1CEntry(
    {
      fixture: fixturePath,
      category: "required",
      expected_result: "PASS",
      repeat: 3,
      physical_capture_required: true,
      browser_generated_required: true
    },
    process.cwd(),
    3
  );
  const actualFailureCodes = result.actual_failure_codes ?? [];
  const passed =
    result.status === "evaluated" &&
    result.actual_result === "PASS" &&
    result.exact_failure_code_matching_result?.passed === true &&
    result.physical_trace_check?.passed === true &&
    result.raw_media_check?.passed === true &&
    result.model_call_check?.passed === true &&
    result.deterministic_repeat_result?.passed === true;

  return {
    ...baseReport,
    file_exists: true,
    fixture_id: result.fixture_id,
    final_verdict: passed ? "PASS" : "FAIL",
    actual_failure_codes: actualFailureCodes,
    physical_trace_check: result.physical_trace_check,
    replay_result: result.replay_result,
    deterministic_repeat_result: result.deterministic_repeat_result,
    raw_media_check: result.raw_media_check,
    model_call_check: result.model_call_check,
    memory_policy_check: result.memory_policy_check,
    hud_honesty_check: result.hud_honesty_check,
    cost_result: result.cost_result,
    latency_result: result.latency_result,
    cost_latency: result.cost_latency,
    result
  };
}

function runGate1CEntry(entry, manifestDir, defaultRepeat) {
  const result = runGate1AEntry(entry, manifestDir, defaultRepeat);
  const physicalCaptureRequired = entry.physical_capture_required === true || entry.physical_capture === true;
  const browserGeneratedRequired = entry.browser_generated_required === true || entry.browser_generated === true;
  const recoveryKind = recoveryKindForFixture(entry.fixture ?? entry.path, result.fixture_id);
  result.physical_capture_required = physicalCaptureRequired;
  result.browser_generated_required = browserGeneratedRequired;
  result.recovery_kind = recoveryKind;

  if (result.status !== "evaluated") {
    if (physicalCaptureRequired) {
      result.actual_failure_codes = ["physical_trace_missing"];
    }
    return result;
  }

  const fixture = JSON.parse(readFileSync(result.resolved_path, "utf8"));
  const checkResults = [];
  if (physicalCaptureRequired) {
    checkResults.push(checkPhysicalTraceOrigin(fixture));
  } else if (browserGeneratedRequired) {
    checkResults.push(checkBrowserTraceOrigin(fixture, { browser_generated: true }));
    checkResults.push(checkBrowserLatency(fixture, { browser_generated: true }));
  }
  checkResults.push(checkOcclusionRecovery(fixture, result.replay_report, entry, result));
  checkResults.push(checkCameraBumpReset(fixture, result.replay_report, entry, result));

  const gate1CFailures = dedupeFailures(checkResults.flatMap((check) => check.failures ?? []));
  const allFailures = dedupeFailures([...(result.failures ?? []), ...gate1CFailures]);
  const actualFailureCodes = [...new Set(allFailures.map((item) => item.code))].sort();
  const expectedFailureCodes = result.expected_failure_codes ?? [];
  const actualResult = actualFailureCodes.length > 0 || result.replay_report.verdict === "FAIL" ? "FAIL" : result.replay_report.verdict;
  const missingFailureCodes = expectedFailureCodes.filter((code) => !actualFailureCodes.includes(code));
  const unexpectedFailureCodes = actualFailureCodes.filter((code) => !expectedFailureCodes.includes(code));
  const exactCodeMatch = missingFailureCodes.length === 0 && unexpectedFailureCodes.length === 0;
  const resultMatch = actualResult === result.expected_result;
  const rawMediaCodes = new Set([
    "raw_media_persistence_violation",
    "raw_audio_persistence_violation",
    "base64_media_detected",
    "screenshot_detected",
    "notebook_text_detected",
    "raw_media_evidence",
    "cloud_evidence_marked_local"
  ]);
  const modelCodes = new Set(["unexpected_model_call"]);

  const physicalTraceCheck = checkResults.find((check) => check.kind === "physical_trace") ?? {
    passed: !physicalCaptureRequired,
    failure_codes: [],
    failures: []
  };

  return {
    ...result,
    actual_result: actualResult,
    actual_failure_codes: actualFailureCodes,
    exact_failure_code_matching_result: {
      passed: exactCodeMatch && resultMatch,
      result_match: resultMatch,
      missing_failure_codes: missingFailureCodes,
      unexpected_failure_codes: unexpectedFailureCodes
    },
    raw_media_check: {
      ...(result.raw_media_check ?? {}),
      passed: !actualFailureCodes.some((code) => rawMediaCodes.has(code)),
      failure_codes: actualFailureCodes.filter((code) => rawMediaCodes.has(code))
    },
    model_call_check: {
      ...(result.model_call_check ?? {}),
      passed: !actualFailureCodes.some((code) => modelCodes.has(code)),
      failure_codes: actualFailureCodes.filter((code) => modelCodes.has(code))
    },
    latency_result: {
      ...(result.latency_result ?? {}),
      passed: result.latency_result?.passed !== false && physicalTraceCheck.passed !== false
    },
    physical_trace_check: physicalTraceCheck,
    failures: allFailures
  };
}

function checkPhysicalTraceOrigin(fixture) {
  const failures = [];
  const origin = fixture.trace_origin;
  const latency = normalizeBrowserLatency(fixture.metrics);
  if (!isPlainObject(origin)) {
    failures.push(failure("physical_trace_origin_missing", "Physical traces require top-level trace_origin metadata.", "trace_origin", "critical"));
    return physicalTraceCheckResult(failures, null);
  }

  if (hasBrowserSyntheticPhysicalSignature(fixture, origin)) {
    failures.push(failure("physical_trace_synthetic_substitution", "Browser-origin symbolic trace cannot substitute for physical webcam provenance.", "trace_origin", "critical"));
  }

  if (origin.source !== "browser.local_camera") {
    failures.push(failure("physical_trace_origin_missing", "Physical trace source must be browser.local_camera.", "trace_origin.source", "critical"));
  }
  if (origin.generated_by !== "browser-local-capture") {
    failures.push(failure("physical_trace_wrong_generator", "Physical trace generated_by must be browser-local-capture.", "trace_origin.generated_by", "critical"));
  }
  if (origin.physical_capture !== true || origin.operator_confirmed_physical_session !== true) {
    failures.push(failure("physical_capture_not_confirmed", "Physical trace must confirm physical capture and operator session.", "trace_origin", "critical"));
  }
  if (origin.manual_fixture !== false) {
    failures.push(failure("physical_trace_marked_manual", "Physical trace must not be marked as a manual fixture.", "trace_origin.manual_fixture", "critical"));
  }
  if (origin.raw_media_persisted !== false) {
    failures.push(failure("raw_media_persistence_violation", "Physical trace origin reports raw media persistence.", "trace_origin.raw_media_persisted", "critical"));
  }
  if (origin.cloud_calls_enabled !== false) {
    failures.push(failure("unexpected_model_call", "Physical trace origin reports cloud calls enabled.", "trace_origin.cloud_calls_enabled", "critical"));
  }
  if (origin.browser_latency_recorded !== true || !latency) {
    failures.push(failure("physical_trace_latency_missing", "Physical trace requires browser latency records.", "metrics.browser_latency_records", "critical"));
  }
  if (origin.capture_mode !== "physical_webcam_manual_calibration") {
    failures.push(failure("physical_trace_wrong_capture_mode", "Physical trace capture_mode must be physical_webcam_manual_calibration.", "trace_origin.capture_mode", "critical"));
  }
  if ((latency?.raw_media_persistence_count ?? 0) !== 0) {
    failures.push(failure("raw_media_persistence_violation", "Physical trace latency records report raw media persistence.", "metrics.browser_latency_records", "critical"));
  }
  if ((latency?.llm_calls ?? 0) !== 0 || (latency?.vlm_calls ?? 0) !== 0) {
    failures.push(failure("unexpected_model_call", "Physical trace latency records report model calls.", "metrics.browser_latency_records", "critical"));
  }

  return physicalTraceCheckResult(failures, latency);
}

function hasBrowserSyntheticPhysicalSignature(fixture, origin) {
  const text = [
    fixture.fixture_id,
    fixture.name,
    fixture.description,
    fixture.created_by
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    fixture.fixture_id === "live_browser_focus_ritual_001" ||
    text.includes("live_browser_focus_ritual_001") ||
    text.includes("browser-origin synthetic") ||
    text.includes("browser-origin trace") ||
    origin.generated_by === "live-perception-adapter" ||
    origin.capture_mode === "manual_calibration_browser_live"
  );
}

function physicalTraceCheckResult(failures, latency) {
  return {
    kind: "physical_trace",
    passed: failures.length === 0,
    failure_codes: [...new Set(failures.map((item) => item.code))].sort(),
    failures,
    observed_latency: latency
  };
}

function gate1CStaticValidationResult() {
  const base = gate1BStaticValidationResult();
  const rootPackagePath = resolve("package.json");
  const rootPackage = existsSync(rootPackagePath)
    ? JSON.parse(readFileSync(rootPackagePath, "utf8"))
    : { scripts: {} };
  const requiredScripts = [
    "test:adapter",
    "test:recorder",
    "typecheck",
    "gate:0b",
    "gate:1a",
    "gate:1b",
    "gate:1c",
    "physical:validate",
    "verify:physical"
  ];
  const rootScriptChecks = requiredScripts.map((script) => ({
    script,
    present: typeof rootPackage.scripts?.[script] === "string"
  }));
  const missingScripts = rootScriptChecks.filter((item) => item.present !== true).map((item) => item.script);
  const packageTypescriptAvailable = base.package_checks.every((item) => item.local_typescript_available === true);
  const passed = base.passed === true && missingScripts.length === 0 && packageTypescriptAvailable;

  return {
    passed,
    node_check: base.node_check,
    package_checks: base.package_checks,
    root_script_checks: rootScriptChecks,
    required_commands: [
      "node --check packages/evals/bin/darkquest-eval.mjs",
      "npm run test:adapter",
      "npm run test:recorder",
      "npm run typecheck",
      "npm run physical:validate",
      "npm run verify:physical",
      "npm run gate:1c"
    ],
    command_results_recorded_by_runner: false,
    blocker:
      passed === true
        ? null
        : packageTypescriptAvailable
          ? `Missing root scripts: ${missingScripts.join(", ") || "none"}.`
          : "Package-local TypeScript runtime is not installed for one or more TypeScript packages.",
    disclosures: [
      ...base.disclosures,
      ...missingScripts.map((script) =>
        disclosure("root_script_missing", `Required root script is missing: ${script}.`, `package.json.scripts.${script}`, "medium")
      )
    ]
  };
}

function gate1CWaiverResult(staticValidation) {
  const waiverPath = resolve(STATIC_VALIDATION_WAIVER_PATH);
  if (staticValidation.passed === true) {
    return {
      required: false,
      exists: existsSync(waiverPath),
      accepted: false,
      path: STATIC_VALIDATION_WAIVER_PATH,
      status: "not_required"
    };
  }
  if (!existsSync(waiverPath)) {
    return {
      required: true,
      exists: false,
      accepted: false,
      path: STATIC_VALIDATION_WAIVER_PATH,
      status: "missing"
    };
  }

  const text = readFileSync(waiverPath, "utf8");
  const humanLine = text.match(/^Human acceptance:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const accepted = /^(accepted|approved|yes)\b/i.test(humanLine) && !/pending|not accepted|unapproved/i.test(humanLine);
  return {
    required: true,
    exists: true,
    accepted,
    path: STATIC_VALIDATION_WAIVER_PATH,
    status: accepted ? "accepted" : "pending_human_acceptance",
    human_acceptance: humanLine || null
  };
}

function gate1CPolishApprovalResult(finalVerdict, context) {
  const approved = finalVerdict === "PASS" || finalVerdict === "PASS_WITH_DISCLOSURE";
  return {
    approved,
    status: finalVerdict === "PASS" ? "approved" : finalVerdict === "PASS_WITH_DISCLOSURE" ? "approved_with_disclosure" : "blocked",
    minimal_state_backed_hud_polish: approved,
    cinematic_hud_polish: false,
    reason: approved
      ? "Gate 1C replay/privacy/model/memory/HUD checks passed; static disclosure governs scope."
      : `Gate 1C final verdict is ${finalVerdict}.`,
    physical_trace_passed: context.physicalTraceResult.passed,
    static_validation_passed: context.staticValidation.passed,
    static_validation_waiver_accepted: context.waiver.accepted
  };
}

function runGate1BEntry(entry, manifestDir, defaultRepeat) {
  const result = runGate1AEntry(entry, manifestDir, defaultRepeat);
  const browserGenerated = entry.browser_generated === true;
  const recoveryKind = recoveryKindForFixture(entry.fixture ?? entry.path, result.fixture_id);
  result.browser_generated = browserGenerated;
  result.recovery_kind = recoveryKind;

  if (result.status !== "evaluated") {
    return result;
  }

  const raw = readFileSync(result.resolved_path, "utf8");
  const fixture = JSON.parse(raw);
  const gate1BChecks = runGate1BChecks(fixture, result.replay_report, entry, result);
  const allFailures = dedupeFailures([...(result.failures ?? []), ...gate1BChecks.failures]);
  const actualFailureCodes = [...new Set(allFailures.map((item) => item.code))].sort();
  const expectedFailureCodes = result.expected_failure_codes ?? [];
  const actualResult = actualFailureCodes.length > 0 || result.replay_report.verdict === "FAIL" ? "FAIL" : result.replay_report.verdict;
  const missingFailureCodes = expectedFailureCodes.filter((code) => !actualFailureCodes.includes(code));
  const unexpectedFailureCodes = actualFailureCodes.filter((code) => !expectedFailureCodes.includes(code));
  const exactCodeMatch = missingFailureCodes.length === 0 && unexpectedFailureCodes.length === 0;
  const resultMatch = actualResult === result.expected_result;
  const rawMediaCodes = new Set(["raw_media_persistence_violation", "raw_media_evidence", "base64_media_detected", "screenshot_detected"]);
  const modelCodes = new Set(["unexpected_model_call"]);

  return {
    ...result,
    actual_result: actualResult,
    actual_failure_codes: actualFailureCodes,
    exact_failure_code_matching_result: {
      passed: exactCodeMatch && resultMatch,
      result_match: resultMatch,
      missing_failure_codes: missingFailureCodes,
      unexpected_failure_codes: unexpectedFailureCodes
    },
    raw_media_check: {
      ...(result.raw_media_check ?? {}),
      passed: !actualFailureCodes.some((code) => rawMediaCodes.has(code)),
      failure_codes: actualFailureCodes.filter((code) => rawMediaCodes.has(code))
    },
    model_call_check: {
      ...(result.model_call_check ?? {}),
      passed: !actualFailureCodes.some((code) => modelCodes.has(code)),
      failure_codes: actualFailureCodes.filter((code) => modelCodes.has(code))
    },
    latency_result: {
      ...(result.latency_result ?? {}),
      passed: result.latency_result?.passed !== false && gate1BChecks.browser_latency_result.passed !== false
    },
    browser_trace_check: gate1BChecks.browser_trace_check,
    browser_latency_result: gate1BChecks.browser_latency_result,
    occlusion_recovery_check: gate1BChecks.occlusion_recovery_check,
    camera_bump_reset_check: gate1BChecks.camera_bump_reset_check,
    gate_1b_disclosures: gate1BChecks.disclosures,
    failures: allFailures
  };
}

function runGate1BChecks(fixture, replayReport, entry, baseResult) {
  const checks = [
    checkBrowserTraceOrigin(fixture, entry),
    checkBrowserLatency(fixture, entry),
    checkOcclusionRecovery(fixture, replayReport, entry, baseResult),
    checkCameraBumpReset(fixture, replayReport, entry, baseResult)
  ];
  const failures = dedupeFailures(checks.flatMap((check) => check.failures ?? []));
  const disclosures = checks.flatMap((check) => check.disclosures ?? []);

  return {
    failure_codes: [...new Set(failures.map((item) => item.code))].sort(),
    failures,
    disclosures,
    browser_trace_check: checks[0],
    browser_latency_result: checks[1],
    occlusion_recovery_check: checks[2],
    camera_bump_reset_check: checks[3]
  };
}

function checkBrowserTraceOrigin(fixture, entry) {
  const failures = [];
  if (entry.browser_generated !== true) {
    return { passed: true, skipped: true, failure_codes: [], failures };
  }

  const origin = fixture.trace_origin;
  if (!isPlainObject(origin)) {
    failures.push(failure("browser_trace_origin_missing", "Browser-generated fixtures require trace_origin metadata.", "trace_origin", "critical"));
    return browserCheckResult(failures);
  }

  if (origin.source !== "browser.local_camera" || origin.manual_fixture !== false) {
    failures.push(failure("browser_trace_origin_missing", "Browser trace origin must be source=browser.local_camera and manual_fixture=false.", "trace_origin", "critical"));
  }
  if (origin.raw_media_persisted !== false) {
    failures.push(failure("raw_media_persistence_violation", "Browser trace origin reports raw media persistence.", "trace_origin.raw_media_persisted", "critical"));
  }
  if (origin.cloud_calls_enabled !== false) {
    failures.push(failure("unexpected_model_call", "Browser trace origin reports cloud calls enabled.", "trace_origin.cloud_calls_enabled", "critical"));
  }

  return browserCheckResult(failures);
}

function checkBrowserLatency(fixture, entry) {
  const failures = [];
  const disclosures = [];
  if (entry.browser_generated !== true) {
    return { passed: true, skipped: true, failure_codes: [], failures, disclosures };
  }

  const latency = normalizeBrowserLatency(fixture.metrics);
  if (!latency) {
    failures.push(failure("browser_latency_missing", "Browser-generated fixtures require browser latency records or summary metrics.", "metrics", "critical"));
    return browserCheckResult(failures, disclosures);
  }

  for (const field of ["p50_ms", "p95_ms", "max_ms", "sample_count"]) {
    if (typeof latency[field] !== "number") {
      failures.push(failure("browser_latency_missing", `Browser latency ${field} must be numeric.`, `metrics.browser_latency.${field}`, "critical"));
    }
  }
  if (typeof latency.sample_count === "number" && latency.sample_count <= 0) {
    failures.push(failure("browser_latency_missing", "Browser latency sample_count must be greater than zero.", "metrics.browser_latency.sample_count", "critical"));
  }

  if (typeof latency.p50_ms === "number" && latency.p50_ms > BROWSER_LATENCY_THRESHOLDS_MS.p50) {
    failures.push(failure("browser_latency_threshold_exceeded", `Browser p50 latency ${latency.p50_ms}ms exceeds ${BROWSER_LATENCY_THRESHOLDS_MS.p50}ms.`, "metrics.browser_latency.p50_ms", "high"));
  }
  if (typeof latency.p95_ms === "number" && latency.p95_ms > BROWSER_LATENCY_THRESHOLDS_MS.p95) {
    failures.push(failure("browser_latency_threshold_exceeded", `Browser p95 latency ${latency.p95_ms}ms exceeds ${BROWSER_LATENCY_THRESHOLDS_MS.p95}ms.`, "metrics.browser_latency.p95_ms", "high"));
  }
  if (typeof latency.max_ms === "number" && latency.max_ms > BROWSER_LATENCY_THRESHOLDS_MS.max) {
    failures.push(failure("browser_latency_threshold_exceeded", `Browser max latency ${latency.max_ms}ms exceeds ${BROWSER_LATENCY_THRESHOLDS_MS.max}ms.`, "metrics.browser_latency.max_ms", "high"));
  }
  if ((latency.llm_calls ?? 0) !== 0 || (latency.vlm_calls ?? 0) !== 0) {
    failures.push(failure("unexpected_model_call", "Browser latency record reports nonzero model calls.", "metrics.browser_latency", "critical"));
  }
  if ((latency.raw_media_persistence_count ?? 0) !== 0) {
    failures.push(failure("raw_media_persistence_violation", "Browser latency record reports raw media persistence.", "metrics.browser_latency", "critical"));
  }
  if (typeof latency.dropped_frames === "number" && latency.dropped_frames > 0) {
    disclosures.push(disclosure("browser_dropped_frames_disclosed", `Browser trace reports ${latency.dropped_frames} dropped frames.`, "metrics.browser_latency.dropped_frames", "medium"));
  }

  return browserCheckResult(failures, disclosures, latency);
}

function normalizeBrowserLatency(metrics) {
  if (!isPlainObject(metrics)) return null;

  if (Array.isArray(metrics.browser_latency_records) && metrics.browser_latency_records.length > 0) {
    const values = metrics.browser_latency_records
      .map((record) => record?.end_to_end_ms)
      .filter((value) => typeof value === "number")
      .sort((a, b) => a - b);
    if (values.length === 0) return null;
    return {
      p50_ms: typeof metrics.p50_latency_ms === "number" ? metrics.p50_latency_ms : percentile(values, 0.5),
      p95_ms: typeof metrics.p95_latency_ms === "number" ? metrics.p95_latency_ms : percentile(values, 0.95),
      max_ms: typeof metrics.max_latency_ms === "number" ? metrics.max_latency_ms : values[values.length - 1],
      sample_count: values.length,
      dropped_frames: metrics.browser_latency_records.reduce((sum, record) => sum + (Number(record?.dropped_frames) || 0), 0),
      llm_calls: metrics.browser_latency_records.reduce((sum, record) => sum + (Number(record?.llm_calls) || 0), 0),
      vlm_calls: metrics.browser_latency_records.reduce((sum, record) => sum + (Number(record?.vlm_calls) || 0), 0),
      raw_media_persistence_count: metrics.browser_latency_records.reduce((sum, record) => sum + (Number(record?.raw_media_persistence_count) || 0), 0),
      source: "browser_latency_records"
    };
  }

  const legacy = metrics.browser_latency;
  if (isPlainObject(legacy)) {
    return {
      p50_ms: typeof legacy.p50_ms === "number" ? legacy.p50_ms : legacy.p50_end_to_end_ms,
      p95_ms: typeof legacy.p95_ms === "number" ? legacy.p95_ms : legacy.p95_end_to_end_ms,
      max_ms: typeof legacy.max_ms === "number" ? legacy.max_ms : legacy.max_end_to_end_ms,
      sample_count: typeof legacy.sample_count === "number" ? legacy.sample_count : legacy.event_count ?? 0,
      dropped_frames: legacy.dropped_frames ?? 0,
      llm_calls: legacy.llm_calls ?? 0,
      vlm_calls: legacy.vlm_calls ?? 0,
      raw_media_persistence_count: legacy.raw_media_persistence_count ?? 0,
      source: "browser_latency"
    };
  }

  return null;
}

function checkOcclusionRecovery(fixture, replayReport, entry, baseResult) {
  const failures = [];
  const recoveryKind = recoveryKindForFixture(entry.fixture ?? entry.path, fixture.fixture_id);
  if (recoveryKind !== "occlusion") {
    return { passed: true, skipped: true, failure_codes: [], failures };
  }

  const expectedPass = baseResult.expected_result === "PASS";
  const inputEvents = fixture.input_events ?? [];
  const uncertainty = inputEvents.find(
    (event) => event.type === "scene.uncertain" && event.payload?.uncertainty_kind === "occlusion"
  );

  if (!uncertainty) {
    if (expectedPass) {
      failures.push(failure("occlusion_recovery_missing", "Occlusion recovery fixture must include scene.uncertain with uncertainty_kind=occlusion.", "input_events", "critical"));
    }
    return recoveryCheckResult(failures);
  }

  const recovery = inputEvents.find((event) => event.timestamp_ms > uncertainty.timestamp_ms && isOcclusionRecoverySignal(event));
  const progressDuringUncertainty = questTransitionsTriggeredBetween(
    replayReport.observed?.quest_transitions ?? [],
    inputEvents,
    uncertainty.timestamp_ms,
    recovery?.timestamp_ms ?? Number.POSITIVE_INFINITY
  );

  if (progressDuringUncertainty.length > 0) {
    failures.push(failure("quest_progress_during_uncertainty", "Quest progress occurred while occlusion uncertainty was active.", "observed.quest_transitions", "critical"));
  }
  if (expectedPass && !recovery) {
    failures.push(failure("occlusion_recovery_missing", "Occlusion recovery fixture must include a symbolic recovery signal after uncertainty.", "input_events", "critical"));
  }

  return recoveryCheckResult(failures);
}

function checkCameraBumpReset(fixture, replayReport, entry, baseResult) {
  const failures = [];
  const recoveryKind = recoveryKindForFixture(entry.fixture ?? entry.path, fixture.fixture_id);
  if (recoveryKind !== "camera_bump") {
    return { passed: true, skipped: true, failure_codes: [], failures };
  }

  const expectedPass = baseResult.expected_result === "PASS";
  const inputEvents = fixture.input_events ?? [];
  const reset = inputEvents.find((event) => event.type === "scene.reset" && event.payload?.reset_reason === "camera_bump");

  if (!reset) {
    if (expectedPass) {
      failures.push(failure("camera_bump_reset_missing", "Camera bump fixture must include scene.reset with reset_reason=camera_bump.", "input_events", "critical"));
    }
    return recoveryCheckResult(failures);
  }

  const recalibration = inputEvents.find((event) => event.type === "scene.calibrated" && event.timestamp_ms > reset.timestamp_ms);
  const staleProgress = questTransitionsTriggeredBetween(
    replayReport.observed?.quest_transitions ?? [],
    inputEvents,
    reset.timestamp_ms,
    recalibration?.timestamp_ms ?? Number.POSITIVE_INFINITY
  );

  if (staleProgress.length > 0) {
    failures.push(failure("stale_zone_truth_after_reset", "Quest progress used stale zone truth after camera bump reset and before recalibration.", "observed.quest_transitions", "critical"));
  }
  if (expectedPass && !recalibration) {
    failures.push(failure("camera_bump_recalibration_missing", "Camera bump recovery must recalibrate before accepting new zone truth.", "input_events", "critical"));
  }

  return recoveryCheckResult(failures);
}

function browserCheckResult(failures, disclosures = [], latency = null) {
  return {
    passed: failures.length === 0,
    failure_codes: [...new Set(failures.map((item) => item.code))].sort(),
    failures,
    disclosures,
    observed_latency: latency
  };
}

function recoveryCheckResult(failures) {
  return {
    passed: failures.length === 0,
    failure_codes: [...new Set(failures.map((item) => item.code))].sort(),
    failures
  };
}

function recoveryKindForFixture(fixturePath = "", fixtureId = "") {
  const combined = `${fixturePath} ${fixtureId}`.toLowerCase();
  if (combined.includes("occlusion")) return "occlusion";
  if (combined.includes("camera_bump") || combined.includes("camera-bump")) return "camera_bump";
  return null;
}

function isOcclusionRecoverySignal(event) {
  if (event.type === "scene.calibrated") return true;
  if (event.type === "hand.entered_zone") return true;
  if (event.type === "object.placed") return true;
  if (event.type !== "confidence.changed") return false;
  return event.payload?.current_confidence >= 0.75;
}

function questTransitionsTriggeredBetween(transitions, inputEvents, startMs, endMs) {
  const eventsById = new Map(inputEvents.map((event) => [event.id, event]));
  return transitions.filter((transition) => {
    const trigger = eventsById.get(transition.trigger_event_id);
    return trigger && trigger.timestamp_ms > startMs && trigger.timestamp_ms < endMs;
  });
}

function aggregateRecoveryResult(results, recoveryKind) {
  const required = results.filter((result) => result.category === "required" && result.recovery_kind === recoveryKind);
  const evaluated = required.filter((result) => result.status === "evaluated");
  const missing = required.filter((result) => result.status !== "evaluated");
  const checkKey = recoveryKind === "occlusion" ? "occlusion_recovery_check" : "camera_bump_reset_check";
  return {
    passed: missing.length === 0 && evaluated.length > 0 && evaluated.every((result) => result[checkKey]?.passed === true),
    required_fixture_count: required.length,
    evaluated_count: evaluated.length,
    missing_fixtures: missing.map((result) => result.fixture),
    failed_fixtures: evaluated.filter((result) => result[checkKey]?.passed !== true).map((result) => result.fixture_id ?? result.fixture)
  };
}

function aggregateBrowserLatencyResult(browserAcceptanceResults) {
  if (browserAcceptanceResults.length === 0) {
    return {
      passed: false,
      evaluated_count: 0,
      thresholds_ms: BROWSER_LATENCY_THRESHOLDS_MS,
      failed_fixtures: [],
      observed: []
    };
  }

  return {
    passed: browserAcceptanceResults.every((result) => result.browser_latency_result?.passed === true),
    evaluated_count: browserAcceptanceResults.length,
    thresholds_ms: BROWSER_LATENCY_THRESHOLDS_MS,
    failed_fixtures: browserAcceptanceResults
      .filter((result) => result.browser_latency_result?.passed !== true)
      .map((result) => result.fixture_id ?? result.fixture),
    observed: browserAcceptanceResults.map((result) => ({
      fixture_id: result.fixture_id,
      latency: result.browser_latency_result?.observed_latency ?? null
    }))
  };
}

function gate1BStaticValidationResult() {
  const packageChecks = [
    {
      package_json: "packages/perception/live-perception-adapter/package.json",
      required_script: "build",
      requires_typescript: true
    },
    {
      package_json: "packages/perception/browser-local-capture/package.json",
      required_script: "build",
      requires_typescript: true
    },
    {
      package_json: "packages/replay/live-trace-recorder/package.json",
      required_script: "build",
      requires_typescript: true
    },
    {
      package_json: "packages/perception/event-stabilizer/package.json",
      required_script: "build",
      requires_typescript: true
    }
  ].map((item) => staticPackageCheck(item));
  const disclosures = [];

  for (const item of packageChecks) {
    if (item.requires_typescript && item.local_typescript_available !== true) {
      disclosures.push(disclosure("typescript_compile_disclosed", `TypeScript compile not executed for ${item.package_json}: local TypeScript runtime is not installed.`, item.package_json, "medium"));
    }
  }

  return {
    passed: packageChecks.every(
      (item) =>
        item.package_present === true &&
        item.required_script_present === true &&
        (!item.requires_typescript || item.local_typescript_available === true)
    ),
    node_check: {
      passed: true,
      command: "node --check packages/evals/bin/darkquest-eval.mjs"
    },
    package_checks: packageChecks,
    disclosures
  };
}

function staticPackageCheck(item) {
  const packagePath = resolve(item.package_json);
  if (!existsSync(packagePath)) {
    return {
      ...item,
      package_present: false,
      required_script_present: false,
      typescript_declared: false,
      local_typescript_available: false
    };
  }

  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const packageDir = dirname(packagePath);
  const typescriptDeclared = Boolean(packageJson.devDependencies?.typescript || packageJson.dependencies?.typescript);
  const localTypeScriptAvailable =
    existsSync(resolve(packageDir, "node_modules/typescript/bin/tsc")) ||
    existsSync(resolve(packageDir, "node_modules/.bin/tsc"));

  return {
    ...item,
    package_present: true,
    required_script_present: typeof packageJson.scripts?.[item.required_script] === "string",
    typescript_declared: typescriptDeclared,
    local_typescript_available: localTypeScriptAvailable
  };
}

function runGate1AEntry(entry, manifestDir, defaultRepeat) {
  const fixturePath = entry.fixture ?? entry.path;
  const resolvedPath = resolveFixturePath(manifestDir, fixturePath);
  const category = entry.category;
  const expectedResult = entry.expected_result ?? entry.expected_verdict ?? "PASS";
  const expectedFailureCodes = entry.expected_failure_codes ?? [];

  if (!existsSync(resolvedPath)) {
    return {
      fixture: fixturePath,
      resolved_path: resolvedPath,
      category,
      expected_result: expectedResult,
      expected_failure_codes: expectedFailureCodes,
      status:
        category === "required"
          ? "missing_required"
          : category === "recommended"
            ? "missing_recommended"
            : category === "regression"
              ? "missing_regression"
              : "missing_adversarial",
      actual_result: "MISSING",
      actual_failure_codes: [],
      exact_failure_code_matching_result: {
        passed: false,
        missing_failure_codes: expectedFailureCodes,
        unexpected_failure_codes: []
      }
    };
  }

  const repeat = entry.repeat ?? defaultRepeat;
  const raw = readFileSync(resolvedPath, "utf8");
  const fixture = JSON.parse(raw);
  const replayReport = runReplay(resolvedPath, repeat);
  const gateChecks = runGate1AChecks(fixture, replayReport);
  const actualFailureCodes = gateChecks.failure_codes;
  const actualResult = actualFailureCodes.length > 0 || replayReport.verdict === "FAIL" ? "FAIL" : replayReport.verdict;
  const missingFailureCodes = expectedFailureCodes.filter((code) => !actualFailureCodes.includes(code));
  const unexpectedFailureCodes = actualFailureCodes.filter((code) => !expectedFailureCodes.includes(code));
  const exactCodeMatch = missingFailureCodes.length === 0 && unexpectedFailureCodes.length === 0;
  const resultMatch = actualResult === expectedResult;

  return {
    fixture_id: fixture.fixture_id ?? "unknown_fixture",
    fixture: fixturePath,
    resolved_path: resolvedPath,
    category,
    status: "evaluated",
    expected_result: expectedResult,
    actual_result: actualResult,
    expected_failure_codes: expectedFailureCodes,
    actual_failure_codes: actualFailureCodes,
    exact_failure_code_matching_result: {
      passed: exactCodeMatch && resultMatch,
      result_match: resultMatch,
      missing_failure_codes: missingFailureCodes,
      unexpected_failure_codes: unexpectedFailureCodes
    },
    schema_validation_result: replayReport.schema_validation,
    event_validation_result: replayReport.event_validation,
    replay_result: { passed: replayReport.verdict !== "FAIL", verdict: replayReport.verdict },
    deterministic_repeat_result: replayReport.deterministic_replay_result,
    deterministic_hashes: replayReport.deterministic_replay_result?.normalized_hashes ?? [],
    raw_media_check: gateChecks.raw_media_check,
    model_call_check: gateChecks.model_call_check,
    memory_policy_check: gateChecks.memory_policy_check,
    hud_honesty_check: gateChecks.hud_honesty_check,
    cost_result: gateChecks.cost_result,
    latency_result: gateChecks.latency_result,
    cost_latency: gateChecks.cost_latency,
    privacy_check: gateChecks.privacy_check,
    failures: gateChecks.failures,
    replay_report: replayReport
  };
}

function runGate1AChecks(fixture, replayReport) {
  const failures = [];
  failures.push(...mapReplayFailuresForGate1A(replayReport, fixture));
  failures.push(...scanGate1AEventValidation(fixture));
  failures.push(...scanLivePrivacy(fixture, "$"));
  failures.push(...checkGate1AMemory(fixture));
  failures.push(...checkGate1AHudHonesty(fixture, replayReport));
  failures.push(...checkGate1AModelCalls(fixture, replayReport));
  failures.push(...checkGate1ACostLatency(fixture, replayReport));
  const uniqueFailures = dedupeFailures(failures);
  const failureCodes = [...new Set(uniqueFailures.map((item) => item.code))].sort();
  const rawMediaCodes = new Set([
    "raw_media_persistence_violation",
    "raw_audio_persistence_violation",
    "base64_media_detected",
    "screenshot_detected",
    "notebook_text_detected",
    "raw_media_evidence",
    "cloud_evidence_marked_local"
  ]);
  const modelCodes = new Set(["unexpected_model_call"]);
  const memoryCodes = new Set([
    "memory_write_without_evidence",
    "memory_write_missing_ttl",
    "memory_write_missing_privacy_classification",
    "raw_frame_memory_forbidden",
    "raw_audio_memory_forbidden",
    "notebook_text_memory_forbidden",
    "correction_not_prioritized"
  ]);
  const hudCodes = new Set([
    "uncertainty_hidden_from_hud",
    "reset_hidden_from_hud",
    "hud_progress_without_state",
    "quest_complete_without_support",
    "low_confidence_hidden",
    "cloud_status_mismatch",
    "raw_media_status_mismatch"
  ]);
  const costLatencyCodes = new Set(["latency_cost_missing", "unexpected_model_call", "raw_media_persistence_violation"]);

  return {
    failure_codes: failureCodes,
    failures: uniqueFailures,
    raw_media_check: {
      passed: !failureCodes.some((code) => rawMediaCodes.has(code)),
      failure_codes: failureCodes.filter((code) => rawMediaCodes.has(code))
    },
    model_call_check: {
      passed: !failureCodes.some((code) => modelCodes.has(code)),
      failure_codes: failureCodes.filter((code) => modelCodes.has(code))
    },
    memory_policy_check: {
      passed: !failureCodes.some((code) => memoryCodes.has(code)),
      failure_codes: failureCodes.filter((code) => memoryCodes.has(code))
    },
    hud_honesty_check: {
      passed: !failureCodes.some((code) => hudCodes.has(code)),
      failure_codes: failureCodes.filter((code) => hudCodes.has(code))
    },
    cost_result: {
      passed: !failureCodes.some((code) => costLatencyCodes.has(code)),
      observed_llm_calls: replayReport.model_call_result?.llm_calls ?? 0,
      observed_vlm_calls: replayReport.model_call_result?.vlm_calls ?? 0,
      observed_cost_usd: replayReport.model_call_result?.estimated_cost_usd ?? 0
    },
    latency_result: {
      passed: replayReport.latency_cost_result?.records_present === true,
      replay_runtime_ms: replayReport.latency_cost_result?.replay_runtime_ms ?? null,
      p50_latency_ms: fixture.metrics?.p50_latency_ms ?? null,
      p95_latency_ms: fixture.metrics?.p95_latency_ms ?? null
    },
    cost_latency: {
      observed_llm_calls: replayReport.model_call_result?.llm_calls ?? 0,
      observed_vlm_calls: replayReport.model_call_result?.vlm_calls ?? 0,
      observed_cost_usd: replayReport.model_call_result?.estimated_cost_usd ?? 0,
      replay_runtime_ms: replayReport.latency_cost_result?.replay_runtime_ms ?? null,
      p50_latency_ms: fixture.metrics?.p50_latency_ms ?? null,
      p95_latency_ms: fixture.metrics?.p95_latency_ms ?? null,
      raw_media_persistence_count: failureCodes.filter((code) => rawMediaCodes.has(code)).length
    },
    privacy_check: {
      raw_media_persistence_count: failureCodes.filter((code) => rawMediaCodes.has(code)).length
    }
  };
}

function mapReplayFailuresForGate1A(replayReport, fixture) {
  const failures = [];
  const specificEventCodes = new Set(scanGate1AEventValidation(fixture).map((item) => item.code));
  const hasSpecificEventCode = specificEventCodes.size > 0;

  for (const item of replayReport.failures ?? []) {
    if (item.code === "raw_media_persistence") {
      failures.push(failure("raw_media_persistence_violation", item.message, item.path, item.severity));
    } else if (item.code === "memory_write_without_ttl") {
      failures.push(failure("memory_write_missing_ttl", item.message, item.path, item.severity));
    } else if (item.code === "hud_uncertainty_hidden") {
      failures.push(failure("uncertainty_hidden_from_hud", item.message, item.path, item.severity));
    } else if (item.code === "model_call_without_permission" || item.code === "unexpected_model_call") {
      failures.push(failure("unexpected_model_call", item.message, item.path, item.severity));
    } else if (item.code === "event_schema_invalid" && !hasSpecificEventCode) {
      failures.push(failure("event_schema_invalid", item.message, item.path, item.severity));
    } else if (item.code === "unexpected_stable_event" && item.message.includes("agent.escalation_requested")) {
      failures.push(failure("unexpected_model_call", item.message, item.path, item.severity));
    } else if (item.code === "unknown_event_type" && specificEventCodes.has("experimental_state_event")) {
      continue;
    } else if (item.code !== "event_schema_invalid") {
      failures.push(failure(item.code, item.message, item.path, item.severity));
    }
  }

  return failures;
}

function scanGate1AEventValidation(fixture) {
  const failures = [];
  const seenIds = new Set();
  let previousTimestamp = -1;

  (fixture.input_events ?? []).forEach((event, index) => {
    const path = `input_events[${index}]`;
    const isExperimental = event?.type?.startsWith("experimental.") || event?.experimental === true || event?.payload?.experimental === true;

    if (seenIds.has(event?.id)) {
      failures.push(failure("duplicate_event_id", `Duplicate event id: ${event.id}.`, `${path}.id`, "critical"));
    }
    seenIds.add(event?.id);

    if (Number.isInteger(event?.timestamp_ms) && event.timestamp_ms < previousTimestamp) {
      failures.push(failure("non_monotonic_timestamps", "Input event timestamps must be monotonic non-decreasing.", `${path}.timestamp_ms`, "critical"));
    }
    if (Number.isInteger(event?.timestamp_ms)) previousTimestamp = event.timestamp_ms;

    if (isExperimental) {
      failures.push(failure("experimental_state_event", "Experimental observations must not enter replay input_events.", path, "critical"));
      return;
    }

    if (event?.type && !(event.type in REQUIRED_PAYLOAD_FIELDS)) {
      failures.push(failure("unknown_event_type", `Unknown event type: ${event.type}.`, `${path}.type`, "critical"));
    }
  });

  return failures;
}

function scanLivePrivacy(value, path) {
  const failures = [];
  if (path === "$.forbidden" || path.startsWith("$.forbidden.")) return failures;
  if (typeof value === "string") {
    failures.push(...scanLivePrivacyString(value, path));
    return failures;
  }

  if (!value || typeof value !== "object") return failures;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    const loweredKey = key.toLowerCase();

    if (key === "contains_raw_video" && child === true) {
      failures.push(failure("raw_media_persistence_violation", "Live fixture declares raw video content.", childPath, "critical"));
    }
    if (key === "contains_audio" && child === true) {
      failures.push(failure("raw_audio_persistence_violation", "Live fixture declares audio content.", childPath, "critical"));
    }
    if (key === "contains_raw_media" && child !== false) {
      failures.push(failure("raw_media_evidence", "Evidence must not contain raw media.", childPath, "critical"));
    }
    if (["screenshot", "image", "jpeg", "jpg", "png", "webcam_frame", "full_image"].includes(loweredKey)) {
      failures.push(failure("screenshot_detected", `Image-like key is forbidden in live fixture: ${key}.`, childPath, "critical"));
    }
    if (["frame", "raw_frame"].includes(loweredKey)) {
      failures.push(failure("raw_media_evidence", `Raw frame-like key is forbidden in live fixture: ${key}.`, childPath, "critical"));
    }
    if (["audio", "microphone", "transcript"].includes(loweredKey)) {
      failures.push(failure("raw_audio_persistence_violation", `Audio-like key is forbidden in live fixture: ${key}.`, childPath, "critical"));
    }
    if (["notebook_text", "ocr"].includes(loweredKey)) {
      failures.push(failure("notebook_text_detected", `Notebook text/OCR key is forbidden in live fixture: ${key}.`, childPath, "critical"));
    }
    if (path.includes(".evidence") && loweredKey === "cloud_derived" && child === true) {
      failures.push(failure("cloud_evidence_marked_local", "Cloud-derived evidence cannot be marked local.", childPath, "critical"));
    }
    if (path.includes(".evidence") && loweredKey === "source" && typeof child === "string" && /cloud|vlm/i.test(child)) {
      failures.push(failure("cloud_evidence_marked_local", "Cloud/VLM evidence appeared in a local evidence record.", childPath, "critical"));
    }

    failures.push(...scanLivePrivacy(child, childPath));
  }

  return failures;
}

function scanLivePrivacyString(value, path) {
  const failures = [];
  const lowered = value.toLowerCase();
  if (/^data:(image|video|audio)\//i.test(value)) {
    failures.push(failure("base64_media_detected", "Base64 media data URI is forbidden.", path, "critical"));
  }
  if (looksLikeBase64Media(value, path)) {
    failures.push(failure("base64_media_detected", "Base64-looking media string is forbidden.", path, "critical"));
  }
  if (/\.(png|jpg|jpeg|webp)$/i.test(value) || lowered.includes("screenshot")) {
    failures.push(failure("screenshot_detected", `Screenshot/image reference is forbidden: ${value}.`, path, "critical"));
  }
  if (/\.(mp4|mov|webm)$/i.test(value) || lowered.includes("raw_video")) {
    failures.push(failure("raw_media_persistence_violation", `Raw video reference is forbidden: ${value}.`, path, "critical"));
  }
  if (/\.(wav|mp3)$/i.test(value) || lowered.includes("raw_audio")) {
    failures.push(failure("raw_audio_persistence_violation", `Raw audio reference is forbidden: ${value}.`, path, "critical"));
  }
  if (lowered.includes("raw_frame")) {
    failures.push(failure("raw_media_evidence", `Raw frame evidence is forbidden: ${value}.`, path, "critical"));
  }
  if (lowered.includes("notebook_text") || lowered.includes("notebook text") || lowered.includes("ocr:")) {
    failures.push(failure("notebook_text_detected", `Notebook text/OCR content is forbidden: ${value}.`, path, "critical"));
  }
  if (path.includes(".evidence") && /^(cloud|vlm)[:/_-]/.test(lowered)) {
    failures.push(failure("cloud_evidence_marked_local", `Cloud/VLM evidence reference is forbidden in local evidence: ${value}.`, path, "critical"));
  }
  return failures;
}

function looksLikeBase64Media(value, path) {
  if (!/(image|frame|screenshot|audio|video|payload|evidence)/i.test(path)) return false;
  if (value.length < 96) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function checkGate1AMemory(fixture) {
  const failures = [];
  for (const event of fixture.input_events ?? []) {
    if (event.type !== "memory.write_requested") continue;
    const payload = event.payload ?? {};
    const valueText = JSON.stringify(payload).toLowerCase();
    if (!Array.isArray(payload.evidence_event_ids) || payload.evidence_event_ids.length === 0) {
      failures.push(failure("memory_write_without_evidence", `Memory write ${event.id} lacks evidence_event_ids.`, `input_events.${event.id}.payload.evidence_event_ids`, "critical"));
    }
    if (!Number.isInteger(payload.ttl_days) || payload.ttl_days <= 0) {
      failures.push(failure("memory_write_missing_ttl", `Memory write ${event.id} lacks a valid ttl_days.`, `input_events.${event.id}.payload.ttl_days`, "critical"));
    }
    if (typeof payload.privacy_classification !== "string" || payload.privacy_classification.trim() === "") {
      failures.push(failure("memory_write_missing_privacy_classification", `Memory write ${event.id} lacks privacy_classification.`, `input_events.${event.id}.payload.privacy_classification`, "critical"));
    }
    if (payload.memory_scope === "raw_frame_memory" || valueText.includes("raw_frame")) {
      failures.push(failure("raw_frame_memory_forbidden", `Memory write ${event.id} references raw frame memory.`, `input_events.${event.id}.payload`, "critical"));
    }
    if (payload.memory_scope === "raw_audio_memory" || valueText.includes("raw_audio")) {
      failures.push(failure("raw_audio_memory_forbidden", `Memory write ${event.id} references raw audio memory.`, `input_events.${event.id}.payload`, "critical"));
    }
    if (valueText.includes("notebook_text") || valueText.includes("notebook text") || valueText.includes("ocr")) {
      failures.push(failure("notebook_text_memory_forbidden", `Memory write ${event.id} references notebook text.`, `input_events.${event.id}.payload`, "critical"));
    }
  }

  const correctionEvents = (fixture.input_events ?? []).filter((event) => event.producer === "human_correction");
  const inferredMemoryWrites = (fixture.input_events ?? []).filter(
    (event) => event.type === "memory.write_requested" && event.payload?.promotion_reason === "inferred" && correctionEvents.length > 0
  );
  for (const event of inferredMemoryWrites) {
    failures.push(failure("correction_not_prioritized", `Inferred memory write ${event.id} appears after a human correction.`, `input_events.${event.id}`, "critical"));
  }

  return failures;
}

function checkGate1AHudHonesty(fixture, replayReport) {
  const failures = [];
  const stableEvents = replayReport.observed?.stable_events ?? [];
  const hudCommands = replayReport.observed?.hud_commands ?? [];
  const transitions = replayReport.observed?.quest_transitions ?? [];
  const inputEvents = fixture.input_events ?? [];
  const hasUncertainty = stableEvents.some((event) => event.type === "scene.uncertain") || inputEvents.some((event) => event.type === "scene.uncertain");
  const showsUncertainty = hudCommands.some((command) => command.command_type === "show_uncertain_state" || command.command_type === "show_recovery_state");
  if (hasUncertainty && !showsUncertainty) {
    failures.push(failure("uncertainty_hidden_from_hud", "Scene uncertainty appeared but HUD did not show uncertainty or recovery.", "observed.hud_commands", "critical"));
  }

  const hasReset = stableEvents.some((event) => event.type === "scene.reset") || inputEvents.some((event) => event.type === "scene.reset");
  const showsReset = hudCommands.some((command) => command.command_type === "session_reset" || command.command_type === "show_recovery_state" || command.visual_state === "reset");
  if (hasReset && !showsReset) {
    failures.push(failure("reset_hidden_from_hud", "Scene reset appeared but HUD did not show reset or recovery.", "observed.hud_commands", "critical"));
  }

  for (const event of inputEvents) {
    if (event.type === "quest.step_completed" && event.payload?.step_id === "step_quest_complete" && transitions.length < 6) {
      failures.push(failure("quest_complete_without_support", "Quest complete event appeared without required supporting transitions.", `input_events.${event.id}`, "critical"));
    }
    if (event.type === "hud.command_emitted") {
      const commandType = event.payload?.command_type;
      const relatedStepId = event.payload?.related_step_id;
      const hasState = relatedStepId && transitions.some((transition) => transition.step_id === relatedStepId);
      if ((commandType === "mark_step_complete" || commandType === "quest_complete") && !hasState) {
        failures.push(failure("hud_progress_without_state", `HUD progress command ${event.id} lacks matching quest state.`, `input_events.${event.id}`, "critical"));
      }
      if (event.payload?.cloud_fallback_enabled === true) {
        failures.push(failure("cloud_status_mismatch", `HUD command ${event.id} reports cloud fallback enabled.`, `input_events.${event.id}.payload.cloud_fallback_enabled`, "critical"));
      }
      if (
        event.payload?.raw_video_persisted === true ||
        event.payload?.raw_audio_persisted === true ||
        event.payload?.raw_frame_persisted === true
      ) {
        failures.push(failure("raw_media_status_mismatch", `HUD command ${event.id} reports raw media persisted.`, `input_events.${event.id}.payload`, "critical"));
      }
    }
    if (event.type === "confidence.changed" && event.payload?.current_confidence < 0.65 && !showsUncertainty) {
      failures.push(failure("low_confidence_hidden", `Low confidence event ${event.id} was not reflected by uncertainty HUD.`, `input_events.${event.id}`, "critical"));
    }
  }

  return failures;
}

function checkGate1AModelCalls(fixture, replayReport) {
  const failures = [];
  const llmCalls = replayReport.model_call_result?.llm_calls ?? 0;
  const vlmCalls = replayReport.model_call_result?.vlm_calls ?? 0;
  const costUsd = replayReport.model_call_result?.estimated_cost_usd ?? 0;
  if (llmCalls > 0 || vlmCalls > 0 || costUsd > (fixture.metrics?.max_cost_usd ?? 0)) {
    failures.push(failure("unexpected_model_call", "Gate 1A expected zero unexpected model calls and zero cost.", "model_call_result", "critical"));
  }
  return failures;
}

function checkGate1ACostLatency(fixture, replayReport) {
  const failures = [];
  if (replayReport.latency_cost_result?.records_present !== true) {
    failures.push(failure("latency_cost_missing", "Latency/cost records are missing.", "latency_cost_result", "critical"));
  }
  if ((fixture.metrics?.max_llm_calls ?? 0) !== 0 || (fixture.metrics?.max_vlm_calls ?? 0) !== 0) {
    failures.push(failure("unexpected_model_call", "Gate 1A fixtures must default to zero LLM/VLM budget.", "metrics", "critical"));
  }
  return failures;
}

function dedupeFailures(failures) {
  const seen = new Set();
  const unique = [];
  for (const item of failures) {
    const key = `${item.code}:${item.path}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function aggregateBoolean(results, key) {
  if (results.length === 0) return { passed: false, evaluated_count: 0 };
  return {
    passed: results.every((result) => result[key]?.passed === true),
    evaluated_count: results.length,
    failed_fixtures: results.filter((result) => result[key]?.passed !== true).map((result) => result.fixture_id ?? result.fixture)
  };
}

function runOnce(fixture, fixturePath, buildHash, repeatIndex) {
  const start = performance.now();
  const failures = [];
  const disclosures = [];

  const schemaValidation = validateFixtureSchema(fixture);
  failures.push(...schemaValidation.failures);

  const eventValidation = validateEvents(fixture.input_events ?? []);
  failures.push(...eventValidation.failures);

  const simulate = fixture.expected?.simulate ?? {};
  const stableEvents = schemaValidation.passed && eventValidation.passed
    ? stabilize(fixture.input_events, simulate, repeatIndex)
    : [];

  const stableEventResult = checkExpectedStableEvents(fixture.expected?.stable_events ?? [], stableEvents);
  failures.push(...stableEventResult.failures);

  const quest = runQuest(stableEvents, simulate);
  failures.push(...quest.failures);

  const questTransitionResult = checkExpectedTransitions(fixture.expected?.quest_transitions ?? [], quest.transitions);
  failures.push(...questTransitionResult.failures);

  const hudCommandResult = checkExpectedHudCommands(fixture.expected?.hud_commands ?? [], quest.hudCommands, stableEvents);
  failures.push(...hudCommandResult.failures);

  const memory = checkMemoryPolicy(fixture.expected?.memory_writes ?? [], fixture.input_events ?? []);
  failures.push(...memory.failures);

  const model = checkModelCalls(fixture, fixture.input_events ?? []);
  failures.push(...model.failures);

  const privacy = checkPrivacy(fixture);
  failures.push(...privacy.failures);

  const forbidden = checkForbidden(fixture, {
    stableEvents,
    transitions: quest.transitions,
    hudCommands: quest.hudCommands,
    memoryWrites: memory.writes,
    modelCalls: model.calls
  });
  failures.push(...forbidden.failures);

  const runtimeMs = Math.max(0, Math.round(performance.now() - start));
  const latencyCost = {
    passed: true,
    records_present: true,
    replay_runtime_ms: runtimeMs,
    max_replay_runtime_ms: fixture.metrics?.max_replay_runtime_ms ?? null,
    llm_calls: model.llmCalls,
    vlm_calls: model.vlmCalls,
    estimated_cost_usd: model.estimatedCostUsd
  };

  if (fixture.metrics?.max_replay_runtime_ms !== undefined && runtimeMs > fixture.metrics.max_replay_runtime_ms) {
    latencyCost.passed = false;
    failures.push(failure("replay_runtime_exceeded", `Replay runtime ${runtimeMs}ms exceeded fixture limit ${fixture.metrics.max_replay_runtime_ms}ms.`, "latency_cost_result.replay_runtime_ms", "high"));
  }

  if (!latencyCost.records_present) {
    latencyCost.passed = false;
    failures.push(failure("latency_cost_missing", "Latency/cost records are missing.", "latency_cost_result", "critical"));
  }

  const report = {
    schema: REPORT_SCHEMA,
    fixture_id: fixture.fixture_id ?? "unknown_fixture",
    fixture_path: fixturePath,
    run_id: `run_${fixture.fixture_id ?? "unknown"}_${repeatIndex}`,
    build_hash: `sha256:${buildHash.slice(0, 16)}`,
    verdict: "FAIL",
    schema_validation: withoutFailures(schemaValidation),
    event_validation: withoutFailures(eventValidation),
    stable_event_result: withoutFailures(stableEventResult),
    quest_transition_result: withoutFailures(questTransitionResult),
    hud_command_result: withoutFailures(hudCommandResult),
    memory_policy_result: withoutFailures(memory),
    model_call_result: withoutFailures(model),
    privacy_result: withoutFailures(privacy),
    latency_cost_result: latencyCost,
    deterministic_replay_result: {
      passed: true,
      repeat_count: 1,
      normalized_hashes: [],
      differences: []
    },
    observed: {
      stable_events: stableEvents,
      quest_transitions: quest.transitions,
      hud_commands: quest.hudCommands,
      memory_writes: memory.writes,
      model_calls: model.calls
    },
    failures,
    disclosures
  };

  report.verdict = verdictFor(report);
  return report;
}

function validateFixtureSchema(fixture) {
  const failures = [];
  const required = [...REQUIRED_TOP_LEVEL];

  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
    failures.push(failure("replay_fixture_schema_invalid", "Fixture must be a JSON object.", "$", "critical"));
    return { passed: false, errors: failures, failures };
  }

  for (const key of required) {
    if (!(key in fixture)) {
      failures.push(failure("replay_fixture_schema_invalid", `Missing required top-level field: ${key}.`, key, "critical"));
    }
  }

  for (const key of Object.keys(fixture)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      failures.push(failure("replay_fixture_schema_invalid", `Unknown top-level field in strict mode: ${key}.`, key, "critical"));
    }
  }

  if (fixture.schema !== FIXTURE_SCHEMA) {
    failures.push(failure("replay_fixture_schema_invalid", `Fixture schema must be ${FIXTURE_SCHEMA}.`, "schema", "critical"));
  }

  for (const key of ["fixture_id", "name", "description", "created_by"]) {
    if (typeof fixture[key] !== "string" || fixture[key].trim() === "") {
      failures.push(failure("replay_fixture_schema_invalid", `${key} must be a non-empty string.`, key, "critical"));
    }
  }

  if (!Array.isArray(fixture.input_events)) {
    failures.push(failure("replay_fixture_schema_invalid", "input_events must be an array.", "input_events", "critical"));
  }

  if (fixture.privacy?.contains_raw_video !== false) {
    failures.push(failure("raw_media_persistence", "Gate 0 fixtures must set privacy.contains_raw_video to false.", "privacy.contains_raw_video", "critical"));
  }

  if (fixture.privacy?.contains_audio !== false) {
    failures.push(failure("raw_media_persistence", "Gate 0 fixtures must set privacy.contains_audio to false.", "privacy.contains_audio", "critical"));
  }

  for (const key of ["expected", "forbidden", "metrics"]) {
    if (!fixture[key] || typeof fixture[key] !== "object" || Array.isArray(fixture[key])) {
      failures.push(failure("replay_fixture_schema_invalid", `${key} must be an object.`, key, "critical"));
    }
  }

  for (const key of ["max_llm_calls", "max_vlm_calls", "max_cost_usd", "max_replay_runtime_ms"]) {
    if (typeof fixture.metrics?.[key] !== "number") {
      failures.push(failure("replay_fixture_schema_invalid", `metrics.${key} must be a number.`, `metrics.${key}`, "critical"));
    }
  }

  return {
    passed: failures.length === 0,
    errors: failures,
    failures
  };
}

function validateEvents(events) {
  const failures = [];
  const seenIds = new Set();
  let previousTimestamp = -1;

  events.forEach((event, index) => {
    const path = `input_events[${index}]`;
    const isExperimental = event?.type?.startsWith("experimental.") ||
      event?.experimental === true ||
      event?.ignored_by_state_machine === true ||
      event?.payload?.experimental === true;

    for (const field of ["id", "type", "timestamp_ms", "producer", "confidence", "payload", "evidence"]) {
      if (!(field in event)) {
        failures.push(failure("missing_required_event_field", `Event is missing required field: ${field}.`, `${path}.${field}`, "critical"));
      }
    }

    if (seenIds.has(event.id)) {
      failures.push(failure("duplicate_event_id", `Duplicate event id: ${event.id}.`, `${path}.id`, "critical"));
    }
    seenIds.add(event.id);

    if (isExperimental) {
      failures.push(failure("experimental_state_event", "Experimental observations are forbidden in state-bearing input_events.", path, "critical"));
    }

    if (!isExperimental && !(event.type in REQUIRED_PAYLOAD_FIELDS)) {
      failures.push(failure("unknown_event_type", `Unknown event type: ${event.type}.`, `${path}.type`, "critical"));
    }

    if (!ALLOWED_PRODUCERS.has(event.producer)) {
      failures.push(failure("invalid_event_producer", `Unknown producer: ${event.producer}.`, `${path}.producer`, "critical"));
    }

    if (!Number.isInteger(event.timestamp_ms) || event.timestamp_ms < 0) {
      failures.push(failure("invalid_timestamp", "timestamp_ms must be a non-negative integer.", `${path}.timestamp_ms`, "critical"));
    }

    if (event.timestamp_ms < previousTimestamp) {
      failures.push(failure("non_monotonic_timestamps", "Input event timestamps must be monotonic non-decreasing.", `${path}.timestamp_ms`, "critical"));
    }
    previousTimestamp = event.timestamp_ms;

    if (typeof event.confidence !== "number" || event.confidence < 0 || event.confidence > 1) {
      failures.push(failure("invalid_confidence", "confidence must be between 0 and 1.", `${path}.confidence`, "critical"));
    }

    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      failures.push(failure("payload_shape_mismatch", "payload must be an object.", `${path}.payload`, "critical"));
    }

    if (!Array.isArray(event.evidence)) {
      failures.push(failure("payload_shape_mismatch", "evidence must be an array.", `${path}.evidence`, "critical"));
    }

    for (const field of REQUIRED_PAYLOAD_FIELDS[event.type] ?? []) {
      if (!(field in (event.payload ?? {}))) {
        failures.push(failure("payload_shape_mismatch", `Missing payload field ${field} for ${event.type}.`, `${path}.payload.${field}`, "critical"));
      }
    }

    for (const vague of findVagueKeys(event.payload ?? {}, `${path}.payload`)) {
      failures.push(failure("payload_shape_mismatch", `Vague payload key is forbidden: ${vague.key}.`, vague.path, "critical"));
    }

    for (const raw of findRawMediaRefs(event, path)) {
      failures.push(failure("raw_media_evidence", raw.message, raw.path, "critical"));
    }
  });

  return {
    passed: failures.length === 0,
    validated_event_count: events.length,
    errors: failures,
    failures
  };
}

function stabilize(events, simulate = {}, repeatIndex = 1) {
  const stableEvents = events
    .filter((event) => STABLE_EVENT_TYPES.has(event.type))
    .map((event) => ({ ...event, producer: event.producer === "perception.local" ? "event_stabilizer" : event.producer }));

  if (simulate.nondeterministic_stable_order && repeatIndex % 2 === 0) {
    return [...stableEvents].reverse();
  }

  return stableEvents;
}

function runQuest(stableEvents, simulate = {}) {
  const transitions = [];
  const hudCommands = [];
  const failures = [];
  let currentStepIndex = 0;
  let calibrated = false;
  let uncertaintyActive = false;
  let resetActive = false;

  for (const event of stableEvents) {
    if (event.type === "scene.calibrated" && event.payload.scene_confidence >= 0.8) {
      calibrated = true;
      uncertaintyActive = false;
      resetActive = false;
      continue;
    }

    if (event.type === "scene.uncertain") {
      uncertaintyActive = true;
      if (!simulate.disable_uncertainty_hud) {
        hudCommands.push(hudCommand("hud_show_uncertain_state", "show_uncertain_state", "recovery_banner", "uncertain", "critical", "active_step", [event.id]));
      }
      continue;
    }

    if (event.type === "scene.reset") {
      calibrated = false;
      uncertaintyActive = false;
      resetActive = true;
      hudCommands.push(hudCommand("hud_show_reset_required", "show_recovery_state", "recovery_banner", "reset", "critical", "calibration", [event.id]));
      continue;
    }

    const currentStep = QUEST_STEPS[currentStepIndex];
    if (!currentStep) continue;

    const futureStep = QUEST_STEPS.slice(currentStepIndex + 1).find((step) => step.guard(event));
    const matchesCurrent = currentStep.guard(event);

    if (event.type === "confidence.changed" && event.payload?.current_confidence >= 0.65) {
      uncertaintyActive = false;
      continue;
    }

    if (uncertaintyActive && (matchesCurrent || futureStep)) {
      failures.push(failure("quest_progress_during_uncertainty", `Quest evidence ${event.id} appeared while uncertainty was active.`, `input_events.${event.id}`, "critical"));
      continue;
    }

    if (resetActive && !calibrated && (matchesCurrent || futureStep)) {
      failures.push(failure("stale_zone_truth_after_reset", `Quest evidence ${event.id} appeared after reset before recalibration.`, `input_events.${event.id}`, "critical"));
      continue;
    }

    if (!calibrated) continue;

    if (futureStep) {
      failures.push(failure("quest_transition_out_of_order", `${futureStep.step_id} evidence appeared before ${currentStep.step_id}.`, `input_events.${event.id}`, "high"));
      continue;
    }

    if (!matchesCurrent) continue;

    const transition = transitionForStep(currentStep, event);
    transitions.push(transition);
    hudCommands.push(hudCommand(currentStep.hud_command_id, currentStep.hud_command_type, "quest_panel", "complete", "high", currentStep.step_id, [transition.emitted_event_id]));
    currentStepIndex += 1;
  }

  if (currentStepIndex === QUEST_STEPS.length) {
    const previous = transitions[transitions.length - 1];
    const finalEvent = {
      id: `evt_${FINAL_STEP.step_id}_completed`
    };
    const transition = {
      from_state: FINAL_STEP.from_state,
      to_state: FINAL_STEP.to_state,
      trigger_event_id: previous?.emitted_event_id ?? "missing_prior_step",
      emitted_event_id: finalEvent.id,
      emitted_event_type: "quest.step_completed",
      step_id: FINAL_STEP.step_id
    };
    transitions.push(transition);
    hudCommands.push(hudCommand(FINAL_STEP.hud_command_id, FINAL_STEP.hud_command_type, "quest_panel", "complete", "high", FINAL_STEP.step_id, [transition.emitted_event_id]));
  }

  return { transitions, hudCommands, failures };
}

function transitionForStep(step, event) {
  return {
    from_state: step.from_state,
    to_state: step.to_state,
    trigger_event_id: event.id,
    emitted_event_id: `evt_${step.step_id}_completed`,
    emitted_event_type: "quest.step_completed",
    step_id: step.step_id
  };
}

function hudCommand(commandId, commandType, targetSurface, visualState, priority, relatedStepId, evidenceEventIds) {
  return {
    command_id: commandId,
    command_type: commandType,
    target_surface: targetSurface,
    related_step_id: relatedStepId,
    visual_state: visualState,
    priority,
    evidence_event_ids: evidenceEventIds
  };
}

function checkExpectedStableEvents(expected, stableEvents) {
  const failures = [];
  const matchedIds = new Set();

  for (const matcher of expected) {
    const assertionErrors = validateStableEventMatcher(matcher);
    if (assertionErrors.length) {
      failures.push(failure(
        "stable_event_assertion_too_broad",
        `Expected stable event ${matcherName(matcher)} is too broad: ${assertionErrors.join(", ")}.`,
        "expected.stable_events",
        "critical"
      ));
      continue;
    }

    const matches = stableEvents.filter((event) => eventMatches(event, matcher));
    if (matches.length !== 1) {
      failures.push(failure(
        matches.length === 0 ? "stable_event_missing" : "stable_event_ambiguous",
        `Expected stable event ${matcher.id ?? matcher.expectation_id ?? matcher.type} matched ${matches.length} events.`,
        "expected.stable_events",
        "high"
      ));
      continue;
    }
    matchedIds.add(matches[0].id);
  }

  const unexpected = stableEvents.filter((event) => !matchedIds.has(event.id) && STATE_CHANGING_STABLE_TYPES.has(event.type));
  for (const event of unexpected) {
    failures.push(failure("unexpected_stable_event", `Unexpected stable event emitted: ${event.id}.`, `observed.stable_events.${event.id}`, "high"));
  }

  return {
    passed: failures.length === 0,
    expected_count: expected.length,
    matched_count: matchedIds.size,
    unexpected,
    failures
  };
}

function checkExpectedTransitions(expected, observed) {
  const failures = [];
  const matched = [];

  expected.forEach((matcher, index) => {
    const assertionErrors = validateTransitionMatcher(matcher);
    if (assertionErrors.length) {
      failures.push(failure(
        "quest_transition_assertion_too_broad",
        `Expected transition ${matcherName(matcher)} is too broad: ${assertionErrors.join(", ")}.`,
        `expected.quest_transitions[${index}]`,
        "critical"
      ));
      return;
    }

    const actual = observed[index];
    if (!actual || !partialMatch(actual, matcher)) {
      failures.push(failure("quest_transition_missing", `Expected transition ${matcher.step_id} was not observed at index ${index}.`, `expected.quest_transitions[${index}]`, "critical"));
      return;
    }
    matched.push(actual);
  });

  if (observed.length > expected.length) {
    failures.push(failure("quest_transition_out_of_order", "Observed extra quest transitions beyond fixture expectations.", "observed.quest_transitions", "high"));
  }

  return {
    passed: failures.length === 0,
    expected_count: expected.length,
    matched_count: matched.length,
    transitions: observed,
    failures
  };
}

function checkExpectedHudCommands(expected, observed, stableEvents) {
  const failures = [];
  const matched = [];

  expected.forEach((matcher, index) => {
    const assertionErrors = validateHudCommandMatcher(matcher);
    if (assertionErrors.length) {
      failures.push(failure(
        "hud_command_assertion_too_broad",
        `Expected HUD command ${matcherName(matcher)} is too broad: ${assertionErrors.join(", ")}.`,
        `expected.hud_commands[${index}]`,
        "critical"
      ));
      return;
    }

    const actual = observed[index];
    if (!actual || !partialMatch(actual, withoutMatcherOnlyFields(matcher))) {
      failures.push(failure("hud_command_missing", `Expected HUD command ${matcher.command_id} was not observed at index ${index}.`, `expected.hud_commands[${index}]`, "high"));
      return;
    }

    if (matcher.evidence_includes) {
      const missing = matcher.evidence_includes.filter((id) => !actual.evidence_event_ids?.includes(id));
      if (missing.length) {
        failures.push(failure("hud_progress_without_evidence", `HUD command ${actual.command_id} is missing evidence ${missing.join(", ")}.`, `observed.hud_commands[${index}].evidence_event_ids`, "critical"));
      }
    }

    matched.push(actual);
  });

  for (const command of observed) {
    if ((command.command_type === "mark_step_complete" || command.command_type === "quest_complete") && !command.evidence_event_ids?.length) {
      failures.push(failure("hud_progress_without_evidence", `HUD command ${command.command_id} implies progress without evidence.`, `observed.hud_commands.${command.command_id}`, "critical"));
    }
  }

  const hasUncertainty = stableEvents.some((event) => event.type === "scene.uncertain");
  const showsUncertainty = observed.some((command) => command.command_type === "show_uncertain_state");
  if (hasUncertainty && !showsUncertainty) {
    failures.push(failure("hud_uncertainty_hidden", "Scene uncertainty was emitted but HUD did not show uncertainty.", "observed.hud_commands", "critical"));
  }

  return {
    passed: failures.length === 0,
    expected_count: expected.length,
    matched_count: matched.length,
    commands: observed,
    failures
  };
}

function checkMemoryPolicy(expected, events) {
  const failures = [];
  const writes = events.filter((event) => event.type === "memory.write_requested");

  for (const write of writes) {
    if (!write.payload.evidence_event_ids?.length) {
      failures.push(failure("memory_write_without_evidence", `Memory write ${write.id} lacks evidence_event_ids.`, `input_events.${write.id}.payload.evidence_event_ids`, "critical"));
    }
    if (!Number.isInteger(write.payload.ttl_days) || write.payload.ttl_days <= 0) {
      failures.push(failure("memory_write_without_ttl", `Memory write ${write.id} lacks a valid ttl_days.`, `input_events.${write.id}.payload.ttl_days`, "critical"));
    }
    if (write.payload.privacy_classification === "forbidden_raw_media") {
      failures.push(failure("raw_media_persistence", `Memory write ${write.id} has forbidden raw media privacy classification.`, `input_events.${write.id}.payload.privacy_classification`, "critical"));
    }
  }

  if (expected.length === 0 && writes.length > 0) {
    failures.push(failure("memory_write_without_evidence", "Nominal fixture expected no memory writes but observed memory writes.", "observed.memory_writes", "critical"));
  }

  return {
    passed: failures.length === 0,
    expected_count: expected.length,
    observed_count: writes.length,
    writes,
    errors: failures,
    failures
  };
}

function checkModelCalls(fixture, events) {
  const failures = [];
  const calls = events.filter((event) => event.type === "agent.escalation_requested");
  const vlmCalls = calls.filter((event) => event.payload.requested_tier >= 4).length;
  const llmCalls = calls.length - vlmCalls;
  const estimatedCostUsd = calls.reduce((sum, event) => sum + (event.payload.max_cost_usd ?? 0), 0);

  if (fixture.privacy?.cloud_calls_expected === false && calls.length > 0) {
    failures.push(failure("unexpected_model_call", "Fixture expected no cloud calls but model route requests appeared.", "observed.model_calls", "critical"));
  }

  for (const call of calls) {
    if (call.payload.privacy_scope === "full_frame") {
      failures.push(failure("model_call_without_permission", `Model call ${call.id} requested full-frame privacy scope.`, `input_events.${call.id}.payload.privacy_scope`, "critical"));
    }
  }

  if (llmCalls > (fixture.metrics?.max_llm_calls ?? 0)) {
    failures.push(failure("unexpected_model_call", "LLM call count exceeded fixture limit.", "model_call_result.llm_calls", "critical"));
  }

  if (vlmCalls > (fixture.metrics?.max_vlm_calls ?? 0)) {
    failures.push(failure("unexpected_model_call", "VLM call count exceeded fixture limit.", "model_call_result.vlm_calls", "critical"));
  }

  if (estimatedCostUsd > (fixture.metrics?.max_cost_usd ?? 0)) {
    failures.push(failure("unexpected_model_call", "Estimated model cost exceeded fixture limit.", "model_call_result.estimated_cost_usd", "critical"));
  }

  return {
    passed: failures.length === 0,
    llm_calls: llmCalls,
    vlm_calls: vlmCalls,
    estimated_cost_usd: estimatedCostUsd,
    calls,
    errors: failures,
    failures,
    llmCalls,
    vlmCalls,
    estimatedCostUsd
  };
}

function checkPrivacy(fixture) {
  const failures = [];
  const rawRefs = findRawMediaRefs(fixture, "$");

  for (const raw of rawRefs) {
    failures.push(failure("raw_media_persistence", raw.message, raw.path, "critical"));
  }

  return {
    passed: failures.length === 0,
    raw_video_persisted: false,
    raw_audio_persisted: false,
    raw_frame_persisted: false,
    errors: failures,
    failures
  };
}

function checkForbidden(fixture, observed) {
  const failures = [];
  const forbiddenTypes = new Set(fixture.forbidden?.event_types ?? []);
  const allEventTypes = [
    ...observed.stableEvents.map((event) => event.type),
    ...observed.transitions.map((transition) => transition.emitted_event_type),
    ...observed.hudCommands.map(() => "hud.command_emitted"),
    ...observed.memoryWrites.map(() => "memory.write_requested"),
    ...observed.modelCalls.map(() => "agent.escalation_requested")
  ];

  for (const type of allEventTypes) {
    if (forbiddenTypes.has(type)) {
      failures.push(failure("unexpected_stable_event", `Forbidden event type appeared: ${type}.`, "forbidden.event_types", "critical"));
    }
  }

  return { passed: failures.length === 0, failures };
}

function eventMatches(event, matcher) {
  if (matcher.event_id && event.id !== matcher.event_id) return false;
  if (matcher.type && event.type !== matcher.type) return false;
  if (matcher.producer && event.producer !== matcher.producer) return false;
  if (matcher.min_confidence !== undefined && event.confidence < matcher.min_confidence) return false;
  if (matcher.max_confidence !== undefined && event.confidence > matcher.max_confidence) return false;
  if (matcher.must_occur_after_ms !== undefined && event.timestamp_ms < matcher.must_occur_after_ms) return false;
  if (matcher.must_occur_before_ms !== undefined && event.timestamp_ms > matcher.must_occur_before_ms) return false;
  if (matcher.payload_exact && !exactMatch(event.payload, matcher.payload_exact)) return false;
  if (matcher.payload_match && !partialMatch(event.payload, matcher.payload_match)) return false;
  if (matcher.payload_includes && !partialMatch(event.payload, matcher.payload_includes)) return false;
  if (matcher.evidence_includes) {
    const refs = new Set((event.evidence ?? []).map((item) => item.ref ?? item.id).filter(Boolean));
    for (const expectedRef of matcher.evidence_includes) {
      if (!refs.has(expectedRef)) return false;
    }
  }
  return true;
}

function validateStableEventMatcher(matcher) {
  const errors = [];
  if (typeof matcher.event_id !== "string" || matcher.event_id.trim() === "") errors.push("missing event_id");
  if (typeof matcher.type !== "string" || matcher.type.trim() === "") errors.push("missing type");
  if (typeof matcher.producer !== "string" || matcher.producer.trim() === "") errors.push("missing producer");
  if (typeof matcher.min_confidence !== "number") errors.push("missing min_confidence");
  if (!hasPayloadMatcher(matcher)) errors.push("missing payload matcher");
  if (!Array.isArray(matcher.evidence_includes) || matcher.evidence_includes.length === 0) errors.push("missing evidence_includes");
  return errors;
}

function validateTransitionMatcher(matcher) {
  const errors = [];
  for (const field of ["from_state", "to_state", "trigger_event_id", "emitted_event_type", "step_id"]) {
    if (typeof matcher[field] !== "string" || matcher[field].trim() === "") errors.push(`missing ${field}`);
  }
  return errors;
}

function validateHudCommandMatcher(matcher) {
  const errors = [];
  for (const field of ["command_id", "command_type", "target_surface", "related_step_id"]) {
    if (typeof matcher[field] !== "string" || matcher[field].trim() === "") errors.push(`missing ${field}`);
  }
  if (!Array.isArray(matcher.evidence_includes) || matcher.evidence_includes.length === 0) errors.push("missing evidence_includes");
  return errors;
}

function hasPayloadMatcher(matcher) {
  return [matcher.payload_match, matcher.payload_exact, matcher.payload_includes].some((value) => isPlainObject(value) && Object.keys(value).length > 0);
}

function matcherName(matcher) {
  return matcher.id ?? matcher.event_id ?? matcher.command_id ?? matcher.step_id ?? matcher.type ?? "unknown";
}

function exactMatch(actual, matcher) {
  if (!isPlainObject(actual) || !isPlainObject(matcher)) return actual === matcher;
  const actualKeys = Object.keys(actual).sort();
  const matcherKeys = Object.keys(matcher).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(matcherKeys)) return false;
  return partialMatch(actual, matcher);
}

function partialMatch(actual, matcher) {
  for (const [key, expectedValue] of Object.entries(matcher)) {
    if (key === "evidence_includes") continue;
    const actualValue = actual?.[key];
    if (isPlainObject(expectedValue)) {
      if (!partialMatch(actualValue, expectedValue)) return false;
    } else if (Array.isArray(expectedValue)) {
      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) return false;
    } else if (actualValue !== expectedValue) {
      return false;
    }
  }
  return true;
}

function withoutMatcherOnlyFields(matcher) {
  const clone = { ...matcher };
  delete clone.evidence_includes;
  return clone;
}

function compareRepeatedRuns(runs, repeat) {
  const normalized = runs.map((run) => normalizeReport(run));
  const hashes = normalized.map((run) => `sha256:${sha256(JSON.stringify(run)).slice(0, 16)}`);
  const first = JSON.stringify(normalized[0]);
  const differences = [];

  normalized.forEach((run, index) => {
    if (JSON.stringify(run) !== first) {
      differences.push(`repeat_${index + 1}_differs`);
    }
  });

  return {
    passed: differences.length === 0,
    repeat_count: repeat,
    normalized_hashes: hashes,
    differences
  };
}

function normalizeReport(report) {
  return {
    verdict: report.verdict,
    schema_validation: report.schema_validation.passed,
    event_validation: report.event_validation.passed,
    stable_event_result: pickResult(report.stable_event_result),
    quest_transition_result: pickResult(report.quest_transition_result),
    hud_command_result: pickResult(report.hud_command_result),
    memory_policy_result: pickResult(report.memory_policy_result),
    model_call_result: pickResult(report.model_call_result),
    privacy_result: pickResult(report.privacy_result),
    latency_cost_records_present: report.latency_cost_result.records_present,
    observed: report.observed,
    failure_codes: report.failures.map((item) => item.code).sort(),
    disclosure_codes: report.disclosures.map((item) => item.code).sort()
  };
}

function pickResult(result) {
  return {
    passed: result.passed,
    expected_count: result.expected_count,
    matched_count: result.matched_count,
    observed_count: result.observed_count,
    llm_calls: result.llm_calls,
    vlm_calls: result.vlm_calls,
    estimated_cost_usd: result.estimated_cost_usd
  };
}

function verdictFor(report) {
  if (report.failures.length > 0) return "FAIL";
  if (report.disclosures.length > 0) return "PASS_WITH_DISCLOSURE";
  return "PASS";
}

function withoutFailures(result) {
  const clone = { ...result };
  delete clone.failures;
  delete clone.llmCalls;
  delete clone.vlmCalls;
  delete clone.estimatedCostUsd;
  return clone;
}

function findVagueKeys(value, path) {
  const found = [];
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key === "data" || key === "stuff" || key === "info") {
      found.push({ key, path: childPath });
    }
    found.push(...findVagueKeys(child, childPath));
  }
  return found;
}

function findRawMediaRefs(value, path) {
  const found = [];
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (
      /(^|[/\\])[^/\\]+\.(mp4|mov|webm|wav|mp3)$/i.test(value) ||
      /^data:(image|audio|video)\//i.test(value) ||
      lowered.startsWith("raw_video:") ||
      lowered.startsWith("raw_audio:") ||
      lowered.startsWith("raw_frame:") ||
      lowered.includes("raw_video://") ||
      lowered.includes("raw_audio://") ||
      lowered.includes("raw_frame://")
    ) {
      found.push({ path, message: `Raw media reference is forbidden: ${value}.` });
    }
    return found;
  }

  if (!value || typeof value !== "object") return found;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (
      (key === "contains_raw_video" ||
        key === "contains_audio" ||
        key === "raw_video_persisted" ||
        key === "raw_audio_persisted" ||
        key === "raw_frame_persisted") &&
      child === true
    ) {
      found.push({ path: childPath, message: `${key} must not be true in Gate 0.` });
    }
    found.push(...findRawMediaRefs(child, childPath));
  }

  return found;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function failure(code, message, path, severity) {
  return { code, message, path, severity };
}

function disclosure(code, message, path, severity) {
  return { code, message, path, severity };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeReport(report) {
  mkdirSync("runs", { recursive: true });
  writeFileSync("runs/latest.json", `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`runs/${report.run_id}.json`, `${JSON.stringify(report, null, 2)}\n`);
}

function writeSuiteReport(suite) {
  mkdirSync("runs", { recursive: true });
  writeFileSync("runs/gate-0b-latest.json", `${JSON.stringify(suite, null, 2)}\n`);
}

function writeGate1AReport(suite) {
  mkdirSync("runs", { recursive: true });
  writeFileSync("runs/gate-1a-latest.json", `${JSON.stringify(suite, null, 2)}\n`);
}

function writeGate1BReport(suite) {
  mkdirSync("runs", { recursive: true });
  writeFileSync("runs/gate-1b-latest.json", `${JSON.stringify(suite, null, 2)}\n`);
}

function writeGate1CReport(suite) {
  mkdirSync("runs", { recursive: true });
  writeFileSync("runs/gate-1c-latest.json", `${JSON.stringify(suite, null, 2)}\n`);
}

function writePhysicalValidationReport(report) {
  mkdirSync("runs", { recursive: true });
  writeFileSync("runs/physical-validate-latest.json", `${JSON.stringify(report, null, 2)}\n`);
}

function printReplaySummary(report) {
  console.log(`${report.verdict} ${report.fixture_id}`);
  console.log(`report: runs/latest.json`);
  console.log(`stable events: ${report.stable_event_result.matched_count}/${report.stable_event_result.expected_count}`);
  console.log(`quest transitions: ${report.quest_transition_result.matched_count}/${report.quest_transition_result.expected_count}`);
  console.log(`hud commands: ${report.hud_command_result.matched_count}/${report.hud_command_result.expected_count}`);
  console.log(`llm/vlm calls: ${report.model_call_result.llm_calls}/${report.model_call_result.vlm_calls}`);
  if (report.failures.length) {
    for (const item of report.failures) console.log(`- ${item.code}: ${item.message}`);
  }
}

function printReport(report) {
  console.log(`Fixture: ${report.fixture_id}`);
  console.log(`Run: ${report.run_id}`);
  console.log(`Build: ${report.build_hash}`);
  console.log(`Verdict: ${report.verdict}`);
  console.log(`Schema: ${passFail(report.schema_validation.passed)}`);
  console.log(`Events: ${passFail(report.event_validation.passed)}`);
  console.log(`Quest: ${passFail(report.quest_transition_result.passed)}`);
  console.log(`HUD: ${passFail(report.hud_command_result.passed)}`);
  console.log(`Memory: ${passFail(report.memory_policy_result.passed)}`);
  console.log(`Model calls: ${passFail(report.model_call_result.passed)}`);
  console.log(`Privacy: ${passFail(report.privacy_result.passed)}`);
  console.log(`Latency/cost: ${passFail(report.latency_cost_result.passed)}`);
  console.log(`Determinism: ${passFail(report.deterministic_replay_result.passed)}`);
  if (report.failures.length) {
    console.log("Failures:");
    for (const item of report.failures) console.log(`- ${item.code}: ${item.message}`);
  }
}

function printSuiteSummary(suite) {
  console.log(`${suite.passed ? "PASS" : "FAIL"} Gate 0B suite`);
  console.log("report: runs/gate-0b-latest.json");
  for (const result of suite.results) {
    console.log(`- ${result.passed ? "PASS" : "FAIL"} ${result.fixture_id}: expected ${result.expected_verdict}, got ${result.actual_verdict}`);
    if (result.expected_failure_codes.length) {
      console.log(`  expected codes: ${result.expected_failure_codes.join(", ")}`);
      console.log(`  actual codes: ${result.actual_failure_codes.join(", ") || "none"}`);
    }
  }
}

function printGate1ASummary(suite) {
  console.log(`${suite.final_verdict} Gate 1A`);
  console.log("report: runs/gate-1a-latest.json");
  console.log(`fixtures: ${suite.fixture_count}`);
  console.log(`missing: ${suite.missing_fixture_count}`);
  console.log(`required/recommended/adversarial: ${suite.required_fixture_count}/${suite.recommended_fixture_count}/${suite.adversarial_fixture_count}`);
  for (const result of suite.results) {
    if (result.status !== "evaluated") {
      console.log(`- ${result.status.toUpperCase()} ${result.fixture}`);
      continue;
    }
    console.log(`- ${result.exact_failure_code_matching_result.passed ? "PASS" : "FAIL"} ${result.fixture_id}: expected ${result.expected_result}, got ${result.actual_result}`);
    if (result.expected_failure_codes.length || result.actual_failure_codes.length) {
      console.log(`  expected codes: ${result.expected_failure_codes.join(", ") || "none"}`);
      console.log(`  actual codes: ${result.actual_failure_codes.join(", ") || "none"}`);
    }
  }
}

function printGate1BSummary(suite) {
  console.log(`${suite.final_verdict} Gate 1B`);
  console.log("report: runs/gate-1b-latest.json");
  console.log(`fixtures: ${suite.fixture_count}`);
  console.log(`missing: ${suite.missing_fixture_count}`);
  console.log(`required/recommended/adversarial: ${suite.required_fixture_count}/${suite.recommended_fixture_count}/${suite.adversarial_fixture_count}`);
  console.log(`browser trace: ${passFail(suite.browser_trace_result.passed)}`);
  console.log(`occlusion recovery: ${passFail(suite.occlusion_recovery_result.passed)}`);
  console.log(`camera bump reset: ${passFail(suite.camera_bump_reset_result.passed)}`);
  console.log(`browser latency: ${passFail(suite.browser_latency_result.passed)}`);
  console.log(`static validation: ${passFail(suite.static_validation_result.passed)}`);
  for (const result of suite.results) {
    if (result.status !== "evaluated") {
      console.log(`- ${result.status.toUpperCase()} ${result.fixture}`);
      continue;
    }
    console.log(`- ${result.exact_failure_code_matching_result.passed ? "PASS" : "FAIL"} ${result.fixture_id}: expected ${result.expected_result}, got ${result.actual_result}`);
    if (result.expected_failure_codes.length || result.actual_failure_codes.length) {
      console.log(`  expected codes: ${result.expected_failure_codes.join(", ") || "none"}`);
      console.log(`  actual codes: ${result.actual_failure_codes.join(", ") || "none"}`);
    }
  }
}

function printGate1CSummary(suite) {
  console.log(`${suite.final_verdict} Gate 1C`);
  console.log("report: runs/gate-1c-latest.json");
  console.log(`fixtures: ${suite.fixture_count}`);
  console.log(`required/regression/adversarial: ${suite.required_fixture_count}/${suite.regression_fixture_count}/${suite.adversarial_fixture_count}`);
  console.log(`physical trace: ${passFail(suite.physical_trace_result.passed)}`);
  console.log(`physical trace origin: ${passFail(suite.physical_trace_origin_result.passed)}`);
  console.log(`replay: ${passFail(suite.replay_result.passed)}`);
  console.log(`privacy: ${passFail(suite.privacy_result.passed)}`);
  console.log(`model calls: ${passFail(suite.model_call_result.passed)}`);
  console.log(`memory: ${passFail(suite.memory_result.passed)}`);
  console.log(`HUD honesty: ${passFail(suite.HUD_honesty_result.passed)}`);
  console.log(`static validation: ${passFail(suite.static_validation_result.passed)}`);
  console.log(`waiver: ${suite.waiver_result.status}`);
  console.log(`minimal HUD polish: ${suite.polish_approval_result.status}`);
  for (const result of suite.results) {
    if (result.status !== "evaluated") {
      console.log(`- ${result.status.toUpperCase()} ${result.fixture}`);
      continue;
    }
    console.log(`- ${result.exact_failure_code_matching_result.passed ? "PASS" : "FAIL"} ${result.fixture_id}: expected ${result.expected_result}, got ${result.actual_result}`);
    if (result.expected_failure_codes.length || result.actual_failure_codes.length) {
      console.log(`  expected codes: ${result.expected_failure_codes.join(", ") || "none"}`);
      console.log(`  actual codes: ${result.actual_failure_codes.join(", ") || "none"}`);
    }
  }
}

function printPhysicalValidationSummary(report) {
  console.log(`${report.final_verdict} physical trace validation`);
  console.log("report: runs/physical-validate-latest.json");
  console.log(`fixture: ${report.fixture_path}`);
  console.log(`file exists: ${passFail(report.file_exists)}`);
  if (report.file_exists) {
    console.log(`physical trace: ${passFail(report.physical_trace_check?.passed)}`);
    console.log(`replay repeat 3: ${passFail(report.deterministic_repeat_result?.passed)}`);
    console.log(`raw media: ${passFail(report.raw_media_check?.passed)}`);
    console.log(`model calls: ${passFail(report.model_call_check?.passed)}`);
    console.log(`latency: ${passFail(report.latency_result?.passed)}`);
  }
  if (report.actual_failure_codes?.length) {
    console.log(`failure codes: ${report.actual_failure_codes.join(", ")}`);
  }
}

function printGate1CSummaryCompact(suite) {
  console.log(`${suite.final_verdict} Gate 1C`);
  console.log("report: runs/gate-1c-latest.json");
  console.log(`fixtures: ${suite.fixture_count}`);
  console.log(`missing: ${suite.missing_fixture_count}`);
  console.log(`required/recommended/adversarial: ${suite.required_fixture_count}/${suite.recommended_fixture_count}/${suite.adversarial_fixture_count}`);
  console.log(`physical trace: ${passFail(suite.physical_trace_result.passed)}`);
  console.log(`occlusion recovery: ${passFail(suite.occlusion_recovery_result.passed)}`);
  console.log(`camera bump reset: ${passFail(suite.camera_bump_reset_result.passed)}`);
  console.log(`browser latency: ${passFail(suite.browser_latency_result.passed)}`);
  console.log(`static validation: ${passFail(suite.static_validation_result.passed)}`);
  console.log(`static waiver: ${suite.static_validation_waiver_result.accepted ? "ACCEPTED" : suite.static_validation_waiver_result.required ? "REQUIRED" : "NOT_REQUIRED"}`);
  console.log(`minimal HUD polish: ${suite.minimal_hud_polish_approval_result.approved ? "APPROVED_MINIMAL_ONLY" : "BLOCKED"}`);
  for (const result of suite.results) {
    if (result.status !== "evaluated") {
      console.log(`- ${result.status.toUpperCase()} ${result.fixture}`);
      continue;
    }
    console.log(`- ${result.exact_failure_code_matching_result.passed ? "PASS" : "FAIL"} ${result.fixture_id}: expected ${result.expected_result}, got ${result.actual_result}`);
    if (result.expected_failure_codes.length || result.actual_failure_codes.length) {
      console.log(`  expected codes: ${result.expected_failure_codes.join(", ") || "none"}`);
      console.log(`  actual codes: ${result.actual_failure_codes.join(", ") || "none"}`);
    }
  }
}

function passFail(value) {
  return value ? "PASS" : "FAIL";
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return values[index];
}

function die(message) {
  console.error(message);
  process.exit(2);
}

main();
