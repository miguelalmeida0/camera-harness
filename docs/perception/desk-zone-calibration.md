# DarkQuest Desk-Zone Calibration Design

## Decision

Use manual polygon calibration for v1. The user marks the desk zones on a still camera frame, stores normalized polygon geometry, and the perception loop resolves hands/objects into zones locally. Auto-calibration is a later assistive layer, not a v1 dependency.

## Why this is the right architecture

Manual zones are fast, explainable, private, and reliable enough for a desk ritual. They avoid pretending the system knows the user's desk semantics from pixels alone. The camera loop can still produce useful state offline: "phone zone occupied", "notebook dwell", "pen moved", "neutral desk activity", or "off-desk distraction" without object taxonomy perfection.

## Zone taxonomy

| Zone | Purpose | Default behavior |
|---|---|---|
| `phone` | Detect phone presence, pickup, dwell, and distraction risk. | High salience. Movement out of zone can emit quest interruption. |
| `notebook` | Track writing/reading ritual surface. | Dwell supports focus progress. |
| `pen_tool` | Track pen, stylus, or small tool movement. | Small-object motion is expected; higher uncertainty when occluded. |
| `keyboard` | Track typing/work zone. | Hand presence can count as active work without object movement. |
| `neutral` | Main desk area not assigned to semantic tools. | Low-salience activity zone. |
| `off_desk_distraction` | Frame area outside desk or known distraction area. | Objects/hands here should not advance focus progress. |
| `uncertain` | Computed fallback when geometry, confidence, or drift is bad. | HUD shows uncertainty and avoids semantic claims. |

## Manual calibration flow

1. Ask for camera permission and show a frozen desk still.
2. Let the user drag polygon corners for required zones: phone, notebook, pen/tool, keyboard, neutral.
3. Auto-fill `off_desk_distraction` as frame area outside the desk polygon or user-marked distraction region.
4. Compute overlap and area sanity checks.
5. Show zone overlay on the live feed for confirmation.
6. Store normalized geometry, camera frame size, calibration timestamp, and scene fingerprint.
7. Start the ritual only after calibration passes minimum sanity checks.

Calibration rules:

- Coordinates are normalized `0..1` relative to the video frame.
- Zone polygons may touch but should not overlap by more than 5% of the smaller zone area.
- `neutral` can be a large polygon or a derived desk polygon minus semantic zones.
- `uncertain` is never user-drawn; it is assigned at runtime.
- A calibration can be temporarily suspended on camera bump without deleting it.

## Auto-calibration later

Auto-calibration should only suggest zones. The user remains the source of truth.

Later local assists:

- Detect rectangular keyboard by edge/line structure.
- Suggest phone zone from repeated small-rectangle dwell.
- Suggest notebook zone from large flat rectangle with writing-hand dwell.
- Suggest pen/tool zone from small elongated object dwell.
- Suggest desk polygon from stable plane mask and long-lived object support area.

The auto pass emits draft zones with `source: "auto_suggested"` and never overwrites confirmed zones.

## Zone geometry format

```ts
type ZoneKind =
  | "phone"
  | "notebook"
  | "pen_tool"
  | "keyboard"
  | "neutral"
  | "off_desk_distraction"
  | "uncertain";

type Point = {
  x: number;
  y: number;
};

type ZoneDefinition = {
  id: string;
  kind: ZoneKind;
  label: string;
  geometry: {
    type: "polygon";
    points: Point[];
  };
  priority: number;
  source: "manual" | "derived" | "auto_suggested";
  confidence: number;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

type CalibrationProfile = {
  id: string;
  version: 1;
  camera: {
    deviceIdHash: string;
    frameWidth: number;
    frameHeight: number;
    facingMode?: "user" | "environment";
  };
  sceneFingerprint: {
    algorithm: "luma-histogram-edge-v1";
    hash: string;
    lumaHistogram: number[];
    edgeDensity: number;
    capturedAtMs: number;
  };
  zones: ZoneDefinition[];
};
```

## JSON example

```json
{
  "id": "cal_focus_desk_2026_07_08",
  "version": 1,
  "camera": {
    "deviceIdHash": "sha256:local-camera-hash",
    "frameWidth": 1280,
    "frameHeight": 720,
    "facingMode": "user"
  },
  "sceneFingerprint": {
    "algorithm": "luma-histogram-edge-v1",
    "hash": "sha256:scene-fingerprint",
    "lumaHistogram": [0.02, 0.04, 0.11, 0.19, 0.24, 0.18, 0.12, 0.07, 0.03],
    "edgeDensity": 0.31,
    "capturedAtMs": 1783546800000
  },
  "zones": [
    {
      "id": "zone_phone_left",
      "kind": "phone",
      "label": "Phone",
      "geometry": {
        "type": "polygon",
        "points": [
          { "x": 0.05, "y": 0.58 },
          { "x": 0.22, "y": 0.56 },
          { "x": 0.24, "y": 0.84 },
          { "x": 0.04, "y": 0.86 }
        ]
      },
      "priority": 80,
      "source": "manual",
      "confidence": 1,
      "enabled": true,
      "createdAtMs": 1783546800000,
      "updatedAtMs": 1783546800000
    },
    {
      "id": "zone_notebook_center",
      "kind": "notebook",
      "label": "Notebook",
      "geometry": {
        "type": "polygon",
        "points": [
          { "x": 0.28, "y": 0.48 },
          { "x": 0.56, "y": 0.46 },
          { "x": 0.59, "y": 0.86 },
          { "x": 0.25, "y": 0.88 }
        ]
      },
      "priority": 70,
      "source": "manual",
      "confidence": 1,
      "enabled": true,
      "createdAtMs": 1783546800000,
      "updatedAtMs": 1783546800000
    },
    {
      "id": "zone_keyboard_top",
      "kind": "keyboard",
      "label": "Keyboard",
      "geometry": {
        "type": "polygon",
        "points": [
          { "x": 0.34, "y": 0.18 },
          { "x": 0.82, "y": 0.19 },
          { "x": 0.82, "y": 0.38 },
          { "x": 0.33, "y": 0.37 }
        ]
      },
      "priority": 60,
      "source": "manual",
      "confidence": 1,
      "enabled": true,
      "createdAtMs": 1783546800000,
      "updatedAtMs": 1783546800000
    }
  ]
}
```

## Zone resolution

Runtime assignment:

1. Compute observation centroid and optional bbox corners.
2. Hit-test centroid against enabled polygons.
3. If multiple zones match, choose highest `priority`.
4. If bbox overlaps zones but centroid does not, assign the max overlap zone with reduced confidence.
5. If no zone matches but observation is inside desk polygon, assign `neutral`.
6. If outside desk polygon, assign `off_desk_distraction`.
7. If scene drift, overlap ambiguity, or observation confidence is low, assign `uncertain`.

`ZoneObservation` example:

```json
{
  "zoneId": "zone_notebook_center",
  "kind": "notebook",
  "occupancy": "occupied",
  "confidence": 0.86,
  "occupants": ["object_notebook_1", "hand_right"],
  "evidenceId": "zone-hit-1783546801200-zone_notebook_center"
}
```

## Zone drift detection

Compute drift every sampled frame:

- Compare current scene fingerprint to calibration fingerprint.
- Track stable anchor patches near zone corners.
- Measure edge-density change inside each zone.
- Watch for impossible occupancy, such as all zones occupied or all zones missing for a sustained period.

Drift states:

| State | Trigger | Behavior |
|---|---|---|
| `stable` | Fingerprint distance < 0.15 and anchor drift < 3% frame diagonal. | Normal event emission. |
| `watch` | Fingerprint distance 0.15-0.25 or anchor drift 3-5%. | Lower confidence; HUD shows subtle calibration watch state. |
| `drifted` | Fingerprint distance > 0.25 or anchor drift > 5% for 1 second. | Emit `scene.uncertain` with `uncertainty_kind: "camera_bump"`; pause zone-specific events. |
| `invalid` | Zone geometry impossible after resize or profile mismatch. | Require recalibration. |

## Camera bump detection

Camera bump is a special drift case where the whole frame transform changes. Use:

- edge-map displacement across the full frame;
- luma histogram distance;
- zone anchor patch displacement;
- sudden global motion not explained by hand/object bboxes.

Emit `scene.uncertain` after 3 consecutive high-bump frames or a single extreme bump frame. Attach:

```json
{
  "type": "scene.uncertain",
  "confidence": 0.91,
  "payload": {
    "uncertainty_kind": "camera_bump",
    "affected_refs": ["scene", "calibration"],
    "resolver_hint": "review_or_recalibrate_zones",
    "escalation_recommended": false,
    "bump_score": 0.78,
    "fingerprint_distance": 0.34,
    "anchor_drift_pct": 0.069,
    "action": "pause_zone_events"
  }
}
```

## Reset behavior

Reset types:

| Reset | Trigger | State handling |
|---|---|---|
| Soft reset | User clears ritual state or scene briefly uncertain. | Clear dwell timers and gesture streaks; keep calibration. |
| Calibration reset | Camera bump or drift confirmed. | Clear zone occupancy, keep old profile suspended, request confirmation. |
| Full reset | User chooses new desk setup. | Delete active calibration after confirmation; start manual flow. |

The stabilizer `reset(reason)` must emit `scene.reset` with the reason and evidence that state was cleared.

## UI display behavior

- Zones are visible during calibration and as low-contrast overlays during the ritual.
- Semantic zones use distinct but restrained colors; `uncertain` uses a neutral warning pattern.
- Zone labels appear on hover/focus and during calibration, not constantly in the live ritual.
- When drift is `watch`, zones remain visible but confidence indicators soften.
- When drift is `drifted`, freeze the last stable overlay and show a recalibration affordance.
- When permission is denied, show manual setup controls and no fake camera overlay.

## Failure modes

| Failure mode | Mitigation |
|---|---|
| User draws overlapping zones | Block save above overlap threshold and highlight conflict. |
| User draws tiny unusable zone | Enforce minimum area and corner distance. |
| Camera mirror changes | Store mirrored flag and transform points consistently. |
| Browser resizes video | Normalized coordinates remain valid; recompute pixel geometry. |
| Lighting changes look like drift | Require anchor displacement as well as histogram distance before bump. |
| Intentional desk rearrangement | Enter reset review; do not silently rewrite zones. |

## Cost/latency impact

Zone hit-testing is deterministic and should stay under 2 ms per perception frame. Calibration is user-time only and has no cloud cost. Auto-calibration later should remain local and optional.

## Handoff to next agent

Implement the calibration UI as a camera still with polygon editing, sanity checks, normalized JSON export, and replay manifest integration. Keep it visually subordinate to the live desk quest surface after setup.
