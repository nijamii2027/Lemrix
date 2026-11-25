(() => {
  'use strict';
  let instance = 0;
  const ns = 'http://www.w3.org/2000/svg';
  const unit = n => Math.max(0,Math.min(1,n));
  const phase = (p,a,b) => unit((p-a)/(b-a));
  const smooth = t => t*t*(3-2*t);
  const lerp = (a,b,t) => a+(b-a)*t;
  function svgNode(tag,attrs,parent){
    const el=document.createElementNS(ns,tag);
    for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
    parent.append(el);
    return el;
  }

  window.createLemrixTapeReveal=function createLemrixTapeReveal(overlay,night){
    const serial='lemrix-tear-'+(++instance);
    const ribbon=night.querySelector('.ribbon-near');
    const reduced=window.LemrixMotion || matchMedia('(prefers-reduced-motion: reduce)');
    const originalClip=night.style.clipPath;
    const svg=svgNode('svg',{'aria-hidden':'true',preserveAspectRatio:'none'},overlay);
    const defs=svgNode('defs',{},svg);
    const guide=svgNode('path',{id:serial+'-path'},defs);
    const clip=svgNode('clipPath',{id:serial+'-clip'},defs);
    const silhouette=svgNode('path',{},clip);
    const sheen=svgNode('linearGradient',{id:serial+'-light',x1:0,x2:1,y1:0,y2:0,gradientUnits:'objectBoundingBox'},defs);
    for(const [offset,color,opacity] of [[0,'#613724',.15],[.25,'#ffed91',.34],[.44,'#efad36',.24],[.62,'#fff0b7',.6],[.77,'#c37838',.26],[1,'#ffe17a',.16]]){
      svgNode('stop',{offset,'stop-color':color,'stop-opacity':opacity},sheen);
    }
    const shadow=svgNode('path',{class:'tear-cast'},svg);
    const face=svgNode('path',{class:'tear-ink'},svg);
    const surface=svgNode('g',{'clip-path':'url(#'+serial+'-clip)'},svg);
    const bendLight=svgNode('path',{fill:'url(#'+serial+'-light)'},surface);
    const topEdge=svgNode('path',{class:'tear-glint'},surface);
    const text=svgNode('text',{class:'tear-print','xml:space':'preserve'},surface);
    const lettering=svgNode('textPath',{href:'#'+serial+'-path',startOffset:'0'},text);
    lettering.textContent='COMING SOON  ››      '.repeat(36);
    let width=0,height=0,railY=0,railH=0,fontSize=0,railAngle=0,last=0,disposed=false;
    function measure(){
      width=overlay.clientWidth;
      height=overlay.clientHeight;
      const style=ribbon&&getComputedStyle(ribbon);
      railH=ribbon&&ribbon.offsetHeight||Math.min(49,Math.max(24,height*.042));
      railY=ribbon&&ribbon.offsetTop?ribbon.offsetTop+railH/2:height*.8;
      fontSize=style?parseFloat(style.fontSize):railH*.63;
      railAngle=style?parseFloat(style.getPropertyValue('--slant')):-5;
      if(!Number.isFinite(railAngle))railAngle=-5;
      svg.setAttribute('viewBox','0 0 '+width+' '+height);
      draw(last);
    }
    const px=v=>Number(v.toFixed(1));
    function draw(progress){
      const p=unit(progress);last=p;
      if(disposed||!width||!height)return;
      const fewer=reduced.matches;
      if(p===0||p===1||fewer){
        night.style.clipPath=(fewer?p>=.5:p===1)?originalClip:'inset(0 0 100% 0)';
        overlay.style.visibility='hidden';
        night.classList.remove('tape-is-snapped','tape-is-returning');
        night.style.removeProperty('--tape-return-y');
        night.style.removeProperty('--tape-return-tilt');
        return;
      }
      // The full-width leading edge leaves the frame before the physical café belt returns.
      const revealEnd=.755;
      if(p>=revealEnd){
        night.style.clipPath=originalClip;
        overlay.style.visibility='hidden';
        night.classList.remove('tape-is-snapped');
        night.classList.add('tape-is-returning');
        const q=phase(p,revealEnd,1);
        const slantExtent=Math.abs(Math.tan(railAngle*Math.PI/180))*width*.52;
        const lift=(height-railY+slantExtent+railH*1.4);
        const remaining=1-smooth(Math.min(1,q/.72));
        const vibration=13*Math.sin((q-.51)*Math.PI*4)*Math.sin(Math.PI*phase(q,.51,1))*(1-q);
        night.style.setProperty('--tape-return-y',px(lift*remaining-vibration)+'px');
        night.style.setProperty('--tape-return-tilt',px(.68*Math.sin(Math.PI*q*2)*(1-q))+'deg');
        return;
      }
      night.classList.add('tape-is-snapped');
      night.classList.remove('tape-is-returning');
      overlay.style.visibility='visible';
      const pad=Math.max(52,width*.075);
      const unspool=1-Math.pow(1-phase(p,0,.265),2);
      const tip=lerp(-pad,width+pad,unspool);
      const sweep=smooth(phase(p,.165,revealEnd));
      const bend=Math.sin(Math.PI*phase(p,0,.70));
      const heightHalf=railH*(.55+.24*bend);
      const slope=lerp(-.20,Math.tan(railAngle*Math.PI/180),sweep);
      const origin=lerp(-height*.035,height+width*.13+railH,sweep);
      const count=32,center=[],upper=[],lower=[],baseline=[];
      for(let i=0;i<=count;i++){
        const u=i/count;
        const x=lerp(-pad,tip,u);
        // A wave propagates from the leading tip and dissipates behind the tug.
        const wave=Math.sin(u*Math.PI*1.65-p*11)*Math.sin(u*Math.PI)*bend;
        const curve=origin+(x-width*.5)*slope+wave*Math.min(height*.13,95)+bend*height*.063;
        const thickness=heightHalf*(1+.14*Math.cos(u*6-p*9)*bend);
        center.push([px(x),px(curve)]);
        upper.push([px(x),px(curve-thickness)]);
        lower.push([px(x),px(curve+thickness)]);
        baseline.push([px(x),px(curve+fontSize*.34)]);
      }
      const toPath=pts=>'M'+pts.map(point=>point.join(',')).join('L');
      const shape=toPath(upper)+'L'+lower.slice().reverse().map(v=>v.join(',')).join('L')+'Z';
      shadow.setAttribute('d',shape);
      shadow.setAttribute('transform','translate(0,'+px(3+bend*6)+')');
      face.setAttribute('d',shape);
      silhouette.setAttribute('d',shape);
      bendLight.setAttribute('d',shape);
      topEdge.setAttribute('d',toPath(upper));
      topEdge.setAttribute('transform','translate(0,2)');
      guide.setAttribute('d',toPath(baseline));
      text.setAttribute('font-size',px(fontSize*(1+.17*bend)));
      lettering.setAttribute('startOffset',px(-12-p*136));
      // Clip the café to the same material edge used for the printed tape.
      const polygon=[[-pad,-height],[tip,-height],...center.slice().reverse()];
      night.style.clipPath='polygon('+polygon.map(([x,y])=>px(x)+'px '+px(y)+'px').join(',')+')';
    }
    const observer=window.ResizeObserver && new ResizeObserver(measure);
    if(observer)observer.observe(overlay);else window.addEventListener('resize',measure);
    window.addEventListener('lemrix-motion-change',measure);
    measure();
    return {draw,destroy(){
      disposed=true;observer?.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('lemrix-motion-change',measure);
      svg.remove();overlay.style.visibility='';night.style.clipPath=originalClip;
      night.classList.remove('tape-is-snapped','tape-is-returning');
      night.style.removeProperty('--tape-return-y');night.style.removeProperty('--tape-return-tilt');
    }};
  };
})();
