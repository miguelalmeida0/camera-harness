# visual-companion-provider.v1

DarkQuest v2 uses a local self-hosted visual companion provider for the primary product path.

Default model:
- `HuggingFaceTB/SmolVLM2-2.2B-Instruct`
- License: Apache-2.0
- Source: `https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct`
- Runtime: local Python FastAPI service with Transformers

Provider API:
- `GET /health`
- `GET /models`
- `POST /observe`
- `POST /speak`
- `POST /cancel`

Production-path constraints:
- No paid inference API
- No Hugging Face routed inference providers
- `HF_TOKEN` is only for downloading gated model assets if a gated model is explicitly selected
- Frames are decoded in memory and cleared after inference
- No uploaded images, screenshots, base64, audio, OCR, or identity embeddings are logged or persisted
