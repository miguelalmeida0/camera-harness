# Automation Matching Cost Policy

## Decision

Movement recognition returns `movement_key` and `gesture_tags` in its existing one-shot provider response. Recipe matching, alias matching, confidence checks, and policy evaluation are deterministic local code.

## Rules

- No second LLM/VLM call may decide whether a recipe matches or executes.
- No model call may canonicalize a correction alias during automation matching.
- User-approved correction aliases are normalized and matched locally.
- Missing, malformed, or uncertain canonical fields produce no executable match; they do not trigger an automatic recognition retry.
- The existing one-shot guard remains unchanged: one explicit click, one short movement window, one capped provider request sequence.
- Recipe matching runs only after explicit movement confirmation.
- Webhook execution is a bounded network action and does not invoke AI.
- Future AI-backed action types require a new explicit contract and must declare their own user control, cost, and retry policy.

## Budget and Latency Targets

- AI calls added by automation matching: 0.
- Stored frames added by automation matching: 0.
- Local matcher target: less than 10 ms for up to 100 recipes.
- Policy and idempotency target: less than 5 ms excluding browser permission prompts and adapter I/O.
- Provider response overhead: only the small canonical key/tag fields in the existing response.

Diagnostics may report local match latency, selected recipe IDs, denial reason codes, adapter latency, and external request count inside hidden Developer Tools. They must not expose raw media, token values, secret values, or unrestricted payloads.
