# Local Action Inference Contract v0

## Purpose

This contract defines the local-only boundary between browser perception and the product `Detected Action` card.

The contract emits candidates, not completions. Every candidate requires user confirmation.

## Input: LocalPerceptionFrame

```ts
type LocalPerceptionFrame = {
  timestamp_ms: number;
  zone_motion: Record<string, ZoneMotionObservation>;
  hand_landmarks?: HandLandmarkObservation[];
  hand_zone_overlap?: HandZoneOverlapObservation[];
  active_zone?: string | null;
  confidence: number;
  uncertainty: UncertaintyObservation;
  scene_reset: SceneResetObservation;
};
```

Required fields:

- `timestamp_ms`: monotonic local timestamp.
- `zone_motion`: symbolic per-zone motion scores.
- `hand_landmarks`: optional local hand landmarks if available.
- `hand_zone_overlap`: optional derived overlap between hands and calibrated zones.
- `active_zone`: current strongest symbolic zone, or null.
- `confidence`: local signal confidence.
- `uncertainty`: local uncertainty state.
- `scene_reset`: camera bump or recalibration state.

No field may contain raw frames, screenshots, base64 media, audio, OCR, or notebook text.

## Output: DetectedActionCandidate

```ts
type DetectedActionCandidate = {
  id: string;
  action_type: LocalActionType;
  label: string;
  current_step: string;
  confidence: number;
  zone_id: string | null;
  reason: string;
  evidence: EvidenceRef[];
  requires_confirmation: true;
  detection_method: "hand_landmarker" | "motion_proxy" | "hybrid" | "operator_uncertain";
  timestamp_ms: number;
};
```

Allowed `action_type`:

- `phone_moved`
- `notebook_opened`
- `pen_picked_up`
- `writing_motion`
- `typing_motion`
- `uncertain`
- `reset`

## Evidence Rules

Evidence may reference:

- local zone motion;
- local hand landmark summary;
- hand-zone overlap;
- dwell time;
- velocity or direction;
- cooldown or uncertainty state.

Evidence must not reference:

- raw image pixels;
- screenshots;
- base64 media;
- OCR;
- audio;
- cloud model outputs.

## Inference Rules

- Main UI candidates must match the current step, except `uncertain` and `reset`.
- Future-step candidates may exist only in developer diagnostics.
- `requires_confirmation` is always `true`.
- Low-confidence candidates must not dominate the main card.
- Rejected candidate keys enter cooldown.
- `uncertain` pauses unsafe progression.
- `reset` requires recalibration before safe export or further trust.

## Confirmation Boundary

`DetectedActionCandidate` cannot progress the ritual. Progress happens only after:

```text
candidate -> user confirm -> symbolic event with local_signal + human_correction -> reducer
```

`Not this` / reject cannot emit quest-progress events.

