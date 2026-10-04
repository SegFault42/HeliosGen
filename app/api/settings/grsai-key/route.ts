import { NextRequest, NextResponse } from "next/server";
import {
  getGrsaiApiKey,
  setGrsaiApiKey,
  deleteGrsaiApiKey,
} from "@/lib/guest/db";

export async function GET() {
  return NextResponse.json({ hasToken: !!getGrsaiApiKey() });
}

export async function POST(req: NextRequest) {
  const { grsaiApiKey } = await req.json();
  if (typeof grsaiApiKey !== "string" || !grsaiApiKey.trim()) {
    return NextResponse.json({ error: "grsaiApiKey is required" }, { status: 400 });
  }
  setGrsaiApiKey(grsaiApiKey.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  deleteGrsaiApiKey();
  return NextResponse.json({ ok: true });
}
