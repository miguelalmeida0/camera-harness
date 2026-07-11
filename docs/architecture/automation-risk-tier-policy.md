# Automation Risk Tier Policy

## Decision

Every recipe is evaluated using the greater of its declared tier and the adapter-computed tier. A recipe cannot lower risk through configuration. User movement confirmation remains required for `confirmed_ai_movement` and for every media, webhook, or external action.

The only v1.2.1 exception is `instant_local_gesture`: after explicit recipe consent and session activation, a stabilized MediaPipe gesture may execute an allowlisted Tier 0 local action without per-event confirmation. Browser notification is conditionally allowed only when permission was granted before recognition. All other Tier 1 and Tier 2 actions are invalid in instant mode.

| Tier | Scope | Initial adapters | Authorization |
| --- | --- | --- | --- |
| 0 | UI-only or local text/session state | `speak_phrase`, `start_timer`, `increment_counter`, `append_activity_log` | Confirmed movement plus explicit saved recipe consent |
| 1 | Bounded external side effect | `browser_notification`, `signed_webhook_post` | Confirmed movement, explicit recipe consent, required browser/server configuration, and clear receipt |
| 2 | Media or sensitive capture side effect | `local_snapshot_download`; future approved capture operations | Confirmed movement plus a second explicit per-run confirmation; never silent |
| 3 | Prohibited | Arbitrary scripting, shell, finance, unrestricted APIs, destructive actions, continuous recording | Cannot be authorized in v1.2 |

## Consent Rules

- Recipe creation or enablement records recipe-level consent for the exact action type and redacted configuration summary.
- Selecting `Run instantly` is separate recipe consent for the exact local gesture, threshold, hold time, action, and configuration.
- `Instant gestures` is off by default and requires session activation before local gesture events can execute.
- Material action configuration changes invalidate prior recipe consent.
- Movement confirmation is scoped to one `movement_result_id` and cannot authorize a later result.
- Tier 2 per-run confirmation describes the exact pending side effect and expires when the result, recipe, or plan changes.
- Closing the consent surface, hiding the tab, or starting a new movement cancels pending authorization.
- Hiding the tab, stopping the camera, or ending the session disarms instant recognition and clears pending candidates.

## Policy Gate Order

1. Validate confirmed, non-uncertain canonical result.
2. Validate enabled recipe and registered adapter.
3. Compute effective risk tier.
4. Check recipe consent and configuration version.
5. Check cooldown and per-session rate.
6. Check tab visibility and browser/server permissions.
7. Require per-run confirmation when policy or effective tier requires it.
8. Issue one immutable execution plan.

For `instant_local_gesture`, steps 1 and 7 are replaced by validation of the stable local gesture event, recipe instant consent, active session consent, action allowlist, neutral-reset state, cooldown, and session rate. No model confidence or VLM confirmation is substituted for these checks.

## Tier 3 Prohibitions

- Arbitrary JavaScript, browser scripting, shell, or system commands.
- Financial transactions or credential changes.
- Unrestricted URL/API calls or arbitrary HTTP methods.
- Destructive commands.
- Continuous recording or capture.
- Background automation while the tab is hidden.
- Autonomous action chains or model-selected tools.

Policy denial is final for that plan and creates a text-only denial receipt. It must not trigger another AI call or silently downgrade the action.
