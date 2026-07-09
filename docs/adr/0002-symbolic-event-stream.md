# ADR 0002: Symbolic Event Stream

## Status

Accepted.

## Context

Frame signals are noisy and too granular for reliable agent workflows. The quest state machine needs stable, typed, replayable inputs.

## Decision

Use a canonical symbolic event stream as the boundary between perception and quest logic. Events follow `docs/contracts/event-schema.v1.md` and are append-only in the replay/event store.

## Alternatives Considered

- Pass raw frame detections directly into the quest engine.
- Let LangGraph nodes interpret frame-level signals directly.
- Store untyped JSON blobs for faster prototyping.

## Consequences

- Deterministic replay becomes possible.
- State transitions are easier to test.
- Contracts are stricter and require schema discipline.

## Risks

- Missing event types can block feature work.
- Event versioning must be managed.
- Overly broad event fields could weaken the boundary.

## Acceptance Gate

All quest transitions must reference accepted event ids, and schema validation must reject events containing vague keys such as `data`, `stuff`, `info`, or unversioned payloads.

