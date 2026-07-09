# Gate 4A Main UX Boundary

## Decision

The main product UX is the camera action loop, not the replay or trace campaign workflow.

Default product loop:

```text
Start Camera
-> Calibrate Zones
-> Start Session
-> local camera motion suggests action
-> user confirms or corrects
-> progress updates
```

## Default UI Must Show

- Camera;
- Current Step;
- Detected Action;
- Confirm / Not this;
- Progress;
- Recent symbolic events;
- Privacy/model status;
- compact export/validation only when relevant.

## Default UI Must Hide

- Suggestion Trace Campaign;
- Gate 3B-Live;
- raw JSON;
- trace paths;
- validation logs;
- diagnostics internals;
- campaign bundle tools;
- local perception tuning internals.

Hidden developer tooling must live inside closed Advanced / Developer Tools.

## Product Copy Boundary

Allowed:

- `Detected Action`;
- `Waiting for movement`;
- `Possible phone moved`;
- `Camera suggestion - requires confirmation`;
- `Not this / Correct`.

Forbidden:

- autonomous vision claims;
- object detection proof;
- gesture recognition proof;
- production readiness;
- portfolio readiness;
- cinematic demo readiness.

## Layout Boundary

The main screen must prioritize:

- camera;
- current step;
- detected action;
- confirmation controls;
- progress.

Developer QA must not reserve large default screen space.

## Internal QA Boundary

Trace export, suggestion campaigns, reports, and validation remain available for QA only. They must not be the normal operator workflow.

