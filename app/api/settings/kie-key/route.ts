import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function getUserId(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("user_settings")
    .select("kie_api_token")
    .eq("user_id", userId)
    .single();

  return NextResponse.json({ hasToken: !!data?.kie_api_token });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { kieApiToken } = await req.json();
  if (typeof kieApiToken !== "string" || !kieApiToken.trim()) {
    return NextResponse.json({ error: "kieApiToken is required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("user_settings")
    .upsert({ user_id: userId, kie_api_token: kieApiToken.trim() }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabaseAdmin
    .from("user_settings")
    .update({ kie_api_token: null })
    .eq("user_id", userId);

  return NextResponse.json({ ok: true });
}
