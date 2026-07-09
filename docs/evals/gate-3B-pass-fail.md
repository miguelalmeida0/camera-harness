# Gate 3B Pass/Fail: Focus Ritual Action Suggestion Engine

## Claim

The app can convert local motion-proxy signals into safe, quest-state-aware camera suggestions for Focus Ritual steps, without blind auto-completion, model calls, raw media persistence, or autonomous vision claims.

## Pass Criteria

- Action suggestion engine exists.
- Suggestions are generated from symbolic/local motion data only.
- Suggestions are quest-state-aware.
- Suggestions do not auto-complete quest steps by default.
- Accepting a suggestion emits a valid symbolic event.
- Accepted suggestion evidence includes `local_signal` and `human_correction`.
- Rejected suggestion does not progress quest state.
- Duplicate/cooldown logic exists.
- Low-confidence suggestions are marked.
- Scene uncertainty remains visible and blocks unsafe suggestion progression.
- Manual confirmation remains visible.
- LLM/VLM calls remain zero.
- Raw media persistence remains zero.
- No autonomous vision claims appear.

## Fail Criteria

- Suggestion alone completes a quest step without confirmation.
- Future-step suggestions bypass quest order.
- Rejected suggestion progresses quest state.
- Suggestion evidence lacks `local_signal`.
- Accepted suggestion evidence lacks `human_correction`.
- Raw media appears in evidence or export.
- Model calls appear.
- UI claims automatic vision or proven recognition.
- Uncertainty is hidden.

## Evidence Required

- `npm run gate:3b`
- `runs/gate-3b-latest.json`
- Runtime checks for accept/reject, future-step suppression, low confidence, cooldown, and uncertainty blocking.
- Source checks for `motion_proxy`, `suggestion_only`, `local_signal`, and manual confirmation disclosure.

## Verdicts

- `BLOCKED_GATE_3A`: local motion prerequisite markers are missing.
- `FAIL`: Gate 3A markers exist but Gate 3B safety checks fail.
- `PASS_WITH_DISCLOSURE`: checks pass, with disclosure that this is motion-proxy suggestion assistance, not autonomous vision.
- `PASS`: reserved for a future non-disclosure state.
