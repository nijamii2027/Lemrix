'use strict';

(() => {
  const motion = window.LemrixMotionState;
  const stage = document.querySelector('.tv-stage');
  const canvas = stage?.querySelector('canvas');
  const context = canvas?.getContext('2d', { alpha: true });
  if (!motion || !context) return;

  const base = '/assets/scenes/';
  const width = 1200;
  const height = 850;
  const period = 4000;
  const frameRate = 16;
  const paintInterval = 1000 / 30;
  const cell = 360;
  const cel = document.createElement('canvas');
  cel.width = cel.height = cell;
  const ink = cel.getContext('2d');
  let elapsed = 0;
  let lastTime;
  let lastPaint;
  let scene;
  let visible = false;
  let canvasSizeDirty = true;
  let screenPath;
  const tailSlices = [131, 111].map(width => Array.from({ length: Math.ceil(width / 2) }, (_, index) => {
    const x = index * 2;
    const weight = 1 - Math.min(1, Math.max(0, x - 38) / (width - 38));
    return { x, width: Math.min(2, width - x), bend: weight ** 2 };
  }));

  function image(name) {
    const asset = new Image();
    return new Promise((resolve, reject) => {
      asset.onload = () => resolve(asset);
      asset.onerror = reject;
      asset.src = base + name + '.webp';
    });
  }

  function load() {
    Promise.all([
      image('crt-diorama'), image('crt-lemrix'), image('crt-cookd'),
      image('crt-footage-0'), image('crt-footage-1'),
      fetch(base + 'crt-scene.json').then(response => {
        if (!response.ok) throw new Error('CRT projection unavailable');
        return response.json();
      })
    ]).then(([room, lemrix, cookd, reelA, reelB, projection]) => {
      scene = { room, sprites: [lemrix, cookd], reels: [reelA, reelB], ...projection };
      screenPath = new Path2D();
      screenPath.moveTo(15, 0);
      screenPath.arcTo(224, 0, 224, 152, 15);
      screenPath.arcTo(224, 152, 0, 152, 15);
      screenPath.arcTo(0, 152, 0, 0, 15);
      screenPath.arcTo(0, 0, 224, 0, 15);
      screenPath.closePath();
    }).catch(() => {
      // The composited poster remains available if a sprite sheet fails to load.
      stage.dataset.playback = 'poster';
    });
  }

  function footage() {
    const frame = Math.floor(elapsed * frameRate / 1000) % 64;
    const index = frame % 32;
    const [topLeft, topRight, bottomLeft] = scene.screen;
    context.save();
    context.transform(
      (topRight[0] - topLeft[0]) / 224, (topRight[1] - topLeft[1]) / 224,
      (bottomLeft[0] - topLeft[0]) / 152, (bottomLeft[1] - topLeft[1]) / 152,
      ...topLeft
    );
    context.clip(screenPath);
    context.drawImage(scene.reels[frame >= 32 ? 1 : 0],
      index % 8 * 224, Math.floor(index / 8) * 152, 224, 152, 0, 0, 224, 152);
    context.restore();
    stage.dataset.frame = String(frame);
  }

  function shadow(x, y, width, height) {
    context.save();
    context.translate(x, y);
    context.scale(width, height);
    const blur = context.createRadialGradient(0,0,0,0,0,1);
    blur.addColorStop(0, '#17274f70');
    blur.addColorStop(1, '#17274f00');
    context.fillStyle = blur;
    context.fillRect(-1,-1,2,2);
    context.restore();
  }

  function actor(index, pose, phase, lean) {
    const { anchor: [x,y], size } = scene.actors[index];
    const sway = Math.sin(phase) * (motion.systemReduced ? .6 : 1);
    shadow(x+4, y+3, size*.38, size*.095);
    context.save();
    context.translate(x, y);
    context.rotate(lean + sway*.014);
    context.scale(1 - sway*.009, 1 + sway*.013);
    const sheet = scene.sprites[index];
    const spriteTop = -size*.96;
    // Assemble the tail bend at the original cel resolution. Scaling the
    // completed sprite once keeps the torso from splitting at fractional sizes.
    const left = pose * cell;
    const tailWidth = index ? 111 : 131;
    const tailTop = index ? 234 : 206;
    const stripHeight = cell - tailTop;
    ink.clearRect(0, 0, cell, cell);
    ink.drawImage(sheet, left, 0, cell, cell, 0, 0, cell, cell);
    ink.clearRect(0, tailTop, tailWidth, stripHeight);
    for (const slice of tailSlices[index]) {
      const bend = sway * (index ? 22 : 25) * slice.bend;
      ink.drawImage(sheet, left + slice.x, tailTop, slice.width, stripHeight,
        slice.x, tailTop, slice.width, stripHeight + bend);
    }
    context.drawImage(cel, -size / 2, spriteTop, size, size);
    context.restore();
  }

  function popcorn(progress) {
    const dog = scene.actors[1];
    const viewer = scene.actors[0];
    for (let index=0; index<4; index++) {
      const flight = (progress-.227-index*.014)/.20;
      if (flight < 0 || flight > 1) continue;
      const startX = dog.anchor[0]-dog.size*.30;
      const endX = viewer.anchor[0]+viewer.size*.253;
      const x = startX+(endX-startX)*flight;
      const startY = dog.anchor[1]-dog.size*.40;
      const endY = viewer.anchor[1]-viewer.size*.407;
      const y = startY+(endY-startY)*flight-4*(72+index*11)*flight*(1-flight);
      context.save();
      context.translate(x,y);
      context.rotate(flight*5+index);
      context.fillStyle='#ffe7a7';
      context.strokeStyle='#754b39';
      context.lineWidth=1.5;
      context.beginPath();
      context.ellipse(-3,0,4.5,4,0,0,Math.PI*2);
      context.ellipse(1,-2,4,4.6,0,0,Math.PI*2);
      context.ellipse(3,2,3.7,3,0,0,Math.PI*2);
      context.stroke();
      context.fill();
      context.restore();
    }
  }

  function paint() {
    if (!scene) return;
    if (canvasSizeDirty) {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const pixelWidth = Math.min(width, Math.round(stage.clientWidth*dpr));
      if (!pixelWidth) return;
      canvas.width = pixelWidth;
      canvas.height = Math.round(pixelWidth*height/width);
      canvasSizeDirty = false;
    }
    context.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
    context.clearRect(0,0,width,height);
    context.drawImage(scene.room,0,0,width,height);
    footage();
    const p = elapsed/period;
    const cookd = p < .13 || p >= .45 ? 0 : p < .225 || p >= .37 ? 1 : 2;
    const lemrix = p < .48 || p >= .77 ? 0 : p < .55 || p >= .68 ? 1 : 2;
    const phase = p * Math.PI*4;
    // The shoulders follow the toss, then the viewer tips toward the cup.
    const beat = (from, until) => Math.sin(Math.PI*Math.max(0, Math.min(1, (p-from)/(until-from))));
    actor(1,cookd,phase+1.4,beat(.07,.225)*.06-beat(.225,.44)*.095);
    actor(0,lemrix,phase,beat(.39,.50)*.025+beat(.50,.79)*.055);
    popcorn(p);
    stage.dataset.playback = 'frames';
  }

  function tick(time) {
    if (!visible || document.querySelector('dialog[open]')) {
      lastTime = undefined;
      lastPaint = undefined;
      return;
    }
    if (!scene || !screenPath) return;
    elapsed = (elapsed + (lastTime === undefined ? 0 : Math.min(90,time-lastTime))) % period;
    lastTime = time;
    if (canvasSizeDirty || lastPaint === undefined || time >= lastPaint + paintInterval - 1) {
      lastPaint = time;
      paint();
    }
  }

  if (typeof IntersectionObserver === 'function') {
    const preload = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      preload.disconnect();
      load();
    }, { rootMargin: '400px' });
    preload.observe(stage);
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(stage);
  } else {
    const checkVisibility = () => { visible = motion.isOnScreen(stage); };
    window.addEventListener('scroll', checkVisibility, { passive: true });
    window.addEventListener('resize', checkVisibility, { passive: true });
    checkVisibility();
    load();
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { canvasSizeDirty = true; }).observe(stage);
  }
  window.addEventListener('resize', () => { canvasSizeDirty = true; }, { passive: true });
  window.addEventListener('lemrix:motion-change', () => { lastTime = undefined; });
  motion.onFrame(tick);
})();
