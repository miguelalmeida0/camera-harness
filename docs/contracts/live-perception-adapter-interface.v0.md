# Live Perception Adapter Interface v0

## Purpose

This interface is the implementation-ready Gate 1A boundary between local webcam perception and the replay-tested DarkQuest event stream. It is local, symbolic, and zero-model-call.

The adapter consumes `LocalObservationFrame` objects and emits only valid `event-schema.v0.md` symbolic perception events.

## Types

```ts
type EvidenceRef = {
  id: string;
  kind: "observation_window" | "zone_metric" | "stabilizer_metric" | "calibration_profile" | "event_ref";
  description: string;
  contains_raw_media: false;
};

type HandObservation = {
  id: string;
  zone_id: string;
  present: boolean;
  confidence: number;
  gesture_hint?: "writing_motion" | "typing_motion" | "reach" | "none" | "unknown";
};

type ObjectObservation = {
  object_id: string;
  zone_id: string;
  present: boolean;
  confidence: number;
};

type ZoneObservation = {
  zone_id: string;
  active: boolean;
  confidence: number;
};

type SceneObservation = {
  calibrated: boolean;
  uncertain: boolean;
  reset_detected: boolean;
  confidence: number;
  reason?: string;
};

type LocalObservationFrame = {
  frameId: string;
  timestampMs: number;
  source: "webcam.local";
  hands: HandObservation[];
  objects: ObjectObservation[];
  zones: ZoneObservation[];
  scene: SceneObservation;
};

type StableEvent = {
  id: string;
  type:
    | "scene.calibrated"
    | "hand.entered_zone"
    | "hand.left_zone"
    | "object.moved"
    | "object.placed"
    | "gesture.detected"
    | "zone.activated"
    | "confidence.changed"
    | "scene.uncertain"
    | "scene.reset";
  timestamp_ms: number;
  producer: "perception.local" | "event_stabilizer" | "human_correction";
  confidence: number;
  payload: Record<string, unknown>;
  evidence: EvidenceRef[];
};
```

## Allowed Event Types

The adapter may emit only:

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

The adapter must not emit:

- `quest.step_started`
- `quest.step_completed`
- `hud.command_emitted`
- `memory.write_requested`
- `agent.escalation_requested`

## Evidence Rules

Evidence references must be symbolic and replay-safe:

```json
{
  "id": "ev_live_phone_window_001",
  "kind": "observation_window",
  "description": "Symbolic object-zone observations from 1000ms to 1640ms.",
  "contains_raw_media": false
}
```

When converted to `event-schema.v0.md`, evidence may be normalized into the v0 shape:

```json
{
  "kind": "metric_log",
  "ref": "ev_live_phone_window_001"
}
```

The raw-media assertion must still be enforced by the live adapter and trace recorder before export.

## Forbidden Event Content

Forbidden anywhere in adapter output:

- raw frame bytes;
- screenshots;
- base64 media;
- raw audio;
- visible notebook text;
- raw video, frame, audio, or image file paths;
- cloud-derived evidence marked as local;
- hidden model reasoning;
- state-bearing experimental events.

## Adapter API

```ts
type LivePerceptionAdapter = {
  ingestObservation(frame: LocalObservationFrame): StableEvent[];
  reset(reason: "user_reset" | "camera_bump" | "session_end" | "replay_restart"): StableEvent[];
  getDiagnostics(): {
    raw_media_persisted: false;
    raw_audio_persisted: false;
    raw_frame_persisted: false;
    screenshot_persisted: false;
    notebook_text_persisted: false;
    cloud_fallback_enabled: false;
    llm_calls: 0;
    vlm_calls: 0;
    estimated_cost_usd: 0;
    last_validation_error?: string;
  };
};
```

## Validation Rules

Before returning events, the adapter must verify:

- timestamps are non-negative and monotonic within the session;
- confidence values are between `0.0` and `1.0`;
- zones are normalized to the Gate 1A vocabulary;
- producer is allowed;
- payload has v0 required fields;
- evidence has `contains_raw_media: false`;
- no forbidden content appears;
- ambiguous observations emit uncertainty or hold state rather than progress.

## Failure Behavior

Invalid observations fail closed. The adapter may write symbolic diagnostics outside the replay input stream, but it must not coerce invalid observations into quest progress.
