# Automation Recipe Storage Policy

## Initial Storage

Use browser IndexedDB for validated recipes, with localStorage permitted as a small-scale fallback. The storage namespace is versioned, for example `darkquest.automation.recipes.v1`.

Stored recipe records are text/config only:

- validated `movement-automation-recipe.v1` fields;
- recipe consent version and timestamp;
- safe destination IDs and `secret_ref` names, never destination secrets;
- no execution capabilities or arbitrary functions.

## Limits

- Maximum 100 recipes.
- Maximum 16 KiB serialized size per recipe.
- Maximum 20 aliases per recipe.
- Reject unknown action types and invalid schema versions during load and import.
- Migration is explicit by schema version; invalid records remain disabled until corrected.

## Import and Export

Configuration import/export is allowed as text-only versioned data. Import performs full schema, adapter, risk, size, and prohibited-field validation before any write. Imported recipes are disabled until the user reviews and consents to them; consent is never imported as active authorization.

Exports exclude secret values, receipts, movement history, correction memory, provider tokens, media, and browser permission state.

## Prohibited Storage

- Raw frames, screenshots, object URLs, base64, audio, OCR, or media-derived binary data.
- `HF_TOKEN` or any provider token.
- Webhook secret values, authorization headers, cookies, or unrestricted destination URLs.
- Arbitrary JavaScript, shell commands, executable code, or arbitrary HTTP methods.

Secret references are identifiers only and resolve on the server after authorization.

## Receipts

Receipts are in memory or sessionStorage by default, text-only, clearable, and capped at 50 records and 2 KiB per record. They expire with the browser session. A receipt stores safe status metadata, not webhook response bodies or media.

Persistent receipts are future work and require explicit opt-in, retention controls, and a separate policy review.

## Clearing

Users can clear recipes, recipe consent, local counters/logs, and receipts independently. Clearing recipes also clears associated consent and cooldown state. It does not affect provider configuration or movement history.
