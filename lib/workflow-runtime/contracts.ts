import type { GuestSpace } from "../guest/spaces";

export type Kind = "image" | "video";
export type RunState = "queued" | "running" | "succeeded" | "failed" | "reconciliation_required";
export type StepState = "queued" | "submitting" | "pending" | "done" | "error" | "blocked" | "reconciliation_required";
export interface PlanInput { spaceId: string; outputNodeIds: string[]; overrides: Record<string, { prompt?: string; assetUrl?: string }>; providers: Record<string, "codex" | "kie">; }
export interface Approval { fingerprint: string; maxImages: number; maxVideos: number; maxVideoSeconds: number; allowPremium: boolean; allowPaid: boolean; acknowledgement: string; }
export interface Output { id: string; nodeId: string; kind: Kind; url: string; mimeType: string; }
export interface PlanStep { nodeId: string; kind: Kind; model: string; provider: "codex" | "kie"; dependsOn: string[]; payloadPreview: Record<string, unknown>; }
export interface Plan { planId: string; fingerprint: string; spaceId: string; spaceName: string; steps: PlanStep[]; warnings: string[]; expiresAt: string; }
export interface RunStep extends PlanStep { attempt: number; taskId: string | null; state: StepState; error: string | null; outputs: Output[]; creditBefore: number | null; creditAfter: number | null; }
export interface Run { runId: string; requestId: string; planId: string; fingerprint: string; spaceId: string; spaceName: string; state: RunState; createdAt: string; updatedAt: string; steps: RunStep[]; outputs: Output[]; }
export interface RuntimeError { code: string; message: string; nodeId?: string; }
export class WorkflowRuntimeError extends Error { readonly errors: RuntimeError[]; constructor(errors: RuntimeError[]) { super(errors.map(e => e.message).join("; ")); this.name = "WorkflowRuntimeError"; this.errors = errors; } }
export type WorkflowSnapshot = GuestSpace & { providers: PlanInput["providers"]; outputNodeIds: string[] };
