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
    /**
     * `day2` -> dek presentasi statis untuk 0G Atlas Founder House.
     *
     * Menunjuk BERKAS di `public/`, bukan rute Next, karena dek itu satu berkas HTML yang
     * juga dirender jadi PDF oleh headless Chrome. Halaman React akan menambah hidrasi dan
     * CSS bersama yang harus dijinakkan ulang saat dicetak, untuk nol keuntungan — dek ini
     * tidak punya state dan tidak memanggil satu pun API.
     *
     * Hanya `/` yang di-rewrite. Aset di sebelahnya — PDF yang diunduh tombol di dek —
     * diminta lewat jalur absolut `/founder-house/...` dan lolos dari cabang ini apa adanya,
     * jadi tidak ada aturan kedua yang perlu ditulis untuknya.
     */
    day2: "/founder-house/index.html",
    /**
     * `campaign` -> dek campaign Galxe, pola yang sama dengan `day2`.
     *
     * Berbeda dari `day2` dalam satu hal yang penting: dek ini memuat gambar latar dan tombol
     * unduh PDF lewat jalur RELATIF, karena `scripts/render-deck.mjs` mencetaknya dari
     * `file://` dan jalur absolut akan dicari di akar filesystem. Jadi `campaign` juga
     * terdaftar di `SUBDOMAIN_PREFIXES` di bawah — tanpa itu `/art/cover.jpg` di subdomain ini
     * tidak pernah menemukan `public/campaign/art/cover.jpg` dan dek-nya tersaji tanpa latar
     * sama sekali, tanpa galat apa pun yang terlihat.
     */
    campaign: "/campaign/index.html",
  };

  /**
   * Subdomain yang membawa BANYAK halaman, bukan satu.
   *
   * Cabang di bawah hanya me-rewrite `/`, jadi `docs.adexto.xyz` bekerja sementara
   * `docs.adexto.xyz/trading` menjadi `/trading` — rute yang tidak ada, jadi 404. Itu benar
   * selama `/docs` satu halaman, dan berhenti benar begitu ia menjadi situs.
   *
   * Prefiks di sini di-rewrite untuk SETIAP path, jadi `docs.adexto.xyz/mcp` menjadi
   * `/docs/mcp`. Hanya untuk subdomain yang memang punya anak halaman; `studio`, `swap` dan
   * `explorer` tetap di cabang bawah karena masing-masing satu halaman, dan memetakan
   * seluruh path-nya akan mengubah `swap.adexto.xyz/explorer` menjadi `/swap/explorer` yang
   * tidak ada.
   *
   * Aset di bawah `/_next` dan `/api` sudah dikecualikan oleh `matcher` di bawah berkas ini,
   * jadi tidak ada aturan kedua yang perlu ditulis untuk itu.
   */
  const SUBDOMAIN_PREFIXES: Record<string, string> = {
    docs: "/docs",
    /**
     * `campaign` ada di SINI untuk asetnya, dan di `APP_SECTIONS` untuk akarnya.
     *
     * `/docs` adalah rute Next, jadi `/` yang di-rewrite menjadi prefiksnya sendiri sudah
     * benar. `/campaign` adalah DIREKTORI di `public/`, dan Next tidak menyajikan index
     * direktori — `/campaign` membalas 404 sementara `/campaign/index.html` berhasil. Itu
     * sebabnya cabang di bawah memeriksa `APP_SECTIONS` lebih dulu untuk path akar.
     */
    campaign: "/campaign",
  };

  if (!isIpLiteral && host !== "localhost" && !mainDomains.includes(host)) {
    // Extract subdomain (e.g. "aegis" from "aegis.adexto.xyz")
    const parts = host.split(".");
    if (parts.length >= 3) {
      const subdomain = parts[0];
      const prefix = SUBDOMAIN_PREFIXES[subdomain];
      if (prefix) {
        // `/` -> dokumen akar kalau subdomain ini punya satu, kalau tidak prefiksnya sendiri.
        // `APP_SECTIONS` diperiksa lebih dulu karena sebuah prefiks bisa menunjuk direktori
        // statis alih-alih rute Next, dan direktori tidak punya index yang disajikan sendiri.
        // Sisanya digabung. Path yang sudah membawa prefiksnya dibiarkan, supaya tautan
        // absolut dari halaman lain tidak menjadi `/docs/docs/...`.
        if (url.pathname === "/" || url.pathname === "") {
          url.pathname = APP_SECTIONS[subdomain] ?? prefix;
        } else if (!url.pathname.startsWith(`${prefix}/`) && url.pathname !== prefix) {
          url.pathname = `${prefix}${url.pathname}`;
        }
        return NextResponse.rewrite(url);
      }
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
