# DarkQuest v1.2 Automation Adversarial Matrix

Gate command: `npm run gate:v1:automation`

The judge must execute exported pure functions. Documentation and UI strings are not acceptance evidence. Unless noted, every case requires zero LLM/VLM calls, zero raw-media access, and a stable replayable receipt or failure code.

| # | Claim being tested | Executable test | Pass criteria | Required evidence / failure code |
|---:|---|---|---|---|
| 1 | Unconfirmed AI output cannot automate | Run the engine with `confirmed: false` | Zero matches and executions | `automation_before_confirmation` |
| 2 | Uncertain output cannot automate | Run with `confirmed: true`, `uncertainty: true` | Zero executions | `automation_from_uncertain_result` |
| 3 | Rejected output cannot automate | Run with `rejected: true` | Zero executions | `automation_from_rejected_result` |
| 4 | Duplicate confirm is idempotent | Submit the same result/recipe pair twice | Exactly one receipt and execution | `automation_duplicate_execution` on violation |
| 5 | Duplicate browser event is harmless | Repeat the same idempotency key | Adapter side effect occurs once | Stable `result_id + recipe_id` receipt |
| 6 | Cooldown cannot be bypassed | Match before cooldown expiry | No match | `automation_match_during_cooldown` |
| 7 | Disabled recipe is inert | Match an otherwise valid disabled recipe | No match | `automation_match_disabled_recipe` |
| 8 | Confidence threshold is enforced | Match below `min_confidence` | No match | `automation_match_below_confidence` |
| 9 | Unknown adapter is rejected | Validate an unknown action type | Invalid recipe | `automation_recipe_unknown_action` |
| 10 | Arbitrary JavaScript is forbidden | Put JavaScript in action config | Invalid recipe | `automation_recipe_unsafe_code` |
| 11 | Shell commands are forbidden | Put a shell command in action config | Invalid recipe | `automation_recipe_unsafe_code` |
| 12 | Raw image cannot enter webhook payload | Build a request containing a data URI | Request rejected | `automation_webhook_raw_media` |
| 13 | Provider token cannot enter recipe config | Put `HF_TOKEN`-like data in config | Invalid recipe | `automation_recipe_contains_secret` |
| 14 | Localhost webhook is blocked by default | Validate localhost without dev flag | Destination rejected | `automation_webhook_ssrf_blocked` |
| 15 | Metadata service is blocked | Validate `169.254.169.254` | Destination rejected | `automation_webhook_ssrf_blocked` |
| 16 | Redirect cannot cross into private IP space | Return a 302 to loopback/private IP | Redirect rejected, no follow | `automation_webhook_redirect_blocked` |
| 17 | Snapshot requires second consent | Execute Tier 2 snapshot without consent | No capture or download | `automation_snapshot_without_confirmation` |
| 18 | Hidden browser tab cannot initiate work | Invoke UI path with `document.hidden` | No movement or automation request | No execution receipt |
| 19 | Recipe execution cannot recurse | Attempt to invoke the runner from its adapter | One bounded execution only | `automation_recursive_execution` |
| 20 | Session action cap is enforced | Exceed configured session limit | Additional action rejected | `automation_session_limit_exceeded` |
| 21 | Corrected identity is canonical | Confirm a corrected result with canonical key | Match uses canonical key only | Receipt references corrected result ID |
| 22 | Camera rerender is side-effect free | Rerender live camera after a result | No matcher or adapter call | No new receipt |
| 23 | Result-card rerender is side-effect free | Rerender the same `result_id` | No matcher or adapter call | No new receipt |
| 24 | Retry count is bounded | Force deterministic adapter failure | Attempts do not exceed configured cap | `automation_retry_limit_exceeded` on violation |
| 25 | Webhook allowlist is mandatory | Validate an unlisted public HTTPS URL | Destination rejected | `automation_webhook_not_allowlisted` |
| 26 | Webhook payload is bounded | Build a request over payload limit | Request rejected before fetch | `automation_webhook_payload_too_large` |

## Approval Gate

- `BLOCKED_MISSING_AUTOMATION_ENGINE`: one or more required pure engine exports are absent.
- `BLOCKED_MISSING_ACTION_ADAPTERS`: engine exists, but a local/webhook adapter or bounded secondary UI hook is absent.
- `FAIL`: executable behavior ran and violated at least one critical assertion.
- `PASS_WITH_DISCLOSURE`: all deterministic tests pass; physical notification, timer, snapshot download, and approved webhook behavior still require controlled browser/server verification.
- `PASS`: reserved for deterministic tests plus controlled live adapter evidence with no unresolved disclosure.
