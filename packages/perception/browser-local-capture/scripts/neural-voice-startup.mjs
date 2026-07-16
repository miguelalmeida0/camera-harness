import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const DEFAULT_VOICE_SERVICE_URL = "http://127.0.0.1:8766";
export const DEFAULT_VOICE_STARTUP_TIMEOUT_MS = 30000;

export function loadProjectEnv(projectRoot, env = process.env) {
  const envPath = resolve(projectRoot, ".env");
  if (!existsSync(envPath)) return { loaded: false, applied: 0 };
  let applied = 0;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || env[parsed.key] !== undefined) continue;
    env[parsed.key] = parsed.value;
    applied += 1;
  }
  return { loaded: true, applied };
}

export function discoverVoiceRuntime({
  root = resolve("."),
  env = process.env,
  isUsable = executableExists,
  commonRepoRoot = gitCommonRepoRoot(root)
} = {}) {
  const configuredRuntime = String(env.SENSEFIELD_VOICE_RUNTIME_DIR || "").trim();
  const configuredPython = String(env.SENSEFIELD_VOICE_PYTHON || "").trim();
  const candidates = [];
  if (configuredPython) candidates.push(resolveConfiguredPath(root, configuredPython));
  if (configuredRuntime) {
    const runtimeRoot = resolveConfiguredPath(root, configuredRuntime);
    candidates.push(join(runtimeRoot, "bin", "python"), join(runtimeRoot, ".venv-voice", "bin", "python"));
  }
  candidates.push(join(root, ".venv-voice", "bin", "python"));
  if (commonRepoRoot && resolve(commonRepoRoot) !== resolve(root)) {
    candidates.push(join(commonRepoRoot, ".venv-voice", "bin", "python"));
  }
  const python = [...new Set(candidates)].find((candidate) => isUsable(candidate)) || "";
  const serviceScript = join(root, "services", "visual-companion", "app.py");
  return {
    ok: Boolean(python && existsSync(serviceScript)),
    python,
    runtimeDir: python ? dirname(dirname(python)) : "",
    serviceScript,
    configured: Boolean(configuredPython || configuredRuntime),
    checkedCandidates: candidates.length
  };
}

export function voiceProcessEnvironment(root = resolve("."), env = process.env) {
  const configuredTemp = String(env.SENSEFIELD_VOICE_TMPDIR || "").trim();
  const candidates = [
    configuredTemp ? resolveConfiguredPath(root, configuredTemp) : "",
    String(env.TMPDIR || "").trim(),
    join(root, ".models")
  ].filter(Boolean);
  const tempDir = candidates.find((candidate) => writableDirectory(candidate));
  return tempDir ? { ...env, TMPDIR: tempDir } : { ...env };
}

export function probeVoicePython(runtime, { root = resolve("."), env = process.env, run = spawnSync } = {}) {
  if (!runtime?.python) return { ok: false, stage: "runtime_discovery", missing: ["python"] };
  const selectedModel = String(env.SENSEFIELD_VOICE_MODEL || "kokoro_82m");
  const selectedPackage = selectedModel.startsWith("chatterbox") ? "chatterbox" : selectedModel === "cosyvoice3" ? "cosyvoice" : "kokoro";
  const packages = ["fastapi", "uvicorn", "pydantic", "PIL", "numpy", "soundfile", selectedPackage];
  const program = [
    "import importlib, json, sys",
    `names=${JSON.stringify(packages)}`,
    "result={'imports':{},'errors':{},'version':sys.version.split()[0]}",
    "for name in names:",
    " try:",
    "  importlib.import_module(name); result['imports'][name]=True",
    " except Exception as error:",
    "  result['imports'][name]=False; result['errors'][name]=type(error).__name__",
    "print(json.dumps(result))",
    "sys.exit(0 if all(result['imports'].values()) else 2)"
  ].join("\n");
  const result = run(runtime.python, ["-c", program], {
    cwd: root,
    env: voiceProcessEnvironment(root, env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 20000
  });
  let details = {};
  try { details = JSON.parse(String(result.stdout || "{}").trim() || "{}"); } catch {}
  const missing = packages.filter((name) => details.imports?.[name] !== true);
  const code = missing.includes("kokoro") ? "kokoro_import_failed" : "dependency_import_failed";
  return {
    ok: result.status === 0 && missing.length === 0,
    stage: result.status === 0 && missing.length === 0 ? "dependencies_ready" : "dependency_import",
    version: details.version || "",
    missing,
    errorTypes: details.errors || {},
    code
  };
}

export async function checkNeuralVoiceHealth(serviceUrl, { fetch: send = globalThis.fetch, timeoutMs = 3000 } = {}) {
  const safeUrl = safeServiceUrl(serviceUrl);
  if (typeof send !== "function") return { reachable: false, ready: false, serviceUrl: safeUrl, reason: "fetch_unavailable" };
  try {
    const response = await send(endpointUrl(serviceUrl, "/health"), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: timeoutSignal(timeoutMs)
    });
    const body = await response.json().catch(() => ({}));
    return {
      reachable: true,
      ready: response.ok && body?.voice_ready === true,
      warmed: body?.voice_warmed === true,
      serviceUrl: safeUrl,
      httpStatus: response.status,
      healthStatus: String(body?.voice_status || body?.status || "unknown"),
      engine: String(body?.voice_engine || ""),
      model: String(body?.voice_model || "")
    };
  } catch (error) {
    return {
      reachable: false,
      ready: false,
      serviceUrl: safeUrl,
      reason: error?.name === "TimeoutError" ? "timeout" : "service_unreachable"
    };
  }
}

export async function ensureNeuralVoiceService({
  root = resolve("."),
  env = process.env,
  runtime = discoverVoiceRuntime({ root, env }),
  healthCheck = (url) => checkNeuralVoiceHealth(url),
  pythonProbe = (candidate) => probeVoicePython(candidate, { root, env }),
  warmUp = (url) => warmNeuralVoiceService(url, { timeoutMs }),
  spawnVoice = spawnVoiceService,
  sleep = delay,
  now = Date.now,
  timeoutMs = positiveInt(env.SENSEFIELD_VOICE_STARTUP_TIMEOUT_MS, DEFAULT_VOICE_STARTUP_TIMEOUT_MS)
} = {}) {
  const serviceUrl = String(env.VISUAL_COMPANION_URL || DEFAULT_VOICE_SERVICE_URL);
  const initialHealth = await healthCheck(serviceUrl);
  if (initialHealth.ready) {
    const warmup = await warmUp(serviceUrl);
    if (!warmup.ok) throw voiceStartupError(warmup.message || "Neural voice warm-up failed.", warmup.code || "warmup_failed");
    return { ready: true, owned: false, child: null, runtime, health: { ...initialHealth, warmed: true }, warmup, serviceUrl: safeServiceUrl(serviceUrl) };
  }
  if (initialHealth.reachable) throw voiceStartupError("Neural voice health endpoint responded but the selected voice is not ready.", "health_not_ready");
  if (!runtime.ok) throw voiceStartupError("Neural voice runtime was not found.", "runtime_not_found");
  const probe = await pythonProbe(runtime);
  if (!probe.ok) throw voiceStartupError(probe.code === "kokoro_import_failed" ? "Kokoro could not be imported by the configured voice runtime." : `Neural voice dependency import failed${probe.missing?.length ? `: ${probe.missing.join(", ")}` : "."}`, probe.code || "dependency_import_failed");
  const child = spawnVoice({ root, env, runtime, serviceUrl });
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    if (child.exitCode !== null && child.exitCode !== undefined) {
      throw voiceStartupError("Neural voice service exited before becoming ready.", "service_exited");
    }
    await sleep(250);
    const health = await healthCheck(serviceUrl);
    if (health.ready) {
      const warmup = await warmUp(serviceUrl);
      if (!warmup.ok) {
        stopOwnedVoiceService({ owned: true, child });
        throw voiceStartupError(warmup.message || "Neural voice warm-up failed.", warmup.code || "warmup_failed");
      }
      return { ready: true, owned: true, child, runtime, health: { ...health, warmed: true }, warmup, serviceUrl: safeServiceUrl(serviceUrl) };
    }
  }
  stopOwnedVoiceService({ owned: true, child });
  throw voiceStartupError("Neural voice service did not become ready before the startup timeout.", "startup_timeout");
}

export async function warmNeuralVoiceService(serviceUrl, {
  fetch: send = globalThis.fetch,
  timeoutMs = DEFAULT_VOICE_STARTUP_TIMEOUT_MS
} = {}) {
  try {
    const response = await send(endpointUrl(serviceUrl, "/warmup"), {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: timeoutSignal(timeoutMs)
    });
    const mimeType = String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
    const body = await response.json().catch(() => null);
    if (mimeType !== "application/json" || !body || typeof body !== "object") {
      return warmupFailure("service_contract_mismatch", response.status, mimeType);
    }
    const hasAudioProof = body.model_initialized === true
      && body.voice === "sensefield_default"
      && Number(body.sample_rate) > 0
      && Number(body.audio_duration_ms) > 0
      && Number(body.audio_bytes) > 44;
    if (response.ok && body.ok === true && body.voice_warmed === true && hasAudioProof) {
      return {
        ok: true,
        alreadyWarm: body.already_warm === true,
        warmupMs: Math.max(0, Number(body.warmup_ms || 0)),
        audioDurationMs: Math.max(0, Number(body.audio_duration_ms || 0)),
        audioBytes: Math.max(0, Number(body.audio_bytes || 0)),
        sampleRate: Math.max(0, Number(body.sample_rate || 0)),
        voice: String(body.voice || ""),
        modelInitialized: true,
        httpStatus: response.status,
        mimeType
      };
    }
    if (response.ok && (body.ok === true || body.voice_warmed === true)) {
      return warmupFailure("service_contract_mismatch", response.status, mimeType);
    }
    return warmupFailure(normalizeWarmupCode(body.code, response.status), response.status, mimeType);
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return warmupFailure(timedOut ? "warmup_timeout" : "service_unreachable", 0, "");
  }
}

export function spawnVoiceService({ root, env, runtime, serviceUrl }) {
  const url = localServiceUrl(serviceUrl);
  return spawn(runtime.python, [runtime.serviceScript, "--host", url.hostname, "--port", url.port || "80"], {
    cwd: root,
    env: { ...voiceProcessEnvironment(root, env), PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "ignore", "ignore"]
  });
}

export function stopOwnedVoiceService(handle) {
  if (!handle?.owned || !handle.child || handle.child.exitCode !== null) return false;
  handle.child.kill("SIGTERM");
  return true;
}

export async function requestVoiceDoctorSample(serviceUrl, {
  fetch: send = globalThis.fetch,
  phrase = "Sensefield neural voice test.",
  timeoutMs = 180000
} = {}) {
  const response = await send(endpointUrl(serviceUrl, "/speak"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/wav" },
    body: JSON.stringify({ text: phrase, voice: "sensefield_default", style: "warm_conversational", contains_raw_media: false }),
    signal: timeoutSignal(timeoutMs)
  });
  const mimeType = String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!response.ok) throw voiceStartupError(`Neural voice /speak returned HTTP ${response.status}.`, "speak_http_failure");
  if (!/^audio\/(wav|wave|x-wav)$/.test(mimeType)) throw voiceStartupError(`Neural voice /speak returned invalid MIME type: ${mimeType || "missing"}.`, "invalid_audio_mime");
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) throw voiceStartupError("Neural voice /speak returned empty audio.", "empty_audio");
  const decodedDurationMs = decodeWavDurationMs(audio);
  if (!(decodedDurationMs > 0)) throw voiceStartupError("Neural voice audio duration could not be decoded.", "invalid_audio_duration");
  return { httpStatus: response.status, mimeType, audioBytes: audio.byteLength, decodedDurationMs };
}

export function decodeWavDurationMs(audio) {
  const buffer = Buffer.from(audio || []);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return 0;
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt " && size >= 16 && start + 12 <= buffer.length) byteRate = buffer.readUInt32LE(start + 8);
    if (id === "data") { dataBytes = Math.min(size, Math.max(0, buffer.length - start)); break; }
    offset = start + size + (size % 2);
  }
  return byteRate > 0 && dataBytes > 0 ? Math.round((dataBytes / byteRate) * 1000) : 0;
}

export function safeServiceUrl(value) {
  try {
    const url = new URL(String(value || DEFAULT_VOICE_SERVICE_URL));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_VOICE_SERVICE_URL;
  }
}

function endpointUrl(base, pathname) {
  const url = new URL(String(base || DEFAULT_VOICE_SERVICE_URL));
  url.pathname = `${url.pathname.replace(/\/$/, "")}${pathname}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function localServiceUrl(value) {
  const url = new URL(String(value || DEFAULT_VOICE_SERVICE_URL));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw voiceStartupError("Neural voice auto-start requires a local HTTP service URL.", "non_local_service_url");
  }
  return url;
}

function gitCommonRepoRoot(root) {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (result.status !== 0) return "";
  const commonDir = String(result.stdout || "").trim();
  return commonDir ? dirname(resolve(root, commonDir)) : "";
}

function executableExists(path) {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}

function writableDirectory(path) {
  try { accessSync(path, constants.R_OK | constants.W_OK); return true; } catch { return false; }
}

function normalizeWarmupCode(value, httpStatus) {
  const code = String(value || "");
  const allowed = new Set([
    "kokoro_import_failed",
    "voice_not_found",
    "model_initialization_failed",
    "synthesis_empty",
    "synthesis_invalid",
    "synthesis_failed",
    "invalid_sample_rate",
    "wav_encoding_failed",
    "warmup_timeout",
    "service_contract_mismatch"
  ]);
  if (allowed.has(code)) return code;
  if (httpStatus === 404 || httpStatus === 405) return "service_contract_mismatch";
  return "model_initialization_failed";
}

function warmupFailure(code, httpStatus, mimeType) {
  const messages = {
    kokoro_import_failed: "Kokoro could not be imported by the neural voice service.",
    voice_not_found: "The configured Kokoro voice was not found.",
    model_initialization_failed: "The neural voice model could not be initialized.",
    synthesis_empty: "Neural voice warm-up produced no audio.",
    synthesis_invalid: "Neural voice warm-up produced invalid audio samples.",
    synthesis_failed: "Neural voice warm-up synthesis failed.",
    invalid_sample_rate: "Neural voice warm-up returned an invalid sample rate.",
    wav_encoding_failed: "Neural voice warm-up could not encode valid WAV audio.",
    warmup_timeout: "Neural voice warm-up exceeded the measured startup bound.",
    service_contract_mismatch: "The neural voice warm-up response did not match the required contract.",
    service_unreachable: "The neural voice service became unreachable during warm-up."
  };
  return {
    ok: false,
    alreadyWarm: false,
    warmupMs: 0,
    code,
    message: messages[code] || "Neural voice warm-up failed.",
    httpStatus,
    mimeType
  };
}

function resolveConfiguredPath(root, value) {
  return isAbsolute(value) ? value : resolve(root, value);
}

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;
  return { key: match[1], value: parseEnvValue(match[2]) };
}

function parseEnvValue(rawValue) {
  const value = String(rawValue ?? "").trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    const unquoted = value.slice(1, -1);
    return value.startsWith("\"")
      ? unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, "\"").replace(/\\\\/g, "\\")
      : unquoted;
  }
  return value.replace(/\s+#.*$/, "");
}

function timeoutSignal(ms) {
  return typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function voiceStartupError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
