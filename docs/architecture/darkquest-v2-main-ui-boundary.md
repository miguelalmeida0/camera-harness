# DarkQuest v2 Main UI Boundary

## Default Hierarchy

1. Camera
2. Observe now
3. Contextual response
4. Speak/mute
5. Ask follow-up
6. Correct
7. Suggested action, when relevant
8. Privacy/model status
9. Advanced tools collapsed

The current visual design remains approved and frozen. Content and hierarchy may change to support the v2 product flow, but typography, spacing, colors, cards, and responsive behavior must not be redesigned.

## Allowed Main UI Content

- Camera preview.
- `Observe now` primary action.
- Bounded capture/loading states such as `Watch closely...` and `Understanding what changed...`.
- One big contextual response.
- Speak/mute control.
- Follow-up input or button.
- Correction entry point.
- Compact suggested action confirmation when relevant.
- Compact privacy/model status.

## Hidden By Default

- Provider diagnostics.
- Model prompt.
- Raw JSON.
- Token information.
- Frames or thumbnails.
- Internal classifications.
- Old trace/gate language.
- Training dashboards.
- Gesture preset grids as the main experience.
- Runtime logs.

## Responsive Requirements

- The full primary flow must work at 390px width.
- Modal/sheet actions remain reachable.
- No horizontal page overflow.
- Long model names, paths, and diagnostics are contained only in hidden developer tools.
- Responsive changes must not reset camera state, current response, memory, recipes, or pending action confirmation.
