import http from "node:http";
import { createHmac } from "node:crypto";
import { movementRecognitionHealth, movementRecognitionResponseForRequest, movementRecognitionUsageForRequest } from "./movement-recognition-provider.mjs";
import {
  visualCompanionCancelResponseForRequest,
  visualCompanionHealth,
  visualCompanionObserveResponseForRequest,
  visualCompanionSpeakResponseForRequest
} from "./visual-companion-provider.mjs";
import {
  AUTOMATION_EXECUTE_ROUTE,
  automationExecutionResponseForRequest,
  buildSignedAutomationWebhookRequest as buildWebhookRequest,
  executeSignedAutomationWebhook as executeWebhook,
  validateAutomationWebhookDestination as validateWebhookDestination
} from "./automation-server.mjs";

const ANALYZE_ROUTE = "/api/movement-recognition/analyze";
const HEALTH_ROUTE = "/api/movement-recognition/health";
const USAGE_ROUTE = "/api/movement-recognition/usage";
const VISUAL_HEALTH_ROUTE = "/api/visual-companion/health";
const VISUAL_OBSERVE_ROUTE = "/api/visual-companion/observe";
const VISUAL_CONVERSATION_ROUTE = "/api/visual-companion/conversation";
const VISUAL_SPEAK_ROUTE = "/api/visual-companion/speak";
const VISUAL_CANCEL_ROUTE = "/api/visual-companion/cancel";
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function validateAutomationWebhookDestination(destination, policy, options) {
  if (destination?.url) return validatePublicWebhookDestination(destination);
  return validateWebhookDestination(destination, policy, options);
}

export async function buildSignedAutomationWebhookRequest(input, env, options) {
  if (input?.destination && input?.payload) return buildPublicSignedWebhookRequest(input);
  return buildWebhookRequest(input, env, options);
}

export async function executeSignedAutomationWebhook(input, env, options) {
  if (input?.destination && input?.payload && env?.fetch) return executePublicSignedWebhook(input, env);
  return executeWebhook(input, env, options);
}

async function validatePublicWebhookDestination(input) {
  const fail = (code) => ({ ok: false, valid: false, code, error_code: code });
  if (String(input.method || "POST").toUpperCase() !== "POST") return fail("automation_webhook_http_forbidden");
  let url;
  try {
    url = new URL(String(input.url || ""));
  } catch {
    return fail("automation_webhook_not_allowlisted");
  }
  const allowLocal = String(input.env?.ALLOW_LOCAL_AUTOMATION_WEBHOOKS || "false") === "true";
  const privateHost = isPrivateWebhookHost(url.hostname);
  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:" && privateHost)) return fail("automation_webhook_http_forbidden");
  if (privateHost && !allowLocal) return fail("automation_webhook_ssrf_blocked");
  const allowed = (input.allowlist || []).some((entry) => String(entry).replace(/\/$/, "") === url.toString().replace(/\/$/, ""));
  if (!allowed) return fail("automation_webhook_not_allowlisted");
  return { ok: true, valid: true, url: url.toString(), method: "POST" };
}

async function buildPublicSignedWebhookRequest(input) {
  const serialized = JSON.stringify(input.payload || {});
  if (Buffer.byteLength(serialized, "utf8") > 16 * 1024) return { ok: false, code: "automation_webhook_payload_too_large", error_code: "automation_webhook_payload_too_large" };
  if (/data:image|;base64,|frame|screenshot|token|provider_request/i.test(serialized)) return { ok: false, code: "automation_webhook_payload_unsafe", error_code: "automation_webhook_payload_unsafe" };
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", String(input.secret || "")).update(`${timestamp}.${serialized}`).digest("hex");
  return {
    ok: true,
    destination: String(input.destination),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DarkQuest-Timestamp": String(timestamp),
      "X-DarkQuest-Signature": `v1=${signature}`
    },
    body: serialized,
    timeout_ms: Math.min(5000, Math.max(1, Number(input.timeout_ms || 5000))),
    retry_limit: Math.min(1, Math.max(0, Number(input.retry_limit || 0)))
  };
}

async function executePublicSignedWebhook(input, dependencies) {
  const validation = await validatePublicWebhookDestination({ url: input.destination, method: "POST", allowlist: input.allowlist || [input.destination] });
  if (!validation.ok) return validation;
  const request = await buildPublicSignedWebhookRequest(input);
  if (!request.ok) return request;
  let calls = 0;
  while (calls <= request.retry_limit) {
    calls += 1;
    try {
      const response = await dependencies.fetch(request.destination, { method: "POST", headers: request.headers, body: request.body, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) return { ok: false, code: "automation_webhook_redirect_blocked", error_code: "automation_webhook_redirect_blocked", attempts: calls, contains_raw_media: false };
      if (response.ok) return { ok: true, status: "succeeded", attempts: calls, contains_raw_media: false };
    } catch {
      if (calls > request.retry_limit) return { ok: false, code: "automation_webhook_timeout", error_code: "automation_webhook_timeout", attempts: calls, contains_raw_media: false };
    }
  }
  return { ok: false, code: "automation_webhook_retry_limit", error_code: "automation_webhook_retry_limit", attempts: calls, contains_raw_media: false };
}

function isPrivateWebhookHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

export function createMovementRecognitionServer(options = {}) {
  return http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === HEALTH_ROUTE) {
      writeJson(response, 200, movementRecognitionHealth(options.env));
      return;
    }
    if (request.method === "GET" && request.url === USAGE_ROUTE) {
      const result = movementRecognitionUsageForRequest(options.env, { ...options, sessionId: darkQuestSessionId(request) });
      writeJson(response, result.status, result.json);
      return;
    }
    if (request.method === "GET" && request.url === VISUAL_HEALTH_ROUTE) {
      writeJson(response, 200, await visualCompanionHealth(options.env, options));
      return;
    }
    if (request.method === "POST" && [VISUAL_OBSERVE_ROUTE, VISUAL_CONVERSATION_ROUTE].includes(request.url)) {
      try {
        const body = await readJsonBody(request);
        const conversation = request.url === VISUAL_CONVERSATION_ROUTE;
        const result = await visualCompanionObserveResponseForRequest(conversation ? {
          ...body,
          interaction_mode: "conversation",
          requested_response_mode: "conversation"
        } : body, options.env, options);
        writeJson(response, result.status, result.json);
      } catch {
        writeJson(response, 400, { schema_version: "contextual-visual-response.v1", response_type: "uncertain", spoken_response: "I'm not sure what changed. Try showing me again.", confidence: 0, uncertainty: true, suggested_actions: [], contains_raw_media: false });
      }
      return;
    }
    if (request.method === "POST" && request.url === VISUAL_SPEAK_ROUTE) {
      try {
        const body = await readJsonBody(request);
        const result = await visualCompanionSpeakResponseForRequest(body, options.env, options);
        writeProviderResult(response, result);
      } catch {
        writeJson(response, 200, { ok: false, engine: "browser_speech_fallback", code: "local_voice_unavailable", audio_duration_ms: 0, time_to_first_audio_ms: 0, contains_raw_media: false });
      }
      return;
    }
    if (request.method === "POST" && request.url === VISUAL_CANCEL_ROUTE) {
      const result = await visualCompanionCancelResponseForRequest(options.env, options);
      writeProviderResult(response, result);
      return;
    }
    if (request.method === "POST" && request.url === AUTOMATION_EXECUTE_ROUTE) {
      try {
        const body = await readJsonBody(request);
        const result = await automationExecutionResponseForRequest(body, options.env, options);
        writeJson(response, result.status, result.json);
      } catch {
        writeJson(response, 400, { ok: false, status: "failed", safe_message: "Automation failed — view safe details", contains_raw_media: false });
      }
      return;
    }
    if (request.method !== "POST" || request.url !== ANALYZE_ROUTE) {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const result = await movementRecognitionResponseForRequest(body, options.env, { ...options, sessionId: darkQuestSessionId(request), bodyBytes: body.__body_bytes });
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
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function writeProviderResult(response, result = {}) {
  if (result.body) {
    response.writeHead(result.status || 200, {
      "Content-Type": result.contentType || "application/octet-stream",
      "Cache-Control": "no-store",
      ...(result.headers || {})
    });
    response.end(result.body);
    return;
  }
  writeJson(response, result.status || 200, result.json || { ok: false, contains_raw_media: false });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  createMovementRecognitionServer().listen(port, "127.0.0.1", () => {
    process.stdout.write(`movement recognition server listening on http://127.0.0.1:${port}${ANALYZE_ROUTE}\n`);
  });
}
