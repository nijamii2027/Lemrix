
'use strict';
/* Experimental progressive enhancement only. Original website motion is unchanged. */
(() => {
  const root = document.documentElement;
  root.dataset.lemrixLab = '01';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const leanDevice = matchMedia('(max-width: 760px)').matches ||
    navigator.connection?.saveData || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  if (leanDevice) root.dataset.labQuality = 'lean';
  const ready = () => {
    const nav = document.querySelector('.nav-world');
    const isVisible = () => !document.hidden && !reduced.matches;
    if (nav) {
      const progress = document.createElement('span');
      progress.className = 'lab-scroll-progress';
      progress.setAttribute('aria-hidden', 'true');
      nav.append(progress);
      let queued = false;
      const paint = () => {
        queued = false;
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const fraction = Math.max(0, Math.min(1, window.scrollY / max));
        progress.style.transform = 'scaleX(' + fraction.toFixed(4) + ')';
        nav.classList.toggle('lab-scrolled', window.scrollY > 30);
      };
      window.addEventListener('scroll', () => {
        if (!queued) { queued = true; requestAnimationFrame(paint); }
      }, { passive: true });
      window.addEventListener('resize', paint, { passive: true });
      paint();
    }
    const chapters = [
      ['#the-club .collab-heading', '01 / THE COLLAB'],
      ['#live-breaks .breaks-copy', '02 / THE COMMUNITY'],
      ['#lucky-find .lucky-copy', '03 / ONE FREE SPIN'],
      ['#sell-trade .trade-copy', '04 / THE COLLECTION'],
      ['#faq > div:first-child', '05 / GOOD TO KNOW']
    ];
    for (const [selector, title] of chapters) {
      const parent = document.querySelector(selector);
      if (!parent) continue;
      const label = document.createElement('span');
      label.className = 'lab-chapter-label';
      label.setAttribute('aria-hidden', 'true');
      label.textContent = title;
      parent.prepend(label);
    }
    if (fine.matches && !leanDevice) {
      for (const node of document.querySelectorAll('.button.collector-primary')) {
        let frame = 0;
        let dx = 0, dy = 0;
        node.dataset.labMagnet = '';
        const apply = () => {
          frame = 0;
          if (!isVisible()) return;
          node.style.setProperty('--lab-x', dx.toFixed(2) + 'px');
          node.style.setProperty('--lab-y', dy.toFixed(2) + 'px');
        };
        node.addEventListener('pointermove', event => {
          if (!isVisible()) return;
          const rect = node.getBoundingClientRect();
          dx = Math.max(-4, Math.min(4, (event.clientX - rect.left - rect.width / 2) * .055));
          dy = Math.max(-3, Math.min(3, (event.clientY - rect.top - rect.height / 2) * .07));
          if (!frame) frame = requestAnimationFrame(apply);
        }, { passive: true });
        const reset = () => {
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          node.style.removeProperty('--lab-x');
          node.style.removeProperty('--lab-y');
        };
        node.addEventListener('pointerleave', reset, { passive: true });
        node.addEventListener('blur', reset);
      }
      const showcase = document.querySelector('.shop-showcase');
      if (showcase) {
        const back = showcase.querySelector('.showcase-card-back');
        const front = showcase.querySelector('.showcase-card-front');
        const mascot = showcase.querySelector('.showcase-lemrix');
        let frame = 0;
        let pos = [0,0];
        const paint = () => {
          frame = 0;
          if (!isVisible()) return;
          const [x,y] = pos;
          const layer = (element, cssX, cssY, amount) => {
            element?.style.setProperty(cssX, (x * amount).toFixed(2) + 'px');
            element?.style.setProperty(cssY, (y * amount).toFixed(2) + 'px');
          };
          layer(back, '--lab-card-x', '--lab-card-y', 7);
          layer(front, '--lab-card-x', '--lab-card-y', -9);
          layer(mascot, '--lab-mascot-x', '--lab-mascot-y', 5);
        };
        showcase.addEventListener('pointermove', event => {
          if (!isVisible()) return;
          const r = showcase.getBoundingClientRect();
          pos = [(event.clientX-r.left)/r.width-.5, (event.clientY-r.top)/r.height-.5];
          if (!frame) frame = requestAnimationFrame(paint);
        }, { passive: true });
        showcase.addEventListener('pointerleave', () => {
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          for (const child of [back,front,mascot]) {
            if (!child) continue;
            for (const key of ['--lab-card-x','--lab-card-y','--lab-mascot-x','--lab-mascot-y']) child.style.removeProperty(key);
          }
        }, { passive: true });
      }
    }
    const banner = document.createElement('div');
    banner.className = 'lab-preview-banner';
    banner.setAttribute('role', 'note');
    banner.innerHTML = '<span class="lab-preview-banner__dot" aria-hidden="true"></span>' +
      '<span>LEMRIX LAB · Experimental preview</span>' +
      '<a class="lab-preview-banner__link" href="https://lemrix-tcg.vercel.app/">Live site</a>' +
      '<button class="lab-preview-banner__close" type="button" aria-label="Dismiss preview notice">×</button>';
    banner.querySelector('button').addEventListener('click', () => {
      banner.remove();
      try { sessionStorage.setItem('lemrix.lab.banner-dismissed', '1'); } catch {}
    });
    let dismissed = false;
    try { dismissed = sessionStorage.getItem('lemrix.lab.banner-dismissed') === '1'; } catch {}
    if (!dismissed) document.body.append(banner);
    /*
     * Keep preview form submissions away from the production enquiries inbox.
     * All actual shopping links remain live and unchanged.
     */
    const form = document.querySelector('#enquiry-form');
    if (form) {
      form.addEventListener('submit', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const status = document.querySelector('#enquiry-status');
        if (status) status.textContent =
          'This experimental preview does not send enquiries. Please use the live Lemrix site to contact the team.';
      }, true);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
