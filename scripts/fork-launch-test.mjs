#!/usr/bin/env node
/**
 * Uji alur peluncuran agen lewat MCP di FORK LOKAL — tanpa uang sungguhan.
 *
 * Yang dibuktikan: agen luar yang hanya punya kuncinya sendiri dan endpoint MCP bisa
 * meluncurkan pasar, mendaftarkannya, membacanya kembali, men-stake, dan mengklaim fee creator.
 * Semua transaksi ditandatangani di skrip ini dengan akun acak baru yang saldonya diisi anvil;
 * server tidak pernah memegang kunci. Satu-satunya langkah di luar MCP adalah pembelian langsung ke kurva oleh
 * akun kedua, karena fee creator baru ada setelah ada trade.
 *
 * Pengaman: skrip MENOLAK jalan kalau RPC-nya bukan anvil atau BASE_URL bukan localhost, jadi
 * ia tidak bisa mengirim transaksi ke chain sungguhan atau mendaftar ke situs produksi.
 *
 * Persiapan (lihat .kiro/plans/PLAN-1-GRATIS.md langkah 2):
 *   anvil --fork-url https://base-rpc.publicnode.com --chain-id 8453 --host 127.0.0.1
 *   situs lokal yang dibuild dan dijalankan dengan
 *     NEXT_PUBLIC_CHAIN_OVERRIDES='{"Base":{"rpcUrl":"http://127.0.0.1:8545"}}'
 *     ADEXTO_DATA_DIR=<direktori sementara>  dan tanpa kunci privat di .env.local
 *
 * Jalankan:
 *   BASE_URL=http://127.0.0.1:3120 FORK_RPC=http://127.0.0.1:8545 node scripts/fork-launch-test.mjs
 */
import { ethers } from "ethers";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3120").replace(/\/+$/, "");
const FORK_RPC = process.env.FORK_RPC || "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID || 8453);
const SYMBOL = String(process.env.SYMBOL || `FORK${Date.now().toString(36).toUpperCase().slice(-6)}`);
const BUY_NATIVE = process.env.BUY_NATIVE || "0.01";
const STAKE_AMOUNT = process.env.STAKE_AMOUNT || "100000";

let fails = 0;
const check = (label, pass, detail = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "OK  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  return pass;
};
const info = (label, detail = "") => console.log(`INFO  ${label}${detail ? `  ${detail}` : ""}`);
const head = (t) => console.log(`\n── ${t}`);

// ── pengaman ────────────────────────────────────────────────────────────────

const siteHost = new URL(BASE_URL).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(siteHost)) {
  console.error(`Refusing to run: BASE_URL ${BASE_URL} is not a local site.`);
  process.exit(2);
}
const provider = new ethers.JsonRpcProvider(FORK_RPC, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
const client = String(await provider.send("web3_clientVersion", []).catch(() => ""));
if (!/anvil/i.test(client)) {
  console.error(`Refusing to run: ${FORK_RPC} is not an anvil node (web3_clientVersion = "${client}").`);
  process.exit(2);
}
const rpcChainId = Number(await provider.send("eth_chainId", []));
if (rpcChainId !== CHAIN_ID) {
  console.error(`Refusing to run: the fork reports chain ${rpcChainId}, expected ${CHAIN_ID}.`);
  process.exit(2);
}

/**
 * Akun baru acak per jalan, diisi saldo lewat `anvil_setBalance`.
 *
 * BUKAN akun bawaan anvil (mnemonik "test test … junk"). Kunci akun itu publik, jadi di Base
 * mainnet kelimanya sudah diberi delegasi EIP-7702 ke kontrak penyapu
 * (0x8a67b5020ee254ef48e3b6a04927f39baf7e408a) yang meneruskan setiap ETH masuk ke alamat lain.
 * Fork mewarisi kode itu: pada uji pertama fee creator memang dibayar kurva ke creator, lalu
 * langsung disapu keluar oleh kode delegasinya. Akun acak tidak punya kode.
 */
async function freshAccount() {
  const wallet = ethers.Wallet.createRandom().connect(provider);
  await provider.send("anvil_setBalance", [wallet.address, ethers.toQuantity(ethers.parseEther("10"))]);
  if ((await provider.getCode(wallet.address)) !== "0x") throw new Error(`${wallet.address} has code on the fork`);
  return wallet;
}
const creator = await freshAccount();
const trader = await freshAccount();
const outsider = await freshAccount();

// ── klien MCP minimal: JSON-RPC 2.0 lewat HTTP, tanpa SDK ──────────────────

let rpcId = 0;
async function mcp(method, params) {
  const res = await fetch(`${BASE_URL}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  // Streamable HTTP boleh menjawab sebagai SSE; ambil baris `data:` terakhir.
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  return JSON.parse(lines.length ? lines[lines.length - 1].slice(6) : text);
}
async function tool(name, args) {
  const started = Date.now();
  const env = await mcp("tools/call", { name, arguments: args });
  const ms = Date.now() - started;
  if (env.error) return { _rpcError: env.error, _ms: ms };
  try {
    return { ...JSON.parse(env.result.content[0].text), _ms: ms };
  } catch {
    return { _unparsed: env.result, _ms: ms };
  }
}
const short = (v) => JSON.stringify(v).slice(0, 220);

async function send(wallet, tx, label) {
  const response = await wallet.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value ?? 0),
    chainId: CHAIN_ID,
    ...(tx.gas ? { gasLimit: BigInt(tx.gas) } : {}),
  });
  const receipt = await response.wait();
  check(`${label} mined`, receipt?.status === 1, `tx ${response.hash} gasUsed ${receipt?.gasUsed}`);
  return receipt;
}

// ── 0. permukaan MCP ───────────────────────────────────────────────────────

console.log(`Fork: ${client} chain ${rpcChainId} block ${await provider.getBlockNumber()}`);
console.log(`Site: ${BASE_URL}   ticker: ${SYMBOL}`);
console.log(`Creator ${creator.address}   trader ${trader.address}`);

head("0. MCP surface");
const listed = await mcp("tools/list", {});
const names = (listed.result?.tools ?? []).map((t) => t.name);
const needed = ["prepare_launch", "register_launch", "get_market", "prepare_stake", "check_stake", "prepare_claim"];
check("tools/list has the launch tools", needed.every((n) => names.includes(n)), `${names.length} tools`);

// ── 1. prepare_launch, langkah 1 ───────────────────────────────────────────

head("1. prepare_launch without a signature");
const launchArgs = {
  chainId: CHAIN_ID,
  name: `Fork Rehearsal ${SYMBOL}`,
  symbol: SYMBOL,
  deployer: creator.address,
  description: "Rehearsal market on a local fork. It does not exist on any real chain.",
  website: "https://adexto.xyz",
};
const step1 = await tool("prepare_launch", launchArgs);
check("returns sign_attestation", step1.step === "sign_attestation", short({ step: step1.step, error: step1.error, detail: step1.detail }));
check("ticker free in registry and on chain", step1.checks?.tickerFreeInRegistry === true && step1.checks?.tickerFreeOnChain === true, short(step1.checks));
const message = String(step1.attestationMessage ?? "");
check("attestation names the deployer and ticker", message.includes(`Deployer: ${creator.address}`) && message.includes(`Ticker: ${SYMBOL}`));

// ── 2. prepare_launch, langkah 2 ───────────────────────────────────────────

head("2. prepare_launch with the signature");
const wrongSig = await tool("prepare_launch", {
  ...launchArgs,
  attestationMessage: message,
  attestationSignature: await outsider.signMessage(message),
});
check("a signature from another key is refused", wrongSig.error === "attestation_invalid", short({ error: wrongSig.error }));

const step2 = await tool("prepare_launch", {
  ...launchArgs,
  attestationMessage: message,
  attestationSignature: await creator.signMessage(message),
});
check("returns sign_and_send", step2.step === "sign_and_send", short({ step: step2.step, error: step2.error, detail: step2.detail }));
const tx = step2.transaction ?? {};
check("transaction goes to the factory, value 0", Boolean(tx.to) && tx.value === "0" && Number(tx.chainId) === CHAIN_ID, short({ to: tx.to, value: tx.value }));
check("simulated from the deployer without revert", step2.simulation?.ok === true, short(step2.simulation));
check("gas estimated on chain", step2.gasSource === "estimateGas", `${step2.gasEstimate} gas`);
check("fee preset 1.00% / 0.70% creator", step2.market?.feePerTradeBps?.total === 100 && step2.market?.feePerTradeBps?.creator === 70, short(step2.market?.feePerTradeBps));
info("metadata anchored to 0G", `${step2.metadataAnchoredTo0G} (expected false here: the fork site has no 0G key)`);
info("prepare_launch step 2 time", `${step2._ms} ms`);

// ── 3. kirim transaksinya ──────────────────────────────────────────────────

head("3. sign and send the launch");
if (!tx.to) {
  console.log("\nNo transaction to send; stopping.");
  process.exit(1);
}
const launchReceipt = await send(creator, tx, "launch");
info("gas used vs estimate", `${launchReceipt.gasUsed} used, ${step2.gasEstimate} estimated, limit ${tx.gas}`);

// ── 4. register_launch ─────────────────────────────────────────────────────

head("4. register_launch");
const reg = await tool("register_launch", { chainId: CHAIN_ID, txHash: launchReceipt.hash });
check("registered", reg.registered === true && reg.alreadyRegistered === false, short({ registered: reg.registered, error: reg.error, detail: reg.detail }));
check("creator comes from the factory event", String(reg.creator).toLowerCase() === creator.address.toLowerCase(), reg.creator);
check("metadata from prepare_launch applied", reg.metadataApplied === true);
const again = await tool("register_launch", { chainId: CHAIN_ID, txHash: launchReceipt.hash });
check("second call is idempotent", again.registered === true && again.alreadyRegistered === true);
const token = String(reg.token ?? "");
const curveAddress = String(reg.curve ?? "");

// ── 5. get_market ──────────────────────────────────────────────────────────

head("5. get_market");
const market = await tool("get_market", { symbol: SYMBOL, chainId: CHAIN_ID });
check("reads the new market back", market.token === token && market.curve === curveAddress, short({ token: market.token, curve: market.curve, error: market.error }));
check("tradable", market.tradable === true);
check("creator recorded", market.creator?.toLowerCase() === creator.address.toLowerCase(), market.creator);
info("staking summary", short(market.staking));

const retry = await tool("prepare_launch", { ...launchArgs, deployer: outsider.address });
check("the ticker is now refused for another deployer", Boolean(retry.error), short({ error: retry.error }));

// ── 6. trade langsung ke kurva (di luar MCP) ───────────────────────────────

head("6. a direct buy from a second account");
const CURVE_ABI = [
  "function buy(uint256 minTokensOut, address to, uint256 deadline) payable returns (uint256)",
  "function getBuyQuote(uint256 nativeIn) view returns (uint256 tokensOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee)",
  "function creatorOwed() view returns (uint256)",
  "function totalCreatorFeesPaid() view returns (uint256)",
  "function creator() view returns (address)",
  "function swapCount() view returns (uint256)",
  "event CreatorFeesClaimed(address indexed to, uint256 amount)",
];
const curve = new ethers.Contract(curveAddress, CURVE_ABI, provider);
const nativeIn = ethers.parseEther(BUY_NATIVE);
const quote = await curve.getBuyQuote(nativeIn);
const deadline = BigInt((await provider.getBlock("latest")).timestamp + 600);
const buyData = curve.interface.encodeFunctionData("buy", [(quote.tokensOut * 99n) / 100n, trader.address, deadline]);
const buyReceipt = await send(trader, { to: curveAddress, data: buyData, value: nativeIn.toString() }, `buy ${BUY_NATIVE} ETH`);
const erc20 = new ethers.Contract(token, ["function balanceOf(address) view returns (uint256)"], provider);
const bought = await erc20.balanceOf(trader.address);
check("trader received tokens", bought > 0n, `${ethers.formatUnits(bought, 18)} ${SYMBOL}`);
const owedBefore = await curve.creatorOwed();
check("creator fee accrued", owedBefore > 0n, `${ethers.formatEther(owedBefore)} ETH owed`);

// ── 7. prepare_stake + check_stake ─────────────────────────────────────────

head("7. prepare_stake and check_stake");
const tooSmall = await tool("prepare_stake", { symbol: SYMBOL, chainId: CHAIN_ID, address: trader.address, amount: "1" });
check("a stake below the minimum is refused before gas", tooSmall.error === "below_minimum", short({ error: tooSmall.error, minimum: tooSmall.minimum }));

const stake = await tool("prepare_stake", { symbol: SYMBOL, chainId: CHAIN_ID, address: trader.address, amount: STAKE_AMOUNT });
check("returns unsigned transactions", Array.isArray(stake.transactions) && stake.transactions.length >= 1, short({ kind: stake.kind, error: stake.error, detail: stake.detail }));
info("stake contract", `${stake.stakeContract} (${stake.kind})`);
for (const [i, t] of (stake.transactions ?? []).entries()) {
  check(`transaction ${i + 1} is from the trader`, String(t.from).toLowerCase() === trader.address.toLowerCase(), t.purpose);
  await send(trader, t, t.purpose);
}
const position = await tool("check_stake", { symbol: SYMBOL, chainId: CHAIN_ID, address: trader.address });
check("position is active", position.active === true && Number(position.staked) === Number(STAKE_AMOUNT), short({ staked: position.staked, minStake: position.minStake, active: position.active, error: position.error }));

// ── 8. prepare_claim ───────────────────────────────────────────────────────

head("8. prepare_claim");
const claim = await tool("prepare_claim", { address: creator.address, chainId: CHAIN_ID });
const mine = (claim.claimable ?? []).find((c) => String(c.curve).toLowerCase() === curveAddress.toLowerCase());
check("the new market is claimable", Boolean(mine), short({ claimable: claim.claimable, detail: claim.detail }));
check(
  "owed amount matches the curve",
  Boolean(mine) && Math.abs(Number(mine.owed) - Number(ethers.formatEther(owedBefore))) < 1e-12,
  mine ? `${mine.owed} ETH` : ""
);
info("prepare_claim time", `${claim._ms} ms`);
const paidBefore = await curve.totalCreatorFeesPaid();
const balanceBefore = await provider.getBalance(creator.address);
let claimGas = 0n;
let paidTo = null;
let paidAmount = 0n;
for (const t of claim.transactions ?? []) {
  const r = await send(creator, t, t.purpose);
  claimGas += r.gasUsed * r.gasPrice;
  for (const log of r.logs) {
    if (log.address.toLowerCase() !== curveAddress.toLowerCase()) continue;
    const parsed = curve.interface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed?.name === "CreatorFeesClaimed") {
      paidTo = parsed.args.to;
      paidAmount += parsed.args.amount;
    }
  }
}
const owedAfter = await curve.creatorOwed();
const paidAfter = await curve.totalCreatorFeesPaid();
const balanceAfter = await provider.getBalance(creator.address);
check("nothing owed after the claim", owedAfter === 0n);
check("paid total grew by the owed amount", paidAfter - paidBefore === owedBefore, `${ethers.formatEther(paidAfter - paidBefore)} ETH`);
check("CreatorFeesClaimed paid the creator the owed amount", paidTo === creator.address && paidAmount === owedBefore, `${paidTo} ${ethers.formatEther(paidAmount)} ETH`);
/**
 * Selisih saldo = owed − gas − biaya data L1. Anvil membebankan biaya data L1 OP Stack di fork
 * Base, dan angka itu tidak ada di receipt, jadi diberi toleransi 0,000001 ETH alih-alih
 * disamakan persis.
 */
const delta = balanceAfter - balanceBefore;
const expected = owedBefore - claimGas;
check(
  "creator balance grew by owed minus gas",
  delta <= expected && expected - delta < ethers.parseEther("0.000001"),
  `delta ${ethers.formatEther(delta)} ETH, owed minus L2 gas ${ethers.formatEther(expected)} ETH`
);

// ── 9. pemeriksaan negatif register_launch ─────────────────────────────────

head("9. register_launch refuses a non-launch transaction");
const notLaunch = await tool("register_launch", { chainId: CHAIN_ID, txHash: buyReceipt.hash });
check("the buy transaction is refused", notLaunch.error === "not_an_adexto_launch", short({ error: notLaunch.error }));

console.log(`\n${fails === 0 ? "ALL PASSED" : `${fails} FAILED`}  ticker ${SYMBOL} token ${token} curve ${curveAddress}`);
process.exit(fails === 0 ? 0 : 1);
