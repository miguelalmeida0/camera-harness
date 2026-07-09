# Camera-Only Is Failure Policy

The app is not tryable if camera preview is the only working feature.

Gate 1E exists to make this non-negotiable.

## Gate 1E Requires

Gate 1E requires:

- calibration works;
- quest controls work;
- manual confirmations work;
- quest state updates;
- timeline updates;
- recording works;
- export works or gives a clear blocked reason;
- validation commands are visible.

## Failure Rule

If any required behavior fails, the verdict cannot be:

```text
TRYABLE_WITH_MANUAL_CONFIRMATION
```

The correct status is one of:

- `CAMERA_ONLY`
- `UI_PRESENT_NOT_FUNCTIONAL`
- `BLOCKED`

## Product Owner Test

Ask:

```text
Can the user complete a full local Focus Ritual and reach export or a clear blocked-export reason?
```

If the answer is no, the app is not tryable.

## Safety Rule

Fixing camera-only behavior is allowed.

Polishing camera-only behavior is forbidden.
