#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const serviceRoot = resolve("services/visual-companion");
const manifestPath = resolve("runs/visual-companion-setup-latest.json");
const model = process.env.VISUAL_COMPANION_MODEL || "HuggingFaceTB/SmolVLM2-500M-Video-Instruct";
const revision = process.env.VISUAL_COMPANION_MODEL_REVISION || "main";
const modelDir = process.env.VISUAL_COMPANION_MODEL_DIR || resolve(".models/visual-companion/smolvlm2-500m-video-instruct");
const downloadRequested = process.env.DARKQUEST_VISUAL_DOWNLOAD === "1";

mkdirSync(resolve("runs"), { recursive: true });
mkdirSync(modelDir, { recursive: true });

const python = findPython();
const manifest = {
  schema_version: "darkquest.visual_setup.v1",
  generated_at: new Date().toISOString(),
  service_root: serviceRoot,
  model,
  model_revision: revision,
  model_dir: modelDir,
  license: "apache-2.0",
  source: `https://huggingface.co/${model}`,
  paid_inference_api: false,
  hf_router_production_path: false,
  python,
  dependencies_file: resolve(serviceRoot, "requirements.txt"),
  downloaded: false,
  status: "prepared",
  instructions: [
    "Run npm run visual:serve to start the local FastAPI service.",
    "Set DARKQUEST_VISUAL_DOWNLOAD=1 before npm run visual:setup to download model assets with huggingface_hub.",
    "HF_TOKEN is only needed if you switch to a gated model."
  ]
};

if (!existsSync(resolve(serviceRoot, "app.py"))) {
  manifest.status = "missing_service_files";
  writeManifest(manifest);
  process.exitCode = 1;
} else if (downloadRequested) {
  const result = spawnSync(python, [
    resolve(serviceRoot, "download_model.py"),
    "--model", model,
    "--revision", revision,
    "--target", modelDir
  ], { stdio: "inherit", env: process.env });
  manifest.downloaded = result.status === 0;
  manifest.status = result.status === 0 ? "downloaded" : "download_failed";
  writeManifest(manifest);
  process.exitCode = result.status ?? 1;
} else {
  writeManifest(manifest);
}

console.log(`${manifest.status}: ${manifest.model}`);
console.log(`Manifest: ${manifestPath}`);

function writeManifest(value) {
  writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
}

function findPython() {
  for (const candidate of [process.env.PYTHON, "python3", "python"].filter(Boolean)) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  return "python3";
}
