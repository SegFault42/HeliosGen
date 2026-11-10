/**
 * Local workflow ("space") storage, backed by the SQLite DB (lib/guest/spaces).
 *
 *   GET  → { spaces: GuestSpace[] }
 *   PUT  { spaces: GuestSpace[], partial?: boolean } → { ok: true }
 *        partial: upsert only these spaces (no orphan deletion)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSpaces, saveSpaces, InvalidSpaceError, type GuestSpace } from "@/lib/guest/spaces";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ spaces: getSpaces() });
}

export async function PUT(req: NextRequest) {
  let body: { spaces?: GuestSpace[]; partial?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.spaces)) {
    return NextResponse.json({ error: "spaces[] required" }, { status: 400 });
  }
  const partial = body.partial === true;
  if (!partial && body.spaces.length === 0) {
    return NextResponse.json({ error: "empty spaces[] would delete every workflow; pass partial:true to no-op" }, { status: 400 });
  }

  try {
    saveSpaces(body.spaces, { partial });
  } catch (e) {
    if (e instanceof InvalidSpaceError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
