import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";

  // Handle subdomain routing (e.g. aegis.adexto.xyz -> /token/aegis)
  //
  // Port DIBUANG sebelum dibandingkan, dan host berupa alamat IP atau `localhost`
  // dilewati sama sekali.
  //
  // Sebelumnya daftar domain utama menyertakan port secara harfiah
  // ("127.0.0.1:3000"), lalu host dipecah pada titik dan dianggap punya subdomain
  // begitu bagiannya tiga atau lebih. Akibatnya `127.0.0.1:3100` dipecah menjadi
  // ["127","0","0","1:3100"] — empat bagian — sehingga "127" dibaca sebagai
  // subdomain dan `/` di-rewrite ke `/token/127` yang membalas 404. Jadi halaman
  // depan hilang setiap kali situs diakses lewat alamat IP, atau lewat localhost
  // di port selain 3000.
  const host = hostname.split(":")[0].toLowerCase();
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes("[");
  const mainDomains = ["adexto.xyz", "www.adexto.xyz", "edge.adexto.xyz"];

  if (!isIpLiteral && host !== "localhost" && !mainDomains.includes(host)) {
    // Extract subdomain (e.g. "aegis" from "aegis.adexto.xyz")
    const parts = host.split(".");
    if (parts.length >= 3) {
      const subdomain = parts[0];
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
