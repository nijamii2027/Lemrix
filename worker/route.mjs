const pageTypes = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', txt: 'text/plain', svg: 'image/svg+xml',
};
export default {
  async fetch(request, env) {
    const routed = await handleInventory(request, env, initialProducts);
    if (routed) return routed;
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405});
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (['/admin','/admin/','/admin/index.html'].includes(pathname)) return Response.redirect(new URL('/shop/#account',url).href,302);
    if (pathname === '/shop' || pathname === '/after-hours') {
      url.pathname += '/';
      return Response.redirect(url.toString(), 308);
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    if (Object.hasOwn(fallback, pathname)) {
      const type = pageTypes[pathname.split('.').pop()] || 'text/plain';
      return new Response(request.method === 'HEAD' ? null : fallback[pathname], {
        headers: {'Content-Type':type, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff'}
      });
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', {status:404});
  }
};
