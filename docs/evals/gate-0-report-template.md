# Gate 0 Report Template

## Decision

Every Gate 0 run must write a deterministic report using `darkquest.replay_report.v0`. The report is the release artifact. Human-readable summaries are secondary; the JSON report is the source of truth.

## Required report shape

```json
{
  "schema": "darkquest.replay_report.v0",
  "fixture_id": "focus_ritual_happy_path_v0",
  "run_id": "run_focus_ritual_happy_path_v0_001",
  "build_hash": "sha256:...",
  "verdict": "PASS",
  "schema_validation": {
    "passed": true,
    "errors": []
  },
  "event_validation": {
    "passed": true,
    "validated_event_count": 6,
    "errors": []
  },
  "stable_event_result": {
    "passed": true,
    "expected_count": 6,
    "matched_count": 6,
    "unexpected": []
  },
  "quest_transition_result": {
    "passed": true,
    "expected_count": 6,
    "matched_count": 6,
    "transitions": []
  },
  "hud_command_result": {
    "passed": true,
    "expected_count": 6,
    "matched_count": 6,
    "commands": []
  },
  "memory_policy_result": {
    "passed": true,
    "expected_count": 0,
    "observed_count": 0,
    "writes": [],
    "errors": []
  },
  "model_call_result": {
    "passed": true,
    "llm_calls": 0,
    "vlm_calls": 0,
    "estimated_cost_usd": 0,
    "calls": [],
    "errors": []
  },
  "privacy_result": {
    "passed": true,
    "raw_video_persisted": false,
    "raw_audio_persisted": false,
    "raw_frame_persisted": false,
    "errors": []
  },
  "latency_cost_result": {
    "passed": true,
    "records_present": true,
    "replay_runtime_ms": 12,
    "max_replay_runtime_ms": 1000,
    "llm_calls": 0,
    "vlm_calls": 0,
    "estimated_cost_usd": 0
  },
  "deterministic_replay_result": {
    "passed": true,
    "repeat_count": 3,
    "normalized_hashes": [
      "sha256:...",
      "sha256:...",
      "sha256:..."
    ],
    "differences": []
  },
  "observed": {
    "stable_events": [],
    "quest_transitions": [],
    "hud_commands": [],
    "memory_writes": [],
    "model_calls": []
  },
  "failures": [],
  "disclosures": []
}
```

## Required sections

| Section | Required fields | Pass meaning |
|---|---|---|
| Header | `schema`, `fixture_id`, `run_id`, `build_hash`, `verdict` | Report is identifiable and tied to build inputs. |
| Schema validation | `passed`, `errors` | Fixture shape is valid. |
| Event validation | `passed`, `validated_event_count`, `errors` | Every input event is valid. |
| Stable event result | `passed`, `expected_count`, `matched_count`, `unexpected` | Stabilizer/pass-through emitted expected stable events. |
| Quest transition result | `passed`, `expected_count`, `matched_count`, `transitions` | Quest state transitions matched in order. |
| HUD command result | `passed`, `expected_count`, `matched_count`, `commands` | HUD commands matched and cited evidence. |
| Memory policy result | `passed`, `expected_count`, `observed_count`, `writes`, `errors` | Memory writes obeyed policy. |
| Model-call result | `passed`, `llm_calls`, `vlm_calls`, `estimated_cost_usd`, `calls`, `errors` | Model usage matched fixture permission. |
| Privacy result | `passed`, raw media booleans, `errors` | No forbidden raw media persisted or referenced. |
| Latency/cost result | `passed`, `records_present`, runtime, model counts, cost | Runtime/cost telemetry exists and is within limits. |
| Deterministic replay result | `passed`, `repeat_count`, `normalized_hashes`, `differences` | Repeated runs produce the same normalized result. |
| Observed | stable events, transitions, HUD commands, memory writes, model calls | Reproducible audit trail. |
| Failures | stable failure codes | Machine-readable blocking reasons. |
| Disclosures | non-blocking disclosures | Requires GAUNTLET approval for `PASS_WITH_DISCLOSURE`. |

## Final verdict rules

| Verdict | Required report conditions |
|---|---|
| `FAIL` | Any required section failed, any hard fail rule triggered, or deterministic replay failed. |
| `PASS_WITH_DISCLOSURE` | All required sections passed but `disclosures` is non-empty. |
| `PASS` | All required sections passed and `disclosures` is empty. |

## Failure object shape

```json
{
  "code": "quest_completed_without_evidence",
  "message": "step_quest_complete was emitted before all prior steps had accepted evidence.",
  "path": "observed.quest_transitions[5]",
  "severity": "critical"
}
```

Required fields:

- `code`
- `message`
- `path`
- `severity`

Severity values:

- `critical`
- `high`
- `medium`
- `low`

## Disclosure object shape

```json
{
  "code": "extra_non_state_telemetry",
  "message": "Replay produced extra latency detail that does not affect state.",
  "accepted_by": null
}
```

## Normalized determinism hash

Exclude:

- `run_id`
- `latency_cost_result.replay_runtime_ms`
- report output file path

Include:

- verdict
- check pass/fail booleans
- failure codes
- stable event IDs and types
- quest transitions
- HUD commands
- memory writes
- model calls
- privacy booleans
- latency/cost record presence

## Cost/latency impact

The report must record zero model cost for the nominal fixture. Runtime recording is required even if runtime is not part of the normalized determinism hash.

## Handoff to next agent

Wire this template into `darkquest-eval report runs/latest.json` so any human can inspect the latest gate result without rerunning the fixture.
