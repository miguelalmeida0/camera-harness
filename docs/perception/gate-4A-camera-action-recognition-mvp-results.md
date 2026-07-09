# Gate 4A Camera Action Recognition MVP Results

## What the camera can suggest now

The default app flow shows one live Detected Action candidate from local browser motion proxy signals:

- possible phone moved
- possible notebook opened
- possible pen picked up
- possible writing motion
- possible typing motion
- uncertain scene

The suggestion is prioritized by the current Focus Ritual step and future-step suggestions are suppressed in the main UI.

## What it cannot do

This is not proof of object recognition or complete action understanding. It is local motion-based assistance. The camera can be wrong when lighting changes, hands overlap zones, objects move together, or motion is too subtle.

## How confirmation works

The Detected Action card always says that camera suggestions require confirmation. Confirm emits the existing symbolic event with `local_signal` and `human_correction` evidence plus `detection_method: motion_proxy`. Not this rejects the suggestion, does not progress the quest, and briefly suppresses the same suggestion.

## Privacy guarantees

Frame differencing stays in the browser. The app does not store raw frames, screenshots, base64 media, audio, OCR, or notebook text. LLM and VLM calls remain zero.

## Why trace tools are hidden

Gate 3B-Live trace capture is QA tooling, not the normal product workflow. Trace campaign, JSON previews, preflight internals, and validation logs are under closed Advanced / Developer Tools by default.

## Next safe step

Use the product flow for live operator confirmation, then run a short physical session to verify that current-step suggestions appear reliably before considering broader perception models.
