// Apply the device's motion preference before styling or scene scripts run.
(() => {
  const root = document.documentElement;
  const device = matchMedia('(prefers-reduced-motion: reduce)');
  window.LemrixMotion = device;

  function apply() {
    const motion = device.matches ? 'reduced' : 'full';
    if (root.dataset.motion === motion) return;
    root.dataset.motion = motion;
    window.dispatchEvent(new Event('lemrix-motion-change'));
  }

  if (device.addEventListener) device.addEventListener('change', apply);
  else device.addListener(apply);
  window.addEventListener('pageshow', apply);
  apply();
})();
