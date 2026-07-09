# Gate 1B Browser Latency Thresholds

## Required Metrics

Every browser-origin Gate 1B fixture must provide `metrics.browser_latency` with:

- `frame_capture_ms`
- `observation_extraction_ms`
- `adapter_ms`
- `stabilizer_ms`
- `event_emission_ms`
- `hud_update_ms`
- `trace_recorder_ms`
- `p50_end_to_end_ms`
- `p95_end_to_end_ms`
- `max_end_to_end_ms`
- `dropped_frames`
- `event_count`
- `uncertainty_count`
- `scene_reset_count`
- `llm_calls`
- `vlm_calls`
- `raw_media_persistence_count`

The runner accepts either the verbose names above or this compact summary:

```json
{
  "metrics": {
    "browser_latency": {
      "p50_ms": 42,
      "p95_ms": 88,
      "max_ms": 131,
      "sample_count": 120,
      "dropped_frames": 0,
      "llm_calls": 0,
      "vlm_calls": 0,
      "raw_media_persistence_count": 0
    }
  }
}
```

Detailed sample records may be provided as `metrics.browser_latency_records`; the runner aggregates `end_to_end_ms` samples into p50, p95, max, and sample count.

## Thresholds

| Metric | Threshold |
| --- | ---: |
| `p50_end_to_end_ms` | `<= 75` |
| `p95_end_to_end_ms` | `<= 150` |
| `max_end_to_end_ms` | `<= 300` |
| `llm_calls` | `0` |
| `vlm_calls` | `0` |
| `raw_media_persistence_count` | `0` |

Dropped frames are allowed only as a disclosure until a product latency target is set. A nonzero value must appear in the Gate 1B report.

## Verdict Impact

- Missing browser latency metrics: `BLOCKED_MISSING_BROWSER_TRACE` if the browser trace is missing, otherwise `PASS_WITH_DISCLOSURE` at best.
- Threshold miss for p50, p95, max latency, model calls, or raw media persistence: `FAIL`.
- Nonzero dropped frames with other metrics in range: `PASS_WITH_DISCLOSURE`.
