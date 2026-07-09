# Gate 1C Local Operator Command Contract

The operator path is local-only and symbolic-only:

```text
npm run physical:capture
operator saves browser download as fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run physical:validate
npm run gate:1c
```

## `npm run physical:capture`

What it does: starts the local browser capture launcher at `http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html`.

Expected inputs: a real physical desk, browser webcam permission with video only, manual calibration, and physical execution of the Focus Ritual.

Expected outputs: an operator-downloaded replay fixture saved as `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.

Forbidden behavior: persisting raw video, raw frames, screenshots, audio, OCR, notebook text, base64 media, or invoking LLM/VLM/cloud services.

Success condition: the operator can complete capture and export the replay fixture with physical confirmation.

Failure condition: camera unavailable, operator does not confirm a physical session, raw media appears, cloud/model path appears, or no replay fixture is exported.

## Legacy `npm run physical:export`

What it does: converts `runs/live/physical-symbolic-observations.json` into `fixtures/replay/live/live_physical_focus_ritual_001.v0.json` with physical provenance.

Gate 1D does not require this command because the browser app now downloads the replay fixture directly.

Expected inputs: `runs/live/physical-symbolic-observations.json` and the built-in `--operator-confirmed` flag.

Expected outputs: `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.

Forbidden behavior: accepting missing `trace_origin`, wrong generator, wrong capture mode, missing latency records, nonzero model calls, raw media fields, or unconfirmed operator sessions.

Success condition: the physical replay fixture is written with `generated_by=browser-local-capture`, `capture_mode=physical_webcam_manual_calibration`, `physical_capture=true`, and `operator_confirmed_physical_session=true`.

Failure condition: exporter refuses the trace or does not write the required fixture.

## `npm run physical:validate`

What it does: runs the eval physical validator for `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`.

Expected inputs: the required physical fixture.

Expected outputs: `runs/physical-validate-latest.json` and a terminal verdict.

Forbidden behavior: accepting a missing fixture, fake physical provenance, raw media persistence, cloud/model calls, missing latency records, or synthetic browser substitution.

Success condition: `final_verdict` is `PASS`.

Failure condition: `final_verdict` is `FAIL` or `BLOCKED_MISSING_PHYSICAL_TRACE`.

## `npm run gate:1c`

What it does: runs the full Gate 1C manifest, including required physical trace, regression fixtures, and adversarial fixtures.

Expected inputs: `fixtures/replay/gate_1c_manifest.json` and all referenced fixtures.

Expected outputs: `runs/gate-1c-latest.json`.

Forbidden behavior: passing with missing physical trace, broad failure-code matches, hidden uncertainty, raw media persistence, unexpected model calls, or replay nondeterminism.

Success condition: `final_verdict` is `PASS` or accepted `PASS_WITH_DISCLOSURE`.

Failure condition: `final_verdict` is `BLOCKED_MISSING_PHYSICAL_TRACE`, `BLOCKED_STATIC_VALIDATION`, or `FAIL`.
