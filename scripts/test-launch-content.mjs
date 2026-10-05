/**
 * Launch content checks (src/lib/launch-content.ts) and the terms line in the launch attestation
 * (src/config/terms.ts). No network, no chain.
 *
 * Usage: node --experimental-transform-types --import ./scripts/node-alias-hook.mjs scripts/test-launch-content.mjs
 */
const { checkLaunchContent } = await import("../src/lib/launch-content.ts");
const { TERMS_ACCEPTANCE_LINE, TERMS_VERSION } = await import("../src/config/terms.ts");
const { launchAttestationMessage } = await import("../src/lib/launch-attestation.ts");

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};
const ok = (c, official = false) => checkLaunchContent(c, official).ok;

// Every market listed today must still pass (ADEXTO names only for the official deployer).
for (const [name, symbol] of [
  ["Parcel Market", "PARCEL"],
  ["SAi Monad", "SAI"],
  ["SAi Robin", "SAI"],
  ["Loop", "LOOP"],
  ["Wombo", "WOMBO"],
  ["Bloop", "BLOOP"],
  ["Zeebo", "ZEEBO"],
  ["ARBT Test", "ARBTTEST"],
  ["Base Camp", "CAMP"],
  ["Circle of Friends", "CIRCLE"],
  ["Ledgerless Pals", "PALS"],
]) {
  check(`listed or plausible market passes: ${name}`, ok({ name, symbol, description: "An agent launched this market from its own wallet over MCP." }));
}
check("ADEXTO name passes for the official deployer", ok({ name: "ADEXTO Protocol", symbol: "ADT" }, true));
check("ADEXTO name is refused for anyone else", !ok({ name: "ADEXTO Rewards", symbol: "ADXR" }));

for (const [name, symbol] of [
  ["Official Monad Token", "OMT"],
  ["USDC Airdrop", "USDCA"],
  ["Mega Giveaway", "GIVE"],
  ["Free Mint Club", "FMC"],
  ["Coin", "AIRDROP"],
  ["Binance Agent", "BNA"],
  ["Coinbase Base Token", "CBT"],
  ["Tether Gold 2", "TG2"],
  ["MetaMask Rewards", "MMR"],
]) {
  check(`refused: ${name} / ${symbol}`, !ok({ name, symbol }));
}

for (const description of [
  "Enter your seed phrase to receive the bonus.",
  "Send us your private key for whitelist.",
  "Validate your wallet on our site first.",
  "Connect your wallet to claim 1000 tokens.",
  "Guaranteed returns of 20% a week.",
  "Risk-free 100x.",
]) {
  check(`refused description: ${description}`, !ok({ name: "Fine", symbol: "FINE", description }));
}

for (const [label, links] of [
  ["shortener", { website: "https://bit.ly/abc" }],
  ["bare IP", { website: "http://192.168.1.10/claim" }],
  ["punycode", { docs: "https://xn--adxto-9ra.xyz" }],
]) {
  check(`refused link: ${label}`, !ok({ name: "Fine", symbol: "FINE", links }));
}
check("normal links pass", ok({ name: "Fine", symbol: "FINE", links: { website: "https://example.org", github: "https://github.com/0xcuy/adexto", x: "adexto_" } }));

const msg = launchAttestationMessage("0x42478Ed9A429eC320d243469Fa5d6595BCc8daa5", "LOOP", 1);
check("attestation message ends with the terms line", msg.split("\n").at(-1) === TERMS_ACCEPTANCE_LINE);
check("terms line names the version and the URL", TERMS_ACCEPTANCE_LINE.includes(TERMS_VERSION) && TERMS_ACCEPTANCE_LINE.includes("https://adexto.xyz/terms"));
check("attestation still fits the 400-character limit", msg.length < 400, String(msg.length));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
