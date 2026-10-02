import { NextResponse } from "next/server";
import { pathToFileURL } from "node:url";
import path from "node:path";

export const runtime = "nodejs";

const FLOW_DIST = "F:/CLAUDE/AGENT_AI/google-flow-mcp/dist";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, email } = body;
    if (!token || typeof token !== "string") {
      return NextResponse.json({ ok: false, error: "Token OAuth Bearer obrigatorio" }, { status: 400 });
    }

    const storeUrl = pathToFileURL(path.join(FLOW_DIST, "store.js")).href;
    const { FlowStore } = await import(storeUrl);
    const store = new FlowStore();
    await store.initialize();

    const accountId = (email && email.includes("@")) 
      ? email.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_")
      : `flow_acc_${Date.now()}`;

    const label = email || accountId;
    await store.ensureAccount(accountId, label, { browserMode: "extension" });
    await store.setAccountToken(accountId, token, email);
    await store.markAccountConnected(accountId, true);

    return NextResponse.json({
      ok: true,
      accountId,
      label,
      message: `Conta ${label} conectada com sucesso no ANVIL!`
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
