import { NextResponse } from "next/server";
import { listFlowAccounts, getFlowCredits } from "@/lib/flowAdapter";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await listFlowAccounts();
    let creditsInfo = null;
    if (data.defaultAccountId) {
      try {
        const creditPromise = getFlowCredits(data.defaultAccountId);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout checking credits")), 2500));
        creditsInfo = await Promise.race([creditPromise, timeoutPromise]);
      } catch (err: any) {
        creditsInfo = { error: err?.message || String(err) };
      }
    }
    return NextResponse.json({
      ok: true,
      provider: "google-flow",
      defaultAccountId: data.defaultAccountId,
      accountsCount: data.accounts.length,
      accounts: data.accounts,
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
