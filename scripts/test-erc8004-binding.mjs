/**
 * End-to-end test for the ERC-8004 agent binding, on a local devchain.
 *
 * WHY LOCAL AND NOT A TESTNET
 *
 * The ERC-8004 registries are deployed on mainnets only. All four of our testnets
 * return no code at 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, and because
 * `AGENT_REGISTRY` is a constant in the factory, the agent path is unreachable
 * there. Rather than turn the registry into a constructor argument purely to make
 * it testable — which would add a way to misconfigure a mainnet deployment — the
 * mock's runtime bytecode is injected at that exact address with `hardhat_setCode`.
 * The factory therefore runs its real, unmodified code path.
 *
 * WHAT THIS TEST ALREADY CAUGHT
 *
 * The first implementation used `agentId == 0` to mean "no agent identity". This
 * harness, plus a read against the live registries, showed that agent 0 is a real
 * owned agent on all four mainnets — so the sentinel was wrong and would have been
 * frozen into immutable bytecode. Case 6 below is the regression test.
 *
 * Usage:
 *   cd devchain && npx hardhat node --port 8545      # terminal 1
 *   node scripts/test-erc8004-binding.mjs            # terminal 2
 */
import fs from "node:fs";
import { ethers } from "ethers";

const RPC = process.env.DEVCHAIN_RPC || "http://127.0.0.1:8545";
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const PK_CREATOR = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PK_STRANGER = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const art = (n) => JSON.parse(fs.readFileSync(`build/artifacts/${n}.json`, "utf8"));

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? `  ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
}

async function expectRevert(label, fn, expected) {
  try {
    await fn();
    check(label, false, "did NOT revert");
  } catch (e) {
    const msg = e.shortMessage || e.message || "";
    check(label, msg.includes(expected), `reason=${msg.slice(0, 80)}`);
  }
}

const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
const creator = new ethers.Wallet(PK_CREATOR, provider);
const stranger = new ethers.Wallet(PK_STRANGER, provider);

console.log(`devchain  : chainId ${(await provider.getNetwork()).chainId}`);
console.log(`creator   : ${creator.address}`);
console.log(`stranger  : ${stranger.address}`);

// ── inject the mock registry at the factory's hardcoded address ──────────────
const mockArt = art("MockIdentityRegistry");
const mockDeployed = await new ethers.ContractFactory(mockArt.abi, mockArt.bytecode, creator).deploy();
await mockDeployed.waitForDeployment();
const runtime = await provider.getCode(await mockDeployed.getAddress());
await provider.send("hardhat_setCode", [REGISTRY, runtime]);
const injected = await provider.getCode(REGISTRY);
console.log(`\nregistry  : injected ${injected.length / 2 - 1} bytes at ${REGISTRY}\n`);
check("mock registry present at the factory's constant address", injected === runtime && injected !== "0x");

const registry = new ethers.Contract(REGISTRY, mockArt.abi, creator);
check("registry answers name() with zeroed storage", (await registry.name()) === "AgentIdentity");

/**
 * Read the minted id out of the ERC-721 `Transfer` log rather than assuming it.
 *
 * An earlier version hardcoded `agentId = 0` and `1`. That passed on a fresh node
 * and then silently tested the wrong agents once the devchain had state from a
 * previous run — including a "stranger owns agent 1" assertion that was really
 * checking an agent the creator owned, which made the security case pass for the
 * wrong reason. Never hardcode an id the chain assigns.
 */
async function registerAgent(signer, uri) {
  const r = new ethers.Contract(REGISTRY, mockArt.abi, signer);
  const receipt = await (await r["register(string)"](uri)).wait();
  const iface = new ethers.Interface(mockArt.abi);
  for (const log of receipt.logs) {
    try {
      const p = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (p?.name === "Transfer" && p.args.from === ethers.ZeroAddress) return p.args.tokenId;
    } catch {
      /* not ours */
    }
  }
  throw new Error("register() emitted no mint Transfer");
}

// ── deploy the factory ──────────────────────────────────────────────────────
const facArt = art("AdextoCurveFactory");
const factory = await new ethers.ContractFactory(facArt.abi, facArt.bytecode, creator).deploy();
await factory.waitForDeployment();
const factoryAddr = await factory.getAddress();
console.log(`factory   : ${factoryAddr}  VERSION ${await factory.VERSION()}\n`);
check("factory VERSION is 0.10.0", (await factory.VERSION()) === "0.10.0", await factory.VERSION());
check(
  "AGENT_REGISTRY constant is the ERC-8004 address",
  (await factory.AGENT_REGISTRY()).toLowerCase() === REGISTRY.toLowerCase()
);

const tokenAbi = art("AdextoToken").abi;

async function launch(signer, symbol, bindAgent, agentId) {
  const f = new ethers.Contract(factoryAddr, facArt.abi, signer);
  const tx = await f.deployTrinity(
    `Test ${symbol}`,
    symbol,
    1_000_000_000n,
    await signer.getAddress(),
    ethers.parseEther("1"),
    30n,
    10n,
    5n,
    ethers.ZeroHash,
    bindAgent,
    agentId
  );
  const receipt = await tx.wait();
  const iface = new ethers.Interface(facArt.abi);
  let token = null;
  let bound = null;
  for (const log of receipt.logs) {
    try {
      const p = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (p?.name === "TrinityProjectDeployed") token = p.args.token;
      if (p?.name === "AgentBound") {
        bound = { agentId: p.args.agentId, registry: p.args.agentRegistry, owner: p.args.owner };
      }
    } catch {
      /* not ours */
    }
  }
  return { token, bound };
}

// ── 1. no agent identity: the one-transaction default still works ───────────
console.log("1. launch with NO agent identity (bindAgent = false)");
{
  const { token, bound } = await launch(creator, "NOAGENT", false, 0n);
  const t = new ethers.Contract(token, tokenAbi, provider);
  check("launch succeeds", token !== null, token);
  check("token.agentBound() == false", (await t.agentBound()) === false);
  check("token.agentId() == 0", (await t.agentId()) === 0n);
  check("token.agentRegistry() == address(0)", (await t.agentRegistry()) === ethers.ZeroAddress);
  check("no AgentBound event", bound === null);
}

// ── 2. register then bind ───────────────────────────────────────────────────
console.log("\n2. register an agent, then bind it at launch");
const CID = `ipfs://bafkreiadextofixture${Date.now()}`;
let creatorAgent;
{
  creatorAgent = await registerAgent(creator, CID);
  check("agent minted to creator", (await registry.ownerOf(creatorAgent)) === creator.address, `agentId=${creatorAgent}`);
  check("tokenURI is the ipfs URI", (await registry.tokenURI(creatorAgent)) === CID);
}

// ── 3. binding another address's agent must be refused ─────────────────────
console.log("\n3. SECURITY: binding an agent owned by somebody else");
{
  const strangerAgent = await registerAgent(stranger, "ipfs://stranger");
  check(
    "stranger owns their own agent",
    (await registry.ownerOf(strangerAgent)) === stranger.address,
    `agentId=${strangerAgent}`
  );
  check("stranger's agent is NOT the creator's", strangerAgent !== creatorAgent);
  await expectRevert(
    "creator CANNOT bind the stranger's agent",
    () => launch(creator, "STOLEN", true, strangerAgent),
    "agent not owned by caller"
  );
}

// ── 4. an id that was never minted ─────────────────────────────────────────
console.log("\n4. an agentId that does not exist");
await expectRevert(
  "unregistered agentId reverts with our own message",
  () => launch(creator, "GHOST", true, 9999n),
  "agent id not registered"
);

// ── 5. a non-zero id with bindAgent false must not be silently dropped ─────
console.log("\n5. agentId supplied but bindAgent false");
await expectRevert(
  "mismatched flags are rejected instead of ignored",
  () => launch(creator, "MISMATCH", false, 5n),
  "agentId set without bindAgent"
);

// ── 6. REGRESSION: agent 0 is a real agent and must be bindable ────────────
console.log("\n6. REGRESSION: binding agent id 0, which the old sentinel made impossible");
{
  // Only meaningful when the creator actually holds id 0, which is the case on a
  // fresh node because the injected registry starts from zeroed storage. Stated
  // rather than assumed, so a dirty chain reports a skip instead of a false pass.
  check(
    "creator holds agent id 0 (fresh devchain)",
    creatorAgent === 0n,
    creatorAgent === 0n ? "" : `got ${creatorAgent} — restart the devchain for this case`
  );
  const { token, bound } = await launch(creator, "AGENTZERO", true, creatorAgent);
  const t = new ethers.Contract(token, tokenAbi, provider);
  check("launch with agentId 0 succeeds", token !== null, token);
  check("token.agentBound() == true", (await t.agentBound()) === true);
  check("token.agentId() == 0", (await t.agentId()) === 0n);
  check(
    "token.agentRegistry() == registry",
    (await t.agentRegistry()).toLowerCase() === REGISTRY.toLowerCase()
  );
  check("AgentBound emitted for agent 0", bound !== null && bound.agentId === 0n);
  check(
    "bound token is distinguishable from an unbound one despite id 0",
    (await t.agentBound()) === true
  );
  // The whole point of the binding: resolve the agent's registration file.
  const uri = await registry.tokenURI(await t.agentId());
  check("agent registration file resolves from the token", uri === CID, uri);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
