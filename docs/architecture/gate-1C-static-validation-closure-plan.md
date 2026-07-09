# Gate 1C Static Validation Closure Plan

Current static status: partially passing, not fully closed.

## What Passes Now

- `node --check packages/evals/bin/darkquest-eval.mjs` passes.
- `npm run typecheck` passes.
- Runtime replay gates can execute under Node without package-local TypeScript compilation.

## What Remains Unresolved

Package-local TypeScript builds still fail because `tsc` is not available in the package-local runtime.

Failing command:

```sh
npm --prefix packages/perception/browser-local-capture run build
```

Observed failure:

```text
sh: tsc: command not found
```

## Tool Availability

- Root `npm run typecheck`: passes.
- Package-local `tsc`: missing.
- `packages/perception/browser-local-capture/node_modules/.bin/tsc`: missing.

## Closure Path

Preferred closure:

1. Install or restore package-local TypeScript dependency according to repo policy.
2. Run `npm --prefix packages/perception/browser-local-capture run build`.
3. Re-run `npm run typecheck`.
4. Re-run Gate 1C.

Temporary disclosure path:

1. Complete the physical trace first.
2. Confirm physical replay passes deterministically.
3. Keep privacy, model, memory, latency, HUD, and adversarial exact-code checks passing.
4. Add explicit human acceptance to `docs/evals/static-validation-waiver.md`.

## Waiver Boundary

Physical trace cannot be waived.

TypeScript compile may be temporarily waived only after physical trace passes, and only for minimal HUD polish.

The waiver cannot support production-quality claims, cinematic HUD polish, public demo claims, privacy claims beyond replay proof, or any relaxation of raw-media/model-call checks.
