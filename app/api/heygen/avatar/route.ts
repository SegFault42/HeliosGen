import { NextResponse } from "next/server";
import { isAbsolute, relative, resolve } from "node:path";
import { MEDIA_DIR } from "@/lib/guest/paths";
import { createHeyGenPhotoAvatar } from "@/lib/heygenMcp";

export const runtime = "nodejs";

const ALLOWED_ROOTS = [resolve(MEDIA_DIR)];

function isAllowedSource(sourcePath: string): boolean {
  const target = resolve(sourcePath);
  return ALLOWED_ROOTS.some((root) => {
    const rel = relative(root, target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; sourcePath?: string };
    const sourcePath = body.sourcePath?.trim();
    if (!sourcePath || !isAllowedSource(sourcePath)) {
      return NextResponse.json({ error: "sourcePath must be inside an ANVIL media folder" }, { status: 400 });
    }
    const name = body.name?.trim() || "Rafael Soul Photo Avatar";
    const result = await createHeyGenPhotoAvatar(name, sourcePath);
    return NextResponse.json({ ok: true, provider: "heygen-mcp", name, sourcePath, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HeyGen avatar creation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
