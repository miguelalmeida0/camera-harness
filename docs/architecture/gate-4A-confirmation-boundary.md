# Gate 4A Confirmation Boundary

## Decision

Gate 4A detected actions are suggestions. They do not complete the ritual by themselves.

The only allowed progress path is:

```text
DetectedActionCandidate
-> user confirms
-> schema-valid symbolic event
-> local_signal + human_correction evidence
-> existing quest reducer
-> progress update
```

## Rules

- Detected action does not progress the ritual by itself.
- User confirm progresses through the existing reducer.
- `Not this` / reject does not progress.
- Rejection starts a cooldown for the same suggestion key.
- Low-confidence detection must not dominate the UI.
- Uncertain state must pause unsafe progression.
- Scene reset requires recalibration or reset handling.
- Auto-completion remains blocked.

## Evidence Requirements

Accepted detected actions must include:

- local perception evidence;
- camera suggestion evidence;
- `human_correction` evidence;
- `requires_confirmation: true` in candidate metadata.

Rejected detected actions may be logged as safe metadata, but they must not emit quest-progressing events.

## UI Requirements

The UI must show confirmation plainly:

- Detected Action card;
- Confirm;
- Not this / Correct;
- `Camera suggestion - requires confirmation`.

The UI must not imply autonomous recognition, object detection proof, gesture recognition proof, production readiness, or demo readiness.

## Failure Modes

- false positive accepted by mistake;
- repeated candidate after rejection;
- low-confidence candidate hides uncertainty;
- future-step action appears too early;
- candidate emits event without confirmation.

Mitigations:

- current-step filter;
- cooldowns;
- uncertainty state;
- evidence checks;
- reducer-only progress.

