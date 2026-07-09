# Gate 3B-Live Pass/Fail

## Claim

Physical browser sessions can produce suggestion traces that replay safely, preserve confirmation gating, reject unsafe progression, keep zero raw media/model calls, and avoid autonomous vision claims.

This is live suggestion-trace validation only. It does not approve auto-completion, autonomous vision, object detection claims, or production action recognition.

## Pass Criteria

- Suggestion trace fixtures exist or are correctly reported missing.
- Live suggestion traces contain symbolic events only.
- Accepted suggestions include `local_signal` and `human_correction` evidence.
- Accepted suggestions include `accepted_from_suggestion_id`.
- Rejected suggestions do not progress quest state.
- Suggestions do not auto-complete by themselves.
- `auto_completed_steps` is `0`.
- LLM/VLM calls are `0`.
- Raw media persistence is `0`.
- Privacy scan passes.
- Replay repeat `3` is deterministic.
- Forbidden claim scan passes.

## Fail Criteria

- Suggestion-only event completes a quest step without confirmation.
- Rejected suggestion progresses quest state.
- Accepted suggestion lacks `human_correction`.
- Accepted suggestion lacks `local_signal`.
- Accepted suggestion lacks `accepted_from_suggestion_id`.
- Raw media appears.
- LLM/VLM calls appear.
- Trace claims autonomous vision.
- Future-step suggestions bypass quest order.
- `suggestion_summary` is missing.
- Accepted suggestion omits `detection_method: motion_proxy`.
- `auto_completed_steps` is nonzero.

## Verdicts

- `BLOCKED_MISSING_SUGGESTION_TRACES`: required live suggestion traces are not exported yet.
- `FAIL`: required traces exist but safety or replay checks fail.
- `PASS_WITH_DISCLOSURE`: required traces pass; disclosure remains because this is motion-proxy suggestion assistance.
- `PASS`: reserved for a future non-disclosure state.
