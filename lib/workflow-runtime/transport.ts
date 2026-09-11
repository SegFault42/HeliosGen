import type { Output, PlanStep } from "./contracts";
export interface GenerationTransport { submit(step: PlanStep, payload: Record<string, unknown>): Promise<{ taskId: string }>; poll(taskId: string): Promise<{ state: "pending"|"done"|"error"|"not_found"; outputs: Output[]; error?: string }>; balance(): Promise<number>; }
