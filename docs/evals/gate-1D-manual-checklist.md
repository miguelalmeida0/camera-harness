# Gate 1D Manual Checklist

Use this checklist during a local browser app run. Gate 1D is manual because camera permission, calibration, event emission, export download, and validation require an operator session.

## Launch

- [ ] Run `npm run physical:capture`
- [ ] Open the printed local URL
- [ ] Confirm the app title is visible
- [ ] Confirm cloud services are disabled in the launcher output or UI
- [ ] Confirm raw media persistence status is visible
- [ ] Confirm LLM/VLM status is visible

## Camera

- [ ] Click `Start Camera`
- [ ] Confirm preview visible
- [ ] Confirm camera permission/status updates

## Calibration

- [ ] Click `Calibrate Zones`
- [ ] Set `phone_zone`
- [ ] Set `notebook_zone`
- [ ] Set `pen_zone`
- [ ] Set `keyboard_zone`
- [ ] Set `neutral_zone`
- [ ] Set `off_desk_zone`
- [ ] Assign phone
- [ ] Assign notebook
- [ ] Assign pen
- [ ] Assign keyboard
- [ ] Click `Save Calibration`
- [ ] Verify `scene.calibrated` event appears
- [ ] Verify quest state becomes `calibrated`

## Focus Ritual

- [ ] Click `Start Focus Ritual`
- [ ] Verify current objective asks for phone removal
- [ ] Click `Start Recording`
- [ ] Physically move phone away
- [ ] Click `Confirm Phone Moved`
- [ ] Verify quest advances
- [ ] Physically open notebook
- [ ] Click `Confirm Notebook Opened`
- [ ] Verify quest advances
- [ ] Physically pick up pen
- [ ] Click `Confirm Pen Picked Up`
- [ ] Verify quest advances
- [ ] Perform writing motion
- [ ] Click `Confirm Writing Motion`
- [ ] Verify quest advances
- [ ] Perform typing motion
- [ ] Click `Confirm Typing Motion`
- [ ] Verify `quest_complete`

## Recording And Export

- [ ] Click `Stop Recording`
- [ ] Check physical session confirmation
- [ ] Confirm manual local confirmation is visible and not labeled automatic vision
- [ ] Click `Export Physical Trace`
- [ ] Save file to `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`
- [ ] Confirm export status updates

## Validation

- [ ] Run `npm run physical:validate`
- [ ] Run `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json`
- [ ] Run `npm run gate:1c`
- [ ] Record result in `docs/evals/gate-1D-results.md`

## Privacy And Model Status

- [ ] Exported trace contains no raw video
- [ ] Exported trace contains no screenshots
- [ ] Exported trace contains no base64 images
- [ ] Exported trace contains no audio
- [ ] Exported trace contains no OCR or notebook text
- [ ] LLM calls are `0`
- [ ] VLM calls are `0`
- [ ] Raw media persistence count is `0`
- [ ] Event IDs are unique
- [ ] Timestamps are monotonic
- [ ] Browser latency records exist for physical export

## Verdict

- [ ] `NOT_TRYABLE`
- [ ] `TRYABLE_WITH_MANUAL_CONFIRMATION`
- [ ] `TRYABLE_WITH_LOCAL_PERCEPTION`
- [ ] `TRACE_EXPORT_WORKING`
- [ ] `FAIL`

Operator notes:
