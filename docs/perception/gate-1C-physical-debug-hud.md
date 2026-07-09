# Gate 1C Physical Debug HUD

## Required Fields

The physical debug HUD must show:

- current quest state
- physical capture status
- calibration status
- active zone
- last 10 symbolic events
- event confidence
- uncertainty state
- reset/recalibration state
- raw media persistence status: `false`
- cloud fallback status: `disabled`
- replay recording status
- browser latency p50/p95/max
- LLM calls: `0`
- VLM calls: `0`

## Implemented State Surface

`packages/perception/browser-local-capture/src/index.ts` exposes `BrowserDebugHudState` with:

- `quest_state`
- `physical_capture_status`
- `calibration_status`
- `active_zone`
- `last_10_symbolic_events`
- `event_confidence`
- `uncertain`
- `reset_required`
- `replay_recording_status`
- `browser_latency`
- `raw_media_persisted: false`
- `cloud_calls_enabled: false`
- `llm_calls: 0`
- `vlm_calls: 0`

## Forbidden HUD Behavior

The physical debug HUD must not:

- use cinematic polish
- fake progress
- hide uncertainty
- hide reset state
- hide low confidence
- imply cloud/VLM intelligence
- display raw frames in exported artifacts

## Gate 1C Status

HUD support is implemented for symbolic state, but physical HUD validation is blocked until `live_physical_focus_ritual_001.v0.json` is produced by an operator-confirmed webcam session.
