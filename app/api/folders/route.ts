import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE, GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  // ── Guest mode ──────────────────────────────────────────────────────────────
  if (GUEST_MODE) {
    const folders = guestDb.getFolders(GUEST_USER_ID);
    const folderItems = guestDb.getFolderItems(GUEST_USER_ID);
    return NextResponse.json({ folders, folderItems });
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

  const { data: folders, error: fErr } = await supabaseAdmin
    .from("folders")
    .select("id, name, parent_id, order_index, created_at, updated_at")
    .eq("user_id", userId)
    .order("order_index", { ascending: true });

  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });

  const { data: folderItems, error: fiErr } = await supabaseAdmin
    .from("folder_items")
    .select("folder_id, item_id, created_at")
    .eq("user_id", userId);

  if (fiErr) return NextResponse.json({ error: fiErr.message }, { status: 500 });

  return NextResponse.json({ folders: folders ?? [], folderItems: folderItems ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { name: string; parentId?: string | null; orderIndex?: number };
  const { name, parentId = null, orderIndex = 0 } = body;
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  // ── Guest mode ──────────────────────────────────────────────────────────────
  if (GUEST_MODE) {
    const folder = guestDb.insertFolder({
      id: randomUUID(),
      user_id: GUEST_USER_ID,
      name,
      parent_id: parentId ?? null,
      order_index: orderIndex,
    });
    return NextResponse.json({ folder });
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

  const { data: folder, error } = await supabaseAdmin
    .from("folders")
    .insert({ user_id: userId, name, parent_id: parentId ?? null, order_index: orderIndex })
    .select("id, name, parent_id, order_index, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ folder });
}
