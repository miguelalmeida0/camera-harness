# Gate 3B Agent Handoff

Gate 3B is the Focus Ritual Action Suggestion Engine.

It may make local camera motion useful as suggestions. It may not claim autonomous recognition or complete quest steps without confirmation.

## To Multimodal Perception & Interface Researcher

- Implement suggestions, not autonomous recognition.
- Preserve manual confirmation.
- Keep UI language honest.
- No model calls.
- No raw media.
- No auto-completion.
- Suppress future-step suggestions that would bypass quest order.
- Keep uncertainty and low confidence visible.

## To Harness, Evaluation, Memory & Safety Researcher

- Enforce suggestion lifecycle.
- Enforce confirmation boundary.
- Scan forbidden claims.
- Keep Gate 3C locked.
- Ensure Gate 3B returns `PASS_WITH_DISCLOSURE` at most.
- Verify suggestion-only events cannot complete quest.
- Verify accepted suggestions include `human_correction` evidence.

## Handoff Rule

The next implementation should improve suggestion usefulness without changing the truth model: local motion proxy proposes, user confirms, symbolic event records, reducer progresses.
