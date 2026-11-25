(() => {
  const base = new URL('./', document.currentScript.src);
  const cleanPath = path => path.replace(/\/index\.html$/, '').replace(/\/$/, '');
  const homePath = cleanPath(base.pathname);
  const shopPath = homePath + '/shop';
  const root = document.documentElement;
  const reduced = window.LemrixMotion || matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'lemrix-last-document';

  function kind(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return null;
      const path = cleanPath(url.pathname);
      if (path === homePath) return 'home';
      return path === shopPath ? 'shop' : null;
    } catch { return null; }
  }
  const here = kind(location.href);
  if (!here) return;
  const direction = (from, to) => from && to && from !== to ? (to === 'home' ? 'return' : 'enter') : '';
  function reset() {
    delete root.dataset.storeVisit;
    delete root.dataset.storeFallback;
  }

  function remember() {
    try { sessionStorage.setItem(key, JSON.stringify({ from: here, at: Date.now() })); } catch {}
  }
  function previousPage() {
    try {
      const previous = JSON.parse(sessionStorage.getItem(key));
      if (previous && Date.now() - previous.at < 30000) return previous.from;
    } catch {}
    return kind(document.referrer);
  }
  addEventListener('pagehide', remember);
  const hasMPA = 'onpageswap' in window && 'onpagereveal' in window && CSS.supports('view-transition-name: brand');
  if (hasMPA) {
    let active;
    function setTransition(event, from, to) {
      const transition = event.viewTransition;
      active = transition;
      reset();
      const flow = direction(from, to);
      if (!transition) return;
      // A skipped snapshot rejects ready even when the underlying navigation succeeds.
      transition.ready?.catch(() => {});
      if (!flow || reduced.matches) { transition.skipTransition(); return; }
      root.dataset.storeVisit = flow;
      // view-transition-name is enabled only while changing documents. The item
      // zoom and the on-page showroom history remain independent.
      const finish = () => { if (active === transition) reset(); };
      transition.finished.then(finish, finish);
    }
    addEventListener('pageswap', event => setTransition(event, here, kind(event.activation?.entry?.url)));
    addEventListener('pagereveal', event => {
      const previous = kind(window.navigation?.activation?.from?.url) || previousPage();
      setTransition(event, previous, here);
    });
    return;
  }

  // Other engines keep ordinary navigation and history. A short, interruptible
  // entrance runs on the new document, including a restored page from the bfcache.
  let arrivalTimer = 0;
  function arrive() {
    reset();
    const nav = performance.getEntriesByType('navigation')[0];
    if (reduced.matches || nav?.type === 'reload') return;
    const flow = direction(previousPage(), here);
    if (!flow) return;
    root.dataset.storeVisit = flow;
    root.dataset.storeFallback = 'arriving';
    clearTimeout(arrivalTimer);
    arrivalTimer = setTimeout(reset, 540);
  }
  addEventListener('pageshow', event => { if (event.persisted) arrive(); });
  arrive();
})();
