import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionValue } from "@/lib/session";

/** Pages need a valid session cookie; /login redirects home when already signed in. */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const userId = await readSessionValue(request.cookies.get(SESSION_COOKIE)?.value);
  if (pathname === "/login") {
    return userId ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (!userId) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|geo/|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|webp|ico|json|txt)$).*)"],
};
