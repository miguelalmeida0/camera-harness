# Sensefield Spatial Pipeline

The first spatial engine uses the already-cached `HuggingFaceTB/SmolVLM2-2.2B-Instruct` runtime for bounded semantic object and hand observations. Sensefield then applies deterministic normalized geometry for short-window IDs, relative depth, relations, movement, interactions, evidence association, and contradiction checks.

This is practical on the detected Apple M3 with 16 GB unified memory because it reuses one installed visual model and does not add a second large detector or depth download. Existing browser hand landmarks can enter through the same observation contract when available. Dedicated MediaPipe, grounding, ONNX, and monocular-depth packages were not installed during assessment.

Relative depth is the default. Metric estimates are emitted only when calibration is explicitly verified, supplies a supported unit and scale, has confidence of at least `0.7`, and includes calibration evidence. Otherwise the engine returns `scale.type = "relative"`, `unit = null`, and no metric estimates.

Raw frames remain confined to the bounded provider call and are cleared afterward. Scene memory contains only bounded text and numeric facts.
