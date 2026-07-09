import http from "node:http";
import { movementRecognitionHealth, movementRecognitionResponseForRequest } from "./movement-recognition-provider.mjs";

const ANALYZE_ROUTE = "/api/movement-recognition/analyze";
const HEALTH_ROUTE = "/api/movement-recognition/health";
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function createMovementRecognitionServer(options = {}) {
  return http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === HEALTH_ROUTE) {
      writeJson(response, 200, movementRecognitionHealth(options.env));
      return;
    }
    if (request.method !== "POST" || request.url !== ANALYZE_ROUTE) {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const result = await movementRecognitionResponseForRequest(body, options.env, options);
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
        latency_ms: 0,
        requires_confirmation: true
      });
    }
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Movement recognition payload too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  createMovementRecognitionServer().listen(port, "127.0.0.1", () => {
    process.stdout.write(`movement recognition server listening on http://127.0.0.1:${port}${ANALYZE_ROUTE}\n`);
  });
}
