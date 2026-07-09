# Gate 1C TypeScript Build Status

## Summary

Runtime validation can run with Node's type stripping, but package-local TypeScript builds remain unresolved until `tsc` is available.

## Scripts

Verified scripts:

- `npm run test:adapter`
- `npm run test:recorder`
- `npm run gate:1c`
- `npm run typecheck`

## Commands Run

```sh
node --check packages/evals/bin/darkquest-eval.mjs
npm run test:adapter
npm run test:recorder
npm run typecheck
```

Result: PASS.

Package build commands:

```sh
npm --prefix packages/perception/live-perception-adapter run build
npm --prefix packages/perception/browser-local-capture run build
npm --prefix packages/replay/live-trace-recorder run build
npm --prefix packages/perception/event-stabilizer run build
```

Result: FAIL for all package-local builds.

Exact error:

```text
sh: tsc: command not found
```

Dependency dry run:

```sh
npm --prefix packages/perception/browser-local-capture install --package-lock-only --dry-run
```

Result:

```text
getaddrinfo ENOTFOUND registry.npmjs.org
```

## Interpretation

The package manifests declare TypeScript, but package-local `node_modules` are not installed and there is no `tsc` binary available. Installing the dependency requires network access to `registry.npmjs.org` unless TypeScript is already available in a local cache.

## Gate Impact

If the physical trace is missing, Gate 1C is `BLOCKED_MISSING_PHYSICAL_TRACE`.

If the physical trace passes but TypeScript is still missing, full approval requires either:

- successful package-local TypeScript builds, or
- an explicit accepted static-validation waiver scoped only to minimal HUD polish.

Without a physical trace, a TypeScript waiver does not unblock minimal HUD polish.

Current Gate 1C status: `BLOCKED_MISSING_PHYSICAL_TRACE`.
