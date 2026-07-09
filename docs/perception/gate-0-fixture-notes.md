# Gate 0 Fixture Notes

## 1. Visual/interaction goal

The happy-path fixture makes the Focus Ritual visible as a symbolic trace, not as a cinematic interface. GAUNTLET should be able to replay the fixture and prove that stable events, quest transitions, HUD commands, memory behavior, and cost/latency records are deterministic before any live webcam or visual polish work begins.

## 2. Fixture design

The fixture is `fixtures/replay/focus_ritual_happy_path.v0.json`. It uses the `darkquest.replay_fixture.v0` shape and only symbolic input events. The canonical Gate 0 zones are `phone_zone`, `notebook_zone`, `pen_zone`, `keyboard_zone`, `neutral_zone`, and `off_desk_zone`.

The trace is intentionally narrow:

- `scene.calibrated` proves zones are available.
- `object.moved` proves phone removal and pen pickup.
- `object.placed` proves keyboard presence, phone presence, and opened notebook.
- `hand.entered_zone` supports the pen pickup trace without completing a step alone.
- `gesture.detected` proves writing-like and typing-like motion.
- Expected memory writes and model calls are empty.

## 3. Input events

`evt_scene_calibrated_input` represents the desk being calibrated with all required zones available and stable.

`evt_keyboard_present_input` represents a keyboard already resting in `keyboard_zone`.

`evt_phone_present_input` represents the phone initially visible in `phone_zone`.

`evt_phone_moved_away_input` represents the phone moving from `phone_zone` to `off_desk_zone`.

`evt_notebook_opened_input` represents an open notebook resting in `notebook_zone` long enough to pass dwell gating.

`evt_hand_entered_pen_zone_input` represents the right hand entering `pen_zone` to pick up the pen.

`evt_pen_picked_up_input` represents the pen moving from `pen_zone` into `notebook_zone`, carried by the right hand.

`evt_writing_motion_input` represents three writing-like movements in `notebook_zone` with the pen as related object.

`evt_typing_motion_input` represents typing-like motion in `keyboard_zone`.

## 4. Expected stable events

The stabilizer should pass through or normalize the symbolic events into stable events with deterministic IDs. Scene calibration should require at least `0.80` confidence. Hand-zone events should require at least `0.85`. Object movement and placement events that change quest state should require at least `0.86`. Gesture events should require at least `0.82` with an evidence window of at least `900ms`.

In live webcam mode, these same stable events would be produced from local frame observations after smoothing, dwell checks, motion thresholds, and gesture debounce. The replay fixture skips frame processing so the quest engine can be validated before perception tuning.

## 5. Expected HUD commands

The fixture expects only state-backed HUD commands:

- `hud.objective.update`
- `hud.zone.highlight`
- `hud.entity.track`
- `hud.timeline.append`
- `hud.confidence.update`
- `hud.quest.progress`
- `hud.quest.complete`

Every expected HUD command cites real event evidence. There are no cinematic-only effects, no decorative success states, and no HUD command that implies progress without a matching quest state or stable perception event.

## 6. Failure risks

The first live perception failures are likely to be:

- Pen pickup, because a small object can be occluded by the hand.
- Writing-like motion, because it can be confused with idle fidgeting unless repetition and zone guards are strict.
- Phone movement, because reflective surfaces can flicker between object IDs.
- Notebook open state, because an open/closed distinction may require better local classification than simple placement.
- Typing-like motion, because keyboard and laptop zones must be calibrated consistently.

Recommended thresholds:

- Scene calibration: `0.80`.
- Hand entered/left zone: `0.85`.
- Object moved/placed for quest transitions: `0.86`.
- Gesture detected: `0.82` plus `900ms` minimum evidence window.
- Quest state transition: use the weakest accepted evidence confidence and fail closed below threshold.

## 7. Handoff to GAUNTLET

Replay `focus_ritual_happy_path.v0.json` at least three times and compare status, stable event IDs, quest transitions, HUD command IDs, memory writes, model calls, and forbidden checks. Runtime may vary, but it must remain under `1000ms` and each report must include latency and cost records.

The expected pass report must prove:

- all expected stable events are present;
- all expected quest transitions occur in order;
- all expected HUD commands are emitted from real evidence;
- no LLM or VLM calls occur;
- no raw video is persisted;
- no memory writes occur on this happy path;
- latency and cost metrics are present;
- repeated runs produce the same result.

