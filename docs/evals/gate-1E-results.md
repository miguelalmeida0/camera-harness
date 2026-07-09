# Gate 1E Results

## Claim Being Tested

The local browser prototype is not merely source-present. It has the required controls, guarded operator flow, manual confirmation disclosure, export preflight, validation UX, privacy/model status visibility, and dev dry-run export checks needed for a user to safely attempt a real physical Focus Ritual trace.

Gate 1E does not approve HUD polish, cinematic polish, portfolio claims, or Gate 1C. A dev dry-run export is replay-compatible evidence for the harness only; it is not physical evidence.

## Source Readiness

Verdict: `PASS`

Evidence:

- `npm run gate:1e`
- `runs/gate-1e-latest.json`
- source files present:
  - `packages/perception/browser-local-capture/prototype/index.html`
  - `packages/perception/browser-local-capture/prototype/local-capture.js`
  - `packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs`
  - `packages/replay/live-trace-recorder/scripts/export-physical-trace.mjs`
  - `packages/replay/live-trace-recorder/scripts/validate-physical-trace.mjs`

Latest result:

```text
TRACE_EXPORT_READY Gate 1E readiness check
checks: 82/82
physical trace: missing
```

## Wizard Readiness

Verdict: `PASS`

Required stages found:

- Camera
- Calibration
- Quest Setup
- Recording
- Focus Ritual
- Export
- Validation

The checker verifies next-step guidance, disabled reason text, error banner rendering, and troubleshooting panel source.

## Controls Readiness

Verdict: `PASS`

All required controls were found by source check:

- Start Camera
- Stop Camera
- Calibrate Zones
- Save Calibration
- Start Focus Ritual
- Start Recording
- Confirm Phone Moved
- Confirm Notebook Opened
- Confirm Pen Picked Up
- Confirm Writing Motion
- Confirm Typing Motion
- Mark Uncertain
- Mark Camera Reset
- Stop Recording
- Export Physical Trace
- Reset Session
- Copy Validation Commands

## Calibration Readiness

Verdict: `PASS`

The app exposes symbolic zone geometry and object assignments only. Required zones are present: `phone_zone`, `notebook_zone`, `pen_zone`, `keyboard_zone`, `neutral_zone`, and `off_desk_zone`.

No screenshots, raw frames, or audio are stored by the calibration flow.

## Quest Reducer Readiness

Verdict: `PASS`

The source flow emits replay-compatible symbolic events for the six Focus Ritual steps and replays deterministically through the harness with 6/6 stable events, 6/6 quest transitions, and 6/6 HUD commands.

Manual confirmation remains disclosed as manual confirmation. This is not autonomous local vision.

## Recording And Export Readiness

Verdict: `PASS`

Gate 1E verifies:

- export is blocked before the ritual is complete
- export is blocked before physical confirmation is checked
- export preflight functions exist
- `trace_origin` is generated
- browser latency records exist
- `expected.model_calls` is empty
- `expected.memory_writes` is empty
- `metrics.max_llm_calls`, `metrics.max_vlm_calls`, and `metrics.max_cost_usd` are zero
- validation commands are shown after export

Generated harness artifacts:

- `runs/gate-1e-source-fixture.v0.json`
- `runs/dev/gate-1d-dry-run-export.json`

## Validation UX Readiness

Verdict: `PASS`

The app surfaces validation next steps after export and includes `Copy Validation Commands`. The operator-facing readiness and failure diagnostics are now documented in:

- `docs/evals/local-app-readiness-report.md`
- `docs/evals/local-app-failure-diagnostics.md`

## Privacy And Model Readiness

Verdict: `PASS`

Visible app status:

- raw media persistence: `false`
- cloud fallback: `disabled`
- LLM calls: `0`
- VLM calls: `0`
- estimated model cost: `$0`

Source scan found no model-call hooks and no raw media export APIs in the prototype.

## Manual Confirmation Disclosure

Verdict: `PASS`

The UI labels manual local confirmation as manual and not automatic vision. The exported dry-run evidence uses `human_correction` evidence with `contains_raw_media: false`.

Manual confirmation can support a tryable local app. It cannot support autonomous vision claims or Gate 1C approval by itself.

## Dev Dry-Run Export Check

Verdict: `PASS`

Command:

```sh
npm run dev:trace:validate
```

Result:

```text
DEV_TRACE_VALID dev dry-run trace validation
gate_1c_satisfiable=false
```

Required dev dry-run provenance is present:

- `dev_dry_run: true`
- `manual_fixture: true`
- `physical_capture: false`
- `operator_confirmed_physical_session: false`

The physical validator rejects the dry-run artifact with provenance failures, including `dev_dry_run_invalid`.

## Physical Trace Status

Verdict: `BLOCKED_MISSING_PHYSICAL_TRACE`

The required physical fixture is still missing:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

This is the correct safety block. Gate 1C remains blocked until the operator runs the local app, exports the physical symbolic trace, saves it at the required path, and passes validation.

## Commands Run

```sh
npm run gate:1d
npm run gate:1e
npm run dev:trace:validate
npm run physical:validate
npm run gate:1c
npm run test:adapter
npm run test:recorder
npm run typecheck
node --check packages/evals/bin/darkquest-eval.mjs
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1a fixtures/replay/gate_1a_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1b fixtures/replay/gate_1b_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1c fixtures/replay/gate_1c_manifest.json
```

## Result

- Gate 1D: `TRYABLE_WITH_MANUAL_CONFIRMATION`
- Gate 1E: `TRACE_EXPORT_READY`
- Dev dry-run validation: `DEV_TRACE_VALID`, `gate_1c_satisfiable=false`
- Physical validation: `BLOCKED_MISSING_PHYSICAL_TRACE`
- Gate 1C: `BLOCKED_MISSING_PHYSICAL_TRACE`
- Gate 0B: `PASS`
- Gate 1A: `PASS`
- Gate 1B: `PASS_WITH_DISCLOSURE`
- Adapter tests: `PASS`
- Recorder tests: `PASS`
- Typecheck: `PASS`

## Final Verdict

`TRACE_EXPORT_READY`

Required approval gate before Gate 1C or HUD polish:

1. Run `npm run physical:capture`.
2. Complete the Focus Ritual in the browser with the real desk setup.
3. Export and save the symbolic trace as `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.
4. Run `npm run physical:validate`.
5. Run `npm run gate:1c`.

Minimal HUD polish remains blocked until Gate 1C passes or an explicitly accepted disclosure path is documented.
