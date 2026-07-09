# Gate 4A.1 Real Local Camera Engine Results

## Engine Implemented

Gate 4A.1 adds a modular local perception path for the browser prototype:

- `zone-motion-engine.js` builds symbolic local perception frames from calibrated zone motion.
- `local-action-scorer.js` scores current-step-aware action candidates.
- `action-confidence.js` smooths confidence values.
- `action-cooldowns.js` suppresses repeated rejected candidates.

The engine emits suggestions only. It does not auto-complete quest steps.

## MediaPipe Status

MediaPipe hand tracking is not active in this pass. The current app has no safe existing `@mediapipe/tasks-vision` dependency or local model asset path, so adding it would create dependency and runtime risk during the frozen UI pass.

The active engine is the browser-local `motion_proxy` fallback.

## Suggested Actions

The camera can suggest:

- possible phone moved
- possible notebook opened
- possible pen picked up
- possible writing motion
- possible typing motion
- uncertain scene

Suggestions are gated to the current ritual step in the main UI.

## Privacy Guarantees

The engine processes camera pixels in-memory in the browser and reduces them to symbolic motion scores. It does not persist raw frames, screenshots, base64 media, audio, OCR, or private notebook text.

LLM and VLM calls remain disabled.

## Confirmation Required

Every detected action candidate has `requires_confirmation: true`. Confirming a suggestion emits symbolic evidence from both `local_signal` and `human_correction`. Rejecting a suggestion does not progress the quest and briefly cools down the same candidate.

## Known Limitations

The fallback engine is motion-based, not object recognition. It cannot prove that the moved item was a phone, notebook, or pen. Zone calibration quality, lighting changes, camera shake, occlusion, and overlapping hand movement can reduce confidence or trigger uncertainty.

## Next Physical Benchmark Step

Run a controlled live session with calibrated zones and record only symbolic traces. Compare confirmed suggestions against the existing replay harness before approving any additional visual polish.
