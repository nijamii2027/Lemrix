'use strict';

(() => {
  const scene = document.querySelector('.menu-mascots');
  const motion = window.LemrixMotionState;
  if (!scene || !motion) return;
  const actors = [...scene.querySelectorAll('.shop-actor')];
  for (const actor of actors) {
    const sheet = new Image();
    sheet.onload = () => { actor.dataset.atlasReady = 'true'; };
    sheet.src = actor.dataset.atlas;
  }
  const cycle = 5400;
  let elapsed = 0;
  let lastTime;
  motion.onFrame(time => {
    if (!motion.isOnScreen(scene) || document.querySelector('dialog[open]')) {
      lastTime = undefined;
      return;
    }
    elapsed = (elapsed + (lastTime === undefined ? 0 : Math.min(85, time - lastTime))) % cycle;
    lastTime = time;
    actors.forEach((actor, index) => {
      const t = (elapsed + index * cycle / 2) % cycle;
      const talking = t > 540 && t < 1630;
      const hand = talking && (t > 830 || Math.floor(t / 135) % 2);
      const lift = talking ? Math.sin(Math.PI * (t - 540) / 1090) * (motion.systemReduced ? 1 : 2.6) : 0;
      actor.style.setProperty('--actor-cel', hand ? '100%' : '0%');
      actor.style.setProperty('--actor-lift', lift.toFixed(2) + '%');
      actor.style.setProperty('--actor-lean', (lift * (index ? -.8 : .9)).toFixed(2) + 'deg');
    });
  });
})();
