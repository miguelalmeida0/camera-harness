# Gate 1B Handoff

## To GAUNTLET / Harness

Gate 1B has an executable manifest:

```sh
node packages/evals/bin/darkquest-eval.mjs gate-1b fixtures/replay/gate_1b_manifest.json
```

Current result is `PASS_WITH_DISCLOSURE`.

The suite verifies:

- browser focus ritual positive fixture passes
- occlusion recovery positive fixture passes
- camera bump/reset positive fixture passes
- browser origin missing fails with `browser_trace_origin_missing`
- browser latency missing fails with `browser_latency_missing`
- browser raw-media claim fails with `raw_media_persistence_violation`
- occlusion quest progress fails with `quest_progress_during_uncertainty`
- stale zone truth after reset fails with `stale_zone_truth_after_reset`
- Gate 1A adversarial checks still fail with exact expected codes

## To AXIOM / Systems Architect

The replay fixture schema remains `darkquest.replay_fixture.v0`. `trace_origin` is optional for older fixtures and required by Gate 1B entries marked `browser_generated: true`.

`LocalObservationFrame.source` now accepts:

- `webcam.local`
- `browser.local_camera`

The v0 stable event surface includes `scene.reset` in both adapter fixture generation and replay stabilization.

## To Memory / Safety

Positive Gate 1B fixtures expect no memory writes and no model calls.

Browser trace privacy posture:

- raw video persisted: `false`
- raw frame persisted: `false`
- audio persisted/requested: `false`
- screenshots/base64 media persisted: `false`
- LLM calls: `0`
- VLM calls: `0`

Any future memory write must be symbolic, evidence-backed, TTL-bound, and never raw-media-backed.

## To PARALLAX

The browser-local capture package exists at:

```text
packages/perception/browser-local-capture/
```

The next physical validation step is to run the browser prototype or app integration with real camera permission, export a fresh symbolic trace, and replay it through Gate 1B. Cinematic HUD polish remains blocked until a real hardware/browser symbolic trace passes or the remaining disclosure is explicitly accepted.
