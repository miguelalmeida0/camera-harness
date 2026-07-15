import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const explicitModule = process.env.SENSEFIELD_NEURAL_FIELD_CONTRACT_MODULE;

test("production integration status is explicit and test contracts stay outside the production graph", async () => {
  const prototypeRoot = new URL("../../prototype/", import.meta.url);
  const [html, entry] = await Promise.all([
    readFile(new URL("index.html", prototypeRoot), "utf8"),
    readFile(new URL("local-capture.js", prototypeRoot), "utf8")
  ]);
  assert.doesNotMatch(`${html}\n${entry}`, /test\/neural-field|test-contract/i, "production entry points must not import test contracts");

  if (!explicitModule) {
    process.stdout.write("NEURAL_FIELD_PRODUCTION_COMPONENT=UNAVAILABLE; EXECUTION_CONTRACT=EXPLICIT_TEST_ONLY\n");
    return;
  }

  const modulePath = resolve(explicitModule);
  await access(modulePath);
  const integrated = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof integrated.createNeuralFieldRuntime, "function", "integrated contract must export createNeuralFieldRuntime");
  process.stdout.write(`NEURAL_FIELD_PRODUCTION_COMPONENT=AVAILABLE; CONTRACT_MODULE=${modulePath}\n`);
});
