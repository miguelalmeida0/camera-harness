#!/usr/bin/env node
import { resolve } from "node:path";
import {
  discoverVoiceRuntime,
  ensureNeuralVoiceService,
  loadProjectEnv,
  probeVoicePython,
  requestVoiceDoctorSample,
  stopOwnedVoiceService
} from "./neural-voice-startup.mjs";

const root = resolve(".");
loadProjectEnv(root);
let service = null;

try {
  const runtime = discoverVoiceRuntime({ root, env: process.env });
  if (!runtime.ok) throw Object.assign(new Error("Neural voice runtime was not found."), { code: "runtime_not_found" });
  console.log("Voice runtime: found");
  const python = probeVoicePython(runtime, { root, env: process.env });
  if (!python.ok) throw Object.assign(new Error(`Required dependency import failed${python.missing.length ? `: ${python.missing.join(", ")}` : "."}`), { code: "dependency_import_failed" });
  console.log(`Voice Python: ready (${python.version})`);
  console.log(`Voice model: ${process.env.SENSEFIELD_VOICE_MODEL || "kokoro_82m"}`);
  service = await ensureNeuralVoiceService({ root, env: process.env, runtime, pythonProbe: () => python });
  console.log(`Voice service: ${service.owned ? "started" : "already healthy"}`);
  console.log(`Voice health: ready (${service.serviceUrl})`);
  const sample = await requestVoiceDoctorSample(service.serviceUrl);
  console.log(`Voice /speak: HTTP ${sample.httpStatus}, ${sample.mimeType}, ${sample.audioBytes} bytes`);
  console.log(`Decoded duration: ${sample.decodedDurationMs} ms`);
  console.log("SENSEFIELD_VOICE_DOCTOR_OK");
} catch (error) {
  console.error(`Voice doctor failed at ${error?.code || "unknown_stage"}: ${error?.message || "Unknown error"}`);
  process.exitCode = 1;
} finally {
  stopOwnedVoiceService(service);
}
