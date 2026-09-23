import { NextResponse, type NextRequest } from "next/server";
import { guardRequest } from "@/lib/requestGuard";

export function proxy(req: NextRequest) {
  return guardRequest(req) ?? NextResponse.next();
}

export const config = { matcher: "/((?!_next/static|_next/image).*)" };
