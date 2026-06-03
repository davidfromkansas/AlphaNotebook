import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const protectedRoutes = ["/library", "/collections", "/sources"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isProtected = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (isProtected && !req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/library/:path*", "/collections/:path*", "/sources/:path*"],
};
