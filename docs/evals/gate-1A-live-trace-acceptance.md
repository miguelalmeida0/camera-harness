# Gate 1A Live Trace Acceptance

## Decision

Gate 1A passes only when a live local perception session records a symbolic trace, exports it as `darkquest.replay_fixture.v0`, and replays deterministically through the existing harness.

The current acceptance command is:

```sh
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_focus_ritual_001.v0.json
```

No cinematic HUD polish is demo-safe until this command passes on at least one recorded live symbolic trace and the adversarial cases fail for the right reasons.

## Required Live Artifact

The live trace export must create a replay fixture, not a separate state path:

```text
live local perception session
-> symbolic v0 event stream
-> live trace recorder
-> fixtures/replay/live/live_focus_ritual_001.v0.json
-> darkquest-eval replay --repeat 3
-> darkquest.replay_report.v0
```

Required exported fixture properties:

- `schema == "darkquest.replay_fixture.v0"`;
- `privacy.contains_raw_video == false`;
- `privacy.contains_audio == false`;
- `privacy.cloud_calls_expected == false`;
- `input_events` contains only v0-valid symbolic events;
- `expected.stable_events` uses exact Gate 0B-compatible matchers;
- `expected.quest_transitions` is ordered and evidence-backed;
- `expected.hud_commands` is ordered and evidence-backed;
- `expected.memory_writes` is empty unless a fixture explicitly tests an allowed symbolic write;
- `expected.model_calls` is empty for normal Gate 1A;
- `metrics.max_llm_calls == 0`;
- `metrics.max_vlm_calls == 0`;
- `metrics.max_cost_usd == 0`.

## Pass Rules

Gate 1A passes only if all of these are true:

1. The exported fixture schema is valid.
2. Every input event validates against `docs/contracts/event-schema.v0.md`.
3. Every expected stable event is matched by exactly one observed event.
4. Stable-event matchers include `event_id`, `type`, `producer`, `min_confidence`, non-empty payload matching, and `evidence_includes`.
5. Expected quest transitions occur in order.
6. Expected HUD commands occur in order.
7. HUD progress commands include evidence IDs.
8. Any `scene.uncertain` event produces an uncertainty HUD command.
9. No forbidden event type appears.
10. No unexpected LLM/VLM call appears.
11. No raw webcam, video, audio, screenshot, base64 image, OCR, notebook text, or raw media path appears anywhere in the fixture or report.
12. Memory writes match policy and include evidence IDs plus TTL.
13. Latency/cost records are present.
14. The result is deterministic across three repeated runs.

## Fail Rules

Gate 1A fails if any of these occur:

- the live adapter emits v1 envelope fields as state-bearing replay input;
- the live adapter emits `quest.step_started`, `quest.step_completed`, `hud.command_emitted`, `memory.write_requested`, or `agent.escalation_requested`;
- the quest completes without all supporting stable events in order;
- a model route or cloud call appears without explicit fixture permission;
- a memory write lacks evidence, TTL, or allowed privacy classification;
- the HUD hides uncertainty;
- raw webcam/video/audio/frame/screenshot data is persisted or referenced;
- `expected.stable_events` contains broad event-family assertions;
- latency/cost records are missing;
- replay output changes across three repeated runs.

## First Live Fixture Matrix

| Fixture | Expected verdict | Required failure code when failing |
| --- | --- | --- |
| live happy symbolic trace | `PASS` | none |
| live trace with v1 event envelope | `FAIL` | `missing_required_event_field` or `unknown_event_type` |
| adapter emits quest event | `FAIL` | `unexpected_stable_event` or `payload_shape_mismatch` |
| adapter emits HUD event | `FAIL` | `unexpected_stable_event` or `payload_shape_mismatch` |
| raw frame evidence reference | `FAIL` | `raw_media_evidence` |
| unexpected VLM route | `FAIL` | `unexpected_model_call` |
| memory write without evidence | `FAIL` | `memory_write_without_evidence` |
| uncertainty without HUD command | `FAIL` | `hud_uncertainty_hidden` |
| vague expected stable matcher | `FAIL` | `stable_event_assertion_too_broad` |
| nondeterministic live export ordering | `FAIL` | `nondeterministic_replay` |

## Fixture Authoring Rules

Live acceptance fixtures must not leave `expected.stable_events`, `expected.quest_transitions`, or `expected.hud_commands` empty when claiming a successful Focus Ritual. An empty expected section is allowed only for a diagnostic capture that is explicitly not an acceptance fixture.

Stable event expectations should prefer `payload_exact` when the live export is known to be stable. Use `payload_match` only for deterministic subsets that are enough to prove the guard, such as object type, source zone, destination zone, dwell time, gesture type, and evidence window.

Every expected quest transition must cite the stable event that triggered it. Every expected HUD command that implies progress must cite the quest completion event or accepted perception evidence that caused it.

## Required Report Evidence

The resulting `darkquest.replay_report.v0` must include:

- fixture id;
- run id;
- build hash;
- schema validation result;
- event validation result;
- stable event result;
- quest transition result;
- HUD command result;
- memory policy result;
- model-call result;
- privacy result;
- latency/cost result;
- deterministic replay result;
- final verdict.

## Handoff To GAUNTLET

After PARALLAX records the first symbolic live trace, convert it into `fixtures/replay/live/live_focus_ritual_001.v0.json` with exact matchers and add the adversarial fixtures above. Gate 1A is not accepted by visual inspection; it is accepted by replay reports.
