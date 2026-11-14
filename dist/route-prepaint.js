'use strict';

(() => {
  const root = document.documentElement;
  const key = 'lemrix.staircase';
  const homeKey = 'lemrix.home-scroll';
  let arrival;
  const address = new URL(location.href);
  if (address.searchParams.get('staircase') === 'reveal') {
    arrival = true;
    address.searchParams.delete('staircase');
    try { history.replaceState(history.state, '', address); } catch {}
  }
  try {
    const pending = JSON.parse(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    const normalize = path => path.replace(/\/$/, '');
    if (pending && Date.now() - pending.at < 15000 &&
        normalize(pending.path) === normalize(location.pathname)) arrival = pending;
    const section = sessionStorage.getItem(homeKey);
    sessionStorage.removeItem(homeKey);
    if (location.pathname === '/' && section && section === location.hash) {
      history.replaceState(history.state, '', location.pathname + location.search);
      root.dataset.homeScroll = section;
    }
  } catch {}

  const reduced = () => window.LemrixMotionState?.systemReduced ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (arrival) root.dataset.entryStaircase = '';
  window.addEventListener('DOMContentLoaded', () => {
    let curtain;
    let outgoing = false;
    let stopTransition;
    const active = () => Boolean(window.LemrixMotionState?.onFrame);

    function showCurtain(covering) {
      const count = matchMedia('(max-width: 640px)').matches ? 6 : 10;
      const overlay = document.createElement('div');
      overlay.className = 'route-curtain';
      overlay.setAttribute('aria-hidden', 'true');
      if (!covering) overlay.style.pointerEvents = 'none';
      overlay.style.setProperty('--columns', count);
      for (let i = 0; i < count; i++) {
        const bar = document.createElement('i');
        paintBar(bar, covering ? 0 : 1, reduced());
        overlay.append(bar);
      }
      document.body.append(overlay);
      curtain = overlay;
      return Array.from(overlay.children);
    }

    function paintBar(bar, coverage, gentle) {
      const distance = 1 - coverage;
      bar.style.transform = gentle
        ? `translateY(${-18 * distance}px)`
        : `translateY(${-100 * distance}%)`;
      bar.style.opacity = gentle ? coverage : 1;
    }

    function run(bars, covering, complete) {
      const gentle = reduced();
      const duration = gentle ? 190 : covering ? 370 : 435;
      const stagger = gentle ? 24 : bars.length > 6 ? 31 : 43;
      let began;
      stopTransition = window.LemrixMotionState.onFrame(time => {
        began ??= time;
        const elapsed = time - began;
        bars.forEach((bar, index) => {
          const step = covering ? index : bars.length - 1 - index;
          const progress = Math.min(1, Math.max(0, (elapsed - step * stagger) / duration));
          const eased = progress * progress * (3 - 2 * progress);
          paintBar(bar, covering ? eased : 1 - eased, gentle);
        });
        if (elapsed >= duration + (bars.length - 1) * stagger) {
          stopTransition?.();
          stopTransition = undefined;
          complete();
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
        const bars = showCurtain(false);
        delete root.dataset.entryStaircase;
        run(bars, false, clear);
      } else clear();
    }
    window.addEventListener('pageshow', event => {
      if (event.persisted) clear();
    });

    window.LemrixRoute = {
      depart(link) {
        if (outgoing) return true;
        if (!active()) return false;
        outgoing = true;
        const target = new URL(link.href);
        if (curtain) clear();
        outgoing = true;
        const bars = showCurtain(true);
        run(bars, true, () => {
          try { sessionStorage.setItem(key, JSON.stringify({ path: target.pathname, at: Date.now() })); }
          catch { target.searchParams.set('staircase', 'reveal'); }
          location.assign(target.href);
        });
        return true;
      }
    };
  }, { once: true });
})();
