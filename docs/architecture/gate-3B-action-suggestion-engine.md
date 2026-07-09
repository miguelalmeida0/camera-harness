# Gate 3B Action Suggestion Engine

## Purpose

Gate 3B makes the camera useful as a local suggestion source without claiming autonomous vision, object recognition, or production perception.

The engine may convert browser-local motion proxy signals into camera suggestions. It must not complete quest steps from motion alone.

## Relationship To Gate 3A

Gate 3A proved browser-local motion proxy signals can be generated without raw media persistence, model calls, VLM calls, or cloud upload.

Gate 3B builds on those signals by adding a suggestion lifecycle:

```text
local motion proxy -> camera suggestion -> user confirmation -> symbolic event -> quest reducer
```

Gate 3B does not upgrade motion proxy into object recognition or autonomous action recognition.

## Motion Proxy Boundary

Motion proxy means local browser heuristics such as zone dwell, zone motion, repeated notebook-zone movement, or repeated keyboard-zone movement.

Motion proxy may produce:

- candidate suggestions;
- confidence scores;
- uncertainty/reset signals;
- cooldown state.

Motion proxy must not produce:

- quest completion;
- object recognition claims;
- production perception claims;
- raw media artifacts;
- model/VLM requests.

## Camera Suggestion Boundary

A camera suggestion is a ranked, temporary hypothesis about the next likely ritual action.

It may say:

- `possible writing motion`;
- `possible typing motion`;
- `motion detected in zone`;
- `requires confirmation`.

It must not say:

- the camera understood the task;
- the object was recognized;
- the gesture was solved;
- the quest step is complete.

Future-step suggestions must be suppressed if they would bypass quest order.

## User Confirmation Boundary

User confirmation remains the authority that allows a suggestion to become a symbolic event.

Acceptance must attach `human_correction` evidence. Rejection must not progress quest state. Low confidence and uncertainty must block unsafe progression.

Manual confirmation must remain visible in UI copy, trace evidence, and debug/export views.

## Symbolic Event Boundary

An accepted suggestion may emit a symbolic event only through the normal event contract. The event must include evidence that distinguishes:

- local motion signal;
- camera suggestion;
- user acceptance;
- human correction.

Suggestion-only events are not quest-completing events.

## Quest Reducer Boundary

Quest progress may happen only when the pure reducer receives an accepted, schema-valid symbolic event in the correct order.

The suggestion engine must not mutate quest state directly. It must not emit future-step events to bypass current quest order.

## Privacy Boundary

Gate 3B preserves Gate 3A privacy guarantees:

- no raw frame persistence;
- no screenshots or base64 export;
- no raw audio;
- no cloud frame upload;
- trace/export records symbolic events only.

## No-Model Boundary

Gate 3B uses no LLM/VLM calls. It adds no model path, fallback model path, cloud vision path, narration path, or agentic interpretation path.

## Allowed

- local motion-proxy suggestions;
- zone dwell/motion heuristics;
- quest-state-aware suggestions;
- confidence scoring;
- suggestion accept/reject;
- uncertainty/reset signaling;
- suggestion cooldowns.

## Forbidden

- autonomous vision claims;
- blind auto-completion;
- model/VLM calls;
- cloud frame upload;
- raw frame persistence;
- screenshots/base64 export;
- future-step bypass;
- hidden manual confirmation.
