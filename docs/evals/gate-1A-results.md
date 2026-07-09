# Gate 1A Results

## Claim Tested

DarkQuest can take live local perception output, export it as symbolic-only replay fixtures, and replay those fixtures through the existing Gate 0 harness with deterministic results and no privacy, model-call, memory, HUD, or schema violations.

## Command Sequence

```sh
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/focus_ritual_happy_path.v0.json
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1a fixtures/replay/gate_1a_manifest.json
```

## Fixture Matrix

| Fixture | Category | Expected | Actual | Exact codes |
| --- | --- | --- | --- | --- |
| `live_focus_ritual_001.v0.json` | required | `PASS` | `PASS` | pass |
| `live_phone_moved_001.v0.json` | recommended | `PASS` | `PASS` | pass |
| `live_notebook_opened_001.v0.json` | recommended | `PASS` | `PASS` | pass |
| `live_pen_picked_up_001.v0.json` | recommended | `PASS` | `PASS` | pass |
| `live_writing_motion_001.v0.json` | recommended | `PASS` | `PASS` | pass |
| `live_typing_motion_001.v0.json` | recommended | `PASS` | `PASS` | pass |
| `live_occlusion_recovery_001.v0.json` | recommended | `PASS` | missing | n/a |
| `live_camera_bump_reset_001.v0.json` | recommended | `PASS` | missing | n/a |
| `live_raw_media_violation.v0.json` | adversarial | `FAIL` | `FAIL` | `raw_media_persistence_violation` |
| `live_unexpected_vlm_call.v0.json` | adversarial | `FAIL` | `FAIL` | `unexpected_model_call` |
| `live_unknown_event_type.v0.json` | adversarial | `FAIL` | `FAIL` | `unknown_event_type` |
| `live_experimental_state_event.v0.json` | adversarial | `FAIL` | `FAIL` | `experimental_state_event` |
| `live_hidden_uncertainty.v0.json` | adversarial | `FAIL` | `FAIL` | `uncertainty_hidden_from_hud` |
| `live_memory_write_without_evidence.v0.json` | adversarial | `FAIL` | `FAIL` | `memory_write_without_evidence` |
| `live_quest_complete_without_support.v0.json` | adversarial | `FAIL` | `FAIL` | `quest_complete_without_support` |
| `live_broad_matcher_assertion.v0.json` | adversarial | `FAIL` | `FAIL` | `stable_event_assertion_too_broad` |
| `live_duplicate_event_id.v0.json` | adversarial | `FAIL` | `FAIL` | `duplicate_event_id` |
| `live_non_monotonic_timestamps.v0.json` | adversarial | `FAIL` | `FAIL` | `non_monotonic_timestamps` |

## Missing Fixtures

- `fixtures/replay/live/live_occlusion_recovery_001.v0.json`
- `fixtures/replay/live/live_camera_bump_reset_001.v0.json`

Both are recommended fixtures, not required fixtures. Their absence is the reason for `PASS_WITH_DISCLOSURE`.

## Deterministic Repeat Result

All evaluated fixtures ran with `repeat: 3`. Exact failure-code matching passed for all adversarial fixtures. Deterministic hashes are recorded in `runs/gate-1a-latest.json`.

## Privacy Result

Acceptance-path live fixtures passed raw media checks:

- raw video persisted: `0`
- raw audio persisted: `0`
- raw frame persisted: `0`
- screenshot/base64/notebook text detections: `0`

The adversarial raw-media fixture failed for the intended code: `raw_media_persistence_violation`.

## Model-Call Result

Acceptance-path live fixtures recorded:

- observed LLM calls: `0`
- observed VLM calls: `0`
- observed cost USD: `0`

The adversarial VLM fixture failed for the intended code: `unexpected_model_call`.

## Memory Result

Acceptance-path memory writes are empty or policy-valid. The adversarial memory fixture failed for the intended code: `memory_write_without_evidence`.

## HUD Honesty Result

Acceptance-path HUD commands matched expected state-backed commands. The adversarial hidden-uncertainty fixture failed for the intended code: `uncertainty_hidden_from_hud`.

## Cost/Latency Result

Acceptance-path aggregate:

- observed LLM calls: `0`
- observed VLM calls: `0`
- observed cost USD: `0`
- raw media persistence count: `0`
- replay runtime records: present

## Final Gate 1A Verdict

```text
PASS_WITH_DISCLOSURE
```

Gate 1A proves the required live symbolic Focus Ritual trace replays deterministically and the adversarial live fixtures fail for exact reasons. Cinematic HUD work is not broadly approved until the missing recovery fixtures are added or explicitly waived by GAUNTLET.
