'use strict';
(function () {
  const config = window.LEMRIX_FEATURE;
  if (!config?.enabled) return;
  const localAsset = path => typeof path === 'string' && /^\/assets\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp|mp4|webm|vtt)$/.test(path);
  let original;
  try { original = new URL(config.originalUrl); } catch { return; }
  if (original.protocol !== 'https:' || !localAsset(config.poster) || !localAsset(config.clip) || !localAsset(config.captions)) return;
  const section = document.querySelector('#the-moment');
  const video = section.querySelector('video');
  video.poster = config.poster;
  video.src = config.clip;
  section.querySelector('track').src = config.captions;
  section.querySelector('h2').textContent = config.headline;
  section.querySelector('.moment-description').textContent = config.description;
  section.querySelector('.moment-credit').textContent = config.credit;
  section.querySelector('.moment-source').href = original.href;
  // Only reveal after the poster actually loads; never show a broken media card.
  const probe = new Image();
  probe.onload = () => {section.hidden = false;};
  probe.src = config.poster;
})();
