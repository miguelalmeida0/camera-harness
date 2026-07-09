# Local App Readiness States

These statuses describe product readiness of the local app. They do not replace Gate 1C.

## Statuses

| Status | Meaning |
| --- | --- |
| `CAMERA_ONLY` | Camera preview works, but calibration, quest, recording, confirmation, export, or validation path is unusable. |
| `UI_PRESENT_NOT_FUNCTIONAL` | Controls are visible but do not complete the flow. |
| `TRYABLE_WITH_MANUAL_CONFIRMATION` | User can complete the app flow using visible manual symbolic confirmations. |
| `TRACE_EXPORTED_NOT_VALIDATED` | A trace downloads but validation has not passed. |
| `PHYSICAL_TRACE_VALIDATED` | `npm run physical:validate` passes for the saved trace. |
| `GATE_1C_READY` | Required physical trace exists and is ready for full Gate 1C. |
| `GATE_1C_PASS` | Gate 1C returns `PASS` or accepted `PASS_WITH_DISCLOSURE`. |
| `BLOCKED` | A usability, safety, privacy, model-call, raw-media, or validation issue blocks progress. |

## Current State

Current source status:

```text
TRYABLE_WITH_MANUAL_CONFIRMATION
```

Current operational status until user runs:

```text
NEEDS_USER_VERIFICATION
```

## Transition Rules

Move to `CAMERA_ONLY` if the user can only start camera preview.

Move to `UI_PRESENT_NOT_FUNCTIONAL` if controls show but do not change state, record, export, or validate.

Move to `TRYABLE_WITH_MANUAL_CONFIRMATION` only when the user completes the local ritual using visible manual confirmations.

Move to `TRACE_EXPORTED_NOT_VALIDATED` only when the trace downloads and is saved.

Move to `PHYSICAL_TRACE_VALIDATED` only when `npm run physical:validate` passes.

Move to `GATE_1C_READY` only when the trace is ready for full Gate 1C.

Move to `GATE_1C_PASS` only when Gate 1C returns `PASS` or accepted `PASS_WITH_DISCLOSURE`.
