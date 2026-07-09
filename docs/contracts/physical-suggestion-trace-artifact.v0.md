# Physical Suggestion Trace Artifact v0

Gate 3B-Live requires real physical suggestion trace artifacts. Synthetic replacement does not satisfy this contract.

## Required Artifact Paths

- `fixtures/replay/live/suggestions/live_suggestion_phone_moved_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_notebook_opened_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_pen_picked_up_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_writing_motion_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_typing_motion_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_reject_does_not_progress_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_uncertain_scene_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_full_focus_ritual_001.v0.json`

## Required Top-Level Content

Each artifact must contain:

- `trace_origin`
- `suggestion_summary`
- `input_events`
- `expected`
- `forbidden`
- `metrics`
- no raw media
- no model calls
- accepted suggestion evidence when applicable
- rejected suggestion metadata when applicable
- replay-compatible structure

## Trace Origin

`trace_origin` must identify a physical local browser capture and must not claim synthetic substitution, cloud capture, model-generated evidence, or raw media persistence.

## Suggestion Summary

`suggestion_summary` must follow `docs/contracts/suggestion-trace-metadata.v0.md`.

Required zero values:

- `auto_completed_steps: 0`
- `llm_calls: 0`
- `vlm_calls: 0`
- `raw_media_persistence: 0`

## Input Events

`input_events` may contain symbolic suggestion, acceptance, rejection, uncertainty, and accepted symbolic quest events.

`input_events` must not contain raw frames, screenshots, base64 media, raw audio, OCR text, model responses, or cloud evidence.

## Expected

`expected` must define replay-compatible assertions for accepted/rejected suggestion behavior and quest transitions when applicable.

Accepted suggestion completion requires `human_correction` evidence and the normal symbolic event path.

## Forbidden

`forbidden` must reject:

- suggestion-only quest progress;
- rejected suggestion quest progress;
- future-step bypass;
- auto-completed steps;
- raw media persistence;
- LLM/VLM calls;
- autonomous vision claims.

## Metrics

`metrics` should include timing, confidence, suggestion outcome, and privacy/model counters needed for precision measurement.

## Replay Compatibility

Each artifact must replay deterministically through the harness. Replay must preserve zero raw media, zero model calls, confirmation gating, and the distinction between suggestion, confirmation, symbolic event, and quest progress.
