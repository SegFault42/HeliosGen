import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE, GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as { name?: string; parentId?: string | null; orderIndex?: number };

  const updates: { name?: string; parent_id?: string | null; order_index?: number } = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.parentId !== undefined) updates.parent_id = body.parentId;
  if (body.orderIndex !== undefined) updates.order_index = body.orderIndex;

  // ── Guest mode ──────────────────────────────────────────────────────────────
  if (GUEST_MODE) {
    guestDb.updateFolder(id, GUEST_USER_ID, {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.parent_id !== undefined ? { parent_id: updates.parent_id ?? null } : {}),
      ...(updates.order_index !== undefined ? { order_index: updates.order_index } : {}),
    });
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

  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };

  const { error } = await supabaseAdmin
    .from("folders")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // ── Guest mode ──────────────────────────────────────────────────────────────
  if (GUEST_MODE) {
    guestDb.deleteFolder(id, GUEST_USER_ID);
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
    .from("folders")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
