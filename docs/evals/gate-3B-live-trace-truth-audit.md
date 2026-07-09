# Gate 3B-Live Trace Truth Audit

| Trace | Expected physical action | Expected suggestion | Expected confirmation behavior | Expected trace evidence | Expected replay behavior | Result |
|---|---|---|---|---|---|---|
| phone moved | operator physically moves phone away | phone-step motion-proxy suggestion | manual confirmation required | `local_signal`, `human_correction`, `accepted_from_suggestion_id` | replay repeat 3 passes | Missing |
| notebook opened | operator opens notebook | notebook-step motion-proxy suggestion | manual confirmation required | `local_signal`, `human_correction`, `accepted_from_suggestion_id` | replay repeat 3 passes | Missing |
| pen picked up | operator picks up pen | pen-step motion-proxy suggestion | manual confirmation required | `local_signal`, `human_correction`, `accepted_from_suggestion_id` | replay repeat 3 passes | Missing |
| writing motion | operator writes three bullets | writing motion-proxy suggestion | manual confirmation required | `detection_method: motion_proxy`, `local_signal`, `human_correction` | replay repeat 3 passes | Missing |
| typing motion | operator starts typing | typing motion-proxy suggestion | manual confirmation required | `detection_method: motion_proxy`, `local_signal`, `human_correction` | replay repeat 3 passes | Missing |
| reject trace | operator rejects a suggestion | rejected suggestion recorded in summary | rejection must not progress quest | `suggestions_rejected >= 1`, no progressed quest transition | replay repeat 3 passes | Missing |
| uncertain scene | camera/noise uncertainty occurs | uncertainty surfaced, no unsafe progress | operator resolves manually | `scene.uncertain`, local signal, zero auto-complete | replay repeat 3 passes | Missing |
| full ritual | full Focus Ritual with suggestions | suggestion-assisted ritual | all accepted steps remain confirmation-gated | symbolic events only, accepted suggestion IDs present | replay repeat 3 passes | Missing |

## Audit Position

Gate 3B-Live remains blocked until these physical browser suggestion traces exist and pass replay/safety checks.
