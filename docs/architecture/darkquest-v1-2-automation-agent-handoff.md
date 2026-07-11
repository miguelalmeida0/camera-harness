# DarkQuest v1.2 Automation Agent Handoff

## Shared Non-Negotiables

- Preserve `Camera -> Describe my next movement -> Big movement result` and the frozen design.
- Never execute from provider output alone; require explicit confirmation of the exact result.
- Keep the existing one-shot provider guard and stable result snapshot.
- Store no raw media and expose no provider or webhook secrets.
- Matching and policy evaluation make zero AI calls.

## Handoff to Multimodal Perception and Interface Researcher

Implement in this order:

1. Extend Prompt v2 and provider normalization with conservative `movement_key`, safe `gesture_tags`, uncertainty enforcement, and stable `movement_result_id` handling.
2. Emit `movement.confirmed.v1` exactly once from the existing Confirm/correction acceptance boundary.
3. Add a versioned text/config recipe repository and deterministic matcher.
4. Add policy, consent, cooldown, rate, and idempotency controllers before adapter execution.
5. Register the six local adapters and the server-controlled signed webhook adapter; arbitrary action types must fail closed.
6. Add text-only execution receipts and the minimal post-confirmation automation action/status.
7. Put recipe management in one closed modal, sheet, or drawer; keep diagnostics in hidden Developer Tools.
8. Preserve result-card render stability, tab visibility checks, one-shot behavior, and no raw media persistence.

For snapshot download, capture a fresh frame only after the second per-run confirmation, download locally, then revoke the object URL. Never reuse or persist recognition frames.

For webhook execution, add a separate server route and module rather than expanding the movement-recognition provider into an action runner. The route accepts validated IDs, not arbitrary URLs or payloads.

## Handoff to Harness, Evaluation, Memory and Safety Researcher

Add an automation gate that proves behavior in runtime code rather than documentation alone:

- unconfirmed, rejected, uncertain, stale, and corrected-but-unconfirmed results never execute;
- duplicate Confirm clicks, rerenders, event replay, and webhook retries preserve one execution per idempotency key;
- recipe and adapter risk tiers cannot be downgraded;
- Tier 2 always requires a second per-run confirmation;
- disabled, invalid, cooldown, rate-limited, and permission-denied recipes fail closed with receipts;
- matching adds zero LLM/VLM calls and no continuous provider activity;
- recipes, aliases, receipts, logs, and webhooks contain no raw image, frame, base64, audio, OCR, `HF_TOKEN`, or secret values;
- webhook tests cover scheme/method allowlists, redirects, DNS rebinding, localhost, private/reserved IPs, metadata endpoints, timeouts, body caps, retry cap, HMAC, and redacted errors;
- imported recipes are disabled until reviewed and consented;
- the main hierarchy and current design freeze remain unchanged, with automation UI absent before confirmation.

## Definition of Done

The feature is complete only when one confirmed result can deterministically match, authorize, execute, and receipt an allowed recipe; all negative boundaries fail for the specified reason; and the existing v1/v1.1 behavior and privacy/cost invariants remain intact.
