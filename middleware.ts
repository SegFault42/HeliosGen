import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { GUEST_MODE } from "@/lib/guestMode";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  if (GUEST_MODE) return response;

  let supabaseResponse = response;
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();
  return supabaseResponse;
}

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and server-to-server API routes
    "/((?!_next/static|_next/image|favicon.ico|api/callback|api/upload-to-r2).*)",
  ],
};
