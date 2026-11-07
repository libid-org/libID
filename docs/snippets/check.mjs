// Runs the code in the docs pages, unchanged, against a fork of Sepolia.
//
// Each page gets a fresh anvil fork at FORK_BLOCK, so the output the pages
// show stays the same. Needs node, anvil, forge and cast on the PATH.
// FORK_URL picks the Sepolia RPC; it must serve historical state and logs.
//
//   pnpm -C docs/snippets check
//
// A page's js blocks run as one module, with the page's first js block in
// front of it. A `node <file>.mjs` block ends the module, as running it
// would for the reader. Shell blocks that call `cast` or `forge create` run
// in bash, in order. A plain block after "you will see" must appear in the
// output. A block right after `<!-- check: skip, <reason> -->` is not run,
// and is reported as skipped.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pages = join(here, '..', 'pages');

const FORK_URL = process.env.FORK_URL ?? 'https://sepolia.gateway.tenderly.co';
const FORK_BLOCK = '12011279';
const PORT = process.env.FORK_PORT ?? '8645';
const ENV = {
  ...process.env,
  RPC_URL: `http://127.0.0.1:${PORT}`,
  IDENTITY_REGISTRY: '0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D',
  HANDLE_ESCROW: '0xE7eb0c675B757C12B1312dF652242b863624Bfab',
  FROM_BLOCK: '11963763',
  // anvil's second test account, funded on the fork.
  PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
};

const PAGES = [
  'get-started/quickstart',
  'guides/lookup-wallet',
  'guides/resolve-handle',
  'guides/gate-contract',
  'guides/pay-a-handle',
  'guides/events',
];

function blocks(markdown) {
  const out = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  for (let m; (m = re.exec(markdown)); ) {
    const before = markdown.slice(Math.max(0, m.index - 200), m.index);
    const skip = before.match(/<!-- check: skip, (.+?) -->\s*$/);
    out.push({
      lang: m[1],
      code: m[2],
      expected: m[1] === '' && /you will see:?\s*$/i.test(before),
      skip: skip?.[1],
    });
  }
  return out;
}

const RUN_SH = /^(cast |forge create|[A-Z_]+=\$\(forge create)/;
const NODE_SH = /^node \S+\.mjs\s*$/;

async function startFork() {
  const anvil = spawn('anvil', ['--fork-url', FORK_URL, '--fork-block-number', FORK_BLOCK, '--port', PORT, '--silent'], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      execFileSync('cast', ['block-number', '--rpc-url', ENV.RPC_URL], { stdio: 'ignore' });
      return anvil;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  anvil.kill();
  throw new Error(`anvil did not start a fork of ${FORK_URL}`);
}

// Modules are written under this directory, so that their imports resolve
// from its node_modules, and removed afterwards.
let modules = 0;
function runModule(code, dir) {
  const file = join(dir, `module-${modules++}.mjs`);
  writeFileSync(file, `${code}\nprocess.exit(0);\n`);
  return execFileSync('node', [file], { cwd: here, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

let failed = 0;
for (const page of PAGES) {
  const all = blocks(readFileSync(join(pages, `${page}.md`), 'utf8'));
  const setup = all.find((b) => b.lang === 'js');
  const work = mkdtempSync(join(tmpdir(), 'libid-docs-'));
  const scripts = mkdtempSync(join(here, '.run-'));
  const skipped = all.filter((b) => b.skip).map((b) => b.skip);
  let shell = [];
  let js = [];
  let output = '';
  const addJs = (b) => {
    if (js.length === 0 && setup && b !== setup) js.push(setup.code);
    js.push(b.code);
  };
  const flushJs = () => {
    if (js.length) output += runModule(js.join('\n'), scripts);
    js = [];
  };
  const flushShell = () => {
    if (shell.length) {
      output += execFileSync('bash', ['-euo', 'pipefail', '-c', shell.join('\n')], { cwd: work, env: ENV, encoding: 'utf8' });
    }
    shell = [];
  };
  const sol = all.filter((b) => b.lang === 'solidity').map((b) => b.code);
  if (sol.length) {
    mkdirSync(join(work, 'src'), { recursive: true });
    writeFileSync(join(work, 'foundry.toml'), '[profile.default]\n');
    writeFileSync(join(work, 'src', 'Gate.sol'), `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\n${sol.join('\n')}`);
  }
  let anvil;
  try {
    anvil = await startFork();
    for (const b of all) {
      if (b.skip) continue;
      if (b.lang === 'js') {
        flushShell();
        addJs(b);
      } else if (b.lang === 'sh' && NODE_SH.test(b.code)) {
        flushShell();
        flushJs();
      } else if (b.lang === 'sh' && RUN_SH.test(b.code)) {
        flushJs();
        shell.push(b.code);
      }
    }
    flushJs();
    flushShell();
    for (const b of all.filter((x) => x.expected)) {
      for (const line of b.code.trim().split('\n')) {
        if (!output.includes(line)) throw new Error(`expected output line missing: ${line}`);
      }
    }
    console.log(`ok   ${page}${skipped.length ? `, skipped: ${skipped.join('; ')}` : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${page}: ${e.message.split('\n')[0]}`);
  } finally {
    anvil?.kill();
    rmSync(scripts, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
