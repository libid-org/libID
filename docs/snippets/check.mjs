// Runs the code in the docs pages, unchanged, against a fresh local chain.
//
// Start anvil, run the local-chain project's start.sh, source its local.env,
// and set LOCAL_CHAIN to that directory. Then: pnpm -C docs/snippets check
//
// A page's js blocks run as one module. A `cast`, `forge create` or
// `./bind.sh` block ends the module, and the next js block starts a new one
// with the page's first js block in front of it, as the guide tells the
// reader to do. Shell blocks run in bash, in order. A plain block after
// "you will see" must appear in the output.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pages = join(here, '..', 'pages');

// Order matters: later pages read what earlier ones wrote.
const PAGES = [
  'get-started/quickstart',
  'guides/lookup-wallet',
  'guides/resolve-handle',
  'guides/gate-contract',
  'guides/pay-a-handle',
  'guides/events',
];

for (const name of ['RPC_URL', 'IDENTITY_REGISTRY', 'HANDLE_ESCROW', 'PRIVATE_KEY', 'CAROL_KEY', 'LOCAL_CHAIN']) {
  if (!process.env[name]) throw new Error(`${name} is not set; source local.env and set LOCAL_CHAIN`);
}

function blocks(markdown) {
  const out = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  for (let m; (m = re.exec(markdown)); ) {
    const before = markdown.slice(Math.max(0, m.index - 200), m.index);
    out.push({ lang: m[1], code: m[2], expected: m[1] === '' && /you will see:?\s*$/i.test(before) });
  }
  return out;
}

const RUN_SH = /^(\.\/bind\.sh|cast |forge create|[A-Z_]+=\$\(forge create)/;

// Modules are written under this directory, so that their imports resolve
// from its node_modules, and removed afterwards.
let modules = 0;
function runModule(code, dir) {
  const file = join(dir, `module-${modules++}.mjs`);
  writeFileSync(file, `${code}\nprocess.exit(0);\n`);
  return execFileSync('node', [file], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

let failed = 0;
for (const page of PAGES) {
  const all = blocks(readFileSync(join(pages, `${page}.md`), 'utf8'));
  const setup = all.find((b) => b.lang === 'js');
  const work = mkdtempSync(join(tmpdir(), 'libid-docs-'));
  const scripts = mkdtempSync(join(here, '.run-'));
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
    if (shell.length) output += execFileSync('bash', ['-euo', 'pipefail', '-c', shell.join('\n')], { cwd: work, encoding: 'utf8' });
    shell = [];
  };
  const sol = all.filter((b) => b.lang === 'solidity').map((b) => b.code);
  if (sol.length) {
    mkdirSync(join(work, 'src'), { recursive: true });
    writeFileSync(join(work, 'foundry.toml'), '[profile.default]\n');
    writeFileSync(join(work, 'src', 'Gate.sol'), `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\n${sol.join('\n')}`);
  }
  try {
    for (const b of all) {
      if (b.lang === 'js') {
        flushShell();
        addJs(b);
      } else if (b.lang === 'sh' && b.code.startsWith('./bind.sh')) {
        flushJs();
        flushShell();
        output += execFileSync('bash', ['-euo', 'pipefail', '-c', b.code], { cwd: process.env.LOCAL_CHAIN, encoding: 'utf8' });
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
    console.log(`ok   ${page}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${page}: ${e.message.split('\n')[0]}`);
  } finally {
    rmSync(scripts, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
