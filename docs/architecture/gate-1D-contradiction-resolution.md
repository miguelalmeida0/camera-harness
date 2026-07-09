# Gate 1D Contradiction Resolution

## Contradiction

The current reports disagree:

- User says only camera works.
- Multimodal Perception & Interface Researcher says the app is tryable.
- Systems/Harness could not verify localhost in the sandbox.

## What Can Be Trusted

- Source-level evidence can be trusted for existence of controls and intended behavior.
- The current source includes camera controls, calibration UI, object assignments, Focus Ritual start, recording controls, manual confirmation buttons, debug HUD state, event timeline, export, and validation next steps.
- `npm run gate:1d` can be trusted as a source-level readiness check and currently reports `TRYABLE_WITH_MANUAL_CONFIRMATION` with `67/67` checks passing.
- Validation commands can be trusted where they do not require a browser or physical webcam.
- Gate 1C can be trusted to remain blocked while the physical fixture is missing.

## What Cannot Be Trusted Yet

- That the app is actually usable in the user's browser.
- That all controls are visible at the user's viewport size.
- That camera permission works on the user's browser.
- That export downloads correctly in the user's browser.
- That the exported trace validates.
- That the user can complete the flow without guessing.

## What Must Be Verified Locally

The contradiction is resolved only by a real local run showing:

- app loaded at the known URL;
- visible controls;
- camera starts;
- calibration saves;
- Focus Ritual starts;
- manual confirmations update quest state and timeline;
- export produces JSON or a clear blocked-export reason;
- validation commands return concrete results.

## Required Evidence

To resolve the contradiction, collect:

- screenshot of app loaded at:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

- screenshot or text list of visible controls;
- exported physical trace file, or the exact blocked export reason shown in `Export Status`;
- terminal output from:

```sh
npm run physical:validate
npm run gate:1c
```

## Exact User Commands

From repo root:

```sh
npm run physical:capture
```

Open:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

After export, save the downloaded file as:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

Then run:

```sh
npm run physical:validate
npm run gate:1c
```

## If Still Broken, Send Back

- The terminal output from `npm run physical:capture`.
- Browser and OS name/version.
- Whether camera permission was granted.
- Screenshot of the loaded app or browser error.
- Screenshot/text of visible controls.
- `Export Status` text.
- `Current Quest State` text.
- `Last 10 Symbolic Events` text after clicking confirmations.
- The exported trace if one downloads.
- Terminal output from `npm run physical:validate`.
- Terminal output from `npm run gate:1c`.

## Decision Rule

If the user can complete the flow and export a trace, Gate 1D can move to `TRACE_EXPORT_WORKING`.

If the user can operate controls but export remains blocked for a clear reason, Gate 1D can move to `TRYABLE_WITH_MANUAL_CONFIRMATION`.

If camera remains the only working feature, Gate 1D remains `NOT_TRYABLE`.
