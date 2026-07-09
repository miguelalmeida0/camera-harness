# Gate 1C Rerun Checklist

## Required Artifact

- [ ] Physical fixture exists at `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`
- [ ] `trace_origin.source` is `browser.local_camera`
- [ ] `trace_origin.generated_by` is `browser-local-capture`
- [ ] `trace_origin.capture_mode` is `physical_webcam_manual_calibration`
- [ ] `trace_origin.physical_capture` is `true`
- [ ] `trace_origin.operator_confirmed_physical_session` is `true`
- [ ] `trace_origin.manual_fixture` is `false`
- [ ] `trace_origin.raw_media_persisted` is `false`
- [ ] `trace_origin.cloud_calls_enabled` is `false`
- [ ] `trace_origin.browser_latency_recorded` is `true`
- [ ] Browser latency records exist
- [ ] No raw media
- [ ] No model calls

## Commands

- [ ] Run full physical verification when the trace exists: `npm run verify:physical`
- [ ] Run physical validator: `npm run physical:validate`
- [ ] Replay physical fixture 3 times: `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json`
- [ ] Run Gate 0B: `npm run gate:0b`
- [ ] Run Gate 1A: `npm run gate:1a`
- [ ] Run Gate 1B: `npm run gate:1b`
- [ ] Run Gate 1C: `npm run gate:1c`
- [ ] Run adapter tests: `npm run test:adapter`
- [ ] Run recorder tests: `npm run test:recorder`
- [ ] Run typecheck: `npm run typecheck`

## Follow-Up

- [ ] Check static waiver if package-local TypeScript remains unavailable
- [ ] Update `docs/evals/gate-1C-local-operator-validation-report.md`
- [ ] Update `docs/evals/gate-1C-results.md`
- [ ] Update `docs/evals/minimal-hud-polish-approval.md`

## Approval Boundary

- [ ] Minimal HUD polish remains blocked unless Gate 1C is `PASS` or `PASS_WITH_DISCLOSURE`
- [ ] Cinematic HUD polish remains blocked
- [ ] Physical trace cannot be waived
- [ ] TypeScript waiver alone is insufficient while the physical trace is missing
