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
  /**
   * `x402.adexto.xyz` ada di daftar ini sebagai PERTAHANAN, bukan karena dibutuhkan.
   *
   * Hostname itu terikat langsung ke Worker sebagai custom domain, jadi permintaannya
   * tidak pernah mencapai Next.js dan middleware ini tidak akan pernah melihatnya.
   *
   * Tapi zone ini punya wildcard `*.adexto.xyz` yang proxied ke VPS, jadi kalau route
   * Worker-nya suatu saat dicabut, permintaan JATUH ke sini — dan aturan di bawah akan
   * memperlakukan "x402" sebagai slug token lalu me-rewrite ke `/token/x402` yang
   * membalas 404. Kegagalan itu menyesatkan: ia menyalahkan token yang tidak ada alih-
   * alih routing yang hilang. Didaftarkan di sini, jatuhnya menjadi halaman utama.
   */
  const mainDomains = ["adexto.xyz", "www.adexto.xyz", "edge.adexto.xyz", "x402.adexto.xyz"];

  /**
   * Subdomain yang menamai SEKSI APLIKASI, bukan pasar.
   *
   * Ketiganya sudah lama punya sertifikat sendiri di produksi — seseorang memang
   * memaksudkannya bekerja — tapi aturan di bawah memperlakukan setiap subdomain
   * sebagai slug token, jadi `studio.adexto.xyz` di-rewrite ke `/token/studio` dan
   * membalas 404. Ketiganya 404 sejak dibuat, dan itu tidak terlihat selama SEMUA
   * subdomain masih gagal di lapisan TLS dengan 525: satu kegagalan menutupi yang lain.
   *
   * Dipetakan ke halamannya masing-masing, bukan didaftarkan ke `mainDomains` — kalau
   * hanya dilewatkan, `studio.adexto.xyz` akan menampilkan halaman depan dan hostname-nya
   * jadi bohong tentang isinya.
   */
  const APP_SECTIONS: Record<string, string> = {
    studio: "/studio",
    swap: "/swap",
    explorer: "/explorer",
    docs: "/docs",
  };

  if (!isIpLiteral && host !== "localhost" && !mainDomains.includes(host)) {
    // Extract subdomain (e.g. "aegis" from "aegis.adexto.xyz")
    const parts = host.split(".");
    if (parts.length >= 3) {
      const subdomain = parts[0];
      // If user accesses root of subdomain, rewrite to the section or /token/[subdomain]
      if (url.pathname === "/" || url.pathname === "") {
        url.pathname = APP_SECTIONS[subdomain] ?? `/token/${subdomain}`;
        return NextResponse.rewrite(url);
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.svg|logo.svg|.*\\.png$).*)"],
};
