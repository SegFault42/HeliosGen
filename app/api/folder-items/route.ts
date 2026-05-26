import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE, GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

export async function POST(req: NextRequest) {
  const body = await req.json() as { folderId: string; itemIds: string[] };
  const { folderId, itemIds } = body;
  if (!folderId || !Array.isArray(itemIds)) {
    return NextResponse.json({ error: "Missing folderId or itemIds" }, { status: 400 });
  }

  // ── Guest mode ──────────────────────────────────────────────────────────────
  if (GUEST_MODE) {
    guestDb.insertFolderItems(folderId, itemIds, GUEST_USER_ID);
    return NextResponse.json({ ok: true });
  }

  // ── Production mode ─────────────────────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authData.user.id;

  const rows = itemIds.map((itemId) => ({ folder_id: folderId, item_id: itemId, user_id: userId }));
  const { error } = await supabaseAdmin
    .from("folder_items")
    .upsert(rows, { onConflict: "folder_id,item_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json() as { folderId: string; itemIds: string[] };
  const { folderId, itemIds } = body;
  if (!folderId || !Array.isArray(itemIds)) {
    return NextResponse.json({ error: "Missing folderId or itemIds" }, { status: 400 });
  }

  // ── Guest mode ──────────────────────────────────────────────────────────────
  if (GUEST_MODE) {
    guestDb.deleteFolderItems(folderId, itemIds, GUEST_USER_ID);
    return NextResponse.json({ ok: true });
  }

  // ── Production mode ─────────────────────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authData.user.id;

  const { error } = await supabaseAdmin
    .from("folder_items")
    .delete()
    .eq("folder_id", folderId)
    .eq("user_id", userId)
    .in("item_id", itemIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
