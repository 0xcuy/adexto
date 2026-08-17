import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";

  // Handle subdomain routing (e.g. aegis.adexto.xyz -> /token/aegis)
  // Ignore main domains, www, and edge
  const mainDomains = ["adexto.xyz", "www.adexto.xyz", "localhost:3000", "127.0.0.1:3000", "edge.adexto.xyz"];
  
  if (!mainDomains.includes(hostname)) {
    // Extract subdomain (e.g. "aegis" from "aegis.adexto.xyz")
    const parts = hostname.split(".");
    if (parts.length >= 3) {
      const subdomain = parts[0].toLowerCase();
      // If user accesses root of subdomain, rewrite to /token/[subdomain]
      if (url.pathname === "/" || url.pathname === "") {
        url.pathname = `/token/${subdomain}`;
        return NextResponse.rewrite(url);
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.svg|logo.svg|.*\\.png$).*)"],
};
