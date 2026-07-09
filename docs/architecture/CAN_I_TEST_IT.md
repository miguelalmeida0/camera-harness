# CAN I TEST IT?

Yes, the local app can be tested now with minimal HUD polish enabled under disclosure.

Gate 1C is accepted as `PASS_WITH_DISCLOSURE` for the current physical trace path.

Minimal state-backed HUD polish is unlocked with disclosure.

No, cinematic HUD polish is not unlocked.

No, autonomous vision is not proven.

No, production-quality or portfolio demo claims are approved.

## Exact Command

From the repo root:

```sh
npm run physical:capture
```

If port `4177` is busy:

```sh
npm run physical:capture -- --port 4180
```

## Exact URL

Open:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

If using port `4180`, open:

```text
http://127.0.0.1:4180/packages/perception/browser-local-capture/prototype/index.html
```

## Exact Click Flow

1. Click `Start Camera`.
2. Click `Calibrate Zones`.
3. Keep defaults for the first run.
4. Click `Save Calibration`.
5. Click `Start Focus Ritual`.
6. Click `Start Recording`.
7. Physically move phone away, then click `Confirm Phone Moved`.
8. Physically open notebook, then click `Confirm Notebook Opened`.
9. Physically pick up pen, then click `Confirm Pen Picked Up`.
10. Physically make writing motion, then click `Confirm Writing Motion`.
11. Physically make typing motion, then click `Confirm Typing Motion`.
12. Click `Stop Recording`.
13. Tick `I confirm this recording came from a real physical webcam session.`
14. Click `Export Physical Trace`.

## Exact Save Path

Save the downloaded file as:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

Expected downloaded filename:

```text
live_physical_focus_ritual_001.v0.json
```

## Exact Validation Commands

Run:

```sh
npm run physical:validate
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run gate:1c
```

Optional source checks:

```sh
npm run gate:1d
npm run gate:1e
npm run gate:1f
```

## Success Means

Success means:

- the app opens;
- camera starts;
- calibration saves;
- manual confirmations advance quest state;
- event timeline updates;
- export downloads JSON;
- file is saved at the exact path;
- `npm run physical:validate` passes;
- replay repeat 3 passes;
- Gate 1C returns `PASS_WITH_DISCLOSURE`, `PASS`, or a specific failure code.

## Blocked Means

Blocked means:

- app does not open;
- camera does not start;
- calibration does not save;
- buttons stay disabled without useful reason;
- quest state does not progress;
- export is disabled without useful reason;
- exported file is not saved at the required path;
- `physical:validate` fails;
- Gate 1C returns an unexpected blocker or failure code.

## Send Back If Broken

Send back:

- terminal output from `npm run physical:capture`;
- `Current Quest State`;
- `Export Status`;
- `Troubleshooting Panel`;
- `Event Sequence Inspector`;
- exported trace file if downloaded;
- `darkquest_operator_bug_report.json` if exported;
- terminal output from `npm run physical:validate`;
- terminal output from `npm run gate:1c`.
