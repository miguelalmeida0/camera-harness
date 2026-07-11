# Hybrid Recognition Product Boundary

## Frozen Main Product

The approved hierarchy remains:

`Camera -> Describe my next movement -> Big result`

The one-shot AI narrator remains the primary open-ended path. Instant local gestures are an optional camera capability and must not move, replace, or resize the Camera, Describe control, or result card.

## Allowed Minimal Additions

- One small `Instant gestures` toggle, off by default.
- One compact status near the existing camera controls:
  - `Off`
  - `Loading`
  - `Ready`
  - `Recognized`
  - `Cooling down`
  - `Unavailable`
- One recipe-editor option: `Run instantly when this local gesture is recognized`.
- One compact text-only execution receipt using the existing automation status area.

Instant recognition does not require the Describe button and must not mutate, replace, or animate the big AI movement result. Local action status updates must not cause result-card movement or layout jumps.

## Forbidden Main UI

- Gesture dashboard or permanent recipe dashboard.
- Hand landmarks, skeletons, confidence streams, frame rate, or continuous raw telemetry.
- Permanent debug, worker, model, or stabilization cards.
- Raw labels, frame data, image buffers, or event payloads.
- Claims of autonomous vision, gesture accuracy, or production readiness.

Worker state, raw MediaPipe labels, inference timing, dropped-frame counts, stabilizer candidates, neutral-reset state, and denial reason codes remain inside closed Developer Tools.

## Accessibility and Lifecycle

The toggle must expose its on/off state and status text without relying on color. `Unavailable` must leave the one-shot Describe path usable. Reduced motion and existing text-containment rules remain unchanged.
