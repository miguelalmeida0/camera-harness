import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const script = resolve("packages/replay/live-trace-recorder/scripts/export-physical-trace.mjs");
const [inputArg, outputArg, confirmationArg] = process.argv.slice(2);
const args = [
  script,
  ...(inputArg ? ["--input", inputArg] : []),
  ...(outputArg ? ["--output", outputArg] : []),
  ...(confirmationArg === "--operator-confirmed" ? ["--operator-confirmed"] : [])
];

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
