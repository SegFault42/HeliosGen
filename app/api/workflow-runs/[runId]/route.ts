import { NextRequest, NextResponse } from "next/server";
import { runtime as getRuntime } from "@/lib/workflow-runtime/bootstrap";
export const runtime = "nodejs";
export async function GET(_req:NextRequest,{params}:{params:Promise<{runId:string}>}) { const {runId}=await params; const r=getRuntime(); const run=r.store.getRun(runId); if(!run)return NextResponse.json({error:{code:"not_found",message:"Run not found"}},{status:404}); void r.runner.tick(); return NextResponse.json(run); }
