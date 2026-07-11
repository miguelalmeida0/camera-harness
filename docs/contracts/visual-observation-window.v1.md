# visual-observation-window.v1

`visual-observation-window.v1` is the bounded, user-triggered input sent to the local visual companion service.

Required fields:
- `schema_version`: `visual-observation-window.v1`
- `frames`: ordered JPEG frames, maximum 8, decoded only in memory
- `frame_timestamps_ms`: ordered timestamps matching `frames`
- `previous_context`: text-only context
- `user_question`: optional text
- `requested_response_mode`: `auto`, `narrate`, `ask`, or `assist`
- `allowed_suggested_actions`: allowlisted action names only
- `client_scene_change_score`: symbolic scene-change score
- `memory_mode`: `off`, `session`, or `persistent`
- `contains_raw_media`: always `false` in stored/logged records

Frames are transient request payloads. The app must not persist images, base64, screenshots, audio, OCR, or identity embeddings.
