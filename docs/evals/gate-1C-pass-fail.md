# Gate 1C Pass/Fail Rules

## Claim

Gate 1C tests whether DarkQuest can run an actual physical browser webcam session, export a symbolic-only physical capture trace, replay it deterministically, preserve zero raw media persistence and zero model calls, and resolve static validation enough to approve minimal state-backed HUD polish.

Cinematic HUD polish remains blocked by this gate.

## Required Physical Trace

Gate 1C requires:

- `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`
- `fixtures/replay/live/live_occlusion_recovery_001.v0.json`
- `fixtures/replay/live/live_camera_bump_reset_001.v0.json`

The physical Focus Ritual trace must include:

```json
{
  "trace_origin": {
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
}
```

## Verdict Rules

| Verdict | Rule |
| --- | --- |
| `BLOCKED_MISSING_PHYSICAL_TRACE` | The required physical Focus Ritual trace is missing. |
| `BLOCKED_STATIC_VALIDATION` | Physical trace passes, but package-local TypeScript/static validation cannot pass and no accepted waiver exists. |
| `FAIL` | Required traces exist, but replay, provenance, privacy, model, memory, HUD, cost, latency, recovery, or exact-code checks fail. |
| `PASS_WITH_DISCLOSURE` | Physical trace passes and static validation is explicitly waived by documented human acceptance. |
| `PASS` | Physical trace passes and static validation passes with no waiver. |

## Pass Conditions

- physical webcam session was performed
- physical trace exists at the required path
- physical trace provenance proves browser-local physical capture
- trace contains only symbolic events and symbolic evidence references
- no raw video, raw frame, screenshot, base64 media, audio, OCR, or notebook text appears
- LLM calls are `0`
- VLM calls are `0`
- model cost is `$0`
- raw media persistence count is `0`
- replay is deterministic across 3 runs
- privacy scanner passes
- memory policy passes
- HUD honesty passes
- browser latency records exist and pass thresholds
- occlusion recovery and camera bump/reset fixtures still pass
- Gate 0B, Gate 1A, and Gate 1B still pass
- package-local TypeScript/static validation passes or has an accepted waiver

## Static Validation And Waiver

Gate 1C checks:

- `node --check packages/evals/bin/darkquest-eval.mjs`
- package-local TypeScript availability
- root scripts for adapter tests, recorder tests, typecheck, and gate commands
- waiver status at `docs/evals/static-validation-waiver.md`

If package-local TypeScript cannot run, `docs/evals/static-validation-waiver.md` must include a human acceptance line. A pending waiver does not unblock Gate 1C.

## Minimal HUD Polish Approval

Minimal state-backed HUD polish can begin only after Gate 1C is `PASS` or `PASS_WITH_DISCLOSURE`.

Allowed only after approval:

- layout polish
- typography
- color system
- confidence bands
- event timeline presentation
- recovery panel styling
- state-backed progress animation
- local latency/status indicators

Still forbidden:

- fake progress
- cinematic completion without state
- hidden uncertainty
- hidden low confidence
- implied VLM/cloud intelligence
- raw camera artifacts
- raw frame exports
- screenshots in replay artifacts
- model calls in the hot path

## Required Failure Codes

- `physical_trace_missing`
- `physical_trace_origin_missing`
- `physical_capture_not_confirmed`
- `physical_trace_marked_manual`
- `physical_trace_wrong_generator`
- `physical_trace_wrong_capture_mode`
- `physical_trace_synthetic_substitution`
- `physical_trace_latency_missing`
- `raw_media_persistence_violation`
- `unexpected_model_call`
- `base64_media_detected`
- `screenshot_detected`
- `notebook_text_detected`
- `duplicate_event_id`
- `non_monotonic_timestamps`
- `quest_complete_without_support`
- `low_confidence_hidden`
