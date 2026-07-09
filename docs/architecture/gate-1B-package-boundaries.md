# Gate 1B Package Boundaries

Gate 1B adds the real browser-local capture path while preserving the Gate 1A symbolic replay boundary.

## Browser-Specific Boundary Map

| Boundary | Responsibility | Allowed inputs | Allowed outputs | Forbidden behavior | Owner agent | Test strategy |
| --- | --- | --- | --- | --- | --- | --- |
| Browser capture layer | Request camera permission and read frames transiently for local processing. | Browser `MediaStream`, video/canvas memory, calibration controls. | Symbolic frame-local measurements and `LocalObservationFrame` candidates. | Persist frames; call models; upload frames; write replay fixtures; emit quest transitions; store frames in browser storage. | PARALLAX | Browser QA with synthetic media stream, privacy storage probes, latency instrumentation. |
| Manual calibration layer | Map visible desk zones into normalized symbolic zone rectangles. | Transient camera preview, user-drawn zones, fixed object labels. | Normalized zone rectangles, symbolic zone IDs, `scene.calibrated` enablement. | Store calibration screenshot; store raw frame; accept free-text private labels; call models; decide quest completion. | PARALLAX | Calibration fixture tests, camera bump tests, no-screenshot storage checks. |
| `packages/perception/live-perception-adapter` | Convert browser `LocalObservationFrame` into validated v0 symbolic events. | Local observations, calibration profile, reset/correction actions. | Valid `StableEvent[]` with symbolic evidence. | Emit quest/HUD/memory/model events; claim completion; persist media; call LLM/VLM; hide ambiguity. | PARALLAX | Adapter tests, event-schema validation, privacy scan, browser trace replay. |
| `packages/perception/event-stabilizer` | Smooth noisy observations and detect stable dwell/motion/uncertainty. | Symbolic observations and local metrics. | Stable v0 event candidates and confidence/uncertainty events. | Create unsupported semantic claims; persist frames; call LLM/VLM; mutate quest state. | PARALLAX | Deterministic observation sequences, false-positive tests, latency tests. |
| `packages/replay/live-trace-recorder` | Write symbolic browser-origin replay fixtures. | Validated events, trace origin metadata, latency records, privacy/cost counters. | `darkquest.replay_fixture.v0` with top-level `trace_origin` and `metrics.browser_latency`. | Write images/video/audio/base64; omit trace origin; omit latency for browser trace; drop privacy fields; call models. | GAUNTLET | Export tests, origin validation, latency validation, recursive privacy scan. |
| `packages/quest-engine` | Pure reducer from stable event to next quest state. | Previous state and one valid stable event. | Next state and explicit deterministic outputs. | Inspect frames; call models; write memory; read browser storage; use wall-clock state; mutate hidden globals. | AXIOM | Purity tests, replay fixtures, side-effect probes. |
| `packages/hud` | Render state, confidence, uncertainty, and recovery status. | Quest state, HUD command stream, accepted evidence IDs, privacy/model status. | Visual UI and replayable HUD records. | Mutate quest state; fake progress; hide uncertainty; show raw camera frames in artifacts; imply cloud intelligence. | PARALLAX | HUD command replay, uncertainty visibility tests, browser screenshots after Gate 1B only. |
| `packages/evals` | Validate Gate 1B fixtures and reports. | Replay fixtures, Gate 1B manifest, expected codes, origin/latency metadata. | Deterministic Gate 1B report. | Skip required browser trace; ignore missing trace origin; ignore missing latency; relax zero-model rule. | GAUNTLET | Gate 1B suite, exact failure-code tests, repeat determinism. |

## Trace Origin Rule

Browser-generated fixtures must include browser trace origin metadata at top-level `trace_origin`. Hand-authored fixtures must not claim `source: "browser.local_camera"`.

## Latency Rule

Browser-generated fixtures must include compact `metrics.browser_latency` using `docs/contracts/browser-latency-record.v0.md`. They may also include detailed `metrics.browser_latency_records` or `metrics.browser_latency_record` for diagnostics.

## Calibration Rule

Manual calibration may store:

- normalized zone rectangles;
- symbolic zone IDs;
- fixed symbolic object IDs;
- calibration ID and timestamp.

Manual calibration must not store:

- screenshot;
- raw frame;
- raw video;
- OCR;
- private notebook text;
- cloud evidence.

## Boundary Failure Examples

| Failure | Blocking reason |
| --- | --- |
| Browser capture writes `frame.png`. | Raw media persistence. |
| Calibration stores a screenshot. | Raw visual artifact leakage. |
| Browser trace omits top-level `trace_origin`. | Cannot prove browser origin. |
| Browser trace omits latency record. | Cannot validate local path performance. |
| Adapter emits `quest.step_completed`. | Perception owns quest truth. |
| HUD marks completion from `LocalObservationFrame`. | HUD bypasses reducer. |
| Recovery calls VLM for occlusion. | Gate 1B zero-model-call violation. |
