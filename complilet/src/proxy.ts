import { NextRequest, NextResponse } from "next/server";

// In Next.js 16 `middleware.ts` is renamed to `proxy.ts` and the exported
// function is `proxy` (see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).

const ADMIN_PASSWORD = process.env.INTERNAL_DASHBOARD_PASSWORD ?? "";
const COOKIE_NAME = "admin_session";
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only guard /admin/* — skip the login page to avoid redirect loops.
  if (!pathname.startsWith("/admin") || pathname.startsWith("/admin/login")) {
    return NextResponse.next();
  }

  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  if (sessionCookie && sessionCookie === ADMIN_PASSWORD) {
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};

// Helpers imported by the login Server Action / logout route handler.
export { COOKIE_NAME, COOKIE_MAX_AGE };
