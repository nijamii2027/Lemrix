// The server adapter validates the public host before constructing Request.
// Unsafe browser requests must come from that exact origin.
function requireTrustedOrigin(request, url = new URL(request.url)) {
  const origin = request.headers.get('Origin');
  if (origin !== url.origin) {
    reject(403, 'Invalid request origin.');
  }
  return origin;
}
