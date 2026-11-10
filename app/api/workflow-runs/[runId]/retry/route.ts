import { NextRequest, NextResponse } from "next/server";
import { runtime as getRuntime } from "@/lib/workflow-runtime/bootstrap";
export const runtime="nodejs";
export async function POST(req:NextRequest,{params}:{params:Promise<{runId:string}>}) { const {runId}=await params; try { const b=await req.json(); const r=getRuntime(); const run=r.runner.retry(runId,b.nodeId,b.requestId,b.approval,new Date()); void r.runner.tick(); return NextResponse.json(run,{status:202}); } catch(e){const m=e instanceof Error?e.message:"retry failed"; return NextResponse.json({error:{code:m.includes("not_allowed")?"conflict":"invalid_request",message:m}},{status:m.includes("not_allowed")?409:422});} }
