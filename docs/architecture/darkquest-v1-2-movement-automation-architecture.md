# DarkQuest v1.2 Movement Automation Architecture

## v1.2.1 Scope Clarification

This document remains authoritative for `confirmed_ai_movement`. DarkQuest v1.2.1 adds a separate `instant_local_gesture` path governed by `darkquest-v1-2-1-instant-gesture-automation.md`. That path may execute only allowlisted local actions after a stable MediaPipe event, explicit recipe opt-in, and session activation. It does not weaken confirmation for VLM results, snapshots, webhooks, media actions, or other external effects.

## Decision

DarkQuest v1.2 adds a policy-controlled automation layer after the existing, user-confirmed Movement Narrator result. Recognition proposes what happened; only an explicit confirmation can create an automation-eligible event.

The frozen product hierarchy remains:

`Camera -> Describe my next movement -> Big movement result`

## End-to-End Flow

Path B remains:

`Short camera window -> AI movement narration -> canonical movement identity -> user confirms result -> movement.confirmed -> recipe matcher -> policy/risk gate -> action execution plan -> action adapter -> execution receipt -> optional success/failure message`

| Stage | Responsibility | Input | Output | Side effects |
| --- | --- | --- | --- | --- |
| Recognition | Existing one-shot VLM route describes visible temporal movement. | Ephemeral short frame window | Canonical movement candidate | One bounded provider request sequence |
| Confirmation | User accepts or corrects the candidate. | Canonical candidate | `movement.confirmed.v1` | None |
| Matching | Local deterministic matcher evaluates enabled recipes. | Confirmed event and text/config recipes | Ordered recipe matches | None |
| Authorization | Enforces uncertainty, consent, risk, cooldown, rate, visibility, and permissions. | Match and policy state | Authorized execution plan or denial | Consent records only |
| Execution | A typed adapter performs one bounded action. | Authorized plan | Adapter result | Adapter-specific side effect |
| Receipt/audit | Records a text-only, secret-free outcome. | Plan and adapter result | Execution receipt | Session-local receipt write |

## Confirmation Boundary

Automation consumes only a normalized event with this minimum shape:

```ts
type MovementConfirmedEventV1 = {
  schema_version: "movement.confirmed.v1";
  event_id: string;
  movement_result_id: string;
  timestamp: number;
  confirmed_by: "user";
  result: CanonicalMovementResultV1;
  contains_raw_media: false;
};
```

The event is created only by the existing Confirm action or by explicit acceptance of a user correction. A provider response, render, camera callback, or synthetic UI click replay cannot construct it directly. During migration, the current symbolic confirmation event may still be emitted for compatibility, but the automation engine listens only to `movement.confirmed.v1`.

## Component Boundaries

- `recognition adapter`: normalizes provider output into `canonical-movement-result.v1`; it has no recipe access.
- `confirmation controller`: owns `movement_result_id`, explicit confirmation, and one-time event emission.
- `recipe repository`: stores validated text/config recipes and consent metadata; it stores no media or secrets.
- `recipe matcher`: pure function from confirmed result plus recipes to ordered matches.
- `policy gate`: computes effective risk, consent, cooldown, rate, tab visibility, and permission decisions.
- `execution planner`: creates an immutable, serializable plan with an idempotency key.
- `adapter registry`: resolves only allowlisted action types; arbitrary code is impossible.
- `receipt store`: holds capped, text-only session receipts.
- `UI adapter`: exposes only the approved secondary action and compact status after confirmation.

## System Invariants

1. The AI movement path accepts no unconfirmed, uncertain, or malformed movement result. The instant path accepts no event except a stabilized, allowlisted local gesture event.
2. Matching and authorization make no LLM/VLM calls.
3. `movement_result_id + recipe_id` identifies one logical execution.
4. Risk tier is `max(recipe.risk_tier, adapter.riskTier(config))`; configuration cannot lower it.
5. Adapter `validate` and `plan` are side-effect free. Only `execute` may cause a side effect.
6. No receipt, recipe, event, log, or webhook payload contains frames, images, base64, tokens, or secret values.
7. Tier 2 execution requires a second explicit per-run confirmation after movement confirmation.
8. No automation starts while the tab is hidden.
9. Every attempted execution ends with a text-only receipt, including denied, failed, cancelled, cooldown, and rate-limited outcomes.
10. The instant path cannot call the movement-recognition endpoint or any cloud model.

## Failure Handling

- Missing or invalid canonical fields: mark the result non-executable; do not retry recognition automatically.
- Uncertain result: return no executable match and keep Confirm/Correct behavior available.
- Invalid recipe: disable it and surface a safe validation message only in the automation editor.
- Multiple matches: return a deterministic order; authorize each recipe independently and never infer a winner with AI.
- Duplicate confirmation or rerender: return the existing execution state or receipt for the idempotency key.
- Permission denied, cooldown, or rate limit: do not call the adapter; issue a denial receipt.
- Adapter failure: apply the adapter-specific bounded retry policy, then issue one final receipt.

## Cost and Latency

Canonical fields are returned by the existing recognition request, so v1.2 adds no model call. The small structured fields add only minor response-token overhead. Recipe matching and policy checks are local and should complete within 10 ms for the v1 cap. Local adapters are free; webhook cost and latency are external-network effects and must be reported separately from AI cost.
