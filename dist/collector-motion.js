'use strict';

(() => {
  const motion = window.LemrixMotionState;
  const headline = document.querySelector('#hangout-title');
  if (!motion || !headline) return;

  const lines = [...headline.querySelectorAll('span')];
  let lastProgress;

  function paint() {
    if (!motion.enabled || motion.systemReduced) {
      if (lastProgress === undefined) return;
      lines.forEach(line => line.style.removeProperty('transform'));
      lastProgress = undefined;
      return;
    }

    const top = headline.getBoundingClientRect().top;
    const progress = Math.max(0, Math.min(1, (innerHeight * .94 - top) / (innerHeight * .47)));
    if (progress === lastProgress) return;
    lastProgress = progress;
    lines.forEach((line, index) => {
      const travel = Math.max(0, Math.min(1, (progress - index * .12) / .88));
      line.style.transform = `translateX(${-106 * (1 - travel) ** 2}%)`;
    });
  }

  window.addEventListener('lemrix:motion-change', paint);
  window.addEventListener('scroll', paint, { passive: true });
  motion.onFrame(paint);
  paint();
})();
