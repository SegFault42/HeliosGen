import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Approval, Plan, Run, RunStep, WorkflowSnapshot } from "./contracts";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function createRuntimeStore(database: DatabaseSync) {
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS workflow_plans(plan_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,snapshot_json TEXT NOT NULL,plan_json TEXT NOT NULL,expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_runs(run_id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,request_hash TEXT NOT NULL,plan_id TEXT NOT NULL,run_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_attempts(run_id TEXT,node_id TEXT,attempt INTEGER,task_id TEXT,state TEXT,json TEXT,PRIMARY KEY(run_id,node_id,attempt));
    CREATE TABLE IF NOT EXISTS workflow_lease(id INTEGER PRIMARY KEY CHECK(id=1),boot_id TEXT NOT NULL,heartbeat_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_retry_requests(request_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,node_id TEXT NOT NULL,body_hash TEXT NOT NULL,accepted_at TEXT NOT NULL);`);
  const save = (run: Run) => database.prepare("UPDATE workflow_runs SET run_json=? WHERE run_id=?").run(JSON.stringify(run), run.runId);
  const getRun = (runId: string): Run | null => { const r = database.prepare("SELECT run_json FROM workflow_runs WHERE run_id=?").get(runId) as {run_json:string}|undefined; return r ? JSON.parse(r.run_json) : null; };
  return {
    putPlan(plan: Plan, snapshot: WorkflowSnapshot) { database.prepare("INSERT OR REPLACE INTO workflow_plans VALUES(?,?,?,?,?)").run(plan.planId, plan.fingerprint, JSON.stringify(snapshot), JSON.stringify(plan), plan.expiresAt); },
    getPlan(planId: string) { const r = database.prepare("SELECT plan_json,snapshot_json FROM workflow_plans WHERE plan_id=?").get(planId) as {plan_json:string;snapshot_json:string}|undefined; return r ? { plan: JSON.parse(r.plan_json) as Plan, snapshot: JSON.parse(r.snapshot_json) as WorkflowSnapshot } : null; },
    createRun(planId: string, requestId: string, approval: Approval, now: Date): Run {
      const p = this.getPlan(planId); if (!p) throw new Error("plan_not_found");
      if (approval.fingerprint !== p.plan.fingerprint) throw new Error("fingerprint_mismatch");
      for (const [k, v] of Object.entries({maxImages:approval.maxImages,maxVideos:approval.maxVideos,maxVideoSeconds:approval.maxVideoSeconds})) if (!Number.isInteger(v) || v < 0) throw new Error(`${k}_invalid`);
      if (!approval.acknowledgement?.trim()) throw new Error("acknowledgement_required");
      const imageCount=p.plan.steps.filter(s=>s.kind==="image").length, videoSteps=p.plan.steps.filter(s=>s.kind==="video");
      if (imageCount > approval.maxImages || videoSteps.length > approval.maxVideos || videoSteps.some(s=>Number((s.payloadPreview.duration as number) ?? 0)>approval.maxVideoSeconds)) throw new Error("approval_limits_exceeded");
      const requestHash = hash({ planId, approval }); const old = database.prepare("SELECT run_json,request_hash FROM workflow_runs WHERE request_id=?").get(requestId) as {run_json:string;request_hash:string}|undefined;
      if (old) { if (old.request_hash !== requestHash) throw new Error("request_conflict"); return JSON.parse(old.run_json); }
      const runId = randomUUID(); const ts = now.toISOString();
      const steps: RunStep[] = p.plan.steps.map(s => ({ ...s, attempt: 0, taskId: null, state: "queued", error: null, outputs: [], creditBefore: null, creditAfter: null }));
      const run: Run = { runId, requestId, planId, fingerprint: p.plan.fingerprint, spaceId: p.plan.spaceId, spaceName: p.plan.spaceName, state: "queued", createdAt: ts, updatedAt: ts, steps, outputs: [] };
      database.prepare("INSERT INTO workflow_runs VALUES(?,?,?,?,?)").run(runId, requestId, requestHash, planId, JSON.stringify(run)); return run;
    },
    getRun, listRuns() { return (database.prepare("SELECT run_json FROM workflow_runs").all() as {run_json:string}[]).map(r => JSON.parse(r.run_json) as Run); }, findRun(requestId: string) { const r = database.prepare("SELECT run_json FROM workflow_runs WHERE request_id=?").get(requestId) as {run_json:string}|undefined; return r ? JSON.parse(r.run_json) as Run : null; },
    claimStep(runId: string, nodeId: string, bootId: string, now: Date) { if (!this.acquireLease(bootId, now)) return false; const run = getRun(runId); const s = run?.steps.find(x => x.nodeId === nodeId); if (!run || !s || s.state !== "queued") return false; s.state = "submitting"; s.attempt += 1; s.error = null; run.state = "running"; run.updatedAt = now.toISOString(); save(run); database.prepare("INSERT INTO workflow_attempts VALUES(?,?,?,?,?,?)").run(runId,nodeId,s.attempt,null,s.state,JSON.stringify(s)); return true; },
    updateStep(runId: string, nodeId: string, patch: Partial<RunStep>) { const run = getRun(runId); const s = run?.steps.find(x => x.nodeId === nodeId); if (!run || !s) throw new Error("step_not_found"); Object.assign(s, patch); run.updatedAt = new Date().toISOString(); if (s.taskId) database.prepare("UPDATE workflow_attempts SET task_id=?,state=?,json=? WHERE run_id=? AND node_id=? AND attempt=?").run(s.taskId,s.state,JSON.stringify(s),runId,nodeId,s.attempt); save(run); },
    acquireLease(bootId: string, now: Date) { const r = database.prepare("SELECT boot_id,heartbeat_at FROM workflow_lease WHERE id=1").get() as {boot_id:string;heartbeat_at:string}|undefined; if (r && r.boot_id !== bootId && now.getTime() - new Date(r.heartbeat_at).getTime() < 30_000) return false; database.prepare("INSERT INTO workflow_lease(id,boot_id,heartbeat_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET boot_id=excluded.boot_id,heartbeat_at=excluded.heartbeat_at").run(bootId,now.toISOString()); return true; },
    heartbeat(bootId: string, now: Date) { const r = database.prepare("UPDATE workflow_lease SET heartbeat_at=? WHERE id=1 AND boot_id=?").run(now.toISOString(),bootId); return Number(r.changes) === 1; },
    recoverInterrupted(bootId: string, now: Date) { const r = database.prepare("SELECT boot_id,heartbeat_at FROM workflow_lease WHERE id=1").get() as {boot_id:string;heartbeat_at:string}|undefined; if (r && r.boot_id !== bootId && now.getTime() - new Date(r.heartbeat_at).getTime() < 30_000) return; for (const row of database.prepare("SELECT run_json FROM workflow_runs").all() as {run_json:string}[]) { const run = JSON.parse(row.run_json) as Run; let changed=false; for (const s of run.steps) if (s.state === "submitting") { s.state="reconciliation_required"; s.error="Interrupted before submission outcome was known"; changed=true; } if (changed) { run.state="reconciliation_required"; save(run); } } },
    findRetry(runId:string, requestId:string) { const r=database.prepare("SELECT request_id,run_id,node_id FROM workflow_retry_requests WHERE request_id=? AND run_id=?").get(requestId,runId) as {request_id:string;run_id:string;node_id:string}|undefined; return r ? {requestId:r.request_id,runId:r.run_id,nodeId:r.node_id}:null; },
    recordRetry(requestId:string,runId:string,nodeId:string,bodyHash:string,acceptedAt:Date) { database.prepare("INSERT INTO workflow_retry_requests VALUES(?,?,?,?,?)").run(requestId,runId,nodeId,bodyHash,acceptedAt.toISOString()); },
    retryStep(runId:string,nodeId:string,requestId:string,approval:Approval,now:Date) {
      const existing=this.findRetry(runId,requestId); if(existing) return getRun(runId)!;
      const run=getRun(runId); if(!run) throw new Error("run_not_found"); const plan=this.getPlan(run.planId); if(!plan) throw new Error("plan_not_found");
      if(approval.fingerprint!==run.fingerprint) throw new Error("fingerprint_mismatch");
      const step=run.steps.find(s=>s.nodeId===nodeId); if(!step || step.state!=="error") throw new Error("retry_not_allowed");
      const descendants=new Set<string>(); const walk=(id:string)=>run.steps.filter(s=>s.dependsOn.includes(id)).forEach(s=>{ if(!descendants.has(s.nodeId)){descendants.add(s.nodeId);walk(s.nodeId);} }); walk(nodeId);
      step.state="queued"; step.taskId=null; step.error=null; for(const s of run.steps) if(descendants.has(s.nodeId)&&s.state==="blocked") {s.state="queued";s.error=null;s.taskId=null;}
      run.state="queued"; run.updatedAt=now.toISOString(); database.exec("BEGIN IMMEDIATE"); try { this.recordRetry(requestId,runId,nodeId,hash({runId,nodeId,approval}),now); save(run); database.exec("COMMIT"); } catch(e){database.exec("ROLLBACK");throw e;} return run;
    },
  };
}
