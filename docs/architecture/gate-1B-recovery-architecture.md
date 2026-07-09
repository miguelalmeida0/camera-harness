# Gate 1B Recovery Architecture

## Decision

Gate 1B recovery is local, symbolic, and replayable. Occlusion and camera bump/reset do not call models, persist raw media, or let the quest engine continue on stale visual truth.

## Occlusion Recovery

### Flow

```text
local browser signal detects hand/object/zone interruption
-> LocalObservationFrame.scene.uncertain = true
-> live-perception-adapter emits scene.uncertain
-> quest state holds active step
-> HUD shows uncertainty/recovery
-> tracking resumes
-> adapter emits confidence.changed or stable event
-> replay fixture records the symbolic recovery
```

### Local Signal

Occlusion may be detected from symbolic metrics such as:

- required object disappears while active step needs it;
- hand/object overlap blocks classification;
- zone occupancy becomes uncertain;
- tracker confidence drops below threshold;
- observation extraction reports an occlusion score above threshold.

### Required Event Behavior

Emit `scene.uncertain` when occlusion blocks active state progress:

```json
{
  "type": "scene.uncertain",
  "payload": {
    "uncertainty_kind": "occlusion",
    "affected_refs": ["obj_pen", "zone_notebook", "step_write_three_bullets"],
    "resolver_hint": "hold_state_until_tracking_resumes",
    "escalation_recommended": false
  }
}
```

When tracking resumes, emit either:

- `confidence.changed` for the affected ref; or
- a normal stable event that satisfies the active guard.

### Required Invariants

- Quest engine must not progress steps during unresolved uncertainty.
- HUD must show uncertainty/recovery.
- No LLM/VLM call occurs.
- No raw frame, screenshot, audio, or base64 media is persisted.
- Replay must capture both the uncertainty and the recovery event.

## Camera Bump / Reset Recovery

### Flow

```text
local browser signal detects zone drift / sudden scene change
-> adapter emits scene.reset
-> calibration marked stale
-> quest state stops using stale zone truth
-> HUD shows reset / recalibration required
-> user recalibrates or session records recovery
-> scene.calibrated re-establishes zone truth
```

### Local Signal

Camera bump/reset may be detected from symbolic metrics such as:

- sudden scene fingerprint distance jump;
- calibrated zone corners no longer match expected visual anchors;
- widespread object/zone discontinuity;
- camera permission stream restart;
- frame aspect or orientation changes;
- reset button or explicit user recalibration.

### Required Event Behavior

Emit `scene.reset`:

```json
{
  "type": "scene.reset",
  "payload": {
    "reset_reason": "camera_bump",
    "reset_scope": "calibration",
    "previous_state_id": "writing_pending"
  }
}
```

After reset, do not emit zone-specific progress events until a valid `scene.calibrated` event re-establishes calibration.

### Required Invariants

- Quest engine must not continue using stale zone truth.
- HUD must show reset or recalibration required.
- Trace records reset and recalibration symbolically.
- No model call occurs.
- No raw media is persisted.

## Recovery Fixtures

Gate 1A disclosed missing recommended fixtures:

- `fixtures/replay/live/live_occlusion_recovery_001.v0.json`
- `fixtures/replay/live/live_camera_bump_reset_001.v0.json`

Gate 1B should promote browser-generated versions of these fixtures into the acceptance suite. Until they pass or are explicitly disclosed, cinematic HUD polish remains blocked.

## Failure Modes

| Failure | Required result |
| --- | --- |
| Occlusion advances quest step | Fail: quest progress during uncertainty. |
| Camera bump without reset | Fail: stale zone truth. |
| Reset hidden from HUD | Fail: reset honesty violation. |
| Recovery uses VLM | Fail: unexpected model call. |
| Recovery persists frame/screenshot | Fail: raw media persistence violation. |
| Recovery fixture cannot replay | Fail: replay incompatibility. |
