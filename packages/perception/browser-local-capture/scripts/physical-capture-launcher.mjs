#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { movementRecognitionHealth, movementRecognitionResponseForRequest } from "../server/movement-recognition-provider.mjs";

const root = resolve(".");
const startPath = "/";
const prototypeRoot = resolve(root, "packages/perception/browser-local-capture/prototype");
const prototypePath = resolve(prototypeRoot, "index.html");
const legacyPrototypePrefix = "/packages/perception/browser-local-capture/prototype/";
const movementAnalyzeRoute = "/api/movement-recognition/analyze";
const movementHealthRoute = "/api/movement-recognition/health";
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

server.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}${startPath}`;
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
  console.log("Analyze Movement requires HF_TOKEN for live Hugging Face/Cerebras inference.");
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

async function maybeHandleMovementRecognitionApi(request, response, url) {
  if (request.method === "GET" && url.pathname === movementHealthRoute) {
    writeJson(response, 200, movementRecognitionHealth(process.env));
    return true;
  }
  if (request.method === "POST" && url.pathname === movementAnalyzeRoute) {
    try {
      const body = await readJsonBody(request);
      const result = await movementRecognitionResponseForRequest(body, process.env);
      writeJson(response, result.status, result.json);
    } catch (error) {
      writeJson(response, 400, {
        action_type: "uncertain",
        movement: "Uncertain — try again.",
        short_label: "Uncertain",
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
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
