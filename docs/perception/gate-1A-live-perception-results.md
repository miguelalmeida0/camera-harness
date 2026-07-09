# Gate 1A Live Perception Results

## Run Summary

| Field | Value |
| --- | --- |
| Date/time | 2026-07-08, local workspace run |
| Machine/browser | Local Node.js harness; browser capture not exercised in this run |
| Fixture/trace name | `live_focus_ritual_001` |
| Frames observed | 12 controlled local observation frames |
| Symbolic events emitted | 12 |
| Replay verdict | PASS |
| Gate 0B regression | PASS |

## Local Path Metrics

| Metric | Result |
| --- | ---: |
| Frame capture time | Not measured; controlled `LocalObservationFrame` input |
| Observation extraction time | Not measured; controlled symbolic input |
| Stabilization time | Local adapter test completed under 1ms observed shell runtime granularity |
| Event emission time | Included in adapter test runtime |
| HUD update time | Not exercised; HUD remains spec-only |
| Replay recorder time | Recorder test completed under 1ms observed shell runtime granularity |
| p50 local path latency | BLOCKED until browser frame timing is connected |
| p95 local path latency | BLOCKED until browser frame timing is connected |
| Max local path latency | BLOCKED until browser frame timing is connected |
| Dropped frames | 0 in controlled trace |
| Event count | 12 |
| Uncertainty count | 0 in happy trace |
| LLM calls | 0 |
| VLM calls | 0 |
| Raw media persistence count | 0 |

## Validation Results

```text
PASS focus_ritual_happy_path_v0
PASS Gate 0B suite
PASS live_focus_ritual_001
```

The live trace fixture replay reported:

- stable events: `12/12`
- quest transitions: `6/6`
- HUD commands: `6/6`
- LLM/VLM calls: `0/0`

## Known Bottlenecks

- Real browser frame capture and observation extraction are not timed yet.
- Debug HUD rendering latency is not measured yet.
- Controlled frames prove the adapter boundary and replay export, not full computer vision quality.

## Gate 1A Performance Verdict

PASS for the symbolic adapter, trace recorder, replay export, and harness compatibility path.

BLOCKED for claiming live browser performance until camera/browser frame timing is connected and measured.

