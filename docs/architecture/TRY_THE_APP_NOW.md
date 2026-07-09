# TRY THE APP NOW

## 1. Start

```sh
npm run physical:capture
```

Fallback:

```sh
npm run physical:capture -- --port 4180
```

## 2. Open

Open the printed URL:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

## 3. Complete Wizard

Follow Operator Mode and the Next Step card:

1. Start Camera.
2. Calibrate Zones.
3. Save Calibration.
4. Start Focus Ritual.
5. Start Recording.
6. Perform and manually confirm each Focus Ritual step.
7. Stop Recording.
8. Check the real physical session checkbox.
9. Export Physical Trace.

## 4. Save File

Move the downloaded file to:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

## 5. Validate

```sh
npm run physical:validate
npm run gate:1c
```

## 6. Send Back If Broken

Use `Export Bug Report` in the app, then send:

- `darkquest_operator_bug_report.json`
- output from `npm run physical:validate`
- output from `npm run gate:1c`
- whether the required fixture path exists
