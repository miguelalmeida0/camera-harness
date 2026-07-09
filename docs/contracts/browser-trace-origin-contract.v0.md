# Browser Trace Origin Contract v0

## Purpose

This contract distinguishes real browser-local camera traces from hand-authored or synthetic fixtures. Gate 1B requires browser-generated traces to prove their origin, privacy posture, and browser latency measurement status.

## Required Metadata

Browser-generated trace artifacts must include this metadata:

```json
{
  "trace_origin": {
    "source": "browser.local_camera",
    "raw_media_persisted": false,
    "cloud_calls_enabled": false,
    "manual_fixture": false,
    "generated_by": "live-perception-adapter",
    "capture_mode": "manual_calibration_browser_live",
    "browser_latency_recorded": true
  }
}
```

For exported Gate 1B `darkquest.replay_fixture.v0` files, store this object as top-level `trace_origin`.

Gate 1B configures replay-fixture v0 compatibility mode to allow this one top-level extension. The runner validates `fixture.trace_origin` directly so browser traces cannot hide origin metadata inside optional metrics.

Compatibility readers may mirror the object at `metrics.trace_origin`, but that mirror is not sufficient for Gate 1B PASS.

Example fixture shape:

```json
{
  "schema": "darkquest.replay_fixture.v0",
  "trace_origin": {
    "source": "browser.local_camera",
    "raw_media_persisted": false,
    "cloud_calls_enabled": false,
    "manual_fixture": false,
    "generated_by": "live-perception-adapter",
    "capture_mode": "manual_calibration_browser_live",
    "browser_latency_recorded": true
  }
}
```

## Field Rules

| Field | Required value | Rule |
| --- | --- | --- |
| `source` | `browser.local_camera` | Required for Gate 1B browser traces. |
| `raw_media_persisted` | `false` | `true` is release-blocking. |
| `cloud_calls_enabled` | `false` | `true` is release-blocking. |
| `manual_fixture` | `false` | Hand-authored fixtures may not pretend to be browser-generated. |
| `generated_by` | `live-perception-adapter` | Identifies the symbolic adapter path. |
| `capture_mode` | `manual_calibration_browser_live` | First Gate 1B capture mode. |
| `browser_latency_recorded` | `true` | Browser traces must include browser latency records. |

## Rules

- Hand-authored fixtures may not set `source: "browser.local_camera"`.
- Browser-generated traces must include browser latency records.
- Browser-generated traces must still validate as `darkquest.replay_fixture.v0`.
- If trace origin is missing in a Gate 1B browser fixture, Gate 1B blocks or fails.
- If `raw_media_persisted` is `true`, Gate 1B fails.
- If `cloud_calls_enabled` is `true`, Gate 1B fails.
- If `manual_fixture` is `true` on a required browser trace, Gate 1B blocks because the trace is not browser-generated.

## Failure Codes

Recommended Gate 1B failure codes:

- `browser_trace_origin_missing`
- `manual_fixture_claimed_browser`
- `browser_latency_missing`
- `raw_media_persistence_violation`
- `unexpected_model_call`

## Compatibility Note

Do not add additional top-level browser metadata to `darkquest.replay_fixture.v0` until the replay fixture schema is promoted. Gate 1B allows only `trace_origin` as a compatibility extension, and the runner must continue to reject unrelated unknown top-level fields.
