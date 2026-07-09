# Gate 4A.1 Real Engine Gap Analysis

## Decision

Gate 4A proves the product loop exists, with disclosure:

```text
camera suggestion
-> user confirm/correct
-> symbolic event
-> progress update
```

It does not prove robust hand tracking, object recognition, gesture recognition, or production-grade physical action recognition.

## What Gate 4A Currently Proves

- The main UI can show a product-facing Detected Action card.
- Camera suggestions are confirmation-gated.
- Confirmed suggestions can emit symbolic events with `local_signal` and `human_correction`.
- Rejected suggestions do not progress quest state.
- Future-step suggestions are suppressed from the main flow.
- Raw media persistence stays zero.
- LLM/VLM calls stay zero.
- Developer trace campaign tooling is hidden by default.

## What Gate 4A Does Not Prove

- It does not prove robust hand landmark tracking.
- It does not prove object detection.
- It does not prove gesture recognition.
- It does not prove action recognition works across users, lighting, camera angles, or desk layouts.
- It does not prove false-positive or false-negative rates.
- It does not justify autonomous vision, production perception, portfolio/demo, or auto-completion claims.

## What Is Still Motion-Proxy Only

The current browser local capture path is still primarily:

- downsampled browser frame differencing;
- zone motion scores;
- dwell and burst heuristics;
- directional proxy from zone history;
- current-step-aware suggestion ranking;
- cooldown after rejection.

This is useful as a fallback and baseline, but it is not enough to call the system strong camera action recognition.

## What Must Be Added

Gate 4A.1 must add a real local perception layer:

- MediaPipe hand landmark engine if feasible;
- hand-zone overlap;
- hand velocity and direction;
- dwell around calibrated desk zones;
- action-specific scorers using hand and motion evidence;
- confidence smoothing over short windows;
- explicit uncertainty/occlusion/reset handling;
- synthetic scorer tests and physical benchmark protocol.

## JSON Trace Work Is Internal QA Only

JSON traces, Gate 3B-Live, suggestion trace campaign, reports, and replay exports are QA tools. They must not define the product workflow.

The product is:

```text
connect camera
-> track local movement
-> suggest likely action
-> user confirms or corrects
-> progress updates
```

Trace tooling remains hidden under Advanced / Developer Tools.

## Gate 4A.1 Exit Criteria

Gate 4A.1 should be considered ready for implementation when:

- module boundaries are clear;
- hand tracking path is feasible or explicitly deferred with fallback;
- action inference contract is implemented in code, not only docs;
- hidden diagnostics can inspect signals without exposing raw media;
- confirmation boundary remains intact.

