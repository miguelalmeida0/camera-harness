# ADR 0003: Sparse LLM Routing

## Status

Accepted.

## Context

The system needs occasional narration, planning, summaries, and uncertainty resolution, but continuous LLM/VLM usage would be costly, slow, and privacy-invasive.

## Decision

Use a five-tier model-routing policy. Tier 0 deterministic rules are the default. Tier 4 VLM is reserved for rare visual ambiguity after local uncertainty and privacy checks.

## Alternatives Considered

- Always use a strong multimodal model.
- Use a text LLM to own state.
- Disable all model use.

## Consequences

- Normal demo sessions can stay below `$0.01`.
- Model behavior is observable through route logs.
- Narrative quality remains available without compromising state truth.

## Risks

- Overly strict routing may underuse useful model help.
- Bad route classification can call a model unnecessarily.
- Budget accounting must stay accurate.

## Acceptance Gate

GAUNTLET must verify model route logs, max calls per minute, retry caps, and total estimated session cost across normal and uncertainty fixtures.

