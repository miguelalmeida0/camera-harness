# Automation Recipe Presets

All presets require explicit movement confirmation and explicit recipe consent. Presets are disabled templates until the user reviews their configuration.

| Preset | Trigger | Adapter | Tier | Per-run confirmation | Additional setup |
| --- | --- | --- | --- | --- | --- |
| Peace sign -> Download local snapshot | `peace_sign` plus `two_fingers_raised` | `local_snapshot_download` | 2 | Required every run | Camera active; no webhook or notification permission |
| Thumbs up -> Increment completion counter | `thumbs_up` | `increment_counter` | 0 | Not required by default | Counter name and session cap |
| Raise hand -> Start a 60-second timer | `hand_raised` | `start_timer` | 0 | Not required by default | Duration fixed to 60 seconds |
| Confirmed exercise -> Append workout log | `exercise_completed` | `append_activity_log` | 0 | Not required by default | Local text log name and entry template |
| Swipe right -> Send presentation webhook | `swipe_right` plus `lateral_motion` | `signed_webhook_post` | 1 | Not required beyond movement confirmation by default | Server allowlist destination, optional HMAC `secret_ref` |
| Confirmed movement -> Speak phrase | reserved trigger `any_confirmed_movement` | `speak_phrase` | 0 | Not required by default | Configured phrase and available browser voice |
| Confirmed movement -> Browser notification | reserved trigger `any_confirmed_movement` | `browser_notification` | 1 | Not required beyond movement confirmation by default | Browser notification permission |

## Preset Safety Defaults

- Recipe consent: required for every preset after import or material configuration change.
- Per-run confirmation: mandatory for snapshot capture; users may opt into stricter per-run confirmation for any other recipe.
- Webhook configuration: required only for the signed presentation webhook preset and resolved server-side.
- Browser notification permission: required only for the notification preset and requested from an explicit user gesture.
- All presets use cooldowns, per-session caps, deterministic matching, and the common idempotency key.
- No preset contains a secret value, raw media, arbitrary code, arbitrary URL, or model-selected action.
