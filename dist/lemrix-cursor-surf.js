/* Lemrix standalone surfer: frame-by-frame sprite state machine, delayed spring follow. */
(() => {
  'use strict';
  const world = document.getElementById('lemrix-world');
  const mover = document.getElementById('lemrix-mover');
  const rig = document.getElementById('lemrix-rig');
  const sprite = document.getElementById('lemrix-cursor-surfer');
  const trail = document.getElementById('lemrix-trail');
  if (!world || !mover || !rig || !sprite || !trail) return;

  // The board is an endlessly replenished raft of overlapping cards, NOT a red surfboard.
  // The 11-card deck always keeps its full shape while the bottom cards peel away.
  const raft = document.createElement('div');
  raft.id = 'lemrix-card-raft';
  raft.setAttribute('aria-hidden', 'true');
  const deckLayer = document.createElement('div');
  deckLayer.id = 'lemrix-card-deck';
  const raftCards = [];
  const DECK_SIZE = 11;
  for (let i = 0; i < DECK_SIZE; i++) {
    const card = document.createElement('span');
    card.className = 'lemrix-raft-card';
    card.style.setProperty('--slot', String(i));
    card.style.setProperty('--phase', String(i * .63));
    deckLayer.appendChild(card);
    raftCards.push(card);
  }
  raft.appendChild(deckLayer);
  rig.appendChild(raft);
  let replenishIndex = 0;
  // A small vector forearm reaches in the travel direction; click extends its index finger.
  const hand = document.createElement('span');
  hand.id = 'lemrix-cursor-hand';
  hand.innerHTML = '<svg viewBox="0 0 94 56" aria-hidden="true"><path class="lemrix-hand-base" d="M5 37 Q20 26 35 22 Q51 12 62 21 Q73 27 67 38 Q55 45 43 38 L17 49 Q7 49 5 37Z"/><path class="lemrix-finger" d="M44 24 Q57 21 69 16 L87 9 Q94 7 94 14 Q94 21 84 25 L65 37 Q49 44 40 35Z"/><path class="lemrix-finger-tip" d="M75 20 L91 13"/></svg>';
  rig.appendChild(hand);
  let handOpacity = 0, pointingUntil = 0, handAngle = 0;
  const clickPoint = () => { pointingUntil = performance.now() + 275; };
  document.addEventListener('pointerdown', clickPoint, {passive: true});
  document.addEventListener('mousedown', clickPoint, {passive: true});


  // The frames animate even when the mouse is completely still.
  // 11 different original Lemrix surfing drawings, with dedicated timings and poses.
  const frames = {
    idle:  [0,1,0,10,0,1,0,9,10,0],
    surf:  [0,1,2,3,4,5,6,7,8,9,10],
    boost: [2,3,4,5,6,5,4,3],
    turn:  [2,3,4,5,6,7,8,7],
    jump:  [3,4,5,6,6,5],
    land:  [7,8,9,10,0]
  };
  const frameMS = { idle: 290, surf: 100, boost: 61, turn: 94, jump: 116, land: 82 };
  const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
  const approach = (value,target,rate,dt) => value + (target-value) * (1-Math.exp(-rate*dt));
  const pos = {x:innerWidth*.5,y:innerHeight*.53};
  const target = {x:pos.x,y:pos.y};
  let velocityX=0, velocityY=0;
  let pointerVX=0, pointerVY=0, speed=0;
  let lastPointerX=target.x, lastPointerY=target.y;
  let lastPointerAt=0, lastPointerEventAt=0, lastInputSpeed=0;
  let lastHeading=null, turnUntil=0, turnCooldown=0, turnSign=1;
  let jumpUntil=0, jumpStart=0, landStart=0, nextJump=0, jumpLift=0;
  let jumpRequested=false, boostUntil=0;
  let state='idle', stateElapsed=0, lastTick=0, currentFrame=-1;
  let bank=0, face=1, actualLift=0, currentSquash=1;
  let prevWorldX=pos.x,prevWorldY=pos.y, lastCardX=pos.x,lastCardY=pos.y;
  const cards=new Set(),stars=new Set();
  let lastBurst=0, lastTrailAt=0;
  mover.dataset.state=state;

  const updateViewport = () => {
    target.x=clamp(target.x,16,innerWidth-16);
    target.y=clamp(target.y,16,innerHeight-16);
    pos.x=clamp(pos.x,16,innerWidth-16);
    pos.y=clamp(pos.y,16,innerHeight-16);
  };
  window.addEventListener('resize',updateViewport,{passive:true});

  const pointerMove = e => {
    if (typeof e.clientX!=='number' || typeof e.clientY!=='number') return;
    const now=performance.now();
    const nx=clamp(e.clientX,5,innerWidth-5);
    const ny=clamp(e.clientY,5,innerHeight-5);
    if (lastPointerEventAt) {
      const dt=clamp((now-lastPointerEventAt)/1000,.009,.075);
      const dx=nx-lastPointerX,dy=ny-lastPointerY;
      const ix=clamp(dx/dt,-3400,3400), iy=clamp(dy/dt,-3400,3400);
      const instantSpeed=Math.hypot(ix,iy);
      pointerVX=pointerVX*.55+ix*.45;
      pointerVY=pointerVY*.55+iy*.45;
      speed=Math.hypot(pointerVX,pointerVY);
      lastInputSpeed=instantSpeed;

      // Going upward makes Lemrix launch. A held upward gesture remains airborne.
      if (dy < -2 && iy < -175 && now>nextJump) jumpRequested=true;
      // A sudden change in travel direction performs a carving turn.
      if (instantSpeed>260 && Math.hypot(dx,dy)>6.5) {
        const heading=Math.atan2(iy,ix);
        if(lastHeading !== null) {
          const da=Math.atan2(Math.sin(heading-lastHeading),Math.cos(heading-lastHeading));
          if(Math.abs(da)>.62 && now>turnCooldown) {
            turnSign=Math.sign(da)||1;
            turnUntil=now+360;
            turnCooldown=now+435;
          }
        }
        lastHeading=heading;
      }

      // A genuinely quick cursor whip, not passive catching up, triggers boost.
      if (instantSpeed>1100 || (speed>740 && instantSpeed>590)) {
        boostUntil=now+250;
      }
    }
    lastPointerAt=now;lastPointerEventAt=now;
    lastPointerX=nx;lastPointerY=ny;
    target.x=nx;target.y=ny;
  };
  document.addEventListener('pointermove',pointerMove,{passive:true});
  document.addEventListener('mousemove',e=>{if(!window.PointerEvent)pointerMove(e);},{passive:true});
  document.addEventListener('touchmove',e=>{
    if(e.touches.length) {
      const t=e.touches[0];
      pointerMove({clientX:t.clientX,clientY:t.clientY});
    }
  },{passive:true});

  function setState(next) {
    if(state===next)return;
    state=next;stateElapsed=0;currentFrame=-1;
    mover.dataset.state=next;
  }
  function beginJump(now) {
    jumpRequested=false;
    jumpStart=now;
    jumpUntil=now+340;
    nextJump=now+680;
    setState('jump');
    makeStar(pos.x-42,pos.y+8);
  }
  function beginLanding(now) {
    landStart=now;
    setState('land');
    if(now-lastBurst>230) {
      lastBurst=now;
      for(let i=0;i<4;i++)makeStar(pos.x+(Math.random()-.5)*90,pos.y+20);
    }
  }
  function makeStar(x,y) {
    if(stars.size>22)return;
    const p=document.createElement('i');
    p.className='lemrix-star';
    p.style.left=x+'px';p.style.top=y+'px';
    p.style.setProperty('--dx',(Math.random()-.5)*80+'px');
    p.style.setProperty('--dy',(-20-Math.random()*60)+'px');
    trail.appendChild(p);stars.add(p);
    setTimeout(()=>{p.remove();stars.delete(p)},800);
  }
  function makeCard(x,y,dx,dy,isBoost=false) {
    if(cards.size>17){const oldest=cards.values().next().value;if(oldest){oldest.remove();cards.delete(oldest);}}
    const el=document.createElement('span');
    el.className='lemrix-card';el.setAttribute('aria-hidden','true');
    const dir=Math.atan2(dy,dx);
    const life=770+Math.random()*280;
    const f=1+(Math.random()-.5)*.22;
    el.style.left=x+'px';el.style.top=y+'px';
    el.style.setProperty('--life',life+'ms');
    el.style.setProperty('--scale',f);
    el.style.setProperty('--r0',(-38+Math.random()*76)+'deg');
    el.style.setProperty('--spin',((Math.random()-.5)*(isBoost?380:250))+'deg');
    el.style.setProperty('--dx',(-dx*.065+Math.cos(dir+Math.PI/2)*(Math.random()-.5)*29)+'px');
    el.style.setProperty('--dy',(-dy*.04+17+Math.random()*34)+'px');
    trail.appendChild(el);cards.add(el);
    const remove=()=>{cards.delete(el);el.remove();};
    el.addEventListener('animationend',remove,{once:true});
    setTimeout(remove,life+150);
  }

  function replenishDeck(now) {
    // Every shed card is replaced from the leading edge of the stack.
    // Card positions never disappear: visually the board remains infinite.
    const item = raftCards[replenishIndex % DECK_SIZE];
    replenishIndex++;
    item.classList.remove('is-restocking');
    // Restart on a different slot every time, avoiding piles that visibly deplete.
    item.offsetWidth;
    item.classList.add('is-restocking');
    setTimeout(() => item.classList.remove('is-restocking'), 330);
  }

  function renderFrame() {
    const clip=frames[state];
    const idx=Math.floor(stateElapsed/frameMS[state])%clip.length;
    const nextFrame=clip[idx];
    if(nextFrame===currentFrame)return;
    currentFrame=nextFrame;
    sprite.style.backgroundPosition=(nextFrame*10)+'% 0%';
    sprite.dataset.frame=String(nextFrame);
  }

  function animate(now) {
    const dt=clamp((now-(lastTick||now))/1000,0,.045);
    lastTick=now;
    const inactive=now-lastPointerAt>165;
    if(inactive) {
      pointerVX*=Math.exp(-dt*13);
      pointerVY*=Math.exp(-dt*13);
      speed=Math.hypot(pointerVX,pointerVY);
      lastHeading=null;
    }
    // Inertial, critically damped spring: distinct delayed follow + smooth stop.
    const omega=9.3;
    const accelX=(target.x-pos.x)*omega*omega-2*omega*velocityX;
    const accelY=(target.y-pos.y)*omega*omega-2*omega*velocityY;
    velocityX+=accelX*dt;
    velocityY+=accelY*dt;
    prevWorldX=pos.x;prevWorldY=pos.y;
    pos.x+=velocityX*dt;pos.y+=velocityY*dt;
    const surfSpeed=Math.hypot(velocityX,velocityY);
    const distance=Math.hypot(target.x-pos.x,target.y-pos.y);

    if(jumpRequested && now>nextJump && (state!=='land'||now-landStart>200)) {
      beginJump(now);
    }
    if(state==='jump') {
      const rising=!inactive && pointerVY < -78;
      if((!rising && now-jumpStart>220) || now-jumpStart>960){
        beginLanding(now);
      }
    } else if(state==='land' && now-landStart<390) {
      // Finish the landing before choosing a normal movement state.
    } else if(now<jumpUntil && state==='jump') {
      // Jump held by the pointer.
    } else if(now<turnUntil && !inactive) {
      // A sudden pivot overrides boost long enough for the carve to be visible.
      setState('turn');
    } else if(now<boostUntil && !inactive) {
      setState('boost');
    } else if((surfSpeed<48 && speed<46 && distance<17) || (!lastPointerAt && distance<5)) {
      setState('idle');
    } else {
      setState('surf');
    }
    stateElapsed+=dt*1000;

    // A soft arc while rising; a compressing spring as the board lands.
    let liftGoal=0;
    if(state==='jump') {
      const t=clamp((now-jumpStart)/310,0,1);
      liftGoal=-52*(1-Math.pow(1-t,3));
    } else if(state==='land') {
      const t=clamp((now-landStart)/390,0,1);
      liftGoal=-52*Math.pow(1-t,2);
    }
    actualLift=approach(actualLift,liftGoal,state==='land'?13:8,dt);
    if(state==='land' && now-landStart<110) liftGoal+=12;

    // Bank aggressively during sharp pivots; pitch forward during boost.
    if(Math.abs(pointerVX)>65)face=pointerVX>=0?1:-1;
    const bankGoal= state==='turn'?turnSign*26:
      state==='boost'? -10:
      state==='jump'? -15:
      state==='land'? 8:
      clamp(pointerVX*.016,-9,9);
    bank=approach(bank,bankGoal,state==='turn'?11:7,dt);
    const squishGoal=state==='boost' ? .84:
      state==='land' && now-landStart<120 ? .82:
      state==='idle'?1: .96;
    currentSquash=approach(currentSquash,squishGoal,13,dt);
    const wave= state==='idle' ? Math.sin(now*.0046)*5.5 :
      state==='surf' ? Math.sin(now*.013)*3.5 :
      state==='boost' ? Math.sin(now*.026)*2.2 : 0;
    const spriteSize=Number.parseFloat(getComputedStyle(mover).width)||185;
    mover.style.transform='translate3d('+(pos.x-spriteSize*.52).toFixed(2)+'px,'+
      (pos.y-spriteSize*.76).toFixed(2)+'px,0)';
    const stretch=state==='boost'?1.12:state==='jump'?1.035:1;
    rig.style.transform='translate3d(0,'+(wave+actualLift).toFixed(2)+'px,0) rotate('+
      bank.toFixed(2)+'deg) scale('+(face*stretch).toFixed(3)+','+currentSquash.toFixed(3)+')';
    renderFrame();

    // The raft constantly flexes and wobbles: the stack is made of loose physical cards.
    const wobbleStrength = state === 'idle' ? 1.1 : state === 'boost' ? 5.1 : state === 'turn' ? 7 : 2.7;
    const wobble = Math.sin(now * .009) * wobbleStrength
      + Math.sin(now * .018 + .6) * wobbleStrength * .25;
    const velocityBank = clamp(velocityX * .012, -4, 4);
    raft.style.transform = 'translate3d(0,' + (Math.sin(now * .012) * (state === 'idle' ? .6 : 1.5)).toFixed(2) +
      'px,0) rotate(' + (wobble + velocityBank).toFixed(2) + 'deg)';
    const cardWobble = state === 'idle' ? .55 : state === 'boost' ? 3.4 : 1.8;
    for (let i = 0; i < raftCards.length; i++) {
      const card = raftCards[i];
      const pulse = Math.sin(now * .012 + i * .78) * cardWobble;
      card.style.setProperty('--jitter', pulse.toFixed(2) + 'deg');
      card.style.setProperty('--lift', (Math.sin(now * .014 + i * 1.13) * (state === 'idle' ? .4 : 1.3)).toFixed(2) + 'px');
    }
    // Reach toward the direction of travel; the hand relaxes at rest.
    const reaching = speed > 46 && !inactive;
    const handTarget = Math.atan2(pointerVY, pointerVX);
    if (reaching) handAngle = face === -1 ? Math.PI - handTarget : handTarget;
    handOpacity = approach(handOpacity, (reaching || now < pointingUntil) ? 1 : 0, 12, dt);
    hand.style.opacity = handOpacity.toFixed(3);
    const click = now < pointingUntil;
    hand.classList.toggle('is-pointing', click);
    hand.style.transform = 'rotate(' + (handAngle * 180 / Math.PI).toFixed(1) + 'deg) scale(' + (click ? 1.18 : reaching ? 1 : .84) + ')';

    // Leave subtle cards along the *actual* lagged surfing path, as the
    // bottom of the card raft physically sheds its cards.
    const moved=Math.hypot(pos.x-lastCardX,pos.y-lastCardY);
    const travelling=surfSpeed>115 && (now-lastPointerAt)<370;
    if(travelling && moved>(state==='boost'?25:42) && now-lastTrailAt>(state==='boost'?53:82)){
      const dx=pos.x-prevWorldX,dy=pos.y-prevWorldY;
      const n=Math.hypot(dx,dy)||1;
      const nx=dx/n,ny=dy/n;
      const originX=pos.x-nx*(spriteSize*.37);
      const originY=pos.y-ny*(spriteSize*.22)+spriteSize*.035;
      makeCard(originX,originY,velocityX,velocityY,state==='boost');
      replenishDeck(now);
      lastCardX=pos.x;lastCardY=pos.y;lastTrailAt=now;
      if(state==='boost' && Math.random()>.92) makeStar(originX-10,originY-6);
    } else if(!travelling){
      lastCardX=pos.x;lastCardY=pos.y;
    }
    requestAnimationFrame(animate);
  }
  sprite.style.backgroundPosition='0% 0%';
  requestAnimationFrame(animate);
})();