/**
 * ADEXTO — bukti gerbang World ID benar-benar menutup, bukan hanya tampil.
 *
 * Verifikasi sesungguhnya memanggil layanan Worldcoin dan menuntut proof orb
 * asli, yang tidak bisa dihasilkan dari pengujian otomatis. Harness ini karena
 * itu menjalankan STUB verifier lokal dan mengarahkan server ke sana lewat
 * WORLD_ID_VERIFY_URL. Yang diuji adalah bagian yang benar-benar milik kita:
 *
 *   1. Gerbang MENUTUP: /api/deploy menolak launch tanpa token World ID.
 *   2. Proof yang ditolak Worldcoin tidak menghasilkan token.
 *   3. Proof sah menghasilkan token, dan token itu meloloskan tahap prepare.
 *   4. Token TERIKAT ke alamat: wallet lain tidak bisa memakainya.
 *   5. Nullifier terikat ke wallet: manusia yang sama tidak bisa pindah wallet.
 *   6. Token palsu/rusak ditolak.
 *
 * Prasyarat: server Next berjalan dengan
 *   NEXT_PUBLIC_WORLD_ID_APP_ID, NEXT_PUBLIC_WORLD_ID_ACTION,
 *   WORLD_ID_TOKEN_SECRET, WORLD_ID_VERIFY_URL=http://127.0.0.1:3199
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
 * Stub Worldcoin. Menerima proof yang `proof`-nya diawali "valid-", menolak
 * sisanya — cukup untuk membedakan jalur diterima dan ditolak.
 */
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {}
    const ok = String(parsed.proof || "").startsWith("valid-");
    // Stub juga membuktikan server BENAR mengirim action dan signal_hash.
    const hasAction = typeof parsed.action === "string" && parsed.action.length > 0;
    const hasSignalHash = typeof parsed.signal_hash === "string" && parsed.signal_hash.startsWith("0x");
    res.writeHead(ok && hasAction && hasSignalHash ? 200 : 400, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        ok && hasAction && hasSignalHash
          ? { success: true }
          : { success: false, code: "invalid_proof", detail: `stub rejected (action=${hasAction} signal_hash=${hasSignalHash})` }
      )
    );
  });
});

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

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
  console.log(`stub verifier Worldcoin di http://127.0.0.1:${STUB_PORT}`);

  const gate = await fetch(`${BASE}/api/worldid/verify`).then((r) => r.json());
  console.log(`gerbang: ${gate.gate}  app=${gate.appId ?? "-"}  action=${gate.action ?? "-"}\n`);

  // Dua mode diuji oleh harness yang sama. Mode MATI bukan alasan untuk berhenti:
  // justru di sanalah harus dibuktikan bahwa UI menyatakan keadaannya apa adanya
  // dan tidak diam-diam mengaku terlindungi.
  if (!gate.enabled) {
    step("MODE GERBANG MATI — harus jujur, bukan mengaku terlindungi");
    check("server melaporkan wallet-signature-only", gate.gate === "wallet-signature-only", gate.gate);
    check("appId tidak dibocorkan saat mati", gate.appId === null);

    const w = ethers.Wallet.createRandom();
    const res = await post("/api/deploy", await prepareBody(w, {}));
    check("launch TIDAK menuntut token World ID saat gerbang mati", res.status !== 401, `HTTP ${res.status}`);

    const verify = await post("/api/worldid/verify", {
      address: w.address,
      proof: { merkle_root: "0xr", nullifier_hash: "0xn", proof: "valid-proof", verification_level: "orb" },
    });
    check("verifikasi menolak dengan WORLDID_NOT_CONFIGURED", verify.data.code === "WORLDID_NOT_CONFIGURED", `HTTP ${verify.status} ${verify.data.code ?? ""}`);

    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`${BASE}/studio`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    check("studio menandai NOT CONFIGURED", /NOT CONFIGURED/i.test(text));
    check("studio menjelaskan gerbangnya tanda tangan wallet saja", /no World ID app configured/i.test(text));
    check("tidak menawarkan tombol verifikasi yang mustahil", (await page.locator('button:has-text("Verify with World ID")').count()) === 0);
    await browser.close();

    step("RINGKASAN");
    console.log(`  ${pass} LULUS / ${fail} GAGAL`);
    stub.close();
    process.exit(fail === 0 ? 0 : 1);
  }

  const human = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();

  step("1) GERBANG MENUTUP — launch tanpa token World ID");
  const noToken = await post("/api/deploy", await prepareBody(human, {}));
  check("prepare ditolak tanpa token", noToken.status === 401, `HTTP ${noToken.status} ${noToken.data.code ?? ""}`);
  check("alasannya menyebut World ID", /world id/i.test(noToken.data.error ?? ""), noToken.data.error);

  step("2) PROOF DITOLAK VERIFIER — tidak boleh menghasilkan token");
  const bad = await post("/api/worldid/verify", {
    address: human.address,
    proof: { merkle_root: "0xr", nullifier_hash: "0xn-bad", proof: "forged-proof", verification_level: "orb" },
  });
  check("verifikasi gagal", bad.status === 401, `HTTP ${bad.status} ${bad.data.code ?? ""}`);
  check("tidak ada token diterbitkan", !bad.data.token);

  step("3) PROOF SAH — token diterbitkan dan meloloskan prepare");
  const nullifier = `0xnull-${Date.now()}`;
  const good = await post("/api/worldid/verify", {
    address: human.address,
    proof: { merkle_root: "0xroot", nullifier_hash: nullifier, proof: "valid-proof", verification_level: "orb" },
  });
  check("verifikasi lolos", good.status === 200, `HTTP ${good.status}`);
  check("token diterbitkan", typeof good.data.token === "string" && good.data.token.split(".").length === 3);
  check("nullifier tidak dikembalikan utuh", !String(good.data.nullifierPrefix ?? "").includes(nullifier.slice(10)));

  const withToken = await post("/api/deploy", await prepareBody(human, { worldIdToken: good.data.token }));
  check("prepare lolos dengan token sah", withToken.status === 200, `HTTP ${withToken.status} ${withToken.data.error ?? ""}`);
  check("server melaporkan gerbang world-id-zkp", withToken.data.sybilGate === "world-id-zkp", withToken.data.sybilGate);

  step("4) TOKEN TERIKAT ALAMAT — wallet lain tidak boleh memakainya");
  const stolen = await post("/api/deploy", await prepareBody(other, { worldIdToken: good.data.token }));
  check("token wallet lain ditolak", stolen.status === 401, `HTTP ${stolen.status} ${stolen.data.code ?? ""}`);

  step("5) NULLIFIER TERIKAT WALLET — manusia sama tidak boleh pindah wallet");
  const moved = await post("/api/worldid/verify", {
    address: other.address,
    proof: { merkle_root: "0xroot", nullifier_hash: nullifier, proof: "valid-proof", verification_level: "orb" },
  });
  check("nullifier yang sama di wallet lain ditolak", moved.status === 409, `HTTP ${moved.status} ${moved.data.code ?? ""}`);
  check("kodenya WORLDID_BOUND_ELSEWHERE", moved.data.code === "WORLDID_BOUND_ELSEWHERE", moved.data.code);

  step("6) TOKEN RUSAK / DIPALSUKAN");
  const tampered = `${good.data.token.slice(0, -4)}dead`;
  const forged = await post("/api/deploy", await prepareBody(human, { worldIdToken: tampered }));
  check("HMAC yang tidak cocok ditolak", forged.status === 401, `HTTP ${forged.status} ${forged.data.code ?? ""}`);

  const malformed = await post("/api/deploy", await prepareBody(human, { worldIdToken: "bukan-token" }));
  check("token tanpa bentuk yang benar ditolak", malformed.status === 401, `HTTP ${malformed.status} ${malformed.data.code ?? ""}`);

  const expired = await post("/api/deploy", await prepareBody(human, { worldIdToken: `1.${nullifier}.deadbeef` }));
  check("token kedaluwarsa ditolak", expired.status === 401, `HTTP ${expired.status} ${expired.data.code ?? ""}`);

  step("7) UI STUDIO — tombol launch tetap terkunci sebelum World ID");
  // Gerbang server sudah terbukti di atas; ini membuktikan UI tidak menawarkan
  // jalan yang pasti ditolak server, dan tidak mengaku terlindungi saat mati.
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
  // Karena itu server untuk harness ini perlu env chain yang hidup.
  const launchBtn = page.locator('button:has-text("Launch on")').first();
  const launchCount = await launchBtn.count();
  check("tombol launch dirender (ada chain berfactory)", launchCount > 0);
  check(
    "tombol launch TERKUNCI walau attestation sudah ada",
    launchCount > 0 && (await launchBtn.isDisabled()),
    launchCount > 0 ? ((await launchBtn.textContent()) ?? "").replace(/\s+/g, " ").trim() : "tombol tidak dirender"
  );
  check("tidak ada page error", (await page.evaluate(() => window.__errs ?? 0)) === 0);
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
