// These are the public storefronts served by the Vercel gateway. Do not trust
// arbitrary forwarded hosts: this allowlist also controls payment return URLs.
const publicStorefrontOrigins = new Set([
  'https://lemrix.vercel.app',
  'https://lemrix-surf.vercel.app',
]);

function requireTrustedOrigin(request, url = new URL(request.url)) {
  const origin = request.headers.get('Origin');
  if (origin !== url.origin && !publicStorefrontOrigins.has(origin)) {
    reject(403, 'Invalid request origin.');
  }
  return origin;
}

function ownerRequestOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || url.origin;
  return origin === url.origin || publicStorefrontOrigins.has(origin) ? origin : null;
}
