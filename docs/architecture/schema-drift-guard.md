# Schema Drift Guard

## Decision

Gate 1A must fail fast when live symbolic traces drift from the replay-tested v0 contracts. Schema drift is not a warning; it is a release blocker because it lets live perception bypass Gate 0B assertions.

Protected contracts:

- `docs/contracts/event-schema.v0.md`
- `docs/contracts/replay-fixture-schema.v0.md`
- `docs/architecture/gate-1A-schema-freeze.md`

## Drift Detection Rules

| Drift type | Detection method | Required failure code | Release behavior |
| --- | --- | --- | --- |
| Unknown event type | `event.type` is not in v0 allowed event types. | `unknown_event_type` | Fail replay/export. |
| Missing required field | Required envelope field absent: `id`, `type`, `timestamp_ms`, `producer`, `confidence`, `payload`, `evidence`. | `missing_required_event_field` | Fail replay/export. |
| Invalid producer | `producer` not in v0 producer allowlist. | `invalid_event_producer` | Fail replay/export. |
| Invalid confidence | `confidence` missing, nonnumeric, `< 0`, or `> 1`. | `invalid_confidence` | Fail replay/export. |
| Invalid timestamp | `timestamp_ms` missing, non-integer, or negative. | `invalid_timestamp` | Fail replay/export. |
| Duplicate event ID | Event ID repeats within fixture/trace. | `duplicate_event_id` | Fail replay/export. |
| Non-monotonic timestamp | Input event timestamp decreases from prior event. | `non_monotonic_timestamps` | Fail replay/export. |
| Raw-media evidence | Payload/evidence/fixture contains raw frame/video/audio/image/base64 refs. | `raw_media_evidence` | Fail replay/export. |
| Experimental state-bearing event | Experimental observation appears in `input_events` or state-bearing stream. | `experimental_state_event` | Fail replay/export. |
| Payload shape mismatch | Required event-specific payload field missing, payload is not object, evidence not array, or vague keys appear. | `payload_shape_mismatch` | Fail replay/export. |
| Broad/vague matcher | Stable event expectation lacks event ID, producer, confidence, payload matcher, or evidence refs. | `stable_event_assertion_too_broad` | Fail replay. |
| Replay fixture incompatible | Fixture top-level schema/required fields/metrics invalid. | `replay_fixture_schema_invalid` | Fail replay/export. |
| Unexpected model call | LLM/VLM/model route appears when fixture disallows cloud calls or exceeds metrics. | `unexpected_model_call` | Fail replay. |
| Memory write without evidence | Memory write lacks evidence IDs or nominal fixture expected no writes. | `memory_write_without_evidence` | Fail replay. |

## Implementation Approach

Use a simple layered guard rather than a parallel agent workflow:

1. Static JSON validation for `darkquest.replay_fixture.v0` top-level shape.
2. Static event validation for every `input_events[]` entry.
3. Recursive privacy scan over the fixture, trace, evidence refs, memory writes, and report output.
4. Exact Gate 0B matcher validation for `expected.stable_events`.
5. Replay command in CI:

```sh
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/focus_ritual_happy_path.v0.json
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_focus_ritual_001.v0.json
```

6. CI must fail if the live trace fixture is required for the branch and missing.

## Runner Status

`packages/evals/bin/darkquest-eval.mjs` now emits specific schema-drift failure codes for event/fixture drift:

- `unknown_event_type`
- `missing_required_event_field`
- `invalid_event_producer`
- `invalid_confidence`
- `invalid_timestamp`
- `duplicate_event_id`
- `non_monotonic_timestamps`
- `raw_media_evidence`
- `experimental_state_event`
- `payload_shape_mismatch`
- `stable_event_assertion_too_broad`
- `unexpected_model_call`
- `memory_write_without_evidence`
- `replay_fixture_schema_invalid`

## CI Script Sketch

```sh
set -euo pipefail

node --check packages/evals/bin/darkquest-eval.mjs
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/focus_ritual_happy_path.v0.json
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json

if [ "${REQUIRE_GATE_1A_LIVE_TRACE:-0}" = "1" ]; then
  test -f fixtures/replay/live/live_focus_ritual_001.v0.json
  node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_focus_ritual_001.v0.json
fi
```

## Exact Change Rule

Any future change to event types, producers, required payload fields, privacy checks, matcher semantics, or failure codes requires:

- a schema-change note under `docs/architecture/schema-changes/`;
- one positive fixture;
- one adversarial fixture;
- a runner update;
- a Gate 0B/Gate 1A replay report proving the intended pass/fail behavior.
