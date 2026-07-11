import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUTPUT_PATH = resolve("runs/visual-model-benchmark-latest.json");

const MODEL_CANDIDATES = [
  {
    role: "selected_production_model",
    model_id: process.env.VISUAL_COMPANION_MODEL || "not_configured",
    hardware_requirement: "configured runtime",
    license: process.env.VISUAL_COMPANION_MODEL_LICENSE || ""
  },
  { role: "candidate", model_id: "openbmb/MiniCPM-o-4_5", hardware_requirement: "GPU recommended, model assets available locally", license: "Apache-2.0" },
  { role: "candidate", model_id: "Qwen/Qwen2.5-Omni-7B", hardware_requirement: "GPU recommended, model assets available locally", license: "Apache-2.0" },
  { role: "candidate", model_id: "Qwen/Qwen3-Omni", hardware_requirement: "GPU recommended, model assets available locally", license: "Apache-2.0" },
  { role: "candidate", model_id: "google/gemma-3n-E4B", hardware_requirement: "GPU or optimized local runtime", license: "Gemma terms" },
  { role: "candidate", model_id: "HuggingFaceTB/SmolVLM2-2.2B-Instruct", hardware_requirement: "local VLM runtime", license: "Apache-2.0" },
  { role: "fallback", model_id: "HuggingFaceTB/SmolVLM2-500M-Video-Instruct", hardware_requirement: "local VLM runtime", license: "Apache-2.0" }
];

const evidencePath = process.env.VISUAL_COMPANION_REAL_MODEL_EVIDENCE || "";
const realModelId = process.env.VISUAL_COMPANION_REAL_MODEL_ID || "";
const now = new Date().toISOString();

const results = MODEL_CANDIDATES.map((candidate) => {
  if (evidencePath && realModelId && candidate.model_id === realModelId) {
    return {
      ...candidate,
      status: "tested",
      evidence_level: "real_model",
      evidence_path: evidencePath,
      metrics: {
        visible_action_correctness: null,
        object_correctness: null,
        scene_change_correctness: null,
        time_to_first_token_ms: null,
        time_to_first_audio_ms: null,
        total_latency_ms: null,
        peak_memory_mb: null
      },
      note: "External real-model evidence was supplied; scores must be populated by the physical/model runner."
    };
  }
  return {
    ...candidate,
    status: "not_tested",
    evidence_level: "unavailable",
    unavailable_reason: unavailableReason(candidate),
    metrics: null
  };
});

const artifact = {
  schema: "darkquest.visual_model_benchmark.v1",
  created_at: now,
  benchmark_policy: "Do not fake model scores. Unavailable models are recorded as not_tested.",
  real_model_tested: results.some((item) => item.status === "tested" && item.evidence_level === "real_model"),
  models: results
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`visual model benchmark written: ${OUTPUT_PATH}`);
console.log(`real_model_tested=${artifact.real_model_tested}`);
if (!artifact.real_model_tested) {
  console.log("no real open-source visual model evidence was supplied; release gate must block real-model approval");
}

function unavailableReason(candidate) {
  if (candidate.model_id === "not_configured") return "selected production model is not configured";
  return "local model runtime/assets were not present in this environment";
}
