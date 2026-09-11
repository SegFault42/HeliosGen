import { NextRequest, NextResponse } from "next/server";
import { runtime as getRuntime } from "@/lib/workflow-runtime/bootstrap";
export const runtime="nodejs";
export async function GET(_req:NextRequest,{params}:{params:Promise<{runId:string;requestId:string}>}) { const {runId,requestId}=await params; const r=getRuntime(); const found=r.store.findRetry(runId,requestId); if(!found)return NextResponse.json({error:{code:"not_found",message:"Retry request not found"}},{status:404}); return NextResponse.json({...found,run:r.store.getRun(runId)}); }
