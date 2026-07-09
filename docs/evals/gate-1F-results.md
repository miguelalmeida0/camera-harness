# Gate 1F Results

## Claim Being Tested

The local app has enough operator guidance, troubleshooting, save-path support, bug-report export, event-sequence inspection, and dry-run/physical separation for a non-agent user to complete the physical trace run and send useful evidence back.

Gate 1F does not approve HUD polish, cinematic polish, portfolio claims, Gate 1C, or autonomous vision claims.

## Operator Guidance Result

Verdict: `PASS`

Evidence:

- Operator Mode panel
- Next Action field
- Blocking Reason field
- validation command UX
- Artifact Checklist
- `runs/gate-1f-latest.json`

## Troubleshooting Result

Verdict: `PASS`

The source contains camera failure help, disabled-button help, export missing help, wrong save path help, Gate 1C blocked help, and port fallback help.

## Save-Path Assistant Result

Verdict: `PASS`

Required path:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

Downloaded filename:

```text
live_physical_focus_ritual_001.v0.json
```

The app includes copy-save-path support, copy-validation-command support, and an optional macOS copy command after export.

## Bug Report Result

Verdict: `PASS`

The app exports `darkquest_operator_bug_report.json` through `buildOperatorBugReport`. Gate 1F generated a sample report at:

```text
runs/darkquest_operator_bug_report.sample.json
```

The runtime safety check rejects forbidden markers such as raw frames, screenshots, base64 media, audio, OCR, notebook text, API keys, model responses, and cloud evidence.

## Event-Sequence Inspector Result

Verdict: `PASS`

The inspector reports:

- required event order
- present/missing status
- matched event id
- confidence
- payload summary

Runtime check passed for the six required Focus Ritual symbolic events.

## Dry-Run / Physical Separation Result

Verdict: `PASS`

Gate 1F generated:

```text
runs/dev/gate-1f-dry-run-export.json
```

The dry-run fixture has:

- `dev_dry_run: true`
- `manual_fixture: true`
- `physical_capture: false`
- `operator_confirmed_physical_session: false`

The physical validator rejects it. It cannot satisfy Gate 1C.

## Validation Command UX Result

Verdict: `PASS`

Exact validation commands are kept behind export state in the UI. After export, the user can copy validation commands and run:

```sh
npm run physical:validate
npm run gate:1c
```

## App Source Readiness Result

Verdict: `PASS`

Command:

```sh
npm run gate:1f
```

Latest result:

```text
TRACE_EXPORT_GUIDED Gate 1F operator readiness check
checks: 77/77
physical trace: missing
```

## Physical Trace Status

Verdict: `BLOCKED_MISSING_PHYSICAL_TRACE`

The required physical fixture is still missing. This is expected and correct until the operator completes the browser run and saves the exported file at the required path.

## Final Verdict

`TRACE_EXPORT_GUIDED`

Gate 1C remains blocked. HUD polish remains blocked.
