# Gate 1B Browser Frame Privacy Notes

## Privacy Claim

Gate 1B persists symbolic traces only. Browser camera frames may exist transiently in the browser camera/video/canvas memory while local observation extraction runs, but they must not be serialized, uploaded, cached, or written into replay artifacts.

## Forbidden Persistence

The browser-local path must not store:

- raw webcam frames
- screenshots
- base64 images
- video clips
- raw audio
- notebook text
- OCR output
- cloud-derived local evidence

The trace recorder must export only:

- `LocalObservationFrame`-derived `StableEvent` objects
- replay-safe evidence refs with `contains_raw_media: false`
- browser latency records
- privacy booleans
- zero model-call metrics

## Current Evidence

- `fixtures/replay/live/live_browser_focus_ritual_001.v0.json` has `trace_origin.raw_media_persisted: false`.
- Positive Gate 1B fixtures replay with `0` LLM calls and `0` VLM calls.
- `runs/gate-1b-latest.json` reports raw media persistence count `0`.
- Adversarial raw-media fixtures fail with exact expected codes.

## Browser Prototype Rules

`packages/perception/browser-local-capture/prototype/index.html` requests camera permission with `{ video: true, audio: false }`.

The prototype does not call `toDataURL`, `canvas.toBlob`, upload APIs, localStorage, sessionStorage, IndexedDB, Cache Storage, or file writes. Its durable output is symbolic observation JSON and latency records only.

## Disclosure

A physical browser camera session was not executed in this environment. The implemented boundary and generated browser-origin trace prove the symbolic contract; hardware validation should confirm the same privacy invariants in the actual browser runtime.
