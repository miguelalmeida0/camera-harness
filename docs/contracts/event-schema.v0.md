# DarkQuest Event Schema v0

## Purpose

This contract defines the minimum symbolic event shape required for Gate 0 replay of the DarkQuest Focus Ritual.

The v0 schema is a deterministic harness contract. It is intentionally smaller than the live runtime schema and exists to let replay fixtures validate this path:

```text
symbolic fixture -> event schema validation -> event stabilizer/pass-through -> quest state machine -> HUD command emission -> memory gate -> cost/latency logger -> replay report
```

## Hard Validation Rule

No event is valid without all of these fields:

- `id`
- `type`
- `timestamp_ms`
- `producer`
- `confidence`

The `payload` and `evidence` fields are also required by this v0 contract. An event with an empty payload or empty evidence can still be valid when the event-specific section allows it.

## Common Event Envelope

```json
{
  "id": "evt_001",
  "type": "object.moved",
  "timestamp_ms": 1200,
  "producer": "perception.local",
  "confidence": 0.93,
  "payload": {
    "object_id": "obj_phone",
    "object_type": "phone",
    "from_zone_id": "zone_focus",
    "to_zone_id": "zone_away"
  },
  "evidence": [
    {
      "kind": "fixture_assertion",
      "ref": "focus_ritual_nominal.input_events[3]"
    }
  ]
}
```

## Common Field Rules

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | Unique within a replay fixture and replay report. Use stable deterministic IDs. |
| `type` | string | Must be one of the allowed event types in this document. |
| `timestamp_ms` | integer | Milliseconds from replay start. Must be `>= 0`. Input event timestamps must be monotonic non-decreasing. |
| `producer` | string | Must be one of the allowed producers in this document. |
| `confidence` | number | Normalized confidence from `0.0` to `1.0`. |
| `payload` | object | Event-specific typed fields. Do not use vague keys such as `data`, `stuff`, or `info`. |
| `evidence` | array | Evidence references only. Raw frames, raw video, raw audio, and private document captures are forbidden. |

## Evidence Reference

Every evidence item must be a reference to replay-safe evidence, not raw webcam data.

```json
{
  "kind": "event_ref",
  "ref": "evt_object_moved_phone_away"
}
```

Allowed `evidence.kind` values:

- `fixture_assertion`
- `event_ref`
- `transition_guard`
- `policy_rule`
- `human_correction`
- `metric_log`

Forbidden evidence content:

- raw image bytes
- raw video paths
- raw audio paths
- unredacted webcam frame snapshots
- private document OCR
- hidden LLM reasoning

## Allowed Producers

| Producer | Allowed responsibility |
| --- | --- |
| `perception.local` | Local symbolic perception events only. No cloud model output. |
| `event_stabilizer` | Stable event emission or pass-through normalization. |
| `quest_engine` | Quest state transitions and quest lifecycle events. |
| `hud_engine` | HUD command events derived from accepted state/events. |
| `memory_gate` | Memory write request approval or rejection events. |
| `model_router` | Explicit escalation requests and model route accounting. |
| `human_correction` | User-provided corrections and correction-derived confidence updates. |

## Allowed Event Types

The Focus Ritual v0 replay accepts only these event types:

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

Unknown event types must fail schema validation unless a fixture explicitly lists them under `forbidden.event_types` to assert rejection behavior.

## Event Definitions

### `scene.calibrated`

Purpose: Mark the desk scene and required zones as available for deterministic replay.

Allowed producers:

- `perception.local`
- `event_stabilizer`
- `human_correction`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `session_id` | string | Replay session identifier. |
| `zone_ids` | array of strings | Calibrated zones available to the quest. |
| `calibration_id` | string | Stable calibration reference. |
| `scene_confidence` | number | Confidence in the calibrated scene, `0.0` to `1.0`. |

Pass condition: `scene_confidence >= 0.80` for the Focus Ritual nominal replay.

### `hand.entered_zone`

Purpose: Mark a tracked hand entering a calibrated zone.

Allowed producers:

- `perception.local`
- `event_stabilizer`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `hand_id` | string | Stable hand track ID for the replay. |
| `zone_id` | string | Calibrated zone entered. |
| `tracking_id` | string | Local tracker reference. |

Optional payload fields:

- `handedness`
- `related_object_id`

### `hand.left_zone`

Purpose: Mark a tracked hand leaving a calibrated zone.

Allowed producers:

- `perception.local`
- `event_stabilizer`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `hand_id` | string | Stable hand track ID for the replay. |
| `zone_id` | string | Calibrated zone left. |
| `tracking_id` | string | Local tracker reference. |
| `dwell_ms` | integer | Time in zone before exit. |

### `object.moved`

Purpose: Mark a tracked object moving between zones.

Allowed producers:

- `perception.local`
- `event_stabilizer`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `object_id` | string | Stable object ID. |
| `object_type` | string | Object class, such as `phone`, `notebook`, or `pen`. |
| `from_zone_id` | string | Source zone. |
| `to_zone_id` | string | Destination zone. |
| `duration_ms` | integer | Movement duration. |

Focus Ritual guards:

- Phone removal passes when `object_type == "phone"`, `from_zone_id == "zone_focus"`, and `to_zone_id != "zone_focus"` with `confidence >= 0.86`.
- Pen pickup evidence may use `object_type == "pen"` and `to_zone_id` is `zone_notebook` or `zone_focus` with `confidence >= 0.86`.

### `object.placed`

Purpose: Mark a tracked object resting in a zone after movement or detection.

Allowed producers:

- `perception.local`
- `event_stabilizer`
- `human_correction`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `object_id` | string | Stable object ID. |
| `object_type` | string | Object class, such as `notebook` or `pen`. |
| `zone_id` | string | Placement zone. |
| `dwell_ms` | integer | Rest duration in the zone. |

Focus Ritual guards:

- Notebook passes when `object_type == "notebook"`, `zone_id == "zone_notebook"`, `dwell_ms >= 500`, and `confidence >= 0.86`.
- Pen passes when `object_type == "pen"`, `zone_id` is `zone_notebook` or `zone_focus`, and `confidence >= 0.86`.

### `gesture.detected`

Purpose: Represent a stabilized gesture or activity primitive.

Allowed producers:

- `perception.local`
- `event_stabilizer`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `gesture_id` | string | Stable gesture ID. |
| `gesture_type` | string | Gesture class. Focus Ritual uses `writing_motion` and `typing_motion`. |
| `zone_id` | string | Zone where the gesture occurred. |
| `actor_ref` | string | Hand or actor reference. |
| `evidence_window_ms` | integer | Stabilization/evidence window. |

Optional payload fields:

- `related_object_id`
- `gesture_repetition_count`

Focus Ritual guards:

- Writing passes when `gesture_type == "writing_motion"`, `zone_id == "zone_notebook"`, `gesture_repetition_count >= 3`, `evidence_window_ms >= 900`, and `confidence >= 0.82`.
- Typing passes when `gesture_type == "typing_motion"`, `zone_id` is `zone_keyboard` or `zone_laptop`, `evidence_window_ms >= 900`, and `confidence >= 0.82`.

### `zone.activated`

Purpose: Mark a desk zone becoming active through an accepted event or state rule.

Allowed producers:

- `event_stabilizer`
- `quest_engine`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `zone_id` | string | Activated zone. |
| `activation_reason` | string | Deterministic reason, such as `object_placed` or `gesture_detected`. |
| `trigger_event_id` | string | Event that caused activation. |

### `confidence.changed`

Purpose: Record a meaningful confidence change for a scene, entity, zone, state, or event chain.

Allowed producers:

- `perception.local`
- `event_stabilizer`
- `quest_engine`
- `human_correction`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `target_ref` | string | Scene, object, zone, state, or event reference. |
| `previous_confidence` | number | Previous confidence value. |
| `current_confidence` | number | New confidence value. |
| `reason_code` | string | Deterministic reason for the change. |

### `scene.uncertain`

Purpose: Represent a scene condition that prevents confident local state updates.

Allowed producers:

- `event_stabilizer`
- `quest_engine`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `uncertainty_kind` | string | Reason category, such as `ambiguous_object`, `occlusion`, or `zone_drift`. |
| `affected_refs` | array of strings | Blocked state, zone, object, or event references. |
| `resolver_hint` | string | Deterministic recovery hint. |
| `escalation_recommended` | boolean | Whether model/human escalation may be requested. |

Hard rule: `scene.uncertain` does not itself call a model. It may only be evidence for a later `agent.escalation_requested` event.

### `scene.reset`

Purpose: Reset scene or quest state after calibration, camera movement, user reset, or unrecoverable drift.

Allowed producers:

- `quest_engine`
- `event_stabilizer`
- `human_correction`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `reset_reason` | string | Reason, such as `user_reset`, `session_end`, `camera_bump`, or `replay_restart`. |
| `reset_scope` | string | `scene`, `calibration`, `quest`, or `session`. |
| `previous_state_id` | string | State before reset. |

### `quest.step_started`

Purpose: Mark the active Focus Ritual step and expected evidence.

Allowed producers:

- `quest_engine`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `quest_id` | string | Must be `focus_ritual` for this POC. |
| `step_id` | string | Stable step ID. |
| `step_name` | string | Human-readable step name. |
| `expected_evidence` | array of strings | Expected event or guard references. |

Allowed Focus Ritual step IDs:

- `step_phone_away`
- `step_notebook_open`
- `step_pen_pickup`
- `step_write_three_bullets`
- `step_start_typing`
- `step_quest_complete`

### `quest.step_completed`

Purpose: Mark a Focus Ritual step completed by accepted deterministic evidence.

Allowed producers:

- `quest_engine`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `quest_id` | string | Must be `focus_ritual` for this POC. |
| `step_id` | string | Completed step ID. |
| `completion_reason` | string | Deterministic guard that passed. |
| `accepted_evidence_event_ids` | array of strings | Evidence events accepted for completion. |
| `elapsed_ms` | integer | Time since step start. |

Hard rule: Step completion must not be produced by an LLM/VLM.

### `hud.command_emitted`

Purpose: Record an instruction to the HUD renderer.

Allowed producers:

- `hud_engine`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `command_id` | string | Stable HUD command ID. |
| `command_type` | string | Command class, such as `show_objective`, `mark_step_complete`, `show_uncertain_state`, `show_recovery_state`, or `quest_complete`. |
| `target_surface` | string | HUD surface, such as `quest_panel`, `timeline`, `zone_overlay`, or `recovery_banner`. |
| `visual_state` | string | Deterministic visual state to render. |
| `priority` | string | `low`, `normal`, `high`, or `critical`. |

Hard rule: HUD commands that imply quest progress must reference accepted quest or perception event evidence.

### `memory.write_requested`

Purpose: Request a scoped, evidence-backed memory write after the memory gate approves the candidate.

Allowed producers:

- `memory_gate`
- `human_correction`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `memory_id` | string | Stable memory candidate ID. |
| `memory_scope` | string | Scope, such as `event`, `episode_summary`, `object_alias`, `user_correction`, or `project_instinct`. |
| `memory_subject` | string | Subject of the memory. |
| `memory_value` | string | Memory value. Must not contain raw frame/video/audio content. |
| `evidence_event_ids` | array of strings | Events supporting the memory. |
| `ttl_days` | integer | Required time-to-live. |
| `privacy_classification` | string | `replay_safe`, `user_correction`, `private_summary`, or `forbidden_raw_media`. |

Forbidden by default:

- raw frame memory
- raw video memory
- raw audio memory
- inferred private desk details unrelated to the quest
- LLM-generated facts not present in evidence events

### `agent.escalation_requested`

Purpose: Request a model or human escalation through a budgeted, visible route.

Allowed producers:

- `model_router`
- `quest_engine`

Required payload fields:

| Field | Type | Rule |
| --- | --- | --- |
| `escalation_id` | string | Stable escalation ID. |
| `requested_tier` | integer | Model/human route tier. Tier 4 is VLM fallback. |
| `reason_code` | string | Deterministic reason for escalation. |
| `source_event_ids` | array of strings | Events that justify the request. |
| `privacy_scope` | string | Must not be `full_frame` for VLM fallback. |
| `user_visible` | boolean | Must be `true` for recovery/escalation in demo mode. |
| `max_cost_usd` | number | Maximum allowed cost for this escalation. |

Hard rules:

- Continuous webcam video to a cloud model is forbidden.
- VLM fallback may only use an approved redacted crop/reference when a required active quest object is ambiguous.
- Hidden repair loops are failures unless explicitly contracted in the fixture.

## Focus Ritual Ordered Steps

The v0 quest state machine must complete these user-facing steps in order:

| Order | Step ID | User-facing objective | Minimum completing event |
| ---: | --- | --- | --- |
| 1 | `step_phone_away` | Move phone away. | `object.moved` for phone out of `zone_focus`. |
| 2 | `step_notebook_open` | Open notebook. | `object.placed` notebook in `zone_notebook`. |
| 3 | `step_pen_pickup` | Pick up pen. | `object.moved` pen into `zone_notebook` or `zone_focus`, optionally followed by `object.placed`. |
| 4 | `step_write_three_bullets` | Write three bullets. | `gesture.detected` writing motion in `zone_notebook` with `gesture_repetition_count >= 3`. |
| 5 | `step_start_typing` | Start typing. | `gesture.detected` typing motion in `zone_keyboard` or `zone_laptop`. |
| 6 | `step_quest_complete` | Quest complete. | `quest.step_completed` with all prior steps complete. |

## Replay Validation Requirements

A Gate 0 replay runner must fail the run when:

- an event is missing `id`, `type`, `timestamp_ms`, `producer`, `confidence`, `payload`, or `evidence`
- `type` is not allowed
- `producer` is not allowed
- `confidence` is outside `0.0` to `1.0`
- `timestamp_ms` is negative
- input event timestamps are not monotonic non-decreasing
- an event references raw video, raw audio, or raw frame persistence
- a quest transition is produced without deterministic evidence
- a memory write lacks evidence IDs, TTL, or privacy classification
- an `agent.escalation_requested` event exists in a fixture that expects no model calls

## Compatibility Note

`event-schema.v0.md` is the Gate 0 replay contract. `event-schema.v1.md` may define richer runtime fields, but the replay spine must first satisfy this v0 contract deterministically.
