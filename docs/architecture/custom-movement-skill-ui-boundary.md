# Custom Movement Skill UI Boundary

## Placement

Custom skills live inside the existing collapsed Automations area. They do not add a permanent main-product panel and do not move or resize Camera, Describe my next movement, or the Big result.

Within Automations:

- Primary secondary-area command: `Create custom gesture`.
- Secondary command: `Use preset`.
- Existing Instant gestures control and receipts remain contained.

The custom-skill flow opens in the existing modal/sheet pattern and must remain usable at 390px without horizontal overflow, text escape, state loss, or unreachable actions.

## Phase 1 Wizard

1. Name
2. Skill type
3. Show examples
4. Test recognition
5. Choose action
6. Save and enable

Phase 1 offers static one-hand and two-hand pose collection. Custom hand motion remains unavailable until its physical reliability phase passes. Custom semantic actions continue through the existing Describe flow rather than this wizard.

## Example Collection

Approved copy includes:

- `Show your Heart shape`
- `Example 2 of 5`
- `Both hands detected`
- `Hold steady`
- `Example saved`
- `Test your skill`
- `Heart shape recognized - 86%`

Do not use `Record video`, `Upload training data`, or `Model training`. The camera is used for ephemeral local landmark extraction; only normalized templates are saved.

Each rejected example shows scoped guidance such as missing hand, poor visibility, or excessive movement. Rejection does not discard previously accepted examples.

## Conditional Controls

- One-hand versus two-hand selection controls required hand count and guidance.
- Sensitivity, hold, and cooldown use bounded controls with safe defaults.
- Action configuration displays only fields for the selected adapter.
- Instant safe actions show no confirmation contradiction.
- Snapshot, webhook, notification, media, and external options retain their existing permission/confirmation boundary and are not presented as silent instant actions.
- Internal skill IDs, vectors, dimensions, and storage/schema errors are never editable or primary copy.

## Test and Activation

`Save and enable` remains unavailable until five examples, calibration, and live test succeed. Testing displays bounded match score and ambiguous/no-match feedback without showing vectors or landmarks.

The user can cancel collection, delete all local examples, retrain, disable, or delete a skill. Deletion clearly states that local templates will be removed and referencing recipes disabled.

## Accessibility and Containment

- Wizard state survives responsive rerendering and recoverable validation errors.
- Modal content scrolls internally; primary and cancel actions remain reachable.
- Progress and errors use text, not color alone.
- Long skill names and safe errors wrap within bounded containers without one-character-per-line text.
- Camera permission loss or hidden-tab suspension preserves accepted symbolic templates but stops collection immediately.
