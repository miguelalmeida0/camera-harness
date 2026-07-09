# Gate 3B Suggestion Truth Audit

| Suggestion | Input signals | Emitted suggestion | Required confirmation | False positive risk | False negative risk | Backing evidence | Result |
|---|---|---|---|---|---|---|---|
| possible phone moved | local motion proxy around `phone_zone` / `off_desk_zone`; quest state must be current step | camera suggestion only | manual local confirmation | hand/object motion may not be phone removal | subtle phone movement may be missed | `local_signal` plus `human_correction` on accept | Pass with disclosure |
| possible notebook opened | local motion proxy around `notebook_zone`; quest state must be current step | camera suggestion only | manual local confirmation | hand over notebook may look like open action | low motion opening may be missed | `local_signal` plus `human_correction` on accept | Pass with disclosure |
| possible pen picked up | local motion proxy around `pen_zone` / `notebook_zone`; quest state must be current step | camera suggestion only | manual local confirmation | hand near pen may not mean pickup | small pen movement may be missed | `local_signal` plus `human_correction` on accept | Pass with disclosure |
| possible writing motion | repeated small local motion in `notebook_zone` during `writing_pending` | `gesture.detected writing_like_motion` suggestion | manual local confirmation | tapping or fidgeting can resemble writing motion | slow writing may fall below threshold | `detection_method: motion_proxy`, `suggestion_only: true`, `local_signal`, `human_correction` | Pass |
| possible typing motion | repeated distributed local motion in `keyboard_zone` during `typing_pending` | `gesture.detected typing_like_motion` suggestion | manual local confirmation | hand rest or non-typing motion may resemble typing | low-motion typing may be missed | `detection_method: motion_proxy`, `suggestion_only: true`, `local_signal`, `human_correction` | Pass |
| scene uncertain | too many active zones or high local motion score | `scene.uncertain` state/event | no quest progression; operator resolves | camera noise may over-trigger uncertainty | brief instability may be missed | `local_signal`, visible uncertainty state | Pass |
| camera reset | operator marks reset/recalibration | `scene.reset` event | manual local confirmation | operator may reset unnecessarily | operator may miss camera bump | `human_correction`, reset visible in HUD | Pass |

## Audit Position

Suggestions are assistance, not proof. Gate 3B allows only motion-proxy suggestion UX with confirmation. Blind auto-completion and autonomous action-recognition claims remain blocked.
