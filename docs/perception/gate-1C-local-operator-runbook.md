# Gate 1C Local Operator Runbook

Gate 1C still requires a real physical browser run. The app is manual local confirmation only, not autonomous vision, and exports symbolic events only.

## Start

```sh
npm run physical:capture
```

Open the printed URL, usually:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

If port `4177` fails:

```sh
npm run physical:capture -- --port 4180
```

## Complete App Wizard

1. Click `Start Camera`.
2. Click `Calibrate Zones`.
3. Accept or edit the normalized symbolic zones.
4. Click `Save Calibration`.
5. Click `Start Focus Ritual`.
6. Click `Start Recording`.
7. Physically perform each Focus Ritual step, then click the matching manual confirmation button.
8. Click `Stop Recording`.
9. Check the real physical webcam session checkbox.
10. Confirm Export Preflight passes.
11. Click `Export Physical Trace`.

Use Operator Mode, What To Do If Stuck, and Event Sequence Inspector if anything is unclear.

## Save Export

Downloaded filename:

```text
live_physical_focus_ritual_001.v0.json
```

Required final path:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

Optional macOS command:

```sh
mkdir -p fixtures/replay/live
cp ~/Downloads/live_physical_focus_ritual_001.v0.json fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run physical:validate
npm run gate:1c
```

## Validate

```sh
npm run physical:validate
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run gate:1c
npm run gate:1d
npm run gate:1e
```

## Send Back

- Output of `npm run physical:validate`
- Output of `npm run gate:1c`
- Whether the file exists at `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`
- If broken, export `darkquest_operator_bug_report.json`

Gate 2 remains blocked until the physical trace exists, validates, and replays.
