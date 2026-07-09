# Gate 3B-Live Command Contract

## `npm run gate:3b`

Purpose: validates the confirmation-bound action suggestion engine architecture and source behavior.

Expected state: `PASS_WITH_DISCLOSURE`.

Output report path: `runs/gate-3b-latest.json`.

Owner: Harness, Evaluation, Memory & Safety Researcher.

If missing: Harness must restore the package script and checker before Gate 3B-Live work continues.

## `npm run gate:3b:live`

Purpose: validates required physical suggestion traces, suggestion metadata, accept/reject behavior, privacy/model invariants, and adversarial failures.

Expected state before traces exist: `BLOCKED_MISSING_SUGGESTION_TRACES`.

Expected state after traces exist: pass only if physical suggestion traces replay and preserve confirmation gating.

Output report path: `runs/gate-3b-live-latest.json`.

Owner: Harness, Evaluation, Memory & Safety Researcher.

If missing: Harness must fix `package.json`.

## `npm run suggestions:report`

Purpose: optional precision/false-positive measurement report if implemented.

Expected state: optional. Missing is acceptable until Harness implements precision reporting.

Output report path: `runs/suggestions-report-latest.json` if implemented.

Owner: Harness, Evaluation, Memory & Safety Researcher.

If missing: Harness may add it when precision measurement starts; do not block Gate 3B-Live solely on this optional script.

## `npm run physical:validate`

Purpose: validates the baseline physical Focus Ritual trace and privacy/provenance invariants.

Expected state: pass.

Output report path: `runs/physical-validate-latest.json`.

Owner: Harness, Evaluation, Memory & Safety Researcher.

If missing: Harness must restore the package script before any live validation claim.

## `npm run gate:1c`

Purpose: validates the physical replay spine and disclosure state that Gate 3B-Live builds on.

Expected state: `PASS_WITH_DISCLOSURE`.

Output report path: `runs/gate-1c-latest.json`.

Owner: Harness, Evaluation, Memory & Safety Researcher.

If missing: Harness must restore the package script before Gate 3B-Live can be trusted.
