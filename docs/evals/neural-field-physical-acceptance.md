# Neural Field physical acceptance

Use a normal camera session. Do not enable replay recording and do not capture or retain camera or microphone media. Record only the fixture-free observations and timings listed below.

## AirScript

1. Start Neural Field and select AirScript.
2. Pinch, then draw a circle, an arrow, and the letters `AI`.
3. Release after each stroke.
4. Confirm that each live stroke follows the hand, stabilizes after release, and never invents text.
5. Record hand-to-line latency, release-to-stabilization latency, the displayed classification with confidence, and any uncertainty.

## Spatial Lasso

1. Select Spatial Lasso and lasso a mug.
2. Manually confirm the mug anchor, then select a laptop.
3. Confirm the displayed relative relation.
4. Move the mug and confirm the relation updates without a stale connector.
5. Remove the mug from view and confirm tracking uncertainty/loss clears the anchor.
6. Record lasso-to-grounding latency, relation-update latency, and safe text observations only.

## Return and cleanup

1. Exit Neural Field and confirm camera overlays, workers, speech, and replay state stop.
2. Start Ask and verify one natural-voice response.
3. Exit, start Watch, and verify observation restarts without stale strokes or labels.
4. Record only pass/fail, timings, uncertainty, and resource counts. Never record camera media automatically.
