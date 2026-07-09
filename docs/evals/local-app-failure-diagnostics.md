# Local App Failure Diagnostics

Use the in-app `What To Do If Stuck` panel first. It covers the expected operator failures and points back to the exact validation path.

## `npm run physical:capture` Fails

Try a new port:

```sh
DARKQUEST_CAPTURE_PORT=4178 npm run physical:capture
```

If binding still fails, run from a local terminal with localhost permission.

## Camera Permission Denied

Allow camera permission for `127.0.0.1`, refresh, then click `Start Camera`.

## Browser Shows Camera But Buttons Are Disabled

Read `Blocked Button Reasons` and the Operator Mode `Blocking Reason`. Most disabled states mean the previous wizard stage is incomplete.

## Calibration Cannot Save

Click `Start Camera` first. Then click `Calibrate Zones` and `Save Calibration`.

## Start Ritual Disabled

Save calibration first. The Operator Mode panel should show the active blocker.

## Start Recording Disabled

Start Focus Ritual first. Recording is disabled until camera, calibration, and ritual setup are complete.

## Confirmation Buttons Disabled

Click `Start Recording` and follow the ritual steps in order. If uncertainty or camera reset was marked, use `Reset Session`.

## Export Disabled

Export requires complete ritual sequence, stopped recording, physical confirmation checked, no uncertainty, and no camera reset.

## `physical:validate` Says `physical_trace_missing`

Move the downloaded file to:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

Then rerun:

```sh
npm run physical:validate
npm run gate:1c
```

## Wrong Provenance

Repeat the physical export path, check the real physical session checkbox, and do not use a dev dry-run fixture.

## Gate 1C Still Blocked

Run `npm run physical:validate` first. Gate 1C remains `BLOCKED_MISSING_PHYSICAL_TRACE` until the required physical trace exists and physical validation passes.

## Downloaded File Saved To Wrong Path

Use:

```sh
mkdir -p fixtures/replay/live
cp ~/Downloads/live_physical_focus_ritual_001.v0.json fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

## Send Back

- `darkquest_operator_bug_report.json`
- `runs/physical-validate-latest.json`
- `runs/gate-1c-latest.json`
- terminal output from physical validation and Gate 1C

Do not send raw webcam media, audio, screenshots of private notebook text, OCR, notebook text, API keys, model responses, cloud evidence, or base64 media.
