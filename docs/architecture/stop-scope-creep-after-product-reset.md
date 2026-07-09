# Stop Scope Creep After Product Reset

## Product Direction

DarkQuest is a local camera action app:

```text
camera connects
-> local movement is tracked
-> app suggests what probably happened
-> user confirms or corrects
-> progress updates
```

Replay, traces, gates, and reports are internal QA tools. They must not define the default product experience.

## Allowed

- local camera perception;
- MediaPipe or hand tracking;
- zone motion;
- hand-zone overlap;
- dwell, velocity, and direction heuristics;
- Detected Action card;
- Confirm / Not this loop;
- progress update after confirmation;
- hidden QA validation.

## Blocked

- trace campaign as main UX;
- new dashboard panels unrelated to the camera action loop;
- cinematic polish;
- portfolio/demo claims;
- autonomous vision claims;
- production perception claims;
- cloud/VLM hot path;
- raw media persistence;
- auto-completion;
- hidden manual confirmation.

## Review Rule

If a proposed change does not improve local action suggestion, confirmation, correction, progress, privacy, or hidden QA validation, it is out of scope for Gate 4A.

