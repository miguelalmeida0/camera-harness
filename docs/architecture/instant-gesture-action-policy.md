# Instant Gesture Action Policy

## Decision

Stable local gestures may automatically execute only bounded local actions after both recipe-level instant consent and session activation. The policy is source-aware and fails closed before adapter planning.

## Instant Allowlist

| Action | Instant status | Conditions |
| --- | --- | --- |
| `speak_phrase` | Allowed | Text capped; one utterance per event; no loop retry |
| `increment_counter` | Allowed | Text-only named counter; bounded session runs |
| `start_timer` | Allowed | Bounded local duration; no duplicate timer for one event |
| `append_activity_log` | Allowed | Text-only capped entry and log |
| `browser_notification` | Conditional | Permission already `granted`; no prompt from recognition event |

## Instant Denylist

- `local_snapshot_download`.
- `signed_webhook_post`.
- Any image, audio, video, microphone, screenshot, or media capture.
- Any external network or server side effect other than the conditional browser notification above.
- Any future paid API action.
- Any arbitrary JavaScript, browser script, shell, system, or destructive command.
- Any LLM/VLM, movement-analysis, provider fallback, or summarization request.

Denied combinations are invalid recipes; they are not silently converted to instant actions. They retain the `confirmed_ai_movement` confirmation path.

## Consent Model

### 1. Recipe creation consent

The user explicitly selects `Run instantly when this local gesture is recognized`. Consent binds the canonical gesture, threshold, hold time, action type, safe configuration summary, and policy version. Any material change invalidates it.

### 2. Session activation consent

The user explicitly enables `Instant gestures`. It is off on first load. That preference may be stored locally after the user changes it, but recipe import cannot activate it. Runtime activation is derived from the preference, active camera, visible document, and ready local engine. Camera stop, permission loss, or hidden tab disarms recognition and prevents execution even when the saved preference remains on.

### 3. Per-run consent

No per-run confirmation is required for allowlisted Tier 0 instant actions. A pre-permitted browser notification may also execute without another prompt. Snapshot, webhook, media, external, paid, and higher-risk actions remain per-run or movement-confirmation gated and cannot use instant mode.

## Authorization Order

1. Validate stable event schema and supported gesture key.
2. Verify camera active, tab visible, worker ready, and Instant gestures active.
3. Validate enabled v1.1 recipe, instant consent version, and exact source/gesture match.
4. Verify confidence, hold, and neutral-reset requirements.
5. Verify instant action allowlist and any pre-existing browser permission.
6. Verify recipe cooldown and session run limits.
7. Reserve `gesture_event_id + recipe_id` atomically.
8. Execute once and write one compact text-only receipt.
