/** Lemrix cursor-surfer — 11 transparent 200x200 sprite frames.
 *  Drop the accompanying CSS, JS and sprite asset in dist/, and reference
 *  <link rel="stylesheet" href="/lemrix-cursor-surf.css">
 *  <script src="/lemrix-cursor-surf.js" defer></script>
 */
(() => {
  'use strict';
  if (window.__lemrixSurfInstalled) return;
  window.__lemrixSurfInstalled = true;
  const desktop = window.matchMedia('(pointer: fine)');
  if (!desktop.matches) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.createElement('div');
  root.id = 'lemrix-cursor-surfer';
  root.setAttribute('aria-hidden','true');
  document.body.appendChild(root);

  let targetX = innerWidth / 2, targetY = innerHeight / 2;
  let x = targetX, y = targetY, lastX = x, lastY = y;
  let lastCardX = x, lastCardY = y;
  let active = false, visible = false, frame = 0, lastTime = 0;
  let frameClock = 0, idleTime = 0;
  const cards = new Set();
  const frameCount = 11, cardGap = 29, maxCards = 28;
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const onPointer = e => {
    if (e.pointerType === 'touch' || e.target?.closest?.('dialog[open]')) return;
    targetX = e.clientX; targetY = e.clientY;
    active = true; visible = true; idleTime = performance.now();
    root.classList.add('is-visible');
  };
  document.addEventListener('pointermove', onPointer, {passive: true});
  document.documentElement.addEventListener('mouseleave',() => {
    active = false; visible = false; root.classList.remove('is-visible');
  });
  window.addEventListener('blur',() => { active = false; root.classList.remove('is-visible'); });

  function makeCard(px,py,vx,vy) {
    if (reduced.matches) return;
    const card = document.createElement('span');
    card.className = 'lemrix-surf-card';
    card.setAttribute('aria-hidden','true');
    card.style.left = `${px}px`;
    card.style.top = `${py}px`;
    card.style.setProperty('--tilt',`${Math.round(Math.atan2(vy,vx)*180/Math.PI)+90}deg`);
    card.style.setProperty('--dx',`${(-vx*.22+(Math.random()-.5)*36).toFixed(0)}px`);
    card.style.setProperty('--dy',`${(-vy*.22-28-Math.random()*32).toFixed(0)}px`);
    card.style.setProperty('--spin',`${Math.round((Math.random()-.5)*105)}deg`);
    document.body.append(card); cards.add(card);
    const remove = () => { cards.delete(card); card.remove(); };
    card.addEventListener('animationend',remove,{once:true});
    // Prevent DOM buildup when animation is canceled or a tab is backgrounded.
    setTimeout(remove,1700);
    if (cards.size > maxCards) { const oldest=cards.values().next().value; if(oldest){cards.delete(oldest);oldest.remove();} }
  }

  function animate(now) {
    const dt = clamp(now-(lastTime||now),0,50); lastTime=now;
    const ease = 1-Math.exp(-dt*.011);
    lastX=x; lastY=y;
    x += (targetX-x)*ease; y += (targetY-y)*ease;
    const vx = x-lastX, vy = y-lastY;
    const speed = Math.hypot(vx,vy);
    const tilt = clamp(vx*1.6,-16,16);
    // Keep the actual pointer available for clicking, surfer sits just above it.
    root.style.transform = `translate3d(${x-45}px,${y-138}px,0) rotate(${tilt.toFixed(1)}deg)`;
    const moving = active && speed > .35;
    if (moving && !reduced.matches) {
      frameClock += dt;
      if (frameClock >= (speed>10 ? 68 : 108)) {
        frameClock=0;frame=(frame+1)%frameCount;
        root.style.backgroundPosition=`${frame*10}% 0`;
      }
      if (visible && Math.hypot(x-lastCardX,y-lastCardY)>cardGap) {
        // Drop cards along the character's surf wake, not under the cursor tip.
        makeCard(x-8,y-14,vx*10,vy*10);
        lastCardX=x;lastCardY=y;
      }
    } else if (now-idleTime>700 && frame !== 0) {
      frame=0;frameClock=0;root.style.backgroundPosition='0 0';
    }
    // Pause any streaming card effect during inactive tabs / stillness.
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
})();
