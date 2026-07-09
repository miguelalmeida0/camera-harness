# ADR 0007: Replay-First Evaluation

## Status

Accepted.

## Context

The Focus Ritual must be hard to break and demoable. Bugs in state transitions, routing, HUD commands, and memory gates should be reproducible without depending on a live camera.

## Decision

Make replay fixtures the primary evaluation mechanism. A fixture contains typed events, expected state trace, expected HUD commands, route expectations, memory expectations, and privacy assertions.

## Alternatives Considered

- Manual live demos only.
- Unit tests with mocked functions but no event trace.
- Screenshot-only QA.

## Consequences

- Regression testing is stable.
- Failure cases can be captured as artifacts.
- Perception tuning can be separated from quest logic validation.

## Risks

- Fixtures may drift from real camera behavior.
- Missing edge fixtures can give false confidence.
- Replay runner must validate sequence and timestamps strictly.

## Acceptance Gate

GAUNTLET must maintain replay fixtures for normal completion, each release-blocking failure mode, model budget enforcement, memory rejection, and cloud fallback privacy boundaries.

