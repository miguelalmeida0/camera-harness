# Gate 3B-Live Results

## Manifest Result

Manifest: `fixtures/replay/gate_3b_live_manifest.json`.

Actual current state: required physical suggestion traces are not yet exported.

## Command Status

- `npm run gate:3b`: source/runtime suggestion gate.
- `npm run gate:3b:live`: physical suggestion trace suite.
- `npm run suggestions:validate`: validates present suggestion traces without requiring all required traces to exist.
- `npm run suggestions:report`: writes `runs/suggestions-report-latest.json`.
- `npm run suggestions:bundle:validate`: validates optional Suggestion Trace Campaign bundle import source.
- `npm run suggestions:bundle:split -- --dry-run`: previews splitting a valid campaign bundle into individual required fixtures.

## Missing Traces

- `fixtures/replay/live/suggestions/live_suggestion_phone_moved_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_notebook_opened_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_pen_picked_up_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_writing_motion_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_typing_motion_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_reject_does_not_progress_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_uncertain_scene_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_full_focus_ritual_001.v0.json`

## Replay Result

Blocked until required suggestion traces exist. When present, each trace must pass replay repeat `3`. The live checker now prints every missing path plus the operator recovery steps.

## Suggestion Summary Result

Blocked until required traces include `suggestion_summary` with generated/accepted/rejected counts and `auto_completed_steps: 0`. Present-trace validation writes `runs/suggestions-validate-latest.json` and does not fail solely because required traces are missing.

## Campaign Bundle Result

Optional bundle path: `runs/live/darkquest_suggestion_trace_campaign_bundle.json`.

Current bundle verdict: `BUNDLE_MISSING_TRACES`.

Bundle reports:

- `runs/suggestions-bundle-validate-latest.json`
- `runs/suggestions-bundle-split-latest.json`

The bundle cannot satisfy Gate 3B-Live by itself. A valid bundle must be split into individual fixtures under `fixtures/replay/live/suggestions/` before the live gate can pass.

## Accept/Reject Result

Blocked until live traces prove accepted suggestions include `local_signal`, `human_correction`, `accepted_from_suggestion_id`, and `detection_method: motion_proxy`, and rejected suggestions do not progress quest state.

## Privacy/Model Result

Standard physical validation still passes. Gate 3B-Live requires raw media persistence `0` and LLM/VLM calls `0/0` on suggestion traces.

## Adversarial Result

Adversarial fixtures are present for:

- suggestion auto-completion without confirmation
- rejected suggestion progresses quest
- accepted suggestion missing human correction
- accepted suggestion missing local signal
- accepted suggestion missing suggestion id
- raw media violation
- model call violation
- autonomous vision claim
- future-step suggestion bypass
- nonzero auto-completed steps
- missing suggestion summary
- missing `detection_method: motion_proxy`

Expected failure-code matrix:

| Fixture | Expected code |
|---|---|
| `suggestion_auto_completes_without_confirmation.v0.json` | `suggestion_auto_completed_without_confirmation` |
| `suggestion_reject_progresses_quest.v0.json` | `rejected_suggestion_progressed_quest` |
| `suggestion_accept_missing_human_correction.v0.json` | `accepted_suggestion_missing_human_correction` |
| `suggestion_accept_missing_local_signal.v0.json` | `accepted_suggestion_missing_local_signal` |
| `suggestion_accept_missing_suggestion_id.v0.json` | `accepted_suggestion_missing_suggestion_id` |
| `suggestion_raw_media_violation.v0.json` | `raw_media_persistence_violation` |
| `suggestion_model_call_violation.v0.json` | `unexpected_model_call` |
| `suggestion_autonomous_vision_claim.v0.json` | `forbidden_autonomous_vision_claim` |
| `suggestion_future_step_bypass.v0.json` | `future_step_suggestion_bypassed_order` |
| `suggestion_auto_completed_steps_nonzero.v0.json` | `auto_completed_steps_nonzero` |
| `suggestion_missing_summary.v0.json` | `suggestion_summary_missing` |
| `suggestion_missing_motion_proxy.v0.json` | `accepted_suggestion_missing_motion_proxy` |

## Final Verdict

Actual verdict: `BLOCKED_MISSING_SUGGESTION_TRACES`.

Latest checker evidence:

- command: `npm run gate:3b:live`
- report: `runs/gate-3b-live-latest.json`
- checks: `61/69`
- missing traces: `8`
- adversarial expected-failure checks: pass (`12/12`)
- `npm run suggestions:validate`: `runs/suggestions-validate-latest.json`
- suggestions validate verdict: `PRESENT_TRACES_VALID_MISSING_REQUIRED`
- `npm run suggestions:report`: `runs/suggestions-report-latest.json`
- suggestions report readiness: `blocked`
- suggestion JSON files found: `12` adversarial fixtures, `0` required live traces
- `npm run suggestions:bundle:validate`: `BUNDLE_MISSING_TRACES`
- `npm run suggestions:bundle:split -- --dry-run`: `BUNDLE_MISSING_TRACES`

Exact next command sequence for operator:

```bash
npm run physical:capture
# Select Suggestion Trace Campaign
# Export each trace under fixtures/replay/live/suggestions/
npm run suggestions:validate
npm run gate:3b:live
```
