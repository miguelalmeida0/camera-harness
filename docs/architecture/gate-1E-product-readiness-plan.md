# Gate 1E Product Readiness Plan

Gate 1E is operator-grade local app hardening so the user can actually test the app and generate the physical trace.

## Purpose

Gate 1E exists to prevent the team from drifting back into docs and harness work while the app remains unusable. It turns the current user concern into an operational rule:

```text
camera-only is failure
```

The local app must let the user run the Focus Ritual path, record symbolic events, export a candidate physical trace, and run validation.

## Relationship To Gate 1D

Gate 1D proves source-level tryability.

Current Gate 1D source verdict:

```text
TRYABLE_WITH_MANUAL_CONFIRMATION
```

Gate 1E hardens that into product readiness. It asks whether the source-level path is clear enough and complete enough for the user to test in a real browser session.

## Relationship To Gate 1C

Gate 1C remains the physical trace validation gate.

Gate 1E may help produce:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

Only Gate 1C can accept that trace. Gate 1E cannot waive Gate 1C.

## What Gate 1E Approves

Gate 1E approves only:

- local usability;
- manual confirmation flow;
- trace export flow;
- validation instructions.

## What Gate 1E Does Not Approve

Gate 1E does not approve:

- HUD polish;
- cinematic effects;
- autonomous CV claims;
- portfolio demo;
- production claims;
- bypassing physical trace;
- bypassing Gate 1C;
- hiding manual confirmation;
- hiding uncertainty.

## Required App Behavior

The app must:

- start from `npm run physical:capture`;
- expose a known local URL;
- start and stop camera;
- show calibration UI;
- save calibration;
- start Focus Ritual;
- start and stop recording;
- show manual confirmation buttons for all Focus Ritual steps;
- update quest state from symbolic events;
- update event timeline;
- keep privacy/model status visible;
- export symbolic JSON or show a clear blocked reason;
- show validation commands;
- disclose manual confirmation in events and trace metadata;
- persist no raw media;
- make no LLM/VLM calls.

## Acceptance Criteria

Gate 1E is accepted at source level when:

- `npm run gate:1d` passes;
- `npm run gate:1e` passes with `NEEDS_USER_VERIFICATION`;
- Gate 1E docs exist;
- camera-only failure policy exists;
- user-facing try instructions exist;
- source includes calibration, ritual, recording, manual confirmation, HUD/timeline, export, and validation controls;
- export metadata discloses manual local confirmation;
- source scan finds no obvious raw-media export or model-call hooks;
- Gate 2 lock remains explicit.

Operational Gate 1E acceptance still requires user verification:

- app loads in the user's browser;
- user completes the flow;
- trace downloads or gives a clear blocked reason;
- validation commands return concrete output.

## Failure Criteria

Gate 1E fails if:

- camera preview is the only working feature;
- calibration is missing or unusable;
- quest controls are missing;
- manual confirmations are missing or hidden;
- quest state does not update;
- timeline does not update;
- recording does not work;
- export does not work and gives no clear reason;
- validation commands are not visible;
- raw media persists;
- model calls occur;
- manual confirmation is represented as autonomous vision;
- Gate 2 is implied as unlocked.
