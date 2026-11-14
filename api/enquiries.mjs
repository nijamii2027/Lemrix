const upstream = new URL('https://lemrix-collector-club.beefybag2.chatgpt.site/api/enquiries');
const maxBytes = 12288;

function error(message, status) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    }
    if (request.headers.get('Origin') !== new URL(request.url).origin) {
      return error('Please send your message from the Lemrix website.', 403);
    }
    const contentType = request.headers.get('Content-Type') || '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return error('Please use the Lemrix enquiry form.', 415);
    }

    try {
      const body = await request.arrayBuffer();
      if (body.byteLength > maxBytes) return error('Please shorten your message.', 413);

      // Both deployments use the same inbox. Forward only the form data and
      // the headers required by the existing endpoint.
      const response = await fetch(upstream, {
        method: 'POST',
        headers: { 'Content-Type': contentType, Origin: upstream.origin },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(8000)
      });
      if (!response.headers.get('Content-Type')?.startsWith('application/json')) {
        throw new Error('Unexpected enquiry response');
      }
      return new Response(response.body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    } catch {
      return error('Couldn’t confirm delivery. Please try again.', 503);
    }
  }
};
