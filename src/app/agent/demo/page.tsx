"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Play, Terminal, CheckCircle2, RefreshCw, Code2, CloudLightning, AlertCircle, ExternalLink, Copy, Check,
} from "lucide-react";

/**
 * x402 payment-challenge demo.
 *
 * KENAPA HALAMAN INI DITULIS ULANG SELURUHNYA
 *
 * Versi sebelumnya tidak melakukan satu pun permintaan jaringan. Tombolnya
 * memanggil `setTimeout` yang mencetak empat baris log tetap —
 * "Provisioning AMD SEV-SNP Enclave…" — lalu menampilkan objek JSON yang
 * seluruhnya ditulis tangan di dalam komponen: id ray Cloudflare palsu, latensi
 * "34ms" palsu, alamat pembayar palsu, tanda tangan proof yang bahkan tidak
 * berpanjang benar, dan hasil karangan seperti "curve_health: Optimal (99.8/100)"
 * dan "treasury_buyback_queued: 284.10 AEGIS scheduled at next block".
 *
 * Judulnya "Live Edge Micro-Payment & TEE Call", dan teksnya mengajak pengunjung
 * "witness live edge verification & 0G TEE attestation in real-time". Tidak ada
 * yang live dan tidak ada attestation. Ini bagian paling merugikan di seluruh
 * situs: siapa pun yang membuka panel Network peramban akan melihat nol
 * permintaan, dan sesudah itu tidak ada satu pun angka di situs ini yang masih
 * dia percaya.
 *
 * Yang menyakitkan: gerbang x402 yang SUNGGUHAN memang sudah berjalan. Worker-nya
 * ter-deploy dan menjawab permintaan tanpa pembayaran dengan HTTP 402 berisi
 * harga dan alamat vault penyelesaian. Jadi kami memasang tiruan di depan sesuatu
 * yang aslinya bekerja.
 *
 * Halaman ini sekarang memanggil endpoint asli, menampilkan status, badan jawaban,
 * dan waktu bolak-balik yang benar-benar terukur di peramban pengunjung — lalu
 * menyatakan dengan jelas bahwa yang hidup adalah separuh PENEMUAN dari x402, dan
 * penyelesaian pembayarannya belum tersambung.
 *
 * Endpoint yang dulu terdaftar (`https://edge.adexto.xyz/audit/v1` dan dua
 * saudaranya) semuanya mati — subdomainnya belum pernah dipasang dan membalas
 * HTTP 525. URL Worker yang benar dipakai di bawah.
 */

/** Worker yang benar-benar ter-deploy. Subdomain edge.adexto.xyz belum dipasang. */
const GATEWAY = "https://adexto-x402-edge.cucuvirtual.workers.dev/v1/x402";

/**
 * Satu jalur contoh.
 *
 * Dulu di sini ada tiga "agent route" — AEGIS, QNOVA, CSENT — masing-masing
 * dengan harga berbeda. Dua hal salah sekaligus. QNOVA dan CSENT tidak pernah
 * dicetak factory, jadi halaman ini mengiklankan agen milik token yang tidak
 * ada. Dan worker TIDAK membedakan harga per ticker: ia mengembalikan ketiga
 * kelas harga yang sama untuk ticker apa pun, lalu sekadar menggemakan ticker
 * itu di field `agent`. Jadi peta "QNOVA = 0.005" adalah karangan halaman ini,
 * bukan kutipan dari gerbangnya.
 *
 * Yang tertinggal adalah apa yang benar: satu jalur contoh, dan ketiga kelas
 * harga apa adanya sebagaimana muncul di jawaban 402 di sebelah kanan.
 */
const DEMO_AGENT = "adexto";

/** Persis seperti yang dikembalikan worker di objek `pricing`, untuk ticker apa pun. */
const QUOTED_CLASSES: Array<{ key: string; price: string; purpose: string }> = [
  { key: "inferenceQuery", price: "0.005 USDC", purpose: "one inference call" },
  { key: "quantSignal", price: "0.010 USDC", purpose: "curve depth and slippage report" },
  { key: "customExecution", price: "0.020 USDC", purpose: "custom execution" },
];

interface Attempt {
  status: number;
  statusText: string;
  ms: number;
  body: string;
  url: string;
}

export default function AgentDemoPage() {
  const route = DEMO_AGENT;
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url = `${GATEWAY}/${route}`;
  const curl = `curl -i ${url}`;

  const call = async () => {
    setBusy(true);
    setAttempt(null);
    setFailure(null);
    // Diukur di peramban pengunjung. Angka apa pun yang ditampilkan halaman ini
    // harus berasal dari permintaan yang baru saja terjadi, bukan dari konstanta.
    const started = performance.now();
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      const ms = Math.round(performance.now() - started);
      const raw = await res.text();
      let body = raw;
      try {
        body = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // bukan JSON; tampilkan apa adanya
      }
      setAttempt({ status: res.status, statusText: res.statusText, ms, body, url });
    } catch (e) {
      setFailure((e as Error).message || "request failed");
    } finally {
      setBusy(false);
    }
  };

  const copyCurl = () => {
    navigator.clipboard.writeText(curl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="border-b border-line pb-6 mb-8">
        <p className="kicker mb-3">x402 payment challenge</p>
        <h1 className="text-3xl font-semibold text-ink">An endpoint that quotes its own price</h1>
        <p className="text-sm text-ink-soft mt-2 max-w-2xl leading-relaxed">
          Every agent route answers an unpaid request with HTTP 402 and a machine-readable quote: the price, the
          assets it accepts, and the vault that should receive payment. The button below performs that request
          from your browser and prints exactly what came back.
        </p>
      </div>

      {/* Ruang lingkup dinyatakan di muka, bukan disembunyikan di catatan kaki. */}
      <div className="mb-8 rounded-2xl border border-warn/30 bg-warn/10 p-4 flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed text-ink-soft">
          <strong className="text-ink">This is the discovery half of x402.</strong> The challenge is live and
          the quote is real. Paying it is not implemented: the gateway does not yet verify an EIP-712 voucher,
          settle on-chain, or forward revenue to a buyback vault. Nothing on this page is simulated — if the
          request fails, you will see the failure.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: route picker */}
        <div className="lg:col-span-5 space-y-4">
          <div className="card p-5 space-y-3">
            <h2 className="text-[10px] uppercase tracking-wider text-ink-faint font-bold">What it quotes</h2>
            <p className="text-[11px] leading-relaxed text-ink-soft">
              The gateway returns these three price classes for any ticker in the path. The ticker is echoed back
              in the <code className="font-mono text-ink-soft">agent</code> field; it does not change the quote.
            </p>
            <div className="space-y-2">
              {QUOTED_CLASSES.map((c) => (
                <div key={c.key} className="rounded-xl border border-line bg-white p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-ink">{c.key}</span>
                    <span className="rounded border border-line bg-cream-2 px-2 py-0.5 font-mono text-[10px] text-ink-soft">
                      {c.price}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-soft">{c.purpose}</p>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={call}
            disabled={busy}
            className="w-full py-4 rounded-xl font-semibold text-xs bg-accent hover:bg-accent-strong text-white transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:bg-cream-3 disabled:text-ink-soft"
          >
            {busy ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Requesting…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> GET the ${DEMO_AGENT.toUpperCase()} route
              </>
            )}
          </button>

          {/* Verifikasi tanpa memercayai halaman ini. */}
          <div className="card p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                Check it yourself
              </span>
              <button
                type="button"
                onClick={copyCurl}
                className="flex items-center gap-1 font-mono text-[10px] font-bold text-accent hover:underline"
              >
                {copied ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />}
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <code className="block overflow-x-auto whitespace-pre rounded-lg border border-line bg-cream-2 p-2.5 font-mono text-[10px] text-ink">
              {curl}
            </code>
            <p className="text-[10px] leading-relaxed text-ink-faint">
              A browser cannot read the <code className="text-ink-soft">WWW-Authenticate</code> header on a
              cross-origin response, so curl shows one thing this page cannot.
            </p>
          </div>
        </div>

        {/* Right: raw response */}
        <div className="lg:col-span-7">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-line bg-cream-2 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-accent" />
                <span className="font-mono text-xs font-bold text-ink">Response</span>
              </div>
              {attempt && (
                <div className="flex items-center gap-2 font-mono text-[10px]">
                  <span
                    className={`rounded border px-2 py-0.5 font-bold ${
                      attempt.status === 402
                        ? "border-ok/30 bg-ok/10 text-ok"
                        : "border-warn/30 bg-warn/10 text-warn"
                    }`}
                  >
                    HTTP {attempt.status}
                  </span>
                  <span className="text-ink-soft" data-numeric>
                    {attempt.ms} ms round trip
                  </span>
                </div>
              )}
            </div>

            <div className="min-h-[340px] p-4 font-mono text-[11px]">
              {failure ? (
                <div className="flex items-start gap-2 text-danger">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">Request failed</p>
                    <p className="text-ink-soft">{failure}</p>
                    <p className="text-ink-faint">
                      The gateway is a single Cloudflare Worker. If it is down, this page says so instead of
                      printing a result.
                    </p>
                  </div>
                </div>
              ) : attempt ? (
                <div className="space-y-3">
                  <div className="text-ink-faint break-all">GET {attempt.url}</div>
                  {attempt.status === 402 && (
                    <div className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 p-2.5 text-ink-soft">
                      <CheckCircle2 className="w-3.5 h-3.5 text-ok shrink-0 mt-0.5" />
                      <span>
                        402 is the expected answer. The route is telling an unpaid caller what it would cost.
                      </span>
                    </div>
                  )}
                  <pre className="overflow-x-auto whitespace-pre leading-relaxed text-ink">{attempt.body}</pre>
                </div>
              ) : (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center text-ink-soft">
                  <Code2 className="w-7 h-7 text-ink-faint" />
                  <p className="text-xs">No request made yet.</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <a
              href={GATEWAY.replace("/v1/x402", "")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline"
            >
              <CloudLightning className="w-3.5 h-3.5" /> Gateway root
              <ExternalLink className="w-3 h-3" />
            </a>
            <Link href="/docs" className="font-semibold text-ink-soft hover:text-ink hover:underline underline-offset-4">
              How the fee split and buyback vault work
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
