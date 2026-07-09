# Memory Policy

## Memory Principles

- Raw frame memory is forbidden by default.
- Memory writes must be scoped, evidence-backed, confidence-weighted, and deletable.
- User correction has the highest priority because it resolves local ambiguity.
- Project-scoped instincts are preferred over global instincts.
- Global instincts require repeated, general evidence and explicit promotion approval.
- No raw conversation, raw code, or raw video export unless explicit user approval exists.

## Memory Scopes

| Scope | Allowed | What can be stored | What must not be stored | Default TTL | Confidence score | Promotion rules |
| --- | --- | --- | --- | --- | --- | --- |
| Raw frame memory | Forbidden by default | Nothing by default | Full frames, video clips, visible documents, faces, screens | `0 days` | Not applicable | Cannot promote |
| Event memory | Allowed | Typed events, state transitions, confidence changes, HUD commands | Raw images, unstabilized frame signals unless test-only | `30 days` | Event confidence plus schema validity | Can support summaries and evals |
| Episode summary memory | Allowed | Session outcome, completed steps, failure reasons, user-approved summary | Raw transcript, private desk details unrelated to quest | `90 days` | Summary confidence from evidence coverage | Can become project instinct after 3 consistent episodes |
| Object alias memory | Allowed | User correction such as "blue stylus counts as pen" | Broad visual description of private objects | `90 days` | User correction = high; inferred alias = medium | Promote only after repeated confirmation |
| User correction memory | High priority | Correction target, corrected value, evidence ids, timestamp | Raw frame or private rationale unless explicit | `180 days` | `0.95` default for explicit correction | Can override classifier labels in this project |
| Project instinct memory | Allowed | Repeated project-local lesson, threshold adjustment rationale, fixture-backed behavior | One-off guesses, private content, raw code export | `180 days` | Evidence-weighted across replays | Requires repeated evidence or GAUNTLET approval |
| Global instinct memory | Restricted | Generalizable pattern repeated across projects | User-specific objects, private workspace facts | `365 days` | High, repeated, general evidence | Requires explicit promotion gate |

## Memory Write Request Requirements

Each memory write must include:

- `memory_scope`
- `memory_subject`
- `memory_value`
- `evidence_event_ids`
- `confidence`
- `ttl_days`
- `promotion_reason`
- deletion eligibility
- privacy classification

## Deletion Policy

- User can delete any memory scope at any time.
- Expired memories must be ignored by retrieval and removed during cleanup.
- Raw frame memory is not created by default, so deletion should normally be a no-op.
- Deleting an object alias must not delete event replay history; it removes future retrieval.

## Confidence Policy

Memory confidence combines:

- evidence event confidence
- replay reproducibility
- user correction priority
- number of independent confirmations
- age decay
- contradiction count

Confidence should decay over time unless reinforced by successful replay or user confirmation.

## Memory Pollution Risks

- Misclassified object becomes a persistent alias.
- One noisy session promotes a false project instinct.
- LLM-generated summary adds facts not present in events.
- Recovery prompt is stored as truth.
- Private desk content is summarized into memory.

Mitigations:

- Require evidence event ids.
- Store corrections separately from inferences.
- Reject memory writes without TTL.
- Validate candidate instincts against replay fixtures.
- Never treat narration as evidence.

## Replay-Based Memory Validation

Before promoting a memory:

1. Replay the event sequence that generated it.
2. Confirm the same deterministic transition or correction appears.
3. Confirm the memory does not depend on raw frames unless it is an explicit test fixture.
4. Confirm retrieval improves or preserves state accuracy.
5. Confirm no private content crosses scope boundaries.

## Continuous-Learning Alignment

This policy supports project-scoped instincts, confidence-weighted memory, evidence-backed learning, local observations, and explicit promotion gates. Learning is a controlled byproduct of replayable events, not an unbounded dump of video, conversation, or hidden agent reasoning.

