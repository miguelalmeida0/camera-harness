# Gate 1C Unblock Checklist

Current status: `BLOCKED_MISSING_PHYSICAL_TRACE`.

Gate 1C is unblocked only when the required physical webcam Focus Ritual fixture exists, proves physical provenance, replays deterministically, and preserves the replay/privacy/model/memory/HUD constraints already proven in Gates 0B, 1A, and 1B.

## Required Artifact

- [ ] `fixtures/replay/live/live_physical_focus_ritual_001.v0.json` exists.
- [ ] The fixture is produced from the physical operator flow, not hand-authored.
- [ ] `manual_fixture` is `false`.
- [ ] No browser-origin synthetic fixture is renamed or copied as physical evidence.

## Required `trace_origin`

- [ ] `trace_origin` exists.
- [ ] `trace_origin.source` is `browser.local_camera`.
- [ ] `trace_origin.generated_by` is `browser-local-capture`.
- [ ] `trace_origin.capture_mode` is `physical_webcam_manual_calibration`.
- [ ] `trace_origin.physical_capture` is `true`.
- [ ] `trace_origin.operator_confirmed_physical_session` is `true`.
- [ ] `trace_origin.raw_media_persisted` is `false`.
- [ ] `trace_origin.cloud_calls_enabled` is `false`.
- [ ] `trace_origin.browser_latency_recorded` is `true`.

## Required Privacy And Model State

- [ ] `privacy.contains_raw_video` is `false`.
- [ ] `privacy.contains_audio` is `false`.
- [ ] `privacy.cloud_calls_expected` is `false`.
- [ ] No raw video, frame, image, screenshot, audio, OCR, notebook text, base64 media, or raw media path fields appear.
- [ ] No model calls appear in `input_events`, `expected.model_calls`, latency records, or report output.
- [ ] LLM calls are `0`.
- [ ] VLM calls are `0`.
- [ ] Model cost is `$0`.
- [ ] Raw media persistence count is `0`.

## Required Latency And Replay Evidence

- [ ] `metrics.browser_latency_records` exists and has at least one record.
- [ ] Browser latency records have numeric `end_to_end_ms`.
- [ ] Browser latency records report `llm_calls=0`, `vlm_calls=0`, and `raw_media_persistence_count=0`.
- [ ] Physical replay passes 3 repeated runs.
- [ ] Gate 1C returns `PASS` or accepted `PASS_WITH_DISCLOSURE`.

## Required Closure

- [ ] Gate 0B still passes.
- [ ] Gate 1A still passes or remains accepted `PASS_WITH_DISCLOSURE`.
- [ ] Gate 1B still passes or remains accepted `PASS_WITH_DISCLOSURE`.
- [ ] TypeScript/static status is known.
- [ ] Static waiver is explicitly accepted if package-local TypeScript remains unavailable.
- [ ] Minimal HUD polish decision is recorded.
- [ ] Cinematic HUD polish remains blocked.
