/**
 * Pemeriksa kartu agen ERC-8004 yang kami operasikan. Hanya membaca; tidak mengirim apa pun.
 *
 *   node scripts/check-agent-cards.mjs                 # terhadap https://adexto.xyz
 *   BASE_URL=http://127.0.0.1:3107 node scripts/check-agent-cards.mjs
 *
 * Daftar agen dibaca dari `/api/agents` situs yang diperiksa (satu sumber dengan halaman /agents),
 * lalu untuk setiap agen kartunya di alamat permanen `/agents/{chainId}/{agentId}/registration.json`
 * diperiksa:
 *   - bentuk registration-v1: type, name, description, image, services, x402Support, active;
 *   - `registrations[0]` cocok dengan chain dan id agen itu (bukti domain ERC-8004);
 *   - setiap endpoint di `services` hidup: web 200, MCP `tools/list` 200 dengan alat, x402 402 untuk
 *     URL pembelian atau 200 untuk openapi.json;
 *   - gambar terbuka sebagai image/*;
 *   - tidak ada frasa yang dilarang `audit_claims.mjs` dan tidak ada kata fungsi bahasa Indonesia.
 *
 * Keluar dengan kode 1 bila satu saja gagal. Ini syarat sebelum `scripts/set-agent-uri.mjs --send`.
 */
const BASE = (process.env.BASE_URL || "https://adexto.xyz").replace(/\/$/, "");
const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const BANNED = ["ERC-8004 compliant", "ERC-8004 compliance", "ERC-8004 Token", "Hardware Attested", "SEV-SNP", "settled trustlessly", "edge.adexto.xyz"];
const ID_WORDS = ["tidak", "yang", "dengan", "adalah", "karena", "bukan", "sudah", "supaya", "harus", "milik", "setiap"];

let failed = 0;
const line = (ok, label, extra = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${extra ? `  ${extra}` : ""}`);
};

async function get(url, init = {}) {
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(45_000), ...init });
  return res;
}

async function checkService(s) {
  const url = String(s.endpoint ?? "");
  if (!/^https:\/\//.test(url)) return [false, `${s.name}: not an https endpoint (${url})`];
  if (s.name === "MCP") {
    const res = await get(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const raw = await res.text();
    const data = raw.split("\n").find((l) => l.startsWith("data: "));
    let tools = 0;
    try {
      tools = JSON.parse(data ? data.slice(6) : raw)?.result?.tools?.length ?? 0;
    } catch {
      tools = 0;
    }
    return [res.status === 200 && tools > 0, `MCP ${url} -> ${res.status}, ${tools} tools`];
  }
  const res = await get(url);
  if (s.name === "x402") {
    const expected = url.endsWith("/openapi.json") ? 200 : 402;
    return [res.status === expected, `x402 ${url} -> ${res.status} (expected ${expected})`];
  }
  return [res.status === 200, `${s.name} ${url} -> ${res.status}`];
}

const dirRes = await get(`${BASE}/api/agents`);
if (dirRes.status !== 200) {
  console.error(`cannot read ${BASE}/api/agents: HTTP ${dirRes.status}`);
  process.exit(1);
}
const dir = await dirRes.json();
const agents = (dir.operatedAgents ?? []).filter((a) => a.ownedByAdexto);
console.log(`checking ${agents.length} agent cards on ${BASE}\n`);

for (const a of agents) {
  const url = `${BASE}/agents/${a.chainId}/${a.agentId}/registration.json`;
  console.log(`${a.chainId}:${a.agentId}  ${a.name}  ${url}`);
  const res = await get(url);
  if (res.status !== 200) {
    line(false, "card answers 200", `HTTP ${res.status}`);
    continue;
  }
  const card = await res.json();
  line(card.type === "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", "type is registration-v1");
  line(Boolean(card.name && card.description), "name and description present", card.name);
  line(card.x402Support === true && card.active === true, "x402Support and active");
  const reg = card.registrations?.[0];
  line(
    card.registrations?.length === 1 && String(reg?.agentId) === String(a.agentId) && reg?.agentRegistry === `eip155:${a.chainId}:${REGISTRY}`,
    "registrations match this agent",
    JSON.stringify(reg)
  );
  const text = `${card.name} ${card.description}`;
  const banned = BANNED.filter((b) => text.includes(b));
  const indo = ID_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
  line(banned.length === 0 && indo.length === 0, "copy clean", [...banned, ...indo].join(", "));
  const img = await get(card.image);
  line(img.status === 200 && /^image\//.test(img.headers.get("content-type") ?? ""), "image opens", `${img.status} ${img.headers.get("content-type")}`);
  for (const s of card.services ?? []) {
    try {
      const [ok, detail] = await checkService(s);
      line(ok, `service ${s.name}`, detail);
    } catch (e) {
      line(false, `service ${s.name}`, String(e?.message ?? e).slice(0, 120));
    }
  }
  console.log("");
}

console.log(failed ? `${failed} check(s) FAILED` : `all ${agents.length} cards passed`);
process.exit(failed ? 1 : 0);
