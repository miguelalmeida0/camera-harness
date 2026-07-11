# Automation Public API v1.2.1

## Canonical Entrypoints

- Browser: `packages/perception/browser-local-capture/prototype/automation/index.js`
- Server: `packages/perception/browser-local-capture/server/automation/index.mjs`

The browser runtime and both automation gates import these indexes. They must not import lower-level automation engine, matcher, store, adapter, receipt, webhook, or movement-recognition server modules directly.

## Required Browser Exports

- `validateAutomationRecipe`
- `matchAutomationRecipes`
- `createAutomationRuntimeState`
- `transitionAutomationState`
- `automationIdempotencyKey`
- `runAutomationForConfirmedMovement`
- `runAutomationForStableLocalGesture`
- `executeLocalAutomationAction`
- `clearAutomationActivityLog`

The browser index may expose additional runtime helpers, but these nine names are stable public API.

## Required Server Exports

- `validateAutomationWebhookDestination`
- `buildSignedAutomationWebhookRequest`
- `executeSignedAutomationWebhook`

Secrets remain server-side. The browser index must not re-export webhook signing or execution functions.

## Runtime Separation

`runAutomationForConfirmedMovement` accepts only confirmed, non-uncertain canonical movement results. `runAutomationForStableLocalGesture` accepts only `stable-local-gesture-event.v1` and explicit instant consent. Neither path may call the other or initiate movement recognition.
