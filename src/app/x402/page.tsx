import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CloudLightning,
  Coins,
  KeyRound,
  Receipt,
  ShieldCheck,
  Truck,
} from "lucide-react";

/**
 * Halaman dokumentasi x402.
 *
 * KENAPA RUTENYA SENDIRI, BUKAN SEKSI DI /docs
 *
 * /docs bertugas menjawab "apa yang sudah jadi dan apa yang belum" untuk SELURUH
 * protokol, jadi tiap komponen dapat satu kartu. Yang dibutuhkan integrator x402
 * bukan satu kartu — ia butuh bentuk payload, daftar kode status, dan alamat yang
 * bisa disalin. Menempelkan semuanya ke /docs berarti pembaca yang cuma ingin
 * memeriksa satu alamat kontrak dipaksa melewati spesifikasi HTTP.
 *
 * TIDAK ADA SATU GAMBAR PUN DI SINI, DAN ITU DISENGAJA
 *
 * Diagram alur akan jadi aset yang harus dirawat terpisah dari kode, dan begitu
 * urutannya berubah gambarnya diam-diam jadi salah. Empat langkahnya ditulis
 * sebagai teks bernomor supaya sumbernya satu.
 *
 * SETIAP ANGKA DI HALAMAN INI DIAMBIL DARI RESPONS SUNGGUHAN
 *
 * Harga, alamat, bps, dan kedua hash transaksi dibaca dari endpoint hidup dan dari
 * explorer, bukan dikarang. Yang berubah-ubah — kutipan token dan sisa persediaan —
 * sengaja TIDAK ditulis di sini; halaman statis yang memuat angka bergerak akan
 * basi tanpa memberi tahu siapa pun. Pembaca diarahkan ke payload untuk itu.
 */

/**
 * Hostname sendiri, bukan `*.workers.dev`.
 *
 * Alamat penyedia yang telanjang memberi tahu pembaca di mana sesuatu dihosting alih-alih
 * apa itu, dan pada halaman yang gunanya menyerahkan alamat pembayaran, itu detail yang
 * paling tidak layak menempati baris pertama. `workers.dev` tetap dilayani, jadi klien
 * lama tidak rusak.
 */
const ENDPOINT = "https://x402.adexto.xyz/v1/x402/buy/adexto";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYEE = "0x24268Fffc119ec5550F68e80D94476fD64daE967";

/** Bukti pembelian sungguhan pertama. Kedua kaki, dua chain, satu permintaan. */
const PROOF = [
  {
    leg: "Payment on Base",
    label: "USDC transferWithAuthorization",
    hash: "0x65a79f7b35fb755aee92da2bb11703df1045955188df352ab4dcfc9b18a62190",
    href: "https://basescan.org/tx/0x65a79f7b35fb755aee92da2bb11703df1045955188df352ab4dcfc9b18a62190",
    explorer: "basescan.org",
  },
  {
    leg: "Delivery on 0G",
    label: "curve buy, tokens sent to the buyer",
    hash: "0x7a1583a34e7abd49347b2686bf7c63cf0344f39ec565d85df73ffb502e6d7daf",
    href: "https://chainscan.0g.ai/tx/0x7a1583a34e7abd49347b2686bf7c63cf0344f39ec565d85df73ffb502e6d7daf",
    explorer: "chainscan.0g.ai",
  },
];

const STEPS = [
  {
    icon: Receipt,
    title: "Ask, and read the terms",
    body:
      "A request with no payment header is answered with HTTP 402. The body carries the payment requirements and a full quote: the asset to pay in, the exact amount, the payee, the curve that will fill the order, how much of the target chain's native token gets spent, and the minimum number of tokens the buy will accept.",
  },
  {
    icon: KeyRound,
    title: "Sign a USDC transfer authorization",
    body:
      "Paying means signing an EIP-3009 TransferWithAuthorization for USDC on Base. It is a typed-data signature, not a transaction, so the payer spends no gas and grants no allowance. The signature names the payee and the amount, so neither can be changed after the fact.",
  },
  {
    icon: Truck,
    title: "Delivery runs first",
    body:
      "With a valid authorization in hand, the operator calls buy on the curve on the target chain and passes the payer's address as the recipient. The contract sends the tokens to that address directly. If the buy reverts, the answer is 502 and no payment is taken.",
  },
  {
    icon: Coins,
    title: "Then the charge settles",
    body:
      "Only after a successful delivery is the authorization submitted to USDC on Base. The token contract verifies the signature and moves the funds. Both transaction hashes come back in the response body, and the settlement result is repeated in the X-PAYMENT-RESPONSE header.",
  },
];

const PROPERTIES = [
  {
    title: "The tokens are never held on the buyer's behalf",
    body:
      "The curve's buy takes a recipient argument, and the address that signed the payment is what gets passed in. There is no deposit step and no balance kept for anyone.",
  },
  {
    title: "A used signature cannot be spent twice",
    body:
      "EIP-3009 records the nonce on-chain. A replayed authorization is refused with invalid_transaction_state before anything else happens, and that refusal was confirmed against mainnet USDC.",
  },
  {
    title: "The payee comes from server configuration",
    body:
      "It is read from the worker's own environment, never from a request header or query parameter. An earlier draft accepted the payee from a header, which would have let the caller redirect the funds.",
  },
  {
    title: "The market is resolved from the registry",
    body:
      "A request names a ticker. The curve address behind it is looked up through this site's own market registry, so a caller cannot point protocol funds at an arbitrary contract.",
  },
  {
    title: "The signature is checked against the token, not the request",
    body:
      "The EIP-712 domain is read from the USDC contract itself. Taking the domain from the request would let the payer pick values that make an otherwise invalid signature verify.",
  },
  {
    title: "Capacity is checked before any money moves",
    body:
      "Filling an order means spending native balance the protocol holds, so the size available is capped by that balance. When it runs low the answer is 503 and the authorization stays unspent.",
  },
];

const STATUSES = [
  ["200", "Delivered and charged. Both hashes are in the body."],
  ["202", "Delivered, but the receipt could not be read back in time. Nothing was charged. Check the hash before retrying."],
  ["402", "Either no payment header was sent, or the one sent failed verification. The reason is in errorReason."],
  ["404", "No market matches that ticker in the registry."],
  ["409", "The market exists but is not tradable yet."],
  ["502", "The buy reverted on the target chain. Nothing was charged."],
  ["503", "Capacity or live pricing is unavailable, so no quote is offered. Nothing was charged."],
];

export const metadata = {
  title: "x402 cross-chain buys — ADEXTO",
  description:
    "Pay USDC on Base with an EIP-3009 authorization and receive the token on 0G. HTTP 402 quote, delivery before settlement, both transaction hashes returned.",
};

export default function X402Page() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      {/* Header */}
      <div className="border-b-2 border-line pb-6 mb-10">
        <div className="kicker mb-3">
          <CloudLightning className="w-4 h-4 text-accent" />
          <span>X402 INTEGRATION REFERENCE</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold text-ink">x402 cross-chain buys</h1>
        <p className="text-sm text-ink mt-3 font-medium leading-relaxed">
          One HTTP request buys a token that trades on another chain. The caller pays{" "}
          <strong className="text-ink">0.10 USDC on Base</strong> by signing a transfer authorization, and the
          bonding curve on <strong className="text-ink">0G Mainnet</strong> sends the tokens straight to the
          caller&apos;s own address. No bridging, and no need to hold the target chain&apos;s gas token.
        </p>
        <p className="text-xs text-ink-soft mt-3 leading-relaxed">
          Quote, payment and delivery all run today, and the first purchase was made with real funds — the two
          transactions are linked further down. This page documents the wire format; the numbers that move
          (token amounts and remaining capacity) are always in the response body rather than here.
        </p>
      </div>

      {/* Endpoint */}
      <div className="section-block mb-4 space-y-4">
        <div className="kicker">
          <ArrowRight className="w-4 h-4 text-accent" />
          <span>THE ENDPOINT</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Try it without paying</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          A plain <code className="text-accent">GET</code> returns the terms. Nothing is charged, no wallet is
          needed, and the response is the same one a machine would read before deciding to buy.
        </p>
        <div className="p-3 rounded-lg bg-white border border-line font-mono text-[11px] sm:text-xs text-ink-soft overflow-x-auto">
          <div className="whitespace-pre">curl {ENDPOINT}</div>
        </div>
        <p className="text-xs text-ink-soft leading-relaxed">
          Add <code className="text-accent">?to=0x…</code> to have the tokens delivered somewhere other than the
          signing address. Omit it and the recipient is whoever signed the payment, which is the only party
          proven to own the funds.
        </p>
      </div>

      {/* Payment requirements */}
      <div className="section-block mb-4 space-y-4">
        <div className="kicker">
          <Receipt className="w-4 h-4 text-accent" />
          <span>402 RESPONSE</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">What the challenge contains</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          The response follows x402 version 2. <code className="text-accent">accepts</code> holds the payment
          requirements; <code className="text-accent">quote</code> holds everything specific to this protocol,
          including the curve that will fill the order and the current capacity.
        </p>
        <div className="overflow-x-auto">
          <table className="table-clean w-full text-xs">
            <thead>
              <tr>
                <th className="text-left">Field</th>
                <th className="text-left">Value</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[11px]">
              <tr>
                <td className="text-ink">x402Version</td>
                <td className="text-ink-soft">2</td>
              </tr>
              <tr>
                <td className="text-ink">scheme</td>
                <td className="text-ink-soft">exact</td>
              </tr>
              <tr>
                <td className="text-ink">network</td>
                <td className="text-ink-soft">base</td>
              </tr>
              <tr>
                <td className="text-ink">asset</td>
                <td className="text-ink-soft break-all">{USDC_BASE}</td>
              </tr>
              <tr>
                <td className="text-ink">payTo</td>
                <td className="text-ink-soft break-all">{PAYEE}</td>
              </tr>
              <tr>
                <td className="text-ink">maxAmountRequired</td>
                <td className="text-ink-soft">100000 &nbsp;(0.10 USDC, 6 decimals)</td>
              </tr>
              <tr>
                <td className="text-ink">maxTimeoutSeconds</td>
                <td className="text-ink-soft">300</td>
              </tr>
              <tr>
                <td className="text-ink">extra.transferMethod</td>
                <td className="text-ink-soft">eip3009</td>
              </tr>
              <tr>
                <td className="text-ink">quote.rate.spreadBps</td>
                <td className="text-ink-soft">300</td>
              </tr>
              <tr>
                <td className="text-ink">quote.rate.slippageBps</td>
                <td className="text-ink-soft">150</td>
              </tr>
              <tr>
                <td className="text-ink">quote.deliver.minTokensOut</td>
                <td className="text-ink-soft">floor the buy will not go below</td>
              </tr>
              <tr>
                <td className="text-ink">quote.inventory.remainingBuys</td>
                <td className="text-ink-soft">how many more orders can be filled now</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-soft leading-relaxed">
          The rate is built live: USDC converts to the target chain&apos;s native token at the price feed this
          site publishes, less the spread, and the curve itself quotes the token amount for that native input.
          If the price feed cannot be sourced, the answer is 503 rather than a rate that cannot be backed.
        </p>
      </div>

      {/* Payment header */}
      <div className="section-block mb-4 space-y-4">
        <div className="kicker">
          <KeyRound className="w-4 h-4 text-accent" />
          <span>PAYING</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">The X-PAYMENT header</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          Repeat the request with an <code className="text-accent">X-PAYMENT</code> header containing this object
          as base64-encoded JSON.
        </p>
        <div className="p-3 rounded-lg bg-white border border-line font-mono text-[11px] text-ink-soft overflow-x-auto">
          <pre className="whitespace-pre">{`{
  "x402Version": 2,
  "scheme": "exact",
  "network": "base",
  "payload": {
    "signature": "0x…",
    "authorization": {
      "from":        "0x…",  // the payer
      "to":          "${PAYEE}",
      "value":       "100000",
      "validAfter":  "…",    // must be strictly in the past
      "validBefore": "…",
      "nonce":       "0x…"   // 32 bytes, single use
    }
  }
}`}</pre>
        </div>
        <p className="text-xs text-ink-soft leading-relaxed">
          The signature is EIP-712 typed data of type{" "}
          <code className="text-accent">TransferWithAuthorization</code>, with the domain taken from the USDC
          contract on Base. Use the chain&apos;s block timestamp rather than local clock time when setting the
          validity window: a signature built from a clock that runs ahead of the chain is rejected as not yet
          valid.
        </p>
        <p className="text-xs text-ink-soft leading-relaxed">
          The older <code className="text-accent">X-402-Authorization</code> voucher header is no longer accepted.
          It was a signed statement of intent that no contract could act on, so it could never move funds.
        </p>
      </div>

      {/* Lifecycle */}
      <div className="section-block mb-4 space-y-5">
        <div className="kicker">
          <ArrowRight className="w-4 h-4 text-accent" />
          <span>ORDER OF OPERATIONS</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Four steps, and the order matters</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          Charging first and delivering second would mean holding a buyer&apos;s money while owing them tokens.
          Delivering first means a failed fill costs the protocol instead. That is the direction the risk should
          point, and it matches what the x402 specification recommends: verify, serve, settle.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="card p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-accent-soft text-accent flex items-center justify-center border border-accent/30 shrink-0">
                  <s.icon className="w-3.5 h-3.5" />
                </div>
                <span className="font-mono text-[11px] text-ink-faint font-bold">STEP {i + 1}</span>
              </div>
              <strong className="block text-sm font-bold text-ink">{s.title}</strong>
              <p className="text-xs text-ink-soft leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Security properties */}
      <div className="section-block mb-4 space-y-5">
        <div className="kicker">
          <ShieldCheck className="w-4 h-4 text-ok" />
          <span>WHAT HOLDS, AND WHAT DOES NOT</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">Properties worth checking</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PROPERTIES.map((p) => (
            <div key={p.title} className="card p-4 space-y-1.5">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />
                <strong className="block text-sm font-bold text-ink">{p.title}</strong>
              </div>
              <p className="text-xs text-ink-soft leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
        {/* Batas ini tetap ditulis, dan tempatnya memang di sini.
            Landing page sengaja tidak memuatnya — di sana ia terbaca seperti
            permintaan maaf. Di halaman integrasi ia informasi yang bisa
            ditindaklanjuti: satu-satunya orang yang membaca sejauh ini adalah
            orang yang akan memanggil endpoint-nya. */}
        <div className="p-4 rounded-xl bg-cream-3 border border-line space-y-2">
          <strong className="block text-sm font-bold text-ink">Every fill feeds a burn, and the burn runs itself</strong>
          {/* Kartu ini dulu menyatakan USDC-nya belum tersalur ke vault buyback dan
              direbalance manual. Kalimat itu salah memahami mekanismenya sendiri.

              Tidak ada yang perlu disalurkan: `treasuryNative` HANYA terisi dari kaki
              fee buyback, jadi tidak ada transfer luar yang bisa menambahnya — dan
              pengiriman x402 itu sendiri sebuah `buy` di kurva, sehingga ia sudah
              membayar kaki itu pada setiap fill. Vault-nya terisi sendiri sejak hari
              pertama.

              Yang benar-benar hilang cuma satu: tidak ada yang pernah memanggil
              `executeBuyback`. Dibaca dari chain sebelum ini dibangun,
              `totalTokensBurned` bernilai NOL di kedua pasar sementara vault sudah
              terkumpul dari 20 swap. */}
          <p className="text-xs text-ink-soft leading-relaxed">
            <strong className="text-ink">The burn is funded by the purchase itself.</strong> A delivery is a buy on
            the curve, so it pays the curve&apos;s buyback fee leg and the vault grows on every fill. Nothing has to
            be moved between chains, because <span className="font-mono text-[11px]">treasuryNative</span> can only
            be filled by trading in the first place.
          </p>
          <p className="text-xs text-ink-soft leading-relaxed">
            <strong className="text-ink">It fires on an economic threshold, not on a schedule.</strong> After each
            purchase settles, the endpoint spends the vault to buy and burn — but only once the vault is worth at
            least three times the gas needed to trigger it. Measured on the live curve, one call costs about{" "}
            <span className="font-mono text-[11px]">0.0005 0G</span>, so burning every fill would destroy less value
            than it spent. The threshold is read from chain state, which is what makes it automatic rather than
            supervised. Each response reports the decision and the numbers behind it.
          </p>
          <p className="text-xs text-ink-soft leading-relaxed">
            <strong className="text-ink">Supply has already fallen.</strong> The first buyback spent the vault in
            full and destroyed{" "}
            <span className="font-mono text-[11px]">7.110759702852663544 $ADEXTO</span>, taking total supply from{" "}
            <span className="font-mono text-[11px]">999,999,925.84</span> to{" "}
            <span className="font-mono text-[11px]">999,999,918.73</span>. The burn is permanent and readable on
            chain:{" "}
            <a
              href="https://chainscan.0g.ai/tx/0x792023abdcf0ce1af431cb717a874e0344d1e3f8b84223aeddeaff008ab66bc5"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-accent hover:text-accent-strong break-all"
            >
              0x792023abdcf0ce1af431cb717a874e0344d1e3f8b84223aeddeaff008ab66bc5
            </a>
          </p>
          <p className="text-xs text-ink-soft leading-relaxed">
            <strong className="text-ink">The two legs are not atomic, and that protects the buyer.</strong> Payment
            clears on Base while delivery happens on the target chain. Because the charge is only taken after a
            delivery succeeds, a failed fill costs the protocol and never the buyer.
          </p>
        </div>
      </div>

      {/* Status codes */}
      <div className="section-block mb-4 space-y-4">
        <div className="kicker">
          <Receipt className="w-4 h-4 text-accent" />
          <span>STATUS CODES</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">How each answer should be read</h2>
        <div className="overflow-x-auto">
          <table className="table-clean w-full text-xs">
            <thead>
              <tr>
                <th className="text-left w-16">Code</th>
                <th className="text-left">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {STATUSES.map(([code, meaning]) => (
                <tr key={code}>
                  <td className="font-mono text-[11px] font-bold text-ink align-top">{code}</td>
                  <td className="text-ink-soft">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-soft leading-relaxed">
          Only <code className="text-accent">200</code> means money changed hands. On{" "}
          <code className="text-accent">202</code> the buy was submitted but unconfirmed, so retrying may purchase
          twice — read the transaction first.
        </p>
      </div>

      {/* Proof */}
      <div className="section-block mb-4 space-y-4">
        <div className="kicker">
          <CheckCircle2 className="w-4 h-4 text-ok" />
          <span>DONE WITH REAL FUNDS</span>
        </div>
        <h2 className="text-2xl font-semibold text-ink tracking-tight">The first purchase, on two explorers</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          One request produced both of these. USDC left the payer on Base and reached the treasury address; on 0G
          the curve delivered the tokens to the buyer, above the quoted floor. Round trip was 16.2 seconds.
        </p>
        <div className="space-y-3">
          {PROOF.map((p) => (
            <div key={p.hash} className="card p-4 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm font-bold text-ink">{p.leg}</strong>
                <span className="text-[10px] font-mono text-ink-faint uppercase tracking-wide">{p.explorer}</span>
              </div>
              <p className="text-xs text-ink-soft">{p.label}</p>
              <a
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block font-mono text-[10px] sm:text-[11px] text-accent hover:text-accent-strong break-all"
              >
                {p.hash}
              </a>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-soft leading-relaxed">
          Replay protection was checked the same way. Submitting an already-settled authorization a second time is
          refused with <code className="text-accent">invalid_transaction_state</code>, and no second transfer is
          broadcast.
        </p>
      </div>

      {/* Next steps */}
      <div className="section-block space-y-4">
        <div className="kicker">
          <ArrowRight className="w-4 h-4 text-accent" />
          <span>FROM HERE</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link href="/agent/demo" className="card card-hover p-4 block space-y-1.5">
            <strong className="block text-sm font-bold text-ink">Agent demo</strong>
            <p className="text-xs text-ink-soft leading-relaxed">
              Fire the unpaid request from the browser and read the 402 challenge as it comes back.
            </p>
            <span className="text-xs font-bold text-accent inline-flex items-center gap-1">
              Open the demo <ArrowRight className="w-3 h-3" />
            </span>
          </Link>
          <Link href="/docs" className="card card-hover p-4 block space-y-1.5">
            <strong className="block text-sm font-bold text-ink">Technical status</strong>
            <p className="text-xs text-ink-soft leading-relaxed">
              Where this sits against the rest of the protocol, plus the deployed contract addresses.
            </p>
            <span className="text-xs font-bold text-accent inline-flex items-center gap-1">
              Read the status page <ArrowRight className="w-3 h-3" />
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
