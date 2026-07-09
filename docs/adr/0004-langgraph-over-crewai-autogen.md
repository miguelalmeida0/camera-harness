# ADR 0004: LangGraph Over CrewAI or AutoGen

## Status

Accepted.

## Context

The Focus Ritual needs typed state, deterministic routing, explicit node boundaries, and replayable graph execution. The LLM must not own state truth.

## Decision

Use LangGraph for the decision layer because it supports explicit graph nodes, typed state transitions, conditional routing, and deterministic integration with local tools.

## Alternatives Considered

- CrewAI role-oriented agents.
- AutoGen conversational multi-agent loops.
- A single monolithic agent.
- No graph layer.

## Consequences

- Node contracts can be tested independently.
- State read/write permissions are explicit.
- Hidden conversation loops are easier to avoid.

## Risks

- Graph design can become overly complex.
- Poor node boundaries can still create overlapping responsibilities.
- LangGraph dependency must be kept thin around core deterministic state.

## Acceptance Gate

Every LangGraph node must have an input schema, output schema, allowed side effects, LLM permission flag, retry policy, stop condition, and failure behavior documented before implementation.

