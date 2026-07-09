# Live Local Perception Adapter

## Purpose

Gate 1A connects controlled live webcam perception to the v0 symbolic event contract. The adapter converts local observation frames into replay-compatible events and emits only valid v0 perception events. It does not own quest state, HUD progress, memory writes, model routing, or cinematic rendering.

Contract sources:

- `docs/contracts/event-schema.v0.md`
- `docs/contracts/replay-fixture-schema.v0.md`
- `docs/architecture/gate-1A-schema-freeze.md`
- `docs/architecture/live-perception-adapter-boundary.md`

## State-Bearing Output

The live adapter may emit only these v0 event types:

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

The adapter must not emit `quest.step_started`, `quest.step_completed`, `hud.command_emitted`, `memory.write_requested`, or `agent.escalation_requested`. Those belong to downstream packages.

Every emitted event must use the v0 envelope:

```ts
type V0Event = {
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
  evidence: Array<{
    kind: "fixture_assertion" | "event_ref" | "transition_guard" | "policy_rule" | "human_correction" | "metric_log";
    ref: string;
  }>;
};
```

Producer restrictions from v0 still apply. In normal live mode:

- `scene.calibrated` may use `producer: "perception.local"` after manual confirmation.
- Stabilized hand, object, gesture, zone, confidence, uncertainty, and reset events should use `producer: "event_stabilizer"`.
- `producer: "human_correction"` is reserved for explicit user corrections.

## Local Observation Input

`LocalObservationFrame` is internal input. It is not a replay event and must not be written as a state-bearing fixture event.

```ts
type LocalObservationFrame = {
  schema: "darkquest.local_observation_frame.v0";
  session_id: string;
  timestamp_ms: number;
  frame_index: number;
  calibration_id: string;
  hands: Array<{
    hand_id: string;
    tracking_id: string;
    zone_alias?: string;
    zone_id?: string;
    confidence: number;
    handedness?: "left" | "right" | "unknown";
    gesture_hint?: "writing_motion" | "typing_motion" | "reach" | "none";
  }>;
  objects: Array<{
    object_id: "obj_phone" | "obj_notebook" | "obj_pen" | "obj_keyboard" | string;
    object_type: "phone" | "notebook" | "pen" | "keyboard" | "unknown";
    tracking_id: string;
    zone_alias?: string;
    zone_id?: string;
    confidence: number;
    motion_state?: "still" | "moving" | "lost";
  }>;
  zones: Array<{
    zone_alias: string;
    zone_id: string;
    occupancy: "empty" | "occupied" | "uncertain";
    confidence: number;
    occupants: string[];
  }>;
  scene: {
    scene_confidence: number;
    uncertainty: number;
    occlusion_score?: number;
    camera_bump_score?: number;
    fingerprint_distance?: number;
  };
  metrics: {
    camera_to_observation_ms: number;
    worker_latency_ms: number;
    dropped_frame_count: number;
  };
};
```

Local observations may contain numeric geometry in memory for hit testing, but the adapter output must not include raw image bytes, raw frame paths, base64 images, video paths, screenshots, audio, OCR, notebook text, or cloud-derived evidence.

## Zone Normalization

Manual calibration uses required aliases. State-bearing v0 events use normalized zone IDs:

| Calibration alias | v0 event zone |
| --- | --- |
| `phone_zone` | `zone_focus` |
| `notebook_zone` | `zone_notebook` |
| `pen_zone` | `zone_pen_tool` |
| `keyboard_zone` | `zone_keyboard` |
| `neutral_zone` | `zone_away` for quest-object movement away from focus; otherwise no state progress. |
| `off_desk_zone` | `zone_away` |

The adapter must normalize all `zone_id`, `from_zone_id`, and `to_zone_id` fields before v0 validation. Unrecognized zones fail closed and may produce `confidence.changed` or `scene.uncertain`, but not object or gesture progress.

## Event Mapping

| Input condition | v0 event | Required payload |
| --- | --- | --- |
| Manual calibration confirmed. | `scene.calibrated` | `session_id`, `zone_ids`, `calibration_id`, `scene_confidence` |
| Hand enters a normalized zone after streak threshold. | `hand.entered_zone` | `hand_id`, `zone_id`, `tracking_id` |
| Hand leaves a normalized zone after streak threshold. | `hand.left_zone` | `hand_id`, `zone_id`, `tracking_id`, `dwell_ms` |
| Symbolic object changes normalized zones with stable motion. | `object.moved` | `object_id`, `object_type`, `from_zone_id`, `to_zone_id`, `duration_ms` |
| Symbolic object rests in a normalized zone after dwell. | `object.placed` | `object_id`, `object_type`, `zone_id`, `dwell_ms` |
| Local gesture rule stabilizes. | `gesture.detected` | `gesture_id`, `gesture_type`, `zone_id`, `actor_ref`, `evidence_window_ms` |
| Zone becomes active due to accepted local event. | `zone.activated` | `zone_id`, `activation_reason`, `trigger_event_id` |
| Confidence crosses a configured threshold. | `confidence.changed` | `target_ref`, `previous_confidence`, `current_confidence`, `reason_code` |
| Occlusion, zone drift, camera bump, ambiguity, or stale stream blocks state. | `scene.uncertain` | `uncertainty_kind`, `affected_refs`, `resolver_hint`, `escalation_recommended` |
| User reset, camera bump reset, session end, or unrecoverable drift. | `scene.reset` | `reset_reason`, `reset_scope`, `previous_state_id` |

Quest-relevant thresholds:

- `scene.calibrated`: `scene_confidence >= 0.80`
- hand zone events: `confidence >= 0.85`
- object movement and placement for quest transitions: `confidence >= 0.86`
- writing and typing gestures: `confidence >= 0.82` and `evidence_window_ms >= 900`

Below-threshold observations should hold state or emit uncertainty. They must not be coerced into progress events.

## V0 Normalization

The current local stabilizer package uses internal names such as `timestampMs` and local evidence references. The live adapter owns the final v0 conversion:

1. Convert `timestampMs` to `timestamp_ms`.
2. Add the v0 `producer`.
3. Keep only v0 allowed event types.
4. Normalize zone aliases.
5. Keep only v0 required payload fields plus deterministic optional fields.
6. Convert local evidence to v0-safe evidence references.
7. Validate required payload fields for the specific event type.
8. Reject any event with forbidden keys or forbidden evidence.

Allowed live evidence references:

```json
[
  {
    "kind": "metric_log",
    "ref": "trace_live_focus_001.observation_window.4100_4780"
  },
  {
    "kind": "event_ref",
    "ref": "evt_live_phone_moved_away_001"
  },
  {
    "kind": "policy_rule",
    "ref": "docs/contracts/event-schema.v0.md"
  }
]
```

Forbidden evidence or payload content:

- raw image bytes
- raw frame/video/audio paths
- screenshots
- base64 images
- notebook OCR or private notebook text
- cloud model outputs
- hidden model reasoning
- broad catch-all fields such as `data`, `stuff`, `info`, `raw`, or `blob`

## Failure Behavior

| Failure | Required behavior |
| --- | --- |
| Invalid observation frame | Drop state-bearing output; write diagnostic outside replay input. |
| Unknown zone alias | Emit uncertainty or confidence change; do not emit progress. |
| Event fails v0 validation | Block the event before quest, HUD, memory, model router, or replay input. |
| Raw media field detected | Block write, mark privacy failure, keep raw media persistence status `false`. |
| Cloud fallback requested | Reject in Gate 1A; `cloud_fallback_enabled` remains `false`. |
| Camera bump | Emit uncertainty, pause zone-specific events, require review or reset. |

## Package API Sketch

`packages/perception/live-perception-adapter` should expose a small wrapper around local observation frames and the event stabilizer:

```ts
type LivePerceptionAdapter = {
  ingestObservation(frame: LocalObservationFrame): V0Event[];
  confirmCalibration(profile: ManualCalibrationProfile): V0Event[];
  reset(reason: "user_reset" | "camera_bump" | "session_end" | "replay_restart"): V0Event[];
  getDiagnostics(): {
    raw_media_persisted: false;
    cloud_fallback_enabled: false;
    last_validation_error?: string;
  };
};
```

The adapter implementation should validate output before returning events. Consumers should treat returned events as the only state-bearing live perception stream.

## Acceptance Checks

- Every returned event validates against `docs/contracts/event-schema.v0.md`.
- No returned event type falls outside the Gate 1A perception list.
- `timestamp_ms` is non-negative and monotonic within a live trace.
- Evidence kinds are only v0 allowed kinds.
- No payload or evidence contains raw media, base64, notebook text, audio, or cloud-derived content.
- `llm_calls`, `vlm_calls`, and `estimated_cost_usd` remain zero in Gate 1A live traces.
- A live trace exported by `darkquest-trace export --latest fixtures/replay/live/live_focus_ritual_001.v0.json` can be shaped as `darkquest.replay_fixture.v0`.
