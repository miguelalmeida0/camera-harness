# Instant Gesture Runtime Closure Handoff

## Multimodal Handoff

1. Replace all lower-level automation imports in `local-capture.js` with `automation/index.js` and delete local compatibility validators/runners.
2. Wire real worker observations through mapping, stabilization, and the canonical `runAutomationForStableLocalGesture` call. Do not touch `movementResultSnapshot`, Describe, Confirm, or provider code.
3. Consolidate activation, engine status, worker, and stabilizer ownership in one controller outside render functions.
4. Implement canonical recipe migration to `schema: darkquest.movement_automation_recipe.v1-1`; legacy recipes remain confirmed until explicit conversion consent.
5. Emit `first_seen_ms`, `stable_at_ms`, `held_for_ms`, `hand_count`, `requires_neutral_reset`, and `contains_raw_media: false` on every stable event.
6. Return the exact stabilizer, activation, recipe, action, recursion, cooldown, and idempotency codes from the closure architecture.
7. Pass canonical `action.config.text` to speech and execute `Great job` once without confirmation.
8. Preserve the frozen hierarchy and compact status only; do not add a dashboard or move the result card.

## Harness Handoff

1. Update Gate v1.2 and the instant gate to import browser `automation/index.js` and server `automation/index.mjs`; remove policy copies and lower-level automation imports.
2. Reject a passing synthetic runner test when no browser worker-observation path invokes the canonical instant runner.
3. Drive mapping and stabilization through the simulated browser lifecycle with toggle, camera, visibility, engine status, neutral reset, and cooldown.
4. Assert no Confirm handler, Describe handler, movement result, VLM/provider helper, or analysis fetch is invoked.
5. Assert every required outcome code exactly; broad legacy codes do not satisfy closure.
6. Assert stable event field completeness and raw-media absence.
7. Prove held thumbs-up speaks `Great job` once, duplicate delivery is idempotent, and a later neutral-reset/cooldown cycle permits exactly one second run.
8. Require `gate:v1:instant-automation` to reach 115/115 while preserving existing product, research, automation, recipe, and type checks.

## Ownership Boundary

Multimodal owns live browser wiring and event production. Harness owns executable browser-path proof. Neither may weaken confirmed AI movement, snapshot, webhook, media, privacy, or design-freeze boundaries.
