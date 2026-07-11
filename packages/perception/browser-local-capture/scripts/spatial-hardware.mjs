#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";

const siblingMain = resolve(dirname(process.cwd()), "camera-harness");
const environments = [
  { id: "system_python", executable: "python3" },
  { id: "worktree_voice_env", executable: resolve(".venv-voice/bin/python") },
  { id: "stable_voice_env", executable: resolve(siblingMain, ".venv-voice/bin/python") }
].map(probeEnvironment);
const activePython = environments.find((environment) => environment.available && environment.packages.torch)?.executable || "python3";
const torch = torchProbe(activePython);
const hardware = safeAppleHardware();
const report = {
  schema_version: "sensefield.spatial_hardware.v1",
  os: { platform: os.platform(), release: os.release(), architecture: os.arch() },
  cpu: { model: hardware.chip || os.cpus()?.[0]?.model || "unknown", cores: os.cpus()?.length || 0 },
  apple_silicon: { available: os.platform() === "darwin" && os.arch() === "arm64", generation: appleGeneration(hardware.chip), chip: hardware.chip || "unknown" },
  total_memory_bytes: os.totalmem(),
  mps_available: torch.mps_available === true,
  cuda_available: torch.cuda_available === true,
  python_environments: environments.map(({ executable: _privatePath, ...environment }) => environment),
  local_models: [
    { id: "HuggingFaceTB/SmolVLM2-2.2B-Instruct", available: modelAvailable("HuggingFaceTB--SmolVLM2-2.2B-Instruct", "smolvlm2-2.2b-instruct") }
  ],
  components: {
    monocular_depth: componentState(environments, ["depth_anything", "onnxruntime"]),
    object_detection_or_grounding: componentState(environments, ["ultralytics", "groundingdino"]),
    short_window_tracking: "sensefield_normalized_geometry",
    hand_landmarks: componentState(environments, ["mediapipe"]),
    semantic_spatial_model: modelAvailable("HuggingFaceTB--SmolVLM2-2.2B-Instruct", "smolvlm2-2.2b-instruct") ? "smolvlm2_cached" : "unavailable"
  },
  selected_pipeline: {
    semantic_observations: "HuggingFaceTB/SmolVLM2-2.2B-Instruct",
    geometry_tracking: "Sensefield normalized bounded scene graph",
    hand_input: "existing browser landmarks when supplied; SmolVLM observations otherwise",
    metric_depth: "disabled_without_verified_calibration",
    reason: "Uses the one cached visual model and deterministic geometry; no additional large model download is required."
  }
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function probeEnvironment(candidate) {
  const available = candidate.executable === "python3" || existsSync(candidate.executable);
  if (!available) return { id: candidate.id, executable: candidate.executable, available: false, version: "not_found", packages: {} };
  const names = ["torch", "transformers", "mlx", "mediapipe", "cv2", "ultralytics", "groundingdino", "depth_anything", "onnxruntime", "numpy", "fastapi"];
  const output = commandOutput(candidate.executable, ["-c", `import importlib.util,json,platform; names=${JSON.stringify(names)}; print(json.dumps({'version':platform.python_version(),'packages':{name:importlib.util.find_spec(name) is not None for name in names}}))`]);
  try {
    const parsed = JSON.parse(output);
    return { id: candidate.id, executable: candidate.executable, available: true, version: parsed.version, packages: parsed.packages };
  } catch {
    return { id: candidate.id, executable: candidate.executable, available: true, version: "unknown", packages: {} };
  }
}

function torchProbe(python) {
  const output = commandOutput(python, ["-c", "import importlib.util,json; info={'torch_available':importlib.util.find_spec('torch') is not None};\nif info['torch_available']:\n import torch; info.update({'mps_available':bool(getattr(torch.backends,'mps',None) and torch.backends.mps.is_available()),'cuda_available':torch.cuda.is_available()});\nprint(json.dumps(info))"]);
  try { return JSON.parse(output || "{}"); } catch { return {}; }
}

function safeAppleHardware() {
  if (os.platform() !== "darwin") return {};
  const output = commandOutput("system_profiler", ["-json", "SPHardwareDataType"]);
  try {
    const entry = JSON.parse(output)?.SPHardwareDataType?.[0] || {};
    return { chip: String(entry.chip_type || entry.machine_name || "").slice(0, 80) };
  } catch {
    return {};
  }
}

function appleGeneration(chip) {
  return String(chip || "").match(/Apple\s+(M\d+)/i)?.[1]?.toUpperCase() || null;
}

function modelAvailable(cacheName, localName) {
  return [
    resolve(os.homedir(), ".cache/huggingface/hub", `models--${cacheName}`),
    resolve(".models/visual-companion", localName),
    resolve(siblingMain, ".models/visual-companion", localName)
  ].some(existsSync);
}

function componentState(envs, packages) {
  const available = packages.filter((name) => envs.some((environment) => environment.packages?.[name] === true));
  return available.length ? available : "not_installed";
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).trim();
  } catch {
    return "";
  }
}
