import { test, expect } from "./support/safe-test.mjs";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4178") return route.continue();
    return route.abort("blockedbyclient");
  });
  await page.goto("./");
  await expect.poll(() => page.evaluate(() => window.__NEURAL_FIELD_TEST__?.ready)).toBe(true);
});

test("AirScript follows hand events through stroke stabilization and returns to Ask", async ({ page }) => {
  await expect(page.locator("#home-title")).toHaveText("Ask");
  await page.getByRole("button", { name: "Enter Neural Field" }).click();
  await page.getByRole("button", { name: "AirScript", exact: true }).click();

  await feed(page, "slow_circle");

  const live = page.locator("#active-trajectory");
  await expect(live).toBeVisible();
  expect(pointCount(await live.getAttribute("points"))).toBeGreaterThan(20);
  let state = await snapshot(page);
  expect(state.active).toBe(true);
  expect(state.tool).toBe("airscript");
  expect(state.stroke?.points?.length).toBeGreaterThan(20);

  await feed(page, "release");

  await expect(page.locator("#stable-trajectory")).toBeVisible();
  await expect(page.locator("#classification-chip")).toBeVisible();
  await expect(page.locator("#classification-value")).toHaveText(/circle/i);
  state = await snapshot(page);
  expect(classificationLabel(state)).toMatch(/circle/i);
  expect(state.stroke?.status).toMatch(/stable|complete|classified|committed/i);

  const diagnostics = await browserDiagnostics(page);
  expect(diagnostics.events.map((entry) => entry.type).join(" ")).toMatch(/pinch/i);
  expect(diagnostics.events.map((entry) => entry.type).join(" ")).toMatch(/stroke/i);
  expect(diagnostics.renders.map((entry) => entry.type).join(" ")).toMatch(/stroke|trajectory|classification/i);
  expect(diagnostics.renders.length).toBeGreaterThan(2);
  expect(diagnostics.fixtures).toEqual(expect.arrayContaining(["slow_circle", "release"]));
  expect(Number(diagnostics.resources.semanticRequests || diagnostics.resources.semanticRequestCount || 0)).toBe(0);

  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(page.locator("#home-view")).toBeVisible();
  await expect(page.locator("#home-title")).toHaveText("Ask");
  await expect(page.locator("#neural-field-view")).toBeHidden();
  expect((await snapshot(page)).active).toBe(false);
});

test("Spatial Lasso grounds objects, updates left_of, clears loss, and returns to Watch", async ({ page }) => {
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await page.getByRole("button", { name: "Enter Neural Field" }).click();
  await page.getByRole("button", { name: "Spatial Lasso", exact: true }).click();
  await call(page, "setScene", "mug_left_of_laptop");

  await expect(page.locator('.scene-object[data-object-label="mug"]')).toBeVisible();
  await expect(page.locator('.scene-object[data-object-label="laptop"]')).toBeVisible();

  await feed(page, "valid_lasso_around_one_object", { aroundObject: "mug" });
  let state = await snapshot(page);
  expect(selectedLabel(state, state.selection?.anchorId)).toBe("mug");
  await expect(page.locator('[data-selection-id="mug"]')).toBeVisible();

  await feed(page, "valid_lasso_around_one_object", { aroundObject: "laptop" });
  state = await snapshot(page);
  expect(selectedLabel(state, state.selection?.targetId)).toBe("laptop");
  expect(state.relations.some((relation) => relation.type === "left_of")).toBe(true);
  const connector = page.locator('.relation-connector[data-relation="left_of"]');
  await expect(connector).toBeVisible();
  const beforeMove = await connector.locator("line").evaluate((line) => ({
    x1: line.getAttribute("x1"),
    y1: line.getAttribute("y1"),
    x2: line.getAttribute("x2"),
    y2: line.getAttribute("y2")
  }));

  const mug = state.objects.find((object) => object.label === "mug");
  await call(page, "moveObject", mug.id, { bbox: { ...mug.bbox, x: mug.bbox.x + 0.1 } });
  await expect.poll(async () => connector.locator("line").getAttribute("x1")).not.toBe(beforeMove.x1);
  expect((await snapshot(page)).relations.some((relation) => relation.type === "left_of")).toBe(true);

  await call(page, "moveObject", mug.id, {
    bbox: { ...mug.bbox, x: 1.08 },
    tracking: "out_of_frame",
    confidence: 0
  });
  await expect(connector).toHaveCount(0);
  state = await snapshot(page);
  expect(state.selection?.anchorId ?? null).toBeNull();
  expect(state.relations.filter((relation) => !/lost|cleared|stale/i.test(relation.status || "")).length).toBe(0);
  await expect(page.locator("#step-title")).toHaveText(/tracking lost|anchor cleared/i);

  const diagnostics = await browserDiagnostics(page);
  expect(diagnostics.events.map((entry) => entry.type).join(" ")).toMatch(/lasso/i);
  expect(diagnostics.events.map((entry) => entry.type).join(" ")).toMatch(/ground|selection|anchor/i);
  expect(diagnostics.renders.map((entry) => entry.type).join(" ")).toMatch(/relation|connector/i);
  expect(diagnostics.fixtures).toEqual(expect.arrayContaining(["mug_left_of_laptop", "valid_lasso_around_one_object"]));
  expect(Number(diagnostics.resources.semanticRequests || diagnostics.resources.semanticRequestCount || 0)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(page.locator("#home-title")).toHaveText("Watch");
  await expect(page.locator("#home-view")).toBeVisible();
  expect((await snapshot(page)).active).toBe(false);
});

async function feed(page, fixtureId, options = {}) {
  return page.evaluate(({ fixtureId: id, options: feedOptions }) => {
    return window.__NEURAL_FIELD_TEST__.feedLandmarkFixture(id, feedOptions);
  }, { fixtureId, options });
}

async function call(page, method, ...args) {
  return page.evaluate(({ method: methodName, args: values }) => {
    return window.__NEURAL_FIELD_TEST__[methodName](...values);
  }, { method, args });
}

async function snapshot(page) {
  return page.evaluate(() => window.__NEURAL_FIELD_TEST__.snapshot());
}

async function browserDiagnostics(page) {
  return page.evaluate(() => ({
    events: window.__NEURAL_FIELD_TEST__.getEventTimeline(),
    renders: window.__NEURAL_FIELD_TEST__.getRenderTimeline(),
    resources: window.__NEURAL_FIELD_TEST__.getResourceSnapshot(),
    fixtures: window.__NEURAL_FIELD_TEST__.getFixtureIds(),
    metrics: window.__NEURAL_FIELD_TEST__.getMetrics()
  }));
}

function classificationLabel(state) {
  const classification = state.stroke?.classification || state.classification;
  return typeof classification === "string" ? classification : classification?.label || classification?.type || "";
}

function selectedLabel(state, id) {
  return state.objects?.find((object) => object.id === id)?.label || "";
}

function pointCount(points) {
  return String(points || "").trim().split(/\s+/).filter(Boolean).length;
}
