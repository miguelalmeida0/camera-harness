# Gate 1D Execution Board

Gate 1D goal: make the local app ready for the user to try without approving polish, demo claims, or Gate 1C relaxation.

Status values:

- `NOT_STARTED`
- `IN_PROGRESS`
- `DONE`
- `BLOCKED`
- `NEEDS_USER_PHYSICAL_RUN`

## A. Must Work Before User Can Test

| Task | Owner | Current status | Source-level evidence | Exit condition |
| --- | --- | --- | --- | --- |
| Start Camera | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#startCamera` and `getUserMedia({ video: true, audio: false })` exist. | User confirms camera starts in local browser. |
| Stop Camera | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#stopCamera` stops tracks and clears preview. | User confirms camera stops cleanly. |
| Calibrate Zones | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#calibrateZones`, zone rectangle fields, and object assignment fields exist. | User confirms zone UI is visible and understandable. |
| Save Calibration | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#saveCalibration` emits calibration and initial object events. | User saves calibration and sees quest state `calibrated`. |
| Start Focus Ritual | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#startFocusRitual` gates on saved calibration. | User sees objective change to phone removal. |
| Start Recording | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#startRecording` gates on camera, calibration, and ritual start. | User sees recording status `on`. |
| Manual confirmation buttons | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | Buttons exist for phone, notebook, pen, writing, typing, uncertain, and reset. | User can click all required confirmations in order. |
| Quest state updates | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | Local reducer updates `questState` through ritual states. | User sees state reach `quest_complete`. |
| Event timeline updates | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#events` renders last symbolic events. | User sees events after each confirmation. |
| Stop Recording | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#stopRecording` exists and updates export readiness. | User can stop before export. |
| Export Physical Trace | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#exportTrace` builds and downloads symbolic fixture JSON. | User downloads `live_physical_focus_ritual_001.v0.json`. |
| Validation commands displayed | Multimodal Perception & Interface Researcher | `NEEDS_USER_PHYSICAL_RUN` | `#nextSteps` displays `npm run physical:validate` and `npm run gate:1c`. | User can copy commands without guessing. |

## B. Must Not Happen

| Constraint | Owner | Current status | Check |
| --- | --- | --- | --- |
| Raw media persistence | Harness, Evaluation, Memory & Safety Researcher | `IN_PROGRESS` | Source declares no raw persistence; exported trace must be scanned. |
| LLM/VLM calls | Harness, Evaluation, Memory & Safety Researcher | `IN_PROGRESS` | UI and metrics show `0`; trace and reports must confirm. |
| Fake automatic CV claims | Systems Research Architect | `IN_PROGRESS` | UI says manual local confirmation fallback; user must confirm no misleading copy. |
| Hidden manual confirmation | Systems Research Architect | `IN_PROGRESS` | Buttons and exported `trace_origin.manual_local_confirmation_used=true` are present. |
| Hidden uncertainty | Harness, Evaluation, Memory & Safety Researcher | `IN_PROGRESS` | UI has uncertainty status and `Mark Uncertain`; exported traces must not hide unresolved uncertainty. |
| Fake progress | Harness, Evaluation, Memory & Safety Researcher | `IN_PROGRESS` | Quest progress must follow symbolic events only. |
| HUD polish before Gate 1C | Systems Research Architect | `DONE` | Gate 2 and no-polish docs block polish and visual effects. |

## C. Validation Tasks

| Task | Owner | Current status | Command or evidence |
| --- | --- | --- | --- |
| Source audit | Systems Research Architect | `DONE` | Source contains controls, reducer flow, export, HUD state, and validation next steps. |
| App smoke test | Harness, Evaluation, Memory & Safety Researcher | `NEEDS_USER_PHYSICAL_RUN` | `npm run gate:1d` passes source checks; sandbox cannot bind localhost, so user/local browser run is still required. |
| Export JSON shape check | Harness, Evaluation, Memory & Safety Researcher | `NEEDS_USER_PHYSICAL_RUN` | Requires exported user trace. |
| Physical validator | Harness, Evaluation, Memory & Safety Researcher | `BLOCKED` | Currently `BLOCKED_MISSING_PHYSICAL_TRACE`. |
| Gate 1C | Harness, Evaluation, Memory & Safety Researcher | `BLOCKED` | Currently `BLOCKED_MISSING_PHYSICAL_TRACE`. |
| Typecheck | Harness, Evaluation, Memory & Safety Researcher | `DONE` | `npm run typecheck` passes. |

## D. Owners

| Owner | Responsibility |
| --- | --- |
| Multimodal Perception & Interface Researcher | Make the app usable: controls, calibration, manual confirmation, recording, export, and clear next steps. |
| Harness, Evaluation, Memory & Safety Researcher | Verify source, exported trace shape, validator output, Gate 1C result, privacy, model calls, and manual-disclosure honesty. |
| Systems Research Architect | Resolve contradictions, protect no-polish boundaries, keep Gate 2 locked, and define readiness for user testing. |

## E. Current Status

Source-level Gate 1D status:

```text
TRYABLE_WITH_MANUAL_CONFIRMATION
```

Evidence:

```sh
npm run gate:1d
```

Result:

```text
TRYABLE_WITH_MANUAL_CONFIRMATION Gate 1D source check
checks: 67/67
```

Operational Gate 1D status:

```text
NEEDS_USER_PHYSICAL_RUN
```

Reason: source-level controls exist, but localhost browser operation and physical export cannot be verified from the sandbox. The next decision requires a real local browser run by the user or an environment that can bind `127.0.0.1:4177`.
