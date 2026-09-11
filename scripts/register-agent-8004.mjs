/**
 * Register an ADEXTO agent in the ERC-8004 Identity Registry.
 *
 * This is the step that has to happen BEFORE a launch that binds an agent, and it
 * is why `deployTrinity` takes an `agentId` rather than registering itself: the
 * registration file is supposed to name its own agentId, and the id does not exist
 * until this transaction returns. So the flow is register, then set the URI with the
 * id inside it, then launch.
 *
 * Run through tsx, because the registration helpers are TypeScript and shared with
 * the app rather than duplicated here:
 *
 *   npx tsx scripts/register-agent-8004.mjs --chain base              # dry run
 *   npx tsx scripts/register-agent-8004.mjs --chain base --broadcast  # spends gas
 *
 * With PINATA_JWT set the URI is a pinned `ipfs://`. Without it, a base64 `data:`
 * URI, which ERC-8004 explicitly allows and which cannot rot.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import {
  buildRegistrationFile,
  serialize,
  toDataUri,
  computeCidV1Raw,
  pinToIpfs,
  agentRegistryId,
} from "../src/lib/agent-registration.ts";

dotenv.config({ path: ".env.local" });

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const NETWORKS = {
  "0g": { chainId: 16661, rpc: process.env.OG_RPC_URL || "https://evmrpc.0g.ai", explorer: "https://chainscan.0g.ai", native: "0G" },
  base: { chainId: 8453, rpc: "https://mainnet.base.org", explorer: "https://basescan.org", native: "ETH" },
  arbitrum: { chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io", native: "ETH" },
  monad: { chainId: 143, rpc: "https://rpc.monad.xyz", explorer: "https://monadscan.com", native: "MON" },
  devchain: { chainId: 31337, rpc: "http://127.0.0.1:8545", explorer: "", native: "ETH" },
};

const REGISTRY_ABI = [
  "function register(string agentURI) returns (uint256)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const args = process.argv.slice(2);
/**
 * `indexOf` mengembalikan -1 kalau flagnya tidak ada, dan `args[-1 + 1]` adalah `args[0]`
 * — yaitu argumen PERTAMA, apa pun itu. Jadi `--broadcast` tanpa `--symbol` akan membaca
 * "--chain" sebagai simbol. Bug ini tidak terlihat selama satu-satunya pembaca adalah
 * `--chain`, karena nilai sampahnya lalu gagal di pencarian NETWORKS.
 */
function argOf(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? "" : (args[i + 1] || "").trim();
}
const chainKey = argOf("--chain").toLowerCase();
const BROADCAST = args.includes("--broadcast");
/**
 * Identitas agent bisa MILIK SATU PASAR, bukan hanya milik protokol.
 *
 * Tanpa ini berkas registrasinya hardcoded ke ADEXTO — nama, deskripsi, dan endpoint
 * x402-nya semua menyebut `adexto`. Mengikat token lain ke identitas itu berarti agent
 * $CURB mengiklankan endpoint $ADEXTO, dan pembaca yang mengikuti endpoint itu membeli
 * token yang salah.
 *
 * Kekeliruan itu PERMANEN: berkas registrasinya ditulis on-chain sebagai data URI.
 */
const SYMBOL = argOf("--symbol").toUpperCase();
const MARKET = argOf("--market");
const net = NETWORKS[chainKey];

if (!net) {
  console.error(`Usage: npx tsx scripts/register-agent-8004.mjs --chain <${Object.keys(NETWORKS).join("|")}> [--broadcast]`);
  process.exit(1);
}

const PK = chainKey === "devchain"
  ? process.env.DEVCHAIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  : process.env.OG_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK) {
  console.error("Missing OG_PRIVATE_KEY / PRIVATE_KEY in .env.local");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(net.rpc, undefined, { staticNetwork: true });
const wallet = new ethers.Wallet(PK, provider);

const onChain = Number((await provider.getNetwork()).chainId);
if (onChain !== net.chainId) {
  console.error(`RPC chainId mismatch: expected ${net.chainId}, got ${onChain}`);
  process.exit(1);
}
const code = await provider.getCode(REGISTRY);
if (code === "0x") {
  console.error(`No ERC-8004 registry at ${REGISTRY} on ${chainKey}. The registries are mainnet-only.`);
  process.exit(1);
}

/**
 * One definition, used for both the pre-registration file and the corrected one
 * written afterwards. Duplicating it invites the two from drifting, and the second
 * is what ends up published.
 *
 * Every endpoint here answers: the x402 gateway really does return a 402 with its
 * price, which is why `x402Support` is true. Nothing unreachable is listed.
 *
 * `supportedTrust` is intentionally absent. Per the spec an absent value means the
 * entry is used for discovery only, which is the accurate claim — we read 0G's
 * TDX attestation declaration rather than verifying a quote, so asserting
 * "tee-attestation" would overstate it.
 */
/**
 * DESKRIPSI DI BAWAH DITULIS ULANG, dan alasannya adalah kelas kesalahan terburuk yang
 * bisa dilakukan berkas ini.
 *
 * Versi lamanya berbunyi: "the agent's paid API answers an HTTP 402 challenge quoting its
 * price and settlement vault. Settlement is not yet implemented: a signed voucher returns
 * 501." Ketiga bagiannya sudah tidak benar — produknya bukan API inference berbayar
 * melainkan pembelian lintas chain, penyelesaian EIP-3009 sudah hidup dan sudah
 * memindahkan dana sungguhan, dan jalur voucher sudah dicabut.
 *
 * Yang membuatnya lebih berbahaya daripada klaim basi di halaman web: berkas ini ditulis
 * ON-CHAIN sebagai data URI, jadi tidak ada penyuntingan yang bisa memperbaikinya setelah
 * transaksinya masuk. Dan `audit_claims.mjs` tidak akan pernah menangkapnya, karena
 * pemeriksa itu membaca teks yang DIRENDER di situs, bukan payload yang dikirim ke chain.
 */
function describeAgent(agentId) {
  const sym = SYMBOL || "ADEXTO";
  // Path kanonik. `/v1/x402/<simbol>` masih dilayani, tapi yang didokumentasikan di
  // /x402 adalah bentuk `buy`, dan alamat yang ditulis permanen sebaiknya yang itu.
  const x402 = `https://x402.adexto.xyz/v1/x402/buy/${sym.toLowerCase()}`;
  const settlement =
    "An unpaid request to the x402 endpoint is answered with HTTP 402 and a quote. Paying it means " +
    "signing an EIP-3009 authorization for USDC on Base, which the token contract verifies itself, and " +
    "the bonding curve sends the tokens straight to the payer's own address. Delivery is executed before " +
    "the charge, so a failed fill costs the protocol rather than the buyer.";
  return buildRegistrationFile({
    name: SYMBOL ? `${MARKET || `$${sym}`} Agent` : "ADEXTO Protocol Agent",
    description: SYMBOL
      ? `Market agent for $${sym}, a bonding-curve market launched through ADEXTO. The curve opens against a ` +
        `virtual reserve, so it needs no liquidity deposit and is tradable from the first block. ${settlement}`
      : `Autonomous market agent for tokens launched by ADEXTO. A launch may bind its token to an agent ` +
        `identity in this registry. ${settlement}`,
    image: "https://adexto.xyz/logo.svg",
    services: [
      { name: "web", endpoint: "https://adexto.xyz" },
      { name: "x402", endpoint: x402, version: "v1" },
    ],
    x402Support: true,
    chainId: net.chainId,
    registryAddress: REGISTRY,
    ...(agentId === undefined ? {} : { agentId }),
  });
}

const file = describeAgent(undefined);
const bytes = serialize(file);
const pinned = await pinToIpfs(bytes);
const uri = pinned.ok && pinned.uri ? pinned.uri : toDataUri(bytes);
const mode = pinned.ok ? "ipfs (pinned)" : "data (base64 on-chain)";

console.log(`network      : ${chainKey} (chainId ${net.chainId})`);
console.log(`registry     : ${REGISTRY}  (${code.length / 2 - 1} bytes)`);
console.log(`owner        : ${wallet.address}`);
console.log(`balance      : ${ethers.formatEther(await provider.getBalance(wallet.address))} ${net.native}`);
console.log(`agentRegistry: ${agentRegistryId(net.chainId, REGISTRY)}`);
console.log(`\nregistration file (${bytes.length} bytes):`);
console.log(JSON.stringify(file, null, 2));
console.log(`\nlocal CIDv1  : ${computeCidV1Raw(bytes)}`);
console.log(`uri mode     : ${mode}`);
if (!pinned.ok) console.log(`  pinning    : ${pinned.error}`);
console.log(`uri length   : ${uri.length} chars`);

const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, wallet);
let gas;
try {
  gas = await registry.register.estimateGas(uri);
  const fee = await provider.getFeeData();
  const price = fee.maxFeePerGas || fee.gasPrice || ethers.parseUnits("1", "gwei");
  console.log(`gas estimate : ${gas}  (~${ethers.formatEther(gas * price)} ${net.native})`);
} catch (e) {
  console.error(`\nestimateGas failed: ${e.shortMessage || e.message}`);
  process.exit(1);
}

if (!BROADCAST) {
  console.log("\nDRY RUN — nothing was sent. Re-run with --broadcast to register.");
  process.exit(0);
}

console.log("\nRegistering...");
const tx = await registry.register(uri);
console.log(`tx: ${tx.hash}`);
const receipt = await tx.wait();

// Read the id out of the mint event rather than assuming it is sequential.
let agentId = null;
const iface = new ethers.Interface(REGISTRY_ABI);
for (const log of receipt.logs) {
  try {
    const p = iface.parseLog({ topics: [...log.topics], data: log.data });
    if (p?.name === "Transfer" && p.args.from === ethers.ZeroAddress) agentId = p.args.tokenId;
  } catch {
    /* not ours */
  }
}
if (agentId === null) {
  console.error("register() emitted no mint Transfer; cannot determine agentId.");
  process.exit(1);
}

console.log(`\nagentId      : ${agentId}`);
console.log(`owner        : ${await registry.ownerOf(agentId)}`);
console.log(`block        : ${receipt.blockNumber}   gasUsed ${receipt.gasUsed}`);
if (net.explorer) console.log(`explorer     : ${net.explorer}/tx/${tx.hash}`);

/**
 * Now that the id exists, rebuild the file WITH its `registrations` block and
 * update the URI. This is the second half of the chicken-and-egg the design works
 * around: the spec wants the id inside the file, and it could not be there before.
 */
const finalFile = describeAgent(agentId);
const finalBytes = serialize(finalFile);
const finalPin = await pinToIpfs(finalBytes);
const finalUri = finalPin.ok && finalPin.uri ? finalPin.uri : toDataUri(finalBytes);

console.log(`\nupdating agentURI to include registrations[agentId=${agentId}]…`);
const tx2 = await registry.setAgentURI(agentId, finalUri);
console.log(`tx: ${tx2.hash}`);
await tx2.wait();
console.log(`tokenURI now ${(await registry.tokenURI(agentId)).slice(0, 80)}…`);
console.log(`\nDone. Launch with:  bindAgent=true  agentId=${agentId}`);
