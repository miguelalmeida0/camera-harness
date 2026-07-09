# Disclosure Acceptance Protocol

## Purpose

Some disclosures can be explicitly accepted for a narrow scope. Acceptance must be written, scoped, and expiring. A disclosure is not silently accepted by passing replay.

## Disclosures Requiring Explicit Acceptance

- TypeScript compile unavailable;
- physical webcam trace unavailable;
- browser latency not measured;
- occlusion recovery incomplete;
- camera bump reset incomplete;
- privacy scanner incomplete;
- model-call scanner incomplete.

## Current Project Rules

- Physical webcam trace must not be waived for portfolio-demo safety.
- TypeScript compile may be temporarily waived only for minimal HUD polish.
- A waiver must not support production-quality claims.
- A waiver must not approve cinematic HUD polish.
- A waiver must not weaken raw-media, model-call, memory, or HUD honesty checks.

## Acceptance Format

```text
Disclosure accepted:
- disclosure:
- reason:
- scope:
- expiration:
- accepted_by:
- date:
```

## Required Fields

| Field | Rule |
| --- | --- |
| `disclosure` | Name the exact missing or incomplete validation. |
| `reason` | Explain why a temporary waiver is justified. |
| `scope` | Limit the accepted work. |
| `expiration` | State the condition that ends the waiver. |
| `accepted_by` | Human approver. |
| `date` | Absolute date. |

## Forbidden Acceptance

The protocol cannot accept:

- raw media persistence;
- unexpected model calls;
- fake physical provenance;
- quest completion without events;
- hidden uncertainty;
- hidden low confidence;
- non-replayable HUD claims.

