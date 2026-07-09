# Gate 1C Static Validation

## Purpose

Gate 1C is the final pre-polish safety gate. Static validation must prove the replay harness and local browser/perception packages are not only replay-compatible but build-checkable enough to support minimal HUD polish.

## Required Checks

Gate 1C tracks:

- `node --check packages/evals/bin/darkquest-eval.mjs`
- package-local TypeScript runtime availability
- `npm run test:adapter`
- `npm run test:recorder`
- `npm run typecheck`
- `npm run gate:0b`
- `npm run gate:1a`
- `npm run gate:1b`
- `npm run gate:1c`
- `npm run physical:validate`
- `npm run verify:physical`

## TypeScript Packages

- `packages/perception/live-perception-adapter`
- `packages/perception/browser-local-capture`
- `packages/replay/live-trace-recorder`
- `packages/perception/event-stabilizer`

## Verdict Impact

- TypeScript/static validation fully passing: Gate 1C may be `PASS` if replay checks pass.
- TypeScript unavailable with accepted waiver: Gate 1C may be `PASS_WITH_DISCLOSURE` if replay checks pass.
- TypeScript unavailable without accepted waiver: Gate 1C is `BLOCKED_STATIC_VALIDATION` after physical trace passes.
- Static command failure: Gate 1C is `FAIL`.

## Waiver Requirements

The waiver file is:

`docs/evals/static-validation-waiver.md`

It must include:

- reason TypeScript cannot run
- evidence that runtime tests passed
- risk accepted
- expiration condition
- human acceptance line

A pending or unsigned waiver is not accepted by Gate 1C.
