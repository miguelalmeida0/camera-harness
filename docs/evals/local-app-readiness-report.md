# Local App Readiness Report

## Current Readiness Verdict

`MINIMAL_HUD_POLISH_WITH_DISCLOSURE`

Gate 1F operator hardening is present. Gate 1C is accepted as `PASS_WITH_DISCLOSURE`. The local browser app is ready for a non-agent user to run the physical Focus Ritual flow with minimal state-backed HUD polish and manual confirmation disclosure. It is not approved for cinematic polish, portfolio claims, autonomous vision claims, or production-quality claims.

## Start Command

```sh
npm run physical:capture
```

Default URL:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

Port fallback:

```sh
DARKQUEST_CAPTURE_PORT=4178 npm run physical:capture
```

## What Works

- Gate 2A disclosure banner for minimal HUD polish
- state-backed top status bar, main workspace, event timeline, sequence inspector, and bottom diagnostics
- Operator Mode panel with next action, blocking reason, validation UX, and send-back guidance
- troubleshooting panel with camera, disabled-button, export, save-path, Gate 1C, and port fallback help
- save-path assistant for `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`
- downloaded filename guidance for `live_physical_focus_ritual_001.v0.json`
- copy save path button
- copy validation commands button after export
- optional macOS copy command after export
- event-sequence inspector showing missing/present status, matched event ID, confidence, payload summary, and export blocking status
- bug report export as `darkquest_operator_bug_report.json`
- dev dry-run and physical export separation

## What Does Not Work Yet

- manual confirmation is not autonomous vision
- cinematic HUD polish is still blocked
- portfolio demo claims are still blocked
- production-quality claims are still blocked

## Required Physical Trace Path

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

## Complete Focus Ritual

1. Click `Start Camera`.
2. Click `Calibrate Zones`.
3. Save calibration.
4. Click `Start Focus Ritual`.
5. Click `Start Recording`.
6. Physically perform each ritual step, then click the matching manual confirmation.
7. Click `Stop Recording`.
8. Check the physical session confirmation checkbox.
9. Click `Export Physical Trace`.
10. Save or move the downloaded file to the required physical trace path.

## Validate

```sh
npm run physical:validate
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run gate:1c
```

If broken, send:

- `darkquest_operator_bug_report.json`
- output from `npm run physical:validate`
- output from replay repeat 3
- output from `npm run gate:1c`
- whether the required physical trace path exists

Do not send raw webcam media, audio, screenshots of private notebook text, OCR, notebook text, API keys, model responses, cloud evidence, or encoded media payloads.
