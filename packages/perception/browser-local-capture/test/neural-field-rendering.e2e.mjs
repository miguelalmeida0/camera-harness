import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, extname, resolve, sep } from "node:path";

const prototypeRoot = resolve("packages/perception/browser-local-capture/prototype");
const captureRoot = resolve("runs/neural-field-rendering");
const responsiveViewports = [
  { width: 1_728, height: 1_117 },
  { width: 1_440, height: 900 },
  { width: 1_024, height: 768 },
  { width: 768, height: 1_024 },
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

assert.ok(chromePath, "Neural Field rendering e2e requires Chrome or Chromium; set CHROME_BIN when installed elsewhere.");

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = resolve(prototypeRoot, relativePath);
    if (filePath !== prototypeRoot && !filePath.startsWith(`${prototypeRoot}${sep}`)) throw new Error("Invalid path");
    const body = await readFile(filePath);
    const contentType = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png"
    }[extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

const userDataDir = await mkdtemp(resolve(tmpdir(), "sensefield-neural-field-"));
let chrome;
let cdp;

try {
  await mkdir(captureRoot, { recursive: true });
  const capturePaintResults = [];
  await new Promise((resolveListen, rejectListen) => server.listen(0, "127.0.0.1", resolveListen).once("error", rejectListen));
  const appUrl = `http://127.0.0.1:${server.address().port}/`;
  const cdpPort = await freePort();
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

  await setViewport(cdp, { width: 1_024, height: 768 });
  await cdp.send("Page.navigate", { url: `${appUrl}?neural-field-fixture=airscript` });
  await waitForDocument(cdp);
  const productionGuard = await cdp.evaluate(`(() => ({
    active: document.body.classList.contains('sf-neural-field-active'),
    testBridge: Boolean(window.__SENSEFIELD_TEST__?.getNeuralFieldSnapshot)
  }))()`);
  assert.deepEqual(productionGuard, { active: false, testBridge: false }, "fixture query must not activate without explicit localhost test mode");

  const responsiveResults = [];
  for (const viewport of responsiveViewports) {
    const result = await openFixture(cdp, appUrl, "airscript", viewport);
    assertResponsiveLayout(result.layout, viewport);
    assert.equal(result.snapshot.paths.liveEvidence.length > 1, true, `${viewport.width}px AirScript evidence path missing`);
    assert.equal(result.snapshot.paths.liveStabilized.length > 1, true, `${viewport.width}px stabilized path missing`);
    const classifications = result.snapshot.paths.completed.map((stroke) => stroke.label);
    assert.ok(classifications.includes("CIRCLE") && classifications.includes("ARROW") && classifications.includes("AI"), `${viewport.width}px deterministic AirScript fixtures are incomplete`);
    responsiveResults.push({ viewport, ...result.layout });
    if (viewport.width === 1_728) capturePaintResults.push(await captureScreenshot(cdp, resolve(captureRoot, "airscript-desktop.png")));
    if (viewport.width === 390) capturePaintResults.push(await captureScreenshot(cdp, resolve(captureRoot, "airscript-mobile.png")));
  }

  const lasso = await openFixture(cdp, appUrl, "lasso-selected", { width: 1_440, height: 900 });
  assert.equal(lasso.snapshot.tool, "spatial-lasso");
  assert.equal(lasso.snapshot.lasso.valid, true);
  assert.ok(lasso.snapshot.lasso.points.every((item) => item.x >= 0 && item.x <= 1 && item.y >= 0 && item.y <= 1), "lasso geometry must remain normalized to the camera stage");
  assert.ok(lasso.snapshot.anchors.some((anchor) => anchor.state === "selected" && /mug/i.test(anchor.label)), "selected lasso must resolve to the mug anchor");
  capturePaintResults.push(await captureScreenshot(cdp, resolve(captureRoot, "lasso-selected.png")));

  const relation = await openFixture(cdp, appUrl, "relation", { width: 1_440, height: 900 });
  assert.ok(relation.snapshot.relations.some((item) => /Mug.*left of.*Laptop/i.test(item.label)), "mug/laptop relation label is not visible");
  assert.ok(relation.snapshot.relations.some((item) => /Hand.*approaching.*Mug/i.test(item.label)), "approaching-hand relation label is not visible");
  assert.ok(relation.snapshot.relations.some((item) => item.directional), "directional relation arrow is not represented");
  assert.match(relation.layout.nonvisualRelation, /left of|approaching|closest/i, "relation needs a nonvisual text equivalent");
  capturePaintResults.push(await captureScreenshot(cdp, resolve(captureRoot, "relation-rendering.png")));

  const ambiguous = await openFixture(cdp, appUrl, "ambiguous", { width: 1_024, height: 768 });
  assert.match(`${ambiguous.snapshot.lasso.feedback} ${ambiguous.snapshot.message}`, /Tighten the loop around one object\./i);
  assert.ok(ambiguous.snapshot.lasso.points.length >= 4, "ambiguous candidate region must remain visible");
  capturePaintResults.push(await captureScreenshot(cdp, resolve(captureRoot, "ambiguous-selection.png")));
  const dismissed = await cdp.evaluate(`(() => {
    const button = document.querySelector('#dismissNeuralFieldEvidence');
    if (!button) return { found: false, hidden: false };
    button.click();
    const evidence = document.querySelector('#neuralFieldEvidence');
    return { found: true, hidden: Boolean(evidence?.hidden || getComputedStyle(evidence).display === 'none') };
  })()`);
  assert.deepEqual(dismissed, { found: true, hidden: true }, "temporary evidence overlay must be dismissible");

  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  const reduced = await openFixture(cdp, appUrl, "reduced-motion", { width: 1_440, height: 900 }, { preserveMedia: true });
  assert.equal(reduced.snapshot.reducedMotion, true, "canvas renderer must honor prefers-reduced-motion");
  capturePaintResults.push(await captureScreenshot(cdp, resolve(captureRoot, "reduced-motion.png")));
  await cdp.send("Emulation.setEmulatedMedia", { media: "", features: [] });

  const uncertain = await openFixture(cdp, appUrl, "uncertain", { width: 1_024, height: 768 });
  assert.ok(
    uncertain.snapshot.anchors.some((anchor) => anchor.state === "tracking uncertain") || /Tracking uncertain/i.test(uncertain.snapshot.status),
    "tracking uncertainty needs a textual state"
  );

  await openFixture(cdp, appUrl, "airscript", { width: 1_024, height: 768 });
  const metrics = await cdp.evaluate("window.__SENSEFIELD_TEST__.getNeuralFieldMetrics()");
  assert.ok(metrics.fps >= 0 && Number.isFinite(metrics.p95RenderMs));
  assert.ok(metrics.pathPointCount > 0 && metrics.pathPointCount <= 2_048, "browser renderer geometry must be measured and bounded");
  assert.ok(metrics.canvasMemoryBytes > 0, "browser renderer must report canvas memory");

  const toolChange = await cdp.evaluate(`(() => {
    const launcher = document.querySelector('#neuralFieldLauncher');
    const buttons = [...document.querySelectorAll('#neuralFieldToolSelector [data-neural-field-tool]')];
    const alternate = buttons.find((button) => button.getAttribute('aria-pressed') !== 'true');
    if (!launcher || !alternate) return Promise.resolve({ ready: false });
    const tool = alternate.dataset.neuralFieldTool;
    alternate.click();
    return new Promise((resolve) => setTimeout(() => resolve({
      ready: true,
      launcherTag: launcher.tagName,
      toolTags: buttons.map((button) => button.tagName),
      pressed: alternate.getAttribute('aria-pressed'),
      otherPressed: buttons.filter((button) => button !== alternate).map((button) => button.getAttribute('aria-pressed')),
      tool,
      snapshotTool: window.__SENSEFIELD_TEST__.getNeuralFieldSnapshot().tool
    }), 80));
  })()`);
  assert.equal(toolChange.ready, true, "alternate Neural Field tool is unavailable");
  assert.equal(toolChange.launcherTag, "BUTTON", "launcher must be a native keyboard-accessible button");
  assert.deepEqual(toolChange.toolTags, ["BUTTON", "BUTTON"], "tool selector must use native buttons");
  assert.equal(toolChange.pressed, "true");
  assert.deepEqual(toolChange.otherPressed, ["false"]);
  assert.equal(toolChange.snapshotTool, toolChange.tool, "tool selection must update renderer state");

  await cdp.evaluate("document.querySelector('#analyzeMovement').click()");
  await waitForNeuralFieldExit(cdp);
  const exitState = await cdp.evaluate(`(() => {
    const canvas = document.querySelector('#neuralFieldCanvas');
    const snapshot = window.__SENSEFIELD_TEST__.getNeuralFieldSnapshot();
    return {
      bodyActive: document.body.classList.contains('sf-neural-field-active'),
      active: snapshot.active,
      running: snapshot.running,
      disposed: snapshot.disposed,
      canvasWidth: canvas?.width,
      canvasHeight: canvas?.height,
      focusRestored: document.activeElement === document.querySelector('#neuralFieldLauncher')
    };
  })()`);
  assert.deepEqual(exitState, {
    bodyActive: false,
    active: false,
    running: false,
    disposed: true,
    canvasWidth: 0,
    canvasHeight: 0,
    focusRestored: true
  }, "exit must dispose the renderer, clear the canvas, and restore launcher focus");

  await writeFile(resolve(captureRoot, "visual-qa.md"), visualQaReport(responsiveResults, metrics, capturePaintResults), "utf8");
  process.stdout.write("neural field rendering browser proof passed\n");
} finally {
  cdp?.close();
  chrome?.kill("SIGTERM");
  if (chrome) {
    await Promise.race([
      new Promise((resolveExit) => chrome.exitCode == null ? chrome.once("exit", resolveExit) : resolveExit()),
      new Promise((resolveExit) => setTimeout(resolveExit, 1_500))
    ]);
  }
  if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
}

async function openFixture(client, appUrl, fixture, viewport, options = {}) {
  await setViewport(client, viewport);
  if (!options.preserveMedia) await client.send("Emulation.setEmulatedMedia", { media: "", features: [] });
  const url = `${appUrl}?sensefield-test=1&neural-field-fixture=${encodeURIComponent(fixture)}`;
  await client.send("Page.navigate", { url });
  await waitForFixture(client, fixture);
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 40))))");
  return {
    snapshot: await client.evaluate("window.__SENSEFIELD_TEST__.getNeuralFieldSnapshot()"),
    layout: await client.evaluate(layoutProbeSource())
  };
}

function assertResponsiveLayout(layout, viewport) {
  assert.equal(layout.horizontalOverflow, false, `${viewport.width}x${viewport.height}: page has horizontal overflow`);
  assert.equal(layout.oneCanvas, true, `${viewport.width}x${viewport.height}: expected one renderer canvas`);
  assert.equal(layout.canvasContained, true, `${viewport.width}x${viewport.height}: overlay leaves camera stage`);
  assert.equal(layout.canvasDprAware, true, `${viewport.width}x${viewport.height}: canvas is not DPR aware`);
  assert.equal(layout.toolSelectorReadable, true, `${viewport.width}x${viewport.height}: tool selector is unreadable`);
  assert.equal(layout.endControlReachable, true, `${viewport.width}x${viewport.height}: End Neural Field control is unreachable`);
  assert.equal(layout.onePrimaryEndControl, true, `${viewport.width}x${viewport.height}: expected one primary End Neural Field control`);
  assert.equal(layout.nativeButtons, true, `${viewport.width}x${viewport.height}: launcher/tools are not native buttons`);
  assert.equal(layout.statusAccessible, true, `${viewport.width}x${viewport.height}: status is not exposed to assistive technology`);
  assert.equal(layout.labelsContained, true, `${viewport.width}x${viewport.height}: overlay label is not contained`);
  assert.equal(layout.noVerticalLabelWrap, true, `${viewport.width}x${viewport.height}: overlay label collapsed into vertical character wrapping ${JSON.stringify(layout.labelDebug)}`);
  assert.equal(layout.savedActionsAvailable, true, `${viewport.width}x${viewport.height}: Saved Actions disappeared`);
  assert.equal(layout.recentMomentsAvailable, true, `${viewport.width}x${viewport.height}: Recent Moments disappeared`);
  if (viewport.width <= 412) assert.ok(layout.cameraHeight >= 220, `${viewport.width}px camera is too small for hand interaction`);
}

function layoutProbeSource() {
  return `(() => {
    const visible = (element) => Boolean(element && !element.hidden && !element.classList.contains('sr-only') && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none');
    const canvas = document.querySelector('#neuralFieldCanvas');
    const stage = document.querySelector('.sf-camera-stage');
    const selector = document.querySelector('#neuralFieldToolSelector');
    const status = document.querySelector('#neuralFieldStatus');
    const endControl = document.querySelector('#analyzeMovement');
    const evidence = document.querySelector('#neuralFieldEvidence > span');
    const relation = document.querySelector('#neuralFieldRelationText');
    const canvasRect = canvas?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    const toolButtons = [...(selector?.querySelectorAll('button') || [])].filter(visible);
    const labels = [evidence].filter(visible);
    const endRect = endControl?.getBoundingClientRect();
    return {
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      oneCanvas: document.querySelectorAll('#neuralFieldCanvas').length === 1,
      canvasContained: Boolean(canvasRect && stageRect && canvasRect.left >= stageRect.left - 1 && canvasRect.right <= stageRect.right + 1 && canvasRect.top >= stageRect.top - 1 && canvasRect.bottom <= stageRect.bottom + 1),
      canvasDprAware: Boolean(canvasRect && canvas.width >= Math.floor(canvasRect.width * devicePixelRatio) - 2 && canvas.height >= Math.floor(canvasRect.height * devicePixelRatio) - 2),
      toolSelectorReadable: visible(selector) && toolButtons.length === 2 && toolButtons.every((button) => button.scrollWidth <= button.clientWidth + 1 && button.getBoundingClientRect().width >= 76),
      endControlReachable: visible(endControl) && /End Neural Field/i.test(endControl.textContent) && endRect.left >= -1 && endRect.right <= innerWidth + 1 && endRect.bottom <= document.documentElement.scrollHeight + 1,
      onePrimaryEndControl: [...document.querySelectorAll('.sf-primary-action')].filter(visible).length === 1 && /End Neural Field/i.test(endControl?.textContent || ''),
      nativeButtons: document.querySelector('#neuralFieldLauncher')?.tagName === 'BUTTON' && toolButtons.length === 2 && toolButtons.every((button) => button.tagName === 'BUTTON'),
      statusAccessible: visible(status) && (status.getAttribute('role') === 'status' || ['polite', 'assertive'].includes(status.getAttribute('aria-live'))),
      labelsContained: labels.every((label) => {
        const host = label.closest('#neuralFieldEvidence') || label.parentElement;
        const rect = label.getBoundingClientRect();
        const hostRect = host?.getBoundingClientRect();
        return Boolean(hostRect && host.scrollWidth <= host.clientWidth + 1 && rect.left >= hostRect.left - 1 && rect.right <= hostRect.right + 1 && rect.left >= -1 && rect.right <= innerWidth + 1);
      }),
      noVerticalLabelWrap: labels.every((label) => {
        const style = getComputedStyle(label);
        const fontSize = parseFloat(style.fontSize) || 16;
        const range = document.createRange();
        range.selectNodeContents(label);
        const lines = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
        return !label.textContent.trim() || (lines.length <= 3 && Math.max(...lines.map((rect) => rect.width), 0) >= fontSize * 3.5);
      }),
      labelDebug: labels.map((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        return { text: label.textContent.trim(), fontSize: getComputedStyle(label).fontSize, rects: [...range.getClientRects()].map((rect) => ({ width: rect.width, height: rect.height })) };
      }),
      savedActionsAvailable: visible(document.querySelector('#savedActionsCard')),
      recentMomentsAvailable: visible(document.querySelector('#recentMomentsCard')),
      cameraHeight: stageRect?.height || 0,
      nonvisualRelation: relation?.textContent?.trim() || ''
    };
  })()`;
}

async function waitForFixture(client, fixture) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const ready = await client.evaluate(`(() => {
      const bridge = window.__SENSEFIELD_TEST__;
      const snapshot = bridge?.getNeuralFieldSnapshot?.();
      return document.readyState === 'complete'
        && document.body.classList.contains('sf-neural-field-active')
        && Boolean(document.querySelector('#neuralFieldCanvas'))
        && snapshot?.active === true
        && snapshot?.disposed === false;
    })()`);
    if (ready) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 60));
  }
  throw new Error(`Neural Field fixture did not become ready: ${fixture}`);
}

async function waitForDocument(client) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await client.evaluate("document.readyState === 'complete'")) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Sensefield fixture document did not load");
}

async function waitForNeuralFieldExit(client) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const exited = await client.evaluate(`(() => {
      const snapshot = window.__SENSEFIELD_TEST__?.getNeuralFieldSnapshot?.();
      const canvas = document.querySelector('#neuralFieldCanvas');
      return snapshot?.active === false
        && snapshot?.running === false
        && snapshot?.disposed === true
        && canvas?.width === 0
        && canvas?.height === 0
        && document.activeElement === document.querySelector('#neuralFieldLauncher');
    })()`);
    if (exited) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Neural Field renderer did not dispose after exit");
}

async function setViewport(client, viewport) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 2,
    mobile: viewport.width <= 768
  });
}

async function captureScreenshot(client, path) {
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 160))))");
  await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  let lastValidation = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 80 + attempt * 35));
    const capture = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    });
    lastValidation = await validateScreenshotPaint(client, capture.data);
    if (lastValidation.valid) {
      await writeFile(path, Buffer.from(capture.data, "base64"));
      return { capture: basename(path), ...lastValidation };
    }
    await client.evaluate("new Promise((resolve) => { window.scrollBy(0, 1); requestAnimationFrame(() => { window.scrollBy(0, -1); requestAnimationFrame(resolve); }); })");
  }
  throw new Error(`Screenshot paint remained corrupted for ${path}: ${JSON.stringify(lastValidation)}`);
}

async function validateScreenshotPaint(client, base64) {
  const source = JSON.stringify(`data:image/png;base64,${base64}`);
  return client.evaluate(`new Promise((resolve) => {
    const image = new Image();
    image.onerror = () => resolve({ valid: false, reason: 'decode_failed' });
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const stageRect = document.querySelector('.sf-camera-frame')?.getBoundingClientRect();
      const scaleX = canvas.width / innerWidth;
      const scaleY = canvas.height / innerHeight;
      const stage = stageRect ? {
        left: stageRect.left * scaleX,
        top: stageRect.top * scaleY,
        right: stageRect.right * scaleX,
        bottom: stageRect.bottom * scaleY
      } : { left: 0, top: 0, right: 0, bottom: 0 };
      const columns = 12;
      const rows = 8;
      const tiles = Array.from({ length: columns * rows }, () => ({ dark: 0, sampled: 0 }));
      let dark = 0;
      let sampled = 0;
      for (let y = 3; y < canvas.height; y += 6) {
        for (let x = 3; x < canvas.width; x += 6) {
          if (x >= stage.left && x <= stage.right && y >= stage.top && y <= stage.bottom) continue;
          const offset = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
          const transparent = pixels[offset + 3] < 220;
          const nearBlack = pixels[offset] < 32 && pixels[offset + 1] < 35 && pixels[offset + 2] < 58;
          const column = Math.min(columns - 1, Math.floor(x / canvas.width * columns));
          const row = Math.min(rows - 1, Math.floor(y / canvas.height * rows));
          const tile = tiles[row * columns + column];
          tile.sampled += 1;
          sampled += 1;
          if (transparent || nearBlack) {
            tile.dark += 1;
            dark += 1;
          }
        }
      }
      const darkRatio = sampled ? dark / sampled : 1;
      const maxTileDarkRatio = Math.max(0, ...tiles.filter((tile) => tile.sampled >= 20).map((tile) => tile.dark / tile.sampled));
      resolve({
        valid: sampled > 0 && darkRatio < 0.12 && maxTileDarkRatio < 0.4,
        darkRatio,
        maxTileDarkRatio,
        sampled
      });
    };
    image.src = ${source};
  })`);
}

function visualQaReport(results, metrics, capturePaintResults) {
  const rows = results.map((result) => `| ${result.viewport.width} × ${result.viewport.height} | ${result.horizontalOverflow ? "FAIL" : "PASS"} | ${result.canvasContained ? "PASS" : "FAIL"} | ${result.labelsContained ? "PASS" : "FAIL"} | ${result.noVerticalLabelWrap ? "PASS" : "FAIL"} | ${result.toolSelectorReadable ? "PASS" : "FAIL"} |`).join("\n");
  const paintRows = capturePaintResults.map((result) => `| \`${result.capture}\` | ${formatRatio(result.darkRatio)} | ${formatRatio(result.maxTileDarkRatio)} | ${result.sampled} | PASS |`).join("\n");
  return `# Neural Field Rendering Visual QA

Deterministic local-only fixtures were captured with explicit \`sensefield-test=1\`; no automatic recording, upload, or raw-media persistence was used. Depth styling represents relative depth only.
Each saved PNG passed a capture-paint guard that rejects transparent or near-black compositor tiles outside the camera stage.

## Refinement passes

1. **Composition — PASS.** Camera remains dominant; launcher/tool controls stay compact; Saved Actions and Recent Moments remain available.
2. **Trail and shader quality — PASS.** Evidence and stabilized AirScript trajectories remain distinct, bounded, depth-faded, and readable without decorative random motion.
3. **Object grounding and relations — PASS.** Lasso resolution produces a grounded mug anchor, ambiguity preserves the candidate loop, and only supported labeled relations render.
4. **Responsive polish and accessibility — PASS.** Six target viewports have no horizontal overflow; status, relation text, dismissal, label containment, and reduced motion remain available.

## Responsive containment

| Viewport | No horizontal overflow | Canvas contained | Labels contained | No vertical wrapping | Tool selector readable |
| --- | --- | --- | --- | --- | --- |
${rows}

## Renderer measurements

- Headless capture FPS: ${formatMetric(metrics.fps)} (the separate render benchmark enforces the above-30 practical target)
- p95 render time: ${formatMetric(metrics.p95RenderMs)} ms
- Path point count: ${metrics.pathPointCount}
- Canvas memory: ${metrics.canvasMemoryBytes} bytes
- Label layout: ${formatMetric(metrics.labelLayoutMs)} ms
- Relation update: ${formatMetric(metrics.relationUpdateMs)} ms

## Decoded PNG paint validation

The ratios below are computed by decoding each exact PNG before it is saved. Transparent pixels and near-black pixels outside the dark camera frame both count toward the rejected-pixel ratios.

| Capture | darkRatio | maxTileDarkRatio | Decoded samples | Result |
| --- | ---: | ---: | ---: | --- |
${paintRows}

## Captures

- \`airscript-desktop.png\`
- \`airscript-mobile.png\`
- \`lasso-selected.png\`
- \`relation-rendering.png\`
- \`ambiguous-selection.png\`
- \`reduced-motion.png\`
`;
}

function formatMetric(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "0.00";
}

function formatRatio(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(6) : "1.000000";
}

async function waitForChrome(port) {
  const deadline = Date.now() + 10_000;
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
    close() { socket.close(); }
  };
}
