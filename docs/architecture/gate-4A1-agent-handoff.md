# Gate 4A.1 Agent Handoff

## To Multimodal

Implement the real local camera engine.

Priorities:

- add MediaPipe hand tracking if feasible;
- keep motion proxy fallback;
- compute hand-zone overlap;
- implement current-step-aware action scoring;
- add confidence smoothing;
- add rejection cooldowns;
- wire the existing Detected Action card;
- keep trace tools hidden;
- preserve the frozen UI design.

Do not:

- redesign the UI;
- add cloud frame upload;
- add LLM/VLM calls to camera hot path;
- persist raw media;
- auto-complete actions;
- claim autonomous vision, object detection proof, gesture recognition proof, or production perception.

Suggested implementation order:

1. Wrap existing motion proxy into stable engine functions.
2. Add `LocalPerceptionFrame` construction.
3. Add action scorer tests for each action type.
4. Add confidence smoothing and cooldowns.
5. Add MediaPipe hand engine behind capability detection.
6. Add hand-zone overlap.
7. Wire Detected Action adapter.
8. Add hidden diagnostics.

## To Harness

Create an engine-level Gate 4A.1 that cannot pass from docs alone.

Required checks:

- synthetic scorer tests for `phone_moved`;
- synthetic scorer tests for `notebook_opened`;
- synthetic scorer tests for `pen_picked_up`;
- synthetic scorer tests for `writing_motion`;
- synthetic scorer tests for `typing_motion`;
- uncertainty tests;
- current-step suppression tests;
- rejection cooldown tests;
- no raw media persistence checks;
- no model/VLM checks;
- product UX regression checks;
- hidden developer tooling checks.

Physical benchmark protocol:

- at least 25 physical action attempts before stronger perception claims;
- log confirmations and rejections;
- document false positives;
- document false negatives;
- record only symbolic observations;
- do not persist raw media.

Gate 4A.1 should fail if it can pass with docs only or if it cannot distinguish real engine signals from placeholder text.

