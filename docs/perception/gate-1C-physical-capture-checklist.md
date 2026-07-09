# Gate 1C Physical Capture Checklist

## Before Capture

- [ ] I am in the repo root.
- [ ] I ran `npm run physical:capture`.
- [ ] I opened the printed local URL.
- [ ] Phone, notebook, pen, keyboard, neutral zone, and off-desk zone are visible.
- [ ] Lighting is steady.

## Camera Permission

- [ ] I clicked `Start Camera`.
- [ ] Browser camera permission is granted.
- [ ] Microphone/audio permission is not enabled.
- [ ] HUD shows raw media persisted: `false`.
- [ ] HUD shows cloud fallback: `disabled`.

## Calibration

- [ ] I clicked `Calibrate Zones`.
- [ ] I defined normalized rectangles for every required zone.
- [ ] I assigned phone, notebook, pen, and keyboard to zones.
- [ ] I clicked `Save Calibration`.

## Focus Ritual Start

- [ ] I clicked `Start Focus Ritual`.
- [ ] I clicked `Start Recording`.

## Recording

- [ ] Recording status shows active.
- [ ] Last symbolic events are updating.
- [ ] Browser latency values are updating.
- [ ] LLM calls show `0`.
- [ ] VLM calls show `0`.

## Physical Ritual Execution

- [ ] I moved the phone away physically, then clicked `Confirm Phone Moved`.
- [ ] I opened the notebook physically, then clicked `Confirm Notebook Opened`.
- [ ] I picked up the pen physically, then clicked `Confirm Pen Picked Up`.
- [ ] I performed writing-like motion physically, then clicked `Confirm Writing Motion`.
- [ ] I performed typing-like motion physically, then clicked `Confirm Typing Motion`.

## Export

- [ ] I clicked `Stop Recording`.
- [ ] I ticked `I confirm this recording came from a real physical webcam session.`
- [ ] I clicked `Export Physical Trace`.
- [ ] I saved the file as `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.

## Privacy Check

- [ ] The exported symbolic observation file contains no images.
- [ ] It contains no screenshots.
- [ ] It contains no base64 media.
- [ ] It contains no audio.
- [ ] It contains no OCR.
- [ ] It contains no notebook text.

## Replay Validation

- [ ] I ran `npm run physical:validate`.
- [ ] I ran `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.

## Gate 1C Validation

- [ ] I ran `npm run gate:1c`.
- [ ] I checked `runs/gate-1c-latest.json`.

## Failure Recovery

- [ ] If validation says fixture missing, save the downloaded file to `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.
- [ ] If operator confirmation is missing, repeat export after ticking the physical-session confirmation checkbox.
- [ ] If replay misses a transition, repeat the ritual in order.
- [ ] If raw media is detected, delete the exported symbolic observation file and recapture without pasting media or screenshots.
