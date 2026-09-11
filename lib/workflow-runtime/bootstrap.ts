import { randomUUID } from "node:crypto";
import { db } from "../guest/sqlite";
import { createRuntimeStore } from "./store";
import { createRunner } from "./runner";
import { createProductionTransport } from "./productionTransport";
const key = Symbol.for("heliosgen.workflow-runtime");
export function runtime() { const g = globalThis as typeof globalThis & { [key]?: ReturnType<typeof createRuntimeStore> }; if (!g[key]) g[key] = createRuntimeStore(db()); return { store:g[key], runner:createRunner(g[key],createProductionTransport(),process.env.ANVIL_URL ?? "http://127.0.0.1:3000",process.env.WORKFLOW_BOOT_ID ?? randomUUID()) }; }
