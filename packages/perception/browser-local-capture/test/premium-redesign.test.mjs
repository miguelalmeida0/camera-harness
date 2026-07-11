import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";

const prototypeRoot = resolve("packages/perception/browser-local-capture/prototype");
const captureRoot = resolve("runs/premium-redesign");
const viewports = [
  { width: 1728, height: 1117 },
  { width: 1586, height: 992 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 412, height: 915 },
  { width: 390, height: 844 }
];

const chromePath = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].find((candidate) => candidate && existsSync(candidate));

assert.ok(chromePath, "Premium redesign test requires Chrome or Chromium.");

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = resolve(prototypeRoot, relativePath);
    if (filePath !== prototypeRoot && !filePath.startsWith(`${prototypeRoot}${sep}`)) throw new Error("Invalid path");
    const body = await readFile(filePath);
    const contentType = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".js": "text/javascript; charset=utf-8"
    }[extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

const userDataDir = await mkdtemp(resolve(tmpdir(), "sensefield-premium-"));
let chrome;
let cdp;

try {
  await mkdir(captureRoot, { recursive: true });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const appPort = server.address().port;
  const cdpPort = await freePort();
  const appUrl = `http://127.0.0.1:${appPort}/`;
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: "ignore" });

  await waitForChrome(cdpPort);
  const targetResponse = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" });
  assert.equal(targetResponse.ok, true, "Chrome target could not be created");
  const target = await targetResponse.json();
  cdp = await createCdpClient(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width <= 600
    });
    await cdp.send("Page.navigate", { url: `${appUrl}?premium=${viewport.width}x${viewport.height}` });
    await waitForReady(cdp);
    await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const layout = await cdp.evaluate(layoutProbe());

    assert.ok(layout.scrollWidth <= viewport.width + 1, `${viewport.width}px: horizontal overflow (${layout.scrollWidth}px)`);
    assert.equal(layout.visibleHeader, false, `${viewport.width}px: global header is visible`);
    assert.equal(layout.visibleNavigation, false, `${viewport.width}px: navigation is visible`);
    assert.equal(layout.modeVisible, true, `${viewport.width}px: mode selector is not visible`);
    assert.equal(layout.singlePrimaryCta, 1, `${viewport.width}px: expected one primary CTA`);
    assert.equal(layout.roadmapTiles, 5, `${viewport.width}px: expected five roadmap tiles`);
    assert.equal(layout.interactiveRoadmapTiles, 0, `${viewport.width}px: roadmap tiles must remain non-interactive`);
    assert.ok(layout.savedActionRows <= 3, `${viewport.width}px: more than three saved actions are visible`);
    assert.ok(layout.recentMomentRows <= 3, `${viewport.width}px: more than three recent moments are visible`);
    assert.deepEqual(layout.outsideCards, [], `${viewport.width}px: cards leave the viewport`);
    assert.deepEqual(layout.clippedText, [], `${viewport.width}px: text is clipped`);

    const captureName = new Map([
      [1728, "desktop-1728.png"],
      [1586, "desktop-reference-size.png"],
      [1440, "desktop-1440.png"],
      [1024, "tablet-1024.png"],
      [390, "mobile-390.png"]
    ]).get(viewport.width);
    if (captureName) {
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      await writeFile(resolve(captureRoot, captureName), Buffer.from(screenshot.data, "base64"));
    }

    if (viewport.width > 1120) {
      assert.equal(layout.desktopTwoColumn, true, `${viewport.width}px: desktop grid is not two columns`);
      assert.equal(layout.cameraDominant, true, `${viewport.width}px: camera column is not dominant`);
    } else if (viewport.width <= 600) {
      assert.equal(layout.mobileOrder, true, `${viewport.width}px: mobile order does not match the approved design`);
    } else {
      assert.equal(layout.tabletOrder, true, `${viewport.width}px: tablet order does not keep the camera first`);
    }
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.navigate", { url: `${appUrl}?premium=interaction` });
  await waitForReady(cdp);
  await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const observing = await cdp.evaluate(`(() => {
    document.querySelector('[data-interaction-mode="observing"]').click();
    return new Promise((resolve) => setTimeout(() => resolve({
      selected: document.querySelector('[data-interaction-mode="observing"]').getAttribute('aria-pressed'),
      cta: document.querySelector('#analyzeMovement').textContent.trim()
    }), 80));
  })()`);
  assert.deepEqual(observing, { selected: "true", cta: "Start observing" }, "mode selector is not connected to runtime state");

  const conversation = await cdp.evaluate(`(() => {
    document.querySelector('[data-interaction-mode="conversation"]').click();
    return new Promise((resolve) => setTimeout(() => resolve({
      selected: document.querySelector('[data-interaction-mode="conversation"]').getAttribute('aria-pressed'),
      cta: document.querySelector('#analyzeMovement').textContent.trim()
    }), 80));
  })()`);
  assert.deepEqual(conversation, { selected: "true", cta: "Start conversation" }, "conversation mode does not restore its CTA");

  const longAnswer = await cdp.evaluate(`(() => {
    const host = document.querySelector('#cameraSuggestions');
    host.innerHTML = '<div class="dq-movement-result result-card-stable result-hero text-contained"><strong class="dq-movement-sentence movement-sentence">This deliberately long contextual response verifies that Sensefield can explain a detailed visual scene without clipping, truncating, escaping its card, or displacing the persistent mode selector above it.</strong></div>';
    const sentence = host.querySelector('.dq-movement-sentence');
    const card = document.querySelector('#operatorCommandsCard');
    const style = getComputedStyle(sentence);
    return {
      contained: sentence.getBoundingClientRect().right <= card.getBoundingClientRect().right + 1,
      scrollContained: host.scrollWidth <= host.clientWidth + 1,
      whiteSpace: style.whiteSpace,
      lineClamp: style.webkitLineClamp
    };
  })()`);
  assert.equal(longAnswer.contained, true, "long response leaves its card");
  assert.equal(longAnswer.scrollContained, true, "long response creates horizontal scroll");
  assert.equal(longAnswer.whiteSpace, "normal", "long response does not wrap naturally");
  assert.ok(["none", ""].includes(longAnswer.lineClamp), "long response is line-clamped");

  process.stdout.write("premium redesign browser proof passed\n");
} finally {
  cdp?.close();
  chrome?.kill("SIGTERM");
  if (chrome) {
    await Promise.race([
      new Promise((resolveExit) => chrome.exitCode == null ? chrome.once("exit", resolveExit) : resolveExit()),
      new Promise((resolveExit) => setTimeout(resolveExit, 1500))
    ]);
  }
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
}

function layoutProbe() {
  return `(() => {
    const visible = (element) => Boolean(element
      && element.getClientRects().length
      && !element.classList.contains('sr-only')
      && getComputedStyle(element).visibility !== 'hidden');
    const inside = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= innerWidth + 1;
    };
    const workspace = document.querySelector('#mainWorkspace');
    const camera = document.querySelector('.sf-camera-stage');
    const rail = document.querySelector('.sf-insight-rail');
    const mode = document.querySelector('#interactionModeSelector');
    const response = document.querySelector('#operatorCommandsCard');
    const saved = document.querySelector('#savedActionsCard');
    const recent = document.querySelector('#recentMomentsCard');
    const roadmap = document.querySelector('#whatsNextPanel');
    const cards = [camera, mode, response, saved, recent, roadmap];
    const clippedText = [...document.querySelectorAll('[data-primary-view] button, [data-primary-view] strong, [data-primary-view] small, [data-primary-view] p, [data-primary-view] a')]
      .filter(visible)
      .filter((element) => element.scrollWidth > element.clientWidth + 1 && !['auto', 'scroll'].includes(getComputedStyle(element).overflowX))
      .map((element) => element.id || element.textContent.trim().slice(0, 60));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      visibleHeader: [...document.querySelectorAll('header')].some(visible),
      visibleNavigation: [...document.querySelectorAll('nav')].some(visible),
      modeVisible: visible(mode),
      singlePrimaryCta: [...document.querySelectorAll('.sf-primary-action')].filter(visible).length,
      roadmapTiles: roadmap.querySelectorAll('.sf-roadmap-tile').length,
      interactiveRoadmapTiles: roadmap.querySelectorAll('.sf-roadmap-tile button, .sf-roadmap-tile a, .sf-roadmap-tile [role="button"]').length,
      savedActionRows: saved.querySelectorAll('.sf-action-row').length,
      recentMomentRows: recent.querySelectorAll('.sf-moment-row').length,
      outsideCards: cards.filter((element) => !inside(element)).map((element) => element.id || element.className),
      clippedText,
      desktopTwoColumn: getComputedStyle(workspace).display === 'grid' && getComputedStyle(workspace).gridTemplateColumns.split(' ').filter(Boolean).length === 2,
      cameraDominant: camera.getBoundingClientRect().width > rail.getBoundingClientRect().width * 1.6,
      mobileOrder: mode.getBoundingClientRect().top < camera.getBoundingClientRect().top
        && camera.getBoundingClientRect().top < response.getBoundingClientRect().top
        && response.getBoundingClientRect().top < saved.getBoundingClientRect().top
        && saved.getBoundingClientRect().top < recent.getBoundingClientRect().top
        && recent.getBoundingClientRect().top < roadmap.getBoundingClientRect().top,
      tabletOrder: camera.getBoundingClientRect().top < mode.getBoundingClientRect().top
        && mode.getBoundingClientRect().top < response.getBoundingClientRect().top
        && response.getBoundingClientRect().top < saved.getBoundingClientRect().top
        && saved.getBoundingClientRect().top < recent.getBoundingClientRect().top
        && recent.getBoundingClientRect().top < roadmap.getBoundingClientRect().top
    };
  })()`;
}

async function waitForReady(client) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = await client.evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#analyzeMovement'))");
    if (ready) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Sensefield premium view did not load");
}

async function waitForChrome(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

async function freePort() {
  const probe = createNetServer();
  await new Promise((resolveListen) => probe.listen(0, "127.0.0.1", resolveListen));
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  return {
    async send(method, params = {}) {
      await opened;
      const id = ++sequence;
      const result = new Promise((resolveResult, rejectResult) => pending.set(id, { resolve: resolveResult, reject: rejectResult }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    async evaluate(expression) {
      const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
      return result.result.value;
    },
    close() {
      socket.close();
    }
  };
}
