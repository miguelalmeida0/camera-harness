# Gate 1C Package Boundaries

## Boundary Map

| Package or layer | May do | Must not do | Required evidence |
| --- | --- | --- | --- |
| `browser-local-capture` | Access physical camera frames transiently, create `LocalObservationFrame`, measure latency, collect operator confirmation. | Persist frames, upload frames, call models, emit quest completion. | `trace_origin`, latency records, no raw media counters. |
| Manual calibration | Store normalized zone geometry and symbolic object labels; enable `scene.calibrated`. | Store screenshots, raw frames, OCR, private notebook text. | Zone geometry, calibration ID, symbolic event evidence. |
| `live-perception-adapter` | Emit valid `StableEvent[]` candidates. | Emit quest/HUD/memory/model events, unsupported state-bearing events, completion claims. | Event schema validation and replay. |
| `live-trace-recorder` | Write symbolic replay fixtures with trace origin, privacy fields, and latency records. | Store raw media, base64, screenshots, audio, OCR, cloud-derived evidence. | Symbolic fixture and recursive privacy scan. |
| `quest-engine` | Pure reducer from previous state and stable event to next state. | Model calls, raw media access, direct memory write, hidden wall-clock state. | Replay deterministic transition log. |
| HUD | Render state and command stream only. | Mutate quest state, hide uncertainty, fake progress, call models. | Replayable HUD command stream. |
| `packages/evals` | Enforce provenance, privacy, model, memory, HUD, latency, recovery, and static validation. | Ignore missing physical trace, relax exact codes, waive physical provenance. | Gate 1C report. |

## Physical Trace Rule

The required physical fixture path is intentionally separate from browser-generated symbolic traces. Gate 1C must not treat `live_browser_focus_ritual_001.v0.json` as a substitute for `live_physical_focus_ritual_001.v0.json`.

## Static Validation Rule

Static TypeScript validation is package-boundary evidence. If unavailable, it requires a waiver and limits approval to minimal HUD polish only.
