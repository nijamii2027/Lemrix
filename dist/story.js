'use strict';

(() => {
  const strip = document.querySelector('#comic-strip');
  if (!strip) return;
  const carousel = strip.closest('.comic-carousel');
  const panels = [...strip.children];
  const previous = carousel.querySelector('#comic-prev');
  const next = carousel.querySelector('#comic-next');
  const track = carousel.querySelector('.comic-track');
  const motion = window.LemrixMotionState;
  let dirty = true;
  let travel;

  function render() {
    dirty = false;
    const end = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const progress = end ? Math.max(0, Math.min(1, strip.scrollLeft / end)) : 0;
    track.style.setProperty('--comic-progress', progress);
    track.style.setProperty('--comic-view', Math.min(1, strip.clientWidth / strip.scrollWidth));
    previous.setAttribute('aria-disabled', String(strip.scrollLeft <= 2));
    next.setAttribute('aria-disabled', String(strip.scrollLeft >= end - 2));
  }

  function stop() {
    travel = undefined;
    delete strip.dataset.moving;
    dirty = true;
  }

  function move(direction) {
    const current = travel?.goal ?? strip.scrollLeft;
    const offset = panels[0].offsetLeft;
    const end = strip.scrollWidth - strip.clientWidth;
    const stops = panels.map(panel => Math.min(end, panel.offsetLeft - offset));
    if (stops.at(-1) < end - 2) stops.push(end);
    const candidates = direction > 0 ? stops : stops.reverse();
    const goal = candidates.find(stop => (stop - current) * direction > 2);
    if (goal === undefined) return;
    if (!motion || motion.systemReduced) {
      strip.scrollLeft = goal;
      render();
      return;
    }
    strip.dataset.moving = '';
    travel = { from: strip.scrollLeft, goal, started: undefined };
  }

  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  strip.addEventListener('scroll', () => {
    dirty = true;
    if (!motion) render();
  }, { passive: true });
  strip.addEventListener('pointerdown', stop, { passive: true });
  strip.addEventListener('wheel', stop, { passive: true });
  strip.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    move(event.key === 'ArrowLeft' ? -1 : 1);
  });
  const resize = () => { stop(); render(); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(strip);
  else window.addEventListener('resize', resize, { passive: true });

  // Use the same clock as the mascots. Some WebViews throttle native smooth
  // scrolling and RAF while the page is embedded.
  motion?.onFrame(time => {
    if (travel) {
      travel.started ??= time;
      const progress = Math.min(1, (time - travel.started) / 405);
      strip.scrollLeft = travel.from + (travel.goal - travel.from) * (1 - (1 - progress) ** 3);
      if (progress === 1) stop();
      dirty = true;
    }
    if (dirty) render();
  });
  render();
})();
