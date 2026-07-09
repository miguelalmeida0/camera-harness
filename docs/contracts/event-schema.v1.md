# DarkQuest Event Schema v1

## Contract Rules

- Event type names are strict and stable.
- No vague keys such as `data`, `stuff`, `info`, or `payload`.
- All timestamps are ISO 8601 UTC strings unless explicitly noted.
- `occurred_at` is when the observed event happened.
- `observed_at` is when the system emitted or recorded the event.
- `confidence` is normalized from `0.0` to `1.0`.
- `confidence >= 0.85` means actionable without escalation.
- `0.65 <= confidence < 0.85` means usable only with stabilization or corroboration.
- `confidence < 0.65` means not state-changing unless human correction confirms it.
- Every event is append-only in the replay/event store.
- An event may request LLM/VLM escalation only if the event definition allows it and the model-routing policy approves it.

## Common Envelope

All events use this envelope. Event-specific fields are added at the top level.

```json
{
  "event_id": "evt_01J00000000000000000000000",
  "schema_version": "1.0.0",
  "event_type": "hand.entered_zone",
  "session_id": "ses_focus_001",
  "sequence": 42,
  "producer": "EventStabilizer",
  "occurred_at": "2026-07-08T17:00:01.120Z",
  "observed_at": "2026-07-08T17:00:01.168Z",
  "confidence": 0.92,
  "source": "local_perception",
  "stabilization_window_ms": 160,
  "evidence_event_ids": []
}
```

## Canonical Events

### `hand.entered_zone`

- Purpose: Mark a tracked hand entering a calibrated desk zone.
- Producer: `EventStabilizer`.
- Consumer: `QuestStateTracker`, `HUDCommandEmitter`, `ReplayRecorder`.
- Required fields: common envelope, `hand_id`, `zone_id`, `zone_label`, `entry_point`, `tracking_id`.
- Optional fields: `dwell_ms`, `handedness`, `related_object_id`.
- Confidence semantics: Actionable at `>= 0.85`; below that only highlights provisional HUD state.
- Timestamp semantics: `occurred_at` is first frame in the accepted stabilization window.
- Failure cases: false zone boundary, camera bump, hand/object overlap.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_hand_enter_001",
  "schema_version": "1.0.0",
  "event_type": "hand.entered_zone",
  "session_id": "ses_focus_001",
  "sequence": 10,
  "producer": "EventStabilizer",
  "occurred_at": "2026-07-08T17:00:01.120Z",
  "observed_at": "2026-07-08T17:00:01.260Z",
  "confidence": 0.91,
  "source": "local_perception",
  "stabilization_window_ms": 140,
  "evidence_event_ids": [],
  "hand_id": "hand_right",
  "zone_id": "zone_focus",
  "zone_label": "Focus Zone",
  "entry_point": {"x": 0.61, "y": 0.48},
  "tracking_id": "trk_hand_77",
  "handedness": "right"
}
```

### `hand.left_zone`

- Purpose: Mark a tracked hand leaving a calibrated desk zone.
- Producer: `EventStabilizer`.
- Consumer: `QuestStateTracker`, `HUDCommandEmitter`, `ReplayRecorder`.
- Required fields: common envelope, `hand_id`, `zone_id`, `zone_label`, `exit_point`, `tracking_id`, `dwell_ms`.
- Optional fields: `handedness`, `related_object_id`.
- Confidence semantics: Actionable at `>= 0.85`; lower confidence can clear only provisional HUD highlights.
- Timestamp semantics: `occurred_at` is first frame outside the zone after stabilization.
- Failure cases: occlusion, hand lost at edge, zone drift.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_hand_left_001",
  "schema_version": "1.0.0",
  "event_type": "hand.left_zone",
  "session_id": "ses_focus_001",
  "sequence": 11,
  "producer": "EventStabilizer",
  "occurred_at": "2026-07-08T17:00:02.120Z",
  "observed_at": "2026-07-08T17:00:02.280Z",
  "confidence": 0.89,
  "source": "local_perception",
  "stabilization_window_ms": 160,
  "evidence_event_ids": [],
  "hand_id": "hand_right",
  "zone_id": "zone_focus",
  "zone_label": "Focus Zone",
  "exit_point": {"x": 0.74, "y": 0.53},
  "tracking_id": "trk_hand_77",
  "dwell_ms": 1000
}
```

### `gesture.detected`

- Purpose: Represent a stabilized gesture or activity primitive.
- Producer: `EventStabilizer`.
- Consumer: `QuestStateTracker`, `HUDCommandEmitter`, `ReplayRecorder`.
- Required fields: common envelope, `gesture_id`, `gesture_type`, `zone_id`, `actor_ref`, `evidence_window_ms`.
- Optional fields: `direction`, `related_object_id`, `gesture_velocity`, `gesture_repetition_count`.
- Confidence semantics: Quest transitions require `>= 0.82` and an allowed gesture for the current state.
- Timestamp semantics: `occurred_at` is midpoint of the gesture evidence window.
- Failure cases: false activation, repetitive motion mistaken for intent, overlap with object movement.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_gesture_001",
  "schema_version": "1.0.0",
  "event_type": "gesture.detected",
  "session_id": "ses_focus_001",
  "sequence": 20,
  "producer": "EventStabilizer",
  "occurred_at": "2026-07-08T17:01:00.500Z",
  "observed_at": "2026-07-08T17:01:00.620Z",
  "confidence": 0.88,
  "source": "local_perception",
  "stabilization_window_ms": 240,
  "evidence_event_ids": [],
  "gesture_id": "gst_001",
  "gesture_type": "writing_motion",
  "zone_id": "zone_notebook",
  "actor_ref": "hand_right",
  "evidence_window_ms": 900,
  "related_object_id": "obj_pen"
}
```

### `object.moved`

- Purpose: Mark a tracked object moving between positions or zones.
- Producer: `EventStabilizer`.
- Consumer: `QuestStateTracker`, `HUDCommandEmitter`, `ReplayRecorder`.
- Required fields: common envelope, `object_id`, `object_type`, `from_zone_id`, `to_zone_id`, `motion_vector`, `displacement_norm`, `duration_ms`.
- Optional fields: `start_bbox`, `end_bbox`, `carried_by_hand_id`.
- Confidence semantics: State-changing moves require `>= 0.86`; phone removal requires `to_zone_id` outside active focus zone.
- Timestamp semantics: `occurred_at` is first frame of the accepted movement segment.
- Failure cases: reflective object, hand covering object, object leaves frame.
- Can trigger LLM/VLM escalation: Yes, only when `object_type` is ambiguous and the object is required by the active quest step.

```json
{
  "event_id": "evt_object_moved_001",
  "schema_version": "1.0.0",
  "event_type": "object.moved",
  "session_id": "ses_focus_001",
  "sequence": 30,
  "producer": "EventStabilizer",
  "occurred_at": "2026-07-08T17:02:00.000Z",
  "observed_at": "2026-07-08T17:02:00.240Z",
  "confidence": 0.9,
  "source": "local_perception",
  "stabilization_window_ms": 240,
  "evidence_event_ids": [],
  "object_id": "obj_phone",
  "object_type": "phone",
  "from_zone_id": "zone_focus",
  "to_zone_id": "zone_off_desk",
  "motion_vector": {"dx": -0.42, "dy": 0.07},
  "displacement_norm": 0.43,
  "duration_ms": 1180
}
```

### `object.placed`

- Purpose: Mark a tracked object resting in a zone after movement or detection.
- Producer: `EventStabilizer`.
- Consumer: `QuestStateTracker`, `HUDCommandEmitter`, `ReplayRecorder`.
- Required fields: common envelope, `object_id`, `object_type`, `zone_id`, `rest_bbox`, `dwell_ms`.
- Optional fields: `orientation_degrees`, `alias`, `placed_by_hand_id`.
- Confidence semantics: Quest transitions require `>= 0.86` and dwell `>= 500ms` unless overridden by a replay fixture.
- Timestamp semantics: `occurred_at` is first frame after object rest begins.
- Failure cases: object misclassified, partial view, temporary placement.
- Can trigger LLM/VLM escalation: Yes, only for ambiguous required objects.

```json
{
  "event_id": "evt_object_placed_001",
  "schema_version": "1.0.0",
  "event_type": "object.placed",
  "session_id": "ses_focus_001",
  "sequence": 40,
  "producer": "EventStabilizer",
  "occurred_at": "2026-07-08T17:03:10.000Z",
  "observed_at": "2026-07-08T17:03:10.640Z",
  "confidence": 0.89,
  "source": "local_perception",
  "stabilization_window_ms": 640,
  "evidence_event_ids": [],
  "object_id": "obj_notebook",
  "object_type": "notebook",
  "zone_id": "zone_notebook",
  "rest_bbox": {"x": 0.33, "y": 0.40, "width": 0.28, "height": 0.22},
  "dwell_ms": 720
}
```

### `zone.activated`

- Purpose: Mark a desk zone becoming active through a validated gesture, object, or state rule.
- Producer: `QuestStateTracker` or `EventStabilizer`.
- Consumer: `HUDCommandEmitter`, `Planner`, `ReplayRecorder`.
- Required fields: common envelope, `zone_id`, `activation_reason`, `trigger_event_id`.
- Optional fields: `active_until`, `quest_step_id`, `visual_priority`.
- Confidence semantics: Inherits confidence from `trigger_event_id`; state transitions require `>= 0.82`.
- Timestamp semantics: `occurred_at` is the accepted activation time, not the first raw frame.
- Failure cases: stale trigger, zone drift, accidental dwell.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_zone_activated_001",
  "schema_version": "1.0.0",
  "event_type": "zone.activated",
  "session_id": "ses_focus_001",
  "sequence": 50,
  "producer": "QuestStateTracker",
  "occurred_at": "2026-07-08T17:03:11.000Z",
  "observed_at": "2026-07-08T17:03:11.020Z",
  "confidence": 0.89,
  "source": "state_machine",
  "stabilization_window_ms": 0,
  "evidence_event_ids": ["evt_object_placed_001"],
  "zone_id": "zone_notebook",
  "activation_reason": "object_placed",
  "trigger_event_id": "evt_object_placed_001",
  "quest_step_id": "step_notebook_open"
}
```

### `confidence.changed`

- Purpose: Record a meaningful confidence change for a scene, entity, zone, state, or event chain.
- Producer: `EventStabilizer`, `QuestStateTracker`, or `UncertaintyResolver`.
- Consumer: `HUDCommandEmitter`, `QuestStateTracker`, `CostRouter`, `ReplayRecorder`.
- Required fields: common envelope, `target_ref`, `previous_confidence`, `current_confidence`, `reason_code`.
- Optional fields: `recovery_hint`, `affected_event_ids`.
- Confidence semantics: The event confidence is confidence in the confidence update; `current_confidence` is the value being reported.
- Timestamp semantics: `occurred_at` is when the confidence crossed a policy threshold.
- Failure cases: noisy threshold flapping, stale target reference, unbounded confidence decay.
- Can trigger LLM/VLM escalation: Yes, only when the target is required for the active quest step and falls below the minimum threshold.

```json
{
  "event_id": "evt_confidence_changed_001",
  "schema_version": "1.0.0",
  "event_type": "confidence.changed",
  "session_id": "ses_focus_001",
  "sequence": 60,
  "producer": "EventStabilizer",
  "occurred_at": "2026-07-08T17:04:00.000Z",
  "observed_at": "2026-07-08T17:04:00.040Z",
  "confidence": 0.94,
  "source": "local_perception",
  "stabilization_window_ms": 120,
  "evidence_event_ids": [],
  "target_ref": "scene",
  "previous_confidence": 0.88,
  "current_confidence": 0.61,
  "reason_code": "low_light"
}
```

### `scene.uncertain`

- Purpose: Represent a scene condition that prevents confident local state updates.
- Producer: `EventStabilizer` or `QuestStateTracker`.
- Consumer: `HUDCommandEmitter`, `CostRouter`, `UncertaintyResolver`, `ReplayRecorder`.
- Required fields: common envelope, `uncertainty_kind`, `affected_refs`, `resolver_hint`, `escalation_recommended`.
- Optional fields: `privacy_scope`, `blocked_transition`, `max_wait_ms`.
- Confidence semantics: `confidence` is confidence that the scene is uncertain, not confidence in an interpretation.
- Timestamp semantics: `occurred_at` is when uncertainty persisted beyond the stabilization window.
- Failure cases: over-sensitive uncertainty, repeated escalation, hidden blocked state.
- Can trigger LLM/VLM escalation: Yes, through `CostRouter` only.

```json
{
  "event_id": "evt_scene_uncertain_001",
  "schema_version": "1.0.0",
  "event_type": "scene.uncertain",
  "session_id": "ses_focus_001",
  "sequence": 70,
  "producer": "QuestStateTracker",
  "occurred_at": "2026-07-08T17:05:00.000Z",
  "observed_at": "2026-07-08T17:05:00.050Z",
  "confidence": 0.92,
  "source": "state_machine",
  "stabilization_window_ms": 500,
  "evidence_event_ids": ["evt_confidence_changed_001"],
  "uncertainty_kind": "ambiguous_object",
  "affected_refs": ["obj_unknown_4", "step_pen_detected"],
  "resolver_hint": "confirm_required_object_type",
  "escalation_recommended": true,
  "privacy_scope": "object_crop_only"
}
```

### `scene.reset`

- Purpose: Reset scene or quest state after calibration, camera movement, user reset, or unrecoverable drift.
- Producer: `QuestStateTracker` or `HumanCorrectionHandler`.
- Consumer: `EventStabilizer`, `QuestStateTracker`, `HUDCommandEmitter`, `ReplayRecorder`.
- Required fields: common envelope, `reset_reason`, `reset_scope`, `previous_state_id`.
- Optional fields: `new_state_id`, `requires_recalibration`, `user_visible_message`.
- Confidence semantics: Resets from user action are `1.0`; automatic resets require `>= 0.9`.
- Timestamp semantics: `occurred_at` is the decision time.
- Failure cases: accidental reset, replay divergence, lost calibration.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_scene_reset_001",
  "schema_version": "1.0.0",
  "event_type": "scene.reset",
  "session_id": "ses_focus_001",
  "sequence": 80,
  "producer": "QuestStateTracker",
  "occurred_at": "2026-07-08T17:05:30.000Z",
  "observed_at": "2026-07-08T17:05:30.010Z",
  "confidence": 0.96,
  "source": "state_machine",
  "stabilization_window_ms": 0,
  "evidence_event_ids": ["evt_scene_uncertain_001"],
  "reset_reason": "camera_bump",
  "reset_scope": "calibration",
  "previous_state_id": "pen_pending",
  "requires_recalibration": true
}
```

### `quest.step_started`

- Purpose: Mark the active quest step and expected evidence.
- Producer: `QuestStateTracker` or `Planner`.
- Consumer: `HUDCommandEmitter`, `ReplayRecorder`, `Planner`.
- Required fields: common envelope, `quest_id`, `step_id`, `step_name`, `expected_evidence`.
- Optional fields: `deadline_at`, `instruction_id`, `step_attempt`.
- Confidence semantics: Deterministic state-machine events use `1.0`.
- Timestamp semantics: `occurred_at` is when the step became active.
- Failure cases: duplicate step start, out-of-order replay, stale planner instruction.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_step_started_001",
  "schema_version": "1.0.0",
  "event_type": "quest.step_started",
  "session_id": "ses_focus_001",
  "sequence": 90,
  "producer": "QuestStateTracker",
  "occurred_at": "2026-07-08T17:06:00.000Z",
  "observed_at": "2026-07-08T17:06:00.005Z",
  "confidence": 1.0,
  "source": "state_machine",
  "stabilization_window_ms": 0,
  "evidence_event_ids": [],
  "quest_id": "focus_ritual",
  "step_id": "step_phone_removal",
  "step_name": "Remove phone from focus zone",
  "expected_evidence": ["object.moved:phone:zone_focus->zone_off_desk"]
}
```

### `quest.step_completed`

- Purpose: Mark a quest step completed by accepted evidence.
- Producer: `QuestStateTracker`.
- Consumer: `Planner`, `HUDCommandEmitter`, `MemoryGate`, `ReplayRecorder`.
- Required fields: common envelope, `quest_id`, `step_id`, `completion_reason`, `elapsed_ms`, `accepted_evidence_event_ids`.
- Optional fields: `next_step_id`, `reward_level`.
- Confidence semantics: Derived from the weakest accepted evidence event and guard confidence.
- Timestamp semantics: `occurred_at` is when the transition guard passed.
- Failure cases: premature completion, missing evidence, repeated completion.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_step_completed_001",
  "schema_version": "1.0.0",
  "event_type": "quest.step_completed",
  "session_id": "ses_focus_001",
  "sequence": 100,
  "producer": "QuestStateTracker",
  "occurred_at": "2026-07-08T17:06:10.000Z",
  "observed_at": "2026-07-08T17:06:10.008Z",
  "confidence": 0.9,
  "source": "state_machine",
  "stabilization_window_ms": 0,
  "evidence_event_ids": ["evt_object_moved_001"],
  "quest_id": "focus_ritual",
  "step_id": "step_phone_removal",
  "completion_reason": "phone_removed_from_focus_zone",
  "elapsed_ms": 10000,
  "accepted_evidence_event_ids": ["evt_object_moved_001"],
  "next_step_id": "step_notebook_open"
}
```

### `quest.step_failed`

- Purpose: Mark a quest step failed or timed out with recovery metadata.
- Producer: `QuestStateTracker`.
- Consumer: `Planner`, `HUDCommandEmitter`, `MemoryGate`, `ReplayRecorder`.
- Required fields: common envelope, `quest_id`, `step_id`, `failure_reason`, `recoverable`, `failed_guard`, `next_recovery_state`.
- Optional fields: `attempt_count`, `timeout_ms`, `suggested_correction`.
- Confidence semantics: Deterministic failure timers are `1.0`; visual failures inherit evidence confidence.
- Timestamp semantics: `occurred_at` is when the failure condition was accepted.
- Failure cases: hidden timeout, wrong recovery state, LLM loop after failure.
- Can trigger LLM/VLM escalation: Yes, for stuck recovery through `CostRouter`.

```json
{
  "event_id": "evt_step_failed_001",
  "schema_version": "1.0.0",
  "event_type": "quest.step_failed",
  "session_id": "ses_focus_001",
  "sequence": 110,
  "producer": "QuestStateTracker",
  "occurred_at": "2026-07-08T17:08:00.000Z",
  "observed_at": "2026-07-08T17:08:00.010Z",
  "confidence": 1.0,
  "source": "state_machine",
  "stabilization_window_ms": 0,
  "evidence_event_ids": [],
  "quest_id": "focus_ritual",
  "step_id": "step_pen_detected",
  "failure_reason": "timeout_waiting_for_pen",
  "recoverable": true,
  "failed_guard": "object_type_pen_in_zone_notebook",
  "next_recovery_state": "recovery",
  "attempt_count": 1,
  "timeout_ms": 45000
}
```

### `agent.instruction_issued`

- Purpose: Record a typed instruction from a graph node to another node or UI surface.
- Producer: `Planner`, `Narrator`, `UncertaintyResolver`, or `HumanCorrectionHandler`.
- Consumer: Target node, `HUDCommandEmitter`, `ReplayRecorder`.
- Required fields: common envelope, `instruction_id`, `source_agent`, `target_agent`, `instruction_kind`, `instruction_text`, `constraints`.
- Optional fields: `expires_at`, `related_step_id`, `model_route_id`.
- Confidence semantics: `confidence` is confidence in instruction suitability; it does not prove state.
- Timestamp semantics: `occurred_at` is when the instruction was emitted.
- Failure cases: vague instruction, overlapping command, stale target.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_instruction_001",
  "schema_version": "1.0.0",
  "event_type": "agent.instruction_issued",
  "session_id": "ses_focus_001",
  "sequence": 120,
  "producer": "Planner",
  "occurred_at": "2026-07-08T17:08:05.000Z",
  "observed_at": "2026-07-08T17:08:05.004Z",
  "confidence": 0.87,
  "source": "langgraph",
  "stabilization_window_ms": 0,
  "evidence_event_ids": ["evt_step_failed_001"],
  "instruction_id": "ins_recover_pen",
  "source_agent": "Planner",
  "target_agent": "HUDCommandEmitter",
  "instruction_kind": "recovery_prompt",
  "instruction_text": "Ask the user to place the pen in the notebook zone.",
  "constraints": ["no_state_change", "single_prompt", "visible_recovery_state"]
}
```

### `agent.escalation_requested`

- Purpose: Request a model or human escalation through a budgeted route.
- Producer: `CostRouter`, `QuestStateTracker`, or `UncertaintyResolver`.
- Consumer: `CostRouter`, `UncertaintyResolver`, `HumanCorrectionHandler`, `ReplayRecorder`.
- Required fields: common envelope, `escalation_id`, `requested_tier`, `reason_code`, `source_event_ids`, `privacy_scope`, `user_visible`.
- Optional fields: `max_latency_ms`, `max_cost_usd`, `redaction_strategy`.
- Confidence semantics: `confidence` is confidence that escalation is justified.
- Timestamp semantics: `occurred_at` is when deterministic handling was exhausted.
- Failure cases: privacy leak, over-triggering, cost budget exceeded.
- Can trigger LLM/VLM escalation: Yes, this is the escalation contract.

```json
{
  "event_id": "evt_escalation_001",
  "schema_version": "1.0.0",
  "event_type": "agent.escalation_requested",
  "session_id": "ses_focus_001",
  "sequence": 130,
  "producer": "CostRouter",
  "occurred_at": "2026-07-08T17:08:06.000Z",
  "observed_at": "2026-07-08T17:08:06.004Z",
  "confidence": 0.91,
  "source": "langgraph",
  "stabilization_window_ms": 0,
  "evidence_event_ids": ["evt_scene_uncertain_001"],
  "escalation_id": "esc_ambiguous_pen_001",
  "requested_tier": 4,
  "reason_code": "required_object_ambiguous",
  "source_event_ids": ["evt_scene_uncertain_001"],
  "privacy_scope": "object_crop_only",
  "user_visible": true,
  "max_cost_usd": 0.002
}
```

### `memory.write_requested`

- Purpose: Request a scoped, evidence-backed memory write.
- Producer: `MemoryGate`, `HumanCorrectionHandler`, or `QuestStateTracker`.
- Consumer: Memory service, `ReplayRecorder`, audit log.
- Required fields: common envelope, `memory_id`, `memory_scope`, `memory_subject`, `memory_value`, `evidence_event_ids`, `ttl_days`, `promotion_reason`.
- Optional fields: `delete_after_session`, `redaction_notes`, `supersedes_memory_id`.
- Confidence semantics: `confidence` is confidence that the memory is useful and correctly scoped.
- Timestamp semantics: `occurred_at` is when the memory candidate was accepted by the gate.
- Failure cases: memory pollution, private content capture, unsupported global promotion.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_memory_write_001",
  "schema_version": "1.0.0",
  "event_type": "memory.write_requested",
  "session_id": "ses_focus_001",
  "sequence": 140,
  "producer": "MemoryGate",
  "occurred_at": "2026-07-08T17:10:00.000Z",
  "observed_at": "2026-07-08T17:10:00.005Z",
  "confidence": 0.93,
  "source": "langgraph",
  "stabilization_window_ms": 0,
  "evidence_event_ids": ["evt_step_completed_001"],
  "memory_id": "mem_alias_pen_blue",
  "memory_scope": "object_alias",
  "memory_subject": "obj_pen",
  "memory_value": "User correction says the blue stylus should be treated as pen.",
  "ttl_days": 90,
  "promotion_reason": "user_correction"
}
```

### `hud.command_emitted`

- Purpose: Record an instruction to the HUD renderer.
- Producer: `HUDCommandEmitter`.
- Consumer: HUD runtime, `ReplayRecorder`, eval harness.
- Required fields: common envelope, `command_id`, `command_type`, `target_surface`, `visual_state`, `priority`, `expires_at`.
- Optional fields: `related_step_id`, `animation_budget_ms`, `accessibility_label`.
- Confidence semantics: HUD commands that imply state must reference state-machine evidence; decorative commands inherit current state confidence.
- Timestamp semantics: `occurred_at` is when the command should become visible.
- Failure cases: HUD masks failure, stale command persists, overlapping command priorities.
- Can trigger LLM/VLM escalation: No.

```json
{
  "event_id": "evt_hud_command_001",
  "schema_version": "1.0.0",
  "event_type": "hud.command_emitted",
  "session_id": "ses_focus_001",
  "sequence": 150,
  "producer": "HUDCommandEmitter",
  "occurred_at": "2026-07-08T17:10:00.020Z",
  "observed_at": "2026-07-08T17:10:00.022Z",
  "confidence": 0.9,
  "source": "hud_emitter",
  "stabilization_window_ms": 0,
  "evidence_event_ids": ["evt_step_completed_001"],
  "command_id": "hud_step_complete_phone",
  "command_type": "step_complete",
  "target_surface": "quest_panel",
  "visual_state": "complete",
  "priority": "high",
  "expires_at": "2026-07-08T17:10:03.020Z",
  "related_step_id": "step_phone_removal",
  "animation_budget_ms": 250
}
```

