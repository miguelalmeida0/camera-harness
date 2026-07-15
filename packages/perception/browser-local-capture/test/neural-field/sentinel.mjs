import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const outputDir = resolve("test-results/neural-field");
mkdirSync(outputDir, { recursive: true });

const explicitContract = process.env.SENSEFIELD_NEURAL_FIELD_CONTRACT_MODULE
  ? resolve(process.env.SENSEFIELD_NEURAL_FIELD_CONTRACT_MODULE)
  : null;
const knownProductionModules = [
  "packages/perception/browser-local-capture/prototype/neural-field.js",
  "packages/perception/browser-local-capture/prototype/neural-field-runtime.js"
].map((modulePath) => resolve(modulePath));
const discoveredContract = explicitContract || knownProductionModules.find(existsSync) || null;
const productionStatus = discoveredContract && existsSync(discoveredContract) ? "AVAILABLE" : "UNAVAILABLE";
const availableContract = productionStatus === "AVAILABLE" ? discoveredContract : null;
const explicitContractMissing = Boolean(explicitContract && !existsSync(explicitContract));
const contractLabel = availableContract ? safeContractLabel(availableContract) : "EXPLICIT_TEST_ONLY";

process.stdout.write(`NEURAL_FIELD_PRODUCTION_COMPONENT=${productionStatus}\n`);
process.stdout.write(`NEURAL_FIELD_EXECUTION_CONTRACT=${contractLabel}\n`);
if (explicitContractMissing) process.stdout.write("NEURAL_FIELD_CONTRACT_CONFIGURATION=INVALID_EXPLICIT_PATH\n");

const stages = [
  ["contract tests", "test:neural-field:contracts"],
  ["perception fixtures", "test:neural-field:fixtures"],
  ["renderer tests", "test:neural-field:renderer"],
  ["browser E2E", "test:neural-field:e2e"],
  ["visual regression", "test:neural-field:visual"],
  ["performance benchmark", "benchmark:neural-field"],
  ["race and chaos", "test:neural-field:chaos"],
  ["privacy checks", "test:neural-field:privacy"],
  ["leak test", "test:neural-field:leak"],
  ["replay safety", "test:neural-field:replay"],
  ["existing: voice latency", "test:voice-latency"],
  ["existing: single voice", "test:single-voice"],
  ["existing: spatial engine", "test:spatial-engine"],
  ["existing: spatial smoke", "spatial:smoke"],
  ["existing: spatial experience", "test:spatial-experience"],
  ["existing: core lifecycle", "test:core-lifecycle"],
  ["existing: live runtime", "test:p0-live-runtime"],
  ["existing: dual mode", "test:dual-mode"],
  ["existing: premium redesign", "test:premium-redesign"],
  ["existing: visual companion", "test:visual-companion"],
  ["existing: movement recognition", "test:movement-recognition"],
  ["existing: voice suite", "voice:test"],
  ["existing: typecheck", "typecheck"]
];

const results = explicitContractMissing
  ? [{ label: "explicit integrated contract", status: 1, signal: null, reason: "configured_contract_unavailable" }]
  : [];
for (const [label, script] of stages) {
  process.stdout.write(`\n[neural-field sentinel] ${label}\n`);
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SENSEFIELD_NEURAL_FIELD_TEST: "1",
      ...(availableContract ? { SENSEFIELD_NEURAL_FIELD_CONTRACT_MODULE: availableContract } : {})
    },
    stdio: "inherit"
  });
  results.push({ label, script, status: result.status ?? 1, signal: result.signal || null });
}

process.stdout.write("\n[neural-field sentinel] git diff --check\n");
const diff = spawnSync("git", ["diff", "--check"], { cwd: process.cwd(), stdio: "inherit" });
results.push({ label: "existing: git diff check", command: "git diff --check", status: diff.status ?? 1, signal: diff.signal || null });

const summary = {
  schema_version: "sensefield.neural-field.sentinel.v1",
  production_component: productionStatus,
  execution_contract: contractLabel,
  contract_configuration: explicitContractMissing ? "INVALID_EXPLICIT_PATH" : "VALID",
  passed: results.every((result) => result.status === 0),
  results
};
writeFileSync(resolve(outputDir, "sentinel-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`\nNEURAL_FIELD_SENTINEL=${summary.passed ? "PASS" : "FAIL"}\n`);
if (!summary.passed) process.exitCode = 1;

function safeContractLabel(contractPath) {
  const repositoryRelative = relative(process.cwd(), contractPath);
  if (repositoryRelative && !repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative)) return repositoryRelative;
  return `[external]/${basename(contractPath)}`;
}
