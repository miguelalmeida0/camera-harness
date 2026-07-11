# Automation Public API v1

## Decision

The application runtime and automation harness must import the same canonical module:

`packages/perception/browser-local-capture/prototype/automation/index.js`

`local-capture.js` imports these functions from the index and may re-export the same bindings for compatibility. It must not implement argument-shape adapters, duplicate validators, or separate policy logic. Both automation checks import the browser index directly. Server automation checks import `packages/perception/browser-local-capture/server/automation/index.mjs` directly.

## Required Exports

```ts
validateAutomationRecipe(input, options = {})
matchAutomationRecipes(sourceEvent, recipes = [], context = {})
createAutomationRuntimeState(recipes = [])
transitionAutomationState(runtime, nextState, safeMessage = "")
automationIdempotencyKey(sourceEventId, recipeId)
runAutomationForConfirmedMovement(options)
runAutomationForStableLocalGesture(options)
executeLocalAutomationAction(options)
clearAutomationActivityLog(runtime)
```

No canonical export accepts multiple guessed aliases for the same argument. Compatibility normalization belongs at one temporary boundary and is not used by the harness.

## Runner Inputs

```ts
type ConfirmedMovementRunOptions = {
  snapshot: CanonicalMovementResultV1 & { confirmed: true };
  recipes: MovementAutomationRecipeV11[];
  runtime: AutomationRuntimeState;
  now?: number;
  actionExecutor?: typeof executeLocalAutomationAction;
  requestConsent?: (request: ConsentRequest) => boolean | Promise<boolean>;
  context?: AutomationExecutionContext;
};

type StableGestureRunOptions = {
  gestureEvent: StableLocalGestureEventV1;
  recipes: MovementAutomationRecipeV11[];
  runtime: AutomationRuntimeState;
  now?: number;
  actionExecutor?: typeof executeLocalAutomationAction;
  context?: AutomationExecutionContext;
};
```

`runAutomationForStableLocalGesture` must reject any non-instant recipe, missing session activation, unsupported gesture, invalid neutral-reset state, or non-allowlisted action before adapter execution. It cannot accept a movement result as a substitute.

## Matcher Contract

`matchAutomationRecipes` returns an ordered array of validated recipes. It selects by source:

- confirmed canonical movement -> `execution_mode: confirmed_ai_movement`;
- stable local gesture -> `execution_mode: instant_local_gesture`.

It performs no side effect, network call, permission prompt, receipt write, or model call.

## State and Idempotency

- `createAutomationRuntimeState` owns recipes, session activation, cooldowns, run counts, idempotency keys, receipts, and instant lifecycle state outside render functions.
- `automationIdempotencyKey` receives the actual source event ID: `movement_result_id` or `gesture_event_id`.
- `transitionAutomationState` uses one transition table shared by both runners.
- `clearAutomationActivityLog` clears text-only activity entries without changing recipes or consent.

## Alignment Requirements

- The recipe validator, matcher, runners, local adapter, application, and harness import this entrypoint.
- The risk/action names come from the runtime registry. Canonical webhook type is `signed_webhook_post`.
- Canonical speech config is `text`; v1 `phrase` is accepted only by migration.
- The harness must not maintain a conflicting hard-coded risk table. It tests behavior through validation and runners.
- The current gate claim expands from confirmed-only automation to source-specific authorization without weakening confirmed AI movement checks.
- No gate or runtime may import `recipe-store.js`, `recipe-matcher.js`, `automation-engine.js`, or `local-action-adapters.js` directly. Lower-level module tests may do so, but they cannot satisfy the browser-runtime release acceptance path.
