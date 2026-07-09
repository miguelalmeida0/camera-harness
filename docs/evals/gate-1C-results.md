# Gate 1C Results

## 1. Claim Being Tested

DarkQuest is demo-safe for minimal state-backed HUD polish only if a real physical browser webcam Focus Ritual session exports a symbolic-only replay trace, the trace replays deterministically, all privacy/model/memory/HUD checks pass, adversarial fixtures fail with exact expected codes, and static validation is either passing or explicitly waived.

Current claim result: `BLOCKED_MISSING_PHYSICAL_TRACE`.

## 2. Test Or Benchmark Design

Commands executed:

```sh
node --check packages/evals/bin/darkquest-eval.mjs
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/focus_ritual_happy_path.v0.json
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1a fixtures/replay/gate_1a_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1b fixtures/replay/gate_1b_manifest.json
npm run test:adapter
npm run test:recorder
npm run typecheck
npm run physical:validate
node packages/evals/bin/darkquest-eval.mjs gate-1c fixtures/replay/gate_1c_manifest.json
```

Gate 1C uses `fixtures/replay/gate_1c_manifest.json` and writes `runs/gate-1c-latest.json`.

The final Gate 1C command is expected to exit nonzero while the physical trace is missing.

After the physical trace exists, the local full verification command is:

```sh
npm run verify:physical
```

## 3. Pass/Fail Criteria

Gate 1C verdict rules:

- `BLOCKED_MISSING_PHYSICAL_TRACE`: required physical Focus Ritual trace is missing.
- `BLOCKED_STATIC_VALIDATION`: physical trace passes, but static validation cannot pass and no accepted waiver exists.
- `FAIL`: required traces exist, but replay, provenance, privacy, model, memory, HUD, cost, latency, recovery, or exact-code checks fail.
- `PASS_WITH_DISCLOSURE`: physical trace passes and static validation is explicitly waived.
- `PASS`: physical trace passes and static validation passes.

Required physical trace path:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

Required physical provenance:

```json
{
  "source": "browser.local_camera",
  "raw_media_persisted": false,
  "cloud_calls_enabled": false,
  "manual_fixture": false,
  "generated_by": "browser-local-capture",
  "capture_mode": "physical_webcam_manual_calibration",
  "browser_latency_recorded": true,
  "physical_capture": true,
  "operator_confirmed_physical_session": true
}
```

## 4. Evidence Required

Evidence artifacts:

- `runs/latest.json`
- `runs/gate-0b-latest.json`
- `runs/gate-1a-latest.json`
- `runs/gate-1b-latest.json`
- `runs/gate-1c-latest.json`
- `runs/physical-validate-latest.json`
- `fixtures/replay/gate_1c_manifest.json`
- `docs/contracts/physical-trace-provenance-contract.v0.md`
- `docs/evals/gate-1C-pass-fail.md`
- `docs/evals/gate-1C-static-validation.md`
- `docs/evals/static-validation-waiver.md`
- `docs/evals/minimal-hud-polish-approval.md`
- `docs/evals/gate-1C-local-operator-validation-report.md`
- `docs/evals/gate-1C-rerun-checklist.md`

New physical adversarial fixtures:

- `fixtures/replay/live/adversarial/live_physical_trace_missing_origin.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_not_confirmed.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_marked_manual.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_wrong_generator.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_wrong_capture_mode.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_synthetic_substitution.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_latency_missing.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_raw_media.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_unexpected_model_call.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_quest_complete_without_support.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_hidden_low_confidence.v0.json`

## 5. Cost/Latency Metrics

Latest Gate 1C report:

- fixture count: `37`
- required/regression/adversarial: `3/8/26`
- deterministic hashes recorded: `108`
- deterministic replay result: `PASS`
- positive replay fixtures evaluated: `10`
- replay runtime total recorded by Gate 1C: `3ms`
- LLM calls: `0`
- VLM calls: `0`
- estimated model cost: `$0`
- raw media persistence count: `0`
- physical browser latency: not available because the required physical trace is missing

Root validation commands:

- `npm run test:adapter`: PASS
- `npm run test:recorder`: PASS
- `npm run typecheck`: PASS
- `npm run physical:validate`: `BLOCKED_MISSING_PHYSICAL_TRACE`
- `npm run verify:physical`: `BLOCKED_MISSING_PHYSICAL_TRACE`

Harness static validation remains `FAIL` because package-local TypeScript runtimes are not installed for package-level builds.

## 6. Memory/Security Implications

Evaluated positive fixtures pass:

- privacy check
- model-call check
- memory policy check
- HUD honesty check
- cost check
- latency check

No evaluated passing fixture records raw video, raw frames, screenshots, audio, OCR, notebook text, base64 media, cloud-derived evidence, or model calls.

The missing physical trace means Gate 1C has not yet proven that a real webcam session can preserve these guarantees end to end.

## 7. Result

Current Gate 1C verdict: `BLOCKED_MISSING_PHYSICAL_TRACE`.

This is correct because the required physical webcam artifact is absent. Gate 1C must not accept the existing browser-origin symbolic trace, synthetic fixtures, or a waiver as a substitute for physical hardware capture.

Latest command results:

- Happy replay: PASS
- Gate 0B: PASS
- Gate 1A: PASS
- Gate 1B: `PASS_WITH_DISCLOSURE`
- Physical validator: `BLOCKED_MISSING_PHYSICAL_TRACE`
- Gate 1C: `BLOCKED_MISSING_PHYSICAL_TRACE`

Gate 1C evaluated:

- 1 required physical trace missing
- 10 positive replay fixtures passing
- 26 adversarial fixtures failing with exact expected failure codes
- 0 unexpected LLM/VLM calls in passing fixtures
- 0 raw media persistence in passing fixtures

Exact adversarial checks passed for:

| Fixture | Expected code | Actual code |
| --- | --- | --- |
| `live_raw_media_violation_v0` | `raw_media_persistence_violation` | `raw_media_persistence_violation` |
| `live_unexpected_vlm_call_v0` | `unexpected_model_call` | `unexpected_model_call` |
| `live_unknown_event_type_v0` | `unknown_event_type` | `unknown_event_type` |
| `live_experimental_state_event_v0` | `experimental_state_event` | `experimental_state_event` |
| `live_hidden_uncertainty_v0` | `uncertainty_hidden_from_hud` | `uncertainty_hidden_from_hud` |
| `live_memory_write_without_evidence_v0` | `memory_write_without_evidence` | `memory_write_without_evidence` |
| `live_quest_complete_without_support_v0` | `quest_complete_without_support` | `quest_complete_without_support` |
| `live_broad_matcher_assertion_v0` | `stable_event_assertion_too_broad` | `stable_event_assertion_too_broad` |
| `live_duplicate_event_id_v0` | `duplicate_event_id` | `duplicate_event_id` |
| `live_non_monotonic_timestamps_v0` | `non_monotonic_timestamps` | `non_monotonic_timestamps` |
| `live_browser_trace_missing_origin_v0` | `browser_trace_origin_missing` | `browser_trace_origin_missing` |
| `live_browser_latency_missing_v0` | `browser_latency_missing` | `browser_latency_missing` |
| `live_browser_trace_claims_raw_media_v0` | `raw_media_persistence_violation` | `raw_media_persistence_violation` |
| `live_occlusion_progresses_quest_v0` | `quest_progress_during_uncertainty` | `quest_progress_during_uncertainty` |
| `live_camera_bump_stale_zone_truth_v0` | `stale_zone_truth_after_reset` | `stale_zone_truth_after_reset` |
| `live_physical_trace_missing_origin_v0` | `physical_trace_origin_missing` | `physical_trace_origin_missing` |
| `live_physical_trace_not_confirmed_v0` | `physical_capture_not_confirmed` | `physical_capture_not_confirmed` |
| `live_physical_trace_marked_manual_v0` | `physical_trace_marked_manual` | `physical_trace_marked_manual` |
| `live_physical_trace_wrong_generator_v0` | `physical_trace_wrong_generator` | `physical_trace_wrong_generator` |
| `live_physical_trace_wrong_capture_mode_v0` | `physical_trace_wrong_capture_mode` | `physical_trace_wrong_capture_mode` |
| `live_physical_trace_synthetic_substitution_v0` | `physical_trace_synthetic_substitution`, `physical_trace_wrong_generator`, `physical_trace_wrong_capture_mode` | `physical_trace_synthetic_substitution`, `physical_trace_wrong_capture_mode`, `physical_trace_wrong_generator` |
| `live_physical_trace_latency_missing_v0` | `physical_trace_latency_missing` | `physical_trace_latency_missing` |
| `live_physical_trace_raw_media_v0` | `raw_media_persistence_violation` | `raw_media_persistence_violation` |
| `live_physical_trace_unexpected_model_call_v0` | `unexpected_model_call` | `unexpected_model_call` |
| `live_physical_trace_quest_complete_without_support_v0` | `quest_complete_without_support` | `quest_complete_without_support` |
| `live_physical_trace_hidden_low_confidence_v0` | `low_confidence_hidden` | `low_confidence_hidden` |

## 8. Required Fix Or Approval Gate

Gate 1C remains blocked until:

1. Capture a real physical browser webcam Focus Ritual session.
2. Export it to `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.
3. Include required `trace_origin` metadata proving physical browser-local capture.
4. Include browser latency records.
5. Preserve symbolic-only evidence and zero model calls.
6. Re-run Gate 1C and confirm the verdict advances past `BLOCKED_MISSING_PHYSICAL_TRACE`.

Exact command sequence after the artifact exists:

```sh
npm run physical:validate
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run gate:0b
npm run gate:1a
npm run gate:1b
npm run gate:1c
npm run test:adapter
npm run test:recorder
npm run typecheck
```

After the physical trace passes, resolve static validation by either:

- installing package-local TypeScript dependencies and running package builds; or
- obtaining explicit human acceptance in `docs/evals/static-validation-waiver.md`.

Minimal HUD polish remains blocked. Cinematic HUD polish remains forbidden.
