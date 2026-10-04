#!/usr/bin/env node
/**
 * Renders the README's diagrams and icons.
 *
 *   node docs/assets/readme/render.mjs
 *
 * Writes, next to this file:
 *   architecture-light.png, architecture-dark.png   how the pieces fit together
 *   launch-light.png, launch-dark.png               one launch transaction and the fee split
 *   icons/<name>.svg                                Lucide icons for the README grids
 *
 * Every word is set in HTML with the site's own fonts (src/app/fonts) and rendered by Playwright at 2x on
 * a transparent background, so each variant sits on GitHub's own light or dark page. Before anything is
 * written, the layout is checked in the page: nothing overlaps, nothing is clipped, no connector runs
 * through a box, every text meets 4.5:1 contrast against what is behind it. Any finding stops the run.
 *
 * Facts drawn here must match the README. They are read from chain there, not here: this file only draws.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const b64 = (p) => readFileSync(path.join(ROOT, p)).toString("base64");
const svgUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Lucide icons, read from the installed lucide-react (ISC) ────────────────────────────────────────
const lucideDir = path.join(path.dirname(require.resolve("lucide-react/package.json")), "dist/esm/icons");
function iconNodes(name) {
  const src = readFileSync(path.join(lucideDir, `${name}.js`), "utf8");
  // Some names are aliases that only re-export another file; use the canonical name instead.
  if (!src.includes("createLucideIcon(")) throw new Error(`lucide icon "${name}" is an alias: ${src.match(/from '([^']+)'/g)?.pop()}`);
  const start = src.indexOf("[", src.indexOf("createLucideIcon("));
  const end = src.lastIndexOf("]);");
  return Function(`"use strict"; return (${src.slice(start, end + 1)});`)();
}
function icon(name, color, size = 20, width = 2) {
  const body = iconNodes(name)
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}="${esc(v)}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// ── Brand assets ────────────────────────────────────────────────────────────────────────────────────
const FONTS = `
@font-face{font-family:"Bricolage";src:url(data:font/woff2;base64,${b64("src/app/fonts/BricolageGrotesque-Variable.woff2")}) format("woff2");font-weight:200 800;}
@font-face{font-family:"InterV";src:url(data:font/woff2;base64,${b64("src/app/fonts/Inter-Variable.woff2")}) format("woff2");font-weight:100 900;}`;
const CHAINS = [
  ["Monad", svgUrl(readFileSync(path.join(ROOT, "public/brand/monad.svg"), "utf8"))],
  ["Arbitrum One", svgUrl(readFileSync(path.join(ROOT, "public/brand/arbitrum.svg"), "utf8"))],
  ["Robinhood Chain", svgUrl(readFileSync(path.join(ROOT, "public/brand/robinhood.svg"), "utf8"))],
  ["Base", svgUrl(readFileSync(path.join(ROOT, "public/brand/base.svg"), "utf8"))],
  ["0G", `data:image/png;base64,${b64("public/brand/0g-token.png")}`],
];

// ── Themes: the page behind each variant is GitHub's own canvas ─────────────────────────────────────
const THEMES = {
  light: {
    page: "#ffffff", ink: "#1f2328", muted: "#59636e",
    panel: "#f6f8fa", panelBorder: "#d1d9e0", card: "#ffffff", cardBorder: "#d1d9e0",
    ours: "#6d28d9", oursSoft: "#f3efff", oursBorder: "#c4b5fd",
    chain: "#047857", chainSoft: "#e8f8f1", chainBorder: "#99e2c5",
    third: "#59636e", thirdBorder: "#9aa4ae",
    arrow: "#7c3aed", code: "#eff1f4", codeInk: "#1f2328",
    shadow: "0 1px 2px rgba(31,35,40,.06), 0 8px 22px rgba(31,35,40,.07)",
    fee: ["#7c3aed", "#10b981", "#f59e0b", "#0ea5e9"], feeInk: "#ffffff",
  },
  dark: {
    page: "#0d1117", ink: "#e6edf3", muted: "#9da7b3",
    panel: "#151b23", panelBorder: "#2f3742", card: "#0d1117", cardBorder: "#3d444d",
    ours: "#b39dff", oursSoft: "rgba(124,58,237,.20)", oursBorder: "rgba(167,139,250,.50)",
    chain: "#4ade9f", chainSoft: "rgba(16,185,129,.16)", chainBorder: "rgba(52,211,153,.42)",
    third: "#9da7b3", thirdBorder: "#59636e",
    arrow: "#a78bfa", code: "#1f2630", codeInk: "#e6edf3",
    shadow: "0 1px 2px rgba(0,0,0,.45), 0 10px 26px rgba(0,0,0,.40)",
    fee: ["#a78bfa", "#34d399", "#fbbf24", "#38bdf8"], feeInk: "#0d1117",
  },
};

const baseCss = (t, W, H) => `${FONTS}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;background:transparent;overflow:hidden}
body{position:relative;font-family:InterV,sans-serif;color:${t.ink};-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
.panel{position:absolute;border-radius:18px;background:${t.panel};border:1px solid ${t.panelBorder}}
.ptitle{position:absolute;font:700 11.5px/1 InterV;letter-spacing:.13em;text-transform:uppercase;color:${t.muted};white-space:nowrap}
.card{position:absolute;border-radius:14px;background:${t.card};border:1px solid ${t.cardBorder};box-shadow:${t.shadow};padding:16px 18px;overflow:hidden}
.card.ours{border-color:${t.oursBorder}}
.card.chain{border-color:${t.chainBorder}}
.card.third{border-style:dashed;border-color:${t.thirdBorder};box-shadow:none;background:transparent}
.head{display:flex;align-items:center;gap:11px;min-width:0}
.ic{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:${t.oursSoft};flex:none}
.ic.chain{background:${t.chainSoft}}
.ic.third{background:transparent;border:1px dashed ${t.thirdBorder}}
.tt{display:flex;flex-direction:column;gap:3px;min-width:0}
.title{font:650 16px/1.15 InterV;white-space:nowrap;letter-spacing:-.005em}
.sub{font:400 13px/1.25 InterV;color:${t.muted};white-space:nowrap}
.code{font:500 12px/1 "DejaVu Sans Mono",ui-monospace,monospace;background:${t.code};color:${t.codeInk};padding:4px 7px;border-radius:6px;white-space:nowrap}
.trow{display:flex;align-items:center;gap:8px}
ul.b{list-style:none;margin-top:13px;display:grid;gap:7px}
ul.b li{position:relative;padding-left:16px;font:400 13.5px/1.3 InterV;color:${t.muted};white-space:nowrap}
ul.b li::before{content:"";position:absolute;left:2px;top:7px;width:6px;height:6px;border-radius:50%;background:${t.ours}}
.chain ul.b li::before{background:${t.chain}}
.chip{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px 0 9px;border-radius:999px;border:1px dashed ${t.thirdBorder};font:500 12.5px/1 InterV;color:${t.muted};white-space:nowrap}
.chip img{width:18px;height:18px;object-fit:contain;display:block}
.chip svg{display:block}
.solid{border-style:solid;border-color:${t.chainBorder};background:${t.card};color:${t.ink}}
.label{position:absolute;font:500 12.5px/1.2 InterV;color:${t.muted};white-space:nowrap}
.wires{position:absolute;left:0;top:0;pointer-events:none}
`;

const marker = (t) => `<defs><marker id="ah" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${t.arrow}"/></marker></defs>`;

// ── Diagram 1: architecture ─────────────────────────────────────────────────────────────────────────
function architecture(t) {
  const W = 1200, H = 818;
  const L = [48, 424, 800], LW = 352, cx = L.map((x) => x + LW / 2);
  const clients = [
    ["users", "People", "in a browser, with their own wallet"],
    ["bot", "AI agents", "any MCP client, with their own key"],
    ["terminal", "Any HTTP client", "x402: no SDK, no account"],
  ];
  const services = [
    ["globe", "Web app", "adexto.xyz", ["Studio: one transaction, gas only", "Terminal, explorer, creator earnings", "History from the market index"], `<img alt="" src="${CHAINS[4][1]}">`, "0G DA · launch metadata"],
    ["plug", "MCP server", "/api/mcp", ["14 tools, stateless", "prepare_* return unsigned transactions", "ask_agent answers stakers"], icon("cpu", t.muted, 18), "0G Compute · agent inference"],
    ["zap", "x402 gateway", "x402.adexto.xyz", ["402 quote with the exact USDC terms", "Delivers first, then settles", "Cloudflare Worker, own relayer key"], `<img alt="" src="${CHAINS[3][1]}">`, "USDC on Base · EIP-3009"],
  ];
  const onchain = [
    ["blocks", "AdextoFactory", "1.0.0", ["Byte-identical on five chains", "Token and curve in one transaction", "Checks ERC-8004 ownerOf if asked"]],
    ["layers", "Stake contracts", null, ["AdextoStakeHub, one per chain", "Every market, from its first block", "Opens ask_agent and Agent Compute"]],
    ["chart-candlestick", "Curve + token", null, ["100% of supply, virtual reserve", "Fee legs fixed at launch", "No owner, no withdraw"]],
  ];
  const cl = clients.map(([ic, ti, su], i) => `
    <div class="card ours" data-box data-id="c${i}" style="left:${L[i]}px;top:32px;width:${LW}px;height:72px;padding:16px 18px">
      <div class="head"><div class="ic">${icon(ic, t.ours, 20)}</div><div class="tt"><div class="title">${ti}</div><div class="sub">${su}</div></div></div>
    </div>`).join("");
  const sv = services.map(([ic, ti, host, bl, chipIcon, chip], i) => `
    <div class="card ours" data-box data-id="s${i}" style="left:${L[i]}px;top:196px;width:${LW}px;height:186px">
      <div class="head"><div class="ic">${icon(ic, t.ours, 20)}</div><div class="trow"><div class="title">${ti}</div><div class="code">${esc(host)}</div></div></div>
      <ul class="b">${bl.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div style="margin-top:13px"><span class="chip">${chipIcon}${esc(chip)}</span></div>
    </div>`).join("");
  const oc = onchain.map(([ic, ti, ver, bl], i) => `
    <div class="card chain" data-box data-id="o${i}" style="left:${L[i]}px;top:498px;width:${LW}px;height:148px">
      <div class="head"><div class="ic chain">${icon(ic, t.chain, 20)}</div><div class="trow"><div class="title">${ti}</div>${ver ? `<div class="code">${ver}</div>` : ""}</div></div>
      <ul class="b">${bl.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>`).join("");
  const chips = `<div data-box data-id="chips" style="position:absolute;left:32px;top:698px;width:1136px;display:flex;justify-content:center;gap:12px">
      ${CHAINS.map(([n, src]) => `<span class="chip solid"><img alt="" src="${src}">${n}</span>`).join("")}
    </div>`;
  const lane1 = ["HTTPS", "MCP, streamable HTTP", "HTTP 402 + EIP-3009"];
  const lane2 = ["your wallet signs", "the agent signs", "buy(), sent to the payer"];
  const labels = [
    ...lane1.map((s, i) => `<div class="label" data-box data-id="l1${i}" style="left:${cx[i] + 12}px;top:120px">${esc(s)}</div>`),
    ...lane2.map((s, i) => `<div class="label" data-box data-id="l2${i}" style="left:${cx[i] + 12}px;top:424px">${esc(s)}</div>`),
    `<div class="label" data-box data-id="lu" style="left:600px;top:662px;transform:translateX(-50%);background:${t.panel};padding:3px 10px;color:${t.ink}">deployTrinity: token and curve in one transaction</div>`,
  ].join("");
  const legend = `<div data-box data-id="legend" style="position:absolute;left:0;top:772px;width:${W}px;display:flex;justify-content:center;gap:26px;font:500 12.5px/1 InterV;color:${t.muted}">
      <span style="display:flex;align-items:center;gap:8px"><svg width="30" height="10"><line x1="1" y1="5" x2="22" y2="5" stroke="${t.arrow}" stroke-width="2"/><path d="M21 1 L29 5 L21 9 z" fill="${t.arrow}"/></svg>signed call or transaction</span>
      <span style="display:flex;align-items:center;gap:8px"><i style="width:14px;height:14px;border-radius:4px;border:1.5px solid ${t.oursBorder};background:${t.oursSoft}"></i>run by ADEXTO</span>
      <span style="display:flex;align-items:center;gap:8px"><i style="width:14px;height:14px;border-radius:4px;border:1.5px solid ${t.chainBorder};background:${t.chainSoft}"></i>contract on chain</span>
      <span style="display:flex;align-items:center;gap:8px"><i style="width:14px;height:14px;border-radius:4px;border:1.5px dashed ${t.thirdBorder}"></i>third party</span>
    </div>`;
  const wires = [
    ...cx.map((x, i) => ({ d: `M${x} 106 L${x} 193`, from: `c${i}`, to: `s${i}` })),
    ...cx.map((x, i) => ({ d: `M${x} 384 L${x} 495`, from: `s${i}`, to: `o${i}` })),
    { d: `M${cx[0]} 648 L${cx[0]} 674 L${cx[2]} 674 L${cx[2]} 650`, from: "o0", to: "o2", label: "lu" },
  ];
  const svg = `<svg class="wires" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${marker(t)}
    ${wires.map((w) => `<path data-wire data-from="${w.from}" data-to="${w.to}" data-label="${w.label || ""}" d="${w.d}" fill="none" stroke="${t.arrow}" stroke-width="2" stroke-linejoin="round" marker-end="url(#ah)"/>`).join("")}
  </svg>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(t, W, H)}</style></head><body>
    <div class="panel" style="left:32px;top:160px;width:1136px;height:242px"></div>
    <div class="ptitle" data-box data-id="pt1" style="left:50px;top:174px">Run by ADEXTO</div>
    <div class="panel" style="left:32px;top:462px;width:1136px;height:284px"></div>
    <div class="ptitle" data-box data-id="pt2" style="left:50px;top:476px">On chain</div>
    ${svg}${cl}${sv}${oc}${chips}${labels}${legend}
  </body></html>`;
  return { W, H, html };
}

// ── Diagram 2: one launch and the fee split ─────────────────────────────────────────────────────────
function launch(t) {
  const W = 1200, H = 520;
  const steps = [
    ["Deploys the curve", "first, so the token can bind it immutably"],
    ["Deploys the token", "fixed supply, minted entirely to the factory"],
    ["Seeds 100% of supply into the curve", "then requires its own balance to be zero"],
  ];
  const stepY = [66, 158, 250];
  const st = steps.map(([a, b], i) => `
    <div style="position:absolute;left:50px;top:${stepY[i] + 20}px;width:36px;height:36px;border-radius:50%;background:${t.chainSoft};border:1.5px solid ${t.chainBorder};display:grid;place-items:center;font:700 15px/1 InterV;color:${t.chain}" data-box data-id="n${i}">${i + 1}</div>
    <div class="card chain" data-box data-id="st${i}" style="left:104px;top:${stepY[i]}px;width:472px;height:76px;padding:15px 18px">
      <div class="tt"><div class="title">${esc(a)}</div><div class="sub">${esc(b)}</div></div>
    </div>`).join("");
  const legs = [
    ["Creator", "0.70%", "accrues as creatorOwed, always paid to the immutable creator"],
    ["Depth", "0.10%", "stays in the curve and raises the price floor"],
    ["Buyback", "0.10%", "anyone may spend it on the curve and burn what it buys"],
    ["Protocol", "0.10%", "protocolOwed, claimable only to the immutable treasury"],
  ];
  const rowsY = [204, 268, 332, 396];
  const lg = legs.map(([n, r, d], i) => `
    <div data-box data-id="leg${i}" style="position:absolute;left:624px;top:${rowsY[i]}px;width:528px;height:56px">
      <div style="display:flex;align-items:center;gap:10px"><i style="width:12px;height:12px;border-radius:4px;background:${t.fee[i]};flex:none"></i><span style="font:650 15px/1.2 InterV">${n}</span><span style="margin-left:auto;font:650 15px/1.2 InterV;font-variant-numeric:tabular-nums">${r}</span></div>
      <div style="margin:6px 0 0 22px;font:400 13px/1.3 InterV;color:${t.muted};white-space:nowrap">${esc(d)}</div>
    </div>`).join("");
  const bar = [0.7, 0.1, 0.1, 0.1];
  const barW = 528, gap = 3;
  let x = 624;
  const segs = bar.map((f, i) => {
    const w = (barW - gap * 3) * f;
    const s = `<div ${i === 0 ? 'data-box data-id="seg0"' : ""} style="position:absolute;left:${x}px;top:140px;width:${w}px;height:34px;border-radius:${i === 0 ? "10px 4px 4px 10px" : i === 3 ? "4px 10px 10px 4px" : "4px"};background:${t.fee[i]};${i === 0 ? `display:flex;align-items:center;padding-left:14px;font:650 13px/1 InterV;color:${t.feeInk}` : ""}">${i === 0 ? "0.70% to the creator" : ""}</div>`;
    x += w + gap;
    return s;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(t, W, H)}</style></head><body>
    <div class="panel" style="left:32px;top:24px;width:560px;height:472px"></div>
    <div class="ptitle" data-box data-id="pa" style="left:50px;top:40px">One launch transaction</div>
    <div style="position:absolute;left:67px;top:108px;width:2px;height:184px;background:${t.chainBorder}"></div>
    ${st}
    <div class="card third" data-box data-id="agent" style="left:50px;top:346px;width:526px;height:72px;padding:14px 16px">
      <div class="head"><div class="ic third">${icon("shield-check", t.third, 20)}</div><div class="tt"><div class="title">Optional ERC-8004 binding</div><div class="sub">ownerOf(agentId) must be the caller, or the launch reverts</div></div></div>
    </div>
    <div data-box data-id="note1" style="position:absolute;left:52px;top:440px;font:400 13px/1.3 InterV;color:${t.muted};white-space:nowrap"><span class="code">deployTrinity</span> is not payable, so nothing can be deposited.</div>
    <div class="panel" style="left:608px;top:24px;width:560px;height:472px"></div>
    <div class="ptitle" data-box data-id="pb" style="left:626px;top:40px">Every trade, standard preset</div>
    <div data-box data-id="big" style="position:absolute;left:624px;top:66px;font:700 54px/1 Bricolage;letter-spacing:-.02em;color:${t.ink}">1.00%</div>
    <div data-box data-id="bigsub" style="position:absolute;left:804px;top:74px;font:400 13.5px/1.45 InterV;color:${t.muted};white-space:nowrap">what a trader pays in total,<br>read from the curve as <span class="code">totalFeeBps()</span> 100</div>
    ${segs}${lg}
    <div data-box data-id="note2" style="position:absolute;left:626px;top:462px;font:400 13px/1.3 InterV;color:${t.muted};white-space:nowrap">No rate has a setter. The six <span class="code">0.11.0</span> markets keep 0.40%.</div>
  </body></html>`;
  return { W, H, html };
}

// ── Checks run inside the page ─────────────────────────────────────────────────────────────────────
function pageChecks(pageBg) {
  const issues = [];
  const boxes = [...document.querySelectorAll("[data-box]")].map((el) => ({ el, id: el.dataset.id, r: el.getBoundingClientRect() }));
  const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  const inter = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const b of boxes) {
    if (b.r.left < 0 || b.r.top < 0 || b.r.right > W || b.r.bottom > H) issues.push(`${b.id} leaves the canvas`);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (inter(boxes[i].r, boxes[j].r)) issues.push(`${boxes[i].id} overlaps ${boxes[j].id}`);
  // Text that is wider than its container, or a card whose content runs past its bottom edge.
  for (const el of document.querySelectorAll(".card, .card *, .label, .ptitle, .chip")) {
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible") issues.push(`clipped: ${el.className || el.tagName} "${el.textContent.trim().slice(0, 40)}"`);
  }
  for (const card of document.querySelectorAll(".card")) {
    const cr = card.getBoundingClientRect();
    for (const ch of card.querySelectorAll("*")) {
      const r = ch.getBoundingClientRect();
      if (r.width && (r.right > cr.right - 6 || r.bottom > cr.bottom - 6)) issues.push(`runs out of its card: "${ch.textContent.trim().slice(0, 40)}"`);
    }
  }
  // Connectors must not cross any box other than the two they join and their own label.
  for (const p of document.querySelectorAll("[data-wire]")) {
    const len = p.getTotalLength();
    for (let s = 6; s < len - 6; s += 3) {
      const pt = p.getPointAtLength(s);
      for (const b of boxes) {
        if ([p.dataset.from, p.dataset.to, p.dataset.label].includes(b.id)) continue;
        if (pt.x > b.r.left && pt.x < b.r.right && pt.y > b.r.top && pt.y < b.r.bottom) {
          issues.push(`wire ${p.dataset.from}→${p.dataset.to} crosses ${b.id}`);
          s = len;
          break;
        }
      }
    }
  }
  // Contrast of every text run against the composited background behind it.
  const parse = (c) => {
    const hex = c.match(/^#([0-9a-f]{6})$/i);
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
  };
  const over = (top, bottom) => [0, 1, 2].map((k) => top[k] * top[3] + bottom[k] * (1 - top[3])).concat(1);
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const page = parse(pageBg);
  let worst = { ratio: 99, text: "" };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    const layers = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const bg = parse(getComputedStyle(e).backgroundColor);
      if (bg && bg[3] > 0) layers.push(bg);
    }
    // Absolutely positioned text sits on whatever panel is under it, not on its DOM parent.
    const r = el.getBoundingClientRect();
    const under = [...document.querySelectorAll(".panel")].filter((pn) => inter(pn.getBoundingClientRect(), r));
    let bg = page;
    for (const pn of under) bg = over(parse(getComputedStyle(pn).backgroundColor), bg);
    for (const l of layers.reverse()) bg = over(l, bg);
    const fg = over(parse(getComputedStyle(el).color), bg);
    const a = lum(fg), b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < worst.ratio) worst = { ratio, text: node.textContent.trim().slice(0, 40) };
    if (ratio < 4.5) issues.push(`contrast ${ratio.toFixed(2)}:1 for "${node.textContent.trim().slice(0, 40)}"`);
  }
  const fonts = ["16px InterV", "16px Bricolage"].map((f) => `${f.split(" ")[1]}:${document.fonts.check(f)}`);
  return { issues, worst, fonts, boxes: boxes.length };
}

// ── Render ──────────────────────────────────────────────────────────────────────────────────────────
mkdirSync(path.join(HERE, "icons"), { recursive: true });
const ICONS = ["globe", "bot", "terminal", "arrow-left-right", "hand-coins", "sparkles", "layers", "chart-candlestick"];
for (const n of ICONS) writeFileSync(path.join(HERE, "icons", `${n}.svg`), icon(n, "#8b5cf6", 24, 1.75) + "\n");

let sharp = null;
try {
  sharp = require("sharp");
} catch {
  // Optional: without sharp the PNGs are written as Chromium produced them, only larger.
}

const browser = await chromium.launch();
let failed = 0;
for (const [name, build] of [["architecture", architecture], ["launch", launch]]) {
  for (const [themeName, t] of Object.entries(THEMES)) {
    const { W, H, html } = build(t);
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });
    // Load both faces explicitly: a face nothing on the page uses yet would otherwise report as missing.
    await page.evaluate(() => Promise.all([document.fonts.load("16px InterV"), document.fonts.load("700 16px Bricolage")]));
    await page.evaluate(() => document.fonts.ready);
    const res = await page.evaluate(pageChecks, t.page);
    const out = path.join(HERE, `${name}-${themeName}.png`);
    console.log(`${path.basename(out)}: ${res.boxes} boxes, fonts ${res.fonts.join(" ")}, worst contrast ${res.worst.ratio.toFixed(2)}:1 ("${res.worst.text}")`);
    if (res.issues.length || res.fonts.some((f) => f.endsWith("false"))) {
      res.issues.forEach((i) => console.log(`  ✗ ${i}`));
      failed++;
      await page.close();
      continue;
    }
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
    const buf = sharp ? await sharp(png).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer() : png;
    writeFileSync(out, buf);
    console.log(`  wrote ${W * 2}x${H * 2}, ${(buf.length / 1024).toFixed(0)} KB`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
