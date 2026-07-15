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

test("AirScript visual states retain live, stable, classified, and uncertain trajectories", async ({ page }) => {
  await enterTool(page, "ask", "airscript");
  await feed(page, "slow_circle", { end: -5 });
  await expect(page.locator("#active-trajectory")).toBeVisible();
  await assertVisualIntegrity(page);
  await expect(page.locator("#app")).toHaveScreenshot("airscript-live-stroke.png");

  await feed(page, "slow_circle", { start: -5 });
  await feed(page, "release");
  await expect(page.locator("#stable-trajectory")).toBeVisible();
  await assertVisualIntegrity(page);
  await expect(page.locator("#app")).toHaveScreenshot("airscript-stabilized-stroke.png");
  await expect(page.locator("#classification-value")).toHaveText(/circle/i);
  await expect(page.locator("#app")).toHaveScreenshot("airscript-recognized-circle.png");

  await resetTool(page, "ask", "airscript");
  await feed(page, "jitter");
  await feed(page, "release");
  await expect(page.locator("#classification-value")).toHaveText(/uncertain|freeform/i);
  await expect(page.locator("#uncertainty-chip")).toBeVisible();
  await assertVisualIntegrity(page);
  await expect(page.locator("#app")).toHaveScreenshot("airscript-uncertain-freeform.png");
});

test("Spatial Lasso visual states retain selection, relation, ambiguity, and tracking status", async ({ page }) => {
  await enterTool(page, "watch", "spatial_lasso");
  await call(page, "setScene", "mug_left_of_laptop");
  await feed(page, "valid_lasso_around_one_object", { end: -1, aroundObject: "mug" });
  await expect(page.locator("#active-trajectory")).toBeVisible();
  await assertVisualIntegrity(page);
  await expect(page.locator("#app")).toHaveScreenshot("spatial-lasso-active.png");

  await feed(page, "release", { aroundObject: "mug" });
  await expect(page.locator('[data-selection-id="mug"]')).toBeVisible();
  await expect(page.locator("#app")).toHaveScreenshot("spatial-lasso-grounded-object.png");

  await feed(page, "valid_lasso_around_one_object", { aroundObject: "laptop" });
  await expect(page.locator('.relation-connector[data-relation="left_of"]')).toBeVisible();
  await assertVisualIntegrity(page);
  await expect(page.locator("#app")).toHaveScreenshot("spatial-lasso-relation-connector.png");

  const mug = await objectByLabel(page, "mug");
  await call(page, "moveObject", mug.id, { tracking: "uncertain", confidence: 0.42 });
  await expect(page.locator('.scene-object[data-object-label="mug"]')).toHaveAttribute("data-tracking", "uncertain");
  await expect(page.locator("#app")).toHaveScreenshot("spatial-lasso-tracking-uncertainty.png");

  await call(page, "moveObject", mug.id, { bbox: { ...mug.bbox, x: 1.08 }, tracking: "lost", confidence: 0 });
  await expect(page.locator('.relation-connector[data-relation="left_of"]')).toHaveCount(0);
  await expect(page.locator("#app")).toHaveScreenshot("spatial-lasso-tracking-loss.png");

  await resetTool(page, "watch", "spatial_lasso");
  await call(page, "setScene", "ambiguous_lasso_region");
  await feed(page, "valid_lasso_around_two_objects");
  await expect(page.locator("#uncertainty-chip")).toBeVisible();
  await expect(page.locator("#step-title")).toHaveText(/manual confirmation|selection/i);
  await assertVisualIntegrity(page);
  await expect(page.locator("#app")).toHaveScreenshot("spatial-lasso-ambiguous-selection.png");
});

test("desktop, tablet, mobile, and reduced-motion layouts preserve the proof surface", async ({ page }) => {
  await enterTool(page, "watch", "spatial_lasso");
  await call(page, "setScene", "mug_left_of_laptop");
  await feed(page, "valid_lasso_around_one_object", { aroundObject: "mug" });
  await feed(page, "valid_lasso_around_one_object", { aroundObject: "laptop" });
  await expect(page.locator('.relation-connector[data-relation="left_of"]')).toBeVisible();

  for (const layout of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 820, height: 1180 },
    { name: "mobile", width: 390, height: 844 }
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await assertVisualIntegrity(page);
    await expect(page.locator("#app")).toHaveScreenshot(`neural-field-${layout.name}.png`, {
      maxDiffPixelRatio: layout.name === "mobile" ? 0.016 : 0.012
    });
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await assertVisualIntegrity(page);
  expect(await page.locator("#active-trajectory").evaluate((node) => getComputedStyle(node).animationDuration)).toBe("0s");
  await expect(page.locator("#app")).toHaveScreenshot("neural-field-reduced-motion.png");
});

test("labels remain outside the synthetic central face region", async ({ page }) => {
  await enterTool(page, "watch", "spatial_lasso");
  await call(page, "setScene", "face_in_central_region");
  const collisions = await page.evaluate(() => {
    const face = document.querySelector(".face-safe-box")?.getBoundingClientRect();
    if (!face) return ["face region missing"];
    return [...document.querySelectorAll(".object-label-backdrop")]
      .filter((label) => intersects(face, label.getBoundingClientRect()))
      .map((label) => label.parentElement?.dataset.objectLabel || "object");

    function intersects(a, b) {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }
  });
  expect(collisions).toEqual([]);
  await assertVisualIntegrity(page);
});

async function enterTool(page, returnMode, tool) {
  if (returnMode === "watch") await page.getByRole("button", { name: "Watch", exact: true }).click();
  await page.getByRole("button", { name: "Enter Neural Field" }).click();
  await page.getByRole("button", { name: tool === "airscript" ? "AirScript" : "Spatial Lasso", exact: true }).click();
}

async function resetTool(page, returnMode, tool) {
  await call(page, "exit", returnMode);
  await call(page, "enter", returnMode);
  await call(page, "selectTool", tool);
}

async function feed(page, fixtureId, options = {}) {
  return call(page, "feedLandmarkFixture", fixtureId, options);
}

async function call(page, method, ...args) {
  return page.evaluate(({ method: methodName, args: values }) => {
    return window.__NEURAL_FIELD_TEST__[methodName](...values);
  }, { method, args });
}

async function objectByLabel(page, label) {
  return page.evaluate((objectLabel) => {
    return window.__NEURAL_FIELD_TEST__.snapshot().objects.find((object) => object.label === objectLabel);
  }, label);
}

async function assertVisualIntegrity(page) {
  const result = await page.evaluate(() => {
    const stage = document.querySelector("#field-stage").getBoundingClientRect();
    const modeControls = [...document.querySelectorAll("#tool-controls button")];
    const labels = [...document.querySelectorAll(".object-label-backdrop,.relation-label-backdrop")]
      .map((node) => node.getBoundingClientRect());
    const boxes = [...document.querySelectorAll(".object-box")].map((node) => ({
      width: Number(node.getAttribute("width")),
      height: Number(node.getAttribute("height"))
    }));
    const textContainers = [...document.querySelectorAll("button,.test-only-badge,.manual-confirmation,.state-summary dd")];
    return {
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      controlsVisible: modeControls.every((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
      labelOffscreen: labels.some((label) => label.left < stage.left - 1 || label.right > stage.right + 1 || label.top < stage.top - 1 || label.bottom > stage.bottom + 1),
      giantBox: boxes.some((box) => box.width > 850 || box.height > 520),
      crushedText: textContainers.some((node) => node.scrollWidth > node.clientWidth + 2),
      cameraVisible: stage.width > 180 && stage.height > 160,
      stepVisible: document.querySelector(".step-card").getBoundingClientRect().height > 0,
      manualConfirmationVisible: document.querySelector("#manual-confirmation").getBoundingClientRect().height > 0,
      developerToolsClosed: document.querySelector("#developer-tools").open === false
    };
  });
  expect(result).toEqual({
    horizontalOverflow: false,
    controlsVisible: true,
    labelOffscreen: false,
    giantBox: false,
    crushedText: false,
    cameraVisible: true,
    stepVisible: true,
    manualConfirmationVisible: true,
    developerToolsClosed: true
  });
}
