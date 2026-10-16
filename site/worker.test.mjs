import assert from 'node:assert/strict';
import worker from './worker.js';

const originalFetch = globalThis.fetch;
let upstreamCalls = 0;
let lastRequest;
const upstreamResponse = new Response('{}', {
  status: 202,
  headers: { 'x-plausible-dropped': '1' },
});
globalThis.fetch = async (url, options) => {
  upstreamCalls++;
  lastRequest = { url, ...options };
  return upstreamResponse;
};

try {
  const body = JSON.stringify({ n: 'pageview', d: 'lib.id', u: 'https://lib.id/docs/' });
  for (const ip of ['198.51.100.42', '2001:db8::42']) {
    const response = await worker.fetch(new Request('https://lib.id/p/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': 'Browser test agent',
        'CF-Connecting-IP': ip,
        'X-Forwarded-For': 'spoofed',
        Cookie: 'session=private',
        Authorization: 'Bearer private',
      },
      body,
    }));
    assert.equal(response, upstreamResponse);
    assert.equal(lastRequest.url, 'https://plausible.io/api/event');
    assert.equal(lastRequest.method, 'POST');
    assert.equal(lastRequest.redirect, 'manual');
    assert.deepEqual(Object.fromEntries(lastRequest.headers), {
      'content-type': 'text/plain',
      'user-agent': 'Browser test agent',
      'x-forwarded-for': ip,
    });
    assert.equal(await new Response(lastRequest.body).text(), body);
  }

  await worker.fetch(new Request('https://lib.id/p/event', {
    method: 'POST',
    headers: { 'X-Forwarded-For': 'spoofed' },
  }));
  assert.equal(lastRequest.headers.has('X-Forwarded-For'), false);

  const rumBody = JSON.stringify({ siteToken: 'public-token', location: 'https://lib.id/docs/' });
  const rumResponse = await worker.fetch(new Request('https://lib.id/p/measure', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Browser test agent',
      'CF-Connecting-IP': '2001:db8::42',
      'X-Forwarded-For': 'spoofed',
      Origin: 'https://untrusted.example',
      Referer: 'https://lib.id/docs/?private=value',
      Cookie: 'session=private',
      Authorization: 'Bearer private',
    },
    body: rumBody,
  }));
  assert.equal(rumResponse, upstreamResponse);
  assert.equal(lastRequest.url, 'https://cloudflareinsights.com/cdn-cgi/rum');
  assert.equal(lastRequest.redirect, 'manual');
  assert.deepEqual(Object.fromEntries(lastRequest.headers), {
    'content-type': 'application/json',
    origin: 'https://lib.id',
    referer: 'https://lib.id/',
    'user-agent': 'Browser test agent',
    'x-forwarded-for': '2001:db8::42',
  });
  assert.equal(await new Response(lastRequest.body).text(), rumBody);

  const callsBeforeRoutingChecks = upstreamCalls;
  for (const path of ['/p/event', '/p/measure']) {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']) {
      const response = await worker.fetch(new Request(`https://lib.id${path}`, { method }));
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('Allow'), 'POST');
    }
  }
  for (const method of ['POST', 'OPTIONS', 'PUT', 'DELETE']) {
    const response = await worker.fetch(new Request('https://lib.id/p/client.js', { method }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  }
  for (const path of ['/', '/docs/', '/specs/', '/missing/', '/p/event/other']) {
    const request = new Request(`https://lib.id${path}`);
    const assetResponse = new Response('asset', { status: path === '/missing/' ? 404 : 200 });
    assert.equal(await worker.fetch(request, {
      ASSETS: { fetch: async (received) => {
        assert.equal(received, request);
        return assetResponse;
      } },
    }), assetResponse);
  }
  assert.equal(upstreamCalls, callsBeforeRoutingChecks);

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://static.cloudflareinsights.com/beacon.min.js');
    assert.deepEqual(options, {
      redirect: 'manual',
      cf: { cacheEverything: true, cacheTtl: 3600 },
    });
    return new Response('/* official beacon */', {
      headers: { 'Set-Cookie': 'unexpected=private' },
    });
  };
  for (const method of ['GET', 'HEAD']) {
    const response = await worker.fetch(new Request('https://lib.id/p/client.js?url=https://untrusted.example', {
      method,
      headers: { Cookie: 'session=private', Authorization: 'Bearer private' },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/javascript; charset=utf-8');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600');
    assert.equal(response.headers.has('Set-Cookie'), false);
    assert.equal(await response.text(), method === 'HEAD' ? '' : '/* official beacon */');
  }
  globalThis.fetch = async () => new Response('upstream error', { status: 503 });
  assert.equal((await worker.fetch(new Request('https://lib.id/p/client.js'))).status, 502);

  globalThis.fetch = async () => { throw new Error('Upstream unavailable'); };
  for (const path of ['/p/event', '/p/measure', '/p/client.js']) {
    const failure = await worker.fetch(new Request(`https://lib.id${path}`, {
      method: path.endsWith('.js') ? 'GET' : 'POST',
    }));
    assert.equal(failure.status, 502);
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log('Worker proxy checks passed.');
