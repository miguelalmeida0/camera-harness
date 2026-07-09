# Gate 3B-Live Suggestion Trace Validation

## Purpose

Gate 3B-Live validates physical suggestion traces from the local camera suggestion engine without approving auto-completion, autonomous vision, object recognition, production perception, model/VLM paths, or raw media persistence.

Gate 3B-Live exists to make suggestion behavior replayable and measurable before any Gate 3C discussion.

## Relationship To Gate 3B

Gate 3B defines the action suggestion engine:

```text
local motion proxy -> camera suggestion -> user confirmation -> symbolic event -> quest reducer
```

Gate 3B-Live keeps that same boundary and adds physical trace validation for accepted and rejected suggestions.

It does not change the completion rule: suggestion alone cannot complete quest.

## Physical Suggestion Trace Boundary

A physical suggestion trace may include:

- local motion-proxy suggestion records;
- accepted suggestion records;
- rejected suggestion records;
- expired/suppressed suggestion records;
- symbolic events emitted after accepted suggestions;
- summary metadata for counts and outcomes.

A physical suggestion trace must not include:

- raw frames;
- screenshots;
- base64 images;
- audio;
- cloud frame uploads;
- model/VLM responses.

## Suggestion Summary Metadata Boundary

Suggestion summary metadata may count suggestions, accept/reject outcomes, suggestion types, auto-completed steps, LLM/VLM calls, and raw media persistence.

The metadata must be descriptive only. It must not be used to mark quest completion or bypass event validation.

Required zero values:

- `auto_completed_steps: 0`;
- `llm_calls: 0`;
- `vlm_calls: 0`;
- `raw_media_persistence: 0`.

## Replay Boundary

Replay must verify that:

- suggestions are schema-valid;
- accepted suggestions include human confirmation evidence;
- rejected suggestions do not progress quest;
- suggestion-only records do not complete quest;
- future-step suggestions do not bypass quest order;
- exported artifacts remain symbolic.

Replay may prepare precision/false-positive measurement. It must not approve auto-completion.

## Accept/Reject Boundary

Accepting a suggestion may emit a symbolic event only through the normal event path and must include `human_correction` evidence.

Rejecting a suggestion must not emit a quest-progressing event.

Expired, low-confidence, uncertain, suppressed, or out-of-order suggestions must not progress quest.

## Privacy/Model Boundary

Gate 3B-Live preserves:

- no raw media persistence;
- no screenshots/base64 export;
- no raw audio;
- no cloud upload;
- no LLM/VLM calls;
- no model fallback path.

## No-Autocomplete Boundary

Gate 3B-Live does not unlock Gate 3C.

It may validate and measure suggestion traces. It may not approve blind auto-completion, confidence-based completion, or completion from suggestion-only events.

## Allowed

- physical suggestion traces;
- accepted/rejected suggestion replay;
- suggestion metadata;
- suggestion truth audit;
- precision/false-positive preparation.

## Forbidden

- auto-completion approval;
- autonomous vision claims;
- raw media persistence;
- model/VLM calls;
- future-step bypass;
- suggestion-only quest progress.
