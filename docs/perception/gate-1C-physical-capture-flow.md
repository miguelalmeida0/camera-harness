# Gate 1C Physical Capture Flow

## Goal

Produce `fixtures/replay/live/live_physical_focus_ritual_001.v0.json` from an operator-confirmed physical browser webcam session without persisting raw media or calling models.

## Start The Prototype

From the workspace root:

```sh
npm run physical:capture
```

The launcher prints the local capture URL:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

## Browser Permission

Click `Start Camera` and grant webcam permission. The page requests `{ video: true, audio: false }`. Do not enable microphone access.

## Manual Calibration

Place the physical desk items in view, then use the prototype controls to record symbolic calibration and zone/object observations.

Required zones:

- `phone_zone`
- `notebook_zone`
- `pen_zone`
- `keyboard_zone`
- `neutral_zone`
- `off_desk_zone`

Required objects:

- `phone`
- `notebook`
- `pen`
- `keyboard`

## Physical Focus Ritual

Perform the ritual physically while recording symbolic observations:

1. Calibrate desk zones.
2. Move phone away.
3. Open notebook.
4. Pick up pen.
5. Perform writing-like motion.
6. Perform typing-like motion.
7. Complete quest.

Click the matching symbolic controls only after the physical action occurs in the webcam session.

## Recording And Export

1. Click `Start Focus Ritual`.
2. Click `Start Recording`.
3. Complete the physical ritual.
4. Click `Stop Recording`.
5. Tick `I confirm this recording came from a real physical webcam session.`
6. Click `Export Physical Trace`.
7. Save the downloaded fixture as `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.

## Verify Privacy

Inspect the exported fixture and confirm:

- `privacy.contains_raw_video` is `false`
- `privacy.contains_audio` is `false`
- `trace_origin.raw_media_persisted` is `false`
- no screenshots, base64 media, OCR, notebook text, or raw frame paths appear
- `expected.model_calls` is empty
- `metrics.browser_latency_records` exists

## Replay Validation

```sh
npm run physical:validate
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run gate:1c
```
