# DarkQuest Replay Fixture Schema v0

## Purpose

This contract defines the minimum replay fixture format for Gate 0: Replay Spine.

The fixture is symbolic only. It must be sufficient to replay the Focus Ritual without live webcam input, cloud model calls, hidden repair loops, or raw media persistence.

## Required Top-Level Shape

```json
{
  "schema": "darkquest.replay_fixture.v0",
  "fixture_id": "",
  "name": "",
  "description": "",
  "created_by": "",
  "privacy": {
    "contains_raw_video": false,
    "contains_audio": false,
    "cloud_calls_expected": false
  },
  "input_events": [],
  "expected": {
    "stable_events": [],
    "quest_transitions": [],
    "hud_commands": [],
    "memory_writes": [],
    "model_calls": []
  },
  "forbidden": {
    "event_types": [],
    "memory_writes": [],
    "model_calls": [],
    "raw_video_persistence": true
  },
  "metrics": {
    "max_llm_calls": 0,
    "max_vlm_calls": 0,
    "max_cost_usd": 0.0,
    "max_replay_runtime_ms": 1000
  }
}
```

## Top-Level Field Rules

| Field | Type | Rule |
| --- | --- | --- |
| `schema` | string | Must equal `darkquest.replay_fixture.v0`. |
| `fixture_id` | string | Stable deterministic fixture ID. |
| `name` | string | Human-readable fixture name. |
| `description` | string | What claim the fixture tests. |
| `created_by` | string | Agent, human, or team that authored the fixture. |
| `privacy` | object | Privacy assertions for fixture inputs and expected outputs. |
| `input_events` | array | Symbolic v0 events from `event-schema.v0.md`. |
| `expected` | object | Expected stable outputs and side effects. |
| `forbidden` | object | Outputs or side effects that fail the run if observed. |
| `metrics` | object | Cost and runtime limits for this replay. |

Unknown top-level fields should fail validation unless the replay runner is configured in compatibility mode and records the ignored fields in the report. Gate 1B compatibility mode allows exactly one browser-origin extension, top-level `trace_origin`, defined in `docs/contracts/browser-trace-origin-contract.v0.md`.

## Privacy Object

```json
{
  "contains_raw_video": false,
  "contains_audio": false,
  "cloud_calls_expected": false
}
```

Rules:

- `contains_raw_video` must be `false` for Gate 0 fixtures.
- `contains_audio` must be `false` for Gate 0 fixtures.
- `cloud_calls_expected` must be `false` for the nominal six-step Focus Ritual replay.
- If any field contradicts observed replay behavior, the fixture fails.

## Input Events

`input_events` contains symbolic events that satisfy `event-schema.v0.md`.

The first nominal Focus Ritual fixture should use only replay-safe symbolic events from these producers:

- `perception.local`
- `event_stabilizer`
- `quest_engine`
- `hud_engine`
- `memory_gate`

The input stream must be deterministic:

- event IDs are stable
- timestamps are relative `timestamp_ms`
- timestamps are monotonic non-decreasing
- no event depends on wall-clock time
- no event depends on random ordering
- no event contains raw media

## Expected Object

### `expected.stable_events`

Events expected after schema validation and stabilization/pass-through.

Minimum matcher shape:

```json
{
  "id": "expect_phone_moved_stable",
  "event_id": "evt_phone_moved_stable",
  "type": "object.moved",
  "producer": "event_stabilizer",
  "min_confidence": 0.86,
  "payload_match": {
    "object_type": "phone",
    "from_zone_id": "zone_focus"
  },
  "evidence_includes": ["evt_phone_moved_input"]
}
```

Rules:

- Every expected stable event must match exactly one emitted event.
- Every expected stable event matcher must include `event_id`, `type`, `producer`, `min_confidence`, a non-empty payload matcher, and `evidence_includes`.
- `payload_match` and `payload_includes` are partial deterministic matches.
- `payload_exact` is an exact deterministic match.
- Event-family matchers such as only `type`, `producer`, and `min_confidence` are forbidden because they can pass on the wrong event.
- Extra stable events are allowed only if they do not affect quest transitions and are explicitly ignored by fixture policy. The default is to fail on unexpected stable state-changing events.

### `expected.quest_transitions`

Ordered quest state transitions expected from the replay.

Minimum matcher shape:

```json
{
  "from_state": "phone_removal_pending",
  "to_state": "phone_removed",
  "trigger_event_id": "evt_phone_moved_stable",
  "emitted_event_type": "quest.step_completed",
  "step_id": "step_phone_away"
}
```

Rules:

- Transitions are ordered.
- Each transition must cite a trigger event.
- Every transition matcher must include `from_state`, `to_state`, `trigger_event_id`, `emitted_event_type`, and `step_id`.
- Transition guards must be deterministic.
- LLM/VLM output must not be accepted as state truth.

Required nominal ordered step IDs:

- `step_phone_away`
- `step_notebook_open`
- `step_pen_pickup`
- `step_write_three_bullets`
- `step_start_typing`
- `step_quest_complete`

### `expected.hud_commands`

HUD commands expected from accepted quest state and stable events.

Minimum matcher shape:

```json
{
  "command_id": "hud_mark_phone_away",
  "command_type": "mark_step_complete",
  "target_surface": "quest_panel",
  "related_step_id": "step_phone_away",
  "evidence_includes": ["evt_step_phone_away_completed"]
}
```

Rules:

- HUD commands must be replay outputs, not hand-authored proof.
- Commands that imply progress must cite quest or perception evidence.
- Every HUD matcher must include `command_id`, `command_type`, `target_surface`, `related_step_id`, and `evidence_includes`.
- The HUD may show uncertainty/recovery only when matching uncertainty events exist.

### `expected.memory_writes`

Expected memory write requests after the memory gate.

The nominal Gate 0 Focus Ritual fixture should set this to an empty array unless it explicitly tests an allowed write.

Minimum matcher shape when non-empty:

```json
{
  "memory_id": "mem_blue_stylus_alias",
  "memory_scope": "object_alias",
  "memory_subject": "obj_pen",
  "evidence_includes": ["evt_human_correction_pen_alias"],
  "ttl_days": 90,
  "privacy_classification": "user_correction"
}
```

Rules:

- Memory writes require evidence event IDs.
- Memory writes require TTL.
- Raw frame, raw video, and raw audio memory writes are forbidden.
- User corrections override agent assertions when both are present.

### `expected.model_calls`

Expected model calls or route decisions.

The nominal Gate 0 Focus Ritual fixture must use:

```json
[]
```

If a future uncertainty fixture expects a model route, use this matcher shape:

```json
{
  "route_id": "route_required_object_ambiguous",
  "approved_tier": 4,
  "input_class": "redacted_visual_crop",
  "trigger_event_ids": ["evt_scene_uncertain_pen"],
  "max_cost_usd": 0.002,
  "user_visible": true
}
```

Rules:

- Model calls must be sparse, visible, and budgeted.
- Continuous webcam video to a cloud model is forbidden.
- Cloud VLM fallback is allowed only for active blocked uncertainty and only when the fixture explicitly expects it.

## Forbidden Object

### `forbidden.event_types`

Event types that must not appear in emitted stable events or report events.

Example:

```json
["agent.escalation_requested"]
```

### `forbidden.memory_writes`

Memory write scopes or matchers that fail the run if observed.

Example:

```json
[
  {
    "memory_scope": "raw_frame_memory"
  },
  {
    "privacy_classification": "forbidden_raw_media"
  }
]
```

### `forbidden.model_calls`

Model route or call matchers that fail the run if observed.

Example:

```json
[
  {
    "approved_tier": 4
  },
  {
    "input_class": "continuous_video"
  }
]
```

### `forbidden.raw_video_persistence`

Must be `true` for Gate 0 fixtures. This means any observed raw video persistence fails the replay.

The replay report must include an explicit boolean assertion:

```json
{
  "raw_video_persisted": false
}
```

## Metrics Object

```json
{
  "max_llm_calls": 0,
  "max_vlm_calls": 0,
  "max_cost_usd": 0.0,
  "max_replay_runtime_ms": 1000
}
```

Rules:

- `max_llm_calls` is the maximum number of text LLM calls.
- `max_vlm_calls` is the maximum number of VLM calls.
- `max_cost_usd` is the maximum estimated or actual model cost.
- `max_replay_runtime_ms` is the maximum end-to-end fixture replay runtime.
- The replay report must include observed values for all metrics, even when they are zero.

## Required Replay Report

Each fixture run must produce a deterministic pass/fail report.

Minimum report shape:

```json
{
  "schema": "darkquest.replay_report.v0",
  "fixture_id": "focus_ritual_nominal_v0",
  "run_id": "run_focus_ritual_nominal_v0_001",
  "status": "passed",
  "started_at_ms": 0,
  "ended_at_ms": 42,
  "checks": {
    "event_schema_valid": true,
    "stable_events_matched": true,
    "quest_transitions_matched": true,
    "hud_commands_matched": true,
    "memory_writes_matched": true,
    "model_calls_matched": true,
    "no_forbidden_event_types": true,
    "no_forbidden_memory_writes": true,
    "no_forbidden_model_calls": true,
    "raw_video_persisted": false,
    "latency_cost_records_present": true
  },
  "observed": {
    "stable_events": [],
    "quest_transitions": [],
    "hud_commands": [],
    "memory_writes": [],
    "model_calls": []
  },
  "metrics": {
    "llm_calls": 0,
    "vlm_calls": 0,
    "cost_usd": 0.0,
    "replay_runtime_ms": 42
  },
  "failures": []
}
```

## Determinism Requirement

The same fixture must produce the same result across repeated runs.

Minimum repeatability gate:

- Run the fixture at least three times.
- Compare `status`, expected match results, forbidden checks, metrics presence, and observed event IDs.
- Runtime may vary, but it must stay within `metrics.max_replay_runtime_ms`.
- Any difference in quest transitions, HUD commands, memory writes, model calls, or pass/fail status fails determinism.

## Gate 0 Acceptance Criteria

The first six-step Focus Ritual fixture passes only when the replay report proves:

- expected stable events are present
- expected quest transitions occur in order
- expected HUD commands are emitted
- no unexpected LLM/VLM calls occur
- no raw video persistence occurs
- memory writes occur only where allowed
- latency and cost records are present
- the result is reproducible across repeated runs

Any feature work that cannot be represented by this fixture contract is not demo-safe for Gate 0.
