import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEFAULT_HF_USAGE_LIMITS = {
  cloudEnabled: true,
  maxRequestsPerSession: 20,
  maxRequestsPerDay: 50,
  maxRequestsPerMonth: 100,
  maxConcurrentRequests: 1,
  maxProviderRetries: 1,
  requestCooldownMs: 5000,
  maxFramesPerRequest: 6,
  maxWindowMs: 4000,
  maxFrameWidth: 768,
  maxFrameHeight: 768,
  maxRequestBodyBytes: 5000000,
  usageStatePath: ".darkquest/hf-usage.json"
};

export const HF_USAGE_LIMIT_MESSAGES = {
  hf_cloud_disabled: "Cloud AI is disabled. Local features remain available.",
  hf_session_limit_reached: "Session cloud AI limit reached. Local features remain available.",
  hf_daily_limit_reached: "Daily cloud AI limit reached. Local features remain available.",
  hf_monthly_limit_reached: "Monthly cloud AI limit reached. Local features remain available.",
  hf_request_cooldown: "Cloud AI request cooldown is active. Try again in a moment.",
  hf_concurrency_limit: "One cloud AI request is already in flight. Try again in a moment.",
  hf_frame_limit_exceeded: "Cloud AI frame limit exceeded. Try again with fewer frames.",
  hf_window_limit_exceeded: "Cloud AI observation window limit exceeded. Try again with a shorter window.",
  hf_frame_dimensions_exceeded: "Cloud AI frame size limit exceeded. Try again with smaller frames.",
  hf_request_too_large: "Cloud AI request is too large. Try again with a smaller request.",
  hf_retry_limit_reached: "Cloud AI retry limit reached. Local features remain available."
};

export function createUsageLimiter(config = {}) {
  const normalizedConfig = normalizeUsageLimiterConfig(config);
  let activeRequests = 0;

  function checkRequestAllowed(input = {}) {
    const now = numericNow(input.now);
    const sessionId = safeSessionId(input.sessionId);
    const state = readUsageState(normalizedConfig);
    const summary = usageSummaryFromState(state, normalizedConfig, { sessionId, now, activeRequests });
    const bodyBytes = Number(input.bodyBytes ?? input.requestBodyBytes ?? 0);
    const frames = Array.isArray(input.frames) ? input.frames : [];
    const frameWindowMs = requestWindowMs(input, frames);
    const retryCount = Number(input.retryCount ?? 0);

    if (!normalizedConfig.cloudEnabled) return blocked("hf_cloud_disabled", 503, summary);
    if (retryCount > normalizedConfig.maxProviderRetries) return blocked("hf_retry_limit_reached", 429, summary);
    if (frames.length > normalizedConfig.maxFramesPerRequest) return blocked("hf_frame_limit_exceeded", 429, summary);
    if (frameWindowMs > normalizedConfig.maxWindowMs) return blocked("hf_window_limit_exceeded", 429, summary);
    if (frames.some((frame) => frameExceedsDimensions(frame, normalizedConfig))) return blocked("hf_frame_dimensions_exceeded", 429, summary);
    if (bodyBytes > normalizedConfig.maxRequestBodyBytes) return blocked("hf_request_too_large", 429, summary);
    if (summary.session.used >= summary.session.limit) return blocked("hf_session_limit_reached", 429, summary);
    if (summary.day.used >= summary.day.limit) return blocked("hf_daily_limit_reached", 429, summary);
    if (summary.month.used >= summary.month.limit) return blocked("hf_monthly_limit_reached", 429, summary);
    if (sessionCooldownRemainingMs(state, sessionId, now, normalizedConfig) > 0) return blocked("hf_request_cooldown", 429, summary);
    if (activeRequests >= normalizedConfig.maxConcurrentRequests) return blocked("hf_concurrency_limit", 429, summary);

    return { ok: true, status: 200, usage: flatUsage(summary), summary };
  }

  function beginRequest(input = {}) {
    const allowed = checkRequestAllowed(input);
    if (!allowed.ok) return allowed;
    activeRequests += 1;
    const summary = getUsageSummary(input);
    return { ok: true, status: 200, usage: flatUsage(summary), summary };
  }

  function recordLogicalRequest(input = {}) {
    const now = numericNow(input.now);
    const sessionId = safeSessionId(input.sessionId);
    const state = readUsageState(normalizedConfig);
    const dayKey = utcDayKey(now);
    const monthKey = utcMonthKey(now);
    state.sessions[sessionId] ??= { count: 0, last_request_at_ms: 0 };
    state.sessions[sessionId].count += 1;
    state.sessions[sessionId].last_request_at_ms = now;
    state.days[dayKey] ??= { count: 0 };
    state.days[dayKey].count += 1;
    state.months[monthKey] ??= { count: 0 };
    state.months[monthKey].count += 1;
    writeUsageState(normalizedConfig, state);
    const summary = usageSummaryFromState(state, normalizedConfig, { sessionId, now, activeRequests });
    return { ok: true, usage: flatUsage(summary), summary };
  }

  function recordFailure(input = {}) {
    const now = numericNow(input.now);
    const state = readUsageState(normalizedConfig);
    const dayKey = utcDayKey(now);
    const code = safeCounterKey(input.errorCode || "provider_error");
    state.failures[dayKey] ??= {};
    state.failures[dayKey][code] = Math.max(0, Number(state.failures[dayKey][code] || 0)) + 1;
    writeUsageState(normalizedConfig, state);
    return { ok: true };
  }

  function finishRequest() {
    activeRequests = Math.max(0, activeRequests - 1);
    return { ok: true, active: activeRequests };
  }

  function getUsageSummary(input = {}) {
    const now = numericNow(input.now);
    const sessionId = safeSessionId(input.sessionId);
    const state = readUsageState(normalizedConfig);
    return usageSummaryFromState(state, normalizedConfig, { sessionId, now, activeRequests });
  }

  function resetUsageForTests() {
    activeRequests = 0;
    const state = emptyUsageState();
    writeUsageState(normalizedConfig, state);
    return { ok: true };
  }

  return {
    config: normalizedConfig,
    checkRequestAllowed,
    beginRequest,
    recordLogicalRequest,
    recordFailure,
    finishRequest,
    getUsageSummary,
    resetUsageForTests
  };
}

export function normalizeUsageLimiterConfig(config = {}) {
  const root = config.projectRoot || process.cwd();
  const usageStatePath = String(config.usageStatePath || DEFAULT_HF_USAGE_LIMITS.usageStatePath);
  return {
    cloudEnabled: config.cloudEnabled !== false,
    maxRequestsPerSession: positiveInt(config.maxRequestsPerSession, DEFAULT_HF_USAGE_LIMITS.maxRequestsPerSession),
    maxRequestsPerDay: positiveInt(config.maxRequestsPerDay, DEFAULT_HF_USAGE_LIMITS.maxRequestsPerDay),
    maxRequestsPerMonth: positiveInt(config.maxRequestsPerMonth, DEFAULT_HF_USAGE_LIMITS.maxRequestsPerMonth),
    maxConcurrentRequests: positiveInt(config.maxConcurrentRequests, DEFAULT_HF_USAGE_LIMITS.maxConcurrentRequests),
    maxProviderRetries: nonNegativeInt(config.maxProviderRetries, DEFAULT_HF_USAGE_LIMITS.maxProviderRetries),
    requestCooldownMs: nonNegativeInt(config.requestCooldownMs, DEFAULT_HF_USAGE_LIMITS.requestCooldownMs),
    maxFramesPerRequest: positiveInt(config.maxFramesPerRequest, DEFAULT_HF_USAGE_LIMITS.maxFramesPerRequest),
    maxWindowMs: positiveInt(config.maxWindowMs, DEFAULT_HF_USAGE_LIMITS.maxWindowMs),
    maxFrameWidth: positiveInt(config.maxFrameWidth, DEFAULT_HF_USAGE_LIMITS.maxFrameWidth),
    maxFrameHeight: positiveInt(config.maxFrameHeight, DEFAULT_HF_USAGE_LIMITS.maxFrameHeight),
    maxRequestBodyBytes: positiveInt(config.maxRequestBodyBytes, DEFAULT_HF_USAGE_LIMITS.maxRequestBodyBytes),
    usageStatePath: resolve(root, usageStatePath)
  };
}

function blocked(code, status, summary) {
  return {
    ok: false,
    status,
    code,
    message: HF_USAGE_LIMIT_MESSAGES[code] || "Cloud AI limit reached. Local features remain available.",
    usage: flatUsage(summary),
    summary
  };
}

function flatUsage(summary) {
  return {
    session_used: summary.session.used,
    session_limit: summary.session.limit,
    daily_used: summary.day.used,
    daily_limit: summary.day.limit,
    monthly_used: summary.month.used,
    monthly_limit: summary.month.limit
  };
}

function usageSummaryFromState(state, config, { sessionId, now, activeRequests }) {
  const session = state.sessions[sessionId] ?? { count: 0, last_request_at_ms: 0 };
  const day = state.days[utcDayKey(now)] ?? { count: 0 };
  const month = state.months[utcMonthKey(now)] ?? { count: 0 };
  return {
    cloud_enabled: config.cloudEnabled,
    session: usageBucket(session.count, config.maxRequestsPerSession),
    day: usageBucket(day.count, config.maxRequestsPerDay),
    month: usageBucket(month.count, config.maxRequestsPerMonth),
    concurrent: {
      active: Math.max(0, activeRequests),
      limit: config.maxConcurrentRequests
    }
  };
}

function usageBucket(used, limit) {
  const safeUsed = Math.max(0, Number(used || 0));
  const safeLimit = Math.max(0, Number(limit || 0));
  return {
    used: safeUsed,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - safeUsed)
  };
}

function sessionCooldownRemainingMs(state, sessionId, now, config) {
  const previous = Number(state.sessions[sessionId]?.last_request_at_ms || 0);
  if (!previous || config.requestCooldownMs <= 0) return 0;
  return Math.max(0, config.requestCooldownMs - (now - previous));
}

function requestWindowMs(input, frames) {
  const explicitWindow = Number(input.windowMs ?? input.observationWindowMs ?? 0);
  if (Number.isFinite(explicitWindow) && explicitWindow > 0) return explicitWindow;
  const timestamps = frames.map((frame) => Number(frame?.captured_at_ms ?? frame?.timestamp_ms)).filter(Number.isFinite);
  if (timestamps.length < 2) return 0;
  return Math.max(...timestamps) - Math.min(...timestamps);
}

function frameExceedsDimensions(frame, config) {
  const width = Number(frame?.width ?? frame?.frame_width ?? 0);
  const height = Number(frame?.height ?? frame?.frame_height ?? 0);
  return (Number.isFinite(width) && width > config.maxFrameWidth) || (Number.isFinite(height) && height > config.maxFrameHeight);
}

function readUsageState(config) {
  if (!existsSync(config.usageStatePath)) return emptyUsageState();
  try {
    return sanitizeUsageState(JSON.parse(readFileSync(config.usageStatePath, "utf8")));
  } catch {
    return emptyUsageState();
  }
}

function writeUsageState(config, state) {
  mkdirSync(dirname(config.usageStatePath), { recursive: true, mode: 0o700 });
  const safeState = sanitizeUsageState(state);
  const tempPath = `${config.usageStatePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(safeState, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, config.usageStatePath);
}

function emptyUsageState() {
  return {
    schema_version: "darkquest.hf-usage.v1",
    sessions: {},
    days: {},
    months: {},
    failures: {}
  };
}

function sanitizeUsageState(raw = {}) {
  const state = emptyUsageState();
  for (const [sessionId, session] of Object.entries(raw.sessions || {})) {
    const safeId = safeSessionId(sessionId);
    state.sessions[safeId] = {
      count: Math.max(0, Math.floor(Number(session?.count || 0))),
      last_request_at_ms: Math.max(0, Math.floor(Number(session?.last_request_at_ms || 0)))
    };
  }
  for (const [day, value] of Object.entries(raw.days || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) state.days[day] = { count: Math.max(0, Math.floor(Number(value?.count || 0))) };
  }
  for (const [month, value] of Object.entries(raw.months || {})) {
    if (/^\d{4}-\d{2}$/.test(month)) state.months[month] = { count: Math.max(0, Math.floor(Number(value?.count || 0))) };
  }
  for (const [day, failures] of Object.entries(raw.failures || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    state.failures[day] = {};
    for (const [code, count] of Object.entries(failures || {})) {
      state.failures[day][safeCounterKey(code)] = Math.max(0, Math.floor(Number(count || 0)));
    }
  }
  return state;
}

function utcDayKey(now) {
  return new Date(numericNow(now)).toISOString().slice(0, 10);
}

function utcMonthKey(now) {
  return new Date(numericNow(now)).toISOString().slice(0, 7);
}

function safeSessionId(value) {
  const text = String(value || "").trim();
  return /^darkquest_session_[a-z0-9_-]{8,80}$/i.test(text) ? text : "darkquest_session_anonymous";
}

function safeCounterKey(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 80) || "unknown";
}

function numericNow(value) {
  const number = Number(value ?? Date.now());
  return Number.isFinite(number) ? number : Date.now();
}

function positiveInt(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
