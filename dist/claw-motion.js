/* Painted key drawing deformed at the pads and knuckles over 48 exposures.
   Coordinates describe the artwork before the hand element's CSS transform. */
window.createLemrixClaw = function createLemrixClaw(element) {
  const width = 2022;
  const height = 809;
  const topPadding = 15;
  const pads = [
    {x:297,y:458,dx:204,dy:-23,start:.02,end:.81},
    {x:480,y:253,dx:121,dy:99,start:.105,end:.91},
    {x:703,y:134,dx:10,dy:146,start:.19,end:.98},
    {x:294,y:611,dx:160,dy:-128,start:.28,end:1},
  ];
  const smooth = value => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  let lastFrame = -1;
  function contacts(close) {
    const pose = Math.round(Math.max(0, Math.min(1, close)) * 47) / 47;
    return pads.map(pad => {
      const bend = smooth((pose - pad.start) / (pad.end - pad.start));
      return {
        x:(pad.x + bend * pad.dx) / width,
        y:(pad.y + topPadding + bend * pad.dy) / height,
        pressure:smooth((bend - .035) / .965),
      };
    });
  }
  function draw(close) {
    const frame = Math.round(Math.max(0, Math.min(1, close)) * 47);
    if (frame === lastFrame) return;
    lastFrame = frame;
    element.style.backgroundPosition = (frame % 6 * 20) + '% ' + (Math.floor(frame / 6) * 100 / 7) + '%';
  }
  element.style.backgroundImage = 'url(assets/claw-curl.webp)';
  element.style.backgroundSize = '600% 800%';
  element.style.aspectRatio = '640 / 256';
  const closed = contacts(1);
  const anchor = {
    x:closed.reduce((sum,pad)=>sum + pad.x,0)/closed.length,
    y:closed.reduce((sum,pad)=>sum + pad.y,0)/closed.length,
  };
  element.style.transformOrigin = (anchor.x * 100) + '% ' + (anchor.y * 100) + '%';
  draw(0);
  return {draw,contacts,anchor};
};
