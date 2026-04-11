import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ADMIN_EMAILS = (process.env.ADMIN_EMAIL_ALLOWLIST ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Build response with refreshed session cookies ─────────────────────────
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — important: call getUser not getSession
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = pathname === "/login" || pathname.startsWith("/login");
  const isInternalPage = pathname === "/internal" || pathname.startsWith("/internal");
  const isRootPage = pathname === "/";

  // ── Root redirect ─────────────────────────────────────────────────────────
  if (isRootPage) {
    if (user && ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? "")) {
      return NextResponse.redirect(new URL("/internal", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // ── Protect /internal/* ───────────────────────────────────────────────────
  if (isInternalPage) {
    if (!user) {
      return NextResponse.redirect(new URL("/login?reason=unauthenticated", request.url));
    }
    if (!ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? "")) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?reason=unauthorized", request.url));
    }
    return response;
  }

  // ── Redirect already-authenticated admins away from login ─────────────────
  if (isLoginPage && user && ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? "")) {
    return NextResponse.redirect(new URL("/internal", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
