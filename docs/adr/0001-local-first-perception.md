# ADR 0001: Local-First Perception

## Status

Accepted.

## Context

The Focus Ritual depends on webcam input, but the desk may contain private documents, devices, screens, and personal objects. The system must feel realtime and must target less than `$0.01` in LLM cost for a normal 10-minute demo.

## Decision

Run perception locally on the hot path. Convert frame-level observations into symbolic signals before any model or agent layer sees them. Cloud VLM calls are allowed only through a sparse uncertainty route.

## Alternatives Considered

- Cloud VLM every few seconds.
- Manual-only user confirmation for every step.
- Full raw-video persistence followed by offline analysis.

## Consequences

- Lower latency and predictable UX.
- Lower recurring cost.
- Stronger privacy boundary.
- Requires local perception quality and replay fixtures.

## Risks

- Local classifiers may misclassify rare objects.
- Low-light and occlusion cases need explicit recovery.
- Local perception implementation complexity is higher than simple VLM polling.

## Acceptance Gate

GAUNTLET must verify that normal quest completion produces no cloud VLM calls, that hot-path state transitions replay without video, and that raw frames are not persisted by default.

