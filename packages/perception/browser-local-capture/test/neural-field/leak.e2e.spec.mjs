import { test, expect } from "./support/safe-test.mjs";

test("25 Ask-AirScript-Watch-Spatial Lasso cycles remain bounded and clear old overlays", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4178") return route.continue();
    return route.abort("blockedbyclient");
  });
  await page.goto("./");
  await expect.poll(() => page.evaluate(() => window.__NEURAL_FIELD_TEST__?.ready)).toBe(true);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const samples = [await resourceSample(page, -1, "baseline")];
  for (let cycle = 0; cycle < 25; cycle += 1) {
    await expect(page.locator("#home-title")).toHaveText("Ask");
    await page.getByRole("button", { name: "Enter Neural Field" }).click();
    await page.getByRole("button", { name: "AirScript", exact: true }).click();
    await assertNoOldOverlay(page);
    await feed(page, "slow_circle");
    await feed(page, "release");
    samples.push(await resourceSample(page, cycle, "airscript_active"));
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    samples.push(await resourceSample(page, cycle, "airscript_exit"));

    await page.getByRole("button", { name: "Watch", exact: true }).click();
    await page.getByRole("button", { name: "Enter Neural Field" }).click();
    await page.getByRole("button", { name: "Spatial Lasso", exact: true }).click();
    await assertNoOldOverlay(page);
    await call(page, "setScene", "mug_left_of_laptop");
    await feed(page, "valid_lasso_around_one_object", { aroundObject: "mug" });
    await feed(page, "valid_lasso_around_one_object", { aroundObject: "laptop" });
    samples.push(await resourceSample(page, cycle, "spatial_lasso_active"));
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    samples.push(await resourceSample(page, cycle, "spatial_lasso_exit"));

    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator("#home-title")).toHaveText("Ask");
    await expect(page.locator("#neural-field-view")).toBeHidden();
    await expect(page.locator("#active-trajectory")).toBeHidden();
    await expect(page.locator("#stable-trajectory")).toBeHidden();
    await expect(page.locator(".relation-connector")).toHaveCount(0);
    await expect(page.locator(".scene-object")).toHaveCount(0);
    expect((await snapshot(page)).active).toBe(false);
    await cdp.send("HeapProfiler.collectGarbage");
    samples.push(await resourceSample(page, cycle, "cycle_complete"));
  }

  const activeSamples = samples.filter((sample) => /active$/.test(sample.phase));
  const exitSamples = samples.filter((sample) => /exit$|complete$/.test(sample.phase));
  for (const sample of samples) {
    expect(sample.activeWorkers, `${sample.phase}: duplicate worker`).toBeLessThanOrEqual(1);
    expect(sample.animationFrames, `${sample.phase}: duplicate animation frame`).toBeLessThanOrEqual(1);
    expect(sample.mediaTracks, `${sample.phase}: duplicate media track`).toBeLessThanOrEqual(1);
    expect(sample.mediaStreams, `${sample.phase}: duplicate media stream`).toBeLessThanOrEqual(1);
    expect(sample.canvases, `${sample.phase}: duplicate canvas`).toBeLessThanOrEqual(1);
    expect(sample.objectUrls, `${sample.phase}: object URL leaked`).toBe(0);
    expect(sample.audioElements, `${sample.phase}: audio element leaked`).toBe(0);
    expect(sample.semanticRequests, `${sample.phase}: drawing triggered semantic request`).toBe(0);
    expect(sample.strokeObjects, `${sample.phase}: stroke objects unbounded`).toBeLessThanOrEqual(2);
    expect(sample.relationObjects, `${sample.phase}: relation objects unbounded`).toBeLessThanOrEqual(2);
  }
  expect(range(samples, "eventListeners")).toBeLessThanOrEqual(2);
  expect(range(samples, "rendererResources")).toBeLessThanOrEqual(1);
  expect(Math.max(...activeSamples.map((sample) => sample.strokeObjects))).toBeLessThanOrEqual(2);
  expect(exitSamples.every((sample) => sample.strokeObjects === 0 && sample.relationObjects === 0)).toBe(true);

  const heaps = samples.map((sample) => sample.jsHeapBytes).filter(Number.isFinite);
  expect(heaps.length).toBeGreaterThan(0);
  expect(heaps.at(-1) - heaps[0], "25-cycle JS heap growth exceeded the bounded allowance").toBeLessThan(32 * 1024 * 1024);

  await testInfo.attach("leak-cycle-metrics", {
    body: Buffer.from(JSON.stringify({ cycles: 25, samples, heapGrowthBytes: heaps.at(-1) - heaps[0] }, null, 2)),
    contentType: "application/json"
  });
});

async function assertNoOldOverlay(page) {
  await expect(page.locator("#active-trajectory")).toBeHidden();
  await expect(page.locator("#stable-trajectory")).toBeHidden();
  await expect(page.locator(".relation-connector")).toHaveCount(0);
}

async function feed(page, fixtureId, options = {}) {
  return call(page, "feedLandmarkFixture", fixtureId, options);
}

async function call(page, method, ...args) {
  return page.evaluate(({ method: methodName, args: values }) => {
    return window.__NEURAL_FIELD_TEST__[methodName](...values);
  }, { method, args });
}

async function snapshot(page) {
  return page.evaluate(() => window.__NEURAL_FIELD_TEST__.snapshot());
}

async function resourceSample(page, cycle, phase) {
  const resources = await page.evaluate(() => window.__NEURAL_FIELD_TEST__.getResourceSnapshot());
  return {
    cycle,
    phase,
    activeWorkers: pick(resources, "activeWorkers", "workers", "workerCount"),
    animationFrames: pick(resources, "activeAnimationFrames", "animationFrames", "rafCount"),
    eventListeners: pick(resources, "eventListeners", "listenerCount") + pick(resources, "domEventListeners"),
    mediaTracks: Math.max(pick(resources, "mediaTracks", "activeMediaTracks"), pick(resources, "liveMediaTracks")),
    mediaStreams: pick(resources, "activeMediaStreams", "mediaStreams", "streamCount"),
    canvases: Math.max(pick(resources, "canvases", "canvasCount"), pick(resources, "domCanvases")),
    rendererResources: pick(resources, "rendererResources", "rendererResourceCount", "renderers"),
    objectUrls: pick(resources, "objectUrls", "activeObjectUrls"),
    audioElements: Math.max(pick(resources, "audioElements"), pick(resources, "domAudioElements")),
    semanticRequests: pick(resources, "semanticRequests", "semanticRequestCount"),
    strokeObjects: pick(resources, "strokeObjects"),
    relationObjects: pick(resources, "relationObjects"),
    jsHeapBytes: Number.isFinite(resources.jsHeapBytes) ? resources.jsHeapBytes : null
  };
}

function pick(object, ...keys) {
  for (const key of keys) if (Number.isFinite(Number(object?.[key]))) return Number(object[key]);
  return 0;
}

function range(samples, key) {
  const values = samples.map((sample) => sample[key]);
  return Math.max(...values) - Math.min(...values);
}
