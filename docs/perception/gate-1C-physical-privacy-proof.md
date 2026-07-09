# Gate 1C Physical Privacy Proof

## Frame Lifetime

Physical browser frames exist only inside the active browser camera/video processing context. They are used to support local manual/symbolic observation capture and are discarded after the local browser tick.

## Persistence Rules

Physical frames are not:

- persisted to disk
- included in replay fixtures
- stored as screenshots
- stored as base64 media
- stored as audio
- stored as OCR or notebook text
- sent to a backend
- sent to an LLM
- sent to a VLM

## Evidence IDs

Evidence IDs are symbolic references such as `ev_scene_calibrated` or browser-local event IDs. They must not contain file paths, media URIs, base64 payloads, OCR text, or raw frame identifiers.

## Trace Export

The physical trace export path accepts symbolic `LocalObservationFrame` data and emits replay-safe `StableEvent` entries. The replay fixture must include:

- `privacy.contains_raw_video: false`
- `privacy.contains_audio: false`
- `trace_origin.raw_media_persisted: false`
- `trace_origin.cloud_calls_enabled: false`
- `expected.model_calls: []`
- `expected.memory_writes: []` unless policy-valid
- browser latency records

## Current Count

Physical raw media persistence count is not measured yet because the physical trace is missing.

Gate 1B baseline raw media persistence count: `0`.

Gate 1C remains blocked until the physical fixture exists and replay privacy checks pass.
