# Gate 3A Local Perception MVP Results

## What Local Perception Does

Gate 3A adds browser-only frame differencing over the live camera preview. The app downsamples frames in memory, computes zone-level `motion_score`, and emits low-risk symbolic signals such as `zone.activated`, `hand.entered_zone`, `hand.left_zone`, and `scene.uncertain`.

## What It Does Not Do

This is not object recognition, full hand tracking, autonomous vision, cloud vision, or production-grade gesture recognition. Camera output is treated as a suggestion source only.

## Motion Proxy

The browser samples a small grayscale canvas, compares it with the previous downsampled sample, and maps motion into calibrated zones. Stable zone motion can create camera suggestions. Notebook-zone repeated motion can suggest writing-like motion; keyboard-zone repeated motion can suggest typing-like motion.

## Manual Confirmation

Manual confirmation remains the final authority. Accepting a camera suggestion records both `local_signal` and `human_correction` evidence. Rejecting a suggestion does not progress quest state.

## Privacy Guarantees

- no raw webcam frames are persisted
- no screenshots are stored
- no base64 images are stored
- no raw audio is captured
- no frames are sent to a backend or cloud
- no LLM or VLM calls are made

## Known Limitations

Motion proxy can confuse hands, objects, lighting changes, and camera bumps. It can suggest writing or typing only from local motion patterns in calibrated zones. Low confidence or noisy motion emits uncertainty and does not automatically complete ritual steps.
