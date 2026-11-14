const fields = new Set(['sell', 'trade', 'unsure']);
const insert = `INSERT INTO enquiries (id, intent, email, details)
  VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`;

function reply(payload, status) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function receive(request, env, url) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }
  if (request.headers.get('Origin') !== url.origin) {
    return reply({ error: 'Please send your message from the Lemrix website.' }, 403);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    return reply({ error: 'Please use the Lemrix enquiry form.' }, 415);
  }

  const reader = request.body?.getReader();
  if (!reader) return reply({ error: 'Enter your email and card details.' }, 400);
  const decoder = new TextDecoder();
  let body = '';
  let size = 0;
  let data;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12288) {
        await reader.cancel();
        return reply({ error: 'Please shorten your message.' }, 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    data = JSON.parse(body + decoder.decode());
  } catch {
    return reply({ error: 'Enter your email and card details.' }, 400);
  }

  const { id, intent, email: rawEmail, details: rawDetails, website } = data || {};
  const email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
  const details = typeof rawDetails === 'string' ? rawDetails.trim() : '';
  if (typeof id !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id) ||
      !fields.has(intent) || website || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      details.length < 10 || details.length > 2000) {
    return reply({ error: 'Enter a valid reply email and at least 10 characters of card details.' }, 422);
  }

  try {
    const result = await env.DB.prepare(insert).bind(id, intent, email, details).run();
    if (result.success !== true) throw new Error('Insert failed');
    return reply({ received: true }, 201);
  } catch {
    return reply({ error: 'Couldn’t confirm delivery. Please try again.' }, 503);
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/enquiries') return receive(request, env, url);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Page unavailable', { status: 404 });
  }
};
