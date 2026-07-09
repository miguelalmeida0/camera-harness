# Gate 4A Action Detection Truth Audit

| Action | Input signal | Output candidate | Confidence | Confirmation required | False positive risk | False negative risk | Result |
|---|---|---|---|---|---|---|---|
| possible phone moved | `phone_zone` burst, `off_desk_zone` activity, or directional proxy | `Possible phone moved - confirm to accept.` | local motion-derived, thresholded | yes | hand passes phone zone without moving phone | subtle phone move below threshold | pass with disclosure |
| possible notebook opened | `notebook_zone` burst plus dwell | `Possible notebook opened - confirm to accept.` | local motion-derived, thresholded | yes | hand rests on notebook zone | slow notebook opening below burst threshold | pass with disclosure |
| possible pen picked up | `pen_zone` burst plus nearby activity or direction proxy | `Possible pen picked up - confirm to accept.` | local motion-derived, thresholded | yes | other small tool moves near pen zone | pen pickup outside calibrated zone | pass with disclosure |
| possible writing motion | repeated small `notebook_zone` motion after pen step | `Possible writing motion - confirm to accept.` | local motion-derived, thresholded | yes | non-writing hand motion on notebook | light writing below motion threshold | pass with disclosure |
| possible typing motion | repeated distributed `keyboard_zone` motion after writing step | `Possible typing motion - confirm to accept.` | local motion-derived, thresholded | yes | hand motion near keyboard without typing | quiet/slow typing below threshold | pass with disclosure |
| uncertain | multiple zones active or high sudden local motion | `Possible scene uncertainty - confirm to review.` | local motion-derived, conservative | yes | noisy but recoverable movement | subtle camera bump missed | pass with disclosure |
| reset | persistent high global motion | `Possible camera reset needed - confirm to review.` | local motion-derived, conservative | yes | large desk motion misread as camera reset | small camera bump missed | pass with disclosure |

## Gate Boundary

These are detected action candidates from local motion proxies. They are not autonomous action recognition, object detection proof, gesture recognition proof, or approval for automatic quest completion.
