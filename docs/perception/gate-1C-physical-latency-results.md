# Gate 1C Physical Latency Results

## Status

`BLOCKED`

Actual physical browser webcam latency has not been measured in this environment because no physical webcam session was executed.

## Required Metrics

The physical trace must record:

- frame capture time
- observation extraction time
- adapter time
- stabilizer time
- event emission time
- HUD update time
- trace recorder time
- p50 end-to-end local path latency
- p95 end-to-end local path latency
- max end-to-end local path latency
- dropped frames
- event count
- uncertainty count
- scene reset count
- LLM call count
- VLM call count
- raw media persistence count

## Thresholds

| Metric | Threshold |
| --- | ---: |
| p50 local path latency | <= 75 ms |
| p95 local path latency | <= 150 ms |
| max local path latency | <= 300 ms |
| LLM calls | 0 |
| VLM calls | 0 |
| raw media persistence count | 0 |

## Current Non-Physical Baseline

Gate 1B browser-origin symbolic baseline:

- p50: 45ms
- p95: 51ms
- max: 51ms
- samples: 13
- dropped frames: 0
- LLM calls: 0
- VLM calls: 0
- raw media persistence count: 0

This baseline is not a substitute for Gate 1C physical latency.

## Missing Input

`fixtures/replay/live/live_physical_focus_ritual_001.v0.json` with `metrics.browser_latency_records`.

## Latest Report

`runs/gate-1c-latest.json`

Current evaluated physical fixture count: `0`.
