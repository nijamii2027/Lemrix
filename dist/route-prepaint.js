'use strict';

/* Lemrix: liquid navy staircase, landing-first browsing, live site. */
(() => {
  const root = document.documentElement;
  const key = 'lemrix.staircase';
  const homeKey = 'lemrix.home-scroll';
  const entryKey = 'lemrix.site.landing-opened.v1';
  const normalize = path => path.replace(/\/$/, '') || '/';
  const onHome = normalize(location.pathname) === '/';

  // Always start new browsing sessions with the One More Pack landing scene.
  // Internal links still work normally after that first landing visit.
  let firstEntry = false;
  try {
    firstEntry = !sessionStorage.getItem(entryKey);
    if (firstEntry && !onHome) {
      location.replace('/');
      return;
    }
    if (firstEntry) sessionStorage.setItem(entryKey, '1');
  } catch {
    // Don't risk redirect loops when session storage is unavailable.
  }
  if (firstEntry && onHome) {
    if (location.hash) {
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch {}
    }
    try { history.scrollRestoration = 'manual'; } catch {}
    window.addEventListener('pageshow', () => window.scrollTo(0, 0), {once:true});
  }

  let arrival = false;
  const address = new URL(location.href);
  if (address.searchParams.get('staircase') === 'reveal') {
    arrival = true;
    address.searchParams.delete('staircase');
    try { history.replaceState(history.state, '', address); } catch {}
  }
  try {
    const pending = JSON.parse(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    if (pending && Date.now() - pending.at < 15000 &&
        normalize(pending.path) === normalize(location.pathname)) arrival = true;
    const section = sessionStorage.getItem(homeKey);
    sessionStorage.removeItem(homeKey);
    if (onHome && !firstEntry && section && section === location.hash) {
      history.replaceState(history.state, '', location.pathname + location.search);
      root.dataset.homeScroll = section;
    }
  } catch {}

  const reduced = () => window.LemrixMotionState?.systemReduced ??
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (arrival) root.dataset.entryStaircase = '';

  window.addEventListener('DOMContentLoaded', () => {
    let curtain;
    let outgoing = false;
    let stopTransition;
    const ns = 'http://www.w3.org/2000/svg';
    const active = () => Boolean(window.LemrixMotionState?.onFrame);
    const clamp = v => Math.max(0, Math.min(1, v));
    const ease = v => v * v * (3 - 2 * v);

    function paint(band, bead, i, count, amount, gentle) {
      const w = 1000 / count;
      const L = i * w - 4;
      const R = (i + 1) * w + 4;
      const M = (L + R) / 2;
      const wave = gentle ? 0 : Math.sin(Math.PI * amount);
      const phase = i * 1.73 + amount * 6.2;
      const sway = wave * (11 * Math.sin(phase) + 5 * Math.cos(phase * 1.33));
      const h = -245 + 1510 * amount;
      const yl = h + wave * (23 * Math.sin(phase + .8) + 11 * Math.cos(phase * 2));
      const ym = h + wave * (31 * Math.sin(phase + 2.5) - 14 * Math.cos(phase * .9));
      const yr = h + wave * (25 * Math.cos(phase + .4) + 10 * Math.sin(phase * 1.6));
      const lx = L + sway * .5, rx = R + sway;
      const curl = 13 * wave;
      // Whole column grows from above the viewport. Its edge is three smooth
      // liquid lobes with sideways sway, not a solid rectangular lower edge.
      band.setAttribute('d',
        'M ' + L + ' -95 L ' + R + ' -95 ' +
        'C ' + (R + sway * .1) + ' ' + (yr - 107) +
        ' ' + (rx + 8) + ' ' + (yr - 49) +
        ' ' + (rx - 2) + ' ' + (yr - 10) + ' ' +
        'C ' + (rx + 2) + ' ' + (yr + curl) +
        ' ' + (M + w * .3) + ' ' + (ym - curl * 1.3) +
        ' ' + M + ' ' + ym + ' ' +
        'C ' + (M - w * .25) + ' ' + (ym + curl * 1.4) +
        ' ' + (lx - 7) + ' ' + (yl + curl * .4) +
        ' ' + lx + ' ' + (yl - 6) + ' ' +
        'C ' + (lx + 4) + ' ' + (yl - 43) +
        ' ' + (L + sway * .12) + ' ' + (yl - 104) +
        ' ' + L + ' -95 Z');

      // Small asymmetric trailing droplets reinforce the liquid impression.
      if (!gentle && amount > .06 && amount < .93) {
        const strength = Math.sin(Math.PI * clamp((amount - .06) / .87));
        const r = (4.5 + 2.2 * Math.sin(i * 2.7)) * strength;
        const x = M + sway * .75 + w * .12 * Math.sin(phase * 1.27);
        const y = Math.max(yl, ym, yr) + 30 + 18 * strength;
        bead.setAttribute('d',
          'M ' + x + ' ' + (y - r * 1.6) +
          ' C ' + (x + r * 1.1) + ' ' + (y - r * .5) +
          ' ' + (x + r) + ' ' + (y + r * .7) +
          ' ' + x + ' ' + (y + r) +
          ' C ' + (x - r) + ' ' + (y + r * .7) +
          ' ' + (x - r * 1.1) + ' ' + (y - r * .5) +
          ' ' + x + ' ' + (y - r * 1.6) + ' Z');
      } else bead.setAttribute('d', '');
    }

    function makeCurtain(covering) {
      const count = matchMedia('(max-width: 640px)').matches ? 7 : 11;
      const overlay = document.createElement('div');
      overlay.className = 'route-curtain route-curtain--fluid';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.display = 'block';
      overlay.style.background = 'transparent';
      if (!covering) overlay.style.pointerEvents = 'none';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 1000 1000');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      Object.assign(svg.style, {
        position:'absolute', inset:'0', width:'100%', height:'100%',
        overflow:'hidden', display:'block'
      });
      const ribbons = [];
      for (let i = 0; i < count; i++) {
        const band = document.createElementNS(ns, 'path');
        const bead = document.createElementNS(ns, 'path');
        // Exact original transition colour.
        band.setAttribute('fill', '#182359');
        bead.setAttribute('fill', '#182359');
        svg.append(band, bead);
        ribbons.push({band, bead, i});
      }
      overlay.append(svg);
      document.body.append(overlay);
      curtain = overlay;
      for (const ribbon of ribbons)
        paint(ribbon.band, ribbon.bead, ribbon.i, count, covering ? 0 : 1, reduced());
      return ribbons;
    }

    function run(ribbons, covering, done) {
      const gentle = reduced();
      const duration = gentle ? 200 : covering ? 425 : 465;
      const stagger = gentle ? 22 : ribbons.length > 8 ? 34 : 43;
      const last = ribbons.length - 1;
      const delays = ribbons.map(({i}) =>
        (covering ? i : last - i) * stagger + (gentle ? 0 : 8 * Math.sin(i * 2.77)));
      const finishAt = duration + Math.max(...delays);
      let started;
      stopTransition = window.LemrixMotionState.onFrame(time => {
        started ??= time;
        const elapsed = time - started;
        for (let k = 0; k < ribbons.length; k++) {
          const {band, bead, i} = ribbons[k];
          const progress = ease(clamp((elapsed - delays[k]) / duration));
          paint(band, bead, i, ribbons.length, covering ? progress : 1 - progress, gentle);
        }
        if (elapsed >= finishAt) {
          stopTransition?.();
          stopTransition = undefined;
          done();
        }
      });
    }

    function clear() {
      stopTransition?.();
      stopTransition = undefined;
      curtain?.remove();
      curtain = undefined;
      delete root.dataset.entryStaircase;
      outgoing = false;
    }

    if (root.hasAttribute('data-entry-staircase')) {
      if (active()) {
        const ribbons = makeCurtain(false);
        delete root.dataset.entryStaircase;
        run(ribbons, false, clear);
      } else clear();
    }
    window.addEventListener('pageshow', event => {
      if (event.persisted) clear();
    });

    window.LemrixRoute = {
      depart(link) {
        if (outgoing) return true;
        if (!active()) return false;
        const target = new URL(link.href);
        if (target.origin !== location.origin) return false;
        if (normalize(target.pathname) === normalize(location.pathname) &&
            target.search === location.search) return false;
        if (curtain) clear();
        outgoing = true;
        run(makeCurtain(true), true, () => {
          try { sessionStorage.setItem(key, JSON.stringify({path:target.pathname, at:Date.now()})); }
          catch { target.searchParams.set('staircase', 'reveal'); }
          location.assign(target.href);
        });
        return true;
      }
    };

    // Make logo and footer page links participate, not only Shop/Menu tabs.
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href]');
      if (!link || link.hasAttribute('data-staircase') ||
          link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const target = new URL(link.href);
      if (target.origin !== location.origin ||
          !['/', '/shop/', '/menu/'].includes(target.pathname) ||
          normalize(target.pathname) === normalize(location.pathname)) return;
      if (link.hasAttribute('data-home-scroll')) {
        try { sessionStorage.setItem(homeKey, target.hash); } catch {}
      }
      if (window.LemrixRoute.depart(link)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, {capture:true});
  }, {once:true});
})();
