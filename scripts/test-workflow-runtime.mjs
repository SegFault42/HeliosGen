import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const required = [
  "lib/workflow-runtime/contracts.ts", "lib/workflow-runtime/compiler.ts",
  "lib/workflow-runtime/store.ts", "lib/workflow-runtime/runner.ts",
  "app/api/workflow-runtime/route.ts", "app/api/workflow-plans/route.ts",
  "app/api/workflow-runs/route.ts", "app/api/workflow-runs/[runId]/retry/route.ts",
];
const missing = required.filter(file => !existsSync(file));
if (missing.length) { console.error(`Missing workflow runtime files: ${missing.join(", ")}`); process.exit(1); }
const result = spawnSync("pnpm", ["exec", "tsc", "--noEmit"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
