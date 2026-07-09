# Gate 1C Physical Trace Blocker

## Status

`BLOCKED_MISSING_PHYSICAL_TRACE`

Missing required file:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

Do not create this file without a real operator-confirmed physical browser run.

## Unblock Path

```sh
npm run physical:capture
```

Open the app, complete Operator Mode, export the physical trace, and save the download exactly as:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

Then run:

```sh
npm run physical:validate
npm run gate:1c
```

If broken, export `darkquest_operator_bug_report.json` from the app and send the validation outputs.

The dev dry-run file under `runs/dev/` is non-physical and cannot satisfy Gate 1C.
