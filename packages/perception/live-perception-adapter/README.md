# @darkquest/live-perception-adapter

Gate 1A package spec for converting local webcam observation frames into replay-compatible v0 perception events.

This package is the boundary between camera/browser perception and the rest of DarkQuest. Its only state-bearing output is validated v0 symbolic events. It must not persist raw media or call cloud models.

## Inputs

- manual calibration profiles from `docs/perception/manual-calibration-flow.md`
- local observation frames from browser/local perception workers
- stabilized candidate events from `@darkquest/event-stabilizer`, if present
- explicit user reset or correction actions

## Outputs

Only these v0 event types may leave the package:

- `scene.calibrated`
- `hand.entered_zone`
- `hand.left_zone`
- `object.moved`
- `object.placed`
- `gesture.detected`
- `zone.activated`
- `confidence.changed`
- `scene.uncertain`
- `scene.reset`

Each output event must include:

- `id`
- `type`
- `timestamp_ms`
- `producer`
- `confidence`
- `payload`
- `evidence`

## Responsibilities

1. Normalize calibration aliases to v0 zone IDs.
2. Convert internal `timestampMs` fields to v0 `timestamp_ms`.
3. Add the correct v0 producer.
4. Keep only v0 allowed event types.
5. Validate required payload fields.
6. Convert local observation evidence to v0-safe evidence references.
7. Drop or quarantine experimental observations outside the state-bearing stream.
8. Expose diagnostics proving `raw_media_persisted=false` and `cloud_fallback_enabled=false`.

## Privacy Blocklist

Reject output that contains any of:

- raw frame bytes
- raw video paths
- raw audio paths
- screenshots
- base64 images
- OCR or private notebook text
- cloud-derived evidence
- hidden model reasoning

## Zone Alias Map

| Calibration alias | Emitted v0 zone |
| --- | --- |
| `phone_zone` | `zone_focus` |
| `notebook_zone` | `zone_notebook` |
| `pen_zone` | `zone_pen_tool` |
| `keyboard_zone` | `zone_keyboard` |
| `neutral_zone` | `zone_away` for quest-object movement away from focus only |
| `off_desk_zone` | `zone_away` |

## API Shape

```ts
export type LivePerceptionAdapter = {
  ingestObservation(frame: LocalObservationFrame): V0Event[];
  confirmCalibration(profile: ManualCalibrationProfile): V0Event[];
  reset(reason: "user_reset" | "camera_bump" | "session_end" | "replay_restart"): V0Event[];
  getDiagnostics(): {
    raw_media_persisted: false;
    raw_audio_persisted: false;
    raw_frame_persisted: false;
    notebook_text_persisted: false;
    cloud_fallback_enabled: false;
    llm_calls: 0;
    vlm_calls: 0;
    estimated_cost_usd: 0;
    last_validation_error?: string;
  };
};
```

## Acceptance Gate

- All emitted events validate against `docs/contracts/event-schema.v0.md`.
- No event outside the Gate 1A perception allowlist is emitted.
- No raw media, audio, notebook text, base64 image, or cloud output appears in payloads or evidence.
- Invalid observations fail closed before quest state, HUD progress, memory, model routing, or replay recording.
- A trace recorded from this package can be exported by `@darkquest/live-trace-recorder` as `darkquest.replay_fixture.v0`.
