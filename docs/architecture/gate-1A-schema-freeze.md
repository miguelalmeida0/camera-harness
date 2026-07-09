# Gate 1A Schema Freeze

## Decision

Gate 1A freezes `docs/contracts/event-schema.v0.md` as the only state-bearing event contract for live local perception until Gate 0B adversarial replay passes. Live webcam work may start only at the adapter boundary, and it must emit replay-compatible v0 events before it can drive quest state or HUD progress.

Hard rule: PARALLAX cannot emit live perception events that are not valid under `event-schema.v0.md` into the quest engine, HUD progress stream, memory gate, model router, or replay-compatible event log. Experimental events are allowed only on an ignored side channel and must be excluded from state-machine input.

## Frozen v0 Envelope Fields

These event envelope fields are frozen for v0:

| Field | Frozen rule |
| --- | --- |
| `id` | Required string; unique and deterministic within a trace or fixture. |
| `type` | Required string; must be one of the v0 allowed event types. |
| `timestamp_ms` | Required non-negative integer; milliseconds from session or replay start; monotonic non-decreasing in input order. |
| `producer` | Required string; must be one of the v0 allowed producers. |
| `confidence` | Required number from `0.0` to `1.0`. |
| `payload` | Required object; event-specific typed fields only; vague keys are forbidden. |
| `evidence` | Required array; replay-safe references only; no raw media or hidden model reasoning. |

Allowed producers remain frozen:

- `perception.local`
- `event_stabilizer`
- `quest_engine`
- `hud_engine`
- `memory_gate`
- `model_router`
- `human_correction`

Allowed event types remain frozen:

- `scene.calibrated`
- `hand.entered_zone`
- `hand.left_zone`
- `object.moved`
- `object.placed`
- `gesture.detected`
- `zone.activated`
- `confidence.changed`
- `scene.uncertain`
- `scene.reset`
- `quest.step_started`
- `quest.step_completed`
- `hud.command_emitted`
- `memory.write_requested`
- `agent.escalation_requested`

Typo guard: `quest.step.completed` is not valid; use `quest.step_completed`.

## Frozen Event Payload Fields

The required payload fields in `event-schema.v0.md` are frozen. Live local perception may include optional payload fields only when all of these are true:

- the event still validates against v0 required fields;
- optional fields use specific names, not broad containers;
- optional fields do not affect quest transitions until a fixture asserts them;
- optional fields do not contain raw frame, raw video, raw audio, OCR, or private document content;
- optional fields are deterministic across repeated replay of the same symbolic trace.

Current state-bearing quest guards are frozen to these payload facts:

| Step | Required v0 event facts |
| --- | --- |
| `step_phone_away` | `object.moved`, `object_type == "phone"`, `from_zone_id == "zone_focus"`, `to_zone_id != "zone_focus"`, confidence `>= 0.86`. |
| `step_notebook_open` | `object.placed`, `object_type == "notebook"`, `zone_id == "zone_notebook"`, `dwell_ms >= 500`, confidence `>= 0.86`. |
| `step_pen_pickup` | `object.moved` or `object.placed`, `object_type == "pen"`, destination or placement in `zone_notebook` or `zone_focus`, confidence `>= 0.86`. |
| `step_write_three_bullets` | `gesture.detected`, `gesture_type == "writing_motion"`, `zone_id == "zone_notebook"`, `gesture_repetition_count >= 3`, `evidence_window_ms >= 900`, confidence `>= 0.82`. |
| `step_start_typing` | `gesture.detected`, `gesture_type == "typing_motion"`, `zone_id == "zone_keyboard"` or `zone_laptop`, `evidence_window_ms >= 900`, confidence `>= 0.82`. |

## Frozen Zone and Step Vocabulary

For Gate 1A, the live adapter must emit the zone vocabulary used by the current passing harness:

- `zone_focus`
- `zone_notebook`
- `zone_pen_tool`
- `zone_keyboard`
- `zone_laptop` when a laptop keyboard zone is calibrated
- `zone_away`

The earlier natural-language labels `phone_zone`, `notebook_zone`, `pen_zone`, `keyboard_zone`, `neutral_zone`, and `off_desk_zone` may be UI labels or calibration aliases, but they must be normalized before state-bearing v0 events are emitted.

Frozen step IDs:

- `step_phone_away`
- `step_notebook_open`
- `step_pen_pickup`
- `step_write_three_bullets`
- `step_start_typing`
- `step_quest_complete`

## Experimental Fields and Events

Experimental local perception signals must not enter `input_events`, stable events, quest transitions, HUD progress commands, memory writes, or model routes.

Allowed experimental channel:

```json
{
  "schema": "darkquest.experimental_observation.v0",
  "id": "xobs_pen_tip_angle_001",
  "timestamp_ms": 3300,
  "producer": "perception.local",
  "experimental": true,
  "ignored_by_state_machine": true,
  "signal_name": "pen_tip_angle",
  "confidence": 0.72,
  "notes": "Symbolic telemetry only; not a quest event."
}
```

Rules:

- Experimental observations are not v0 events.
- Experimental observations must be written to a separate trace section or debug stream.
- The replay runner must ignore them by default or fail if they appear in `input_events`.
- Experimental observations cannot complete quest steps.
- Experimental observations cannot trigger HUD progress, memory writes, or model calls.
- Promotion requires the schema-change process below.

## Schema Change Process

Every schema change must be proposed in a short schema-change note under `docs/architecture/schema-changes/`.

The note must include:

- current problem;
- proposed event, field, producer, or matcher change;
- affected fixtures;
- affected runner checks;
- privacy and raw-media impact;
- model-call impact;
- migration plan;
- rollback plan;
- owner agent;
- GAUNTLET acceptance fixtures.

No change is accepted until at least one positive fixture and one adversarial fixture prove the behavior.

## What Requires a Fixture Update

A fixture update is required when:

- a new event type can affect quest state, HUD progress, memory, model routing, or privacy checks;
- a new payload field becomes part of a quest guard;
- a confidence threshold changes;
- zone vocabulary changes;
- a step ID or transition order changes;
- a HUD command type, ID, or required evidence reference changes;
- an expected memory write becomes allowed;
- a model route becomes expected;
- experimental observations are promoted into state-bearing events.

## What Requires a Runner Update

A runner update is required when:

- v0 validation rules change;
- matcher semantics change from exact or subset checks;
- new failure codes are added;
- experimental observations need an explicit ignore-with-disclosure path;
- determinism comparison must include new observed outputs;
- privacy scanning must detect new artifact kinds;
- cost or latency records add required fields;
- live trace import is introduced.

Runner updates must be paired with adversarial fixtures that fail before the update and pass or fail for the intended reason after the update.

## What Requires an ADR

An ADR is required when a change affects architecture, privacy, cost, or state ownership:

- adding a new state-bearing event family;
- allowing any raw media artifact, even as an explicit test fixture;
- allowing Tier 1-4 model output to influence state;
- changing the memory policy or persistence scope;
- changing the replay-first gate order;
- replacing deterministic quest guards with probabilistic or model-owned rules;
- changing the live adapter boundary so the quest engine sees anything other than v0 stable events.

## Gate 1A Freeze Checklist

- Live state-bearing events validate against `event-schema.v0.md`.
- Live trace export can be replayed by `packages/evals/bin/darkquest-eval.mjs`.
- No raw media references appear in event evidence.
- Experimental observations are excluded from state and replay input.
- Schema changes are fixture-backed before implementation agents rely on them.
