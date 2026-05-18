import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE, resolveUserId } from "@/lib/guestMode";

export async function GET(req: NextRequest) {
  if (GUEST_MODE) {
    const { getKieApiToken } = await import("@/lib/guest/db");
    return NextResponse.json({ hasToken: !!getKieApiToken() });
  }

  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("user_settings")
    .select("kie_api_token")
    .eq("user_id", userId)
    .single();

  return NextResponse.json({ hasToken: !!data?.kie_api_token });
}

export async function POST(req: NextRequest) {
  if (GUEST_MODE) {
    const { kieApiToken } = await req.json();
    if (typeof kieApiToken !== "string" || !kieApiToken.trim()) {
      return NextResponse.json({ error: "kieApiToken is required" }, { status: 400 });
    }
    const { setKieApiToken } = await import("@/lib/guest/db");
    setKieApiToken(kieApiToken.trim());
    return NextResponse.json({ ok: true });
  }

  const userId = await resolveUserId(req);
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
  if (GUEST_MODE) {
    const { deleteKieApiToken } = await import("@/lib/guest/db");
    deleteKieApiToken();
    return NextResponse.json({ ok: true });
  }

  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabaseAdmin
    .from("user_settings")
    .update({ kie_api_token: null })
    .eq("user_id", userId);

  return NextResponse.json({ ok: true });
}
