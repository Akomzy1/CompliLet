import { NextRequest, NextResponse } from "next/server";

const INTERNAL_PASSWORD = process.env.INTERNAL_DASHBOARD_PASSWORD ?? "";
const COOKIE_NAME = "internal_session";
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only guard /internal/* — skip the login page itself to avoid redirect loops
  if (!pathname.startsWith("/internal") || pathname.startsWith("/internal/login")) {
    return NextResponse.next();
  }

  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;

  // Validate the session cookie value against the hashed password
  if (sessionCookie && sessionCookie === INTERNAL_PASSWORD) {
    return NextResponse.next();
  }

  // Redirect to login with the original URL preserved
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/internal/login";
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/internal/:path*"],
};

// Helper used by the login Server Action (imported there, not a Next middleware export)
export { COOKIE_NAME, COOKIE_MAX_AGE };
