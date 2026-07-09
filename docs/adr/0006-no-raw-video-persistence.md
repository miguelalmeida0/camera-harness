# ADR 0006: No Raw Video Persistence

## Status

Accepted.

## Context

Raw desk video can contain private material and is expensive to store, review, and secure. The system only needs replayable symbolic events for most testing.

## Decision

Do not persist raw video by default. Persist typed events, state traces, route logs, HUD commands, and replay diffs. Explicit test fixtures may include short video clips only with consent, retention, and privacy labeling.

## Alternatives Considered

- Persist all webcam sessions.
- Persist rolling video buffers by default.
- Use cloud video storage for eval review.

## Consequences

- Stronger privacy posture.
- Smaller storage footprint.
- Debugging visual perception bugs requires explicit fixture capture.

## Risks

- Some perception bugs may be hard to reproduce from events alone.
- Fixture collection requires user consent workflow.
- Over-redaction can hide useful QA signals.

## Acceptance Gate

No raw frame or video file may be written during normal operation. Test video fixtures require an explicit artifact label, TTL, and consent marker.

