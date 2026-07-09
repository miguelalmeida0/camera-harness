# Gate 3B Confirmation Boundary

## Rules

- Suggestion alone does not complete quest.
- Accepted suggestion may complete quest through the normal event path.
- Acceptance must add `human_correction` evidence.
- Rejection must not progress quest.
- Low confidence must not auto-progress.
- Future-step suggestions must be suppressed.
- Uncertainty must block unsafe progression.

## Required Separation

Gate 3B must keep these concepts distinct:

- local motion proxy;
- camera suggestion;
- user confirmation;
- symbolic event;
- quest progress.

## Accepted Suggestion Path

The only allowed completion path is:

```text
camera suggestion -> user accepts -> symbolic event with human_correction -> quest reducer -> quest progress
```

The reducer remains the only authority for quest transition.

## Rejected Or Uncertain Path

Rejected, expired, low-confidence, out-of-order, or uncertain suggestions may be logged as symbolic diagnostic state. They must not emit quest-progressing events.

## UI Requirements

The UI must make confirmation visible. It must not hide manual confirmation behind polish, animation, success styling, or language that implies autonomous perception.
