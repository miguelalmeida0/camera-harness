# Signed Webhook Security Policy

## Boundary

`signed_webhook_post` executes only on the DarkQuest server. The browser sends an authorized recipe ID and execution ID, never a destination URL, token, secret value, image, or arbitrary payload.

## Destination Policy

- HTTPS POST only by default.
- Destination must resolve from a server-maintained allowlist ID to a fixed HTTPS origin and path.
- URL credentials, fragments, redirects, protocol changes, and user-controlled hosts are rejected.
- Validate DNS at configuration and immediately before connection. Every resolved A and AAAA address must be public.
- Redirect following is disabled. A redirect response is a failure and is not revalidated implicitly.
- Development-only local destinations require `ALLOW_LOCAL_AUTOMATION_WEBHOOKS=true` and still require an explicit allowlist entry.

Block localhost, metadata, private, link-local, multicast, unspecified, and reserved ranges by default, including:

- `127.0.0.0/8`
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `169.254.0.0/16`
- `0.0.0.0/8`
- `100.64.0.0/10`
- `::1`
- `fc00::/7`
- `fe80::/10`
- cloud metadata endpoints and equivalent platform-specific hostnames

DNS rebinding defenses must pin the validated address for the connection or use an outbound proxy that enforces the same policy.

## Request Limits

- Timeout: maximum 5 seconds for the complete attempt.
- Request body: maximum 16 KiB after serialization.
- Response body read: maximum 16 KiB; discard excess and never return unrestricted body content to the frontend.
- Retry: maximum one, only for a bounded transient network failure, 429, or 5xx.
- Reuse the same execution ID and `Idempotency-Key` header across retry.
- No cookies, ambient browser credentials, or forwarded client authorization headers.

## Secrets and Signing

Recipes may reference a server environment variable name such as:

`secret_ref: "DARKQUEST_WEBHOOK_SECRET_PRESENTATION"`

Secret references are allowlisted server configuration. Secret values never enter recipe storage, frontend responses, diagnostics, or receipts.

When configured, sign the exact serialized body with HMAC-SHA256. Send:

- `X-DarkQuest-Timestamp`: Unix timestamp.
- `X-DarkQuest-Execution-Id`: stable execution ID.
- `X-DarkQuest-Signature`: `v1=<hex digest>` over `<timestamp>.<body>`.
- `Idempotency-Key`: stable execution ID.

Receivers should enforce a short timestamp window and deduplicate the execution ID.

## Safe Payload

```json
{
  "event": "movement.confirmed",
  "movement": "You made a peace sign.",
  "movement_key": "peace_sign",
  "gesture_tags": ["two_fingers_raised"],
  "confidence": 0.87,
  "recipe_id": "recipe_...",
  "execution_id": "execution_...",
  "timestamp": 0
}
```

The payload allowlist is fixed. It excludes raw images, frame URLs, base64, audio, OCR, correction history, provider tokens, webhook secrets, identity, and sensitive attributes.

## Safe Failure Behavior

Validation failure, blocked address, DNS mismatch, timeout, oversized body, missing secret reference, or non-allowlisted destination stops execution before or during the single bounded request sequence. Frontend output is a redacted status and safe error code; server logs contain destination ID, execution ID, timing, and status only.
