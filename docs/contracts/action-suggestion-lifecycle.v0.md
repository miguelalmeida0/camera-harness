# Action Suggestion Lifecycle v0

Gate 3B suggestion flow:

```text
local motion signal
-> candidate suggestion
-> ranked active suggestion
-> accept/reject/expire
-> accepted suggestion emits symbolic event
-> quest reducer processes accepted event
-> trace/export records symbolic event only
```

Required fields for every suggestion state:

- `id`
- `suggested_action`
- `suggested_event_type`
- `quest_step`
- `zone_id`
- `confidence`
- `reason`
- `evidence`
- `expires_at_ms`
- `accepted`
- `rejected`

## Local Motion Signal

Required fields:

- `id`
- `zone_id`
- `confidence`
- `reason`
- `evidence`

Allowed transitions:

- to `candidate suggestion`;
- to uncertainty/reset signal;
- to no-op.

Forbidden transitions:

- directly to symbolic event;
- directly to quest progress;
- to raw media persistence;
- to model/VLM call.

Evidence requirements:

- local symbolic motion evidence only;
- no raw frames, screenshots, base64 images, or audio.

UI requirements:

- may show local signal or motion in zone;
- must not show completion.

Test expectations:

- local motion alone cannot complete a quest step.

## Candidate Suggestion

Required fields:

- all required suggestion fields;
- `accepted: false`;
- `rejected: false`.

Allowed transitions:

- to ranked active suggestion;
- to expired;
- to suppressed if out of order, low confidence, uncertain, or blocked by cooldown.

Forbidden transitions:

- to quest progress;
- to accepted without user action;
- to future-step bypass.

Evidence requirements:

- must cite local motion signal evidence;
- must include reason and confidence.

UI requirements:

- must say suggestion requires confirmation;
- must preserve uncertainty and low-confidence display.

Test expectations:

- future-step candidates are suppressed until quest order allows them.

## Ranked Active Suggestion

Required fields:

- all required suggestion fields;
- current rank or active priority;
- `expires_at_ms`.

Allowed transitions:

- to accepted;
- to rejected;
- to expired;
- to suppressed by reset/uncertainty.

Forbidden transitions:

- to symbolic event without accept;
- to hidden manual confirmation;
- to auto-completion.

Evidence requirements:

- must include local signal evidence and ranking reason.

UI requirements:

- show suggested action, confidence, reason, expiry/cooldown if visible;
- show accept and reject controls.

Test expectations:

- active suggestion disappears or changes state after expiry.

## Accepted Suggestion

Required fields:

- all required suggestion fields;
- `accepted: true`;
- `rejected: false`;
- accept timestamp;
- `human_correction` evidence.

Allowed transitions:

- to schema-valid symbolic event;
- to trace/export symbolic record.

Forbidden transitions:

- to raw media export;
- to model/VLM call;
- to event type outside the current quest step.

Evidence requirements:

- local signal evidence;
- camera suggestion evidence;
- `human_correction` evidence.

UI requirements:

- show accepted by user/operator;
- must not imply autonomous recognition.

Test expectations:

- accepted suggestion can progress quest only through normal event reducer path.

## Rejected Suggestion

Required fields:

- all required suggestion fields;
- `accepted: false`;
- `rejected: true`;
- reject timestamp.

Allowed transitions:

- to cooldown;
- to trace/export symbolic record;
- to no-op.

Forbidden transitions:

- to quest progress;
- to accepted;
- to hidden success.

Evidence requirements:

- local signal evidence;
- rejection evidence.

UI requirements:

- show rejection or clear suggestion;
- do not mark quest step complete.

Test expectations:

- rejection never advances quest state.

## Expired Suggestion

Required fields:

- all required suggestion fields;
- `accepted: false`;
- `rejected: false`;
- expiry timestamp.

Allowed transitions:

- to no-op;
- to new candidate if fresh local signal arrives after cooldown.

Forbidden transitions:

- to accepted without new user action;
- to quest progress.

Evidence requirements:

- original local signal evidence;
- expiry reason.

UI requirements:

- remove from active UI or mark expired.

Test expectations:

- expired suggestion cannot be accepted unless reissued as a fresh suggestion.

## Symbolic Event Emission

Required fields:

- schema-valid event fields;
- accepted suggestion id;
- suggested event type;
- quest step;
- evidence refs.

Allowed transitions:

- to quest reducer;
- to trace/export symbolic event record.

Forbidden transitions:

- to reducer without schema validation;
- to raw media artifact;
- to model/VLM call.

Evidence requirements:

- local signal;
- accepted suggestion;
- `human_correction`.

UI requirements:

- show event as user-confirmed symbolic event.

Test expectations:

- trace/export records symbolic event only.
