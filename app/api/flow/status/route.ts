import { NextResponse } from "next/server";
import { listFlowAccounts, getFlowCredits } from "@/lib/flowAdapter";

export const runtime = "nodejs";

// Allowlist: never spread raw account records. They carry an OAuth/session
// token, plus local-only fields (CDP debug endpoint, browser executable
// path) that any LAN client hitting this route should not learn.
type RawAccount = { id: string; label?: string; email?: string; connectionStatus?: string; lastOpenedAt?: string | number; lastValidatedAt?: string | number };
function publicAccount(account: RawAccount) {
  return {
    id: account.id,
    label: account.label,
    email: account.email,
    connectionStatus: account.connectionStatus,
    lastOpenedAt: account.lastOpenedAt,
    lastValidatedAt: account.lastValidatedAt,
  };
}

export async function GET() {
  try {
    const data = await listFlowAccounts();
    let creditsInfo = null;
    if (data.defaultAccountId) {
      try {
        const creditPromise = getFlowCredits(data.defaultAccountId);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout checking credits")), 2500));
        creditsInfo = await Promise.race([creditPromise, timeoutPromise]);
      } catch (err) {
        creditsInfo = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return NextResponse.json({
      ok: true,
      provider: "google-flow",
      defaultAccountId: data.defaultAccountId,
      accountsCount: data.accounts.length,
      accounts: data.accounts.map(publicAccount),
      credits: creditsInfo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Flow status check failed";
    return NextResponse.json(
      {
        ok: false,
        provider: "google-flow",
        error: message,
      },
      { status: 502 }
    );
  }
}
