#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";

const siblingMain = resolve(dirname(process.cwd()), "camera-harness");
const pythonCandidates = [resolve(".venv-voice/bin/python"), resolve(siblingMain, ".venv-voice/bin/python"), "python3"];
const python = pythonCandidates.find((candidate) => candidate === "python3" || existsSync(candidate));
const modelCandidates = [
  resolve(".models/visual-companion/smolvlm2-2.2b-instruct"),
  resolve(siblingMain, ".models/visual-companion/smolvlm2-2.2b-instruct"),
  resolve(os.homedir(), ".cache/huggingface/hub/models--HuggingFaceTB--SmolVLM2-2.2B-Instruct")
];
const modelAvailable = modelCandidates.some(existsSync);
if (!python || !modelAvailable) {
  process.stdout.write("REAL_SPATIAL_MODEL_UNAVAILABLE\n");
  process.exit(0);
}

const result = spawnSync(python, [resolve("services/visual-companion/spatial_smoke.py")], {
  cwd: process.cwd(),
  env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", TOKENIZERS_PARALLELISM: "false" },
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  timeout: 240000
});
const status = String(result.stdout || "").trim().split(/\r?\n/).at(-1);
if (["REAL_SPATIAL_MODEL_PASS", "REAL_SPATIAL_MODEL_UNAVAILABLE", "REAL_SPATIAL_MODEL_FAILED"].includes(status)) {
  process.stdout.write(`${status}\n`);
  process.exit(status === "REAL_SPATIAL_MODEL_FAILED" ? 1 : 0);
}
process.stdout.write(`${result.error?.code === "ETIMEDOUT" ? "REAL_SPATIAL_MODEL_FAILED" : "REAL_SPATIAL_MODEL_UNAVAILABLE"}\n`);
process.exit(result.error?.code === "ETIMEDOUT" ? 1 : 0);
