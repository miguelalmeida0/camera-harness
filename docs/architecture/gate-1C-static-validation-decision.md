# Gate 1C Static Validation Decision

## Current Issue

Package-local TypeScript builds have not run because local TypeScript binaries are not installed. Network install through `npm` or `npx` previously failed. Runtime tests using Node 26 type stripping are useful but not enough for full Gate 1C PASS.

## Decision

Full Gate 1C `PASS` requires package-local TypeScript validation. `PASS_WITH_DISCLOSURE` may be accepted only with an explicit static-validation waiver. Without a waiver, Gate 1C remains blocked once physical trace replay succeeds.

## Preferred Path

- Add or restore local TypeScript dependency according to package policy.
- Run validation without network dependency.
- Add or use package scripts for `typecheck`, `gate:1c`, adapter tests, recorder tests, and browser-local capture tests.
- Keep `node --check packages/evals/bin/darkquest-eval.mjs` as JS runner syntax validation.

## Fallback Path

A temporary static-validation waiver may allow minimal HUD polish only. It must not support production-quality claims, cinematic polish, physical-provenance claims, or model/privacy claims beyond what replay has proven.

## Waiver Requirements

The waiver must include:

- reason;
- risk;
- runtime evidence that passed;
- expiration condition;
- human acceptance line;
- allowed polish scope;
- forbidden claims under waiver.

Required acceptance format:

```text
Disclosure accepted:
- disclosure:
- reason:
- scope:
- expiration:
- accepted_by:
- date:
```

## Expiration

The waiver expires when local TypeScript validation becomes available, when package boundaries change, when live capture code changes, or before any production-readiness claim.

## Allowed Under Waiver

- minimal layout cleanup;
- typography;
- state-backed timeline display;
- confidence/status presentation;
- recovery panel styling.

## Forbidden Under Waiver

- production-quality claim;
- cinematic HUD polish;
- fake progress;
- hidden uncertainty;
- hidden low confidence;
- new model route;
- raw media retention;
- physical webcam provenance waiver.

