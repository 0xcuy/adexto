#!/usr/bin/env node
/**
 * One entry point for building and deploying this subgraph to any network.
 *
 * WHY THIS REPLACED PER-NETWORK NPM SCRIPTS
 *
 * The first cut had `build:0g-testnet`, `deploy:monad-testnet`, `build:base-sepolia`
 * and so on -- one hand-written pair per chain, all of them testnet. Broadcasting
 * a mainnet factory would have meant adding four more scripts and remembering
 * which of them go to Studio and which to our own node. That is how a stack ends
 * up with `deploy:0g-testnet` pointed at mainnet.
 *
 * Here the network list comes from chains.json and networks.json, and the
 * Studio-vs-self-hosted routing comes from each chain's `target`. Nothing in this
 * file names a chain.
 *
 *   node graph-ops.mjs list
 *   node graph-ops.mjs build <network>
 *   node graph-ops.mjs deploy <network>
 *   node graph-ops.mjs build-all
 *   node graph-ops.mjs deploy-all [--studio | --self-hosted]
 *
 * Every graph-cli invocation is followed by reset-manifest.mjs, because
 * `graph build|deploy --network X` rewrites the tracked subgraph.yaml in place
 * and strips its comments.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(here, name), 'utf8'));

const chains = read('chains.json');
const pkg = read('package.json');
const networksPath = join(here, 'networks.json');

if (!existsSync(networksPath)) {
  console.error('networks.json is missing. Run: npm run networks');
  process.exit(1);
}
const networks = read('networks.json');

const VERSION_LABEL = `v${pkg.version}`;
const NODE_URL = process.env.GRAPH_NODE_URL ?? 'http://127.0.0.1:8020';
const IPFS_URL = process.env.GRAPH_IPFS_URL ?? 'http://127.0.0.1:5001';

/** Networks that have both metadata and a deployed factory address. */
function indexable() {
  return Object.keys(networks)
    .filter((name) => chains[name])
    .map((name) => ({ name, ...chains[name], ...networks[name].AdextoCurveFactory }));
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: here, stdio: 'inherit' });
  return r.status ?? 1;
}

/** graph-cli rewrites subgraph.yaml in place; always put it back. */
function withManifestReset(fn) {
  try {
    return fn();
  } finally {
    spawnSync('node', ['reset-manifest.mjs'], { cwd: here, stdio: 'inherit' });
  }
}

function resolve(name) {
  const found = indexable().find((n) => n.name === name);
  if (found) return found;
  if (chains[name]) {
    console.error(
      `${name} has no deployed curveFactory in build/deployments.json, so there ` +
        `is nothing to index. Broadcast the factory, then: npm run networks`,
    );
  } else {
    console.error(`unknown network: ${name}`);
    console.error(`known: ${Object.keys(chains).filter((k) => !k.startsWith('_')).join(', ')}`);
  }
  process.exit(1);
}

function cmdList() {
  const all = indexable();
  const pad = Math.max(...all.map((n) => n.name.length), 12);
  const group = (target, title, note) => {
    const rows = all.filter((n) => n.target === target);
    console.log(`\n${title}`);
    console.log(`  ${note}`);
    if (!rows.length) return console.log('  (none)');
    for (const n of rows) {
      const dest = target === 'studio' ? n.studioSlug : `adexto/${n.name}`;
      console.log(
        `  ${n.name.padEnd(pad)}  ${n.address}  startBlock=${String(n.startBlock).padEnd(10)}  -> ${dest}`,
      );
    }
  };
  group('studio', 'Subgraph Studio', 'needs `graph auth <deploy key>` once; The Graph runs the infrastructure');
  group('self-hosted', 'Self-hosted Graph Node', `needs subgraph/docker-compose.yml up; node ${NODE_URL}`);

  const pending = Object.entries(chains)
    .filter(([k]) => !k.startsWith('_'))
    .filter(([k]) => !networks[k]);
  console.log('\nNo factory deployed yet, nothing to index');
  console.log(
    pending.length
      ? pending.map(([k, v]) => `  ${k.padEnd(pad)}  ${v.label} (target=${v.target})`).join('\n')
      : '  (none)',
  );
  console.log();
  return 0;
}

function cmdBuild(name) {
  const net = resolve(name);
  return withManifestReset(() => run('npx', ['graph', 'build', '--network', net.name]));
}

function cmdDeploy(name) {
  const net = resolve(name);
  return withManifestReset(() => {
    if (net.target === 'studio') {
      return run('npx', [
        'graph', 'deploy',
        '--network', net.name,
        net.studioSlug,
        '--version-label', VERSION_LABEL,
      ]);
    }
    const slug = `adexto/${net.name}`;
    // `graph create` fails if the name already exists. That is not an error for
    // a redeploy, so its status is deliberately ignored.
    run('npx', ['graph', 'create', '--node', NODE_URL, slug]);
    return run('npx', [
      'graph', 'deploy',
      '--node', NODE_URL,
      '--ipfs', IPFS_URL,
      '--network', net.name,
      slug,
      '--version-label', VERSION_LABEL,
    ]);
  });
}

function cmdAll(action, filter) {
  const rows = indexable().filter((n) => !filter || n.target === filter);
  const results = [];
  for (const n of rows) {
    const status = action === 'build' ? cmdBuild(n.name) : cmdDeploy(n.name);
    results.push({ name: n.name, target: n.target, status });
  }
  console.log(`\n${action} summary`);
  for (const r of results) {
    console.log(`  ${r.status === 0 ? 'ok  ' : 'FAIL'} ${r.name} (${r.target})`);
  }
  const failed = results.filter((r) => r.status !== 0).length;
  if (failed) console.log(`\n${failed} of ${results.length} failed`);
  return failed ? 1 : 0;
}

const [action, arg] = process.argv.slice(2);
const filter = process.argv.includes('--studio')
  ? 'studio'
  : process.argv.includes('--self-hosted')
    ? 'self-hosted'
    : null;

let status;
switch (action) {
  case 'list':
    status = cmdList();
    break;
  case 'build':
    status = arg ? cmdBuild(arg) : (console.error('usage: build <network>'), 1);
    break;
  case 'deploy':
    status = arg ? cmdDeploy(arg) : (console.error('usage: deploy <network>'), 1);
    break;
  case 'build-all':
    status = cmdAll('build', filter);
    break;
  case 'deploy-all':
    status = cmdAll('deploy', filter);
    break;
  default:
    console.error(
      [
        'usage: node graph-ops.mjs <command>',
        '',
        '  list                        networks, addresses, and where each one deploys',
        '  build <network>             compile against one network',
        '  deploy <network>            Studio or our own node, decided by chains.json',
        '  build-all                   every network with a deployed factory',
        '  deploy-all [--studio|--self-hosted]',
        '',
        `  version label: ${VERSION_LABEL} (from package.json)`,
        `  self-hosted node: ${NODE_URL}   ipfs: ${IPFS_URL}`,
        '  override with GRAPH_NODE_URL / GRAPH_IPFS_URL',
      ].join('\n'),
    );
    status = 1;
}
process.exit(status);
