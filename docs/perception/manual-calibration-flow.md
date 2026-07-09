# Manual Calibration Flow

## Purpose

Gate 1A uses manual calibration so live webcam perception can resolve local observations into symbolic desk zones without storing raw media or calling cloud models. Manual mode is rectangle-only for this gate: the user defines required zones on a temporary frozen camera view, and the saved profile stores normalized geometry plus symbolic object IDs.

The temporary camera view is display-only. It must not be written to disk, embedded in a trace, converted to base64, sent to a cloud service, or used for OCR of notebook content.

## User Flow

1. Ask for camera permission and show the live desk view.
2. Freeze the current view in memory for calibration. The frozen view is a UI surface only and is discarded when calibration completes or is canceled.
3. Ask the user to draw six rectangles: `phone_zone`, `notebook_zone`, `pen_zone`, `keyboard_zone`, `neutral_zone`, and `off_desk_zone`.
4. Let the user assign symbolic object IDs from a fixed set: `obj_phone`, `obj_notebook`, `obj_pen`, and `obj_keyboard`. Free-text object labels are not accepted in Gate 1A.
5. Validate geometry, aliases, object IDs, overlap, and confidence thresholds before enabling Start.
6. On confirmation, emit a v0 `scene.calibrated` event with normalized state-bearing zone IDs and replay-safe evidence.
7. Start local perception only after calibration passes. If validation fails, keep the quest in manual or setup state.

## Required Zones

The calibration profile stores the user-facing required zone IDs below. State-bearing v0 events emitted by the live adapter must normalize these aliases before reaching the quest engine or replay trace.

| Calibration zone | Required purpose | v0 state zone |
| --- | --- | --- |
| `phone_zone` | Initial phone/focus area. Phone removal starts from here. | `zone_focus` |
| `notebook_zone` | Notebook and writing surface. | `zone_notebook` |
| `pen_zone` | Pen or stylus resting area before pickup. | `zone_pen_tool` |
| `keyboard_zone` | Keyboard or laptop typing area. | `zone_keyboard` |
| `neutral_zone` | Desk area that should not complete quest steps by itself. | `zone_away` only when a quest object leaves `zone_focus`; otherwise diagnostic only. |
| `off_desk_zone` | Area outside the useful desk/focus surface. | `zone_away` |

The `scene.calibrated` event should report `zone_ids` using the v0 state zones that are active for the quest:

```json
["zone_focus", "zone_notebook", "zone_pen_tool", "zone_keyboard", "zone_away"]
```

## Geometry Format

Rectangles use normalized coordinates relative to the current camera frame. Values are numbers from `0.0` to `1.0`; no pixel crops or image references are stored.

The minimal Gate 1A geometry artifact uses this replay-safe shape:

```json
{
  "schema": "darkquest.zone_geometry.v0",
  "zones": [
    {
      "zone_id": "phone_zone",
      "shape": "rect",
      "x": 0.05,
      "y": 0.10,
      "width": 0.20,
      "height": 0.25
    }
  ],
  "objects": [
    {
      "object_id": "phone",
      "zone_id": "phone_zone",
      "label_source": "manual"
    }
  ],
  "privacy": {
    "stores_raw_image": false,
    "stores_raw_video": false,
    "stores_audio": false
  }
}
```

Only geometry, zone IDs, symbolic object IDs, and privacy booleans are stored. The adapter normalizes these user-facing zone IDs into v0 state zones before emitting events.

```ts
type CalibrationZoneId =
  | "phone_zone"
  | "notebook_zone"
  | "pen_zone"
  | "keyboard_zone"
  | "neutral_zone"
  | "off_desk_zone";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CalibrationZone = {
  id: CalibrationZoneId;
  v0_zone_id: "zone_focus" | "zone_notebook" | "zone_pen_tool" | "zone_keyboard" | "zone_away";
  label: string;
  rect: Rect;
  expected_object_ids: string[];
  source: "manual";
  confidence: number;
  enabled: boolean;
};

type ManualCalibrationProfile = {
  schema: "darkquest.manual_calibration.v0";
  calibration_id: string;
  session_id: string;
  frame_size: {
    width: number;
    height: number;
  };
  created_at_ms: number;
  updated_at_ms: number;
  zones: CalibrationZone[];
  privacy: {
    contains_raw_image: false;
    contains_raw_video: false;
    contains_audio: false;
    contains_notebook_text: false;
  };
};
```

Example:

```json
{
  "schema": "darkquest.manual_calibration.v0",
  "calibration_id": "cal_live_focus_001",
  "session_id": "ses_live_focus_001",
  "frame_size": { "width": 1280, "height": 720 },
  "created_at_ms": 0,
  "updated_at_ms": 0,
  "zones": [
    {
      "id": "phone_zone",
      "v0_zone_id": "zone_focus",
      "label": "Phone",
      "rect": { "x": 0.05, "y": 0.58, "width": 0.18, "height": 0.28 },
      "expected_object_ids": ["obj_phone"],
      "source": "manual",
      "confidence": 1,
      "enabled": true
    },
    {
      "id": "notebook_zone",
      "v0_zone_id": "zone_notebook",
      "label": "Notebook",
      "rect": { "x": 0.28, "y": 0.42, "width": 0.32, "height": 0.42 },
      "expected_object_ids": ["obj_notebook"],
      "source": "manual",
      "confidence": 1,
      "enabled": true
    }
  ],
  "privacy": {
    "contains_raw_image": false,
    "contains_raw_video": false,
    "contains_audio": false,
    "contains_notebook_text": false
  }
}
```

## Validation Rules

- All six required calibration zones must be present, enabled, and manually sourced.
- `rect.x`, `rect.y`, `rect.width`, and `rect.height` must be finite normalized numbers.
- Rectangle width and height must each be at least `0.03`; area must be at least `0.0025` of the frame.
- Rectangle bounds must stay inside the normalized frame: `x >= 0`, `y >= 0`, `x + width <= 1`, and `y + height <= 1`.
- `phone_zone`, `notebook_zone`, `pen_zone`, and `keyboard_zone` may touch but must not overlap each other by more than `5%` of the smaller rectangle area.
- `neutral_zone` and `off_desk_zone` may overlap only as explicit fallbacks; if both match an observation, `off_desk_zone` wins outside the desk surface and `neutral_zone` wins inside the desk surface.
- `expected_object_ids` must use only `obj_phone`, `obj_notebook`, `obj_pen`, and `obj_keyboard`.
- Calibration is valid for quest start only when `scene_confidence >= 0.80`.
- Calibration data must not include `image`, `frame`, `screenshot`, `base64`, `audio`, `ocr`, `notebook_text`, or file path fields.

## Emitted Calibration Event

On successful confirmation, emit a v0 event:

```json
{
  "id": "evt_live_scene_calibrated_001",
  "type": "scene.calibrated",
  "timestamp_ms": 0,
  "producer": "perception.local",
  "confidence": 0.95,
  "payload": {
    "session_id": "ses_live_focus_001",
    "zone_ids": ["zone_focus", "zone_notebook", "zone_pen_tool", "zone_keyboard", "zone_away"],
    "calibration_id": "cal_live_focus_001",
    "scene_confidence": 0.95
  },
  "evidence": [
    {
      "kind": "human_correction",
      "ref": "cal_live_focus_001.confirmed_manual_rectangles"
    },
    {
      "kind": "policy_rule",
      "ref": "docs/perception/manual-calibration-flow.md"
    }
  ]
}
```

## Reset Behavior

User reset has two scopes:

- `reset_scope: "calibration"` clears the active calibration and returns to setup. It emits `scene.reset` with `reset_reason: "user_reset"`.
- `reset_scope: "session"` ends the live session and closes the recorder after flushing symbolic events. It emits `scene.reset` with `reset_reason: "session_end"`.

Reset does not delete prior symbolic trace files. It also does not persist camera frames. A new calibration confirmation must emit a new `scene.calibrated` event with a new `calibration_id` or an explicit reused profile ID.

## Camera Bump Handling

The adapter should compare local scene metrics against the confirmed calibration baseline: luma histogram distance, edge density, anchor drift near rectangle corners, and sudden global motion.

When a possible bump is detected:

1. Emit `confidence.changed` if scene or zone confidence crosses a configured threshold.
2. Emit `scene.uncertain` with `uncertainty_kind: "camera_bump"` after sustained drift.
3. Pause zone-specific `hand.*`, `object.*`, `gesture.detected`, and `zone.activated` events while the calibration is uncertain.
4. Show the user a recalibration or confirm-still-valid action.
5. If the user confirms the camera moved, emit `scene.reset` with `reset_reason: "camera_bump"` and `reset_scope: "calibration"`.
6. If the user confirms the zones are still valid, emit a new `scene.calibrated` event and resume live events.

`scene.uncertain` must not call a model. It is only symbolic evidence for local recovery or future explicit escalation policy.

## Privacy Notes

- Manual calibration stores rectangles, symbolic object IDs, timestamps, confidence, and privacy booleans only.
- No raw frame bytes, screenshots, video paths, audio, base64 images, OCR, or private notebook text are persisted.
- Cloud fallback is disabled for Gate 1A calibration.
- The live trace recorder may reference calibration IDs and symbolic observation windows, but not media artifacts.
- If any save path tries to include raw media or notebook text, the write must be blocked and the session marked privacy-failed.
