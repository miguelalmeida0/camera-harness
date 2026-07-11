# Open Visual Model Runtime Matrix

Model licenses and availability must be rechecked from upstream model cards before implementation freeze. The product runtime must not hardcode a model before hardware detection.

## Tier A - Edge/local Lightweight

| Candidate | License | Modalities | Hardware | Quantization | Runtime | Latency | Quality | Complexity | Commercial concern | Fallback fit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gemma 3n E4B | Gemma terms; gated access; verify commercial terms | text, image, video, audio input; text output | Apple Silicon or consumer GPU; memory roughly 4B effective class | int4/int8 where supported | Transformers, SGLang, vLLM, llama.cpp/Ollama variants if available | medium | strong for edge | medium | not OSI; requires accepting Google terms; HF_TOKEN only for download | good primary if terms/hardware pass |
| SmolVLM2-2.2B | Apache-2.0 | image, multi-image, video, text to text | modest GPU; model card reports about 5.2GB GPU RAM for video inference | ONNX, int8/int4 depending runtime | Transformers, ONNX Runtime, vLLM/SGLang where supported | low-medium | good lightweight temporal perception | low-medium | low, permissive license | best default fallback |
| SmolVLM2-500M | Apache-2.0 | image, video, text to text | low-resource local GPU; model card reports about 1.8GB GPU RAM for video inference | ONNX, int8/int4 | Transformers, ONNX Runtime, browser/server experiments | low | weaker but useful for availability | low | low, permissive license | extreme fallback |

## Tier B - Local/server Omni

| Candidate | License | Modalities | Hardware | Quantization | Runtime | Latency | Quality | Complexity | Commercial concern | Fallback fit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MiniCPM-o 4.5 | Apache-2.0 | any-to-any; vision, speech, text; full-duplex capabilities | local GPU or optimized end-device runtime; target 12GB RAM class from model claim requires verification | GGUF/BNB/llama.cpp-omni options | PyTorch, llama.cpp-omni, vLLM/SGLang when compatible | medium | strong contextual/omni | high | low license concern; custom-code runtime risk | best self-hosted research path |
| Qwen2.5-Omni 3B | qwen-research as listed on current HF card | text, image, video, audio input; text/audio output | local GPU/server | quantized variants may be needed | Transformers | medium | useful smaller omni | medium-high | research license blocks production until cleared | benchmark/research only unless license clears |
| Qwen2.5-Omni 7B | Apache-2.0 | text, image, video, audio input; text/audio output | stronger local GPU/server | int4/int8 where supported | Transformers | medium-high | stronger omni | high | permissive license, but runtime cost/hardware high | quality fallback on capable hardware |

## Tier C - Quality Benchmark

| Candidate | License | Modalities | Hardware | Quantization | Runtime | Latency | Quality | Complexity | Commercial concern | Fallback fit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Qwen3-Omni | Apache-2.0 for Qwen3-Omni-30B-A3B-Instruct card | multimodal/any-to-any | high-end local/server GPU; not default edge | quantized serving required for cost control | Transformers, vLLM if compatible | high | benchmark/ceiling candidate | high | low license concern, high hardware cost | benchmark only, not default |

## Speech Runtime

| Candidate | License | Mode | Hardware | Runtime | Fit |
| --- | --- | --- | --- | --- | --- |
| Kokoro | Apache-2.0 | text-to-speech | CPU/GPU capable local runtime | Python package/local server | preferred open/local TTS |
| Browser speech | Browser API | text-to-speech | browser-native | Web Speech API | fallback when Kokoro unavailable |

## Runtime Decision Rules

- Detect hardware before selecting a model.
- Prefer Tier A for default product availability.
- Promote to Tier B only when local GPU/runtime health passes.
- Use Tier C only for benchmark comparisons or explicitly selected quality mode.
- Never fall back to Hugging Face Inference Providers, Cerebras, Groq, Gemini, OpenAI, or other paid hosted routes in the production path.
- `HF_TOKEN` can download gated weights and must never be sent to the frontend.

## Sources For License Snapshot

- [Gemma 3n E4B model card](https://huggingface.co/google/gemma-3n-E4B-it)
- [SmolVLM2 2.2B model card](https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct)
- [SmolVLM2 500M model card](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct)
- [MiniCPM-o 4.5 model card](https://huggingface.co/openbmb/MiniCPM-o-4_5)
- [Qwen2.5-Omni 3B model card](https://huggingface.co/Qwen/Qwen2.5-Omni-3B)
- [Qwen2.5-Omni 7B model card](https://huggingface.co/Qwen/Qwen2.5-Omni-7B)
- [Qwen3-Omni model card](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct)
- [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M)
