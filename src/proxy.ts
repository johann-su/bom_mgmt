import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { CALLBACK_PATH_HEADER, signInPath } from "@/lib/callback-url";

// Gate every page behind authentication: a request without a Better Auth
// session cookie is redirected to /sign-in. This is an optimistic cookie
// check (no DB round-trip) — pages and route handlers still call getSession()
// for the authoritative check, so a forged/expired cookie can't grant access.
//
// Note: in this Next.js version the middleware convention is named `proxy`
// (see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).

const PUBLIC_PATHS = ["/sign-in", "/sign-up"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // Carry the requested page through the sign-in flow. signInPath validates
  // the value down to an in-app path, so nothing here can become an open
  // redirect.
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL(signInPath(pathname + search), request.url));
  }

  // The cookie may still be expired/forged — pages then redirect server-side
  // after getSession(). Hand them the original path (overwriting any
  // client-sent value) so that redirect can preserve the destination too.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CALLBACK_PATH_HEADER, pathname + search);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Every path except API routes (they guard themselves), Next.js internals
  // and static files. The PWA manifest is among them: browsers fetch it
  // without cookies, so gating it would break "Add to Home Screen".
  // `.well-known` holds the OAuth discovery documents for the MCP server,
  // which a client must read before it has any credential.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
