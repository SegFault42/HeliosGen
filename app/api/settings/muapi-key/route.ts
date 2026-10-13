import { NextRequest, NextResponse } from "next/server";
import { deleteMuapiApiKey, getMuapiApiKey, setMuapiApiKey } from "@/lib/guest/db";

export async function GET() {
  return NextResponse.json({ hasToken: !!getMuapiApiKey() });
}

export async function POST(req: NextRequest) {
  const { muapiApiKey } = await req.json();
  if (typeof muapiApiKey !== "string" || !muapiApiKey.trim()) {
    return NextResponse.json({ error: "muapiApiKey is required" }, { status: 400 });
  }
  setMuapiApiKey(muapiApiKey.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  deleteMuapiApiKey();
  return NextResponse.json({ ok: true });
}
