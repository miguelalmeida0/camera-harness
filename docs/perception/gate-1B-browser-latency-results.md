# Gate 1B Browser Latency Results

## Source

- Fixture: `fixtures/replay/live/live_browser_focus_ritual_001.v0.json`
- Report: `runs/gate-1b-latest.json`
- Capture mode: `manual_calibration_browser_live`
- Trace origin: `browser.local_camera`
- Raw media persisted: `false`
- Cloud calls enabled: `false`

## Result

The browser-origin symbolic fixture reports browser latency records under `metrics.browser_latency_records` and summary values under `metrics.p50_latency_ms`, `metrics.p95_latency_ms`, and `metrics.max_latency_ms`.

| Metric | Observed | Threshold | Result |
| --- | ---: | ---: | --- |
| p50 local path latency | 45ms | <= 75ms | PASS |
| p95 local path latency | 51ms | <= 150ms | PASS |
| max local path latency | 51ms | <= 300ms | PASS |
| sample count | 13 | > 0 | PASS |
| dropped frames | 0 | disclose if nonzero | PASS |
| LLM calls | 0 | 0 | PASS |
| VLM calls | 0 | 0 | PASS |
| raw media persistence count | 0 | 0 | PASS |

## Disclosure

These latency records are generated from the browser-local symbolic observation path and replayed deterministically. A physical browser webcam session was not opened inside this Codex environment, so Gate 1B remains `PASS_WITH_DISCLOSURE` rather than full `PASS`.

The next hardware run should start with `npm run physical:capture`, export a fresh trace from `packages/perception/browser-local-capture/prototype/index.html`, then replay it through `darkquest-eval`.
