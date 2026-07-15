import { test as base, expect } from "@playwright/test";

const SENSITIVE_KEY = /^(authorization|cookie|credentials?|secret|tokens?|raw_media|raw_frames?|camera_frames?|frames?|landmarks?|image_data|audio_data|video_data|media_payload|model_path)$/i;
const MAX_TEXT_LENGTH = 800;

export const test = base.extend({
  safeFailureArtifacts: [async ({ page }, use, testInfo) => {
    const consoleTimeline = [];
    const networkTimeline = [];
    const recordConsole = (message) => {
      consoleTimeline.push({ type: message.type(), text: sanitizeText(message.text()) });
    };
    const recordPageError = (error) => {
      consoleTimeline.push({ type: "pageerror", text: sanitizeText(error?.message || String(error)) });
    };
    const recordRequest = (request) => {
      const url = new URL(request.url());
      networkTimeline.push({ method: request.method(), origin: url.origin, path: url.pathname });
    };
    page.on("console", recordConsole);
    page.on("pageerror", recordPageError);
    page.on("request", recordRequest);

    await use();

    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed) await attachFailureArtifacts(page, testInfo, { consoleTimeline, networkTimeline });
    page.off("console", recordConsole);
    page.off("pageerror", recordPageError);
    page.off("request", recordRequest);
  }, { auto: true }]
});

export { expect };

async function attachFailureArtifacts(page, testInfo, browserTimeline) {
  const diagnostics = await page.evaluate(() => {
    const proof = window.__NEURAL_FIELD_TEST__;
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script,video,audio,source").forEach((node) => node.remove());
    clone.querySelectorAll("input,textarea").forEach((node) => node.setAttribute("value", "[redacted]"));
    return {
      dom: `<!doctype html>${clone.outerHTML}`,
      eventTimeline: proof?.getEventTimeline?.() || [],
      renderTimeline: proof?.getRenderTimeline?.() || [],
      resources: proof?.getResourceSnapshot?.() || {},
      fixtureIds: proof?.getFixtureIds?.() || [],
      metrics: proof?.getMetrics?.() || {},
      state: proof?.snapshot?.() || null
    };
  }).catch((error) => ({ collectionError: error.message }));

  await attachText(testInfo, "dom-snapshot", diagnostics.dom || "DOM unavailable", "text/html");
  await attachJson(testInfo, "safe-console-log", browserTimeline.consoleTimeline);
  await attachJson(testInfo, "safe-network-timeline", browserTimeline.networkTimeline);
  await attachJson(testInfo, "safe-event-timeline", diagnostics.eventTimeline || []);
  await attachJson(testInfo, "render-timeline", diagnostics.renderTimeline || []);
  await attachJson(testInfo, "resource-count-snapshot", diagnostics.resources || {});
  await attachJson(testInfo, "fixture-ids", diagnostics.fixtureIds || []);
  await attachJson(testInfo, "performance-metrics", diagnostics.metrics || {});
  await attachJson(testInfo, "runtime-state", diagnostics.state || diagnostics.collectionError || null);
}

async function attachJson(testInfo, name, value) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(sanitizeValue(value), null, 2)),
    contentType: "application/json"
  });
}

async function attachText(testInfo, name, body, contentType) {
  await testInfo.attach(name, { body: Buffer.from(sanitizeText(body, 250_000)), contentType });
}

function sanitizeValue(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => sanitizeValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey)
    ]));
  }
  return sanitizeText(String(value));
}

function sanitizeText(value, limit = MAX_TEXT_LENGTH) {
  return String(value)
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/data:(image|audio|video)\/[^;,]+;base64,[A-Za-z0-9+/=]+/gi, "[media redacted]")
    .slice(0, limit);
}
