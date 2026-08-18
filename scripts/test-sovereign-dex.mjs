/**
 * End-to-end proof that the Sovereign DEX actually settles trades.
 *
 * Local devchain (free, instant):
 *   cd devchain && npx hardhat node
 *   node scripts/test-sovereign-dex.mjs
 *
 * Real remote network (testnet funds, proves the target chain's own EVM):
 *   TEST_RPC=https://evmrpc-testnet.0g.ai TEST_SEED=1 node scripts/test-sovereign-dex.mjs
 *
 * On a remote chain there is no `evm_mine`, so the anti-sniper window is passed by
 * waiting for real blocks instead.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const RPC = process.env.TEST_RPC || process.env.DEVCHAIN_RPC || "http://127.0.0.1:8545";
const IS_LOCAL_RPC = /127\.0\.0\.1|localhost/.test(RPC);
const PK = IS_LOCAL_RPC
  ? process.env.DEVCHAIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  : process.env.TEST_PK || process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;

if (!PK) {
  console.error("Missing key: set TEST_PK, or OG_PRIVATE_KEY/PRIVATE_KEY in .env.local");
  process.exit(1);
}
const SEED_ETHER = process.env.TEST_SEED || "10";
const SYMBOL = process.env.TEST_SYMBOL || `STEST${Math.floor(Math.random() * 900 + 100)}`;
const ART = (name) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "build", "artifacts", `${name}.json`), "utf8"));

const fmt = (v, d = 18) => Number(ethers.formatUnits(v, d)).toLocaleString(undefined, { maximumFractionDigits: 6 });
let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures += 1;
};

// Keep failures readable: ethers dumps the whole calldata otherwise.
process.on("uncaughtException", (e) => {
  console.error(`\nGAGAL: ${e.shortMessage || e.info?.error?.message || e.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error(`\nGAGAL: ${e?.shortMessage || e?.info?.error?.message || e?.message || e}`);
  process.exit(1);
});

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);
const net = await provider.getNetwork();
const isLocal = Number(net.chainId) === 31337;

console.log(`chainId=${net.chainId} rpc=${RPC}`);
console.log(`deployer=${wallet.address} balance=${ethers.formatEther(await provider.getBalance(wallet.address))}`);
console.log(`symbol=${SYMBOL} seed=${SEED_ETHER}\n`);

/** Advance past the token's anti-sniper window. */
async function advanceBlocks(count) {
  if (isLocal) {
    for (let i = 0; i < count; i++) await provider.send("evm_mine", []);
    return;
  }
  const start = await provider.getBlockNumber();
  const target = start + count;
  process.stdout.write(`  menunggu ${count} blok nyata (dari ${start})`);
  while ((await provider.getBlockNumber()) < target) {
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(` selesai di ${await provider.getBlockNumber()}`);
}

// ── 1. deploy factory ──────────────────────────────────────────────────────
const facArt = ART("AdextoTrinityFactoryV2");
const factory = await new ethers.ContractFactory(facArt.abi, facArt.bytecode, wallet).deploy();
await factory.waitForDeployment();
const factoryAddr = await factory.getAddress();
console.log(`AdextoTrinityFactoryV2 @ ${factoryAddr}`);

// ── 2. atomic launch ───────────────────────────────────────────────────────
const SEED = ethers.parseEther(SEED_ETHER);
const SUPPLY = 1_000_000_000n;
const launchTx = await factory.deployTrinityProject(
  "Sovereign Test Agent",
  SYMBOL,
  SUPPLY,
  wallet.address,
  30, // 0.30% total fee
  10, // 0.10% buyback
  ethers.keccak256(ethers.toUtf8Bytes("STEST_ROOT")),
  8000, // 80% of supply into the pool
  { value: SEED }
);
const launchRc = await launchTx.wait();

const deployedEvent = launchRc.logs
  .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
  .find((e) => e && e.name === "TrinityProjectDeployed");

check("event TrinityProjectDeployed emitted", !!deployedEvent);
const tokenAddr = deployedEvent.args.token;
const poolAddr = deployedEvent.args.pool;
console.log(`  token=${tokenAddr}\n  pool =${poolAddr}\n  gas  =${launchRc.gasUsed}\n`);

const erc20 = new ethers.Contract(
  tokenAddr,
  [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function totalSupply() view returns (uint256)",
    "function decimals() view returns (uint8)",
  ],
  wallet
);
const hookArt = ART("SovereignHook");
const pool = new ethers.Contract(poolAddr, hookArt.abi, wallet);

// ── 3. distribution ────────────────────────────────────────────────────────
console.log("3) distribusi supply & likuiditas awal");
const [rN, rT] = await pool.getReserves();
const creatorBal = await erc20.balanceOf(wallet.address);
const total = await erc20.totalSupply();
check("pool punya reserve native = seed", rN === SEED, `${fmt(rN)} ETH`);
check("pool punya 80% supply", rT === (total * 8000n) / 10000n, `${fmt(rT)} STEST`);
check("creator menerima 20% supply", creatorBal === total - rT, `${fmt(creatorBal)} STEST`);
check("pool ter-initialize", await pool.initialized());
check("factory.poolOf(token) == pool (resolusi on-chain)", (await factory.poolOf(tokenAddr)) === poolAddr);
check("factory.tokenOf(pool) == token (reverse lookup)", (await factory.tokenOf(poolAddr)) === tokenAddr);
check("pool.targetToken() == token", (await pool.targetToken()) === tokenAddr);
const spot = await pool.spotPriceNativePerToken();
console.log(`  spot price = ${ethers.formatEther(spot)} ETH / token`);

// ── 4. anti-sniper window ──────────────────────────────────────────────────
console.log("\n4) anti-sniper window (harus menolak beli besar di 5 blok pertama)");
const buyIn = SEED / 10n;

/**
 * Probe instead of predicting.
 *
 * The window is `launchBlock + 5` in *contract* terms, and `block.number` does not
 * mean the same thing everywhere: on Arbitrum it returns the L1 block number, so 5
 * blocks is roughly a minute of wall clock rather than 5 L2 blocks. On 0G testnet
 * blocks land about once a second, so the window can already be gone before the
 * first probe. Polling the actual behaviour is correct on every chain.
 */
async function buyIsBlocked() {
  try {
    await pool.buy.staticCall(0, ethers.ZeroAddress, 0, { value: buyIn });
    return false;
  } catch (e) {
    const msg = e.shortMessage || e.info?.error?.message || e.message || "";
    if (/max transaction|Anti-sniper/i.test(msg)) return true;
    if (/missing revert data|execution reverted/i.test(msg)) return true;
    throw e;
  }
}

const blockedAtStart = await buyIsBlocked();
if (blockedAtStart) {
  check("anti-sniper menolak beli >1% supply di window peluncuran", true);
} else {
  console.log(`  SKIP  window anti-sniper sudah lewat sebelum probe pertama (chain cepat)`);
}

if (blockedAtStart) {
  process.stdout.write("  menunggu window anti-sniper berakhir");
  const deadline = Date.now() + 240_000;
  let stillBlocked = true;
  while (Date.now() < deadline) {
    if (isLocal) await advanceBlocks(6);
    else await new Promise((r) => setTimeout(r, 4000));
    process.stdout.write(".");
    stillBlocked = await buyIsBlocked();
    if (!stillBlocked) break;
  }
  console.log("");
  check("window anti-sniper berakhir dan beli besar diizinkan", !stillBlocked);
} else {
  check("beli besar diizinkan di luar window", true);
}

// ── 5. BUY ─────────────────────────────────────────────────────────────────
console.log(`\n5) BUY ${ethers.formatEther(buyIn)} native -> token`);
const [qOut, qLp, qTre] = await pool.getBuyQuote(buyIn);
console.log(`  quote: ${fmt(qOut)} STEST | lpFee ${fmt(qLp)} | buyback ${fmt(qTre)} ETH`);
const minOut = (qOut * 99n) / 100n;
const balBefore = await erc20.balanceOf(wallet.address);
const buyRc = await (await pool.buy(minOut, wallet.address, 0, { value: buyIn })).wait();
const balAfter = await erc20.balanceOf(wallet.address);
const received = balAfter - balBefore;
check("saldo token bertambah", received > 0n, `+${fmt(received)} STEST`);
check("jumlah diterima == quote", received === qOut);
check("event Swap(isBuy=true) terbit", buyRc.logs.some((l) => {
  try { const p = pool.interface.parseLog(l); return p?.name === "Swap" && p.args.isBuy === true; } catch { return false; }
}));
check("treasuryNative terisi dari fee buyback", (await pool.treasuryNative()) === qTre, `${fmt(await pool.treasuryNative())} ETH`);

let slipped = false;
try {
  await pool.buy.staticCall(qOut * 2n, wallet.address, 0, { value: buyIn });
} catch (e) { slipped = /slippage/i.test(e.shortMessage || e.message || ""); }
check("minAmountOut mustahil -> revert 'slippage'", slipped);

let expired = false;
try {
  await pool.buy.staticCall(0, wallet.address, 1, { value: buyIn });
} catch (e) { expired = /expired/i.test(e.shortMessage || e.message || ""); }
check("deadline lampau -> revert 'expired'", expired);

// ── 6. SELL (approve + transferFrom) ───────────────────────────────────────
console.log("\n6) SELL token -> ETH (jalur approve + transferFrom)");
const sellAmount = received / 2n;
let noApproval = false;
try {
  await pool.sell.staticCall(sellAmount, 0, wallet.address, 0);
} catch (e) { noApproval = /approve|allowance|transferFrom/i.test(e.shortMessage || e.message || ""); }
check("sell tanpa approve -> revert jelas", noApproval);

await (await erc20.approve(poolAddr, sellAmount)).wait();
const [sellQuote] = await pool.getSellQuote(sellAmount);
const ethBefore = await provider.getBalance(wallet.address);
const tokBefore = await erc20.balanceOf(wallet.address);
const sellRc = await (await pool.sell(sellAmount, (sellQuote * 99n) / 100n, wallet.address, 0)).wait();

// OP-stack chains (Base) charge an L1 data fee on top of gasUsed * gasPrice and
// expose it as `l1Fee` on the raw receipt. Without it the accounting is short by
// exactly that amount, which is a fee-model difference, not a pool defect.
const rawRc = await provider.send("eth_getTransactionReceipt", [sellRc.hash]);
const l1Fee = rawRc?.l1Fee ? BigInt(rawRc.l1Fee) : 0n;
const gasCost = sellRc.gasUsed * sellRc.gasPrice + l1Fee;

const ethAfter = await provider.getBalance(wallet.address);
const tokAfter = await erc20.balanceOf(wallet.address);
console.log(`  quote: ${fmt(sellQuote)} ETH untuk ${fmt(sellAmount)} STEST`);
if (l1Fee > 0n) console.log(`  (L1 data fee OP-stack: ${fmt(l1Fee)} ETH)`);
check("saldo token berkurang tepat", tokBefore - tokAfter === sellAmount);
check(
  "saldo native bertambah tepat sebesar quote (setelah gas)",
  ethAfter + gasCost - ethBefore === sellQuote,
  `+${fmt(ethAfter + gasCost - ethBefore)} vs quote ${fmt(sellQuote)}`
);
check("event Swap(isBuy=false) terbit", sellRc.logs.some((l) => {
  try { const p = pool.interface.parseLog(l); return p?.name === "Swap" && p.args.isBuy === false; } catch { return false; }
}));

// ── 7. receive() ───────────────────────────────────────────────────────────
console.log("\n7) transfer native biasa ke pool (receive) — dulu selalu revert");
const plainBefore = await erc20.balanceOf(wallet.address);
// Scale with the seed so the suite fits a small testnet faucet balance.
const plainValue = SEED / 4n;
const plainRc = await (await wallet.sendTransaction({ to: poolAddr, value: plainValue, gasLimit: 300000n })).wait();
const plainAfter = await erc20.balanceOf(wallet.address);
check("transfer native polos berhasil (tidak revert)", plainRc.status === 1);
check("pengirim menerima token dari receive()", plainAfter > plainBefore, `+${fmt(plainAfter - plainBefore)} STEST`);

// ── 8. buyback ─────────────────────────────────────────────────────────────
console.log("\n8) executeBuyback oleh agent");
const treasuryBefore = await pool.treasuryNative();
const burnedBefore = await pool.totalTokensBurned();
await (await pool.executeBuyback(0, 0)).wait();
const burnedAfter = await pool.totalTokensBurned();
check("treasuryNative terpakai", (await pool.treasuryNative()) < treasuryBefore || treasuryBefore === 0n);
check("totalTokensBurned bertambah", burnedAfter > burnedBefore, `+${fmt(burnedAfter - burnedBefore)} STEST`);

// ── 9. duplicate symbol ────────────────────────────────────────────────────
console.log("\n9) proteksi symbol duplikat di factory");
let dup = false;
try {
  await factory.deployTrinityProject.staticCall(
    "Squatter", SYMBOL.toLowerCase(), SUPPLY, wallet.address, 30, 10, ethers.ZeroHash, 8000, { value: SEED }
  );
} catch (e) { dup = /symbol already taken/i.test(e.shortMessage || e.message || ""); }
check(`symbol '${SYMBOL.toLowerCase()}' (case-insensitive) ditolak`, dup);
check(`isSymbolAvailable('${SYMBOL}') == false`, (await factory.isSymbolAvailable(SYMBOL)) === false);
check("isSymbolAvailable('OTHERX') == true", (await factory.isSymbolAvailable("OTHERX")) === true);

const [finalN, finalT] = await pool.getReserves();
console.log(`\nreserve akhir: ${fmt(finalN)} native / ${fmt(finalT)} ${SYMBOL} | swaps=${await pool.swapCount()}`);
console.log(`\n${failures === 0 ? "SEMUA CEK LULUS" : `${failures} CEK GAGAL`}`);
process.exit(failures === 0 ? 0 : 1);
