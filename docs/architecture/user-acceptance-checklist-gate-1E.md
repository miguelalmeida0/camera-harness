# User Acceptance Checklist Gate 1E

Use this checklist in a real local browser session.

- [ ] `npm run physical:capture` starts local server.
- [ ] URL opens.
- [ ] `Start Camera` works.
- [ ] Camera preview is visible.
- [ ] `Calibrate Zones` works.
- [ ] `Save Calibration` works.
- [ ] `Start Focus Ritual` becomes enabled or usable after calibration.
- [ ] `Start Recording` works.
- [ ] `Confirm Phone Moved` works and quest advances.
- [ ] `Confirm Notebook Opened` works and quest advances.
- [ ] `Confirm Pen Picked Up` works and quest advances.
- [ ] `Confirm Writing Motion` works and quest advances.
- [ ] `Confirm Typing Motion` works and quest completes.
- [ ] `Stop Recording` works.
- [ ] `Export Physical Trace` works.
- [ ] Downloaded file has the correct name:

```text
live_physical_focus_ritual_001.v0.json
```

- [ ] File is saved to required path:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

- [ ] `npm run physical:validate` passes or gives a clear error.
- [ ] `npm run gate:1c` no longer says missing physical trace if the file is saved correctly.

## User Acceptance Verdicts

Use `TRYABLE_WITH_MANUAL_CONFIRMATION` only if the flow can be completed through manual confirmation.

Use `TRACE_EXPORTED_NOT_VALIDATED` if the file downloads but validation fails.

Use `PHYSICAL_TRACE_VALIDATED` if physical validation passes.

Use `BLOCKED` if the user cannot reach export or a clear blocked-export reason.
