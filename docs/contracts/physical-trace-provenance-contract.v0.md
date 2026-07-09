# Physical Trace Provenance Contract v0

## Purpose

This contract distinguishes a real physical browser webcam session from browser-generated symbolic tests and hand-authored fixtures.

## Required Metadata

Physical Gate 1C replay fixtures must include top-level `trace_origin`:

```json
{
  "trace_origin": {
    "source": "browser.local_camera",
    "raw_media_persisted": false,
    "cloud_calls_enabled": false,
    "manual_fixture": false,
    "generated_by": "browser-local-capture",
    "capture_mode": "physical_webcam_manual_calibration",
    "browser_latency_recorded": true,
    "physical_capture": true,
    "operator_confirmed_physical_session": true
  }
}
```

## Field Rules

| Field | Required value | Rule |
| --- | --- | --- |
| `source` | `browser.local_camera` | Physical trace must come from the browser local camera path. |
| `raw_media_persisted` | `false` | `true` is release-blocking. |
| `cloud_calls_enabled` | `false` | `true` is release-blocking. |
| `manual_fixture` | `false` | Hand-authored fixtures may not claim physical provenance. |
| `generated_by` | `browser-local-capture` | Physical trace must originate at the browser-local capture package. |
| `capture_mode` | `physical_webcam_manual_calibration` | Gate 1C physical capture mode. |
| `browser_latency_recorded` | `true` | Physical traces must include browser latency records. |
| `physical_capture` | `true` | Browser-generated symbolic tests may not claim this. |
| `operator_confirmed_physical_session` | `true` | Requires explicit operator confirmation. |

## Rules

- Hand-authored fixtures may not claim `physical_capture=true`.
- Generated symbolic tests may not claim `operator_confirmed_physical_session=true`.
- Physical traces must include browser latency records.
- Physical traces must remain `darkquest.replay_fixture.v0` compatible.
- If `trace_origin` is missing, Gate 1C blocks.
- If a browser-origin symbolic trace is presented as physical evidence, Gate 1C fails.
- If `physical_capture` is false, Gate 1C blocks.
- If operator confirmation is false, Gate 1C blocks.
- If `generated_by` is not `browser-local-capture`, Gate 1C fails.
- If `capture_mode` is not `physical_webcam_manual_calibration`, Gate 1C fails.
- If a browser-origin symbolic trace claims physical provenance, Gate 1C fails.
- If `raw_media_persisted` is true, Gate 1C fails.
- If `cloud_calls_enabled` is true, Gate 1C fails.

## Failure Codes

- `physical_trace_missing`
- `physical_trace_origin_missing`
- `physical_capture_not_confirmed`
- `physical_trace_marked_manual`
- `physical_trace_wrong_generator`
- `physical_trace_wrong_capture_mode`
- `physical_trace_synthetic_substitution`
- `physical_trace_latency_missing`
- `physical_trace_synthetic_substitution`
- `raw_media_persistence_violation`
- `unexpected_model_call`

## Compatibility

Gate 1C uses the same top-level `trace_origin` compatibility extension allowed by Gate 1B. No other physical provenance field should be added to the top level until the replay fixture schema is promoted.
