# Automation Execution State Machine

## States and Visible Copy

| State | Meaning | User-visible copy |
| --- | --- | --- |
| `idle` | No confirmed result is entering automation. | No automation status |
| `movement_confirmed` | One result was explicitly confirmed. | Automation ready |
| `matching` | Deterministic recipe matching is running for a confirmed result or stable local gesture. | Automation ready |
| `no_match` | No enabled recipe matched. | No automation configured |
| `match_found` | One or more recipes matched. | Automation ready |
| `awaiting_recipe_consent` | Recipe consent is missing or stale. | Review automation |
| `awaiting_per_run_confirmation` | Exact side effect needs another confirmation. | Confirm this action |
| `planning` | Policy-approved adapter plan is being built. | Preparing automation |
| `executing` | Adapter side effect is in progress. | Running |
| `succeeded` | Adapter completed successfully. | Completed |
| `failed` | Adapter ended without success. | Failed |
| `cancelled` | User or lifecycle cancelled execution. | Cancelled |
| `cooldown` | Recipe cooldown blocks another run. | Automation cooling down |
| `rate_limited` | Session limit was reached. | Automation limit reached |

## Allowed Transitions

- `idle -> movement_confirmed` only from explicit user confirmation of a valid, non-uncertain result.
- `idle -> matching` only from a valid stable local gesture event while Instant gestures is active.
- `movement_confirmed -> matching`.
- `matching -> no_match | match_found`.
- `match_found -> awaiting_recipe_consent | awaiting_per_run_confirmation | planning | cooldown | rate_limited`.
- `awaiting_recipe_consent -> awaiting_per_run_confirmation | planning | cancelled`.
- `awaiting_per_run_confirmation -> planning | cancelled`.
- `planning -> executing | failed | cancelled`.
- `executing -> succeeded | failed | cancelled` when the adapter supports cancellation.
- `succeeded -> cooldown | idle`.
- `failed -> cooldown | idle`.
- `no_match | cancelled | rate_limited -> idle` after status acknowledgement or a new result.
- `cooldown -> idle` when the cooldown expires.

All other transitions are invalid and produce a safe diagnostic without execution.

## Idempotency

The logical key is source-specific:

`movement_result_id + recipe_id`

or

`gesture_event_id + recipe_id`

The planner atomically reserves this key before execution. A duplicate Confirm click, camera rerender, event replay, or network retry must return the existing state or receipt. It must not create a second plan. Adapter calls receive a stable `execution_id`, and webhooks also receive it as an idempotency header and payload field.

## Retry and Cancellation

- Local adapters default to zero retries.
- Webhooks permit at most one retry, bounded by both recipe and adapter policy.
- Retries reuse the same execution ID and idempotency key.
- Retry only bounded transient failures; validation, authorization, 4xx, and policy denials are not retried.
- Cancellation before `executing` prevents all side effects.
- Cancellation during `executing` invokes adapter `cancel`; the receipt must distinguish `cancel_requested` from confirmed cancellation.
- Completed external effects are never described as rolled back unless the adapter proves it.

## Receipt Behavior

Every terminal or denied path creates one text-only receipt:

```ts
type AutomationExecutionReceiptV1 = {
  schema_version: "automation-execution-receipt.v1";
  execution_id: string;
  idempotency_key: string;
  source_kind: "confirmed_ai_movement" | "instant_local_gesture";
  source_event_id: string;
  movement_result_id: string | null;
  gesture_event_id: string | null;
  recipe_id: string;
  adapter_type: string;
  effective_risk_tier: 0 | 1 | 2 | 3;
  status: "succeeded" | "failed" | "cancelled" | "denied";
  attempt_count: number;
  started_at: number | null;
  finished_at: number;
  safe_message: string;
  contains_raw_media: false;
  contains_secrets: false;
};
```

Receipt writes are idempotent by `execution_id`, bounded in size, session-local by default, and never contain raw adapter response bodies.
