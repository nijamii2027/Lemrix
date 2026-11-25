(() => {
  'use strict';

  const assets = new URL('art/', document.currentScript.src);
  const instances = new WeakMap();
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const mix = (a,b,t) => a+(b-a)*t;
  const ease = t => t*t*(3-2*t);
  const phase = (value,start,end) => clamp((value-start)/(end-start));
  const wrapped = (n, period) => ((n%period)+period)%period;

  // Hold a flat middle speed, easing acceleration at the departure and braking
  // at the end. Gait exposure and horizontal travel share this distance clock.
  function travel(u) {
    const ramp = .17;
    const area = x => x*x*x*(1-.5*x);
    if (u<ramp) return ramp*area(u/ramp)/(1-ramp);
    if (u>1-ramp) return 1-ramp*area((1-u)/ramp)/(1-ramp);
    return (u-ramp*.5)/(1-ramp);
  }

  function sprite(el, file, cols, rows, tile) {
    let canvas, context, texture, pending = false, live = true, last = -1;
    function fallback() {
      canvas?.remove();
      context = null;
      el.style.backgroundImage = '';
      last = -1;
    }
    function prepare() {
      if (pending || typeof Image.prototype.decode !== 'function') return;
      pending = true;
      const image = new Image();
      image.decoding = 'async';
      image.src = new URL(file, assets).href;
      image.decode().then(() => {
        if (!live) return;
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = tile;
        canvas.setAttribute('aria-hidden','true');
        context = canvas.getContext('2d');
        if (!context) return;
        context.globalCompositeOperation = 'copy';
        canvas.addEventListener('contextlost', fallback, {once:true});
        texture = image;
        last = -1;
      }).catch(() => {});
    }
    function draw(n) {
      if (n===last) return;
      const col=n%cols, row=Math.floor(n/cols);
      if (context && texture) {
        // The artist registered toes, hands, eyes and tail within each complete tile.
        context.drawImage(texture,col*tile,row*tile,tile,tile,0,0,tile,tile);
        if (!canvas.parentNode) {
          el.append(canvas);
          el.style.backgroundImage='none';
        }
      } else {
        el.style.backgroundPosition=(100*col/(cols-1))+'% '+(rows>1?100*row/(rows-1):0)+'%';
      }
      last=n;
    }
    function destroy() {
      live=false;
      canvas?.removeEventListener('contextlost',fallback);
      canvas?.remove();
      el.style.backgroundImage='';
      el.style.backgroundPosition='';
    }
    return {prepare,draw,destroy};
  }

  function create(scene) {
    if (instances.has(scene)) return instances.get(scene);
    const find = selector => scene.querySelector(selector);
    const sky=find('.sky'), heading=find('.lettering'), ground=find('.pavement'), shop=find('.facade');
    const admirer=find('.admirer'), guard=find('.guard'), button=find('.lemrix-jump'), door=find('.try-door');
    const shadow=guard.querySelector('.actor-shadow'), reply=find('.reply'), status=find('[role=status]');
    const far=find('.ribbon-far'), near=find('.ribbon-near'), foreground=find('.socials');
    const feet=find('.lemrix-poses');
    const palms=document.createElement('span');
    palms.className='lemrix-block-poses';
    palms.hidden=true;
    button.append(palms);
    const actor=sprite(feet,'lemrix-patrol.webp',5,4,256);
    const stopPose=sprite(palms,'lemrix-block.webp',7,1,256);
    const cook=sprite(find('.cookd-poses'),'cookd-hips.webp',6,6,224);
    const systemMotion=matchMedia('(prefers-reduced-motion: reduce)');
    const isReduced=()=>document.documentElement.dataset.motion ?
      document.documentElement.dataset.motion==='reduced' : systemMotion.matches;
    let reduced=isReduced();
    const pointer=matchMedia('(hover:hover) and (pointer:fine)');
    const events=new AbortController(), listen={signal:events.signal};

    const hit=document.createElement('span'), scuff=document.createElement('span');
    hit.className='guard-hit'; scuff.className='patrol-scuff';
    [hit,scuff].forEach(el=>el.setAttribute('aria-hidden','true'));
    button.append(hit); guard.insertBefore(scuff,button);

    const belts=Array.from(scene.querySelectorAll('.belt'),belt=>{
      const original=Array.from(belt.childNodes);
      const group=document.createElement('span');
      group.className='belt-group';
      for (let i=0;i<16;i++) group.append(belt.firstElementChild.cloneNode(true));
      belt.replaceChildren(group,group.cloneNode(true));
      return {belt,original};
    });
    const films=[sky,shop].flatMap(layer=>{
      const img=layer.querySelector('img'), source=layer.querySelector('source');
      if (!img || !source) return [];
      return [{source, originalMedia:source.media}];
    });

    let visible=false, disposed=false, dirty=true, depth=0, cover=0, cameraCover=NaN, cameraDepth=NaN, lastFilm=null;
    let bounds, width=0, height=0, actorSize=1, left=0, lane=1, guardOrigin=0, doorway=.5, titleX=0,titleY=0;
    let px=0,py=0,aimX=0,aimY=0, lastPX=NaN,lastPY=NaN;
    let pos=.52, velocity=0, gait=0, direction=-1, nextEnd=0, action=null, clock=0;
    let squash=0, targetLean=0, lean=0, skid=0, palmPush=0, pressed=false, focused=false;
    let raf=0, lastTick=0, replyTimer=0;

    // One complete 20-pose cycle covers 36 source pixels.
    const strideRatio=36/256;
    function measure() {
      bounds=scene.getBoundingClientRect();
      width=scene.clientWidth; height=scene.clientHeight;
      if (!width || !height) return;
      actorSize=guard.offsetWidth||width*.25;
      const shopWidth=shop.offsetWidth, shopLeft=shop.offsetLeft-shopWidth*.5;
      const center=shopLeft+door.offsetLeft+door.offsetWidth*.5;
      // Reserve the graphic's painted half-width, including its outstretched palms.
      const margin=actorSize*.435+Math.min(width*.025,17);
      const stride=actorSize*strideRatio;
      const space=Math.min(shopWidth*.22,center-margin,width-margin-center);
      const half=Math.max(stride,Math.floor(space/stride)*stride);
      left=clamp(center-half,margin,width-margin);
      const right=clamp(center+half,margin,width-margin);
      lane=Math.max(1,right-left);
      guardOrigin=guard.offsetLeft;
      doorway=clamp((center-left)/lane);
      const roof=shop.offsetTop;
      titleX=clamp(shopLeft+shopWidth*.17-heading.offsetLeft,0,width*.36);
      titleY=clamp(roof-heading.offsetTop+heading.offsetHeight*.14,height*.19,height*.48);
      dirty=false; cameraDepth=NaN;
    }

    const positions=new WeakMap();
    const translate=(el,x,y)=>{
      const value=x.toFixed(2)+'px '+y.toFixed(2)+'px';
      if (positions.get(el)!==value) {el.style.translate=value;positions.set(el,value);}
    };
    function camera() {
      // The HTML title is below the real roof's z-index. Its destination is
      // measured from that roof, including when a phone's type wraps differently.
      const d=reduced?0:depth;
      if (cover===cameraCover && Math.abs(d-cameraDepth)<.0003 && Math.abs(px-lastPX)<.009 && Math.abs(py-lastPY)<.009) return;
      const tuck=ease(phase(cover,0,.9));
      const x=px*Math.min(12,width*.012), y=py*Math.min(7,height*.009);
      translate(sky, -x*.25, height*.045*d-y*.25);
      translate(heading, titleX*tuck+x*.20, titleY*tuck+y*.20);
      translate(shop, x*.53, -height*.035*d+y*.40);
      translate(ground, x*.68, -height*.043*d+y*.45);
      translate(admirer, x*.92, -height*.060*d+y*.70);
      translate(far, x*1.14, -height*.061*d+y*.80);
      translate(near, x*1.65, -height*.095*d+y*1.05);
      translate(foreground, 0, -Math.min(8,height*.009)*d);
      cameraDepth=d; cameraCover=cover; lastPX=px; lastPY=py;
    }

    function walk(to, intercept=false, returning=false) {
      const distance=Math.abs(to-pos), sign=Math.sign(to-pos)||direction;
      direction=sign;
      const cycles=distance*lane/(actorSize*strideRatio);
      const duration=Math.max(.24,cycles*(intercept?.37:returning?.44:.50)+.14);
      action={kind:'walk',from:pos,to,phase:gait,span:sign*cycles*20,time:0,duration,intercept,returning};
      if (!intercept && !returning) nextEnd=to===0?1:0;
    }
    function holdDoor(intercept=false) {
      action={kind:'block',time:0,duration:intercept?1.5:.71};
      pos=doorway; velocity=0; gait=Math.round(gait/20)*20;
    }
    function hideReply() {
      clearTimeout(replyTimer);
      reply.hidden=true;
      status.textContent='';
      scene.classList.remove('blocking');
    }
    function dismiss() {
      hideReply();
      walk(nextEnd);
    }
    function blockDoor() {
      if (!visible || disposed) return;
      reply.hidden=false;
      status.textContent='Lemrix blocks the entrance. Coming soon!';
      scene.classList.add('blocking');
      if (reduced) {
        pos=doorway; gait=0; draw();
        clearTimeout(replyTimer); replyTimer=setTimeout(hideReply,1850);
      } else if (action?.kind==='block') {
        action.duration=action.time+1.3;
      } else if (action?.kind!=='brake' && !action?.intercept) {
        // Bleed off momentum before reversing, even when clicked mid-push.
        action={kind:'brake',time:0,duration:.13,from:pos,speed:velocity,phase:gait};
      }
    }

    function step(dt) {
      if (!action) holdDoor();
      if ((focused||pressed) && !scene.classList.contains('blocking')) return;
      const a=action;
      a.time=Math.min(a.duration,a.time+dt);
      const u=a.time/a.duration, prev=pos;
      if (a.kind!=='block') palmPush=0;
      if (a.kind==='walk') {
        const q=travel(u);
        gait=a.phase+a.span*q;
        pos=mix(a.from,a.to,q);
        skid=0; targetLean=0; squash=0;
        if (u===1) {
          pos=a.to;
          if (a.intercept || a.returning) holdDoor(a.intercept);
          else action={kind:'pivot',time:0,duration:direction<0?.17:.22};
        }
      } else if (a.kind==='pivot') {
        const wind=Math.sin(Math.PI*u);
        targetLean=-direction*.45*wind;
        squash=-.003*wind; skid=.12*(1-u);
        if (u===1) walk(doorway,false,true);
      } else if (a.kind==='brake') {
        pos=clamp(a.from+a.speed*a.duration*(u-u*u*.5));
        gait=a.phase+(pos-a.from)*lane/(actorSize*strideRatio)*20;
        skid=Math.sin(Math.PI*u)*.32; squash=0; targetLean=0;
        if (u===1) {
          if (Math.abs(pos-doorway)<.0001) holdDoor(true);
          else walk(doorway,true);
        }
      } else {
        pos=doorway;
        // Lift the hands together once both feet are planted. Easing from
        // the current pose also keeps a second tap continuous during release.
        const t=a.time, release=1-ease(phase(t,a.duration-.24,a.duration));
        const reach=ease(phase(t,0,.19))*release;
        palmPush=mix(palmPush,reach,1-Math.exp(-dt*35));
        targetLean=0;
        skid=.6*(1-ease(phase(t,0,.18)));
        squash=0;
        if (u===1) dismiss();
      }
      velocity=dt?(pos-prev)/dt:0;
      lean=mix(lean,targetLean,1-Math.exp(-dt*22));
    }

    function draw() {
      if (dirty) measure();
      camera();
      const still=reduced, d=still?0:depth;
      const side=left+pos*lane-guardOrigin;
      translate(guard,side+(still?0:px*Math.min(12,width*.012)*.68),
        -height*.043*d+(still?0:py*Math.min(7,height*.009)*.45));
      const frame=still?0:wrapped(Math.round(gait),20);
      const blocking=still || action?.kind==='block';
      feet.hidden=blocking;
      palms.hidden=!blocking;
      if (blocking) stopPose.draw(still?6:Math.round(palmPush*6));
      else actor.draw(frame);
      cook.draw(still?0:Math.floor(clock/.093)%36);
      const bend=still?0:squash;
      button.style.transform='rotate('+(still?0:lean).toFixed(2)+'deg) scale('+
        (1-bend*.48).toFixed(4)+','+(1+bend).toFixed(4)+')';
      shadow.style.transform='scaleX('+(1-bend*.9).toFixed(3)+')';
      scuff.style.opacity=still?'0':String(skid*.72);
      scuff.style.transform='scaleX('+direction+')';
    }

    function tick(now) {
      raf=0;
      if (!visible || reduced || document.hidden || disposed) return;
      const dt=lastTick?Math.min(.065,Math.max(0,(now-lastTick)/1000)):0;
      lastTick=now; clock+=dt;
      const follow=1-Math.exp(-dt*7);
      px=mix(px,aimX,follow); py=mix(py,aimY,follow);
      step(dt); draw();
      raf=requestAnimationFrame(tick);
    }
    function playback() {
      cancelAnimationFrame(raf); raf=0; lastTick=0;
      const active=visible&&!document.hidden;
      scene.classList.toggle('night-paused',!active);
      const playFilms=active&&!reduced;
      if (lastFilm!==playFilms) {
        // A matching <source> wins over img.src, including on an OS with
        // reduced motion enabled. Make the selected picture follow this scene.
        films.forEach(({source})=>{source.media=playFilms?'not all':'all';});
        lastFilm=playFilms;
      }
      if (!active) return;
      if (reduced) {
        px=py=aimX=aimY=lean=squash=skid=0;
        pos=doorway; gait=0; action=null;
      } else {
        actor.prepare(); stopPose.prepare(); cook.prepare();
        raf=requestAnimationFrame(tick);
      }
      draw();
    }
    function setView(show, progression=0, footerCover=0) {
      if (disposed) return;
      cover=clamp(footerCover);
      depth=clamp(Number.isFinite(progression)?progression:0);
      const next=Boolean(show);
      if (visible===next && lastFilm!==null) {
        if (next && reduced && dirty) draw();
        return;
      }
      visible=next;
      if (!visible) {
        pressed=focused=false; aimX=aimY=0;
        if (!reply.hidden) {hideReply(); action=null;}
      } else {dirty=true; measure();}
      playback();
    }

    door.addEventListener('click',blockDoor,listen);
    button.addEventListener('click',blockDoor,listen);
    button.addEventListener('focus',()=>{focused=button.matches(':focus-visible');},listen);
    button.addEventListener('blur',()=>{focused=false;},listen);
    button.addEventListener('pointerdown',()=>{pressed=true;},listen);
    window.addEventListener('pointerup',()=>{pressed=false;},listen);
    window.addEventListener('pointercancel',()=>{pressed=false;},listen);
    scene.addEventListener('pointermove',e=>{
      if (!visible || reduced || !pointer.matches || e.pointerType==='touch') return;
      const rect=bounds;
      if (!rect) return;
      aimX=clamp((e.clientX-rect.left)/rect.width)*2-1;
      aimY=clamp((e.clientY-rect.top)/rect.height)*2-1;
    },listen);
    scene.addEventListener('pointerleave',()=>{aimX=aimY=0;},listen);
    document.addEventListener('visibilitychange',playback,listen);
    function motionChanged() {
      const next=isReduced();
      if (next===reduced) return;
      reduced=next;
      hideReply(); action=null; cameraDepth=NaN; playback();
    }
    systemMotion.addEventListener('change',motionChanged,listen);
    window.addEventListener('lemrix-motion-change',motionChanged,listen);
    const resized=()=>{dirty=true;if (visible&&reduced) {measure();pos=doorway;draw();}};
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(resized):null;
    [scene,shop,heading,guard].forEach(el=>observer?.observe(el));
    if (!observer) window.addEventListener('resize',resized,listen);
    function destroy() {
      if (disposed) return;
      disposed=true;events.abort();observer?.disconnect();cancelAnimationFrame(raf);hideReply();
      actor.destroy();stopPose.destroy();cook.destroy();palms.remove();feet.hidden=false;hit.remove();scuff.remove();
      belts.forEach(({belt,original})=>belt.replaceChildren(...original));
      films.forEach(({source,originalMedia})=>{source.media=originalMedia;});
      [sky,heading,shop,ground,admirer,far,near,foreground,guard].forEach(el=>{el.style.translate='';});
      button.style.transform='';shadow.style.transform='';scene.classList.remove('night-paused');
      instances.delete(scene);
    }
    const api={setView,destroy};
    instances.set(scene,api);
    return api;
  }
  window.LemrixNight=Object.freeze({create});
})();
