import type { Node } from "@xyflow/react";
import type { NodeData } from "../store";
import { resolveNodeInputs, buildImagePayload, buildVideoPayload } from "./generationPayloads";
import type { Approval, Run } from "./contracts";
import { createRuntimeStore } from "./store";
import type { GenerationTransport } from "./transport";
export function createRunner(store: ReturnType<typeof createRuntimeStore>, transport: GenerationTransport, _baseUrlOrBootId: string, bootId?: string) {
  const owner = bootId ?? _baseUrlOrBootId;
  let currentTick: Promise<void> | null = null;
  function tick(now = new Date()): Promise<void> {
    if (!currentTick) currentTick = advance(now).finally(() => { currentTick = null; });
    return currentTick;
  }
  async function advance(now: Date): Promise<void> {
    store.recoverInterrupted(owner, now); const runs = store.listRuns();
    for (const run of runs) {
      if (run.state === "succeeded" || run.state === "failed" || run.state === "reconciliation_required") continue;
      for (const step of run.steps) {
        if (step.state === "pending" && step.taskId) { const p = await transport.poll(step.taskId); if (p.state === "done") store.updateStep(run.runId, step.nodeId, { state:"done", outputs:p.outputs.map(o => ({...o, nodeId:step.nodeId})) }); else if (p.state === "error") store.updateStep(run.runId,step.nodeId,{state:"error",error:p.error??"Provider error"}); else if (p.state === "not_found") store.updateStep(run.runId,step.nodeId,{state:"reconciliation_required",error:"Task was not found; submission outcome is unknown"}); }
      }
      const fresh = store.getRun(run.runId); if (!fresh) continue;
      for (const step of fresh.steps.filter(s => s.state === "queued")) {
        const deps = fresh.steps.filter(d => step.dependsOn.includes(d.nodeId)); if (deps.some(d => d.state === "error" || d.state === "blocked" || d.state === "reconciliation_required")) { store.updateStep(fresh.runId,step.nodeId,{state:"blocked",error:"Dependency failed"}); continue; }
        if (deps.some(d => d.state !== "done")) continue;
        if (!store.claimStep(fresh.runId,step.nodeId,owner,now)) continue;
        try {
          // allowPaid authorizes Kie credit spend only. Native plan approval is
          // performed before createRun; these pinned routes use the owner's pools.
          const ownerPoolRoute = (step.provider === "flow" && ["flow-omni-flash", "flow-nano-banana-2"].includes(step.model)) ||
            (step.provider === "grok" && step.model === "grok-imagine");
          // HeyGen Video Agent spends the account's premium credits: keep it behind allowPaid.
          if (step.provider !== "codex" && !ownerPoolRoute) {
            const approval = (fresh as Run & { approval?: Approval }).approval;
            if (!approval?.allowPaid) throw new Error("paid_provider_not_approved");
            if (step.provider === "kie") {
              const credit = await transport.balance();
              if (!Number.isFinite(credit) || credit < 20) throw new Error("kie_balance_unavailable_or_below_minimum");
              store.updateStep(fresh.runId, step.nodeId, { creditBefore: credit });
            }
          }
          const p = store.getPlan(fresh.planId); if (!p) throw new Error("plan_not_found");
          const nodes = structuredClone(p.snapshot.nodes) as Node<NodeData>[];
          for (const completed of fresh.steps.filter(s => s.state === "done")) {
            const source = nodes.find(n => n.id === completed.nodeId);
            const output = completed.outputs[0];
            if (source && output) source.data = {...source.data, ...(output.kind === "image" ? {r2Url:output.url, imageUrl:output.url, capturedFrameUrl:undefined, inputImage:undefined} : {videoUrl:output.url, eagerStartFrameUrl:undefined, eagerEndFrameUrl:undefined, capturedFrameUrl:undefined})};
          } const edges = p.snapshot.edges as never[];
          const node = nodes.find(n => n.id === step.nodeId); if (!node) throw new Error("node_not_found");
          const inputs = resolveNodeInputs(step.nodeId,nodes,edges); const payload = step.kind === "image" ? buildImagePayload(node.data,inputs,step.provider === "codex" ? "codex" : "kie") : buildVideoPayload(node.data,inputs);
          const submitted = await transport.submit(step,payload); store.updateStep(fresh.runId,step.nodeId,{state:"pending",taskId:submitted.taskId});
        } catch (e) { store.updateStep(fresh.runId,step.nodeId,{state:"reconciliation_required",error:e instanceof Error?e.message:String(e)}); }
      }
      const end = store.getRun(run.runId); if (end) { if (end.steps.some(s=>s.state==="reconciliation_required")) end.state="reconciliation_required"; else if (end.steps.every(s=>s.state==="done")) { end.state="succeeded"; end.outputs=end.steps.flatMap(s=>s.outputs); } else if (end.steps.some(s=>s.state==="error")) end.state="failed"; else end.state="running"; end.updatedAt=now.toISOString(); store.saveRun(end); }
    }
  }
  return { tick, retry(runId:string,nodeId:string,requestId:string,approval:Approval,now=new Date()): Run { return store.retryStep(runId,nodeId,requestId,approval,now); } };
}
