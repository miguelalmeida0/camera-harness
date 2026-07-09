# Gate 0 Pass/Fail Rules

## Decision

Gate 0 passes only when the replay harness proves that a six-step Focus Ritual fixture is schema-valid, deterministic, privacy-safe, model-safe, memory-safe, and fully supported by typed evidence.

The final verdict must be one of:

- `FAIL`
- `PASS_WITH_DISCLOSURE`
- `PASS`

`PASS_WITH_DISCLOSURE` is not approval for cinematic demo work unless the disclosure is explicitly accepted by GAUNTLET.

## Required pass conditions

Gate 0 passes only if all conditions are true:

| Check | Required result |
|---|---|
| Fixture schema | Fixture validates against `darkquest.replay_fixture.v0`. |
| Event schema | Every input event validates against `event-schema.v0`. |
| Stable events | Every expected stable event is emitted exactly as matched by fixture expectations. |
| Quest transitions | Expected transitions occur in order and each cites accepted evidence. |
| HUD commands | Expected HUD commands are emitted and progress commands cite evidence. |
| Forbidden events | No forbidden event type appears. |
| Model calls | No unexpected LLM/VLM route or call appears. |
| Raw media | No raw webcam, video, frame, or audio data is persisted or referenced. |
| Memory | Memory writes match fixture expectations and memory policy. |
| Latency/cost | Runtime and cost records are present; model cost remains within fixture limits. |
| Determinism | Three repeated runs produce the same normalized result. |

## Hard fail rules

Gate 0 fails immediately if any of these occur:

- Fixture schema is invalid.
- Any input event is schema-invalid.
- Quest completes without supporting events.
- A model call occurs without fixture permission.
- A memory write lacks evidence.
- A memory write lacks TTL.
- A memory write has `privacy_classification: "forbidden_raw_media"`.
- HUD emits a success/progress command without accepted evidence.
- HUD fails to show uncertainty when an accepted uncertainty event blocks the active step.
- Raw webcam, video, frame, or audio data is persisted or referenced.
- Replay output changes across repeated runs.
- Latency/cost records are missing.

## Pass rules by subsystem

### Fixture schema

Pass if:

- `schema == "darkquest.replay_fixture.v0"`.
- `fixture_id`, `name`, `description`, and `created_by` are non-empty strings.
- `privacy`, `input_events`, `expected`, `forbidden`, and `metrics` exist.
- `privacy.contains_raw_video == false`.
- `privacy.contains_audio == false`.
- Nominal fixture has `privacy.cloud_calls_expected == false`.
- `metrics.max_llm_calls`, `metrics.max_vlm_calls`, `metrics.max_cost_usd`, and `metrics.max_replay_runtime_ms` exist.

Fail if:

- Unknown top-level fields are present in strict mode.
- Any required top-level field is missing.
- Any raw media privacy flag is true.

### Event schema

Pass if every input event has:

- `id`
- `type`
- `timestamp_ms`
- `producer`
- `confidence`
- `payload`
- `evidence`

And:

- `type` is allowed by `event-schema.v0`.
- `producer` is allowed by `event-schema.v0`.
- `timestamp_ms >= 0`.
- input event timestamps are monotonic non-decreasing.
- `0 <= confidence <= 1`.
- required payload fields for the event type exist.
- evidence references are replay-safe.

Fail if:

- Any event contains vague keys such as `data`, `stuff`, or `info`.
- Evidence includes raw image bytes, raw video paths, raw audio paths, private document OCR, or hidden model reasoning.

### Stable events

Pass if:

- Each `expected.stable_events` matcher matches exactly one stable event.
- Each stable matcher includes exact `event_id`, type, producer, confidence floor, payload constraints, and evidence refs.
- Matched events satisfy exact event identity, type, producer, confidence floor, payload constraints, and evidence refs.
- Stable event IDs are deterministic across repeated runs.

Fail if:

- A stable event matcher is too broad.
- A stable event matcher is missing.
- A matcher resolves to multiple events.
- An unexpected state-changing stable event appears and is not explicitly allowed.

### Quest transitions

Pass if:

- Expected transitions occur in order.
- Expected transition matchers include `from_state`, `to_state`, `trigger_event_id`, `emitted_event_type`, and `step_id`.
- Every transition cites a trigger event.
- Every `quest.step_completed` event cites accepted evidence.
- `step_quest_complete` occurs only after prior steps complete.

Fail if:

- Phone step completes without `object.moved` phone leaving `zone_focus`.
- Notebook step completes without `object.placed` notebook in `zone_notebook`.
- Pen step completes without pen evidence in `zone_notebook` or `zone_focus`.
- Writing step completes before pen step.
- Typing step completes before writing step.
- Quest completes from an LLM/VLM event.

### HUD commands

Pass if:

- Each expected HUD command is emitted.
- Expected HUD matchers include `command_id`, `command_type`, `target_surface`, `related_step_id`, and `evidence_includes`.
- Every progress command includes evidence IDs.
- `quest_complete` includes completion evidence.
- Uncertainty commands appear when uncertainty blocks the active step.

Fail if:

- HUD displays completion without accepted transition evidence.
- HUD hides uncertainty.
- HUD command ordering contradicts quest transition ordering.

### Memory policy

Pass if:

- Nominal fixture emits no memory writes.
- Expected memory writes match fixture expectations.
- Every memory write includes evidence, TTL, scope, and privacy classification.

Fail if:

- Memory write lacks evidence.
- Memory write lacks `ttl_days`.
- Memory write stores raw media or forbidden private content.
- LLM narration is stored as evidence.

### Model-call policy

Pass if:

- Nominal fixture emits zero model calls.
- `metrics.llm_calls <= metrics.max_llm_calls`.
- `metrics.vlm_calls <= metrics.max_vlm_calls`.
- `metrics.cost_usd <= metrics.max_cost_usd`.

Fail if:

- Any unexpected `agent.escalation_requested` event appears.
- Tier 4 appears without explicit fixture permission.
- Any route uses `privacy_scope: "full_frame"`.
- A repeated repair loop appears.

### Privacy

Pass if:

- `raw_video_persisted == false`.
- No raw media paths or bytes appear in fixture, evidence, report, memory, or model route fields.

Fail if:

- Any value references `.mp4`, `.mov`, `.webm`, `.wav`, `.mp3`, `raw_frame`, `raw_video`, `raw_audio`, or webcam capture persistence.
- Any fixture privacy flag allows raw media for Gate 0.

### Latency/cost

Pass if:

- Runtime is recorded.
- LLM/VLM counts are recorded even when zero.
- Estimated cost is recorded even when zero.
- Runtime is under `metrics.max_replay_runtime_ms`.

Fail if:

- Records are missing.
- Runtime exceeds fixture limit.
- Cost exceeds fixture limit.

### Determinism

Pass if:

- Three repeated runs have identical normalized outputs.
- Runtime may vary but remains within budget.

Fail if:

- Final verdict changes.
- Stable events differ.
- Transition order differs.
- HUD commands differ.
- Memory writes differ.
- Model calls differ.
- Failure codes differ.

## Verdict policy

| Verdict | Meaning |
|---|---|
| `FAIL` | One or more hard fail or required pass conditions failed. Demo feature work remains blocked. |
| `PASS_WITH_DISCLOSURE` | Required checks pass, but non-blocking disclosures exist, such as intentionally ignored extra telemetry. GAUNTLET approval required before demo work. |
| `PASS` | All required checks pass with no disclosures. Gate 0 is cleared. |

## Required failure codes

Use stable failure codes:

- `replay_fixture_schema_invalid`
- `unknown_event_type`
- `missing_required_event_field`
- `invalid_event_producer`
- `invalid_confidence`
- `invalid_timestamp`
- `duplicate_event_id`
- `non_monotonic_timestamps`
- `payload_shape_mismatch`
- `raw_media_evidence`
- `experimental_state_event`
- `stable_event_assertion_too_broad`
- `stable_event_missing`
- `unexpected_stable_event`
- `quest_transition_assertion_too_broad`
- `quest_transition_missing`
- `quest_transition_out_of_order`
- `quest_completed_without_evidence`
- `hud_command_assertion_too_broad`
- `hud_command_missing`
- `hud_progress_without_evidence`
- `hud_uncertainty_hidden`
- `unexpected_model_call`
- `model_call_without_permission`
- `memory_write_without_evidence`
- `memory_write_without_ttl`
- `raw_media_persistence`
- `latency_cost_missing`
- `replay_runtime_exceeded`
- `nondeterministic_replay`

## Cost/latency impact

Gate 0 nominal replay cost must be `$0.00`. Runtime target is fixture-specific, with the first happy path capped at `1000ms`.

## Handoff to next agent

Build CI around these rules before connecting webcam capture. Any new feature must add or update replay fixtures before it is eligible for demo work.
