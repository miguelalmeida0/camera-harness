# Gate 1D Prototype Source Audit

## Scope

Audit date: July 8, 2026

Files audited:

- `packages/perception/browser-local-capture/prototype/index.html`
- `packages/perception/browser-local-capture/prototype/local-capture.js`
- `packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs`
- `packages/replay/live-trace-recorder/scripts/export-physical-trace.mjs`
- `packages/replay/live-trace-recorder/scripts/validate-physical-trace.mjs`
- `package.json`

Automated source verifier:

```sh
npm run gate:1d
```

Latest automated source verdict: `TRYABLE_WITH_MANUAL_CONFIRMATION`

## index.html

Purpose: Browser UI for Gate 1D local physical capture.

Required features present:

- camera preview
- Start Camera and Stop Camera controls
- Reset Session control
- Calibration Panel
- zone geometry form container
- object assignment form container
- Save Calibration control
- Start Focus Ritual control
- Start/Stop Recording controls
- five manual ritual confirmation controls
- uncertainty/reset controls
- Export Physical Trace control
- physical session confirmation checkbox
- quest state panel
- current objective
- active zone
- last 10 symbolic events panel
- confidence panel
- recording status
- privacy status
- model-call status
- latency panel
- export status
- validation next steps
- Copy Validation Commands control
- troubleshooting panel

Missing features:

- no automated browser test proving camera permission and download behavior in this environment

Privacy/model risks:

- no raw media persistence UI path observed
- no model-call controls observed
- manual confirmation is visible and labeled

Gate 1D blocker:

- not blocked at source level
- still requires local operator checklist completion

Required fix:

- run the browser checklist outside the sandbox and record results

## local-capture.js

Purpose: Browser-side state machine for calibration, manual confirmations, symbolic events, quest progress, export readiness, and replay fixture generation.

Required features present:

- required zone names
- required object names
- calibration state
- manual confirmation event emission
- quest state transitions
- uncertainty/reset handlers
- timeline rendering with last 10 events
- privacy/model/cost status rendering
- trace origin generation
- Gate 1C-compatible replay fixture generation
- latency record generation
- no raw media export APIs found by Gate 1D source check
- no model-call hooks found by Gate 1D source check

Missing features:

- no proof of autonomous local vision; manual confirmation is the tryable path

Privacy/model risks:

- manual confirmation must not be marketed as automatic vision
- physical provenance relies on visible operator confirmation

Gate 1D blocker:

- not blocked at source level

Required fix:

- complete operator checklist and export a fixture

## physical-capture-launcher.mjs

Purpose: Local static server for the browser capture prototype.

Required features present:

- serves prototype from localhost
- prints local URL
- states cloud services are disabled
- states LLM/VLM keys are not required
- states raw media persistence is disabled
- prints next validation commands

Missing features:

- launch could not be verified in the sandbox because binding `127.0.0.1:4177` returned `EPERM`

Privacy/model risks:

- no cloud/model hook observed

Gate 1D blocker:

- not source-blocking, but operator must launch locally

Required fix:

- run `npm run physical:capture` in the user environment and record whether the URL opens

## export-physical-trace.mjs

Purpose: Converts exported symbolic browser observations into the required physical replay fixture when using the observations export path.

Required features present:

- requires `--operator-confirmed`
- rejects missing `trace_origin`
- rejects raw media markers
- rejects model calls
- requires browser latency records
- outputs `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`

Missing features:

- not needed if the browser directly exports the replay fixture, but remains useful as a guarded conversion path

Privacy/model risks:

- rejects raw media, screenshots, audio, base64, OCR, and notebook text markers

Gate 1D blocker:

- not blocked at source level

Required fix:

- run only after a real operator-confirmed physical session

## validate-physical-trace.mjs

Purpose: Validates the exported physical replay fixture.

Required features present:

- checks fixture exists
- checks valid JSON by parsing
- checks `trace_origin`
- checks physical capture confirmation
- checks operator confirmation
- checks generator and capture mode
- checks no raw media markers
- checks no model calls
- checks unique event IDs
- checks monotonic timestamps
- checks full Focus Ritual event sequence
- checks browser latency records
- runs replay repeat 3 when the fixture exists and static checks pass

Missing features:

- cannot pass until `fixtures/replay/live/live_physical_focus_ritual_001.v0.json` exists

Privacy/model risks:

- none observed in validator; it is a blocking safety check

Gate 1D blocker:

- physical validation currently blocks because the physical fixture is missing

Required fix:

- export the physical fixture, then run `npm run physical:validate`

Latest status:

- source-generated Gate 1D fixture replayed 3 times successfully
- real physical fixture remains missing

## package.json scripts

Purpose: Local command surface for tests, gates, physical capture, export, validation, and typecheck.

Required features present:

- `gate:1d`
- `physical:capture`
- `physical:export`
- `physical:validate`
- `gate:1c`
- `test:adapter`
- `test:recorder`
- `typecheck`

Missing features:

- none at source-script level

Privacy/model risks:

- none observed

Gate 1D blocker:

- not blocked at script level

Required fix:

- run the operator/browser checklist and record the trace validation outcome
