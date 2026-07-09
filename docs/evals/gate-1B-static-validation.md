# Gate 1B Static Validation

## Purpose

Gate 1B tracks build/static validation explicitly because browser-local perception packages can look correct from replay fixtures while still failing TypeScript or package-level tests.

## Required Checks

The Gate 1B report must include:

- whether `node --check packages/evals/bin/darkquest-eval.mjs` passes
- whether TypeScript compile passes for local TypeScript packages
- whether package scripts exist
- whether local TypeScript dependencies exist
- whether runtime tests pass
- whether missing TypeScript blocks demo approval

## Current Policy

If TypeScript compile cannot run, Gate 1B cannot be full `PASS`. It can only be `PASS_WITH_DISCLOSURE` at best, even when required replay fixtures pass.

## Static Surface

Packages with TypeScript contracts:

- `packages/perception/event-stabilizer`
- `packages/perception/live-perception-adapter`
- `packages/perception/browser-local-capture`
- `packages/replay/live-trace-recorder`

Expected package scripts:

- `build`
- package-specific live or Gate 1A tests where present

## Blocking Rules

- Missing required package scripts: disclosure unless the package is on the live browser path.
- Missing local TypeScript dependency: disclosure unless compile is required for demo approval.
- TypeScript compile failure: `FAIL`.
- Runtime test failure: `FAIL`.
- `node --check` failure for the eval runner: `FAIL`.
