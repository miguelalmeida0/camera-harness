# Gate 1C Local Operator Validation Report

Fill this in after running the physical browser webcam capture.

## Physical Trace Run Report

1. Physical trace path:
   - `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`

2. `trace_origin`:
   - `source`:
   - `generated_by`:
   - `capture_mode`:
   - `physical_capture`:
   - `operator_confirmed_physical_session`:
   - `manual_fixture`:
   - `raw_media_persisted`:
   - `cloud_calls_enabled`:
   - `browser_latency_recorded`:

3. Latency p50/p95/max:
   - p50:
   - p95:
   - max:

4. Dropped frames:

5. LLM/VLM calls:
   - LLM:
   - VLM:

6. Raw media persistence count:

7. Commands run:
   - `npm run verify:physical`
   - `npm run physical:validate`
   - `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_physical_focus_ritual_001.v0.json`
   - `npm run gate:0b`
   - `npm run gate:1a`
   - `npm run gate:1b`
   - `npm run gate:1c`
   - `npm run test:adapter`
   - `npm run test:recorder`
   - `npm run typecheck`

8. Physical replay result:

9. Gate 1C result:

10. Errors:

11. Ready for minimal HUD polish? yes/no

## Operator Assertion

The physical trace was captured from a real local browser webcam session, not hand-authored, synthetic, or copied from browser-origin symbolic test fixtures.

Operator initials:

Date:
