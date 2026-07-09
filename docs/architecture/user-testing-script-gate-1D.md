# User Testing Script For Gate 1D

This script tests whether the app is ready for local use. It does not approve demo polish or Gate 2.

## 1. Start The App

From the repo root:

```sh
npm run physical:capture
```

Open:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

Expected: page title says `Gate 1D Tryable Local App MVP`.

If this fails, send the terminal output from `npm run physical:capture`.

## 2. Start Camera

Click:

```text
Start Camera
```

Allow camera permission. Do not allow microphone permission.

Expected:

- camera preview appears;
- `Camera Permission` changes from `idle` to `granted`;
- `Raw Media Persistence` remains `false`;
- `Cloud Fallback` remains `disabled`;
- `LLM Calls` remains `0`;
- `VLM Calls` remains `0`.

## 3. Calibrate Zones

Click:

```text
Calibrate Zones
```

Confirm visible fields for:

- `phone_zone`
- `notebook_zone`
- `pen_zone`
- `keyboard_zone`
- `neutral_zone`
- `off_desk_zone`

Confirm object assignments exist for:

- `phone`
- `notebook`
- `pen`
- `keyboard`

You can keep defaults for the first test.

Click:

```text
Save Calibration
```

Expected:

- `Current Quest State` becomes `calibrated`;
- `Current Objective` becomes `Start Focus Ritual`;
- `Last 10 Symbolic Events` includes `evt_scene_calibrated`, `evt_keyboard_present`, and `evt_phone_present`.

## 4. Start The Ritual

Click:

```text
Start Focus Ritual
```

Expected:

- `Current Quest State` becomes `phone_removal_pending`;
- `Current Objective` asks you to move the phone away.

## 5. Start Recording

Click:

```text
Start Recording
```

Expected:

- `Recording Status` becomes `on`;
- `Export Status` says `recording`.

## 6. Perform And Confirm Steps

Physically perform each step, then click the matching manual confirmation.

1. Move phone away, then click `Confirm Phone Moved`.
2. Open notebook, then click `Confirm Notebook Opened`.
3. Pick up pen, then click `Confirm Pen Picked Up`.
4. Perform writing-like motion, then click `Confirm Writing Motion`.
5. Perform typing-like motion, then click `Confirm Typing Motion`.

Expected after each click:

- `Current Quest State` advances;
- `Quest Progress` marks another step complete;
- `Last 10 Symbolic Events` updates;
- `Event Count` increases;
- `LLM Calls` stays `0`;
- `VLM Calls` stays `0`;
- `Raw Media Persistence` stays `false`.

Final expected quest state:

```text
quest_complete
```

## 7. Stop And Confirm Physical Session

Click:

```text
Stop Recording
```

Tick:

```text
I confirm this recording came from a real physical webcam session.
```

Expected:

- `Recording Status` becomes `off`;
- `Trace Export` becomes ready or `Export Status` says `ready`.

## 8. Export

Click:

```text
Export Physical Trace
```

Expected browser download:

```text
live_physical_focus_ritual_001.v0.json
```

Save it here:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

If export is blocked, send the exact `Export Status` text.

## 9. Validate

Run:

```sh
npm run physical:validate
npm run gate:1c
```

Expected if the trace exists and is valid:

- `npm run physical:validate` should return `PASS`;
- `npm run gate:1c` should advance past `BLOCKED_MISSING_PHYSICAL_TRACE`.

Gate 1C may still fail for a precise validation reason. Send that result back.

## 10. Send Back If It Fails

Send:

- terminal output from `npm run physical:capture`;
- screenshot of the loaded app;
- screenshot or text list of visible controls;
- `Camera Permission` text;
- `Current Quest State` text;
- `Export Status` text;
- `Last 10 Symbolic Events` text;
- exported trace file if one downloads;
- terminal output from `npm run physical:validate`;
- terminal output from `npm run gate:1c`.
