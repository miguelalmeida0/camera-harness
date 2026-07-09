# Gate 1D Status Rules

Gate 1D status describes local tryability. It does not replace Gate 1C and does not approve Gate 2.

## Statuses

| Status | Meaning |
| --- | --- |
| `NOT_TRYABLE` | Camera may work, but the user cannot complete the local Focus Ritual path. |
| `TRYABLE_WITH_MANUAL_CONFIRMATION` | User can operate the app locally with clearly labeled manual symbolic confirmations. |
| `TRYABLE_WITH_LOCAL_PERCEPTION` | User can operate the app with local perception events for at least the core ritual steps. |
| `TRACE_EXPORT_WORKING` | User can export symbolic trace JSON and run validation with clear pass/fail output. |
| `GATE_1C_READY` | Required physical trace exists and is ready to run through Gate 1C. |
| `BLOCKED` | A safety, privacy, model-call, raw-media, or app usability issue prevents local tryability. |

## Current Expected Status

Current expected status before product fixes:

```text
NOT_TRYABLE
```

Reason: the user can turn on camera, but the local app is not yet accepted as a complete tryable ritual flow.

## Target Status

Target status after fixes:

```text
TRYABLE_WITH_MANUAL_CONFIRMATION
```

or:

```text
TRACE_EXPORT_WORKING
```

`TRYABLE_WITH_MANUAL_CONFIRMATION` is acceptable for local development. It is not enough for autonomous vision claims.

## Promotion Rules

Promote to `TRYABLE_WITH_MANUAL_CONFIRMATION` when:

- camera starts;
- zone calibration is usable;
- Focus Ritual can start;
- six ritual steps can be manually confirmed as symbolic events;
- debug HUD updates;
- no raw media persists;
- no model calls occur.

Promote to `TRACE_EXPORT_WORKING` when:

- all `TRYABLE_WITH_MANUAL_CONFIRMATION` criteria pass;
- recording can start and stop;
- trace JSON exports;
- validation gives a clear pass/fail result.

Promote to `GATE_1C_READY` only when:

- physical trace fixture exists at the required path;
- provenance is physical and not synthetic;
- trace is ready for `npm run gate:1c`.

## Demotion Rules

Demote to `BLOCKED` if:

- raw media persists;
- any LLM/VLM call occurs;
- manual confirmation is hidden;
- manual confirmation claims automatic recognition;
- trace export cannot be validated;
- quest state advances without symbolic support;
- Gate 2 or demo claims are made from Gate 1D alone.
