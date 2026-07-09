# Gate 1B Static And Build Validation Plan

## Current Issue

Gate 1A runtime tests passed with Node 26 type stripping, but TypeScript compile was not run because a local TypeScript install was unavailable and network access for `npx` failed.

That is enough for runtime confidence, not enough for full Gate 1B PASS. Browser-local perception adds package interfaces where type drift can hide boundary violations.

## Decision

Gate 1B can only be full `PASS` when static validation and runtime replay both pass. If TypeScript compile cannot run, Gate 1B can only be `PASS_WITH_DISCLOSURE`, even if replay succeeds.

## Required Path

Use local repo dependencies. Do not require network access during validation unless it is explicitly available.

Required package work:

- add a local TypeScript dev dependency if package policy allows;
- add `typecheck` script;
- add `gate:1b` script;
- add `test:adapter` script;
- add `test:recorder` script;
- keep `node --check` for JS runner syntax;
- run TypeScript compile when available;
- record static-build status in Gate 1B results.

## Proposed Scripts

Root package script names, or equivalent package-local scripts:

```json
{
  "scripts": {
    "typecheck": "tsc -b packages/perception/live-perception-adapter packages/replay/live-trace-recorder packages/perception/event-stabilizer",
    "gate:1b": "node packages/evals/bin/darkquest-eval.mjs gate-1b fixtures/replay/gate_1b_manifest.json",
    "test:adapter": "node --test packages/perception/live-perception-adapter/test/*.ts",
    "test:recorder": "node --test packages/replay/live-trace-recorder/test/*.ts",
    "check:runner": "node --check packages/evals/bin/darkquest-eval.mjs"
  }
}
```

Package-local variants are acceptable if the repo stays package-scoped.

## Validation Sequence

```sh
node --check packages/evals/bin/darkquest-eval.mjs
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/focus_ritual_happy_path.v0.json
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1a fixtures/replay/gate_1a_manifest.json
```

When Gate 1B exists:

```sh
node packages/evals/bin/darkquest-eval.mjs gate-1b fixtures/replay/gate_1b_manifest.json
```

When TypeScript is locally available:

```sh
npm run typecheck
npm run test:adapter
npm run test:recorder
```

## Disclosure Rules

| Condition | Gate 1B result |
| --- | --- |
| Replay passes, browser trace passes, TypeScript compile passes | `PASS` |
| Replay passes, browser trace passes, TypeScript unavailable | `PASS_WITH_DISCLOSURE` |
| Required browser trace missing | `BLOCKED_MISSING_BROWSER_TRACE` |
| Browser trace fails replay | `FAIL` |
| Raw media persistence nonzero | `FAIL` |
| LLM/VLM calls nonzero | `FAIL` |
| TypeScript compile runs and fails | `FAIL` |

## No-Network Rule

Do not use `npx` or install dependencies from the network as a hidden validation step. If network is unavailable, report the limitation and keep Gate 1B at `PASS_WITH_DISCLOSURE` maximum.
