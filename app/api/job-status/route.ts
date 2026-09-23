import { NextRequest, NextResponse } from "next/server";
import { reconcileJob } from "@/lib/reconcileJob";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  return NextResponse.json(reconcileJob(taskId) ?? { status: "not_found" });
}
