# One-Shot Cost Guard Policy

## Decision

DarkQuest v1 is one-shot by default.

No AI call may happen before the user explicitly clicks `Describe my next movement`.

## Rules

- No AI call before explicit user click.
- One click creates one short movement window.
- One movement window creates at most one provider request sequence.
- Provider retries are capped.
- Provider candidate fallback is capped.
- No continuous narrator mode unless user explicitly enables it in a future approved pass.
- Live narrator remains disabled/coming soon.
- No background interval calls.
- No calls while tab hidden.
- No duplicate call from double click.
- Button is disabled while capturing/analyzing.
- Show provider busy instead of loop-retrying forever.

## Provider Sequence Boundary

Allowed:

```text
click
-> get ready
-> short frame window
-> one capped provider candidate ladder
-> result or busy/unavailable state
```

Forbidden:

```text
camera on
-> automatic repeated calls
```

Forbidden:

```text
provider busy
-> infinite retry loop
```

## Cost And Privacy Invariants

- `HF_TOKEN` remains server-side only.
- Short frame windows are transient request payloads.
- Raw frames are not persisted by the app.
- Live narrator remains disabled by default.
- Failed provider candidates may be summarized safely, but token values and raw frames must not appear in diagnostics.

## UI Behavior

- `Describe my next movement` is enabled only when camera is ready and no request is in flight.
- `Get ready...`, `Capturing...`, and `Understanding movement...` are mutually exclusive in-flight states.
- `Try another movement` starts a new one-shot window after a result.
- `Try again` is available after recoverable failure.

