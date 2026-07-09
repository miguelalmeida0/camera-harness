# Gate 1C Handoff

## Current State

Gate 1C remains `BLOCKED_MISSING_PHYSICAL_TRACE`.

Required trace:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

## Operator App

Run:

```sh
npm run physical:capture
```

Fallback:

```sh
npm run physical:capture -- --port 4180
```

The app now includes Operator Mode, What To Do If Stuck, Export Save-Path Assistant, Event Sequence Inspector, dry-run/physical separation, and `darkquest_operator_bug_report.json` export.

## Validation

```sh
npm run physical:validate
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run gate:1c
npm run gate:1d
npm run gate:1e
```

## Boundaries

- Manual confirmation is not autonomous vision.
- No raw media, screenshots, base64 media, audio, OCR, notebook text, LLM calls, or VLM calls are permitted.
- Gate 2 remains blocked until the real physical trace validates and replays.
