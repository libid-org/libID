// /link/agent/ hands the bind call its visitor proved to the agent that sends it.
// The agent picks the session and polls for it; the first write wins and lasts an hour.
const RETENTION = 60 * 60 * 1000;
const LIMIT = 64000; // A bind call is about 12 kB of calldata, 24 kB as hex.

const reply = (status, body = { ok: status === 200 }) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) },
  });
const failed = (status, error) => reply(status, { ok: false, error });
const text = (value, pattern) => typeof value === 'string' && pattern.test(value);

function transaction(body) {
  const { chainId, to, data, value, platform, handle, expiresAt } = body ?? {};
  return Number.isSafeInteger(chainId) && chainId > 0
    && text(to, /^0x[0-9a-fA-F]{40}$/)
    && text(data, /^0x(?:[0-9a-fA-F]{2})+$/)
    && text(value, /^\d{1,78}$/)
    && ['github', 'x', 'google'].includes(platform)
    && text(handle, /^.{1,320}$/s)
    && Number.isSafeInteger(expiresAt) && expiresAt > 0
    ? { chainId, to, data, value, platform, handle, expiresAt }
    : null;
}

// Browsers and curl send Content-Length for these bodies, so a missing one is refused unread.
async function readJson(request) {
  const length = request.headers.get('Content-Length');
  return length !== null && Number(length) <= LIMIT ? JSON.parse(await request.text()) : null;
}

export async function handleAgentLink(request, env) {
  const url = new URL(request.url);
  const session = url.pathname.slice('/api/agent-link/'.length);
  if (!/^[0-9a-f]{32}$/.test(session)) return failed(404, 'unknown_session');
  // Worker Previews bind no Durable Objects.
  if (!env.AGENT_LINKS) return failed(503, 'service_unavailable');
  const handoff = env.AGENT_LINKS.get(env.AGENT_LINKS.idFromName(session));
  if (request.method === 'GET') return handoff.fetch(new Request('https://handoff/'));
  if (request.method !== 'PUT') return failed(405, 'request_failed');
  if (request.headers.get('Origin') !== url.origin) return failed(403, 'request_failed');
  const limit = await env.AGENT_LINK_RATE_LIMITER.limit({
    key: `agent-link:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`,
  });
  if (!limit.success) return failed(429, 'rate_limited');
  const body = await readJson(request).then(transaction, () => null);
  if (!body) return failed(400, 'invalid_transaction');
  return handoff.fetch(new Request('https://handoff/', { method: 'PUT', body: JSON.stringify(body) }));
}

export class AgentLinkHandoff {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    // Read the body first: awaiting it between the read and the write of storage would let
    // a concurrent write in.
    const body = await request.text();
    const saved = await this.storage.get('transaction');
    if (request.method === 'GET') return saved ? reply(200, saved) : failed(404, 'pending');
    // A retried write of the same transaction succeeds; another one never replaces it.
    if (saved) return JSON.stringify(saved) === body ? reply(200) : failed(409, 'session_used');
    await this.storage.put('transaction', JSON.parse(body));
    await this.storage.setAlarm(Date.now() + RETENTION);
    return reply(200);
  }

  alarm() {
    return this.storage.deleteAll();
  }
}
