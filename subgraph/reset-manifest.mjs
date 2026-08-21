#!/usr/bin/env node
/**
 * Restore subgraph.yaml to its network-agnostic placeholder state.
 *
 * WHY THIS EXISTS
 * `graph build --network X` and `graph deploy --network X` do not only write
 * build/subgraph.yaml. They splice the `network`, `address` and `startBlock`
 * values out of networks.json back into the *tracked* source manifest, in
 * place, and they re-serialise the YAML -- which drops every comment in the
 * file. Left alone, subgraph.yaml ends up pinned to whichever chain happened to
 * be built last, `git status` shows a dirty file after every build, and the
 * next person to run a plain `graph build` silently builds against that
 * leftover chain.
 *
 * networks.json is the single source of truth (generated from
 * build/deployments.json by scripts/gen-subgraph-networks.py). This script puts
 * the manifest back to placeholders and re-inserts the warning header, so
 * nothing downstream can mistake the checked-in values for real config.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, 'subgraph.yaml');

const PLACEHOLDER_NETWORK = '0g';
const PLACEHOLDER_ADDRESS = '0x0000000000000000000000000000000000000000';
const PLACEHOLDER_START_BLOCK = '0';

const HEADER = [
  '# PERINGATAN: `graph build --network X` MENULIS ULANG BERKAS INI DI TEMPAT',
  '#',
  '# graph-cli menyalin `address` dan `startBlock` dari networks.json ke manifest',
  '# ini, bukan hanya ke build/, dan menghapus semua komentar saat menulis ulang.',
  '# Jadi nilai di bawah selalu hanya sisa build terakhir siapa pun. Nilai di',
  '# bawah sengaja placeholder supaya tidak ada yang memperlakukannya sebagai',
  '# konfigurasi sungguhan.',
  '#',
  '# Sumber kebenarannya adalah networks.json, yang dihasilkan dari',
  '# build/deployments.json oleh scripts/gen-subgraph-networks.py. Pakai skrip',
  '# npm (`npm run build:0g-testnet`, `npm run deploy:base-sepolia`, ...) yang',
  '# selalu memanggil `node reset-manifest.mjs` setelahnya untuk memulihkan',
  '# berkas ini.',
];

const original = readFileSync(manifestPath, 'utf8');

// Only the dataSources block carries address/startBlock. Templates have no
// source address at all, but they do declare their own `network`, and both must
// land on the same chain or graph-node refuses the manifest -- so every
// `network:` line gets rewritten.
let changed = 0;
const body = original
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .map((line) => {
    const rules = [
      [/^(\s*)network:\s*\S+\s*$/, (m) => `${m[1]}network: ${PLACEHOLDER_NETWORK}`],
      [/^(\s*)address:\s*.+$/, (m) => `${m[1]}address: "${PLACEHOLDER_ADDRESS}"`],
      [/^(\s*)startBlock:\s*.+$/, (m) => `${m[1]}startBlock: ${PLACEHOLDER_START_BLOCK}`],
    ];
    for (const [pattern, build] of rules) {
      const m = line.match(pattern);
      if (m) {
        const next = build(m);
        if (next !== line) changed += 1;
        return next;
      }
    }
    return line;
  });

const dataSourcesAt = body.findIndex((line) => line.startsWith('dataSources:'));
if (dataSourcesAt === -1) {
  console.error('reset-manifest: no `dataSources:` key found, refusing to write');
  process.exit(1);
}
body.splice(dataSourcesAt, 0, ...HEADER);

const next = body.join('\n');
if (next === original) {
  console.log('reset-manifest: subgraph.yaml already at placeholders');
  process.exit(0);
}

writeFileSync(manifestPath, next);
console.log(
  `reset-manifest: restored ${changed} value(s) and the warning header in subgraph.yaml`,
);
