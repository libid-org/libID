import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./src/analytics.js', import.meta.url), 'utf8');

for (const hostname of [
  'lib.id',
  'www.lib.id',
  'localhost',
  '127.0.0.1',
  'previews.lib.id',
  'feature.previews.lib.id',
  'libid.workers.dev',
  'lib.id.example.com',
]) {
  const scripts = [];
  runInNewContext(source, {
    location: { hostname },
    document: {
      createElement(tag) {
        assert.equal(tag, 'script');
        return { dataset: {} };
      },
      head: { appendChild: (script) => scripts.push(script) },
    },
  });
  if (hostname === 'lib.id' || hostname === 'www.lib.id') {
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'https://plausible.io/js/script.js');
    assert.equal(scripts[0].dataset.domain, 'lib.id');
    assert.equal(scripts[0].async, true);
  } else {
    assert.equal(scripts.length, 0, `${hostname} must not load analytics`);
  }
}

console.log('Analytics checks passed.');
