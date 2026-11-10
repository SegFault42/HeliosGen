import { NextRequest, NextResponse } from "next/server";
import { getSpaces } from "@/lib/guest/spaces";
import { compilePlan } from "@/lib/workflow-runtime/compiler";
import { WorkflowRuntimeError } from "@/lib/workflow-runtime/contracts";
import { runtime as getRuntime } from "@/lib/workflow-runtime/bootstrap";
export const runtime = "nodejs";
export async function POST(req:NextRequest) { try { const body=await req.json(); const space=getSpaces().find(s=>s.id===body.spaceId); if(!space) return NextResponse.json({error:{code:"not_found",message:"Space not found"}},{status:404}); const result=compilePlan(space,body,new Date()); getRuntime().store.putPlan(result.plan,result.snapshot); return NextResponse.json(result.plan); } catch(e) { if(e instanceof WorkflowRuntimeError) return NextResponse.json({error:e.errors},{status:422}); return NextResponse.json({error:{code:"invalid_request",message:e instanceof Error?e.message:"Invalid request"}},{status:400}); } }
