# Gate 1D Final Handoff

Current Gate 1D source status: `TRYABLE_WITH_MANUAL_CONFIRMATION`.

Current Gate 1D operational status: `NEEDS_USER_PHYSICAL_RUN`.

Source-level controls are present, and `npm run gate:1d` reports `67/67` checks passing. Local browser usability has not been verified from the sandbox because localhost binding is blocked with `EPERM`.

## To Multimodal Perception & Interface Researcher

Implement or fix whatever makes camera-only behavior happen in the user's local browser.

Required:

- ensure all controls are present and visible;
- ensure `Start Camera` works with video only;
- ensure `Stop Camera` works;
- ensure `Calibrate Zones` opens or reveals the calibration UI;
- ensure `Save Calibration` updates quest state and emits symbolic calibration events;
- ensure `Start Focus Ritual` updates objective and quest state;
- ensure `Start Recording` and `Stop Recording` work;
- ensure manual confirmation buttons exist for all ritual steps;
- ensure each manual confirmation updates quest state and event timeline;
- ensure the app gives clear next-step instructions;
- ensure export works;
- ensure validation commands are visible and copyable;
- ensure no raw media is persisted;
- ensure no LLM/VLM call is made;
- ensure manual confirmation is disclosed and never described as automatic CV.

Do not start cinematic polish. Do not start minimal HUD polish. Do not make portfolio or demo claims.

## To Harness, Evaluation, Memory & Safety Researcher

Verify source-level Gate 1D readiness and then verify a real exported trace.

Required:

- run source-level checks for controls and export builder;
- verify the manual checklist against the browser app;
- verify exported trace shape;
- verify `trace_origin.manual_local_confirmation_used=true` when manual controls are used;
- verify evidence uses `human_correction` or `local_signal`;
- verify all evidence has `contains_raw_media=false`;
- verify no raw video, raw frame, screenshot, audio, OCR, notebook text, base64 media, or media path exists;
- verify no LLM/VLM calls;
- run `npm run physical:validate`;
- run `npm run gate:1c`;
- keep Gate 2 locked.

## Product Owner Decision Rule

Move operational Gate 1D to `TRYABLE_WITH_MANUAL_CONFIRMATION` only after the user confirms they can operate the full local flow.

Move operational Gate 1D to `TRACE_EXPORT_WORKING` only after a trace downloads and validation gives a concrete result.

Do not move Gate 2 until Gate 1C passes or receives an allowed disclosure.
