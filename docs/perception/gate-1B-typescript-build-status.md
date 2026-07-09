# Gate 1B TypeScript Build Status

## Summary

Gate 1B runtime validation passes, but full TypeScript compilation is blocked in this environment because `tsc` is not installed and npm cannot reach the registry.

Verdict impact: `PASS_WITH_DISCLOSURE`.

## Commands That Passed

```sh
npm run test:adapter
npm run test:recorder
npm run typecheck
npm run gate:1b
```

Results:

- adapter tests passed
- browser-local capture boundary test passed
- recorder tests passed
- `node --check` passed for executable JS files
- Gate 1B manifest returned `PASS_WITH_DISCLOSURE`

## Commands That Failed

```sh
npm --prefix packages/perception/live-perception-adapter run build
npm --prefix packages/perception/browser-local-capture run build
npm --prefix packages/replay/live-trace-recorder run build
npm --prefix packages/perception/event-stabilizer run build
```

Failure:

```text
sh: tsc: command not found
```

## Dependency/Network Check

```sh
npm --prefix packages/perception/live-perception-adapter install --package-lock-only --dry-run
```

Failure:

```text
getaddrinfo ENOTFOUND registry.npmjs.org
```

## Interpretation

The TypeScript packages declare `typescript` in `devDependencies`, but no local `node_modules` TypeScript runtime is present. Network access is restricted, so npm cannot fetch TypeScript during this run.

Runtime validation uses Node's `--experimental-strip-types`, which is enough to execute the local tests but is not a substitute for `tsc -p`.

Full Gate 1B `PASS` should wait until `npm install` or an equivalent local TypeScript runtime is available and all package builds pass.
