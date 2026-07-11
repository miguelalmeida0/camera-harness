# Instant Automation Outcome Codes v1

Every stable-gesture observation and instant authorization branch returns one explicit code. Generic `blocked`, `ignored`, `unavailable`, `false`, or `null` outcomes are invalid.

## Stabilizer

- `instant_gesture_below_threshold`: supported label is below confidence threshold.
- `instant_gesture_hold_not_met`: candidate has not reached the configured hold duration.
- `instant_gesture_stable`: one stable local gesture event was emitted.
- `instant_gesture_duplicate`: continued hold or duplicate event delivery was suppressed.
- `instant_gesture_neutral_reset_missing`: neutral reset has not completed.
- `instant_gesture_neutral_reset_complete`: neutral reset completed without execution.
- `instant_gesture_cooldown_active`: recipe or gesture remains in cooldown.

## Activation And Recipe Authorization

- `instant_gesture_not_enabled`: session activation is off.
- `instant_recipe_not_enabled`: no enabled, explicitly consented recipe is available.
- `instant_recipe_wrong_mode`: a `confirmed_ai_movement` recipe received a local gesture.
- `instant_camera_inactive`: camera is stopped or unavailable.
- `instant_document_hidden`: the page is hidden.
- `instant_engine_unavailable`: the local gesture worker is not ready.
- `instant_gesture_invalid_event`: stable event schema or fields are invalid.
- `instant_session_limit_exceeded`: bounded session execution limit was reached.

## Action Policy

- `instant_snapshot_forbidden`: snapshot/media capture is denied.
- `instant_webhook_forbidden`: webhook execution is denied.
- `instant_ai_call_forbidden`: AI, VLM, provider, or movement-recognition action is denied.
- `instant_action_not_allowlisted`: action is not on the instant local allowlist.
- `instant_notification_permission_required`: notification permission was not already granted.
- `instant_recursive_analysis`: recursive automation or movement analysis is denied.

## Execution

- `instant_action_executed`: exactly one adapter execution succeeded and one receipt was created.
- `instant_action_failed`: an allowlisted local adapter attempted execution but failed safely.

Receipts remain text-only and contain no raw media. Idempotency is `gesture_event_id + recipe_id`.
