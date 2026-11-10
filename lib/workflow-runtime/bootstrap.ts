import { randomUUID } from "node:crypto";
import { db } from "../guest/sqlite";
import { createRuntimeStore } from "./store";
import { createRunner } from "./runner";
import { createProductionTransport } from "./productionTransport";
const key = Symbol.for("heliosgen.workflow-runtime-v2");
type Runtime = { store: ReturnType<typeof createRuntimeStore>; runner: ReturnType<typeof createRunner> };
export function runtime() {
  const g = globalThis as typeof globalThis & { [key]?: Runtime };
  if (!g[key]) {
    const store = createRuntimeStore(db());
    const baseUrl = process.env.ANVIL_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
    g[key] = { store, runner: createRunner(store, createProductionTransport(baseUrl), process.env.WORKFLOW_BOOT_ID ?? randomUUID()) };
  }
  return g[key]!;
}
