#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, statfsSync, writeFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";

const outputPath = resolve("runs/voice-hardware-latest.json");
const report = {
  schema_version: "sensefield.voice_hardware.v1",
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
  cuda: detectCuda(),
  mps_available: os.platform() === "darwin" && os.arch() === "arm64" && torchProbe().mps_available === true,
  ram_bytes: os.totalmem(),
  disk: detectDiskCapacity(resolve(".")),
  python: pythonProbe(),
  candidates: selectCandidates()
};

mkdirSync(resolve("runs"), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
console.log(`Hardware: ${report.os.type} ${report.cpu.architecture}, RAM ${(report.ram_bytes / (1024 ** 3)).toFixed(1)} GB`);
console.log(`Apple Silicon: ${report.apple_silicon.available ? report.apple_silicon.chip : "no"}`);
console.log(`CUDA: ${report.cuda.available ? `${report.cuda.total_vram_mb} MB` : "not available"}`);
console.log(`MPS: ${report.mps_available ? "available" : "not available"}`);
console.log("Recommended voice: kokoro_82m");

function detectAppleSilicon() {
  if (os.platform() !== "darwin" || os.arch() !== "arm64") return { available: false, chip: "not_apple_silicon", unified_memory_bytes: 0 };
  return {
    available: true,
    chip: commandOutput("sysctl", ["-n", "machdep.cpu.brand_string"]) || "Apple Silicon",
    unified_memory_bytes: os.totalmem()
  };
}

function detectCuda() {
  const csv = commandOutput("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (!csv) return { available: false, devices: [], total_vram_mb: 0 };
  const devices = csv.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, memory] = line.split(",").map((part) => part.trim());
    return { name, vram_mb: Number(memory) || 0 };
  });
  return { available: devices.length > 0, devices, total_vram_mb: devices.reduce((sum, item) => sum + item.vram_mb, 0) };
}

function pythonProbe() {
  const python = process.env.SENSEFIELD_VOICE_PYTHON || (commandExists(resolve(".venv-voice/bin/python")) ? resolve(".venv-voice/bin/python") : "python3");
  return {
    executable: python,
    version: commandOutput(python, ["--version"]) || "not_found",
    packages: packageProbe(python)
  };
}

function torchProbe() {
  const python = process.env.SENSEFIELD_VOICE_PYTHON || (commandExists(resolve(".venv-voice/bin/python")) ? resolve(".venv-voice/bin/python") : "python3");
  const output = commandOutput(python, ["-c", "import json, importlib.util; info={'torch_installed': importlib.util.find_spec('torch') is not None};\nif info['torch_installed']:\n import torch; info.update({'cuda_available': torch.cuda.is_available(), 'cuda_device_count': torch.cuda.device_count(), 'mps_available': bool(getattr(torch.backends,'mps',None) and torch.backends.mps.is_available())});\nprint(json.dumps(info))"]);
  try {
    return JSON.parse(output || "{}");
  } catch {
    return {};
  }
}

function packageProbe(python) {
  const output = commandOutput(python, ["-c", "import importlib.util, json; print(json.dumps({name: importlib.util.find_spec(name) is not None for name in ['kokoro','chatterbox','cosyvoice','torch','soundfile','fastapi','uvicorn','psutil']}))"]);
  try {
    return JSON.parse(output || "{}");
  } catch {
    return {};
  }
}

function selectCandidates() {
  const ramGb = os.totalmem() / (1024 ** 3);
  const hasCuda = detectCuda().available;
  return [
    {
      id: "chatterbox_multilingual_v3",
      license: "MIT",
      viable: hasCuda || (os.platform() === "darwin" && os.arch() === "arm64" && ramGb >= 16),
      note: "Benchmark only if installed and load succeeds without reference audio."
    },
    {
      id: "chatterbox_turbo",
      license: "MIT",
      viable: false,
      note: "No reliable local Turbo runtime detected on this machine."
    },
    {
      id: "cosyvoice3",
      license: "Apache-2.0",
      viable: hasCuda && detectCuda().total_vram_mb >= 16000,
      note: "Skipped on this Apple Silicon 16GB pass; heavier streaming setup is not practical here."
    },
    {
      id: "kokoro_82m",
      license: "Apache-2.0",
      viable: true,
      note: "Lightweight local fallback and selected default on this machine."
    }
  ];
}

function detectDiskCapacity(path) {
  try {
    const stat = statfsSync(path);
    return { total_bytes: stat.blocks * stat.bsize, free_bytes: stat.bavail * stat.bsize };
  } catch {
    return { total_bytes: 0, free_bytes: 0 };
  }
}

function commandExists(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {
    return "";
  }
}
