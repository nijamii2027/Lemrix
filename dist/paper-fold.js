// Light and displacement use the same crease field and meet at the fingertips.
window.LemrixPaper = function (scene) {
  const print = scene.querySelector('.studio-print');
  const light = scene.querySelector('.crease-light');
  const filter = document.getElementById('sheet-crumple');
  const map = filter.querySelector('feImage');
  const sheetEdges = filter.querySelector('[result="sheet-edges"]');
  const displacement = filter.querySelector('feDisplacementMap');
  const snapshot = window.LemrixSheetSnapshot?.create(print);
  const texture = window.LemrixPaperTexture(scene);
  const rim = scene.querySelector('.paper-rim');
  const lip = rim.querySelector('path');
  const bearings = [-157,-112,-54,132];
  const lengths = [.53,.43,.56,.47];
  const twists = [10,-11,9,-8];
  const pads = bearings.map((_,i) => {
    const pad = document.createElement('span');
    pad.setAttribute('aria-hidden','true');
    Object.assign(pad.style,{
      position:'absolute', left:'0', top:'0', zIndex:'6', pointerEvents:'none',
      transformOrigin:'0 0', opacity:'0', display:'none',
      backgroundImage:'url(assets/finger-fold-light.webp)', backgroundRepeat:'no-repeat',
      backgroundSize:'400% 100%', backgroundPosition:(100*i/3)+'% center'
    });
    rim.before(pad);
    return pad;
  });
  const contactField = [];
  const clamp = x => Math.max(0,Math.min(1,x));
  function contactsAt(points,amount) {
    contactField.length=0;
    for(let i=0;i<pads.length;i++) {
      const tip=points?.[i],pad=pads[i];
      if(!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)){
        pad.style.display='none';
        continue;
      }
      const pressure=clamp(tip.pressure||0);
      const late=clamp((amount-.25)/.75);
      // As the fingertips curl, the pleats rotate, grow out from the contact
      // and deepen, even on a finger that has already stopped travelling.
      const local=pressure*(.43+.57*late);
      const angle=(bearings[i]+twists[i]*(pressure-.65))*Math.PI/180;
      const reach=radius*lengths[i]*(.52+.26*pressure+.22*late);
      contactField.push({x:tip.x,y:tip.y,pressure:local,radius:reach,
        cos:Math.cos(angle),sin:Math.sin(angle),index:i});
      if(local<.002){pad.style.display='none';continue;}
      pad.style.display='block';
      pad.style.opacity=local.toFixed(3);
      pad.style.transform='translate3d('+tip.x+'px,'+tip.y+'px,0) rotate('+angle+
        'rad) scale('+(reach/radius)+') translate(-50%,-50%)';
    }
    return contactField;
  }
  let width, height, centerY, radius, active = false, lastScale = -1;

  let warmSize = '', ready = false, usingTexture = false, lastPressure = -1, destroyed = false;
  function capturePrint() {
    try { return texture.prepare(snapshot.capture()); }
    catch { return false; }
  }
  function warm() {
    if (!snapshot || !width) return;
    const size = width + '/' + height;
    if (size === warmSize) return;
    warmSize = size;
    snapshot.warm().then(ok => {
      if (!ok || destroyed || size !== warmSize) return;
      ready = true;
      if (!active) capturePrint();
    }).catch(() => {});
  }

  function measure(w, h, x, y) {
    width = w;
    height = h;
    centerY = y;
    radius = Math.min(w * .8, h * .88, 665);
    texture.measure(w,h,x,y,radius);
    pads.forEach(pad => {pad.style.width=pad.style.height=(radius*2)+'px';});
    const bounds = { x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius };
    for (const [name, value] of Object.entries(bounds)) map.setAttribute(name, value);
    Object.assign(light.style, {
      left: bounds.x + 'px', top: bounds.y + 'px',
      width: bounds.width + 'px', height: bounds.height + 'px'
    });
    filter.setAttribute('width', w);
    filter.setAttribute('height', h);
    sheetEdges.setAttribute('width', w);
    sheetEdges.setAttribute('height', h);
    rim.setAttribute('viewBox', '0 0 100 ' + h);
  }

  function clear() {
    active = false;
    lastScale = lastPressure = -1;
    usingTexture = false;
    texture.clear();
    scene.classList.remove('paper-held');
    print.style.filter = '';
    pads.forEach(pad=>{pad.style.display='none';});
    light.style.opacity = '0';
    rim.style.opacity = '0';
    scene.style.clipPath = '';
  }

  function draw(amount, travel, tipContacts) {
    if (amount < .004 || travel > .999) {
      if (active) clear();
      return;
    }
    if (!active) {
      active = true;
      scene.classList.add('paper-held');
      usingTexture = ready && capturePrint();
      if (!usingTexture) print.style.filter = 'url(#sheet-crumple)';
    }
    const patches=contactsAt(tipContacts,amount);
    const individual=patches.length>0;
    const bulk=individual ? .69*amount*amount : amount;
    const scale=Math.round(radius*.24*bulk);
    const pressure=Math.round(120*bulk)/120;
    if(usingTexture && (individual || pressure!==lastPressure)){
      texture.render(pressure,patches,amount);
      lastPressure=pressure;
    }
    if (!usingTexture && scale !== lastScale) {
      displacement.setAttribute('scale', scale);
      lastScale = scale;
    }
    light.style.opacity=clamp(individual ? .55*amount**1.22 : amount).toFixed(3);

    // The far edge curls back as the hand pulls. The two curves bound the face and the return.
    const lift = Math.min(width * .039, 46) * amount * Math.min(1, travel * 18);
    if (lift < .1) {
      scene.style.clipPath = '';
      rim.style.opacity = '0';
      return;
    }
    const rows = 24, outer = [], inner = [], points = [];
    for (let i = 0; i <= rows; i++) {
      const y = height * i / rows;
      const dy = (y - centerY) / height;
      const envelope = Math.exp(-dy * dy * 10);
      const ripple = .5 + .5 * Math.cos(14 * dy + travel * 2.65);
      const x = lift * (.04 + envelope * (.27 + .57 * ripple));
      const foldWidth = lift * (.06 + envelope * (.25 + .78 * (1 - ripple)));
      outer.push(x.toFixed(2) + ',' + y.toFixed(2));
      inner.push((x + foldWidth).toFixed(2) + ',' + y.toFixed(2));
      points.push(x.toFixed(2) + 'px ' + y.toFixed(2) + 'px');
    }
    scene.style.clipPath = 'polygon(' + points.join(',') + ', 100% 100%, 100% 0)';
    lip.setAttribute('d', 'M' + outer.join(' L') + ' L' + inner.reverse().join(' L') + ' Z');
    rim.style.opacity = Math.min(.91, lift / 14).toFixed(3);
  }
  return {measure, draw, warm, destroy(){destroyed=true;clear();texture.destroy();snapshot?.destroy();pads.forEach(pad=>pad.remove());}};
};
