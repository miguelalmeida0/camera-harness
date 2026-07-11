#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const venvPython = resolve(".venv-voice/bin/python");
const python = process.env.SENSEFIELD_VOICE_PYTHON || (existsSync(venvPython) ? venvPython : "python3");
const script = resolve("services/visual-companion/voice_benchmark.py");

const result = spawnSync(python, [script], {
  stdio: "inherit",
  env: {
    ...process.env,
    PYTHONPATH: [resolve("services/visual-companion"), process.env.PYTHONPATH || ""].filter(Boolean).join(":")
  }
});

process.exitCode = result.status || 0;
