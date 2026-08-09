import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guard.
 *
 * This is a UX redirect, not a security boundary — it only checks that the
 * session cookie is *present*, never that it's valid, because middleware runs
 * on the edge with no access to the backend's signing key. Real enforcement is
 * the API rejecting requests with 401. Never rely on this to protect data.
 */

const ACCESS_COOKIE = "rw_access";

// Reachable while logged out. /welcome is here because registration lands
// there before an intent exists, and /share/* is public by design.
const PUBLIC_PATHS = ["/login", "/register", "/welcome", "/share"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (req.cookies.get(ACCESS_COOKIE)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and static assets — matching them would redirect the
  // JS chunks themselves and break the login page it redirects to.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
