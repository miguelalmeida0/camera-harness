# Gate 1D Results

## Claim Being Tested

The local browser app is usable enough for the user to complete Focus Ritual with manual local confirmations, record symbolic events, export a valid physical trace candidate, and run validation, without raw media persistence or model calls.

Gate 1D does not approve minimal HUD polish, cinematic polish, portfolio claims, or production-quality claims. Gate 1D does not replace Gate 1C.

## Current App Status

Current Gate 1D source verdict: `TRYABLE_WITH_MANUAL_CONFIRMATION`

Current operator/browser verdict: pending human run

Current exported trace status: missing

Current Gate 1C status: `BLOCKED_MISSING_PHYSICAL_TRACE`

## Source Audit Result

Latest source audit: PASS

Evidence:

- `runs/gate-1d-latest.json`
- `docs/evals/gate-1D-prototype-source-audit.md`
- `packages/perception/browser-local-capture/test/prototype-flow.test.mjs`

Summary:

- required buttons present
- required panels present
- required zone names present
- required object names present
- manual confirmation disclosure present
- privacy/model/cost status visible
- validation instructions visible
- export logic present
- trace origin generation present
- symbolic event creation present
- quest state transition logic present
- no obvious raw media export APIs found
- no model-call hooks found
- source-level prototype flow exports a Gate 1C-compatible replay fixture
- generated source fixture replays 3 times with 6/6 stable events, 6/6 quest transitions, 6/6 HUD commands, and 0 LLM/VLM calls

## Automated Gate 1D Result

Command:

```sh
npm run gate:1d
```

Result:

```text
TRYABLE_WITH_MANUAL_CONFIRMATION Gate 1D source check
checks: 67/67
```

Interpretation: the source-level app path is tryable with visible manual confirmation. This is not a proof that the browser camera session, export download, or local operator workflow has been completed.

Generated source fixture replay:

```text
PASS live_physical_focus_ritual_001
stable events: 6/6
quest transitions: 6/6
hud commands: 6/6
llm/vlm calls: 0/0
```

## Manual Checklist Status

Status: incomplete

Required evidence:

- completed `docs/evals/gate-1D-manual-checklist.md`
- exported physical replay fixture at `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`
- `npm run physical:validate` PASS
- physical replay repeat 3 PASS
- `npm run gate:1c` PASS or accepted `PASS_WITH_DISCLOSURE`

## Current Check Matrix

| Check | Result | Evidence |
| --- | --- | --- |
| Local app launch status | Not verified in sandbox | `npm run physical:capture` requires local server bind and browser camera permission |
| Camera status | Source control present | `Start Camera`, camera preview, camera permission status |
| Calibration status | Source control present | `Calibrate Zones`, `Save Calibration`, six zone inputs, object assignments |
| Quest controls status | Source control present | `Start Focus Ritual`, five manual confirmations, uncertainty/reset controls |
| Event emission status | Source logic present | `eventSpec`, `emitEvents`, `confirmStepInState` |
| HUD update status | Source logic present | quest state, objective, active zone, progress, last 10 events |
| Recording status | Source control present | `Start Recording`, `Stop Recording`, recording state |
| Export status | Source logic present | `Export Physical Trace`, `buildReplayFixture` |
| Privacy/model status | Source status present | raw media false, cloud disabled, LLM/VLM 0, cost $0 |
| Validation command status | Present | `npm run physical:validate`, physical replay repeat, `npm run gate:1c` |
| Physical trace validation | Blocked | required fixture missing |
| Gate 1C | Blocked | `BLOCKED_MISSING_PHYSICAL_TRACE` |

## Validation Commands

Executed in this workspace:

```sh
npm run gate:1d
node --check packages/evals/bin/darkquest-eval.mjs
node packages/evals/bin/darkquest-eval.mjs gate-1c fixtures/replay/gate_1c_manifest.json
npm run physical:validate
npm run gate:1c
npm run test:adapter
npm run test:recorder
npm run typecheck
```

Observed results:

- `npm run gate:1d`: `TRYABLE_WITH_MANUAL_CONFIRMATION`
- source fixture replay repeat 3: PASS
- `node --check packages/evals/bin/darkquest-eval.mjs`: PASS
- direct Gate 1C runner: `BLOCKED_MISSING_PHYSICAL_TRACE`
- `npm run physical:validate`: `BLOCKED_MISSING_PHYSICAL_TRACE`
- `npm run gate:1c`: `BLOCKED_MISSING_PHYSICAL_TRACE`
- `npm run test:adapter`: PASS
- `npm run test:recorder`: PASS
- `npm run typecheck`: PASS

Expected blockers while physical trace is missing:

- `npm run physical:validate`: blocks
- `npm run gate:1c`: blocks

## Final Verdict

Gate 1D source verdict: `TRYABLE_WITH_MANUAL_CONFIRMATION`

Gate 1D trace/export verdict: not `TRACE_EXPORT_WORKING` until the physical fixture exists and validates

Gate 1C verdict remains: `BLOCKED_MISSING_PHYSICAL_TRACE`
