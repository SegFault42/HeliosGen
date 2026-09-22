import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const required = [
  "lib/workflow-runtime/contracts.ts", "lib/workflow-runtime/compiler.ts",
  "lib/workflow-runtime/store.ts", "lib/workflow-runtime/runner.ts",
  "app/api/workflow-runtime/route.ts", "app/api/workflow-plans/route.ts",
  "app/api/workflow-runs/route.ts", "app/api/workflow-runs/[runId]/retry/route.ts",
  "lib/heygenMcp.ts", "lib/heygenJobPoller.ts", "app/api/heygen/status/route.ts",
];
const missing = required.filter(file => !existsSync(file));
if (missing.length) { console.error(`Missing workflow runtime files: ${missing.join(", ")}`); process.exit(1); }
const production = readFileSync("lib/workflow-runtime/productionTransport.ts", "utf8");
const runner = readFileSync("lib/workflow-runtime/runner.ts", "utf8");
const heygenRoute = readFileSync("app/api/generate-video/route.ts", "utf8");
const modelConfig = readFileSync("lib/modelConfig.ts", "utf8");
if (!modelConfig.includes("heygen-video-agent") || !heygenRoute.includes("submitHeyGenVideo")) { console.error("HeyGen provider is not wired into the video route"); process.exit(1); }
if (production.includes("Infinity") || !production.includes("/api/credit")) { console.error("Balance transport must be explicitly verified"); process.exit(1); }
if (!runner.includes("Number.isFinite(credit)") || !runner.includes("credit < 20")) { console.error("Runner must reject unknown/low Kie balance"); process.exit(1); }
const tscLocal = "node_modules/typescript/bin/tsc";
const result = existsSync(tscLocal)
  ? spawnSync(process.execPath, [tscLocal, "--noEmit"], { stdio: "inherit" })
  : spawnSync("pnpm", ["exec", "tsc", "--noEmit"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
