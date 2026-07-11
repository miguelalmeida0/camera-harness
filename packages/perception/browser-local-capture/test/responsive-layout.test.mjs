import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";

const prototypeRoot = resolve("packages/perception/browser-local-capture/prototype");
const viewports = [
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 }
];

const chromePath = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].find((candidate) => candidate && existsSync(candidate));

assert.ok(chromePath, "Responsive browser test requires Chrome or Chromium; set CHROME_BIN when it is installed elsewhere.");

const staticServer = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = resolve(prototypeRoot, relativePath);
    if (filePath !== prototypeRoot && !filePath.startsWith(`${prototypeRoot}${sep}`)) throw new Error("Invalid path");
    const body = await readFile(filePath);
    const contentType = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/svg+xml",
      ".js": "text/javascript; charset=utf-8"
    }[extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

const userDataDir = await mkdtemp(resolve(tmpdir(), "darkquest-responsive-"));
let chrome;
let cdp;

try {
  await new Promise((resolveListen) => staticServer.listen(0, "127.0.0.1", resolveListen));
  const appPort = staticServer.address().port;
  const cdpPort = await freePort();
  const appUrl = `http://127.0.0.1:${appPort}/`;
  const faviconResponse = await fetch(`${appUrl}favicon.ico`);
  assert.equal(faviconResponse.status, 200, "GET /favicon.ico must not return 404");
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: "ignore" });

  await waitForChrome(cdpPort);
  const targetResponse = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" });
  assert.equal(targetResponse.ok, true, "Chrome DevTools target could not be created");
  const target = await targetResponse.json();
  cdp = await createCdpClient(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width <= 760
    });
    await cdp.send("Page.navigate", { url: `${appUrl}?viewport=${viewport.width}x${viewport.height}` });
    await waitForReady(cdp);
    await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await cdp.evaluate(`(() => {
      const dialog = document.querySelector("#automationRecipeEditor");
      if (!dialog.open) dialog.showModal();
      document.querySelector("#automationRecipeName").value = "Responsive draft";
      return true;
    })()`);

    const layout = await cdp.evaluate(layoutProbeSource());
    assert.ok(layout.scrollWidth <= viewport.width + 1, `${viewport.width}px: page overflows horizontally (${layout.scrollWidth}px)`);
    assert.equal(layout.cameraInside, true, `${viewport.width}px: camera card leaves the viewport`);
    assert.equal(layout.resultInside, true, `${viewport.width}px: result card leaves the viewport`);
    assert.equal(layout.modalInside, true, `${viewport.width}px: recipe modal leaves the viewport`);
    assert.deepEqual(layout.outsideFields, [], `${viewport.width}px: recipe fields leave the modal`);
    assert.deepEqual(layout.unreadableButtons, [], `${viewport.width}px: button labels overflow their controls`);
    if (viewport.width <= 760) {
      assert.equal(layout.mobileOneColumn, true, `${viewport.width}px: main content is not one column`);
      assert.equal(layout.cameraBeforeResult, true, `${viewport.width}px: camera must precede Movement Result`);
      assert.deepEqual(layout.smallTouchTargets, [], `${viewport.width}px: modal controls are below the 44px touch target`);
    } else if (viewport.width >= 1280) {
      assert.equal(layout.desktopGrid, true, `${viewport.width}px: desktop two-column structure changed`);
    }
    process.stdout.write(`responsive ${viewport.width}x${viewport.height} ok\n`);
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.navigate", { url: `${appUrl}?resize-state` });
  await waitForReady(cdp);
  await cdp.evaluate(`(() => {
    const dialog = document.querySelector("#automationRecipeEditor");
    if (!dialog.open) dialog.showModal();
    document.querySelector("#automationRecipeName").value = "Draft survives resize";
    document.querySelector("#instantGestures").checked = true;
    document.querySelector("#cameraSuggestions").textContent = "Result survives resize";
    return true;
  })()`);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const preserved = await cdp.evaluate(`(() => ({
    modalOpen: document.querySelector("#automationRecipeEditor").open,
    draft: document.querySelector("#automationRecipeName").value,
    instantGestures: document.querySelector("#instantGestures").checked,
    result: document.querySelector("#cameraSuggestions").textContent
  }))()`);
  assert.deepEqual(preserved, {
    modalOpen: true,
    draft: "Draft survives resize",
    instantGestures: true,
    result: "Result survives resize"
  }, "viewport resize reset live UI state");
  process.stdout.write("responsive resize state ok\n");
} finally {
  cdp?.close();
  chrome?.kill("SIGTERM");
  if (chrome) {
    await Promise.race([
      new Promise((resolveExit) => chrome.exitCode == null ? chrome.once("exit", resolveExit) : resolveExit()),
      new Promise((resolveExit) => setTimeout(resolveExit, 1500))
    ]);
  }
  await new Promise((resolveClose) => staticServer.close(resolveClose));
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
}

function layoutProbeSource() {
  return `(() => {
    const insideViewport = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= innerWidth + 1;
    };
    const camera = document.querySelector(".dq-camera-card");
    const result = document.querySelector("#cameraSuggestionsPanel");
    const dashboard = document.querySelector(".dq-dashboard-grid");
    const dialog = document.querySelector("#automationRecipeEditor");
    const dialogRect = dialog.getBoundingClientRect();
    const isVisible = (element) => element.getClientRects().length > 0
      && !element.hidden
      && !element.closest("[hidden], details:not([open])")
      && getComputedStyle(element).visibility !== "hidden";
    const visibleControls = [...dialog.querySelectorAll("input, select, button")].filter(isVisible);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      cameraInside: insideViewport(camera),
      resultInside: insideViewport(result),
      modalInside: dialogRect.left >= -1 && dialogRect.right <= innerWidth + 1 && dialogRect.top >= -1 && dialogRect.bottom <= innerHeight + 1,
      outsideFields: visibleControls.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < dialogRect.left - 1 || rect.right > dialogRect.right + 1;
      }).map((element) => element.id || element.textContent.trim()).filter(Boolean),
      unreadableButtons: [...document.querySelectorAll("button")].filter((button) => isVisible(button) && button.scrollWidth > button.clientWidth + 1).map((button) => button.id || button.textContent.trim()),
      smallTouchTargets: visibleControls.filter((element) => element.getBoundingClientRect().height < 43.5).map((element) => element.id || element.textContent.trim()).filter(Boolean),
      mobileOneColumn: (
        getComputedStyle(dashboard).display === "flex" && getComputedStyle(dashboard).flexDirection === "column"
      ) || (
        getComputedStyle(dashboard).display === "grid"
          && getComputedStyle(dashboard).gridTemplateColumns.split(" ").filter(Boolean).length === 1
      ),
      cameraBeforeResult: camera.getBoundingClientRect().top < result.getBoundingClientRect().top,
      desktopGrid: getComputedStyle(dashboard).display === "grid" && getComputedStyle(dashboard).gridTemplateColumns.split(" ").filter(Boolean).length >= 2
    };
  })()`;
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForChrome(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

async function createCdpClient(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolveMessage, rejectMessage } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectMessage(new Error(message.error.message));
    else resolveMessage(message.result || {});
  });
  const send = (method, params = {}) => new Promise((resolveMessage, rejectMessage) => {
    const id = ++sequence;
    pending.set(id, { resolveMessage, rejectMessage });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    async evaluate(expression) {
      const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Browser evaluation failed");
      return response.result?.value;
    },
    close: () => socket.close()
  };
}

async function waitForReady(client) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await client.evaluate("document.readyState") === "complete") return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Responsive test page did not finish loading");
}
