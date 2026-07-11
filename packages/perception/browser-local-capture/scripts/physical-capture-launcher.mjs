#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { loadMovementRecognitionConfig, movementRecognitionHealth, movementRecognitionResponseForRequest, movementRecognitionUsageForRequest } from "../server/movement-recognition-provider.mjs";
import { automationExecutionResponseForRequest } from "../server/automation-server.mjs";
import {
  visualCompanionCancelResponseForRequest,
  visualCompanionHealth,
  visualCompanionObserveResponseForRequest,
  visualCompanionSpeakResponseForRequest
} from "../server/visual-companion-provider.mjs";

const root = resolve(".");
loadProjectRootEnv(root);
const startPath = "/";
const prototypeRoot = resolve(root, "packages/perception/browser-local-capture/prototype");
const prototypePath = resolve(prototypeRoot, "index.html");
const legacyPrototypePrefix = "/packages/perception/browser-local-capture/prototype/";
const movementAnalyzeRoute = "/api/movement-recognition/analyze";
const movementHealthRoute = "/api/movement-recognition/health";
const movementUsageRoute = "/api/movement-recognition/usage";
const visualHealthRoute = "/api/visual-companion/health";
const visualObserveRoute = "/api/visual-companion/observe";
const visualConversationRoute = "/api/visual-companion/conversation";
const visualSpeakRoute = "/api/visual-companion/speak";
const visualCancelRoute = "/api/visual-companion/cancel";
const automationExecuteRoute = "/api/automation/execute";
const maxApiBodyBytes = 8 * 1024 * 1024;
const port = parsePort(process.argv.slice(2), process.env.DARKQUEST_CAPTURE_PORT);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (await maybeHandleVisualCompanionApi(request, response, url)) return;
  if (await maybeHandleMovementRecognitionApi(request, response, url)) return;

  const filePath = resolveRequestPath(url.pathname);

  if (!isInside(prototypeRoot, filePath) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(response);
});

server.on("error", (error) => {
  if (error?.code === "EPERM" || error?.code === "EACCES") {
    console.error(`Unable to start local capture server on 127.0.0.1:${port}: permission denied.`);
    console.error("No server process was left running.");
    console.error("Run this command in a local terminal with localhost binding permission.");
    console.error("You can also try a different local port:");
    console.error("  npm run physical:capture -- --port 4180");
  } else if (error?.code === "EADDRINUSE") {
    console.error(`Unable to start local capture server on 127.0.0.1:${port}: port already in use.`);
    console.error("No server process was left running.");
    console.error("Stop the existing server or rerun on another local port:");
    console.error("  npm run physical:capture -- --port 4180");
  } else {
    console.error(`Unable to start local capture server on 127.0.0.1:${port}: ${error?.message ?? "unknown error"}`);
    console.error("No server process was left running.");
  }
  process.exit(1);
});

server.listen(port, "127.0.0.1", async () => {
  const url = `http://localhost:${port}${startPath}`;
  const visualHealth = await visualCompanionHealth(process.env);
  const movementConfig = loadMovementRecognitionConfig(process.env);
  console.log("DarkQuest local camera console");
  console.log("");
  console.log("Open:");
  console.log(url);
  console.log("");
  console.log("Fallback:");
  console.log(`http://127.0.0.1:${port}${startPath}`);
  console.log("");
  console.log("Legacy direct path:");
  console.log(`http://localhost:${port}${legacyPrototypePrefix}index.html`);
  console.log("");
  console.log("Camera starts only after clicking Start Camera.");
  console.log("Observe now captures a short temporary visual window and calls the local visual companion service.");
  console.log("Start the local visual and voice service with: npm run voice:serve");
  console.log(`Visual service: ${visualHealth.ok ? "ready" : visualHealth.status || "not running"}`);
  const voiceState = visualHealth.voice_ready
    ? (visualHealth.voice_status === "ready" ? "ready" : `configured (${visualHealth.voice_engine || "local_tts"})`)
    : "fallback voice active";
  console.log(`Natural local voice: ${voiceState}`);
  if (!visualHealth.voice_ready) console.log("Voice fallback: Natural voice unavailable — using system voice");
  console.log(`HF token loaded: ${movementConfig.token ? "yes" : "no"}`);
  console.log(`Cloud inference enabled: ${movementConfig.cloudEnabled ? "yes" : "no"}`);
  console.log(`Session limit: ${movementConfig.maxRequestsPerSession}`);
  console.log(`Daily limit: ${movementConfig.maxRequestsPerDay}`);
  console.log(`Monthly limit: ${movementConfig.maxRequestsPerMonth}`);
  console.log("No continuous upload. No raw media is saved by this app.");
  console.log("");
  console.log("Browser auto-open: disabled; paste the Open URL into Chrome, Edge, or Safari if a browser does not open.");
  console.log("Alternate port: npm run physical:capture -- --port 4180");
});

function parsePort(args, envPort) {
  const explicit = readPortArg(args);
  const value = explicit ?? envPort ?? "4177";
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.error(`Invalid port: ${value}`);
    console.error("Use: npm run physical:capture -- --port 4180");
    process.exit(1);
  }
  return parsed;
}

function readPortArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") return args[index + 1];
    if (arg.startsWith("--port=")) return arg.slice("--port=".length);
  }
  return null;
}

function resolveRequestPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);

  if (decodedPath === "/" || decodedPath === "/index.html") {
    return prototypePath;
  }

  if (decodedPath.startsWith(legacyPrototypePrefix)) {
    return join(prototypeRoot, normalize(decodedPath.slice(legacyPrototypePrefix.length)).replace(/^[/\\]+/, ""));
  }

  return join(prototypeRoot, normalize(decodedPath).replace(/^[/\\]+/, ""));
}

function isInside(parentPath, candidatePath) {
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${sep}`);
}

async function maybeHandleVisualCompanionApi(request, response, url) {
  if (request.method === "GET" && url.pathname === visualHealthRoute) {
    writeJson(response, 200, await visualCompanionHealth(process.env));
    return true;
  }
  if (request.method === "POST" && [visualObserveRoute, visualConversationRoute].includes(url.pathname)) {
    try {
      const body = await readJsonBody(request);
      const conversation = url.pathname === visualConversationRoute;
      const result = await visualCompanionObserveResponseForRequest(conversation ? {
        ...body,
        interaction_mode: "conversation",
        requested_response_mode: "conversation"
      } : body, process.env);
      writeJson(response, result.status, result.json);
    } catch (error) {
      writeJson(response, 400, {
        schema_version: "contextual-visual-response.v1",
        response_type: "uncertain",
        observation_summary: "The observation window could not be analyzed.",
        spoken_response: error?.message || "I'm not sure what changed. Try showing me again.",
        confidence: 0,
        uncertainty: true,
        suggested_actions: [],
        evidence: ["bad_request"],
        provider: "local_visual_companion",
        model: process.env.VISUAL_COMPANION_MODEL || "HuggingFaceTB/SmolVLM2-2.2B-Instruct",
        latency_ms: 0,
        contains_raw_media: false
      });
    }
    return true;
  }
  if (request.method === "POST" && url.pathname === visualSpeakRoute) {
    try {
      const body = await readJsonBody(request);
      const result = await visualCompanionSpeakResponseForRequest(body, process.env);
      if (result.body) {
        writeBinary(response, result.status, result.body, result.contentType || "audio/wav", result.headers || {});
      } else {
        writeJson(response, result.status, result.json);
      }
    } catch {
      writeJson(response, 400, {
        ok: false,
        engine: "browser_speech_fallback",
        code: "visual_tts_bad_request",
        voice_status: "Natural voice unavailable — using system voice",
        contains_raw_media: false
      });
    }
    return true;
  }
  if (request.method === "POST" && url.pathname === visualCancelRoute) {
    const result = await visualCompanionCancelResponseForRequest(process.env);
    writeJson(response, result.status, result.json);
    return true;
  }
  return false;
}

async function maybeHandleMovementRecognitionApi(request, response, url) {
  if (request.method === "GET" && url.pathname === movementHealthRoute) {
    writeJson(response, 200, movementRecognitionHealth(process.env));
    return true;
  }
  if (request.method === "GET" && url.pathname === movementUsageRoute) {
    const result = movementRecognitionUsageForRequest(process.env, { sessionId: darkQuestSessionId(request) });
    writeJson(response, result.status, result.json);
    return true;
  }
  if (request.method === "POST" && url.pathname === movementAnalyzeRoute) {
    try {
      const body = await readJsonBody(request);
      const result = await movementRecognitionResponseForRequest(body, process.env, { sessionId: darkQuestSessionId(request), bodyBytes: body.__body_bytes });
      writeJson(response, result.status, result.json);
    } catch (error) {
      writeJson(response, 400, {
        schema_version: "canonical-movement-result.v1",
        movement_result_id: `movement_${Date.now()}`,
        action_type: "uncertain",
        movement: "Uncertain — try again.",
        short_label: "Uncertain",
        movement_key: "uncertain",
        gesture_tags: [],
        confidence: 0,
        reason: error?.message || "Invalid movement recognition request.",
        evidence: ["bad_request"],
        provider: "huggingface",
        model: "unknown",
        requested_model: "unknown",
        returned_model: "",
        provider_model: "",
        latency_ms: 0,
        requires_confirmation: true
      });
    }
    return true;
  }
  if (request.method === "POST" && url.pathname === automationExecuteRoute) {
    try {
      const body = await readJsonBody(request);
      const result = await automationExecutionResponseForRequest(body, process.env);
      writeJson(response, result.status, result.json);
    } catch {
      writeJson(response, 400, { ok: false, status: "failed", safe_message: "Automation failed — view safe details", contains_raw_media: false });
    }
    return true;
  }
  return false;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxApiBodyBytes) throw new Error("Movement recognition payload too large.");
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const body = parsed && typeof parsed === "object" ? parsed : {};
  Object.defineProperty(body, "__body_bytes", { value: size, enumerable: false });
  return body;
}

function darkQuestSessionId(request) {
  return request.headers?.["x-darkquest-session-id"] || "";
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function writeBinary(response, status, body, contentType, headers = {}) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...headers
  });
  response.end(body);
}

function loadProjectRootEnv(projectRoot) {
  const envPath = resolve(projectRoot, ".env");
  if (!existsSync(envPath)) return { loaded: false, applied: 0 };
  const text = readFileSync(envPath, "utf8");
  let applied = 0;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
    applied += 1;
  }
  return { loaded: true, applied };
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
