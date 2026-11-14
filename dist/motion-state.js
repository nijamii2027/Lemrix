'use strict';
// Page startup and real interactions share this state; playback never needs a
// synthetic click, and an old saved pause cannot freeze the site.
(() => {
  const root = document.documentElement;
  const system = matchMedia('(prefers-reduced-motion: reduce)');
  const preferenceKey = 'lemrix.motion-preference';
  let motionPreference = 'full';
  try { if (localStorage.getItem(preferenceKey) === 'system') motionPreference = 'system'; } catch {}

  // Full motion starts by default. The system link restores the device preference for this site.
  if (typeof location !== 'undefined') {
    const requested = new URLSearchParams(location.search).get('motion');
    if (requested === 'full' || requested === 'system') {
      motionPreference = requested;
      try {
        localStorage.setItem(preferenceKey, requested);
      } catch {}
    }
  }
  const prefersLessMotion = () => motionPreference !== 'full' && system.matches;
  const touch = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const frames = new Set();
  let watchdog = 0;
  let frameId = 0;
  let elapsed = 0;
  let lastTick = 0;
  let pageActive = true;

  function watchMedia(query, callback) {
    if (query.addEventListener) query.addEventListener('change', callback);
    else query.addListener?.(callback);
  }

  function isOnScreen(element) {
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const bottom = top + (viewport?.height || window.innerHeight);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > top && rect.top < bottom;
  }

  function tick() {
    const now = performance.now();
    elapsed += Math.min(250, now - lastTick);
    lastTick = now;
    for (const paint of frames) {
      try { paint(elapsed); }
      catch (error) {
        frames.delete(paint);
        console.error('A Lemrix animation could not draw a frame.', error);
      }
    }
    if (!frames.size) syncClock();
  }

  function frame() {
    frameId = 0;
    if (!watchdog) return;
    tick();
    if (watchdog) frameId = window.requestAnimationFrame(frame);
  }

  function syncClock() {
    const running = frames.size && pageActive && !document.hidden;
    if (running && !watchdog) {
      lastTick = performance.now();
      frameId = window.requestAnimationFrame?.(frame) || 0;
      watchdog = setInterval(() => {
        if (performance.now() - lastTick >= 32) tick();
      }, 1000 / 30);
    } else if (!running && watchdog) {
      clearInterval(watchdog);
      watchdog = 0;
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
    }
  }

  function sync(reason) {
    root.dataset.motion = 'running';
    root.dataset.systemMotion = prefersLessMotion() ? 'reduced' : 'full';
    root.classList.toggle('page-hidden', document.hidden);
    syncClock();
    window.dispatchEvent(new CustomEvent('lemrix:motion-change', {
      detail: { enabled: true, reason }
    }));
  }

  window.LemrixMotionState = {
    touch,
    isOnScreen,
    watchMedia,
    onFrame(paint) {
      frames.add(paint);
      syncClock();
      return () => { frames.delete(paint); syncClock(); };
    },
    onTouchFrame(paint) {
      if (!touch) return;
      return this.onFrame(paint);
    },
    enabled: true,
    get systemReduced() { return prefersLessMotion(); }
  };

  // Load, tab restore and the first real interaction share the same start path.
  // Starting never restarts an animation that is already playing.
  function start(reason) {
    pageActive = true;
    sync(reason);
    if (watchdog && !document.hidden) tick();
  }

  root.dataset.motionDriver = touch ? 'touch' : 'desktop';
  start('startup');
  document.addEventListener('DOMContentLoaded', () => start('ready'), { once: true });
  window.addEventListener('load', () => start('load'), { once: true });
  window.addEventListener('pageshow', () => start('pageshow'));
  window.addEventListener('pagehide', () => {
    pageActive = false;
    syncClock();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sync('visibility');
    else start('visibility');
  });
  watchMedia(system, () => sync('system'));
  window.addEventListener('storage', event => {
    if (event.key !== preferenceKey && event.key !== null) return;
    motionPreference = event.newValue === 'system' ? 'system' : 'full';
    sync('site-preference');
  });
  function startFromInteraction(event) {
    if (!event.isTrusted) return;
    for (const name of ['pointerdown', 'touchstart', 'keydown']) {
      document.removeEventListener(name, startFromInteraction, true);
    }
    start('interaction');
  }
  for (const name of ['pointerdown', 'touchstart', 'keydown']) {
    document.addEventListener(name, startFromInteraction, { passive: true, capture: true });
  }
})();
