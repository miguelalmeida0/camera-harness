import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const outputRoot = process.env.NEURAL_FIELD_ARTIFACT_DIR
  || resolve(repositoryRoot, "test-results/neural-field/playwright");
const chromeExecutable = process.env.PLAYWRIGHT_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.(e2e|visual)\.spec\.mjs/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.012,
      threshold: 0.22
    }
  },
  outputDir: `${outputRoot}/results`,
  reporter: [
    ["line"],
    ["html", { outputFolder: `${outputRoot}/report`, open: "never" }]
  ],
  snapshotPathTemplate: "{testDir}/snapshots/{projectName}/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:4178/neural-field/harness/",
    browserName: "chromium",
    colorScheme: "dark",
    headless: true,
    reducedMotion: "no-preference",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: chromeExecutable,
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--enable-precise-memory-info"]
    }
  },
  webServer: {
    command: "node support/static-server.mjs",
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    port: 4178,
    reuseExistingServer: false,
    timeout: 10_000
  }
});
