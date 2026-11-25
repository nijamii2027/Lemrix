// Freeze the live studio into an origin-clean GPU texture at the instant of the grip.
// Static paint and type are cached. Cards, decals, footage and sprite pose come from the live frame.
window.LemrixSheetSnapshot = (() => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const surface = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  };
  const rectOf = (element, origin) => {
    const r = element.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };
  function asset(url) {
    const image = new Image();
    image.src = new URL(url, document.baseURI).href;
    return image.decode().then(() => image);
  }
  function textureScale(w, h) {
    return Math.min(window.devicePixelRatio || 1, 1.5, 2400 / Math.max(w, h), Math.sqrt(2200000 / (w * h)));
  }
  function imageLayer(ctx, element, origin, image = element) {
    if (!image || !image.width || (image instanceof HTMLImageElement && !image.naturalWidth)) return;
    const box = rectOf(element, origin);
    if (!box.w || !box.h) return;
    const css = getComputedStyle(element);
    const matrix = css.transform === 'none' ? null : new DOMMatrixReadOnly(css.transform);
    const width = parseFloat(css.width) || box.w;
    const height = parseFloat(css.height) || box.h;
    ctx.save();
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    if (matrix) ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0);
    const scale = parseFloat(css.scale);
    if (Number.isFinite(scale)) ctx.scale(scale, scale);
    ctx.globalAlpha *= parseFloat(css.opacity);
    if (css.filter !== 'none') ctx.filter = css.filter;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
  function floorPath(ctx, w, h, leftX, leftY, rightX, rightY, top = 0) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, leftY);
    ctx.ellipse(leftX, leftY, leftX, Math.max(.1, leftY - top), 0, Math.PI, Math.PI * 1.5);
    ctx.lineTo(w - rightX, top);
    ctx.ellipse(w - rightX, rightY, rightX, Math.max(.1, rightY - top), 0, Math.PI * 1.5, Math.PI * 2);
    ctx.lineTo(w, h);
    ctx.closePath();
  }
  function paintBackground(cache, glow) {
    const { w, h, ratio } = cache;
    const canvas = surface(w * ratio, h * ratio);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.scale(ratio, ratio);
    // CSS farthest-corner ellipse. The longest horizontal and vertical radii meet at 100%.
    ctx.save();
    ctx.translate(w * .22, h * .47);
    ctx.scale(w * .78 * Math.SQRT2, h * .53 * Math.SQRT2);
    const sky = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [stop, colour] of [[0, '#ffefd0'], [.37, '#ffdc90'], [.72, '#ffc572'], [1, '#f9b072']]) sky.addColorStop(stop, colour);
    ctx.fillStyle = sky;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();

    const css = getComputedStyle(glow);
    const gw = parseFloat(css.width), gh = parseFloat(css.height);
    const reduced = 1 / 1.15; // CSS reduces the two top corner radii (50% + 65%) proportionally.
    const rx = gw * .5 * reduced, ry = gh * .18 * reduced;
    const sx = gw * .65 * reduced, sy = gh * .29 * reduced;
    ctx.translate(parseFloat(css.left) + gw / 2, parseFloat(css.top) + gh / 2);
    const matrix = new DOMMatrixReadOnly(css.transform);
    ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0);
    ctx.translate(-gw / 2, -gh / 2);
    ctx.fillStyle = css.borderTopColor;
    floorPath(ctx, gw, gh, rx, ry, sx, sy);
    ctx.fill();
    ctx.fillStyle = css.backgroundColor;
    floorPath(ctx, gw, gh, rx, ry, sx, sy, parseFloat(css.borderTopWidth));
    ctx.fill();
    return canvas;
  }
  function paintText(copy, ratio) {
    const local = copy.getBoundingClientRect();
    const margin = 8;
    const canvas = surface((local.width + margin * 2) * ratio, (local.height + margin * 2) * ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const range = document.createRange();
    for (const block of copy.querySelectorAll('h2,p')) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let text; (text = walker.nextNode());) {
        const style = getComputedStyle(text.parentElement);
        ctx.font = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
        ctx.fillStyle = style.color;
        if ('letterSpacing' in ctx) ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
        const metrics = ctx.measureText('Hg');
        // DOM ranges expose the browser's real wrapping. Paint each word on that font's baseline.
        for (const match of text.data.matchAll(/\S+/g)) {
          range.setStart(text, match.index);
          range.setEnd(text, match.index + match[0].length);
          const r = range.getBoundingClientRect();
          if (!r.width) continue;
          const ascent = metrics.fontBoundingBoxAscent ?? parseFloat(style.fontSize) * .8;
          const descent = metrics.fontBoundingBoxDescent ?? (r.height - ascent);
          const baseline = r.top - local.top + (r.height - ascent - descent) / 2 + ascent;
          ctx.fillText(match[0], margin + r.left - local.left, margin + baseline);
        }
      }
    }
    return { canvas, margin };
  }
  function drawCover(ctx, source, width, height) {
    const sw = source.videoWidth || source.naturalWidth;
    const sh = source.videoHeight || source.naturalHeight;
    const scale = Math.max(width / sw, height / sh);
    const cw = width / scale, ch = height / scale;
    ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, width, height);
  }

  function create(print) {
    const find = selector => print.querySelector(selector);
    const glow = find('.studio-glow'), cardField = find('.cards'), grain = find('.paper-grain');
    const cards = Array.from(cardField.children);
    const copy = find('.tv-copy'), socials = Array.from(copy.querySelectorAll('.social-sticker img'));
    const floor = find('.tv-floor'), screen = find('.crt-picture'), video = screen.querySelector('video');
    const frame = find('.crt > img'), watcher = find('.watcher'), loop = find('.watch-loop');
    const still = find('.watcher .still'), control = find('.play-toggle');
    let cached = null, pending = null, version = 0, disposed = false;
    const loadMedia = () => Promise.all([
      asset('assets/grain.png'), asset('assets/crt-screen.png'), asset('assets/watcher-poses.webp'), asset(video.poster),
      ...[frame, still, cards[0], ...socials].map(image => image.decode()),
      document.fonts.ready
    ]).then(([grain, mask, atlas, poster]) => ({ grain, mask, atlas, poster }));
    let media;

    function warm() {
      if (disposed) return Promise.resolve(false);
      const w = print.clientWidth, h = print.clientHeight;
      if (!w || !h) return Promise.resolve(false);
      const ratio = textureScale(w, h);
      const key = [w, h, ratio].join('/');
      if (cached?.key === key) return Promise.resolve(true);
      if (pending?.key === key) return pending.promise;
      const id = ++version;
      const promise = (async () => {
        let images = await (media ||= loadMedia().catch(() => null));
        if (!images) {
          media = loadMedia().catch(() => null);
          images = await media;
        }
        if (!images || disposed || id !== version) return false;
        const next = { key, w, h, ratio, images };
        next.background = paintBackground(next, glow);
        next.type = paintText(copy, ratio);
        next.canvas = surface(w * ratio, h * ratio);
        next.screen = surface(screen.clientWidth * ratio, screen.clientHeight * ratio);
        // These static images and the movie share the site's origin. Check the decoding path
        // before making the texture available to WebGL. No full-frame pixel readback is needed.
        const probe = surface(1, 1).getContext('2d', { willReadFrequently: true });
        for (const image of [images.grain, images.mask, images.atlas, images.poster, frame, cards[0], ...socials]) probe.drawImage(image, 0, 0, 1, 1);
        probe.getImageData(0, 0, 1, 1);
        cached = next;
        return true;
      })().catch(() => false).finally(() => {
        if (pending?.id === id) pending = null;
      });
      pending = { id, key, promise };
      return promise;
    }

    function capture() {
      if (!cached || disposed) return null;
      const { w, h, ratio, canvas, images } = cached;
      if (print.clientWidth !== w || print.clientHeight !== h) { warm(); return null; }
      const origin = print.getBoundingClientRect();
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.resetTransform();
      ctx.drawImage(cached.background, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.save();
      ctx.globalAlpha = parseFloat(getComputedStyle(cardField).opacity);
      cards.forEach(card => imageLayer(ctx, card, origin));
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = parseFloat(getComputedStyle(grain).opacity);
      ctx.fillStyle = ctx.createPattern(images.grain, 'repeat');
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      const shadow = rectOf(floor, origin);
      const shadowStyle = getComputedStyle(floor);
      ctx.save();
      ctx.globalAlpha = parseFloat(shadowStyle.opacity);
      ctx.filter = shadowStyle.filter;
      ctx.fillStyle = shadowStyle.backgroundColor;
      ctx.beginPath();
      ctx.ellipse(shadow.x + shadow.w / 2, shadow.y + shadow.h / 2, shadow.w / 2, shadow.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const screenRect = rectOf(screen, origin);
      const screenCanvas = cached.screen;
      const sc = screenCanvas.getContext('2d');
      const sw = screenCanvas.width, sh = screenCanvas.height;
      sc.clearRect(0, 0, sw, sh);
      const footage = video.readyState >= 2 && video.videoWidth > 0 ? video : images.poster;
      try { drawCover(sc, footage, sw, sh); } catch { drawCover(sc, images.poster, sw, sh); }
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(images.mask, 0, 0, sw, sh);
      sc.globalCompositeOperation = 'source-over';
      ctx.drawImage(screenCanvas, screenRect.x, screenRect.y, screenRect.w, screenRect.h);
      imageLayer(ctx, frame, origin);
      if (!control.hidden) {
        const b = rectOf(control, origin);
        const css = getComputedStyle(control);
        ctx.save();
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
        ctx.beginPath(); ctx.arc(0, 0, b.w / 2 - 1, 0, Math.PI * 2);
        ctx.fillStyle = css.backgroundColor; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = css.borderColor; ctx.stroke();
        ctx.fillStyle = css.color;
        if (control.classList.contains('playing')) {
          ctx.fillRect(-5, -6, 3, 12); ctx.fillRect(2, -6, 3, 12);
        } else {
          ctx.beginPath(); ctx.moveTo(-3.5, -6); ctx.lineTo(6.5, 0); ctx.lineTo(-3.5, 6); ctx.fill();
        }
        ctx.restore();
      }

      if (getComputedStyle(watcher).visibility !== 'hidden') {
        const b = rectOf(watcher, origin), c = getComputedStyle(loop);
        ctx.save();
        ctx.filter = getComputedStyle(watcher).filter;
        if (c.display === 'none') ctx.drawImage(still, b.x, b.y, b.w, b.h);
        else if (loop.firstElementChild instanceof HTMLCanvasElement) ctx.drawImage(loop.firstElementChild,b.x,b.y,b.w,b.h);
        else {
          const fw = images.atlas.naturalWidth / 9, fh = images.atlas.naturalHeight / 6;
          const column = clamp(Math.round(parseFloat(c.backgroundPositionX) * .08), 0, 8);
          const row = clamp(Math.round(parseFloat(c.backgroundPositionY) * .05), 0, 5);
          ctx.drawImage(images.atlas, column * fw, row * fh, fw, fh, b.x, b.y, b.w, b.h);
        }
        ctx.restore();
      }
      const box = rectOf(copy, origin);
      ctx.save();
      ctx.globalAlpha = parseFloat(getComputedStyle(copy).opacity);
      const type = cached.type;
      ctx.drawImage(type.canvas, box.x - type.margin, box.y - type.margin, type.canvas.width / ratio, type.canvas.height / ratio);
      socials.forEach(logo => imageLayer(ctx, logo, origin));
      ctx.restore();
      return canvas;
    }
    return {
      warm, capture,
      destroy() {
        disposed = true;
        version++;
        if (cached) for (const layer of [cached.background, cached.type.canvas, cached.canvas, cached.screen]) layer.width = layer.height = 1;
        cached = pending = media = null;
      }
    };
  }
  return { create };
})();
