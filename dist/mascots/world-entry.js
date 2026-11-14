'use strict';

(() => {
  const q = selector => document.querySelector(selector);
  const motion = window.LemrixMotionState;
  const reference = q('#reference-dialog');
  const film = q('#film-dialog');
  const video = q('#rendered-film');
  const image = q('#rendered-world');
  const replay = q('#replay');
  let rendered = false;
  let frames;

  function sync() {
    if (!rendered) return;
    const playing = motion.enabled && !document.hidden && !reference.open && !film.open;
    frames?.setActive(playing);
    const src = playing && !frames ? './mascot-study.webp' : './duo-render.jpg';
    if (image.getAttribute('src') !== src) image.src = src;
  }

  function showRendered() {
    if (rendered) return;
    rendered = true;
    document.body.dataset.state = 'rendered';
    image.hidden = false;
    q('#scene').hidden = true;
    q('.drag-hint').hidden = true;
    q('#caption').textContent = 'Rendered storefront preview';
    replay.disabled = false;
    frames = window.LemrixFrameLoop?.(q('#rendered-frames'), () => {
      frames = null;
      sync();
    });
    sync();
  }

  window.LemrixWorld = { showRendered };
  window.addEventListener('lemrix:motion-change', sync);
  replay.addEventListener('click', () => {
    if (frames) frames.restart();
    else if (rendered) {
      image.src = './duo-render.jpg';
      setTimeout(sync, 80);
    } else window.dispatchEvent(new Event('lemrix:scene-replay'));
  });
  q('#open-film').addEventListener('click', () => {
    film.showModal();
    sync();
    video.currentTime = 0;
    video.play().catch(() => {});
  });
  q('#open-reference').addEventListener('click', () => {
    reference.showModal();
    sync();
  });
  for (const [dialog, close] of [[film, '.close-film'], [reference, '.close-reference']]) {
    q(close).addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', sync);
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  }
  film.addEventListener('close', () => video.pause());
  q('#retry').addEventListener('click', () => location.reload());
  image.addEventListener('error', () => {
    if (!rendered) return;
    document.body.dataset.state = 'error';
    image.hidden = true;
    q('.fallback').hidden = false;
    q('#render-error').hidden = false;
  });

  sync();
  if (motion.touch) showRendered();
  else import('./world.js?v=storefront-2').catch(showRendered);
})();
