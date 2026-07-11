# DarkQuest v1.2 Automation Results

## Claim Being Tested

A bounded action can run only through: AI result -> user confirmation -> deterministic recipe match -> policy authorization -> action execution.

## Test Design

`npm run gate:v1:automation` loads the browser application and server modules, verifies required function exports, and executes synthetic recipe, confirmation, matching, state-machine, adapter, webhook, cost, and idempotency cases. Static documentation or UI copy cannot produce a passing verdict.

## Current Evidence

- Report: `runs/gate-v1-automation-latest.json`
- Current verdict: `BLOCKED_MISSING_AUTOMATION_ENGINE`
- Existing Camera -> Describe my next movement -> Movement Result hierarchy remains intact.
- Existing old-product, text-containment, result-stability, secret, and unsafe-code regression checks pass.
- No automation behavior test was credited because the required engine exports do not exist.

## Validation Results

- `npm run gate:v1`: `PASS_WITH_DISCLOSURE` (148/148)
- `npm run gate:v1:research`: `PASS_WITH_DISCLOSURE` (133/133)
- `npm run gate:v1:automation`: `BLOCKED_MISSING_AUTOMATION_ENGINE` (20/37; behavior suites blocked)
- `npm run gate:4a`: `PASS_WITH_DISCLOSURE` (89/89)
- `npm run gate:4a:engine`: `PASS_WITH_DISCLOSURE` (67/67)
- `npm run test:movement-recognition`: pass
- `npm run test:adapter`: pass
- `npm run test:recorder`: pass
- `npm run typecheck`: pass
- `npm run test:movement-recognition:live`: skipped because `HF_TOKEN` is absent in this environment

## Recipe Engine

Blocked. The gate requires executable exports for recipe validation, deterministic matching, runtime state creation, state transitions, idempotency keys, and confirmed-movement orchestration. The validator suite covers required/unique IDs, bounded names, schema version, canonical trigger key, confidence, cooldown, run cap, action allowlist, risk mapping, secrets, raw media, JavaScript, shell commands, webhook methods, and unknown fields.

## Confirmation Boundary

Blocked. The executable suite covers unconfirmed, uncertain, rejected, corrected, duplicate-confirm, camera-rerender, and result-rerender behavior. An AI result alone is never sufficient authorization.

## Matcher And Risk Tiers

Blocked. Matching must be pure, deterministic, network-free, model-free, and raw-media-free. Ordering is priority descending with stable recipe-ID tie-breaking. Required risk tiers are: activity log/counter Tier 0; speech/notification/timer Tier 1; local snapshot Tier 2; signed webhook Tier 3.

## Local Adapters

Blocked. Required behavior covers speech cancellation and exact text, notification permission, one timer per idempotency key, capped counters, clearable text-only activity log, and a consent-gated local snapshot that revokes its object URL and never uploads or enters movement history.

## Webhook Safety

Blocked. Webhook validation and signing must remain server-side. The executable suite blocks HTTP, loopback/private/link-local/metadata destinations, non-POST methods, unallowlisted targets, private redirects, oversized/raw-media payloads, uncapped timeout/retry behavior, and secret exposure. Development-local destinations require `ALLOW_LOCAL_AUTOMATION_WEBHOOKS=true`.

## Cost Guard

Blocked. Recipe matching, local actions, and webhooks must create zero AI calls. Automation cannot start movement analysis, recurse, exceed per-result action caps, or exceed session caps.

## UI Freeze

The frozen v1.1 hierarchy currently passes. The v1.2 secondary UI is not implemented: the gate expects `automateMovement`, a closed `automationRecipeEditor` modal/sheet/drawer, and a compact `automationReceipt` below the confirmed result. No automation dashboard, raw webhook destination, secret, or debug log may enter the main result surface.

## Pass/Fail Criteria

- Engine exports absent: `BLOCKED_MISSING_AUTOMATION_ENGINE`.
- Engine present but adapters/UI absent: `BLOCKED_MISSING_ACTION_ADAPTERS`.
- Executed critical assertion fails: `FAIL`.
- Deterministic suite passes with live adapter verification outstanding: `PASS_WITH_DISCLOSURE`.

## Remaining Disclosures

- The five optional contract/policy documents listed by Gate v1.2 are not present; the executable gate currently defines the acceptance interface.
- Browser notification permissions, actual timer delivery, local snapshot download, and an approved HTTPS webhook still require controlled live evidence after implementation.
- Live movement recognition is outside this gate and must be rerun only when `HF_TOKEN` is available locally.
