// The hands and the head sit on opposite sides of the existing wordmark.
// Coordinates follow the E and R in the original 502 × 329 Lemrix artwork.
(() => {
  'use strict';
  const logo = document.querySelector('.mast .wordmark');
  if (!logo || logo.querySelector('.shop-logo-peek')) return;
  const motion = window.LemrixMotion || matchMedia('(prefers-reduced-motion: reduce)');
  const layer = document.createElement('span');
  layer.className = 'shop-logo-peek';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const width = 264, height = 198, sill = 140;
  const head = document.createElement('canvas'), hands = document.createElement('canvas');
  head.className = 'peek-head';
  hands.className = 'peek-hands';
  const face = head.getContext('2d'), grip = hands.getContext('2d');
  if (!face || !grip) return;
  layer.append(head, hands);
  logo.append(layer);

  const ink = '#102940', blue = '#aacff7';
  function finish(ctx, fill, weight = 7) {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = weight;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.stroke();
  }
  function eye(ctx, x, y, width, angle, pose) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineCap = 'round';
    if (pose.blink > .91) {
      ctx.beginPath();
      ctx.moveTo(-width, 1);
      ctx.quadraticCurveTo(0, 7, width, -1);
      ctx.lineWidth = 5;
      ctx.strokeStyle = ink;
      ctx.stroke();
    } else {
      ctx.scale(1, 1 - pose.blink * .9);
      ctx.beginPath();
      ctx.moveTo(-width, 0);
      ctx.bezierCurveTo(-width * .48,-11, width * .4,-10, width,0);
      ctx.bezierCurveTo(width * .57,9, -width * .52,11, -width,0);
      ctx.closePath();
      finish(ctx, '#eff6fa', 6);
      ctx.clip();
      ctx.fillStyle = ink;
      ctx.fillRect(-5 + pose.look * 6, -11, 12, 23);
    }
    ctx.restore();
  }
  function paintHead(ctx, pose) {
    if (pose.rise <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, sill + 3);
    ctx.clip();
    ctx.translate(133 + pose.look * 5, 309 - pose.rise * 151);
    ctx.rotate((6 + pose.look * 4 - pose.pull * 4) * Math.PI / 180);
    ctx.scale(.66 * (1 - pose.pull * .025), .66 * (1 + pose.pull * .035));
    // Trace the shop mascot's tilted crown, almond eyes and crooked smile.
    ctx.translate(-287, -234);
    ctx.beginPath();
    ctx.moveTo(217, 208);
    ctx.bezierCurveTo(183,190, 156,171, 157,128);
    ctx.bezierCurveTo(159,67, 221,10, 291,10);
    ctx.bezierCurveTo(349,7, 406,52, 414,111);
    ctx.bezierCurveTo(424,169, 374,221, 312,235);
    ctx.quadraticCurveTo(329,251, 334,280);
    ctx.lineTo(189, 280);
    ctx.quadraticCurveTo(198,230, 217,208);
    ctx.closePath();
    const tone = ctx.createLinearGradient(208, 22, 337, 252);
    tone.addColorStop(0, '#b3d7f9');
    tone.addColorStop(.55, blue);
    tone.addColorStop(1, '#9fc4ec');
    finish(ctx, tone, 8);
    eye(ctx, 267, 114, 27.5, -.37, pose);
    eye(ctx, 369, 84, 20, -.39, pose);
    ctx.fillStyle = ink;
    for (const [x,y] of [[325,118],[343,112]]) {
      ctx.beginPath();ctx.arc(x, y, 2.8, 0, 2 * Math.PI);ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(284, 149);
    ctx.bezierCurveTo(320,159, 371,137, 385,116);
    ctx.lineWidth = 6.8;
    ctx.stroke();
    ctx.restore();
  }
  function paintHand(ctx, anchor, side, reach, curl, arc) {
    if (reach <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, sill + 17 * curl);
    ctx.clip();
    ctx.translate(anchor - side * 4 * (1-reach), sill + 28 - 31 * reach - 8 * arc);
    ctx.scale(side, 1);
    ctx.rotate((1 - curl) * -.35);
    // The same three rounded fingers as the original drawing turn over
    // the type. Their knuckles stay planted while the face looks around.
    const tip = 3 + curl * 11;
    ctx.beginPath();
    ctx.moveTo(-20, 3);
    ctx.bezierCurveTo(-23,-6, -16,-17, -9,-17);
    ctx.bezierCurveTo(-5,-23, 3,-23, 8,-19);
    ctx.bezierCurveTo(17,-20, 22,-12, 23,-3);
    ctx.bezierCurveTo(27,3, 25,tip, 19,tip);
    ctx.bezierCurveTo(15,tip+2, 12,tip-1, 11,tip-5);
    ctx.bezierCurveTo(11,tip+4, 1,tip+6, -3,tip-1);
    ctx.bezierCurveTo(-6,tip+4, -14,tip+3, -15,tip-3);
    ctx.quadraticCurveTo(-22,tip-1, -20,3);
    ctx.closePath();
    finish(ctx, blue, 5.8);
    ctx.restore();
  }

  const step = (t, a, b) => {
    const n = Math.min(1, Math.max(0, (t-a)/(b-a)));
    return n*n*n*(n*(n*6-15)+10);
  };
  const beat = (t, a, b, c) => step(t,a,b) - step(t,b,c);
  const count = 144;
  function choreography() {
    const leadingSide = Math.random() < .5 ? -1 : 1;
    const gaze = Math.random() < .5 ? -1 : 1;
    const breakAt = .51 + .035 * Math.random();
    const shortHold = .68 + .045 * Math.random();
    return Array.from({length:count}, (_,i) => {
      const t = i / (count-1);
      const turn = step(t,.44,.58) - step(t,shortHold,.81);
      const pose = {
        rise:step(t,.17,.45) + .026*beat(t,.39,.46,.53) - step(t,shortHold,.875),
        pull:beat(t,.20,.34,.47) - .42*beat(t,shortHold,.80,.875),
        look:gaze * (turn - .24*beat(t,.58,.67,.76)),
        blink:beat(t,breakAt,breakAt+.018,breakAt+.047)
      };
      for (const side of ['left','right']) {
        const late = (side === 'right') === (leadingSide === -1) ? .052 : 0;
        const local = t - late;
        pose[side+'Reach'] = step(local,0,.153) - step(local,.856,.948);
        pose[side+'Curl'] = step(local,.089,.193) - step(local,.817,.911);
        pose[side+'Arc'] = beat(local,.043,.100,.162) + .7*beat(local,.838,.881,.946);
      }
      return pose;
    });
  }
  function prepareCanvas(canvas, ctx) {
    const bounds = canvas.getBoundingClientRect();
    const density = Math.min(4, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.ceil(bounds.width * density));
    const h = Math.max(1, Math.ceil(bounds.height * density));
    if (canvas.width !== w || canvas.height !== h) {canvas.width=w;canvas.height=h;}
    ctx.setTransform(w/width,0,0,h/height,0,0);
  }
  function paint(pose) {
    face.clearRect(0,0,width,height);
    grip.clearRect(0,0,width,height);
    paintHead(face,pose);
    paintHand(grip,56,-1,pose.leftReach,pose.leftCurl,pose.leftArc);
    paintHand(grip,207,1,pose.rightReach,pose.rightCurl,pose.rightArc);
  }

  let timer=0, frame=0, sequence, started, duration, inPage=true;
  const current={};
  const allowed=()=>inPage && !document.hidden && !motion.matches;
  function clear() {
    clearTimeout(timer);cancelAnimationFrame(frame);
    timer=frame=0;sequence=null;layer.hidden=true;
  }
  function schedule() {
    if (allowed() && !timer && !sequence) timer=setTimeout(perform, 5000+Math.random()*35000);
  }
  function tick(now) {
    if (!allowed()) {clear();return;}
    started ??= now;
    const progress=(now-started)/duration;
    if(progress>=1){clear();schedule();return;}
    const index=progress*(count-1), from=Math.floor(index), mix=index-from;
    const a=sequence[from], b=sequence[Math.min(count-1,from+1)];
    for (const key of Object.keys(a)) current[key]=a[key]+(b[key]-a[key])*mix;
    paint(current);
    frame=requestAnimationFrame(tick);
  }
  function perform() {
    timer=0;
    if(!allowed())return;
    sequence=choreography();
    duration=2550+Math.random()*1650;
    started=null;
    layer.hidden=false;
    prepareCanvas(head,face);prepareCanvas(hands,grip);
    paint(sequence[0]);
    frame=requestAnimationFrame(tick);
  }
  function sync() {if(allowed())schedule();else clear();}
  function resize() {
    if(!sequence)return;
    prepareCanvas(head,face);prepareCanvas(hands,grip);
  }
  window.addEventListener('resize',resize,{passive:true});
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('lemrix-motion-change',sync);
  window.addEventListener('pagehide',()=>{inPage=false;clear();});
  window.addEventListener('pageshow',()=>{inPage=true;sync();});
  schedule();
})();
