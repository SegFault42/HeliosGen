import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE } from "@/lib/guestMode";
import type { NextRequest } from "next/server";

export async function getAzureKeyForUser(userId: string): Promise<string | null> {
  if (GUEST_MODE) {
    const { getAzureApiKey } = await import("./guest/db");
    return getAzureApiKey();
  }
  const { data } = await supabaseAdmin
    .from("user_settings")
    .select("azure_api_key")
    .eq("user_id", userId)
    .single();
  return data?.azure_api_key ?? null;
}

export async function getAzureToken(req: NextRequest): Promise<string | null> {
  if (GUEST_MODE) {
    const { getAzureApiKey } = await import("./guest/db");
    return getAzureApiKey();
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  const userId = data.user?.id;
  if (!userId) return null;
  return getAzureKeyForUser(userId);
}
