/* Moving feet are registered at 92.2%. Crown poses use the contact with the hair. The path is in photograph space,
   so hair, shoulder and sleeve contacts stay put at every viewport size. */
(() => {
  'use strict';

  const atlas = new URL('assets/aaron-climb.webp', document.currentScript.src).href;
  const cycle = 10.34;
  const feet = .922;
  const columns = 16;
  const rows = 12;
  const yawnTime = .76;
  // The sleepy tail hangs below the hands. Anchor by the actual contact pixel
  // in each 192px tile as his hands settle into the curls and push him up.
  const crownContact = [
    174,175,174,174,174,174,175,174,174,173,171,169,168,164,159,155,
    ...Array(33).fill(150),149,174,174,174,175,175,175,
    174,174,175,175,175,175,175,174
  ];

  // Monotone cubic interpolation preserves a continuous velocity through a key.
  // A zero tangent is reserved for actual turns and held contacts.
  function track(knots) {
    const rates = knots.slice(1).map(([t, value], i) =>
      (value - knots[i][1]) / (t - knots[i][0]));
    const tangents = knots.map((key, i) => {
      if (i === 0) return rates[0];
      if (i === knots.length - 1) return rates[i - 1];
      const left = rates[i - 1], right = rates[i];
      if (left * right <= 0) return 0;
      const a = key[0] - knots[i - 1][0], b = knots[i + 1][0] - key[0];
      return 3 * (a + b) / ((2 * b + a) / left + (2 * a + b) / right);
    });
    return time => {
      if (time <= knots[0][0]) return knots[0][1];
      let i = 0;
      while (i + 2 < knots.length && time > knots[i + 1][0]) i++;
      const [t0, y0] = knots[i], [t1, y1] = knots[i + 1];
      const span = t1 - t0, p = Math.min(1, (time - t0) / span);
      const q = 1 - p;
      return q*q*(1+2*p)*y0 + p*p*(3-2*p)*y1
        + span*p*q*(q*tangents[i] - p*tangents[i + 1]);
    };
  }

  // First grip at the sleeve, then a pull-up onto the shoulder. The second jump
  // has a separate apex and a short recovery on top of the hair.
  const contacts = [
    [0,1.09,.994], [.10,1.09,.994], [.40,1.057,.994], [.77,.963,.994], [1.01,.845,.994],
    [1.15,.835,.994], [1.31,.845,.979], [1.54,.917,.804], [1.74,.922,.674],
    [1.91,.883,.631], [2.10,.869,.589], [2.34,.847,.486], [2.54,.814,.424],
    [2.76,.763,.366], [2.96,.73,.346], [3.17,.725,.344], [3.31,.72,.343],
    [3.52,.642,.107], [3.72,.553,-.024], [3.82,.527,-.030],
    [4.01,.513,.019], [4.16,.509,.023], [4.40,.509,.019], [5.78,.509,.019],
    [6.42,.510,.019], [6.72,.514,.018], [6.92,.535,.013], [7.13,.591,-.012],
    [7.34,.685,.052], [7.58,.759,.206], [7.83,.832,.408], [8.11,.91,.673],
    [8.38,.966,.994], [8.54,.979,.994], [8.69,.987,.994], [8.93,1.020,.994],
    [9.22,1.073,.994], [9.42,1.09,.994], [cycle,1.09,.994]
  ];
  const xAt = track(contacts.map(([time,x]) => [time,x]));
  const yAt = track(contacts.map(([time,,y]) => [time,y]));

  // Each integer is an original drawing. Between consecutive integers lies
  // a newly drawn follow-through, plus six registered subframes for playback.
  const poseAt = track([
    [0,1.65],[.18,.68],[.35,.06],[.53,.76],[.66,.08],[.84,1.1],[1.03,2],
    [1.20,2.43],[1.34,3],[1.61,4],[1.86,5],[2.16,5.72],[2.47,6.68],
    [2.75,7.50],[2.99,8.05],[3.21,8.32],[3.35,8.67],[3.63,9],
    [3.84,9.55],[4.02,10],[4.27,10.85],[4.55,11.45],
    [4.85,12],[5.02,12.025],[5.32,12.28],[5.59,12.59],[5.92,12.81],
    [6.16,13.085],[6.36,13.33],[6.55,13.68],[6.75,14.03],[6.99,14.55],[7.28,15.15],[7.64,16],
    [7.97,16.45],[8.18,17],[8.39,17.75],[8.54,18],[8.70,18.38],
    [8.96,19.08],[9.11,19.60],[9.24,19.0],[9.43,18],[cycle,18]
  ]);
  // A moving split in the sprite puts just the emerging upper body in front
  // of the photo. The lower half can stay behind the photographed sleeve.
  const frontAt = track([
    [0,1],[1.46,1],[1.68,.03],[1.86,0],[2.29,0],[2.60,.43],[2.83,.78],
    [3.00,1],[4.03,1],[4.29,.92],[4.83,.81],[6.34,.81],[6.72,1],[7.18,1],[7.48,0],[7.93,0],[8.16,.13],[8.33,1],[cycle,1]
  ]);
  const leanAt = track([
    [0,-1],[.73,-3],[1.03,5],[1.19,0],[1.43,-7],[1.73,-3],
    [2.00,2],[2.28,-2],[2.68,-5],[3.00,1],[3.24,-3],[3.63,-8],
    [3.88,2],[4.06,4],[4.29,0],[6.58,0],[6.93,8],[7.40,14],
    [7.75,4],[8.20,-7],[8.40,3],[8.68,0],[9.13,5],[9.45,0],[9.65,2],[9.95,-2.5],[cycle,-1]
  ]);
  const springAt = track([
    [0,0],[.79,0],[1.03,-.045],[1.20,-.065],[1.47,.042],[1.86,0],
    [2.85,0],[3.01,-.045],[3.20,0],[3.32,-.058],[3.55,.044],
    [3.88,.02],[4.05,-.076],[4.20,.018],[4.37,0],[6.59,0],
    [6.86,-.052],[7.19,.035],[8.13,.040],[8.38,-.088],[8.51,-.065],
    [8.65,.025],[8.80,0],[9.42,0],[9.60,-.055],[9.74,.025],[9.98,-.015],[cycle,0]
  ]);
  const step = (x,a,b) => {
    const u = Math.max(0,Math.min(1,(x-a)/(b-a)));
    return u*u*(3-2*u);
  };

  const tile = 192;
  let decodedAtlas;

  function getAtlas() {
    if (!decodedAtlas) {
      const image = new Image();
      image.decoding = 'async';
      image.src = atlas;
      decodedAtlas = image.decode().then(() => image).catch(() => null);
    }
    return decodedAtlas;
  }

  // Each visible depth plane uploads one 192px tile only when the drawing
  // changes. Its size and position on screen remain independent compositor transforms.
  function tilePainter(el) {
    let ctx, canvas, previous = -1, usingCanvas = false;
    function useBackground() {
      canvas?.remove();
      ctx = null;
      usingCanvas = false;
      previous = -1;
      el.style.backgroundImage = 'url("'+atlas+'")';
    }
    function paint(frame, texture) {
      if (texture && ctx === undefined) {
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = tile;
        Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',display:'block'});
        ctx = canvas.getContext('2d',{alpha:true});
        if (ctx) {
          ctx.globalCompositeOperation = 'copy';
          canvas.addEventListener('contextlost',useBackground,{once:true});
          previous = -1;
        }
      }
      if (frame === previous) return;
      const col = frame % columns, row = Math.floor(frame / columns);
      if (ctx) {
        ctx.drawImage(texture,col*tile,row*tile,tile,tile,0,0,tile,tile);
        if (!usingCanvas) {
          el.append(canvas);
          el.style.backgroundImage = 'none';
          usingCanvas = true;
        }
      } else {
        el.style.backgroundPosition = (100*col/(columns-1))+'% '+(100*row/(rows-1))+'%';
      }
      previous = frame;
    }
    paint.destroy = () => {
      canvas?.removeEventListener('contextlost',useBackground);
      canvas?.remove();
    };
    return paint;
  }

  function create(front) {
    const originalStyle = front.getAttribute('style');
    const rear = front.cloneNode(false);
    rear.removeAttribute('id');
    rear.setAttribute('aria-hidden','true');
    front.before(rear);
    const layers = [rear,front];
    rear.style.visibility = 'hidden';
    function positionLayers() {
      layers.forEach((el,i) => Object.assign(el.style, {
        left:'0', top:'0', zIndex:i===0?'1':'3', pointerEvents:'none',
        backgroundImage:'url("'+atlas+'")', backgroundSize:'1600% 1200%',
        transformOrigin:'50% 92.2%', willChange:'transform', translate:'none'
      }));
    }
    const painters = layers.map(tilePainter);
    const previousCut = [-1,-1];
    let positioned = false;
    let alive = true, texture = null;
    if (typeof Image.prototype.decode === 'function') {
      getAtlas().then(image => {if (alive) texture = image;});
    }

    function render(seconds,w,h) {
      if (!(w>0 && h>0)) {
        w=front.parentElement.clientWidth; h=front.parentElement.clientHeight;
        if (!(w>0 && h>0)) return;
      }
      if (!positioned) { positionLayers(); positioned=true; }
      const period = cycle+yawnTime;
      const clock = ((seconds%period)+period)%period;
      const t = clock-yawnTime*step(clock,4.74,6.78+yawnTime);
      const pose = 8*poseAt(t);
      const index = pose < 96 ? pose : pose < 112 ? 96+3*(pose-96) : pose+32;
      // Plant both feet beside the sleeve, then turn back into the first
      // stride. The last exposure meets the first one at the same position.
      const frame = t < 9.70 ? Math.max(0,Math.min(191,Math.round(index)))
        : Math.round(16 - 2.8*step(t,9.70,cycle));
      const anchor = (crownContact[frame-80] ?? (feet*tile))/tile;
      const gait = step(t,.08,.26)*(1-step(t,.67,1.03)) + step(t,8.72,9.03)*(1-step(t,9.21,9.44));
      const stride = Math.sin((t-.02)*Math.PI/.155);
      const breathing = step(t,4.28,4.72)*(1-step(t,6.36,6.75));
      const breath = breathing * Math.sin((t-4.40)*Math.PI*1.12);
      const squash = springAt(t) + .013*breath;
      const y = h*(yAt(t)-gait*.014*stride*stride);
      const transform = 'translate3d('+(w*xAt(t))+'px,'+y+'px,0) '+
        'translate(-50%,-'+(anchor*100)+'%) rotate('+(leanAt(t)+gait*stride*1.5)+'deg) '+
        'scale('+(1-squash*.48)+','+(1+squash)+')';
      const split = frontAt(t);
      const frontPortion = split < .001 ? 0 : split > .999 ? 100 : 100*split;
      layers.forEach((el,i) => {
        const cut = i ? 100-frontPortion : frontPortion;
        if (cut !== previousCut[i]) {
          el.style.visibility = cut >= 100 ? 'hidden' : 'visible';
          el.style.clipPath = cut <= 0 || cut >= 100 ? 'none'
            : (i ? 'inset(0 0 '+cut+'% 0)' : 'inset('+cut+'% 0 0 0)');
          previousCut[i] = cut;
        }
        if (cut >= 100) return;
        painters[i](frame,texture);
        el.style.transform = transform;
      });
    }
    render(0,front.parentElement.clientWidth,front.parentElement.clientHeight);
    render.destroy = () => {
      alive = false;
      painters.forEach(paint => paint.destroy());
      rear.remove();
      if (originalStyle === null) front.removeAttribute('style');
      else front.setAttribute('style',originalStyle);
    };
    return render;
  }

  window.LemrixClimb = Object.freeze({create});
})();
