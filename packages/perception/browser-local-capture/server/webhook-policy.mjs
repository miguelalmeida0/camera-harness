import { lookup as nodeLookup } from "node:dns/promises";
import { isIP } from "node:net";

export function loadWebhookPolicy(env = process.env) {
  return {
    allowlist: String(env.DARKQUEST_AUTOMATION_WEBHOOK_ALLOWLIST || "")
      .split(",")
      .map((value) => value.trim())
      .map((value) => value.includes("=") ? value.slice(value.indexOf("=") + 1).trim() : value)
      .filter(Boolean),
    allowLocal: String(env.ALLOW_LOCAL_AUTOMATION_WEBHOOKS || "false").toLowerCase() === "true",
    timeoutMs: 5000,
    maxRetries: 1
  };
}

export async function validateWebhookDestination(destination, policy = loadWebhookPolicy(), options = {}) {
  let url;
  try {
    url = new URL(String(destination || ""));
  } catch {
    throw policyError("Webhook destination is not approved", "invalid_destination");
  }
  if (url.username || url.password) throw policyError("Webhook destination is not approved", "destination_credentials_forbidden");
  if (url.protocol !== "https:" && !(policy.allowLocal && url.protocol === "http:" && isLocalHostname(url.hostname))) {
    throw policyError("Webhook destination is not approved", "https_required");
  }
  if (!destinationAllowed(url, policy.allowlist)) throw policyError("Webhook destination is not approved", "destination_not_allowlisted");
  if (!policy.allowLocal && isLocalHostname(url.hostname)) throw policyError("Webhook destination is not approved", "private_destination_blocked");

  const lookup = options.lookup || nodeLookup;
  const records = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || records.length === 0) throw policyError("Webhook destination is not approved", "destination_unresolved");
  if (!policy.allowLocal && records.some((record) => isPrivateAddress(record.address))) {
    throw policyError("Webhook destination is not approved", "private_destination_blocked");
  }
  return url;
}

export function validateAutomationWebhookDestination(destination, policy, options) {
  return validateWebhookDestination(destination, policy, options);
}

export function resolveWebhookSecret(secretRef, env = process.env) {
  const normalized = String(secretRef || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 80);
  if (!normalized) return "";
  const key = normalized.startsWith("DARKQUEST_WEBHOOK_SECRET_") ? normalized : `DARKQUEST_WEBHOOK_SECRET_${normalized}`;
  return String(env[key] || "");
}

export function resolveWebhookDestinationId(destinationId, env = process.env) {
  const requested = String(destinationId || "").trim();
  const entries = String(env.DARKQUEST_AUTOMATION_WEBHOOK_ALLOWLIST || "").split(",").map((value) => value.trim()).filter(Boolean);
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator > 0 && entry.slice(0, separator).trim() === requested) return entry.slice(separator + 1).trim();
    try {
      const url = new URL(entry);
      if (requested === url.host || requested === url.hostname || requested === entry) return entry;
    } catch {
      // Invalid policy entries are ignored and cannot authorize a destination.
    }
  }
  return "";
}

export function safeWebhookDestinationHost(destination) {
  try {
    return new URL(String(destination || "")).host;
  } catch {
    return "unapproved destination";
  }
}

export function isPrivateAddress(address) {
  const value = String(address || "").toLowerCase();
  if (!value) return true;
  if (value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped || (isIP(value) === 4 ? value : "");
  if (!ipv4) return false;
  const parts = ipv4.split(".").map(Number);
  return parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] >= 224 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function destinationAllowed(url, allowlist) {
  return allowlist.some((entry) => {
    try {
      const allowed = new URL(entry);
      if (allowed.protocol !== url.protocol || allowed.hostname !== url.hostname || effectivePort(allowed) !== effectivePort(url)) return false;
      const prefix = allowed.pathname.replace(/\/$/, "");
      return !prefix || prefix === "" || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
    } catch {
      return false;
    }
  });
}

function effectivePort(url) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

function isLocalHostname(hostname) {
  const value = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local") || isPrivateAddress(value);
}

function policyError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
