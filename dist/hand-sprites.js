'use strict';

(() => {
  const files = ['lemrix-hands', 'cookd-hands'];
  const sprites = files.map(() => new Image());
  const ready = Promise.all(sprites.map((sprite, index) => new Promise(resolve => {
    sprite.onload = () => resolve(true);
    sprite.onerror = () => resolve(false);
    sprite.src = `/assets/scenes/${files[index]}.webp`;
  }))).then(results => results.every(Boolean));

  function renderer(canvas) {
    const context = canvas?.getContext('2d');
    if (!context) return null;

    function paint(poses) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      poses.forEach(({ x, y, size, angle = 0, pose = 0 }, index) => {
        const sprite = sprites[index];
        if (!sprite.naturalWidth || !size) return;
        const cel = Math.min(3, Math.floor(pose));
        const cellWidth = sprite.naturalWidth / 4;
        const cellHeight = sprite.naturalHeight;
        const sourceX = cel * cellWidth;
        const anchorX = cellWidth * .89;
        const anchorY = cellHeight * .56;
        const scale = size / cellHeight;
        const seam = 24;
        const extension = Math.hypot(width, height) / scale;
        context.save();
        context.translate(x, y);
        context.rotate(angle);
        context.scale(index ? -scale : scale, scale);
        // Extend the forearm from its seam so it stays attached to the edge.
        context.drawImage(sprite, sourceX + seam, 0, 1, cellHeight,
          -anchorX - extension, -anchorY, extension + seam + 1, cellHeight);
        context.drawImage(sprite, sourceX + seam, 0, cellWidth - seam, cellHeight,
          seam - anchorX, -anchorY, cellWidth - seam, cellHeight);
        context.restore();
      });
    }

    return { paint };
  }

  window.LemrixHandSprites = { ready, renderer };
})();
