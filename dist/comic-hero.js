'use strict';

(() => {
  const hero = document.querySelector('.moon-hero');
  const motion = window.LemrixMotionState;
  if (!hero || !motion) return;

  const shop = hero.querySelector('.moon-diorama');
  const comic = document.querySelector('.collab-viewport');

  const route = [
    [.474, .812], [.574, .789], [.669, .770], [.721, .766], [.733, .799],
    [.657, .832], [.535, .849], [.409, .850], [.316, .823], [.312, .790],
    [.381, .787]
  ];
  const runway = document.createElement('div');
  runway.className = 'mascot-runway';
  runway.hidden = true;
  runway.setAttribute('aria-hidden', 'true');
  const actors = [...shop.querySelectorAll('.shop-actor')].map(element => {
    const runner = element.cloneNode(true);
    runway.append(runner);
    return { element, runner, phaseOffset: element.dataset.actor === 'cookd' ? .75 : 0,
      cel: 0, facing: 1, ready: false };
  });
  comic.append(runway);
  const nav = document.querySelector('.nav-world');
  let visible = motion.isOnScreen(hero);
  let backdropReady = false;
  let lastFrame = 0;
  let distance = 0;
  let stride = 0;
  let measureAt = -Infinity;
  let pastShop = false;
  let runwayVisible = false;
  let runwayTravel = 0;

  function pointOnPath(phase) {
    const size = route.length;
    const position = (phase % 1) * size;
    const segment = Math.floor(position);
    const progress = position - segment;
    const a = route[(segment + size - 1) % size];
    const b = route[segment];
    const c = route[(segment + 1) % size];
    const d = route[(segment + 2) % size];
    // The control points wrap so the last stride leads into the first turn.
    return b.map((value, axis) => .5 * (
      2 * value + (c[axis] - a[axis]) * progress +
      (2 * a[axis] - 5 * value + 4 * c[axis] - d[axis]) * progress ** 2 +
      (3 * value - a[axis] - 3 * c[axis] + d[axis]) * progress ** 3
    ));
  }

  function paint(actor, point, cel, lift, lean) {
    const [x, y] = point;
    actor.element.style.setProperty('--actor-x', (100 * x).toFixed(3) + '%');
    actor.element.style.setProperty('--actor-y', (100 * y).toFixed(3) + '%');
    actor.element.style.setProperty('--actor-lift', lift.toFixed(2) + '%');
    actor.element.style.setProperty('--actor-lean', lean.toFixed(2) + 'deg');
    actor.element.style.setProperty('--actor-facing', String(actor.facing));
    actor.element.style.zIndex = String(Math.round(y * 1000));
    if (actor.cel !== cel) {
      actor.cel = cel;
      actor.element.dataset.cel = String(cel);
      actor.element.style.setProperty('--actor-cel', (cel / 5 * 100) + '%');
    }
  }

  function shopHasDisappeared() {
    const rect = hero.getBoundingClientRect();
    const navBottom = Math.max(0, nav.getBoundingClientRect().bottom);
    if (rect.bottom <= navBottom) return true;
    if (rect.bottom > innerHeight || rect.top > -rect.height * .22) return false;
    // The translating shop can pass behind the wave before its section ends.
    return actors.every(({ element }) => {
      const actor = element.getBoundingClientRect();
      return actor.top >= rect.bottom || actor.bottom <= navBottom;
    });
  }

  function runAlongEdge(delta, reduced) {
    if (runway.hidden) runway.hidden = false;
    const cell = actors[0].runner.offsetWidth;
    const gap = cell * 1.25;
    const length = runway.clientWidth + cell + gap;
    if (runwayTravel === 0) runwayTravel = cell * 2;
    runwayTravel = (runwayTravel + delta * (reduced ? .082 : motion.touch ? .116 : .156)) % length;
    actors.forEach(({ runner }, index) => {
      const x = (runwayTravel + index * gap) % length - cell;
      const step = stride + index * 1.5;
      runner.style.setProperty('--runner-x', x.toFixed(2) + 'px');
      runner.style.setProperty('--actor-cel', ((1 + Math.floor(step) % 4) * 20) + '%');
      runner.style.setProperty('--actor-lift', (Math.abs(Math.sin(step * Math.PI / 2)) * (reduced ? 1 : 3)) + '%');
    });
  }

  function tick(time) {
    const delta = lastFrame ? Math.min(72, time - lastFrame) : 0;
    lastFrame = time;
    if (!backdropReady || !actors.every(actor => actor.ready) || !motion.enabled ||
        document.hidden || document.querySelector('dialog[open]')) {
      runway.hidden = true;
      return;
    }
    if (time - measureAt >= 100) {
      measureAt = time;
      pastShop = shopHasDisappeared();
      runwayVisible = motion.isOnScreen(comic);
    }

    const reduced = motion.systemReduced;
    stride = (stride + delta / (reduced ? 130 : 92)) % 4;
    if (pastShop && runwayVisible) {
      runAlongEdge(delta, reduced);
      return;
    }
    runway.hidden = true;
    if (!visible || pastShop) return;
    runwayTravel = 0;
    distance = (distance + delta / (reduced ? 7300 : 5450)) % 1;
    if (hero.dataset.mascots !== 'running') hero.dataset.mascots = 'running';
    for (const actor of actors) {
      const phase = distance + actor.phaseOffset;
      const point = pointOnPath(phase);
      const horizontal = pointOnPath(phase + .004)[0] - point[0];
      if (Math.abs(horizontal) > .00015) actor.facing = horizontal < 0 ? -1 : 1;
      const step = stride + actor.phaseOffset * 2;
      const lift = (reduced ? .8 : 2.6) * Math.abs(Math.sin(step * Math.PI / 2));
      paint(actor, point, 1 + Math.floor(step) % 4, lift, actor.facing * (reduced ? 1 : 3));
    }
  }

  actors.forEach(actor => {
    const atlas = new Image();
    atlas.onload = () => {
      actor.ready = true;
      actor.element.dataset.atlasReady = 'true';
      actor.runner.dataset.atlasReady = 'true';
    };
    atlas.src = actor.element.dataset.atlas;
  });

  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    }).observe(hero);
  }
  window.addEventListener('lemrix:motion-change', () => {
    measureAt = -Infinity;
    runway.hidden = true;
    if (!motion.enabled) hero.dataset.mascots = 'paused';
  });
  motion.onFrame(tick);

  // The original title entrance shares this readiness event.
  const backdrop = shop.querySelector('.shop-backdrop');
  const announceReady = () => {
    backdropReady = backdrop.naturalWidth > 0;
    hero.dataset.render = 'illustrated';
    if (!motion.enabled) hero.dataset.mascots = 'paused';
    window.dispatchEvent(new Event('lemrix:hero-ready'));
  };
  if (backdrop.complete) announceReady();
  else {
    backdrop.addEventListener('load', announceReady, { once: true });
    backdrop.addEventListener('error', announceReady, { once: true });
  }
})();
