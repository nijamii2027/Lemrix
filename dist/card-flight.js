// Both card fields run independently of the timed story. A natural-layout
// section still flies if another scene is loading or the pin is unavailable.
(() => {
  'use strict';
  const fields = [...document.querySelectorAll('.green-scene .cards, .tv-scene .cards')].map((layer, index) => ({
    layer,
    cards: [...layer.querySelectorAll('.flight-card')].map((image, i) => ({
      image, index: i, rate: (.61 + i % 4 * .14) * (index === 1 ? 1.12 : 1),
      phase: i * 2.399 + index * .7
    })),
    width: 0, height: 0, elapsed: 0, onScreen: true, inStory: true, held: false
  }));
  if (!fields.length) return;

  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced, frame = 0, previous = null;
  function paint(field) {
    if (!field.width || !field.height) return;
    for (const {image,index,rate,phase} of field.cards) {
      const t = field.elapsed * rate + phase;
      const x = field.width * (.46 + .55 * Math.sin(t) + .10 * Math.sin(2*t + index));
      const y = field.height * (.47 + .36 * Math.cos(1.72*t + index) + .09 * Math.sin(2*t));
      const scale = .72 + .29 * Math.cos(t + index);
      const angle = t*58 + 47*Math.sin(2*t);
      image.style.transform = 'translate3d(' + x.toFixed(3) + 'px,' + y.toFixed(3) +
        'px,0) rotate(' + angle.toFixed(3) + 'deg) scale(' +
        (scale*Math.cos(1.5*t)).toFixed(5) + ',' + scale.toFixed(5) + ')';
    }
    // Keep the stylesheet's spread until all cards have valid coordinates.
    if (!field.layer.hasAttribute('data-flight-ready')) field.layer.setAttribute('data-flight-ready', '');
  }
  function measure(field) {
    field.width = field.layer.clientWidth;
    field.height = field.layer.clientHeight;
    paint(field);
  }
  const canFly = f => f.onScreen && f.inStory && !f.held && f.width > 0 && f.height > 0;
  function schedule() {
    const needed = !document.hidden && !reduced && fields.some(canFly);
    if (needed && !frame) frame = requestAnimationFrame(tick);
    if (!needed) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      previous = null;
    }
  }
  function tick(now) {
    frame = 0;
    const dt = previous === null ? 0 : Math.min((now-previous)/1000, .1);
    previous = now;
    for (const field of fields) {
      if (!canFly(field)) continue;
      field.elapsed += dt;
      paint(field);
    }
    schedule();
  }
  function syncMotion() {
    const choice = document.documentElement.dataset.motion;
    reduced = choice ? choice === 'reduced' : preference.matches;
    fields.forEach(measure);
    schedule();
  }
  const findField = node => fields.find(field => field.layer === node);
  if ('ResizeObserver' in window) {
    const size = new ResizeObserver(entries => {
      for (const entry of entries) measure(findField(entry.target));
      schedule();
    });
    fields.forEach(field => size.observe(field.layer));
  } else {
    window.addEventListener('resize', syncMotion);
  }
  if ('IntersectionObserver' in window) {
    const view = new IntersectionObserver(entries => {
      for (const entry of entries) findField(entry.target).onScreen = entry.isIntersecting;
      schedule();
    });
    fields.forEach(field => view.observe(field.layer));
  }
  for (const field of fields) {
    const paper = field.layer.closest('.tv-scene');
    if (!paper) continue;
    new MutationObserver(() => {
      field.held = paper.classList.contains('paper-held');
      schedule();
    }).observe(paper, {attributes:true, attributeFilter:['class']});
  }
  // The story supplies occlusion hints while its sections share one pinned
  // rectangle. Without hints, each field follows its own viewport intersection.
  window.LemrixCards = {
    setStoryView(hero = true, stream = true) {
      if (fields[0].inStory === hero && (!fields[1] || fields[1].inStory === stream)) return;
      fields[0].inStory = hero;
      if (fields[1]) fields[1].inStory = stream;
      schedule();
    }
  };
  window.addEventListener('lemrix-motion-change', syncMotion);
  if (preference.addEventListener) preference.addEventListener('change', syncMotion);
  else preference.addListener(syncMotion);
  window.addEventListener('pageshow', syncMotion);
  document.addEventListener('visibilitychange', schedule);
  syncMotion();
})();
