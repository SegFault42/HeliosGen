import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { createHeyGenPhotoAvatar } from "@/lib/heygenMcp";

export const runtime = "nodejs";

const ALLOWED_ROOTS = [
  resolve("D:/CLAUDE PROJECTS/social media/creator/avatar-refs"),
  resolve("F:/CLAUDE/AGENT_AI/rodadas"),
];

function isAllowedSource(sourcePath: string): boolean {
  const normalized = resolve(sourcePath).toLowerCase();
  return ALLOWED_ROOTS.some((root) => normalized === root.toLowerCase() || normalized.startsWith(`${root.toLowerCase()}\\`));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; sourcePath?: string };
    const sourcePath = body.sourcePath?.trim();
    if (!sourcePath || !isAllowedSource(sourcePath)) {
      return NextResponse.json({ error: "sourcePath must be inside an approved ANVIL avatar reference folder" }, { status: 400 });
    }
    const name = body.name?.trim() || "Rafael Soul Photo Avatar";
    const result = await createHeyGenPhotoAvatar(name, sourcePath);
    return NextResponse.json({ ok: true, provider: "heygen-mcp", name, sourcePath, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HeyGen avatar creation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
