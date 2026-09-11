import { randomUUID } from "node:crypto";
import { db } from "../guest/sqlite";
import { createRuntimeStore } from "./store";
import { createRunner } from "./runner";
import type { GenerationTransport } from "./transport";
const fallbackTransport: GenerationTransport = { async submit() { throw new Error("generation transport is not configured"); }, async poll() { return { state:"not_found", outputs:[] }; }, async balance() { return 0; } };
const key = Symbol.for("heliosgen.workflow-runtime");
export function runtime() { const g = globalThis as typeof globalThis & { [key]?: ReturnType<typeof createRuntimeStore> }; if (!g[key]) g[key] = createRuntimeStore(db()); return { store:g[key], runner:createRunner(g[key],fallbackTransport,process.env.WORKFLOW_BOOT_ID ?? randomUUID()) }; }
