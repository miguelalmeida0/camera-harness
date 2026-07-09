# Gate 1C Physical Trace Anti-Fraud

Gate 1C physical evidence must be a symbolic-only trace exported from a real browser webcam session. A browser-origin synthetic trace, hand-authored fixture, or copied fixture may not substitute for the missing physical capture.

## Reject These Cases

| Case | Required failure code |
| --- | --- |
| Required physical fixture is missing | `physical_trace_missing` |
| `trace_origin` is absent or does not prove `browser.local_camera` | `physical_trace_origin_missing` |
| Physical capture or operator confirmation is absent | `physical_capture_not_confirmed` |
| Fixture is hand-authored or marked manual | `physical_trace_marked_manual` |
| `generated_by` is not `browser-local-capture` | `physical_trace_wrong_generator` |
| `capture_mode` is not `physical_webcam_manual_calibration` | `physical_trace_wrong_capture_mode` |
| Browser latency records are missing | `physical_trace_latency_missing` |
| A browser-origin trace such as `live_browser_focus_ritual_001` is presented as physical | `physical_trace_synthetic_substitution` |
| Raw video, screenshots, base64 media, audio, OCR, notebook text, raw frames, or raw paths appear | `raw_media_persistence_violation` |
| Cloud calls are enabled or any LLM/VLM call appears | `unexpected_model_call` |

## Synthetic Substitution Signatures

The physical checker must reject physical-required fixtures with any browser-origin signature:

- `fixture_id` or descriptive text references `live_browser_focus_ritual_001`.
- Descriptive text says `browser-origin synthetic` or `browser-origin trace`.
- `trace_origin.generated_by` is `live-perception-adapter`.
- `trace_origin.capture_mode` is `manual_calibration_browser_live`.

These signatures are valid for Gate 1B browser-origin regression fixtures only when `physical_capture_required` is `false`.

## Required Negative Fixtures

- `fixtures/replay/live/adversarial/live_physical_trace_missing_origin.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_not_confirmed.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_marked_manual.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_wrong_generator.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_wrong_capture_mode.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_synthetic_substitution.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_latency_missing.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_raw_media.v0.json`
- `fixtures/replay/live/adversarial/live_physical_trace_unexpected_model_call.v0.json`

Each adversarial fixture must fail with exact expected codes in `fixtures/replay/gate_1c_manifest.json`.

## Non-Waivable Rule

Physical trace provenance cannot be waived. TypeScript/static validation may be temporarily waived only after the physical trace passes and only for minimal HUD polish. No waiver may support cinematic polish, production-quality claims, or portfolio demo claims.
