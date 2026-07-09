# Gate 1B Browser Debug HUD

## Goal

The Gate 1B debug HUD exposes state, confidence, uncertainty, reset, privacy, and model-call posture. It is not cinematic HUD polish and does not imply demo approval.

## Required State

The browser-local capture layer tracks:

- `capture_status`: `idle`, `camera_ready`, `recording`, `stopped`, or `error`
- `last_frame_id`
- `last_event_types`
- `uncertain`
- `reset_required`
- `confidence`
- `raw_media_persisted: false`
- `cloud_calls_enabled: false`
- `llm_calls: 0`
- `vlm_calls: 0`

## Recovery Behavior

Occlusion:

- `LocalObservationFrame.scene.uncertain = true`
- adapter emits `scene.uncertain`
- replay observes `hud_show_uncertain_state`
- quest progress is held until a recovery signal such as `confidence.changed`

Camera bump/reset:

- `LocalObservationFrame.scene.reset_detected = true`
- adapter emits `scene.reset`
- replay observes `hud_show_reset_required`
- calibration is invalidated until a later `scene.calibrated`
- stale zone truth cannot progress the quest

## Current Implementation

- Package: `packages/perception/browser-local-capture/`
- Prototype: `packages/perception/browser-local-capture/prototype/index.html`
- Boundary test: `packages/perception/browser-local-capture/test/browser-local-capture.test.ts`

The HUD state is driven only by symbolic frames and stable events. It does not read or store raw frame data.
