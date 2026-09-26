import { NextRequest, NextResponse } from "next/server";
import { deleteHiggsfieldCredentials, getHiggsfieldCredentials, setHiggsfieldCredentials } from "@/lib/guest/db";

export async function GET() {
  return NextResponse.json({ hasToken: !!getHiggsfieldCredentials() });
}

export async function POST(req: NextRequest) {
  const { keyId, keySecret } = await req.json();
  if (typeof keyId !== "string" || !keyId.trim() || typeof keySecret !== "string" || !keySecret.trim()) {
    return NextResponse.json({ error: "Higgsfield API Key ID and Secret are required" }, { status: 400 });
  }
  setHiggsfieldCredentials(keyId.trim(), keySecret.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  deleteHiggsfieldCredentials();
  return NextResponse.json({ ok: true, hasToken: !!getHiggsfieldCredentials() });
}
