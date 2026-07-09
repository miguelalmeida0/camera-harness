# FINAL USER TEST SCRIPT

Minimal HUD polish is enabled with disclosure. This flow uses manual local confirmations and does not prove autonomous vision.

## 1. Start The App

```sh
npm run physical:capture
```

If port `4177` is busy:

```sh
npm run physical:capture -- --port 4180
```

## 2. Open The Browser

Default URL:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

Port `4180` URL:

```text
http://127.0.0.1:4180/packages/perception/browser-local-capture/prototype/index.html
```

## 3. Complete The Wizard

1. Click `Start Camera`.
2. Click `Calibrate Zones`.
3. Keep defaults for first run.
4. Click `Save Calibration`.
5. Click `Start Focus Ritual`.
6. Click `Start Recording`.
7. Physically move phone away, then click `Confirm Phone Moved`.
8. Physically open notebook, then click `Confirm Notebook Opened`.
9. Physically pick up pen, then click `Confirm Pen Picked Up`.
10. Physically make writing motion, then click `Confirm Writing Motion`.
11. Physically make typing motion, then click `Confirm Typing Motion`.
12. Click `Stop Recording`.
13. Check physical-session confirmation.

## 4. Export The Trace

Click:

```text
Export Physical Trace
```

## 5. Move/Save The Trace

Save the downloaded file to:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

The app shows the macOS copy command. It should look like:

```sh
mkdir -p fixtures/replay/live && cp ~/Downloads/live_physical_focus_ritual_001.v0.json fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

## 6. Validate The Trace

```sh
npm run physical:validate
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run gate:1c
```

Optional final source check:

```sh
npm run gate:1d
npm run gate:1e
npm run gate:1f
```

## 7. Send Back Results

Send:

- exported trace if validation fails;
- `darkquest_operator_bug_report.json` if app behavior is broken;
- terminal output from `npm run physical:validate`;
- terminal output from replay repeat 3;
- terminal output from `npm run gate:1c`;
- visible error text, current quest state, export status, and troubleshooting text if the browser flow is blocked.
