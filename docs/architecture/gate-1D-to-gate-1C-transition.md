# Gate 1D To Gate 1C Transition

Gate 1D and Gate 1C have different jobs.

Gate 1D produces a candidate physical trace.

Gate 1C validates the candidate physical trace.

## Gate 1D Output

Gate 1D may produce:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

This fixture is only a candidate until Gate 1C accepts it.

## Gate 1C Validation

Gate 1C checks:

- fixture exists;
- physical provenance is valid;
- browser-origin synthetic substitution is rejected;
- replay is deterministic;
- expected events, quest transitions, and HUD commands match;
- privacy passes;
- memory policy passes;
- model-call checks pass;
- latency records exist;
- adversarial fixtures fail with exact expected codes.

## Manual Confirmation Boundary

Manual confirmation may be allowed for Gate 1D tryability, but it must be disclosed.

A physical trace with manual confirmation may pass replay, privacy, model, and provenance checks if it is honest and symbolic-only.

It cannot support autonomous vision claims.

## What Gate 1D Does Not Do

Gate 1D does not:

- automatically pass Gate 1C;
- approve minimal HUD work;
- approve cinematic polish;
- approve portfolio claims;
- prove automatic computer vision;
- waive physical provenance;
- relax raw-media or model-call checks.

## Gate 2 Dependency

Gate 1C result determines whether minimal HUD work can even be discussed.

If Gate 1C remains `BLOCKED_MISSING_PHYSICAL_TRACE`, Gate 2 remains blocked even if Gate 1D is tryable.
