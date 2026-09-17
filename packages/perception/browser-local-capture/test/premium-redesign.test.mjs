import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";

await import(new URL("../../../../fixtures/sensefield-av/generate-fixtures.mjs", import.meta.url));

const prototypeRoot = resolve("packages/perception/browser-local-capture/prototype");
const threeRoot = resolve("node_modules/three");
const captureRoot = resolve("runs/optical-iris-bloom");
const fakeVideoPath = resolve("fixtures/sensefield-av/video/neutral_peace_neutral_thumbs.y4m");
const viewports = [
  { width: 2048, height: 1330 },
  { width: 1800, height: 642 },
  { width: 1536, height: 512 },
  { width: 1536, height: 1024 },
  { width: 1728, height: 1117 },
  { width: 1586, height: 992 },
  { width: 1448, height: 1086 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 412, height: 915 },
  { width: 390, height: 844 }
];
const opticalAcceptanceViewports = new Set(["1536x1024", "1440x900", "1024x768", "390x844"]);

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
    const filePath = pathname.startsWith("/vendor/three/")
      ? resolve(threeRoot, pathname.slice("/vendor/three/".length))
      : resolve(prototypeRoot, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
    const insidePrototype = filePath === prototypeRoot || filePath.startsWith(`${prototypeRoot}${sep}`);
    const insideThree = filePath === threeRoot || filePath.startsWith(`${threeRoot}${sep}`);
    if (!insidePrototype && !insideThree) throw new Error("Invalid path");
    const body = await readFile(filePath);
    const contentType = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".glb": "model/gltf-binary"
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
    "--no-first-run",
    "--no-default-browser-check",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-video-capture=${fakeVideoPath}`,
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
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }]
  });

  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width <= 600
    });
    await cdp.send("Page.navigate", { url: `${appUrl}?premium=${viewport.width}x${viewport.height}` });
    await waitForReady(cdp);
    await waitForOpticalCore(cdp);
    await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const layout = await cdp.evaluate(layoutProbe());
    const viewportKey = `${viewport.width}x${viewport.height}`;
    if (opticalAcceptanceViewports.has(viewportKey)) {
      console.log(
        `optical geometry ${viewportKey}: camera ${layout.cameraFrameWidth}x${layout.cameraFrameHeight}; rail ${layout.recentWidth}x${layout.recentHeight}; camera share ${layout.cameraRegionShare}`
      );
    }

    assert.ok(layout.scrollWidth <= viewport.width + 1, `${viewport.width}px: horizontal overflow (${layout.scrollWidth}px)`);
    assert.equal(layout.visibleHeader, false, `${viewport.width}px: global header is visible`);
    assert.equal(layout.visibleNavigation, false, `${viewport.width}px: navigation is visible`);
    assert.equal(layout.modeVisible, true, `${viewport.width}px: mode selector is not visible`);
    assert.equal(layout.visibleModeIcons, 3, `${viewport.width}px: expected three visible mode icons`);
    assert.equal(layout.visibleModeLabels, 3, `${viewport.width}px: expected three visible mode labels`);
    assert.equal(layout.singlePrimaryCta, 1, `${viewport.width}px: expected one primary CTA`);
    assert.equal(layout.primaryCtaDisabled, false, `${viewport.width}px: dormant primary CTA is unexpectedly disabled`);
    assert.equal(layout.integratedPrimaryCta, true, `${viewport.width}px: primary CTA is not integrated inside the lens`);
    assert.equal(layout.roadmapRemoved, true, `${viewport.width}px: obsolete future-capability cards remain visible`);
    assert.equal(layout.savedActionsRemoved, true, `${viewport.width}px: Saved Actions remains in the primary UI`);
    assert.ok(layout.recentMomentRows <= 3, `${viewport.width}px: more than three recent moments are visible`);
    assert.equal(layout.realModeButtons, 3, `${viewport.width}px: expected three real runtime modes`);
    assert.equal(layout.microscopeAvailable, true, `${viewport.width}px: Microscope is not available as a live mode`);
    assert.equal(layout.apertureReady, true, `${viewport.width}px: Blender aperture asset is not ready`);
    assert.equal(layout.dormantApertureHidden, true, `${viewport.width}px: dormant stage still exposes an optical plate`);
    assert.equal(layout.cleanDormantStage, true, `${viewport.width}px: dormant camera stage still carries a decorative background image`);
    assert.equal(layout.noDecorativeOverlay, true, `${viewport.width}px: a decorative optical overlay element remains on the camera stage`);
    assert.equal(layout.circularDormantSurface, false, `${viewport.width}px: rejected circular dormant surface is visible`);
    assert.equal(layout.dormantTitle, "Ask the world", `${viewport.width}px: dormant product value is unclear`);
    assert.equal(layout.liveExchangeVisible, true, `${viewport.width}px: Live Exchange display is not visible`);
    assert.equal(layout.visiblePrimaryTextInputs, 0, `${viewport.width}px: primary Ask still exposes a text composer`);
    assert.equal(layout.energyModeControlVisible, false, `${viewport.width}px: user-facing Energy Mode control remains`);
    assert.equal(layout.cameraRectangular, true, `${viewport.width}px: dormant camera stage is not vertically dominant (${layout.cameraFrameWidth}x${layout.cameraFrameHeight}, radius ${layout.cameraRadius}, aspect ${layout.cameraAspect}, stage ${layout.cameraStageWidth}px, grid ${layout.workspaceColumns})`);
    assert.deepEqual(layout.outsideCards, [], `${viewport.width}px: cards leave the viewport`);
    assert.deepEqual(layout.clippedText, [], `${viewport.width}px: text is clipped`);
    assert.deepEqual(layout.verticallyClippedText, [], `${viewport.width}px: text is vertically clipped`);

    const captureName = new Map([
      ["2048x1330", "optical-depth-reference-2048x1330.png"],
      ["1800x642", "optical-depth-material-1800x642.png"],
      ["1536x512", "elite-handoff-1536x512.png"],
      ["1536x1024", "optical-depth-1536x1024.png"],
      ["1728x1117", "desktop-1728.png"],
      ["1586x992", "desktop-reference-size.png"],
      ["1448x1086", "desktop-1448-reference.png"],
      ["1440x900", "desktop-1440.png"],
      ["1024x768", "tablet-1024.png"],
      ["390x844", "mobile-390.png"]
    ]).get(`${viewport.width}x${viewport.height}`);
    if (captureName) {
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      await writeFile(resolve(captureRoot, captureName), Buffer.from(screenshot.data, "base64"));
    }

    if (viewport.width >= 1181) {
      assert.equal(layout.desktopOrbit, true, `${viewport.width}px: desktop grid is not the camera-and-moments orbit (${layout.workspaceColumns}; ${layout.placements})`);
      assert.equal(layout.cameraDominant, true, `${viewport.width}px: camera core is not dominant`);
      assert.ok(layout.stageRailHeightDelta <= 2, `${viewport.width}px: camera and Live Exchange heights differ by ${layout.stageRailHeightDelta}px`);
      if (viewport.height > 950) {
        assert.ok(layout.cameraRegionShare >= 0.7 && layout.cameraRegionShare <= 0.76, `${viewport.width}px: camera region does not occupy the intended 70–76% of the primary instrument (${layout.cameraRegionShare})`);
      }
      assert.equal(layout.orbitPlacement, true, `${viewport.width}px: camera, mode selector, response, and moments are not aligned (${layout.geometry}; ${layout.placements})`);
    } else if (viewport.width <= 600) {
      assert.equal(layout.mobileOrder, true, `${viewport.width}px: mobile order does not match the approved design`);
    } else {
      assert.equal(layout.tabletOrder, true, `${viewport.width}px: tablet order does not preserve the perception hierarchy`);
      assert.equal(layout.tabletExchange, true, `${viewport.width}px: tablet Live Exchange is not a substantial lower rail`);
    }
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [targetMs, filename] of [
    [0, "iris-000ms-dormant.png"],
    [150, "iris-150ms.png"],
    [300, "iris-300ms.png"],
    [500, "iris-500ms.png"],
    [750, "iris-750ms.png"],
    [1000, "iris-1000ms.png"],
    [1250, "iris-1250ms.png"],
    [1500, "iris-final-live.png"]
  ]) {
    await cdp.send("Page.navigate", { url: `${appUrl}?sensefield-test=1&iris-frame=${targetMs}` });
    await waitForReady(cdp);
    await waitForOpticalCore(cdp);
    if (targetMs > 0) {
      const startedAt = await cdp.evaluate(`(() => {
        const startedAt = performance.now();
        document.querySelector('[data-interaction-mode="observing"]').click();
        document.querySelector('#analyzeMovement').click();
        return startedAt;
      })()`);
      await waitForElapsed(cdp, startedAt, targetMs);
    }
    await captureScreenshot(cdp, filename);
  }

  for (const [mode, filename] of [
    ["conversation", "iris-mode-ask.png"],
    ["observing", "iris-mode-watch.png"],
    ["microscope", "iris-mode-microscope.png"]
  ]) {
    await cdp.send("Page.navigate", { url: `${appUrl}?sensefield-test=1&iris-mode=${mode}` });
    await waitForReady(cdp);
    await waitForOpticalCore(cdp);
    const startedAt = await cdp.evaluate(`(() => {
      const startedAt = performance.now();
      document.querySelector('[data-interaction-mode="${mode}"]').click();
      document.querySelector('#analyzeMovement').click();
      return startedAt;
    })()`);
    await waitForElapsed(cdp, startedAt, 300);
    await captureScreenshot(cdp, filename);
  }

  await cdp.send("Page.navigate", { url: `${appUrl}?sensefield-test=1&iris=delayed-hold` });
  await waitForReady(cdp);
  await waitForOpticalCore(cdp);
  await cdp.evaluate(`(() => {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let releaseCamera;
    const cameraGate = new Promise((resolve) => { releaseCamera = resolve; });
    window.__releaseDelayedCamera = releaseCamera;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (...args) => {
        await cameraGate;
        return originalGetUserMedia(...args);
      }
    });
    document.querySelector('[data-interaction-mode="observing"]').click();
    document.querySelector('#analyzeMovement').click();
  })()`);
  await waitForEvaluation(cdp, "window.__SENSEFIELD_TEST__?.getPerceptionCoreState().state === 'holding'", 8000);
  await captureScreenshot(cdp, "iris-delayed-hold.png");
  await cdp.evaluate("window.__releaseDelayedCamera()");
  await waitForEvaluation(cdp, "window.__SENSEFIELD_TEST__?.getPerceptionCoreState().state === 'active'", 8000);

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.navigate", { url: `${appUrl}?premium=interaction` });
  await waitForReady(cdp);
  await waitForOpticalCore(cdp);
  await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const observing = await cdp.evaluate(`(() => {
    document.querySelector('[data-interaction-mode="observing"]').click();
    return new Promise((resolve) => setTimeout(() => resolve({
      selected: document.querySelector('[data-interaction-mode="observing"]').getAttribute('aria-pressed'),
      cta: document.querySelector('#analyzeMovement').textContent.trim(),
      cameraStatus: document.querySelector('#cameraStatusChip').textContent.trim()
    }), 80));
  })()`);
  assert.equal(observing.selected, "true", "mode selector is not connected to runtime state");
  assert.equal(observing.cta, "Start observing", "watch mode does not expose the observing CTA");
  assert.equal(observing.cameraStatus, "Watch ready", "inactive Watch mode does not expose WATCH READY");

  const conversation = await cdp.evaluate(`(() => {
    document.querySelector('[data-interaction-mode="conversation"]').click();
    return new Promise((resolve) => setTimeout(() => resolve({
      selected: document.querySelector('[data-interaction-mode="conversation"]').getAttribute('aria-pressed'),
      cta: document.querySelector('#analyzeMovement').textContent.trim(),
      cameraStatus: document.querySelector('#cameraStatusChip').textContent.trim()
    }), 80));
  })()`);
  assert.deepEqual(conversation, { selected: "true", cta: "Start conversation", cameraStatus: "Camera off" }, "conversation mode does not restore its dormant controls");

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

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${appUrl}?sensefield-test=1&perception-core=activation` });
  await waitForReady(cdp);
  await waitForOpticalCore(cdp);
  const dormantGeometry = await cdp.evaluate(`(() => {
    const frame = document.querySelector('.sf-camera-frame').getBoundingClientRect();
    return { width: frame.width, height: frame.height, left: frame.left, top: frame.top };
  })()`);
  const activationStartedAt = await cdp.evaluate(`(() => {
    const video = document.querySelector('#preview');
    window.__sensefieldVideoFrameTimes = [];
    const collectVideoFrame = () => {
      window.__sensefieldVideoFrameTimes.push(performance.now());
      if (window.__sensefieldVideoFrameTimes.length < 240) video.requestVideoFrameCallback(collectVideoFrame);
    };
    video.requestVideoFrameCallback(collectVideoFrame);
    const startedAt = performance.now();
    window.__sensefieldActivationStartedAt = startedAt;
    document.querySelector('[data-interaction-mode="observing"]').click();
    document.querySelector('#analyzeMovement').click();
    return startedAt;
  })()`);
  await waitForEvaluation(cdp, "document.querySelector('.sf-camera-stage')?.dataset.perceptionCoreState === 'awakening'");
  await waitForElapsed(cdp, activationStartedAt, 150);
  await captureScreenshot(cdp, "perception-core-awakening.png");
  await waitForElapsed(cdp, activationStartedAt, 300);
  await waitForElapsed(cdp, activationStartedAt, 500);
  await waitForElapsed(cdp, activationStartedAt, 750);
  await waitForElapsed(cdp, activationStartedAt, 1000);
  const morphGeometry = await cdp.evaluate(`(() => {
    const frame = document.querySelector('.sf-camera-frame').getBoundingClientRect();
    return {
      ratio: frame.width / frame.height,
      width: frame.width,
      height: frame.height,
      stageWidth: document.querySelector('.sf-camera-stage').getBoundingClientRect().width,
      stageHeight: document.querySelector('.sf-camera-stage').getBoundingClientRect().height,
      computedWidth: getComputedStyle(document.querySelector('.sf-camera-frame')).width,
      computedHeight: getComputedStyle(document.querySelector('.sf-camera-frame')).height,
      state: document.querySelector('.sf-camera-stage').dataset.perceptionCoreState
    };
  })()`);
  assert.ok(["revealing", "active"].includes(morphGeometry.state), "lens morph is not synchronized with the authored reveal");
  assert.ok(Math.abs(morphGeometry.ratio - dormantGeometry.width / dormantGeometry.height) < 0.01, `camera activation changed the persistent viewport geometry (${JSON.stringify({ dormantGeometry, morphGeometry })})`);
  await captureScreenshot(cdp, "perception-core-aperture-open.png");
  await waitForElapsed(cdp, activationStartedAt, 1250);
  await waitForElapsed(cdp, activationStartedAt, 1500);
  await waitForEvaluation(cdp, "window.__SENSEFIELD_TEST__?.getInteractionState().sessionActive === true && window.__SENSEFIELD_TEST__?.getPerceptionCoreState().state === 'active'", 8000);
  const activeCore = await cdp.evaluate("window.__SENSEFIELD_TEST__.getPerceptionCoreState()");
  assert.equal(activeCore.assetReady, true, "active camera reveal did not use the Blender asset");
  assert.equal(activeCore.rendererActive, false, "Perception Core keeps rendering behind active camera video");
  assert.ok(activeCore.activationDurationMs >= 1200 && activeCore.activationDurationMs <= 1700, `activation duration is outside the intended pacing (${activeCore.activationDurationMs}ms)`);
  assert.ok(activeCore.renderTimeP95Ms < 20, `Perception Core p95 render time is too high (${activeCore.renderTimeP95Ms}ms)`);
  assert.ok(activeCore.resourceCount > 0 && activeCore.resourceCount <= 56, `Perception Core resource count is unbounded (${activeCore.resourceCount})`);
  await cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 800))");
  const cameraFrameRate = await cdp.evaluate(`(() => {
    const startedAt = window.__sensefieldActivationStartedAt;
    const times = window.__sensefieldVideoFrameTimes || [];
    const fpsFor = (startMs, endMs) => {
      const samples = times.filter((time) => time >= startedAt + startMs && time <= startedAt + endMs);
      const duration = (samples.at(-1) || 0) - (samples[0] || 0);
      return {
        samples: samples.length,
        fps: samples.length > 1 && duration > 0
          ? Number((((samples.length - 1) * 1000) / duration).toFixed(1))
          : 0
      };
    };
    return {
      during_overlay: fpsFor(650, 1350),
      after_overlay: fpsFor(1550, 2350)
    };
  })()`);
  assert.ok(cameraFrameRate.during_overlay.samples >= 3, "camera frame cadence was not measurable during the optical reveal");
  assert.ok(cameraFrameRate.after_overlay.samples >= 4, "camera frame cadence was not measurable after the optical reveal");
  assert.ok(
    cameraFrameRate.after_overlay.fps >= cameraFrameRate.during_overlay.fps * 0.8,
    `camera frame cadence regressed after reveal (${JSON.stringify(cameraFrameRate)})`
  );
  const activeViewport = await cdp.evaluate(`(() => {
    const frame = document.querySelector('.sf-camera-frame');
    const video = document.querySelector('#preview');
    const opticalCore = document.querySelector('.sf-optical-core');
    const recent = document.querySelector('#recentMomentsCard');
    const cta = document.querySelector('#analyzeMovement');
    const status = document.querySelector('.dq-camera-status-chip');
    const rect = frame.getBoundingClientRect();
    const recentRect = recent.getBoundingClientRect();
    const ctaRect = cta.getBoundingClientRect();
    const statusRect = status.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      objectFit: getComputedStyle(video).objectFit,
      previewClipPath: getComputedStyle(video).clipPath,
      opticalVisibility: getComputedStyle(opticalCore).visibility,
      opticalOpacity: Number.parseFloat(getComputedStyle(opticalCore).opacity),
      opticalPointerEvents: getComputedStyle(opticalCore).pointerEvents,
      cameraAspect: frame.dataset.cameraAspect || '',
      cameraStatus: document.querySelector('#cameraStatusChip').textContent.trim(),
      cameraStatusAsset: getComputedStyle(document.querySelector('.dq-camera-status-chip')).backgroundImage,
      recentStartsAt: recentRect.left,
      frameEndsAt: rect.right,
      stageRailHeightDelta: Math.abs(rect.height - recentRect.height),
      ctaStartsAt: ctaRect.left,
      statusEndsAt: statusRect.right
    };
  })()`);
  assert.ok(activeViewport.width > activeViewport.height * 1.15, `active camera viewport is still too narrow (${activeViewport.width}x${activeViewport.height})`);
  assert.equal(activeViewport.objectFit, "cover", "active camera does not fill the approved persistent stage");
  assert.equal(activeViewport.previewClipPath, "none", "active camera is still clipped by a circular reveal");
  assert.equal(activeViewport.opticalVisibility, "hidden", "the optical assembly remains visible over live camera video");
  assert.equal(activeViewport.opticalOpacity, 0, "the optical assembly still obstructs live camera video");
  assert.equal(activeViewport.opticalPointerEvents, "none", "the optical assembly can intercept live camera input");
  assert.equal(activeViewport.cameraAspect, `${activeViewport.videoWidth}x${activeViewport.videoHeight}`, "active lens does not follow the real camera aspect ratio");
  assert.ok(Math.abs(activeViewport.width - dormantGeometry.width) <= 2, "camera activation changed the stage width");
  assert.ok(Math.abs(activeViewport.height - dormantGeometry.height) <= 2, "camera activation changed the stage height");
  assert.equal(activeViewport.cameraStatus, "Watch live", "active Watch mode does not expose WATCH LIVE");
  assert.ok(activeViewport.cameraStatusAsset.includes("watch-live-badge.svg"), "active Watch mode does not render the supplied WATCH LIVE badge");
  assert.ok(activeViewport.stageRailHeightDelta <= 2, "active Watch rail does not match the camera height");
  assert.ok(activeViewport.frameEndsAt <= activeViewport.recentStartsAt, "wider active camera overlaps Recent Moments");
  assert.ok(activeViewport.statusEndsAt < activeViewport.ctaStartsAt, "active camera status overlaps the stop control");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1512, height: 746, deviceScaleFactor: 1, mobile: false });
  await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const watchRailContainment = await cdp.evaluate(`(() => {
    const insight = document.querySelector('.sf-watch-insight');
    const display = document.querySelector('.sf-watch-insight-display');
    const hero = document.querySelector('.sf-watch-hero');
    const headline = hero?.querySelector('strong');
    const support = hero?.querySelector('p');
    const meta = hero?.querySelector('.sf-watch-meta');
    const status = document.querySelector('.sf-watch-status');
    if (!insight || !display || !hero || !headline || !support || !meta || !status) return null;
    insight.dataset.watchState = 'error';
    headline.textContent = 'Live watching could not start.';
    support.textContent = 'Allow camera access, then try again.';
    meta.innerHTML = '<span>Confirm important details manually</span>';
    status.innerHTML = '<i aria-hidden="true"></i>Unavailable';
    const heroRect = hero.getBoundingClientRect();
    const headlineRect = headline.getBoundingClientRect();
    const displayStyle = getComputedStyle(display);
    return {
      text: headline.textContent,
      fullyVisible: headlineRect.top >= heroRect.top - 1
        && headlineRect.bottom <= heroRect.bottom + 1
        && headline.scrollHeight <= headline.clientHeight + 1,
      displayOverflowY: displayStyle.overflowY,
      displayCanReachContent: display.scrollHeight <= display.clientHeight + 1
        || ['auto', 'scroll'].includes(displayStyle.overflowY),
      headlineHeight: headlineRect.height,
      headlineScrollHeight: headline.scrollHeight,
      heroHeight: heroRect.height
    };
  })()`);
  assert.ok(watchRailContainment, "Watch insight rail did not render");
  assert.equal(watchRailContainment.text, "Live watching could not start.");
  assert.equal(watchRailContainment.fullyVisible, true, `Watch headline is vertically clipped (${JSON.stringify(watchRailContainment)})`);
  assert.equal(watchRailContainment.displayCanReachContent, true, `Watch rail hides unreachable content (${JSON.stringify(watchRailContainment)})`);
  await captureScreenshot(cdp, "watch-rail-containment.png");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const modeGeometry = await cdp.evaluate(`(() => {
    const body = document.body;
    const frame = document.querySelector('.sf-camera-frame');
    const panel = document.querySelector('#microscopePanel');
    const rect = () => {
      const value = frame.getBoundingClientRect();
      return { width: value.width, height: value.height, left: value.left, top: value.top };
    };
    body.dataset.primarySurface = 'conversation';
    const ask = rect();
    body.dataset.primarySurface = 'observing';
    const watch = rect();
    body.classList.add('sf-microscope-surface');
    body.dataset.primarySurface = 'microscope';
    const microscope = rect();
    const panelWasHidden = panel.hidden;
    panel.hidden = false;
    const microscopePanelDisplay = getComputedStyle(panel).display;
    const microscopeRect = frame.getBoundingClientRect();
    const microscopeCenterDelta = Math.abs((microscopeRect.left + microscopeRect.right) / 2 - innerWidth / 2);
    panel.hidden = panelWasHidden;
    body.classList.remove('sf-microscope-surface');
    body.dataset.primarySurface = 'observing';
    return { ask, watch, microscope, microscopePanelDisplay, microscopeCenterDelta };
  })()`);
  assert.ok(
    Math.abs(modeGeometry.watch.width - modeGeometry.ask.width) <= 1
      && Math.abs(modeGeometry.watch.height - modeGeometry.ask.height) <= 1,
    "Watch does not use the canonical Ask camera geometry"
  );
  assert.ok(
    Math.abs(modeGeometry.microscope.width - modeGeometry.ask.width) <= 1
      && Math.abs(modeGeometry.microscope.height - modeGeometry.ask.height) <= 1
      && Math.abs(modeGeometry.microscope.left - modeGeometry.ask.left) <= 1
      && Math.abs(modeGeometry.microscope.top - modeGeometry.ask.top) <= 1,
    "Microscope does not preserve the canonical camera bounds"
  );
  assert.equal(modeGeometry.microscopePanelDisplay, "none", "Microscope local-vision menu remains visible");
  await captureScreenshot(cdp, "perception-core-camera-reveal.png");
  await cdp.evaluate("document.querySelector('#analyzeMovement').click()");
  await waitForEvaluation(cdp, "window.__SENSEFIELD_TEST__?.getInteractionState().sessionActive === false && window.__SENSEFIELD_TEST__?.getPerceptionCoreState().state === 'dormant'", 8000);
  const endedResources = await cdp.evaluate(`(() => ({
    media: window.__SENSEFIELD_TEST__.getMediaTrackState(),
    core: window.__SENSEFIELD_TEST__.getPerceptionCoreState(),
    videoDetached: document.querySelector('#preview').srcObject === null
  }))()`);
  assert.equal(endedResources.media.stream_count, 0, "camera stream remains attached after exit");
  assert.equal(endedResources.videoDetached, true, "video source remains attached after exit");
  assert.equal(endedResources.core.rendererActive, false, "dormant optical assembly should stay suspended");

  await cdp.send("Page.navigate", { url: `${appUrl}?sensefield-test=1&perception-core=denied` });
  await waitForReady(cdp);
  await waitForOpticalCore(cdp);
  await cdp.evaluate(`(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }
    });
    document.querySelector('[data-interaction-mode="observing"]').click();
    document.querySelector('#analyzeMovement').click();
  })()`);
  await waitForEvaluation(cdp, "document.querySelector('.sf-camera-stage')?.dataset.perceptionCoreState === 'permission-denied'");
  const deniedState = await cdp.evaluate(`(() => ({
    cameraReady: window.__SENSEFIELD_TEST__.getInteractionState().cameraActive,
    errorVisible: !document.querySelector('#errorBanner').hidden,
    errorWithinViewport: (() => {
      const rect = document.querySelector('#errorBanner').getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    })(),
    videoDetached: document.querySelector('#preview').srcObject === null
  }))()`);
  assert.equal(deniedState.cameraReady, false, "permission denial exposes a ready camera state");
  assert.equal(deniedState.errorVisible, true, "permission denial does not retain the existing safe error message");
  assert.equal(deniedState.errorWithinViewport, true, "permission guidance is outside the visible instrument");
  assert.equal(deniedState.videoDetached, true, "permission denial attaches video media");
  await captureScreenshot(cdp, "perception-core-permission-denied.png");
  await cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 620))");
  await captureScreenshot(cdp, "iris-denial-reversal.png");
  await waitForEvaluation(cdp, "window.__SENSEFIELD_TEST__?.getPerceptionCoreState().state === 'dormant'", 8000);

  await cdp.send("Page.navigate", { url: `${appUrl}?sensefield-test=1&perception-core=camera-error` });
  await waitForReady(cdp);
  await waitForOpticalCore(cdp);
  await cdp.evaluate(`(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Camera is unavailable', 'NotReadableError'); }
    });
    document.querySelector('[data-interaction-mode="microscope"]').click();
    document.querySelector('#analyzeMovement').click();
  })()`);
  await waitForEvaluation(cdp, "document.querySelector('.sf-camera-stage')?.dataset.perceptionCoreState === 'error'");
  const cameraErrorState = await cdp.evaluate(`(() => ({
    cameraReady: window.__SENSEFIELD_TEST__.getInteractionState().cameraActive,
    errorVisible: !document.querySelector('#errorBanner').hidden,
    videoDetached: document.querySelector('#preview').srcObject === null,
    microscopeSelected: document.querySelector('[data-interaction-mode="microscope"]').getAttribute('aria-pressed')
  }))()`);
  assert.equal(cameraErrorState.cameraReady, false, "camera failure exposes a ready camera state");
  assert.equal(cameraErrorState.errorVisible, true, "camera failure does not retain the existing safe error message");
  assert.equal(cameraErrorState.videoDetached, true, "camera failure attaches video media");
  assert.equal(cameraErrorState.microscopeSelected, "true", "camera failure changes the selected mode");
  await captureScreenshot(cdp, "perception-core-camera-error.png");
  await waitForEvaluation(cdp, "window.__SENSEFIELD_TEST__?.getPerceptionCoreState().state === 'dormant'", 8000);

  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  await cdp.send("Page.navigate", { url: `${appUrl}?sensefield-test=1&perception-core=reduced-motion` });
  await waitForReady(cdp);
  await waitForOpticalCore(cdp);
  const reducedStartedAt = await cdp.evaluate(`(() => {
    const startedAt = performance.now();
    document.querySelector('[data-interaction-mode="observing"]').click();
    document.querySelector('#analyzeMovement').click();
    return startedAt;
  })()`);
  await waitForElapsed(cdp, reducedStartedAt, 250);
  await captureScreenshot(cdp, "iris-reduced-motion-250ms.png");
  await waitForEvaluation(cdp, "window.__SENSEFIELD_TEST__?.getPerceptionCoreState().state === 'active'", 8000);
  const reducedCore = await cdp.evaluate("window.__SENSEFIELD_TEST__.getPerceptionCoreState()");
  assert.equal(reducedCore.reducedMotion, true, "reduced-motion preference is not honored");
  assert.ok(reducedCore.activationDurationMs >= 350 && reducedCore.activationDurationMs <= 650, `reduced-motion reveal is outside the intended 400–600ms range (${reducedCore.activationDurationMs}ms)`);
  assert.equal(reducedCore.rendererActive, false, "reduced-motion camera leaves the renderer active behind video");
  await captureScreenshot(cdp, "perception-core-reduced-motion.png");
  await cdp.evaluate("document.querySelector('#analyzeMovement').click()");
  await waitForEvaluation(cdp, "window.__SENSEFIELD_TEST__?.getInteractionState().sessionActive === false", 8000);
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }]
  });

  await writeFile(resolve(captureRoot, "perception-core-metrics.json"), `${JSON.stringify({
    asset_bytes: (await readFile(resolve(prototypeRoot, "assets/blender/optical-iris-bloom/optical-iris-bloom.glb"))).byteLength,
    standard_activation: activeCore,
    activation_morph: morphGeometry,
    camera_frame_rate: cameraFrameRate,
    active_viewport: activeViewport,
    mode_geometry: modeGeometry,
    camera_error: cameraErrorState,
    reduced_motion_activation: reducedCore,
    cleanup: endedResources
  }, null, 2)}\n`);

  assert.deepEqual(cdp.errorMessages(), [], `Chrome reported runtime errors: ${cdp.errorMessages().join(" | ")}`);
  process.stdout.write("optical iris bloom browser proof passed\n");
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
      && !element.closest('[hidden], details:not([open])')
      && getComputedStyle(element).visibility !== 'hidden');
    const inside = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= innerWidth + 1;
    };
    const workspace = document.querySelector('#mainWorkspace');
    const camera = document.querySelector('.sf-camera-stage');
    const cameraFrame = document.querySelector('.sf-camera-frame');
    const mode = document.querySelector('#interactionModeSelector');
    const response = document.querySelector('#operatorCommandsCard');
    const recent = document.querySelector('#recentMomentsCard');
    const primaryCta = document.querySelector('#analyzeMovement');
    const roadmap = document.querySelector('#whatsNextPanel');
    const cards = [camera, mode, response, recent];
    const clippedText = [...document.querySelectorAll('[data-primary-view] button, [data-primary-view] strong, [data-primary-view] small, [data-primary-view] p, [data-primary-view] a')]
      .filter(visible)
      .filter((element) => element.scrollWidth > element.clientWidth + 1 && !['auto', 'scroll'].includes(getComputedStyle(element).overflowX))
      .map((element) => element.id || element.textContent.trim().slice(0, 60));
    const verticallyClippedText = [...document.querySelectorAll('[data-primary-view] button, [data-primary-view] strong, [data-primary-view] small, [data-primary-view] p, [data-primary-view] a')]
      .filter(visible)
      .filter((element) => element.scrollHeight > element.clientHeight + 1 && !['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
      .map((element) => element.id || element.textContent.trim().slice(0, 60));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      visibleHeader: [...document.querySelectorAll('header')].some(visible),
      visibleNavigation: [...document.querySelectorAll('nav')].some(visible),
      modeVisible: visible(mode),
      visibleModeIcons: [...mode.querySelectorAll('svg')].filter(visible).length,
      visibleModeLabels: [...mode.querySelectorAll('button > span')].filter(visible).length,
      singlePrimaryCta: [...document.querySelectorAll('.sf-primary-action')].filter(visible).length,
      primaryCtaDisabled: primaryCta.disabled,
      integratedPrimaryCta: cameraFrame.contains(primaryCta),
      roadmapRemoved: !roadmap && !document.body.innerText.includes("What's next"),
      savedActionsRemoved: !document.querySelector('#savedActionsCard')
        && !document.querySelector('#savedActionsList')
        && !document.body.innerText.includes('Saved actions'),
      recentMomentRows: recent.querySelectorAll('.sf-moment-row').length,
      realModeButtons: mode.querySelectorAll('[data-interaction-mode]').length,
      microscopeAvailable: Boolean(mode.querySelector('[data-interaction-mode="microscope"]:not(:disabled)')),
      apertureReady: document.querySelector('.sf-camera-stage')?.dataset.perceptionCoreState === 'dormant'
        && document.querySelector('#perceptionCoreCanvas')?.width > 0,
      dormantApertureHidden: (() => {
        const host = document.querySelector('.sf-optical-core');
        const canvas = host?.querySelector('canvas');
        if (!host || !canvas) return false;
        const hostStyle = getComputedStyle(host);
        const canvasStyle = getComputedStyle(canvas);
        return hostStyle.backgroundImage === 'none'
          && hostStyle.visibility === 'hidden'
          && Number.parseFloat(hostStyle.opacity) === 0
          && canvasStyle.visibility === 'visible'
          && Math.abs(canvas.getBoundingClientRect().width - cameraFrame.getBoundingClientRect().width) <= 2
          && Math.abs(canvas.getBoundingClientRect().height - cameraFrame.getBoundingClientRect().height) <= 2;
      })(),
      cleanDormantStage: getComputedStyle(cameraFrame).backgroundImage === 'none',
      noDecorativeOverlay: !document.querySelector('.sf-camera-glass-reflection')
        && !document.querySelector('.pc-hero-tags'),
      circularDormantSurface: getComputedStyle(document.querySelector('.dq-camera-empty')).borderTopLeftRadius.endsWith('%')
        || getComputedStyle(document.querySelector('.dq-camera-empty')).backgroundColor !== 'rgba(0, 0, 0, 0)',
      dormantTitle: document.querySelector('#cameraDormantTitle')?.textContent.trim(),
      liveExchangeVisible: visible(document.querySelector('#recentMomentsCard.is-live-exchange')),
      visiblePrimaryTextInputs: [...document.querySelectorAll('[data-primary-view] input:is([type="text"], [type="search"]), [data-primary-view] textarea')].filter(visible).length,
      energyModeControlVisible: visible(document.querySelector('#microscopeEnergyMode')),
      cameraRectangular: cameraFrame.getBoundingClientRect().height >= Math.min(560, innerHeight * 0.57)
        && !getComputedStyle(cameraFrame).borderTopLeftRadius.endsWith('%')
        && Number.parseFloat(getComputedStyle(cameraFrame).borderTopLeftRadius) < cameraFrame.getBoundingClientRect().height * 0.25,
      cameraFrameWidth: Math.round(cameraFrame.getBoundingClientRect().width),
      cameraFrameHeight: Math.round(cameraFrame.getBoundingClientRect().height),
      cameraRadius: getComputedStyle(cameraFrame).borderTopLeftRadius,
      cameraAspect: getComputedStyle(cameraFrame).aspectRatio,
      cameraStageWidth: Math.round(camera.getBoundingClientRect().width),
      recentWidth: Math.round(recent.getBoundingClientRect().width),
      recentHeight: Math.round(recent.getBoundingClientRect().height),
      stageRailHeightDelta: Math.abs(cameraFrame.getBoundingClientRect().height - recent.getBoundingClientRect().height),
      cameraRegionShare: Number((camera.getBoundingClientRect().width / (camera.getBoundingClientRect().width + recent.getBoundingClientRect().width)).toFixed(3)),
      workspaceColumns: getComputedStyle(workspace).gridTemplateColumns,
      placements: [mode, camera, response, recent].map((element) => (element.id || element.className) + ':' + getComputedStyle(element).gridArea).join(', '),
      geometry: [mode, camera, response, recent].map((element) => {
        const rect = element.getBoundingClientRect();
        return (element.id || element.className) + '=' + [rect.left, rect.top, rect.right, rect.bottom].map(Math.round).join('/');
      }).join(', '),
      outsideCards: cards.filter((element) => !inside(element)).map((element) => element.id || element.className),
      clippedText,
      verticallyClippedText,
      desktopOrbit: getComputedStyle(workspace).display === 'grid' && getComputedStyle(workspace).gridTemplateColumns.split(' ').filter(Boolean).length === 2,
      cameraDominant: cameraFrame.getBoundingClientRect().width > Math.min(recent.getBoundingClientRect().width, 300) * 1.45,
      orbitPlacement: recent.getBoundingClientRect().left >= cameraFrame.getBoundingClientRect().right - 2
        && mode.getBoundingClientRect().bottom <= camera.getBoundingClientRect().top + 2
        && Math.abs((mode.getBoundingClientRect().left + mode.getBoundingClientRect().width / 2) - (camera.getBoundingClientRect().left + camera.getBoundingClientRect().width / 2)) <= 70
        && (!visible(response) || Math.abs((response.getBoundingClientRect().left + response.getBoundingClientRect().width / 2) - (camera.getBoundingClientRect().left + camera.getBoundingClientRect().width / 2)) <= 2),
      mobileOrder: mode.getBoundingClientRect().top < camera.getBoundingClientRect().top
        && camera.getBoundingClientRect().top < recent.getBoundingClientRect().top
        && (!visible(response) || (camera.getBoundingClientRect().top < response.getBoundingClientRect().top
          && response.getBoundingClientRect().top < recent.getBoundingClientRect().top)),
      tabletOrder: mode.getBoundingClientRect().top < camera.getBoundingClientRect().top
        && camera.getBoundingClientRect().top < recent.getBoundingClientRect().top
        && (!visible(response) || (camera.getBoundingClientRect().top < response.getBoundingClientRect().top
          && response.getBoundingClientRect().top < recent.getBoundingClientRect().top)),
      tabletExchange: recent.getBoundingClientRect().width >= Math.min(workspace.getBoundingClientRect().width, 880) * 0.9
        && recent.getBoundingClientRect().top >= camera.getBoundingClientRect().bottom - 2
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

async function waitForOpticalCore(client) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await client.evaluate("document.querySelector('.sf-camera-stage')?.dataset.perceptionCoreState || ''");
    if (state === "dormant") return;
    if (state === "fallback") {
      throw new Error(`Perception Core asset failed to initialize: ${client.consoleMessages().join(" | ")}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Perception Core asset did not become ready");
}

async function waitForEvaluation(client, expression, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}

async function waitForElapsed(client, startedAt, targetMs) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const elapsed = await client.evaluate(`performance.now() - ${Number(startedAt)}`);
    if (elapsed >= targetMs) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(20, Math.max(1, targetMs - elapsed))));
  }
  throw new Error(`Browser activation did not reach ${targetMs}ms`);
}

async function captureScreenshot(client, filename) {
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(captureRoot, filename), Buffer.from(screenshot.data, "base64"));
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
  const consoleMessages = [];
  const errorMessages = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params?.args || []).map((item) => item.value || item.description || "").join(" ");
      consoleMessages.push(text);
      if (message.params?.type === "error") errorMessages.push(text);
    }
    if (message.method === "Runtime.exceptionThrown") {
      errorMessages.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Uncaught runtime exception");
    }
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
    consoleMessages() {
      return [...consoleMessages];
    },
    errorMessages() {
      return [...errorMessages];
    },
    close() {
      socket.close();
    }
  };
}
