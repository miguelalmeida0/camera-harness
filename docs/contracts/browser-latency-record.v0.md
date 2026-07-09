# Browser Latency Record v0

## Purpose

Gate 1B must measure browser-local perception latency instead of assuming it. This record proves the local hot path is bounded and observable.

## Schema

```json
{
  "schema": "darkquest.browser_latency_record.v0",
  "trace_id": "",
  "frame_count": 0,
  "event_count": 0,
  "dropped_frames": 0,
  "metrics": {
    "frame_capture_ms": { "p50": 0, "p95": 0, "max": 0 },
    "observation_extraction_ms": { "p50": 0, "p95": 0, "max": 0 },
    "adapter_ms": { "p50": 0, "p95": 0, "max": 0 },
    "stabilizer_ms": { "p50": 0, "p95": 0, "max": 0 },
    "event_emission_ms": { "p50": 0, "p95": 0, "max": 0 },
    "hud_update_ms": { "p50": 0, "p95": 0, "max": 0 },
    "trace_recorder_ms": { "p50": 0, "p95": 0, "max": 0 },
    "end_to_end_local_path_ms": { "p50": 0, "p95": 0, "max": 0 }
  },
  "counts": {
    "uncertainty_events": 0,
    "scene_reset_events": 0,
    "llm_calls": 0,
    "vlm_calls": 0,
    "raw_media_persistence": 0
  }
}
```

For exported replay fixture v0 compatibility, Gate 1B accepts two latency shapes:

- `metrics.browser_latency`: compact summary used by the current harness.
- `metrics.browser_latency_records`: per-event records that the harness aggregates.

The detailed `darkquest.browser_latency_record.v0` object may be mirrored under `metrics.browser_latency_record` for richer diagnostics, but the current Gate 1B runner checks the compact summary or per-event record list.

Compact fixture summary:

```json
{
  "metrics": {
    "browser_latency": {
      "frame_capture_ms": 8,
      "observation_extraction_ms": 18,
      "adapter_ms": 3,
      "stabilizer_ms": 6,
      "event_emission_ms": 2,
      "hud_update_ms": 10,
      "trace_recorder_ms": 4,
      "p50_end_to_end_ms": 48,
      "p95_end_to_end_ms": 96,
      "max_end_to_end_ms": 130,
      "sample_count": 120,
      "dropped_frames": 0,
      "llm_calls": 0,
      "vlm_calls": 0,
      "raw_media_persistence_count": 0
    }
  }
}
```

## Required Fields

| Field | Rule |
| --- | --- |
| `schema` | Must equal `darkquest.browser_latency_record.v0`. |
| `trace_id` | Must match the browser trace or fixture trace reference. |
| `frame_count` | Non-negative integer. |
| `event_count` | Non-negative integer. |
| `dropped_frames` | Non-negative integer. |
| `metrics.*.p50` | Non-negative number. |
| `metrics.*.p95` | Non-negative number and `>= p50`. |
| `metrics.*.max` | Non-negative number and `>= p95`. |
| `counts.llm_calls` | Must be `0` for Gate 1B. |
| `counts.vlm_calls` | Must be `0` for Gate 1B. |
| `counts.raw_media_persistence` | Must be `0` for Gate 1B. |

## Suggested Thresholds

| Metric | Threshold |
| --- | ---: |
| `end_to_end_local_path_ms.p50` | `<= 75` |
| `end_to_end_local_path_ms.p95` | `<= 150` |
| `end_to_end_local_path_ms.max` | `<= 300` |
| `llm_calls` | `0` |
| `vlm_calls` | `0` |
| `raw_media_persistence` | `0` |

Exceeding p50/p95/max thresholds may be a disclosure if replay/privacy/model safety passes. Nonzero model calls or raw media persistence are release-blocking failures.

## Measurement Points

- `frame_capture_ms`: camera frame acquisition to local processing availability.
- `observation_extraction_ms`: local feature/manual mapping to `LocalObservationFrame`.
- `adapter_ms`: adapter validation and v0 event conversion.
- `stabilizer_ms`: temporal smoothing and event stabilization.
- `event_emission_ms`: stable event publication.
- `hud_update_ms`: accepted symbolic state to HUD render update.
- `trace_recorder_ms`: event append and fixture-ready serialization work.
- `end_to_end_local_path_ms`: frame capture to symbolic event/HUD availability.

## Blocking Rules

Gate 1B blocks if:

- browser-generated trace has no latency record;
- latency record schema is invalid;
- `llm_calls`, `vlm_calls`, or `raw_media_persistence` is nonzero;
- latency metrics are absent or not numeric;
- p95/max values are omitted to hide spikes.
