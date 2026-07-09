# ADR 0005: Local Vector Memory

## Status

Accepted.

## Context

The system benefits from remembering project-scoped corrections, object aliases, and episode summaries, but memory must not become a privacy leak or a source of polluted state.

## Decision

Use local scoped memory for event-backed summaries, aliases, user corrections, and project instincts. Retrieval may use local vector search, but writes must pass `MemoryGate`.

## Alternatives Considered

- Cloud memory service by default.
- No memory at all.
- Store all conversation and raw scene context.

## Consequences

- Useful learning stays close to the project.
- User corrections can improve future sessions.
- Memory writes are auditable and deletable.

## Risks

- Bad aliases can bias future perception.
- Summaries may include unsupported facts.
- Vector retrieval can surface stale or irrelevant memories.

## Acceptance Gate

Memory writes must include scope, evidence event ids, confidence, TTL, deletion policy, and replay validation eligibility. Raw frame memory must be rejected by default.

