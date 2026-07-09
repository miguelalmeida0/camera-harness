# Gate 1D / 1E / 1F Local App Status

## Verdict

Gate 1D: `TRYABLE_WITH_MANUAL_CONFIRMATION`

Gate 1E: `TRACE_EXPORT_READY`

Gate 1F recommendation: ready for the user’s physical run, with Operator Mode, save-path assistant, event-sequence inspector, stuck guide, and bug report export.

Gate 1C: `BLOCKED_MISSING_PHYSICAL_TRACE`

Gate 2 / HUD polish: blocked.

## Run

```sh
npm run physical:capture
```

Fallback:

```sh
npm run physical:capture -- --port 4180
```

Open:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

## User Path

1. Complete the app wizard.
2. Export the physical trace.
3. Save it to `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.
4. Run `npm run physical:validate`.
5. Run `npm run gate:1c`.
6. Send outputs or `darkquest_operator_bug_report.json` if broken.

The app remains manual confirmation, not autonomous computer vision, and exports symbolic JSON only.
