# Movement Correction Memory v0

Scope: session-only correction memory for the Movement Narrator.

Rules:
- Correction memory is text-only.
- Correction memory stores only sanitized text metadata:
  - `correction_id`
  - `original_movement`
  - `corrected_movement`
  - `confidence`
  - `provider`
  - `model`
  - `timestamp`
  - `contains_raw_media: false`
  - `contains_biometric_identity: false`
  - `session_only: true`
- Correction memory is session-only unless explicitly changed by a later contract.
- Corrections must be clearable with `clearCorrectionMemory`.
- Corrections must not store identity, age, gender, race, ethnicity, private text, raw frames, screenshots, audio, or base64 media.
- User corrections may update the current movement sentence and may be included as text-only context in the next prompt.

Blocked:
- Persistent correction memory.
- Raw media in memory.
- Sensitive attribute storage.
