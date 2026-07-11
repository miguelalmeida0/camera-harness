# Automation Action Adapter v1

## Common Interface

```ts
interface AutomationActionAdapterV1<Config, Plan> {
  validate(config: Config, context: ValidationContext): ValidationResult;
  plan(config: Config, context: ExecutionContext): PlanResult<Plan>;
  execute(plan: Plan, context: ExecutionContext): Promise<ExecutionResult>;
  cancel(executionId: string): Promise<CancelResult>;
  describe(plan: Plan): string;
  riskTier(config: Config): 0 | 1 | 2 | 3;
}
```

`validate` and `plan` must be deterministic and side-effect free. `execute` is the only method allowed to cause a side effect. `cancel` is best effort and must not claim rollback after an irreversible side effect.

## Context Boundary

Execution context contains exactly one validated source event (`confirmed_ai_movement` or `instant_local_gesture`), recipe ID, execution ID, consent state, tab visibility, permission state, and bounded adapter capabilities. It contains no provider token, webhook secret value, persisted frame, base64, or arbitrary callable function.

For instant execution, the registry must reject every action except the instant allowlist before `plan` or `execute`. The adapter cannot infer instant eligibility from its own type alone.

Plans are immutable and text/config only. The snapshot adapter may receive an opaque, one-use local camera capability after per-run confirmation; the image bytes must not enter the generic plan, event, log, or receipt.

## Initial Adapter Catalog

| Adapter | Tier | Execution boundary | Required safeguards |
| --- | --- | --- | --- |
| `speak_phrase` | 0 | Browser Web Speech API | Configured text only; cancel prior speech; no provider metadata speech |
| `browser_notification` | 1 | Browser Notification API | User permission; no prompt loop; text-only body |
| `start_timer` | 0 | Local session timer | Bounded duration; no hidden-tab execution start |
| `increment_counter` | 0 | Text-only local counter | Bounded integer and session rate cap |
| `append_activity_log` | 0 | Text-only local log | Length and entry caps; clearable |
| `local_snapshot_download` | 2 | Fresh browser-local frame and local download | Second per-run confirmation; no upload/history; revoke object URL immediately |
| `signed_webhook_post` | 1 | Server-side HTTPS POST | Allowlisted destination; server secret reference; no image data |

## Adapter Requirements

### Local adapters

- `speak_phrase`: speaks only the configured phrase with browser speech synthesis.
- `browser_notification`: requests permission only from an explicit user gesture; denial produces a receipt without retry loops.
- `start_timer`: creates one local session timer with a configured bounded duration.
- `increment_counter`: updates a named text-only local counter.
- `append_activity_log`: appends a sanitized text entry without movement media.
- `local_snapshot_download`: after a second explicit per-run confirmation, captures one fresh frame, creates a local object URL, triggers one download, and revokes the URL immediately. The snapshot is never uploaded or added to movement history.

### Server adapter

- `signed_webhook_post`: accepts only an approved destination ID and optional server-side `secret_ref`; sends HTTPS POST only; emits a redacted receipt; never accepts image, frame, base64, token, or secret material from the browser.

## Receipt Result

Every adapter returns a bounded result containing `execution_id`, `adapter_type`, `status`, `started_at`, `finished_at`, `attempt_count`, and a safe message. It must not include media, secret values, unrestricted response bodies, or provider credentials.

## Excluded from v1.2

Direct slide control, microphone recording, paid TTS, arbitrary external API calls, arbitrary browser scripting, shell/system commands, and autonomous chained agents are not registered adapters and must fail validation.
