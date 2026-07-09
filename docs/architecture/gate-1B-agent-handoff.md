# Gate 1B Agent Handoff

## Handoff To Multimodal Perception And Interface Researcher

Gate 1B connects real browser-local observation frames to the existing symbolic adapter and replay harness. Do not build cinematic HUD polish.

Browser trace origin contract:

- use `docs/contracts/browser-trace-origin-contract.v0.md`;
- browser-generated replay fixtures must include top-level `trace_origin`;
- `source` must be `browser.local_camera`;
- `raw_media_persisted` must be `false`;
- `cloud_calls_enabled` must be `false`;
- `manual_fixture` must be `false`;
- browser latency must be present under `metrics.browser_latency` or `metrics.browser_latency_records`.

Browser frame lifetime policy:

- frames may exist only in browser memory during local processing;
- no frame serialization, screenshots, logs, storage, backend upload, LLM/VLM route, or memory write;
- trace exports contain symbolic events only.

Recovery architecture:

- occlusion emits `scene.uncertain`, HUD shows recovery, quest holds state, no model call;
- tracking resume emits `confidence.changed` or valid stable event;
- camera bump emits `scene.reset`, invalidates calibration, HUD shows recalibration required, no stale zone truth.

Browser latency record schema:

- store the compact record under `metrics.browser_latency` in exported replay fixtures;
- detailed sample records may also be provided under `metrics.browser_latency_records`;
- accepted summary names are `p50_ms`, `p95_ms`, `max_ms` or `p50_end_to_end_ms`, `p95_end_to_end_ms`, `max_end_to_end_ms`;
- counts for LLM calls, VLM calls, and raw media persistence must be zero.

Static/build requirements:

- run `node --check packages/evals/bin/darkquest-eval.mjs`;
- run replay and Gate 0B/Gate 1A suites;
- run TypeScript compile when local dependencies exist;
- if TypeScript compile cannot run, Gate 1B is `PASS_WITH_DISCLOSURE` maximum.

Minimal HUD approval boundaries:

- polish may start only after Gate 1B browser trace passes or is explicitly disclosed;
- allowed: layout, typography, confidence bands, timeline, recovery styling, state-backed animation;
- forbidden: fake progress, hidden uncertainty, cloud-intelligence implication, raw frame artifacts.

## Handoff To Harness, Evaluation, Memory And Safety Researcher

Gate 1B acceptance rules:

- required browser-origin Focus Ritual trace exists;
- trace validates as `darkquest.replay_fixture.v0`;
- every event validates against `event-schema.v0.md`;
- trace origin metadata exists and proves browser-local source;
- browser latency record exists;
- raw media persistence count is zero;
- LLM/VLM calls are zero;
- replay is deterministic across three runs;
- HUD honesty checks pass;
- memory writes are evidence-backed or absent.

Trace origin validation requirements:

- fail or block when top-level `trace_origin` is missing;
- fail when `source != "browser.local_camera"`;
- fail when `raw_media_persisted == true`;
- fail when `cloud_calls_enabled == true`;
- block when `manual_fixture != false` for a required browser trace;
- fail when browser latency is not recorded.

Browser latency validation requirements:

- `metrics.browser_latency` exists with numeric p50/p95/max local-path values, or detailed `metrics.browser_latency_records` exist for aggregation;
- p50/p95/max values exist and are numeric;
- p50 `<= 75ms`, p95 `<= 150ms`, max `<= 300ms`;
- nonzero dropped frames are disclosed;
- nonzero model calls or raw media persistence fail.

Recovery fixture expectations:

- browser occlusion recovery fixture should emit `scene.uncertain`, show HUD recovery, hold quest state, then resume with confidence or stable event;
- browser camera bump/reset fixture should emit `scene.reset`, require recalibration, and prevent stale zone progress;
- both fixtures must replay without model calls or raw media persistence.

Static/build disclosure rules:

- if TypeScript compile is unavailable, Gate 1B can be `PASS_WITH_DISCLOSURE` at best;
- if TypeScript compile runs and fails, Gate 1B fails;
- runtime Node 26 type stripping is not a substitute for full static validation.

Zero-model-call rule:

- no LLM/VLM calls from browser capture;
- no LLM/VLM calls from adapter;
- no LLM/VLM calls from quest engine;
- no LLM/VLM calls from HUD;
- no cloud fallback for occlusion or camera bump;
- any model call is release-blocking.

Recommended validation commands:

```sh
node --check packages/evals/bin/darkquest-eval.mjs
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/focus_ritual_happy_path.v0.json
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1a fixtures/replay/gate_1a_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1b fixtures/replay/gate_1b_manifest.json
```
