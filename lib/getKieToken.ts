import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getKieTokenForUser(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_settings")
    .select("kie_api_token")
    .eq("user_id", userId)
    .single();
  return data?.kie_api_token ?? null;
}

export async function getKieToken(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  const userId = data.user?.id;
  if (!userId) return null;
  return getKieTokenForUser(userId);
}
