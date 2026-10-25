import assert from 'node:assert/strict';
import worker, { AgentLinkHandoff } from './worker.js';

const session = 'a'.repeat(32);
const tx = {
  chainId: 3735928814,
  to: '0x58ac0cd5ec19c850a75d6183b3c3b2de692fb20d',
  data: '0x1bb7eddb',
  value: '0',
  platform: 'x',
  handle: 'alice',
  expiresAt: 1_800_000_000,
};

// Durable Objects keyed by name, each over an in-memory storage with its one alarm.
function env(overrides = {}) {
  const objects = new Map();
  return {
    ASSETS: { fetch: async () => new Response('asset') },
    AGENT_LINK_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AGENT_LINKS: {
      idFromName: (name) => name,
      get(name) {
        if (!objects.has(name)) {
          const values = new Map();
          const storage = {
            alarm: null,
            get: async (key) => values.get(key),
            put: async (key, value) => void values.set(key, value),
            setAlarm: async (time) => { storage.alarm = time; },
            deleteAll: async () => values.clear(),
          };
          objects.set(name, new AgentLinkHandoff({ storage }));
        }
        return objects.get(name);
      },
    },
    ...overrides,
  };
}
function call(bindings, { method = 'GET', body, origin = 'https://lib.id', id = session, sized = true } = {}) {
  const json = body && JSON.stringify(body);
  return worker.fetch(new Request(`https://lib.id/api/agent-link/${id}`, {
    method,
    headers: { Origin: origin, ...(json && sized ? { 'Content-Length': String(json.length) } : {}) },
    ...(json ? { body: json } : {}),
  }), bindings);
}

// The page hands one transaction to the polling agent; the first write stays until the alarm.
const bindings = env();
assert.equal((await call(bindings)).status, 404);
assert.equal((await call(bindings, { method: 'PUT', body: tx })).status, 200);
const response = await call(bindings);
assert.equal(response.headers.get('Cache-Control'), 'no-store');
assert.deepEqual(await response.json(), tx);
assert.equal((await call(bindings, { method: 'PUT', body: tx })).status, 200, 'a retry succeeds');
assert.equal((await call(bindings, { method: 'PUT', body: { ...tx, handle: 'mallory' } })).status, 409);
assert.deepEqual(await (await call(bindings)).json(), tx);
const handoff = bindings.AGENT_LINKS.get(session);
assert.ok(handoff.storage.alarm > Date.now());
await handoff.alarm();
assert.equal((await call(bindings)).status, 404);

// Foreign origins, malformed sessions and transactions, other methods and missing bindings.
const fresh = env();
const put = (options) => call(fresh, { method: 'PUT', body: tx, ...options });
assert.equal((await put({ origin: 'https://evil.example' })).status, 403);
assert.equal((await put({ id: 'A'.repeat(32) })).status, 404);
assert.equal((await put({ id: `${session}/x` })).status, 404);
for (const body of [
  { ...tx, to: '0x12' },
  { ...tx, to: [tx.to] },
  { ...tx, data: '0x123' },
  { ...tx, value: '-1' },
  { ...tx, value: [1000] },
  { ...tx, platform: 'facebook' },
  { ...tx, handle: '' },
  { ...tx, chainId: 0 },
  { ...tx, expiresAt: -1 },
  { ...tx, data: `0x${'00'.repeat(40000)}` },
]) {
  assert.equal((await put({ body })).status, 400, JSON.stringify(body).slice(0, 80));
}
assert.equal((await put({ sized: false })).status, 400, 'a body without Content-Length');
assert.equal((await call(fresh, { method: 'POST', body: tx })).status, 405);
assert.equal((await call(env({ AGENT_LINK_RATE_LIMITER: { limit: async () => ({ success: false }) } }), {
  method: 'PUT',
  body: tx,
})).status, 429);
assert.equal((await call(env({ AGENT_LINKS: undefined }))).status, 503);
assert.equal((await call(fresh)).status, 404, 'nothing was stored');
console.log('Agent link checks passed.');
