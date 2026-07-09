# Gate 1D Product Usability Handoff

Current objective: make DarkQuest locally tryable without relaxing Gate 1C.

Gate 1D may allow local user testing. It does not approve HUD polish, cinematic polish, portfolio claims, production claims, or fake physical provenance.

## Handoff To Multimodal Perception & Interface Researcher

Make the local app usable. Camera cannot be the only working feature.

Required product path:

- start local app with `npm run physical:capture`;
- start camera with video only and audio disabled;
- add or verify manual calibration UI for required zones;
- add or verify Focus Ritual start control;
- add or verify symbolic controls for all six ritual steps;
- add or verify manual local confirmation when automatic detection is not ready;
- add or verify recording start and stop;
- add or verify event timeline updates;
- add or verify debug HUD quest progress;
- add or verify visible privacy/model state;
- add or verify export of symbolic trace JSON;
- show validation next steps after export.

Required honesty:

- label manual confirmation clearly;
- disclose manual confirmation in trace metadata if used;
- do not claim automatic computer vision for manual events;
- do not persist raw media;
- do not call LLM/VLM;
- do not start cinematic HUD polish.

Expected target status:

```text
TRYABLE_WITH_MANUAL_CONFIRMATION
```

Stretch target:

```text
TRACE_EXPORT_WORKING
```

## Handoff To Harness, Evaluation, Memory & Safety Researcher

Define and enforce Gate 1D checks.

Required validation:

- verify local app launch command exists and starts;
- verify exported traces are symbolic-only;
- verify manual local confirmation is disclosed when used;
- verify evidence uses `human_correction` or `local_signal`;
- verify `contains_raw_media=false`;
- verify no raw video, raw frame, screenshot, audio, OCR, notebook text, base64 media, or raw media path appears;
- verify no LLM/VLM calls occur;
- validate exported traces or return clear errors;
- ensure Gate 1C remains required for physical trace acceptance;
- ensure Gate 2 stays locked.

Required failure posture:

- fail if camera is the only working feature;
- fail if quest state does not update from symbolic events;
- fail if trace export is missing;
- fail if validation silently accepts incomplete traces;
- fail if manual confirmation is hidden;
- fail if manual confirmation is represented as autonomous vision;
- fail if any raw media or model path appears.

## Shared Invariant

Gate 1D makes the app tryable. Gate 1C makes physical evidence acceptable.
