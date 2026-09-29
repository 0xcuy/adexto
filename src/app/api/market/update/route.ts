import { NextResponse } from "next/server";
import { verifyMessage } from "ethers";
import { findProject, updateProjectMeta } from "@/lib/registry";
import { validateProjectImage } from "@/lib/logo-image";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { MAX_SIGNATURE_AGE_MS, buildUpdateMessage, imageFingerprint } from "@/lib/market-update";

/**
 * Sunting metadata pasar oleh PEMILIKNYA.
 *
 * KENAPA TANDA TANGAN, BUKAN "kirim saja alamatnya"
 *
 * Satu-satunya hal yang menghubungkan sebuah pasar dengan orangnya adalah `creator` di
 * registry, yang diambil dari event factory saat peluncuran. Kalau route ini menerima
 * `creator` dari body, maka siapa pun yang tahu alamat orang lain bisa menulis ulang pitch,
 * tautan, dan gambar pasar orang itu — dan tautan adalah `href` di halaman publik, jadi itu
 * bukan sekadar vandalisme, itu jalan memasang tautan pilihan sendiri di halaman yang
 * dipercaya orang lain. Jadi pemanggil harus MEMBUKTIKAN dia memegang kunci `creator`.
 *
 * Yang ditandatangani adalah SELURUH isi perubahan, bukan sekadar "saya pemiliknya".
 * Tanda tangan yang hanya mengikat identitas bisa dipakai ulang untuk isi yang berbeda oleh
 * siapa pun yang pernah melihatnya lewat (log proxy, ekstensi, riwayat jaringan). Karena
 * pesannya memuat setiap nilai, satu tanda tangan hanya sah untuk satu perubahan.
 *
 * `issuedAt` membatasi umur tanda tangan ke sepuluh menit. Itu BUKAN nonce: tanda tangan
 * yang sama masih bisa dikirim ulang di dalam jendela itu, dan hasilnya identik dengan
 * permintaan aslinya (idempoten), jadi pengulangan tidak menambah kemampuan apa pun. Yang
 * ditutupnya adalah tanda tangan lama yang bocor dan dipakai berbulan-bulan kemudian.
 *
 * YANG TIDAK BISA DIUBAH LEWAT SINI: harga, suplai, fee, creator, status verifikasi, atau
 * apa pun yang ekonomis. Batas itu ditegakkan `updateProjectMeta`, bukan route ini.
 */

export async function POST(req: Request) {
  const ip = clientIp(req);
  // 10 suntingan per 10 menit per IP. Menulis ke registry itu I/O berkas, dan tidak ada
  // alasan sah menyunting satu pasar puluhan kali per menit.
  const verdict = rateLimit(`market-update:${ip}`, 10, 10 * 60 * 1000);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: "Too many metadata updates from this address. Try again shortly.", code: "RATE_LIMITED" },
      { status: 429, headers: rateLimitHeaders(verdict) }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const chainId = Number(body.chainId);
  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const signature = String(body.signature ?? "");
  const issuedAt = String(body.issuedAt ?? "");

  if (!Number.isFinite(chainId) || !symbol) {
    return NextResponse.json({ error: "chainId and symbol are required." }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return NextResponse.json({ error: "A wallet signature is required." }, { status: 401 });
  }

  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued)) {
    return NextResponse.json({ error: "issuedAt must be an ISO timestamp." }, { status: 400 });
  }
  // Kedua arah diperiksa. Cap waktu di masa depan sama mencurigakannya dengan yang kedaluwarsa,
  // dan tanpa batas atas sebuah cap waktu tahun 2100 akan berlaku selamanya.
  const age = Date.now() - issued;
  if (age > MAX_SIGNATURE_AGE_MS || age < -MAX_SIGNATURE_AGE_MS) {
    return NextResponse.json(
      { error: "That signature has expired. Sign again.", code: "SIGNATURE_EXPIRED" },
      { status: 401 }
    );
  }

  const project = findProject(symbol.toLowerCase(), chainId);
  if (!project || project.chainId !== chainId) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  // Gambar divalidasi SEBELUM verifikasi tanda tangan, karena nilai yang sudah dibersihkan
  // itulah yang ikut masuk ke pesan — kalau tidak, klien dan server akan menandatangani dua
  // string berbeda setiap kali pembersihan mengubah sesuatu.
  const rawImage = body.image === undefined || body.image === null ? null : String(body.image);
  if (rawImage !== null) {
    const check = validateProjectImage(rawImage);
    if (!check.ok) {
      return NextResponse.json({ error: check.reason, code: "INVALID_IMAGE" }, { status: 400 });
    }
  }

  const fields = {
    description: String(body.description ?? ""),
    website: String(body.website ?? ""),
    github: String(body.github ?? ""),
    x: String(body.x ?? ""),
    docs: String(body.docs ?? ""),
  };

  const message = buildUpdateMessage({
    chainId,
    symbol,
    ...fields,
    imageFingerprint: imageFingerprint(rawImage),
    issuedAt,
  });

  let signer: string;
  try {
    signer = verifyMessage(message, signature);
  } catch {
    return NextResponse.json({ error: "That signature could not be read." }, { status: 401 });
  }

  if (signer.toLowerCase() !== project.creator.toLowerCase()) {
    // Alamat pemulihan TIDAK dibocorkan di pesan galat. Yang berhak tahu sudah tahu alamatnya,
    // dan yang tidak berhak tidak perlu diberi tahu alamat mana yang seharusnya.
    return NextResponse.json(
      { error: "Only the wallet that launched this market can edit it.", code: "NOT_CREATOR" },
      { status: 403 }
    );
  }

  try {
    const updated = updateProjectMeta(chainId, symbol, {
      description: fields.description,
      links: { website: fields.website, github: fields.github, x: fields.x, docs: fields.docs },
      image: rawImage,
    });
    return NextResponse.json(
      {
        success: true,
        // Yang dikembalikan adalah bentuk TERSIMPAN, bukan yang dikirim. Kalau pembersih
        // membuang sebuah tautan, pengirimnya harus melihatnya hilang sekarang — bukan
        // menyangka tautannya tersimpan lalu menemukannya tidak ada di halaman.
        market: {
          symbol: updated.symbol,
          chainId: updated.chainId,
          description: updated.description,
          links: updated.links,
          image: updated.image,
        },
      },
      { headers: rateLimitHeaders(verdict) }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed." },
      { status: 400 }
    );
  }
}
