import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const explicitModule = process.env.SENSEFIELD_NEURAL_FIELD_CONTRACT_MODULE;

test("production integration status is explicit and test contracts stay outside the production graph", async () => {
  const prototypeRoot = new URL("../../prototype/", import.meta.url);
  const [html, entry, controllerEntry] = await Promise.all([
    readFile(new URL("index.html", prototypeRoot), "utf8"),
    readFile(new URL("local-capture.js", prototypeRoot), "utf8"),
    readFile(new URL("neural-field/neural-field-controller.js", prototypeRoot), "utf8")
  ]);
  assert.doesNotMatch(`${html}\n${entry}`, /test\/neural-field|test-contract/i, "production entry points must not import test contracts");
  for (const marker of [
    "./perception/neural-field-perception.js",
    "./neural-field/neural-field-systems.js",
    "./neural-field/neural-field-controller.js",
    "mountNeuralField({",
    "createNeuralFieldHandWorker("
  ]) {
    assert.match(entry, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `production entry must wire ${marker}`);
  }
  assert.match(controllerEntry, /\.\/neural-field-renderer\.js/, "production controller must wire the Neural Field renderer");

  if (!explicitModule) {
    const moduleUrls = {
      systems: new URL("neural-field/neural-field-systems.js", prototypeRoot),
      perception: new URL("perception/neural-field-perception.js", prototypeRoot),
      controller: new URL("neural-field/neural-field-controller.js", prototypeRoot),
      renderer: new URL("neural-field/neural-field-renderer.js", prototypeRoot)
    };
    try {
      await Promise.all(Object.values(moduleUrls).map((url) => access(url)));
    } catch {
      process.stdout.write("NEURAL_FIELD_PRODUCTION_COMPONENT=UNAVAILABLE; EXECUTION_CONTRACT=EXPLICIT_TEST_ONLY\n");
      return;
    }
    const [systems, perception, controller, renderer] = await Promise.all([
      import(moduleUrls.systems.href),
      import(moduleUrls.perception.href),
      import(moduleUrls.controller.href),
      import(moduleUrls.renderer.href)
    ]);
    assert.equal(typeof systems.createNeuralFieldState, "function", "modular production runtime must expose state construction");
    assert.equal(typeof perception.createHandGeometryTracker, "function", "modular production runtime must expose hand geometry");
    assert.equal(typeof perception.createNeuralFieldPerceptionPipeline, "function", "modular production runtime must expose perception events");
    assert.equal(typeof controller.mountNeuralField, "function", "modular production runtime must expose the controller");
    assert.equal(typeof renderer.createNeuralFieldRenderer, "function", "modular production runtime must expose the renderer");
    const state = systems.createNeuralFieldState();
    assert.equal(state.status, "inactive");
    const tracker = perception.createHandGeometryTracker();
    const pipeline = perception.createNeuralFieldPerceptionPipeline();
    assert.equal(typeof tracker.process, "function");
    assert.equal(typeof pipeline.processFrame, "function");
    tracker.dispose();
    pipeline.reset("contract_probe", 0);
    process.stdout.write("NEURAL_FIELD_PRODUCTION_COMPONENT=AVAILABLE; CONTRACT_MODULE=MODULAR_PRODUCTION_RUNTIME\n");
    return;
  }

  const modulePath = resolve(explicitModule);
  await access(modulePath);
  const integrated = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof integrated.createNeuralFieldRuntime, "function", "integrated contract must export createNeuralFieldRuntime");
  process.stdout.write(`NEURAL_FIELD_PRODUCTION_COMPONENT=AVAILABLE; CONTRACT_MODULE=${modulePath}\n`);
});
