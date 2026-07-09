# Gate 1A Handoff

## To Systems Research Architect

- Schema mismatch: adapter-local `EvidenceRef` uses `local_signal` and `contains_raw_media:false`; replay export converts this to v0 fixture evidence with `contains_raw_media:false` preserved.
- Hard live event types: `gesture.detected` is the riskiest to produce from real camera input without false positives.
- Adapter boundary issue: browser capture is not implemented here; the package starts at `LocalObservationFrame`.
- Evidence format issue: v0 runner accepts evidence refs by `ref` or `id`; exported live fixtures use `ref` and preserve the raw-media false flag.
- Package boundary issue: `packages/replay/live-trace-recorder` imports the adapter source directly until a workspace package graph exists.
- Latency risk: browser frame capture, worker extraction, and HUD update timings are not measured yet.
- No-cloud/no-raw-media risk: current packages contain no model SDKs and write only symbolic JSON; keep this invariant in browser integration.

## To Harness, Evaluation, Memory & Safety Researcher

Live trace fixtures:

- `fixtures/replay/live/live_phone_moved_001.v0.json`
- `fixtures/replay/live/live_notebook_opened_001.v0.json`
- `fixtures/replay/live/live_pen_picked_up_001.v0.json`
- `fixtures/replay/live/live_writing_motion_001.v0.json`
- `fixtures/replay/live/live_typing_motion_001.v0.json`
- `fixtures/replay/live/live_focus_ritual_001.v0.json`

Validation commands run:

```sh
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/focus_ritual_happy_path.v0.json
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/live/live_focus_ritual_001.v0.json
```

Replay results:

- Happy path: PASS.
- Gate 0B suite: PASS.
- Full live symbolic trace: PASS.
- Controlled live fixtures: PASS.

Known failing traces:

- None among required controlled symbolic fixtures.
- Real browser capture traces are not generated yet.

Privacy notes:

- Raw video persisted: false.
- Raw frame persisted: false.
- Raw audio persisted: false.
- Notebook text persisted: false.
- Model calls: 0 LLM, 0 VLM.

Recommended Gate 1A verdict:

PASS for the symbolic adapter/recorder/export/replay path. Keep cinematic HUD polish blocked until real browser-local observation frames produce the same passing replay trace.

