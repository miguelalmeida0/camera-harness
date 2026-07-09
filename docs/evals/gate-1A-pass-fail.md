# Gate 1A Pass/Fail Rules

## Claim

Gate 1A tests whether DarkQuest can take live local perception output, export it as symbolic-only replay fixtures, and replay those fixtures through the existing Gate 0 harness with deterministic results and no privacy, model-call, memory, HUD, or schema violations.

Demo/HUD polish remains blocked until Gate 1A passes.

## Required Live Fixture

Gate 1A requires this exported live trace fixture:

```text
fixtures/replay/live/live_focus_ritual_001.v0.json
```

If the required fixture is missing, the Gate 1A runner must return:

```text
BLOCKED_MISSING_LIVE_TRACE
```

This is a correct blocking result, not a test failure to hide.

## Pass Conditions

Gate 1A passes only if all conditions are true:

- the live trace fixture exists at `fixtures/replay/live/live_focus_ritual_001.v0.json`
- the fixture validates against `docs/contracts/replay-fixture-schema.v0.md`
- every event validates against `docs/contracts/event-schema.v0.md`
- no raw video, audio, screenshot, base64 data, raw-media evidence, or notebook text exists
- no LLM calls occur
- no VLM calls occur
- expected events use exact, payload-aware, evidence-backed matchers
- quest transitions occur in correct order
- HUD commands reflect state honestly
- uncertainty is visible if `scene.uncertain` appears
- memory writes are empty or policy-valid
- latency/cost records exist
- replay is deterministic across 3 repeated runs
- `privacy.contains_raw_video` is `false`
- `privacy.contains_audio` is `false`
- `privacy.cloud_calls_expected` is `false`
- `metrics.max_llm_calls` is `0`
- `metrics.max_vlm_calls` is `0`
- `metrics.max_cost_usd` is `0` unless explicitly allowed by a future fixture
- raw media persistence count is `0`
- model call count is `0`
- adversarial live fixtures fail for exact expected failure codes

## Fail Conditions

Gate 1A fails if any of these occur:

- live trace cannot replay
- raw media is persisted
- model call occurs unexpectedly
- event schema drift occurs
- quest completes without supporting events
- memory write lacks evidence
- uncertainty is hidden
- repeated replay hashes differ
- fixture silently skips required checks
- expected event matcher is too broad
- evidence contains raw media
- live trace contains base64-looking media
- live trace contains notebook text
- cloud/VLM call is present without explicit expected permission

## Required Failure Codes

Privacy:

- `raw_media_persistence_violation`
- `raw_audio_persistence_violation`
- `base64_media_detected`
- `screenshot_detected`
- `notebook_text_detected`
- `raw_media_evidence`
- `cloud_evidence_marked_local`

Memory:

- `memory_write_without_evidence`
- `memory_write_missing_ttl`
- `memory_write_missing_privacy_classification`
- `raw_frame_memory_forbidden`
- `raw_audio_memory_forbidden`
- `notebook_text_memory_forbidden`
- `correction_not_prioritized`

HUD/model/state:

- `uncertainty_hidden_from_hud`
- `reset_hidden_from_hud`
- `hud_progress_without_state`
- `quest_complete_without_support`
- `low_confidence_hidden`
- `cloud_status_mismatch`
- `raw_media_status_mismatch`
- `unexpected_model_call`
- `unknown_event_type`
- `experimental_state_event`
- `stable_event_assertion_too_broad`
- `duplicate_event_id`
- `non_monotonic_timestamps`

## Exact Failure-Code Policy

Adversarial fixtures pass only if:

- they fail
- they fail for the expected exact code set
- they do not fail for unrelated privacy, schema, memory, model, HUD, or transition reasons
- they are deterministic across repeated runs

## Verdict Rules

| Verdict | Meaning |
| --- | --- |
| `BLOCKED_MISSING_LIVE_TRACE` | Required live exported fixture is absent. Demo work remains blocked. |
| `FAIL` | Required trace exists but replay/privacy/model/memory/HUD/exact-code checks fail. |
| `PASS_WITH_DISCLOSURE` | Required trace passes, adversarial fixtures pass, but missing recommended fixtures or limitations affect demo honesty. |
| `PASS` | Required live trace passes all checks and adversarial fixtures fail correctly. |
