# DarkQuest v1.2.1 Instant Automation Adversarial Matrix

Gate: `npm run gate:v1:instant-automation`

Static strings and policy documents are not acceptance evidence. Each row requires executable pure-function output, an exact denial code where specified, and zero provider/raw-media side effects.

| # | Adversarial case | Executable test | Pass criterion | Failure evidence |
|---:|---|---|---|---|
| 1 | Noisy single frame | One `Thumb_Up` frame above threshold | No event | `instant_gesture_hold_not_met` |
| 2 | Confidence oscillation | Alternate above/below 0.85 | No event | `instant_gesture_below_threshold` |
| 3 | Held gesture duplicate | Continue `Thumb_Up` after one stable event | One event only | `instant_gesture_duplicate` |
| 4 | Neutral bypass | Hold again without neutral | No second event | `instant_gesture_neutral_reset_missing` |
| 5 | Short neutral interval | Neutral shorter than reset duration | Stabilizer remains disarmed | No new event |
| 6 | Cooldown bypass | Rearm but retry before 2500ms | No recipe execution | `instant_gesture_cooldown_active` |
| 7 | Duplicate worker message | Deliver identical `gesture_event_id` twice | One adapter call and receipt | `instant_gesture_duplicate` |
| 8 | Duplicate browser event | Dispatch the same stable event twice | Same idempotency reservation | No second receipt |
| 9 | Tab hidden | Run with hidden document | No match or action | `instant_document_hidden` |
| 10 | Camera stopped | Run with inactive camera | No match or action | `instant_camera_inactive` |
| 11 | Worker unavailable | Run with unavailable engine | No match or action | `instant_engine_unavailable` |
| 12 | Recipe disabled | Match disabled instant recipe | No action | `instant_recipe_not_enabled` |
| 13 | Instant mode disabled | Session toggle off | No action | `instant_gesture_not_enabled` |
| 14 | Wrong recipe mode | Confirmed-AI recipe receives local event | No action | `instant_recipe_wrong_mode` |
| 15 | Snapshot action | Instant recipe requests snapshot | No capture/download | `instant_snapshot_forbidden` |
| 16 | Webhook action | Instant recipe requests signed webhook | No network request | `instant_webhook_forbidden` |
| 17 | External action | Unknown/external adapter requested | No action | `instant_action_not_allowlisted` |
| 18 | VLM invocation attempt | Inject provider/analyze hooks | Hooks never called | `instant_ai_call_forbidden` on attempted path |
| 19 | Recursive automation | Adapter attempts another analysis/execution | One bounded execution | `instant_recursive_analysis` |
| 20 | Excess executions | Exceed recipe/session cap | Additional action denied | Stable rate-limit status |
| 21 | Speech duplication | Replay one thumbs-up event | “Great job” spoken once | One utterance per event |
| 22 | Result-card rerender | Rerender after instant receipt | Snapshot and reveal key unchanged | No new execution |
| 23 | Camera rerender | Process camera telemetry | No full app render or action | No new receipt |
| 24 | Malformed MediaPipe label | Map `None` and unsupported label | Both ignored | Null canonical gesture |
| 25 | Raw media injection | Add frame/base64/landmarks to event | Event rejected | No persistence or adapter call |
| 26 | Notification without permission | Permission is not already granted | No prompt or notification | Permission denial code |

## Exact Acceptance Replay

Recipe: `thumbs_up`, confidence 0.85, hold 350ms, cooldown 2500ms, `speak_phrase`, text `Great job`, instant consent enabled.

Sequence: neutral -> `Thumb_Up` 0.90 -> stable beyond 350ms -> continued hold -> neutral beyond reset duration -> cooldown expiry -> stable `Thumb_Up` again.

Pass requires one first receipt and utterance, no duplicate during continued hold, one second receipt after reset/cooldown, zero VLM/network calls, and no raw-media persistence.
