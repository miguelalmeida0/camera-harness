# Visual Companion Memory Policy

Default: session-only or off.

Allowed:
- text summaries
- user corrections
- policy-safe response metadata
- aggregate symbolic metrics

Forbidden:
- frames
- screenshots
- audio
- video
- base64
- data URIs
- identity embeddings
- private document text unless explicitly requested and confirmed

Persistent memory requires explicit opt-in. Clear context must remove session summaries immediately. Model caches may contain model assets only, not user observations.
