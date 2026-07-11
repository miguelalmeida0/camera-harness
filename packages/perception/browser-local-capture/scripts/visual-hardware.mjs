#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, statfsSync, writeFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";

const outputPath = resolve("runs/visual-hardware-latest.json");
const report = {
  schema_version: "darkquest.visual_hardware.v1",
  generated_at: new Date().toISOString(),
  os: {
    platform: os.platform(),
    release: os.release(),
    type: os.type()
  },
  cpu: {
    architecture: os.arch(),
    cores: os.cpus()?.length || 0,
    model: os.cpus()?.[0]?.model || "unknown"
  },
  apple_silicon: detectAppleSilicon(),
  nvidia_gpu: detectNvidiaGpu(),
  cuda_available: detectCommand("nvidia-smi"),
  metal_mps_available: os.platform() === "darwin" && os.arch() === "arm64",
  system_ram_bytes: os.totalmem(),
  disk: detectDiskCapacity(resolve(".")),
  python_version: commandOutput("python3", ["--version"]) || commandOutput("python", ["--version"]) || "not_found",
  node_version: process.version,
  recommended_model: null,
  recommended_reason: ""
};

report.recommended_model = selectRecommendedModel(report);
report.recommended_reason = recommendationReason(report);

mkdirSync(resolve("runs"), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
console.log(`Recommended model: ${report.recommended_model}`);
console.log(report.recommended_reason);

function detectAppleSilicon() {
  if (os.platform() !== "darwin") return { available: false, unified_memory_bytes: 0 };
  const unified = os.arch() === "arm64";
  return {
    available: unified,
    chip: unified ? commandOutput("sysctl", ["-n", "machdep.cpu.brand_string"]) || "Apple Silicon" : "not_apple_silicon",
    unified_memory_bytes: unified ? os.totalmem() : 0
  };
}

function detectNvidiaGpu() {
  const csv = commandOutput("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (!csv) return { available: false, devices: [], total_vram_mb: 0 };
  const devices = csv.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, memory] = line.split(",").map((part) => part.trim());
    return { name, vram_mb: Number(memory) || 0 };
  });
  return {
    available: devices.length > 0,
    devices,
    total_vram_mb: devices.reduce((sum, item) => sum + item.vram_mb, 0)
  };
}

function detectDiskCapacity(path) {
  try {
    const stat = statfsSync(path);
    return {
      total_bytes: stat.blocks * stat.bsize,
      free_bytes: stat.bavail * stat.bsize
    };
  } catch {
    return { total_bytes: 0, free_bytes: 0 };
  }
}

function selectRecommendedModel(input) {
  const vram = input.nvidia_gpu?.total_vram_mb || 0;
  const ramGb = (input.system_ram_bytes || 0) / (1024 ** 3);
  if (vram >= 24000) return "openbmb/MiniCPM-o-4_5";
  if (vram >= 16000) return "Qwen/Qwen2.5-Omni-7B";
  if (vram >= 10000) return "Qwen/Qwen2.5-Omni-3B";
  if (input.apple_silicon?.available && ramGb >= 16) return "HuggingFaceTB/SmolVLM2-2.2B-Instruct";
  if (input.apple_silicon?.available || ramGb >= 8) return "HuggingFaceTB/SmolVLM2-500M-Video-Instruct";
  return "HuggingFaceTB/SmolVLM2-500M-Video-Instruct";
}

function recommendationReason(input) {
  if (input.nvidia_gpu?.available) return `NVIDIA VRAM detected: ${input.nvidia_gpu.total_vram_mb} MB.`;
  if (input.apple_silicon?.available) return "Apple Silicon/MPS detected; using the smaller Apache-2.0 SmolVLM2 local path first.";
  return "No dedicated local GPU detected; using the smallest Apache-2.0 SmolVLM2 fallback.";
}

function detectCommand(command) {
  return Boolean(commandOutput(command, ["--help"]));
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
  } catch {
    return "";
  }
}
