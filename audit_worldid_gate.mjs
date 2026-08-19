/**
 * ADEXTO — bukti gerbang World ID 4.0 benar-benar menutup, bukan hanya tampil.
 *
 * Verifikasi sesungguhnya memanggil layanan World dan menuntut proof dari World
 * App asli, yang tidak bisa dihasilkan pengujian otomatis. Harness ini karena itu
 * menjalankan STUB verifier lokal dan mengarahkan server ke sana lewat
 * WORLD_ID_VERIFY_URL. Yang diuji adalah bagian yang benar-benar milik kita:
 *
 *   1. Tanda tangan RP diterbitkan server, dan KUNCI PRIVAT tidak ikut keluar.
 *   2. Gerbang MENUTUP: /api/deploy menolak launch tanpa token World ID.
 *   3. Payload yang ditolak verifier tidak menghasilkan token.
 *   4. Payload sah menghasilkan token, dan token itu meloloskan tahap prepare.
 *   5. Token TERIKAT ke alamat: wallet lain tidak bisa memakainya.
 *   6. Nullifier terikat ke wallet: manusia yang sama tidak bisa pindah wallet.
 *   7. Nullifier DINORMALKAN: beda kapitalisasi/awalan tetap orang yang sama.
 *   8. Proof v3 lama ditolak selama mode legacy tidak dinyalakan.
 *   9. Token palsu, rusak, dan kedaluwarsa ditolak.
 *  10. UI: tombol launch terkunci sebelum World ID, walau attestation sudah ada.
 *
 * Prasyarat server: NEXT_PUBLIC_WORLD_ID_APP_ID, NEXT_PUBLIC_WORLD_ID_ACTION,
 * WORLD_ID_RP_ID, WORLD_ID_SIGNING_KEY, WORLD_ID_TOKEN_SECRET,
 * WORLD_ID_VERIFY_URL=http://127.0.0.1:3199
 */
import http from "node:http";
import { ethers } from "ethers";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const STUB_PORT = Number(process.env.STUB_PORT || 3199);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "LULUS" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
const step = (s) => console.log(`\n${"=".repeat(78)}\n${s}\n${"=".repeat(78)}`);

/**
 * Stub verifier World. Menerima payload yang proof-nya memuat "valid", menolak
 * sisanya. Juga memeriksa server memanggil jalur v4 yang benar.
 */
let stubHits = [];
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {}
    stubHits.push({ url: req.url, protocol: parsed?.protocol_version });
    const first = Array.isArray(parsed?.responses) ? parsed.responses[0] : null;
    const proofStr = JSON.stringify(first?.proof ?? "");
    const ok = proofStr.includes("valid") && /^\/api\/v4\/verify\/rp_/.test(req.url || "");
    res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { success: true } : { success: false, code: "invalid_proof", detail: "stub rejected" }));
  });
});

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

/** Payload berbentuk v4, sesuai ResponseItemV4 di idkit-core. */
const v4Payload = (nullifier, proof = "valid-proof") => ({
  protocol_version: "4.0",
  nonce: "0x" + "11".repeat(32),
  action: "launch-token",
  environment: "production",
  responses: [
    {
      identifier: "proof_of_human",
      proof: [proof, "0x02", "0x03", "0x04", "0x05"],
      nullifier,
      issuer_schema_id: 1,
      expires_at_min: Math.floor(Date.now() / 1000) + 86_400,
    },
  ],
});

/** Attestation asli, supaya yang gagal nanti benar-benar gerbang World ID. */
async function attestationFor(wallet) {
  const message = `ADEXTO launch attestation\nAddress: ${wallet.address}\nTimestamp: ${Date.now()}`;
  return { attestationMessage: message, attestationSignature: await wallet.signMessage(message) };
}

const prepareBody = async (wallet, extra) => ({
  stage: "prepare",
  name: "World ID Gate Probe",
  symbol: `WID${Math.floor(Math.random() * 900 + 100)}`,
  supply: "1000000000",
  swapFee: 0.3,
  treasuryCut: 0.05,
  model: "glm-5.2",
  persona: "gate probe",
  deployer: wallet.address,
  ...(await attestationFor(wallet)),
  ...extra,
});

(async () => {
  await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
  console.log(`stub verifier World di http://127.0.0.1:${STUB_PORT}`);

  const gate = await fetch(`${BASE}/api/worldid/verify`).then((r) => r.json());
  console.log(`gerbang: ${gate.gate}  protokol=${gate.protocol}  app=${gate.appId ?? "-"}  action=${gate.action ?? "-"}\n`);

  // Dua mode diuji harness yang sama. Mode MATI bukan alasan berhenti: justru di
  // sanalah harus dibuktikan UI menyatakan keadaannya apa adanya.
  if (!gate.enabled) {
    step("MODE GERBANG MATI — harus jujur, bukan mengaku terlindungi");
    check("server melaporkan wallet-signature-only", gate.gate === "wallet-signature-only", gate.gate);
    check("appId tidak dibocorkan saat mati", gate.appId === null);

    const sig = await post("/api/worldid/signature");
    check("tanda tangan RP ditolak saat gerbang mati", sig.status === 503, `HTTP ${sig.status} ${sig.data.code ?? ""}`);

    const w = ethers.Wallet.createRandom();
    const res = await post("/api/deploy", await prepareBody(w, {}));
    check("launch TIDAK menuntut token World ID saat gerbang mati", res.status !== 401, `HTTP ${res.status}`);

    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`${BASE}/studio`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    check("studio menandai NOT CONFIGURED", /NOT CONFIGURED/i.test(text));
    check("tidak menawarkan tombol verifikasi yang mustahil", (await page.locator('button:has-text("Verify with World ID")').count()) === 0);
    await browser.close();

    step("RINGKASAN");
    console.log(`  ${pass} LULUS / ${fail} GAGAL`);
    stub.close();
    process.exit(fail === 0 ? 0 : 1);
  }

  const human = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();

  step("1) TANDA TANGAN RP — diterbitkan server, kunci privat tidak ikut keluar");
  const sig = await post("/api/worldid/signature");
  check("tanda tangan diterbitkan", sig.status === 200 && Boolean(sig.data?.rpContext), `HTTP ${sig.status}`);
  const rp = sig.data?.rpContext ?? {};
  check("rp_id disertakan", /^rp_/.test(rp.rp_id ?? ""), rp.rp_id);
  check("tanda tangan 65 byte", /^0x[0-9a-f]{130}$/i.test(rp.signature ?? ""), `${(rp.signature ?? "").length} char`);
  check("nonce 32 byte", /^0x[0-9a-f]{64}$/i.test(rp.nonce ?? ""));
  check("jendela waktu masuk akal", rp.expires_at > rp.created_at, `${rp.expires_at - rp.created_at}s`);
  const leaked = JSON.stringify(sig.data).toLowerCase();
  check("kunci penanda tangan TIDAK ada di respons", !leaked.includes("signingkey") && !leaked.includes("private"));

  step("2) GERBANG MENUTUP — launch tanpa token World ID");
  const noToken = await post("/api/deploy", await prepareBody(human, {}));
  check("prepare ditolak tanpa token", noToken.status === 401, `HTTP ${noToken.status} ${noToken.data.code ?? ""}`);
  check("alasannya menyebut World ID", /world id/i.test(noToken.data.error ?? ""), noToken.data.error);

  step("3) PAYLOAD DITOLAK VERIFIER — tidak boleh menghasilkan token");
  const bad = await post("/api/worldid/verify", { address: human.address, payload: v4Payload("0x1234", "forged") });
  check("verifikasi gagal", bad.status === 401, `HTTP ${bad.status} ${bad.data.code ?? ""}`);
  check("tidak ada token diterbitkan", !bad.data.token);

  step("4) PAYLOAD SAH — token diterbitkan dan meloloskan prepare");
  const nullifierHex = "0xAbCdEf0123456789";
  const good = await post("/api/worldid/verify", { address: human.address, payload: v4Payload(nullifierHex) });
  check("verifikasi lolos", good.status === 200, `HTTP ${good.status} ${good.data.error ?? ""}`);
  check("token diterbitkan", typeof good.data.token === "string" && good.data.token.split(".").length === 3);
  check("protokol dilaporkan 4.0", good.data.protocolVersion === "4.0", good.data.protocolVersion);
  check("server memanggil jalur v4 yang benar", stubHits.some((h) => /^\/api\/v4\/verify\/rp_/.test(h.url)), stubHits.at(-1)?.url);

  const withToken = await post("/api/deploy", await prepareBody(human, { worldIdToken: good.data.token }));
  check("prepare lolos dengan token sah", withToken.status === 200, `HTTP ${withToken.status} ${withToken.data.error ?? ""}`);
  check("server melaporkan gerbang world-id-zkp", withToken.data.sybilGate === "world-id-zkp", withToken.data.sybilGate);

  step("5) TOKEN TERIKAT ALAMAT — wallet lain tidak boleh memakainya");
  const stolen = await post("/api/deploy", await prepareBody(other, { worldIdToken: good.data.token }));
  check("token wallet lain ditolak", stolen.status === 401, `HTTP ${stolen.status} ${stolen.data.code ?? ""}`);

  step("6) NULLIFIER TERIKAT WALLET — manusia sama tidak boleh pindah wallet");
  const moved = await post("/api/worldid/verify", { address: other.address, payload: v4Payload(nullifierHex) });
  check("nullifier sama di wallet lain ditolak", moved.status === 409, `HTTP ${moved.status} ${moved.data.code ?? ""}`);
  check("kodenya WORLDID_BOUND_ELSEWHERE", moved.data.code === "WORLDID_BOUND_ELSEWHERE", moved.data.code);

  step("7) NULLIFIER DINORMALKAN — beda kapitalisasi tetap orang yang sama");
  // Ini bug nyata sebelum normalisasi: hex mentah dipakai sebagai kunci simpanan,
  // jadi 0xAB… dan 0xab… terhitung dua orang dan satu manusia bisa lolos dua kali.
  for (const [label, variant] of [
    ["huruf kecil", nullifierHex.toLowerCase()],
    ["huruf besar", "0x" + nullifierHex.slice(2).toUpperCase()],
    ["tanpa awalan 0x", nullifierHex.slice(2)],
    ["dengan nol di depan", "0x0000" + nullifierHex.slice(2)],
  ]) {
    const r = await post("/api/worldid/verify", { address: other.address, payload: v4Payload(variant) });
    check(`  ${label} dikenali sebagai orang yang sama`, r.status === 409, `HTTP ${r.status} ${r.data.code ?? ""}`);
  }

  step("7b) MODE KETAT — chain ke-2..4 dari peluncuran SAMA tidak boleh diblokir");
  // Bug laten yang pernah ada: kuota dihitung dengan penghitung yang dinaikkan
  // setiap tahap confirm, sementara launch multi-chain memanggil confirm sekali
  // PER CHAIN. Jadi mode ketat memblokir chain kedua dari peluncuran yang sama —
  // memblokir fitur utama produk, bukan Sybil. Sekarang kuota dihitung per ticker.
  const strictHuman = ethers.Wallet.createRandom();
  const strictNull = `0xfeed${Date.now().toString(16)}`;
  const sv = await post("/api/worldid/verify", { address: strictHuman.address, payload: v4Payload(strictNull) });
  check("verifikasi mode ketat lolos", sv.status === 200, `HTTP ${sv.status}`);
  const sharedTicker = `MC${Math.floor(Math.random() * 900 + 100)}`;
  // Empat tahap prepare dengan token yang sama, meniru satu peluncuran 4 chain.
  let sameTickerOk = 0;
  for (let i = 0; i < 4; i++) {
    const r = await post("/api/deploy", await prepareBody(strictHuman, { worldIdToken: sv.data.token, symbol: sharedTicker }));
    if (r.status === 200) sameTickerOk++;
  }
  check("empat chain dengan ticker sama semuanya lolos", sameTickerOk === 4, `${sameTickerOk}/4`);

  step("8) PROOF v3 LAMA — ditolak selama mode legacy mati");
  const legacy = await post("/api/worldid/verify", {
    address: human.address,
    payload: { ...v4Payload("0x99"), protocol_version: "3.0" },
  });
  check("proof v3 ditolak", legacy.status === 400 && legacy.data.code === "WORLDID_LEGACY_PROOF", `HTTP ${legacy.status} ${legacy.data.code ?? ""}`);

  step("9) TOKEN RUSAK / DIPALSUKAN / KEDALUWARSA");
  const tampered = `${good.data.token.slice(0, -4)}dead`;
  const forged = await post("/api/deploy", await prepareBody(human, { worldIdToken: tampered }));
  check("HMAC yang tidak cocok ditolak", forged.status === 401, `HTTP ${forged.status} ${forged.data.code ?? ""}`);

  const malformed = await post("/api/deploy", await prepareBody(human, { worldIdToken: "bukan-token" }));
  check("token tanpa bentuk yang benar ditolak", malformed.status === 401, `HTTP ${malformed.status} ${malformed.data.code ?? ""}`);

  const expired = await post("/api/deploy", await prepareBody(human, { worldIdToken: `1.12345.deadbeef` }));
  check("token kedaluwarsa ditolak", expired.status === 401, `HTTP ${expired.status} ${expired.data.code ?? ""}`);

  step("10) UI STUDIO — tombol launch terkunci sebelum World ID");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();
  const uiWallet = ethers.Wallet.createRandom();
  await page.addInitScript(`window.__ACCOUNT__ = "${uiWallet.address}";`);
  await page.exposeFunction("__sign", (msg) => uiWallet.signMessage(ethers.getBytes(msg)));
  await ctx.addInitScript(`
    window.ethereum = {
      isMetaMask: true, _cbs: {},
      on(ev, cb) { (this._cbs[ev] = this._cbs[ev] || []).push(cb); },
      removeListener() {},
      async request({ method, params }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [window.__ACCOUNT__];
        if (method === "eth_chainId") return "0x40da";
        if (method === "personal_sign") return await window.__sign(params[0]);
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
        return null;
      },
    };
  `);
  await page.goto(`${BASE}/studio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const bodyText = await page.evaluate(() => document.body.innerText);
  check("panel World ID menyatakan gerbang aktif", /verified server-side/i.test(bodyText));
  check("tidak mengaku NOT CONFIGURED saat aktif", !/NOT CONFIGURED/i.test(bodyText));
  check("tombol Verify with World ID tersedia", (await page.locator('button:has-text("Verify with World ID")').count()) > 0);

  const connect = page.locator('button:has-text("Connect")').first();
  if ((await connect.count()) > 0) {
    await connect.click();
    await page.waitForTimeout(1200);
  }
  const signBtn = page.getByRole("button", { name: "Sign attestation", exact: true });
  if ((await signBtn.count()) > 0) {
    await signBtn.click();
    await page.waitForTimeout(2500);
  }
  check("attestation tertandatangani", (await page.locator("text=SIGNED").count()) > 0);

  // Tombolnya HARUS ada dulu, kalau tidak asersi "terkunci" lolos hanya karena
  // tombolnya tidak pernah dirender — misalnya saat tidak ada chain berfactory.
  const launchBtn = page.locator('button:has-text("Launch on")').first();
  const launchCount = await launchBtn.count();
  check("tombol launch dirender (ada chain berfactory)", launchCount > 0);
  check(
    "tombol launch TERKUNCI walau attestation sudah ada",
    launchCount > 0 && (await launchBtn.isDisabled()),
    launchCount > 0 ? ((await launchBtn.textContent()) ?? "").replace(/\s+/g, " ").trim() : "tombol tidak dirender"
  );
  await browser.close();

  step("RINGKASAN");
  console.log(`  ${pass} LULUS / ${fail} GAGAL`);
  stub.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error("FATAL:", err.message);
  stub.close();
  process.exit(1);
});
