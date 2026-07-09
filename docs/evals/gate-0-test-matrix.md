# Gate 0 Test Matrix

## Decision

The first Gate 0 matrix starts with one happy-path fixture and ten failure fixtures. The matrix is designed to prove that the replay spine catches missing evidence, ordering bugs, false positives, unexpected model calls, memory pollution, raw media leakage, hidden uncertainty, and nondeterminism.

## Matrix

| ID | Fixture | Purpose | Input mutation | Expected verdict | Required failure code |
|---|---|---|---|---|---|
| G0-001 | Happy path | Prove six-step Focus Ritual can replay deterministically. | Valid scene, phone away, notebook placed, pen moved, writing gesture, typing gesture. | `PASS` | None |
| G0B-002 | Broad stable matcher | Prevent vague event-family assertions. | Expected stable matcher omits exact event ID, payload matcher, and evidence refs. | `FAIL` | `stable_event_assertion_too_broad` |
| G0B-003 | Missing phone event | Prevent quest completion without phone evidence. | Remove `object.moved` phone event. | `FAIL` | `quest_transition_missing` |
| G0B-004 | Notebook out of order | Enforce ordered transitions. | Place notebook before phone is moved away. | `FAIL` | `quest_transition_out_of_order` |
| G0B-005 | Pen false positive | Reject low-confidence pen completion. | Emit pen movement with confidence `< 0.86`. | `FAIL` | `quest_transition_missing` |
| G0B-006 | Writing before pen | Prevent writing step before pen evidence. | Emit `gesture.detected` writing before pen pickup. | `FAIL` | `quest_transition_out_of_order` |
| G0B-007 | Typing before writing | Prevent typing step before writing evidence. | Emit `gesture.detected` typing before writing gesture. | `FAIL` | `quest_transition_out_of_order` |
| G0B-008 | Short writing repetition | Enforce three-bullet writing evidence. | Emit writing motion with `gesture_repetition_count: 2`. | `FAIL` | `quest_transition_missing` |
| G0B-009 | Unexpected VLM call | Prove no unapproved model calls. | Add `agent.escalation_requested` with `requested_tier: 4`. | `FAIL` | `unexpected_model_call` |
| G0B-010 | Full-frame model scope | Enforce no full-frame VLM privacy scope. | Add `agent.escalation_requested` with `privacy_scope: "full_frame"`. | `FAIL` | `model_call_without_permission`, `unexpected_model_call` |
| G0B-011 | Memory write without evidence | Enforce memory gate policy. | Add `memory.write_requested` with empty `evidence_event_ids`. | `FAIL` | `memory_write_without_evidence` |
| G0B-012 | Raw video flag violation | Enforce no raw media persistence. | Set `privacy.contains_raw_video: true`. | `FAIL` | `raw_media_persistence` |
| G0B-013 | Vague payload key | Reject untyped freeform payload fields. | Add forbidden payload key `data`. | `FAIL` | `payload_shape_mismatch` |
| G0B-014 | Uncertainty hidden | Ensure HUD does not hide active uncertainty. | Use harness self-test simulation to suppress uncertainty HUD output. | `FAIL` | `hud_uncertainty_hidden`, `unexpected_stable_event` |
| G0B-015 | Nondeterministic output | Detect unstable replay outputs across repeats. | Use harness self-test simulation to reverse stable event order on alternating runs. | `FAIL` | `nondeterministic_replay` |
| G0B-014 | Uncertainty state not shown | Ensure HUD does not hide uncertainty. | Simulate a broken HUD path that suppresses `show_uncertain_state`. | `FAIL` | `hud_uncertainty_hidden`, `unexpected_stable_event` |
| G0B-015 | Nondeterministic replay output | Detect unstable replay results. | Simulate unstable stable-event ordering across repeated runs. | `FAIL` | `nondeterministic_replay` |

## Happy path expected stable events

| Order | Event ID | Type | Key payload |
|---:|---|---|---|
| 1 | `evt_scene_calibrated` | `scene.calibrated` | `scene_confidence >= 0.80` |
| 2 | `evt_keyboard_present` | `object.placed` | `object_type: "keyboard"`, `zone_id: "zone_keyboard"` |
| 3 | `evt_phone_present` | `object.placed` | `object_type: "phone"`, `zone_id: "zone_focus"` |
| 4 | `evt_phone_moved_away` | `object.moved` | `object_type: "phone"`, `from_zone_id: "zone_focus"`, `to_zone_id != "zone_focus"` |
| 5 | `evt_notebook_placed` | `object.placed` | `object_type: "notebook"`, `zone_id: "zone_notebook"`, `dwell_ms >= 500` |
| 6 | `evt_hand_entered_pen_zone` | `hand.entered_zone` | `hand_id: "hand_right"`, `zone_id: "zone_pen_tool"` |
| 7 | `evt_pen_moved_to_notebook` | `object.moved` | `object_type: "pen"`, `to_zone_id: "zone_notebook"` |
| 8 | `evt_writing_three_bullets` | `gesture.detected` | `gesture_type: "writing_motion"`, `gesture_repetition_count >= 3` |
| 9 | `evt_typing_started` | `gesture.detected` | `gesture_type: "typing_motion"`, `zone_id: "zone_keyboard"` |

## Happy path expected transitions

| Order | From | To | Step ID | Trigger |
|---:|---|---|---|---|
| 1 | `phone_removal_pending` | `phone_removed` | `step_phone_away` | `evt_phone_moved_away` |
| 2 | `notebook_pending` | `notebook_opened` | `step_notebook_open` | `evt_notebook_placed` |
| 3 | `pen_pending` | `pen_detected` | `step_pen_pickup` | `evt_pen_moved_to_notebook` |
| 4 | `writing_pending` | `writing_detected` | `step_write_three_bullets` | `evt_writing_three_bullets` |
| 5 | `typing_pending` | `typing_detected` | `step_start_typing` | `evt_typing_started` |
| 6 | `typing_detected` | `quest_complete` | `step_quest_complete` | `evt_step_start_typing_completed` |

## Happy path expected HUD commands

| Order | Command ID | Command type | Related step |
|---:|---|---|---|
| 1 | `hud_mark_phone_away` | `mark_step_complete` | `step_phone_away` |
| 2 | `hud_mark_notebook_open` | `mark_step_complete` | `step_notebook_open` |
| 3 | `hud_mark_pen_pickup` | `mark_step_complete` | `step_pen_pickup` |
| 4 | `hud_mark_write_three_bullets` | `mark_step_complete` | `step_write_three_bullets` |
| 5 | `hud_mark_start_typing` | `mark_step_complete` | `step_start_typing` |
| 6 | `hud_quest_complete` | `quest_complete` | `step_quest_complete` |

## Fixture build order

1. Build `fixtures/replay/focus_ritual_happy_path.v0.json`.
2. Build one failure fixture per matrix row.
3. Register the fixture in `fixtures/replay/gate_0b_manifest.json` with its exact expected verdict and failure-code set.
4. Run `darkquest-eval gate-0b fixtures/replay/gate_0b_manifest.json`.
5. Block merge if any expected `PASS` fixture fails, any expected `FAIL` fixture passes, any expected failure code is missing, or any unexpected failure code appears.

## Cost/latency impact

All Gate 0 matrix fixtures must run with zero model cost. Each fixture should complete under `1000ms` locally unless a specific stress fixture declares a lower or higher limit.

## Handoff to next agent

After G0-001 passes, implement and maintain the Gate 0B adversarial manifest before any live camera demo branch is accepted.
