#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const manifestPath = resolve("runs/voice-setup-latest.json");
const venvPython = resolve(".venv-voice/bin/python");
if (!process.env.SENSEFIELD_VOICE_PYTHON && !existsSync(venvPython)) {
  spawnSync("python3", ["-m", "venv", ".venv-voice"], { stdio: "inherit" });
}
const python = process.env.SENSEFIELD_VOICE_PYTHON || (existsSync(venvPython) ? venvPython : "python3");
const installHeavy = process.env.SENSEFIELD_VOICE_INSTALL_HEAVY === "1";
const installRequested = process.env.SENSEFIELD_VOICE_SKIP_INSTALL !== "1";
const packages = [
  "kokoro>=0.9.4",
  "soundfile>=0.14.0",
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.30.0",
  "psutil>=5.9.0"
];
if (installHeavy) packages.push("chatterbox-tts");

mkdirSync(resolve("runs"), { recursive: true });

const manifest = {
  schema_version: "sensefield.voice_setup.v1",
  generated_at: new Date().toISOString(),
  python,
  selected_default: "kokoro_82m",
  selected_voice: "sensefield_default",
  license: "Apache-2.0",
  no_paid_api: true,
  api_key_required: false,
  install_requested: installRequested,
  heavy_candidates_requested: installHeavy,
  packages,
  status: "prepared"
};

if (installRequested) {
  const result = spawnSync(python, ["-m", "pip", "install", ...packages], { stdio: "inherit", env: process.env });
  manifest.status = result.status === 0 ? "installed" : "install_failed";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.exitCode = result.status || 0;
} else {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`${manifest.status}: ${manifest.selected_default}`);
console.log(`Manifest: ${manifestPath}`);
