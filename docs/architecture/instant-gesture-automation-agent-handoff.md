# Instant Gesture Automation Agent Handoff

## To Multimodal Perception and Interface Researcher

Implement in this order:

1. Add bundled MediaPipe Gesture Recognizer assets and a worker-owned recognizer. Do not send frames or inference requests to a network service.
2. Add a latest-frame-only controller with bounded sampling, transferable frame cleanup, hidden-tab/camera-stop teardown, and no persistence.
3. Implement `stable-local-gesture-event.v1` with threshold hold, one-shot emission, neutral reset, cooldown compatibility, and session-monotonic event IDs.
4. Add recipe v1.1 migration and dual execution modes. Existing v1 recipes migrate to confirmed AI movement and never inherit instant consent.
5. Add source-aware matching and `runAutomationForStableLocalGesture` through the canonical public API.
6. Enforce the instant allowlist before adapter planning. Make canonical `speak_phrase.config.text` execute once; keep `phrase` migration-only.
7. Add the small off-by-default toggle, compact status, and recipe editor option without changing the frozen hierarchy or result-card geometry.
8. Keep MediaPipe labels, landmarks, inference diagnostics, and stabilizer state inside closed Developer Tools.

Close the current public API gaps by adding `automation/public-api.js`, importing it from both application and harness, and removing policy duplication from `local-capture.js`. The server automation directory requested by the architecture does not currently exist; do not put instant gesture execution on the server.

## To Harness, Evaluation, Memory and Safety Researcher

Extend the automation behavior gate with:

- Instant gestures off by default and no events before session activation.
- MediaPipe label mapping for all seven canonical keys and rejection of unknown labels.
- Threshold/hold behavior, one event per hold, required neutral reset, cooldown, hidden-tab disablement, camera-stop disablement, and rerender independence.
- `thumbs_up -> speak_phrase("Great job")` executes exactly once.
- Duplicate stable event delivery preserves one execution for `gesture_event_id + recipe_id`.
- Instant path provider, movement-recognition endpoint, LLM, and VLM call counts remain zero.
- Instant validation rejects snapshots, webhooks, media, paid APIs, arbitrary commands, and movement-analysis requests.
- Browser notification executes only with permission already granted and never prompts from a recognition callback.
- Confirmed AI movement tests remain unchanged for webhooks, snapshots, uncertainty, rejection, duplicate confirmation, and per-run consent.
- No frame, landmark, image, base64, audio, token, or secret enters recipes, events, receipts, history, storage, logs, or payloads.
- The harness imports `automation/public-api.js` and removes its conflicting action names and risk map.
- Product checks preserve Camera -> Describe my next movement -> Big result, with no gesture dashboard or result-card movement.

## Completion Evidence

Architecture documents are insufficient for approval. Completion requires executable behavior checks plus a browser-local proof showing a stabilized thumbs-up causes one configured speech action, zero cloud calls, no raw media persistence, and correct neutral-reset/cooldown behavior.
