# Gate 1A Package Boundaries

Gate 1A protects the replay-tested contract while live local perception is connected. Packages may be incomplete, but their boundaries are not optional.

## Boundary Map

| Package | Responsibility | Allowed inputs | Allowed outputs | Forbidden behavior | Owner agent | Test strategy |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/perception/live-perception-adapter` | Convert local observation frames and calibration profiles into v0 symbolic perception events. | `LocalObservationFrame`, manual calibration profile, reset/correction actions. | Valid v0 perception events with symbolic evidence: `scene.calibrated`, `hand.entered_zone`, `hand.left_zone`, `object.moved`, `object.placed`, `gesture.detected`, `zone.activated`, `confidence.changed`, `scene.uncertain`, `scene.reset`. | Store raw media; call LLM/VLM; decide quest completion; emit quest/HUD/memory/model events; emit v1 envelope fields; hide ambiguity. | PARALLAX | Adapter unit tests, schema validation, privacy scanner, live trace replay. |
| `packages/perception/event-stabilizer` | Debounce noisy observations, smooth local signals, detect dwell/motion/gesture stability, and emit stable event candidates. | Symbolic local observations, zones, scene metrics, previous stabilizer state. | Stable symbolic events or event candidates with confidence and evidence refs. | Create unsupported semantic claims; call LLM/VLM; persist raw media; write quest state; write memory; emit downstream HUD/model events. | PARALLAX | Deterministic frame fixtures, false-positive fixtures, latency tests, reset/uncertainty tests. |
| `packages/replay/live-trace-recorder` | Record symbolic live traces and export replay-compatible fixtures. | Validated v0 events, quest transition records, HUD command records, memory/model/cost/latency records, privacy assertions. | `darkquest.replay_fixture.v0` JSON under `fixtures/replay/live/`; symbolic run metadata. | Write images, video, audio, screenshots, base64, OCR, notebook text, raw media paths, hidden model reasoning; drop privacy/cost/model fields. | GAUNTLET | Export tests, recursive privacy scan, replay command, deterministic export hash. |
| `packages/quest-engine` | Reduce quest state deterministically from stable v0 events. | Previous quest state and one valid stable event at a time. | Next quest state; deterministic transition records; HUD/memory/route candidates as explicit returned data if implemented. | Call models; inspect raw media; access camera/DOM/network/storage; write memory directly; mutate hidden global state; complete out of order; accept broad event family matches as evidence. | AXIOM | Pure reducer tests, transition fixtures, out-of-order fixtures, no side-effect tests. |
| `packages/hud` | Render current state, accepted events, confidence, and uncertainty from HUD commands/state. | Quest state, HUD command stream, accepted evidence IDs, symbolic confidence/uncertainty. | Visual rendering and replayable HUD command records/events. | Mutate quest state; fake progress; hide uncertainty; infer completion directly from camera frames; call models for hot-path state. | PARALLAX | HUD command replay, uncertainty visibility fixtures, screenshot/browser QA after Gate 1A. |
| `packages/evals` | Validate schemas, run replay fixtures, detect privacy/model/memory violations, and produce deterministic reports. | Replay fixtures, manifests, expected matchers, symbolic reports. | `darkquest.replay_report.v0`, Gate suite reports, failure codes. | Skip missing required live traces silently; relax matchers; ignore raw-media/model/memory failures; depend on live camera for replay. | GAUNTLET | Happy path, adversarial suite, live trace acceptance, failure-code tests, repeat determinism. |

## Dependency Direction

```text
live-perception-adapter -> event-stabilizer -> v0 events
v0 events -> live-trace-recorder -> replay fixture
v0 stable events -> quest-engine -> HUD command records
replay fixture -> packages/evals -> replay report
```

The live adapter and event stabilizer must not import or call quest completion logic. The quest engine must not import or call camera, perception workers, trace recorders, memory stores, model routers, or HUD renderers.

## State-Bearing Output Rule

Only v0 symbolic events and deterministic quest/HUD records may become replay input or replay output. Experimental observations, debug metrics, local geometry, and perception diagnostics may exist only on ignored diagnostic channels and must not complete quest steps.

## Package Boundary Failure Examples

| Failure | Blocking reason |
| --- | --- |
| Live adapter emits `quest.step_completed`. | Perception has decided quest truth. |
| Event stabilizer labels a notebook as "opened for planning" without object evidence. | Unsupported semantic claim. |
| Trace recorder writes `frame_001.png`. | Raw visual artifact persisted. |
| Quest reducer calls `Date.now()`. | Replay nondeterminism. |
| HUD marks a step complete from a camera observation. | Fake progress outside quest state. |
| Evals ignores missing `fixtures/replay/live/live_focus_ritual_001.v0.json`. | Gate 1A silently bypassed. |
