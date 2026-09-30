import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE, readSessionValue } from "@/lib/session";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseConfigured } from "@/lib/supabase/config";

/** Pages anyone can open */
const PUBLIC = ["/login", "/auth/confirm"];
const isPublic = (path: string) => PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));

function loginUrl(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return url;
}

/**
 * Supabase mode: refreshes the auth session on every page request (cookies are
 * rewritten on the response) and sends signed-out visitors to /login.
 * Demo mode (no Supabase env vars): checks the signed demo cookie.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!supabaseConfigured()) {
    const userId = await readSessionValue(request.cookies.get(SESSION_COOKIE)?.value);
    if (pathname === "/login") return userId ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
    if (isPublic(pathname)) return NextResponse.next();
    return userId ? NextResponse.next() : NextResponse.redirect(loginUrl(request));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });
  // Verifies the JWT and refreshes an expired session; don't put code between client creation and this call
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { user_metadata?: { must_change_password?: boolean } } | undefined;

  const redirect = (to: URL) => {
    const r = NextResponse.redirect(to);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (!claims) return isPublic(pathname) ? response : redirect(loginUrl(request));
  if (pathname === "/login") return redirect(new URL("/", request.url));
  // Accounts created with a temporary password must set their own first
  if (claims.user_metadata?.must_change_password && pathname !== "/account/password" && !isPublic(pathname)) {
    return redirect(new URL("/account/password", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|geo/|brand/|favicon.ico|icon|apple-icon|opengraph-image|.*\\.(?:png|svg|jpg|jpeg|webp|ico|json|txt)$).*)"],
};
