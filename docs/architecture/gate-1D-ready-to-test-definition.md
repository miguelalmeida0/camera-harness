# Gate 1D Ready-To-Test Definition

Gate 1D is ready for user testing only when the user can operate the full local Focus Ritual path without guessing and without fake claims.

## Ready Only If

- `npm run physical:capture` starts the local app or gives clear local instructions.
- URL is known:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

- Camera can start.
- Calibration UI exists.
- All required zones can be set:
  - `phone_zone`
  - `notebook_zone`
  - `pen_zone`
  - `keyboard_zone`
  - `neutral_zone`
  - `off_desk_zone`
- All required objects can be assigned:
  - `phone`
  - `notebook`
  - `pen`
  - `keyboard`
- Focus Ritual can start.
- Recording can start.
- Manual confirmation buttons exist for:
  - phone moved;
  - notebook opened;
  - pen picked up;
  - writing motion;
  - typing motion;
  - uncertainty;
  - camera reset.
- Quest state updates from manual events.
- Timeline updates after each symbolic event.
- Export works or download instructions are clear.
- Validation commands are shown.
- No raw media/model calls occur.
- Manual confirmation is disclosed in event evidence and exported trace metadata.

## Not Ready If

- Camera is the only working feature.
- User has to guess what to click.
- No calibration UI exists.
- No quest controls exist.
- No manual confirmation controls exist while automatic detection is incomplete.
- Quest state does not update.
- Event timeline does not update.
- Export is missing or unclear.
- No validation next steps are shown.
- Raw media is persisted.
- Model calls occur.
- Manual confirmation is hidden or described as automatic vision.

## Current Readiness Assessment

Source-level readiness: `TRYABLE_WITH_MANUAL_CONFIRMATION`.

The current source contains the required controls, manual confirmations, debug HUD, event timeline, export, and validation instructions. `npm run gate:1d` reports `TRYABLE_WITH_MANUAL_CONFIRMATION` with `67/67` source checks passing.

Operational readiness: `NEEDS_USER_PHYSICAL_RUN`.

Reason: the sandbox cannot verify local browser operation because localhost binding fails with `EPERM`; the user or a local browser-capable harness must verify the app.
