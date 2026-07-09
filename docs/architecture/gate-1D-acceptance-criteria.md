# Gate 1D Acceptance Criteria

Gate 1D is the tryable local app MVP gate. It checks whether the user can actually operate DarkQuest locally, not whether autonomous perception or demo polish is ready.

## Pass Criteria

Gate 1D passes if:

- `npm run physical:capture` starts the local app.
- User can turn on camera.
- User can calibrate required zones.
- User can start Focus Ritual.
- User can start recording.
- App can emit symbolic events for all six Focus Ritual steps.
- User can use manual local confirmation if automatic detection is not ready.
- Debug HUD updates quest state.
- Event timeline updates.
- Privacy/model status remains visible.
- User can stop recording.
- User can export trace JSON.
- Trace can be validated or gives a clear validation error.
- No raw media is persisted.
- No model calls occur.

## Fail Criteria

Gate 1D fails if:

- camera is the only working feature;
- user cannot calibrate zones;
- user cannot start the ritual;
- user cannot emit events;
- quest state does not update;
- event timeline does not update;
- privacy/model state is hidden;
- trace cannot be exported;
- validation path is unclear;
- raw media is persisted;
- model calls occur.

## Required Ritual Coverage

The local app must be able to emit symbolic events for:

- phone moved away;
- notebook opened;
- pen picked up;
- writing motion;
- typing motion;
- quest completion.

Zone calibration must cover:

- phone zone;
- notebook zone;
- pen/tool zone;
- keyboard zone;
- neutral zone;
- off-desk/distraction zone;
- uncertain zone or explicit uncertainty state.

## Required Output

The exported trace must be symbolic JSON only. It should be suitable for conversion into:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

If the trace is incomplete, validation must fail clearly rather than silently passing.

## Non-Goals

Gate 1D does not approve:

- autonomous visual recognition claims;
- cinematic HUD polish;
- portfolio demo claims;
- production readiness;
- Gate 2;
- any relaxation of Gate 1C.
