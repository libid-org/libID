import { handleAgentLink } from './agent-link.mjs';

export { AgentLinkHandoff } from './agent-link.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/agent-link/')) return handleAgentLink(request, env);
    if (url.pathname === '/p/client.js') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      try {
        const response = await fetch('https://static.cloudflareinsights.com/beacon.min.js', {
          redirect: 'manual',
          cf: { cacheEverything: true, cacheTtl: 3600 },
        });
        if (!response.ok) return new Response(null, { status: 502 });
        return new Response(request.method === 'HEAD' ? null : response.body, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch {
        return new Response(null, { status: 502 });
      }
    }
    const cloudflare = url.pathname === '/p/measure';
    if (url.pathname !== '/p/event' && !cloudflare) {
      return env.ASSETS.fetch(request);
    }
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    }

    // Forward only analytics headers, never site cookies or credentials.
    const headers = new Headers({
      'Content-Type': request.headers.get('Content-Type') || 'text/plain',
      'User-Agent': request.headers.get('User-Agent') || '',
    });
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) headers.set('X-Forwarded-For', ip);
    if (cloudflare) {
      if (ip) headers.set('X-Real-IP', ip);
      // Cloudflare validates the site origin; page URLs stay in the beacon payload.
      headers.set('Origin', url.origin);
      headers.set('Referer', `${url.origin}/`);
    }

    try {
      return await fetch(cloudflare
        ? new URL('/cdn-cgi/rum', url).href
        : 'https://plausible.io/api/event', {
        method: 'POST',
        headers,
        body: request.body,
        redirect: 'manual',
      });
    } catch {
      return new Response(null, { status: 502 });
    }
  },
};
