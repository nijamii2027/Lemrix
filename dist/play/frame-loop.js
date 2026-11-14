'use strict';

// Draw the same rendered frames on the touch clock. These are ordinary JPEG
// atlases, so drawing them does not depend on video or animated-image autoplay.
window.LemrixFrameLoop = (canvas, onError) => {
  const motion = window.LemrixMotionState;
  if (!motion.touch || !canvas) return null;

  let context;
  try { context = canvas.getContext('2d', { alpha: false }); }
  catch { return null; }
  if (!context) return null;

  const columns = Number(canvas.dataset.columns);
  const frameCount = Number(canvas.dataset.frames);
  const fps = Number(canvas.dataset.fps);
  const { width, height } = canvas;
  let image;
  let ready = false;
  let active = false;
  let start = null;
  let lastFrame = -1;

  motion.onTouchFrame(time => {
    if (!active || !ready) return;
    if (start === null) start = time;
    const frame = Math.floor((time - start) * fps / 1000) % frameCount;
    if (frame === lastFrame) return;
    const x = (frame % columns) * width;
    const y = Math.floor(frame / columns) * height;
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    if (lastFrame < 0) {
      canvas.parentElement.classList.add('has-frame-loop');
      canvas.hidden = false;
    }
    lastFrame = frame;
  });

  return {
    setActive(playing) {
      active = playing;
      if (!active || image) return;
      image = new Image();
      image.onload = () => { ready = true; };
      image.onerror = () => {
        active = false;
        onError();
      };
      image.src = canvas.dataset.atlas;
    },
    restart() {
      start = null;
      lastFrame = -1;
    }
  };
};
