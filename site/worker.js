export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/p/event') {
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

    try {
      return await fetch('https://plausible.io/api/event', {
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
