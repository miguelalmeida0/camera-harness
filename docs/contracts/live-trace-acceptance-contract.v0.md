# Live Trace Acceptance Contract v0

## Purpose

This contract defines when a Gate 1A live local perception trace is acceptable. A live trace is not accepted by visual inspection. It is accepted only when exported as replay fixture JSON and replayed deterministically through the existing harness.

Required live trace path:

```text
fixtures/replay/live/live_focus_ritual_001.v0.json
```

Required validation command:

```sh
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_focus_ritual_001.v0.json
```

## Acceptance Definition

A live trace is acceptable only if:

- it is valid `darkquest.replay_fixture.v0` JSON;
- it contains symbolic events only;
- it uses valid `docs/contracts/event-schema.v0.md` event types only;
- it does not contain experimental state-bearing events;
- it has no raw media;
- it has no audio;
- it has no screenshots;
- it has no base64 images;
- it has no cloud calls;
- it has no unapproved memory writes;
- expected events use payload-aware matchers;
- it replays deterministically three times;
- it reports cost/latency records;
- it passes privacy checks;
- it passes model-call checks;
- it passes memory checks;
- it passes HUD honesty checks.

## Fixture Requirements

The exported fixture must include:

```json
{
  "schema": "darkquest.replay_fixture.v0",
  "fixture_id": "live_focus_ritual_001",
  "privacy": {
    "contains_raw_video": false,
    "contains_audio": false,
    "cloud_calls_expected": false
  },
  "input_events": [],
  "expected": {
    "stable_events": [],
    "quest_transitions": [],
    "hud_commands": [],
    "memory_writes": [],
    "model_calls": []
  },
  "forbidden": {
    "event_types": ["agent.escalation_requested"],
    "memory_writes": [],
    "model_calls": [],
    "raw_video_persistence": true
  },
  "metrics": {
    "max_llm_calls": 0,
    "max_vlm_calls": 0,
    "max_cost_usd": 0,
    "max_replay_runtime_ms": 1000
  }
}
```

For an acceptance fixture, `expected.stable_events`, `expected.quest_transitions`, and `expected.hud_commands` must not be empty if the trace claims the Focus Ritual completed.

## Event Requirements

Every `input_events[]` item must have:

- `id`;
- `type`;
- `timestamp_ms`;
- `producer`;
- `confidence`;
- `payload`;
- `evidence`.

Every event must satisfy:

- `timestamp_ms` is a non-negative integer;
- timestamps are monotonic non-decreasing;
- `confidence` is between `0.0` and `1.0`;
- producer is allowed by v0;
- payload has required event-specific fields;
- payload keys are meaningful and not vague;
- evidence references are symbolic and replay-safe.

## Matcher Requirements

Every expected stable event matcher must include:

- `event_id`;
- `type`;
- `producer`;
- `min_confidence`;
- one non-empty payload matcher: `payload_match`, `payload_exact`, or `payload_includes`;
- `evidence_includes`.

Broad event-family assertions are invalid.

## Privacy Requirements

The trace and exported fixture must not contain:

- raw frame bytes;
- raw video paths;
- raw audio paths;
- screenshots;
- image paths;
- base64 media;
- OCR;
- visible notebook text;
- cloud-derived evidence marked as local;
- hidden model reasoning.

## Model, Memory, And HUD Requirements

Gate 1A is a zero-model-call gate:

- `expected.model_calls` must be `[]`;
- `metrics.max_llm_calls == 0`;
- `metrics.max_vlm_calls == 0`;
- `metrics.max_cost_usd == 0`;
- observed `llm_calls`, `vlm_calls`, and `estimated_cost_usd` must be zero.

Memory writes are rejected unless an explicit fixture tests an allowed symbolic write. Any allowed write must include evidence IDs, TTL, scope, subject, and privacy classification.

HUD commands that imply progress must cite evidence. Any `scene.uncertain` event must be represented by an uncertainty HUD command.

## Final Verdict

An accepted live trace must produce `darkquest.replay_report.v0` with final verdict `PASS`. `PASS_WITH_DISCLOSURE` is not enough for the first Gate 1A happy live trace unless AXIOM accepts the disclosure through an ADR and GAUNTLET adds an adversarial fixture.
