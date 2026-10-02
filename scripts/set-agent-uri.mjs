/**
 * Arahkan `agentURI` agen ERC-8004 yang kami operasikan ke kartu permanennya di adexto.xyz.
 *
 *   node scripts/set-agent-uri.mjs                          # dry-run, semua agen (bawaan, tidak mengirim apa pun)
 *   node scripts/set-agent-uri.mjs --agent 143:10247        # dry-run satu agen
 *   node scripts/set-agent-uri.mjs --send --agent 143:10247 # KIRIM satu transaksi (butuh "ya" owner)
 *
 * Dry-run membaca untuk setiap agen: pemilik, URI saat ini (dan isinya), URI baru, gas, biaya dan
 * saldo pemilik. Ia juga menyimpan URI lama SEKALI ke `.kiro/plans/agent-uri-backup.json` (tidak pernah
 * ditimpa), supaya pembatalan selalu bisa mengembalikan berkas yang persis sama.
 *
 * Mode kirim sengaja sempit: satu agen per panggilan, dan baru jalan kalau kartu permanen di produksi
 * menjawab 200 dengan `registrations` yang cocok. Kunci dipilih dari pemilik on-chain: deployer dari
 * `PRIVATE_KEY` di `.env.local`, Agent A dari `demo-v1/wallets.json`. Kunci tidak pernah dicetak, dan
 * alamat yang diturunkan dari kunci harus sama dengan pemilik, kalau tidak skrip berhenti.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

dotenv.config({ path: ".env.local", quiet: true });

const BASE = (process.env.BASE_URL || "https://adexto.xyz").replace(/\/$/, "");
/** Alamat yang ditulis on-chain SELALU domain produksi, apa pun BASE_URL pemeriksaannya. */
const CARD_ORIGIN = "https://adexto.xyz";
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const BACKUP = ".kiro/plans/agent-uri-backup.json";
const NETWORKS = {
  16661: { rpc: "https://evmrpc.0g.ai", native: "0G", explorer: "https://chainscan.0g.ai" },
  8453: { rpc: "https://mainnet.base.org", native: "ETH", explorer: "https://basescan.org" },
  42161: { rpc: "https://arb1.arbitrum.io/rpc", native: "ETH", explorer: "https://arbiscan.io" },
  143: { rpc: "https://rpc1.monad.xyz", native: "MON", explorer: "https://monadscan.com" },
  4663: { rpc: "https://rpc.mainnet.chain.robinhood.com", native: "ETH", explorer: "https://robinhoodchain.blockscout.com" },
};
const OWNERS = {
  deployer: "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D",
  agentA: "0x42478Ed9A429eC320d243469Fa5d6595BCc8daa5",
};
const ABI = [
  "function setAgentURI(uint256 agentId, string newURI)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
];

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const only = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : null;
if (SEND && !only) {
  console.error("--send needs --agent <chainId>:<agentId>; one agent per run.");
  process.exit(1);
}

const cardUrl = (chainId, agentId) => `${CARD_ORIGIN}/agents/${chainId}/${agentId}/registration.json`;

/** Ringkasan isi URI saat ini: skema, nama, dan endpoint x402 yang tercatat. */
async function describe(uri) {
  try {
    let file = null;
    if (uri.startsWith("data:")) file = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
    else if (uri.startsWith("ipfs://")) {
      const r = await fetch(`https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`, { signal: AbortSignal.timeout(20_000) });
      file = await r.json();
    } else if (uri.startsWith("https://")) {
      const r = await fetch(uri, { signal: AbortSignal.timeout(20_000) });
      file = await r.json();
    }
    const services = file?.services ?? file?.endpoints ?? [];
    const x402 = services.find((s) => s.name === "x402")?.endpoint ?? "-";
    return `${uri.split(":")[0]}, "${file?.name ?? "?"}", x402=${x402}, registrations=${file?.registrations ? "yes" : "no"}`;
  } catch (e) {
    return `${uri.split(":")[0]}, unreadable (${String(e?.message ?? e).slice(0, 60)})`;
  }
}

/** Kartu di alamat permanen harus 200 dan menyebut agen ini sendiri. */
async function cardReady(origin, chainId, agentId) {
  try {
    const r = await fetch(`${origin}/agents/${chainId}/${agentId}/registration.json`, { signal: AbortSignal.timeout(30_000) });
    if (r.status !== 200) return `HTTP ${r.status}`;
    const card = await r.json();
    const reg = card.registrations?.[0];
    const ok = String(reg?.agentId) === String(agentId) && reg?.agentRegistry === `eip155:${chainId}:${REGISTRY.toLowerCase()}`;
    return ok ? null : `registrations do not match: ${JSON.stringify(reg)}`;
  } catch (e) {
    return String(e?.message ?? e).slice(0, 80);
  }
}

function keyFor(owner) {
  if (owner.toLowerCase() === OWNERS.deployer.toLowerCase()) return process.env.PRIVATE_KEY || "";
  if (owner.toLowerCase() === OWNERS.agentA.toLowerCase()) {
    const wallets = JSON.parse(readFileSync("demo-v1/wallets.json", "utf8"));
    return wallets?.agentA?.privateKey || "";
  }
  return "";
}

const dir = await (await fetch(`${BASE}/api/agents`, { signal: AbortSignal.timeout(120_000) })).json();
const prices = (await (await fetch(`${BASE}/api/prices`, { signal: AbortSignal.timeout(30_000) })).json()).prices ?? {};
let agents = (dir.operatedAgents ?? []).map((a) => ({ chainId: Number(a.chainId), agentId: String(a.agentId), name: a.name }));
if (only) agents = agents.filter((a) => `${a.chainId}:${a.agentId}` === only);
if (agents.length === 0) {
  console.error(only ? `agent ${only} is not one ADEXTO operates` : "no agents listed");
  process.exit(1);
}

const backup = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, "utf8")) : null;
const snapshot = [];
let totalUsd = 0;
let problems = 0;

console.log(`${SEND ? "SEND" : "DRY-RUN"} · ${agents.length} agent(s) · cards checked on ${BASE}\n`);
for (const a of agents) {
  const net = NETWORKS[a.chainId];
  const provider = new ethers.JsonRpcProvider(net.rpc, a.chainId, { staticNetwork: true, batchMaxCount: 1 });
  const registry = new ethers.Contract(REGISTRY, ABI, provider);
  const [owner, current] = await Promise.all([registry.ownerOf(BigInt(a.agentId)), registry.tokenURI(BigInt(a.agentId))]);
  snapshot.push({ chainId: a.chainId, agentId: a.agentId, owner, uri: current, readAt: new Date().toISOString() });
  const next = cardUrl(a.chainId, a.agentId);
  const role = Object.entries(OWNERS).find(([, v]) => v.toLowerCase() === owner.toLowerCase())?.[0] ?? "NOT OURS";
  console.log(`${a.chainId}:${a.agentId}  ${a.name}`);
  console.log(`  owner    ${owner} (${role})`);
  console.log(`  current  ${await describe(current)}`);
  console.log(`  new      ${next}`);
  if (current === next) {
    console.log("  status   already set\n");
    continue;
  }
  const notReady = await cardReady(BASE, a.chainId, a.agentId);
  console.log(`  card     ${notReady ? `NOT READY on ${BASE}: ${notReady}` : `ready on ${BASE}`}`);
  if (notReady || role === "NOT OURS") problems++;

  const data = registry.interface.encodeFunctionData("setAgentURI", [BigInt(a.agentId), next]);
  let gas = null;
  try {
    gas = await provider.estimateGas({ from: owner, to: REGISTRY, data });
  } catch (e) {
    console.log(`  gas      estimate failed: ${String(e?.shortMessage ?? e?.message).slice(0, 100)}`);
    problems++;
  }
  const [fee, balance] = await Promise.all([provider.getFeeData(), provider.getBalance(owner)]);
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  if (gas) {
    const cost = gas * price;
    const usd = Number(ethers.formatEther(cost)) * (prices[net.native] ?? 0);
    totalUsd += usd;
    console.log(`  cost     ${gas} gas · ${ethers.formatEther(cost)} ${net.native} ≈ $${usd.toFixed(4)} · balance ${ethers.formatEther(balance)} ${net.native}${balance > cost * 2n ? "" : "  LOW BALANCE"}`);
    if (balance <= cost * 2n) problems++;
  }

  if (SEND) {
    const prodNotReady = await cardReady(CARD_ORIGIN, a.chainId, a.agentId);
    if (prodNotReady) {
      console.error(`  refused  the production card is not ready: ${prodNotReady}`);
      process.exit(1);
    }
    const key = keyFor(owner);
    if (!key) {
      console.error("  refused  no key available for this owner");
      process.exit(1);
    }
    const wallet = new ethers.Wallet(key, provider);
    if (wallet.address.toLowerCase() !== owner.toLowerCase()) {
      console.error("  refused  the key does not belong to the on-chain owner");
      process.exit(1);
    }
    const tx = await registry.connect(wallet).setAgentURI(BigInt(a.agentId), next, { gasLimit: (gas * 12n) / 10n });
    console.log(`  sent     ${net.explorer}/tx/${tx.hash}`);
    const rc = await tx.wait();
    const after = await registry.tokenURI(BigInt(a.agentId));
    console.log(`  mined    block ${rc.blockNumber}, status ${rc.status}, tokenURI now ${after === next ? "matches" : `DIFFERS: ${after}`}`);
  }
  console.log("");
}

// Cadangan URI lama: entri yang sudah tersimpan TIDAK PERNAH ditimpa; agen yang belum ada ditambahkan.
{
  const saved = backup?.agents ?? [];
  const have = new Set(saved.map((s) => `${s.chainId}:${s.agentId}`));
  const added = snapshot.filter((s) => !have.has(`${s.chainId}:${s.agentId}`) && !s.uri.startsWith(`${CARD_ORIGIN}/agents/`));
  if (added.length > 0) {
    writeFileSync(
      BACKUP,
      JSON.stringify({ note: "agentURI before setAgentURI pointed it at adexto.xyz. Entries are never overwritten.", agents: [...saved, ...added] }, null, 2) + "\n"
    );
    console.log(`saved ${added.length} current URI(s) to ${BACKUP}`);
  }
}
console.log(`total ≈ $${totalUsd.toFixed(4)} · ${problems ? `${problems} problem(s)` : "no problems"}${SEND ? "" : " · nothing was sent"}`);
process.exit(problems && !SEND ? 2 : 0);
