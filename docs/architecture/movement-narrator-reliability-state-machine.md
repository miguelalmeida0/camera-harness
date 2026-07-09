# Movement Narrator Reliability State Machine

## Decision

The movement narrator uses explicit reliability states. State copy must be clear, short, and product-facing.

## States

```text
camera_off
camera_ready
get_ready
capturing
analyzing
result_ready
provider_busy
provider_unavailable
missing_token
camera_error
frame_capture_error
```

## State Definitions

### camera_off

- Meaning: camera is not ready.
- Primary button: `Start Camera`
- Help copy: `Start the camera, then describe a movement.`

### camera_ready

- Meaning: camera preview is ready.
- Primary button: `Describe my next movement`
- Help copy: `Click, then move naturally for about 2 seconds.`

### get_ready

- Meaning: click accepted and short delay before capture.
- Primary button: `Get ready...`
- Button disabled: yes.

### capturing

- Meaning: short frame window is being collected.
- Primary button: `Move now.`
- Button disabled: yes.

### analyzing

- Meaning: provider request is in flight.
- Primary button: `Understanding movement...`
- Button disabled: yes.

### result_ready

- Meaning: movement sentence is available.
- Primary button: `Try another movement`
- Secondary actions: `Speak result`, `Confirm`

### provider_busy

- Meaning: provider route is reachable but capacity/availability is busy.
- Primary button: `Try again`
- Error copy: `AI provider is busy. Try again in a moment.`

### provider_unavailable

- Meaning: endpoint/provider failed in a non-busy way.
- Primary button: `Try again`
- Error copy: `Movement recognition endpoint unavailable.`

### missing_token

- Meaning: server does not have `HF_TOKEN`.
- Primary button: `Try again`
- Error copy: `HF_TOKEN is not loaded.`

### camera_error

- Meaning: camera permission or stream failed.
- Primary button: `Start Camera`
- Error copy: `Camera could not be started.`

### frame_capture_error

- Meaning: frame window could not be captured.
- Primary button: `Try again`
- Error copy: `Camera frame could not be captured.`

## Error Copy Catalog

- `HF_TOKEN not loaded`
- `AI provider is busy`
- `Movement recognition endpoint unavailable`
- `Camera frame could not be captured`
- `Network error`
- `AI response could not be parsed`

## Transition Rules

- `camera_off -> camera_ready` only after camera starts.
- `camera_ready -> get_ready` only after explicit click.
- `get_ready -> capturing -> analyzing` is one request sequence.
- `analyzing -> result_ready` on valid movement response.
- `analyzing -> provider_busy` on provider capacity or model availability busy.
- `analyzing -> provider_unavailable` on endpoint/provider failure.
- Any in-flight state blocks duplicate click.
- Hidden tab must not start capture or provider request.

