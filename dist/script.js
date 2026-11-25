(() => {
  'use strict';
  const select = selector => document.querySelector(selector);
  const story = select('.story');
  const stage = select('.stage');
  const hero = select('.green-scene');
  const studio = select('.tv-scene');
  const about = select('.about');
  const night = select('.night');
  // Optional artwork can finish loading independently of the scroll and card clocks.
  let patrol;
  function initPatrol(){if(!patrol && window.LemrixNight)patrol=window.LemrixNight.create(night);}
  initPatrol();
  const video = select('.crt video');
  const toggle = select('.play-toggle');
  const reduced = window.LemrixMotion || matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = reduced.matches, videoChoiceMade=false;
  let videoInView = false;
  let streamReady = true;
  let playRequest = 0;

  function playback() {
    const play = streamReady && videoInView && !document.hidden && !userPaused;
    const ticket = ++playRequest;
    if (play && video.paused) {
      video.play().catch(() => {
        if (ticket === playRequest) paintControl();
      });
    } else if (!play) video.pause();
  }
  function paintControl() {
    toggle.classList.toggle('playing', !video.paused);
    toggle.setAttribute('aria-label', video.paused ? 'Play montage' : 'Pause montage');
  }
  video.addEventListener('play', paintControl);
  video.addEventListener('pause', paintControl);
  toggle.hidden = false;
  toggle.addEventListener('click', () => { videoChoiceMade=true;userPaused = !video.paused; playback(); });
  if(window.IntersectionObserver)new IntersectionObserver(([entry]) => {
    videoInView = entry.isIntersecting;
    playback();
  },{threshold:.2}).observe(video);else videoInView=true;
  document.addEventListener('visibilitychange', playback);

  const clamp = n => Math.max(0,Math.min(1,n));
  const lerp = (a,b,n) => a + (b-a)*n;
  const phase = (time,start,end) => clamp((time-start)/(end-start));
  const smooth = n => n*n*(3-2*n);
  const easeOut = n => 1-(1-n)**3;
  // Without the pinned stage (including reduced motion), the storefront is an ordinary section.
  const watchNaturalScene = () => {
    if(!window.IntersectionObserver){patrol?.setView(true,0);return ()=>patrol?.setView(false,0);}
    const observer = new IntersectionObserver(([entry])=>patrol?.setView(entry.isIntersecting,0));
    observer.observe(night);
    return ()=>observer.disconnect();
  };
  const {gsap,Lenis} = window;
  function startStory() {
    document.documentElement.classList.add('has-motion');
    const actor = select('.fall-actor'), idle = select('.reclining');
    const crt = select('.crt'), watcher = select('.watcher'), flat = select('.flattened');
    const smoke = select('.impact'), puffs = [...smoke.children], skid = select('.briffits');
    const hand = select('.grabbing-hand'), runner = select('.runner'), person = select('.person');
    const heroCopy = hero.querySelector('.hero-copy'), copy = studio.querySelector('.tv-copy');
    const shadow = select('.tv-floor');
    const tvArt=select('.tv-artwork'), sky=select('.daylight'), halo=select('.portrait-circle');
    const pointer={x:0,y:0}, drift={x:0,y:0};
    const aimAtPointer=event=>{
      if(event.pointerType!=='mouse')return;
      pointer.x=2*event.clientX/w-1;pointer.y=2*event.clientY/h-1;
    };
    const centrePointer=()=>{pointer.x=0;pointer.y=0;};
    stage.addEventListener('pointermove',aimAtPointer);
    stage.addEventListener('pointerleave',centrePointer);
    const nav = [...document.querySelectorAll('.nav-shell nav a[href^="#"]')];
    const bar = select('.bar'), footer = select('.footer');
    const aboutShell = about.querySelector('.about-shell');
    const blurKernel = select('#arrival-streak feGaussianBlur');
    const panels = [studio,about,night];
    const anchors = [select('.stream-anchor'),select('.about-anchor'),select('.night-anchor')];
    panels.forEach((panel,i) => {
      const id = panel.id;
      panel.removeAttribute('id');
      anchors[i].id = id;
    });
    const lenis = Lenis && window.ResizeObserver && new Lenis({anchors:true,lerp:.09,syncTouch:false});

    const fall = {time:0}, pull = {time:0};
    const fallEnd = 4.18, pullEnd = 2.54, revealEnd = 1.64;
    const storyClock = window.LemrixStoryClock(fallEnd,pullEnd,revealEnd);
    const tape = window.createLemrixTapeReveal?.(select('.tape-reveal'),night);
    const claw = window.createLemrixClaw?.(hand);
    let palm;
    const paper = window.LemrixPaper && window.LemrixPaperTexture ? window.LemrixPaper(studio) : null;
    const drawRunner = window.LemrixClimb?.create(runner);
    let destination = -1, w, h, size, home, seat, landing, art, photoW, photoH;
    let lastPose = -1, lastGrip = -1, lastBlur = -1, runnerTime = 0, displayedCover = -1;
    let scrollDepth = 0, lastReveal = -1, nightDepth = 0;
    let lastNightView = false, lastNightDepth = -1, lastNightCover = -1, lastNav = null, screenHeight = 0;
    let idleTime=0, idleAtLift=0, watchTime=0;
    const sleepLoop=select('.sleep-loop'), watchLoop=select('.watch-loop');
    const visited = [actor,hero,idle,crt,watcher,flat,smoke,...puffs,skid,studio,about,hand,runner,copy,shadow,heroCopy];
    const visible = (el, show) => {el.style.visibility = show ? 'visible':'hidden';};
    const move = (el,x,y,extra='') => {el.style.transform = 'translate3d('+x+'px,'+y+'px,0) '+extra;};
    // Crop only the displayed tile. Moving the full, scaled atlas as a CSS
    // background otherwise repaints millions of transparent pixels per pose.
    const sheets=new Map([[sleepLoop,'assets/sleep-poses.webp'],[watchLoop,'assets/watcher-poses.webp'],[actor,'assets/cinema.webp']]);
    const spriteFrames=new WeakMap(), surfaces=new Map();
    let live=true;
    function prepareSprite(el,url,cols,rows) {
      const image=new Image();
      image.decoding='async';
      image.src=url;
      const surface={image,ctx:null};
      surfaces.set(el,surface);
      if (!image.decode) return;
      image.decode().then(()=>{
        if (!live) return;
        const canvas=document.createElement('canvas');
        canvas.width=image.naturalWidth/cols;
        canvas.height=image.naturalHeight/rows;
        const ctx=canvas.getContext('2d');
        if(!ctx)return;
        canvas.setAttribute('aria-hidden','true');
        ctx.globalCompositeOperation='copy';
        surface.ctx=ctx;
        canvas.addEventListener('contextlost',()=>{
          surface.ctx=null;canvas.remove();el.style.backgroundImage='';
          spriteFrames.delete(el);
        },{once:true});
        el.append(canvas);
        el.style.backgroundImage='none';
        const current=spriteFrames.get(el)??0;
        spriteFrames.delete(el);
        sprite(el,current,cols,rows);
      }).catch(()=>{});
    }
    function sprite(el,n,cols,rows) {
      if(spriteFrames.get(el)===n)return;
      spriteFrames.set(el,n);
      if(sheets.has(el)&&!surfaces.has(el))prepareSprite(el,sheets.get(el),cols,rows);
      const surface=surfaces.get(el);
      const col=n%cols,row=Math.floor(n/cols);
      if(surface?.ctx) {
        const {ctx,image}=surface;
        const {width,height}=ctx.canvas;
        ctx.drawImage(image,col*width,row*height,width,height,0,0,width,height);
      } else {
        el.style.backgroundPosition=(col*100/(cols-1))+'% '+(rows===1?0:row*100/(rows-1))+'%';
      }
    }
    // Use layout coordinates so a resize midway through a tween never measures a transformed sprite.
    function box(el) {
      let x=0,y=0;
      for(let node=el;node&&node!==stage;node=node.offsetParent){x+=node.offsetLeft;y+=node.offsetTop;}
      return {x,y,w:el.offsetWidth,h:el.offsetHeight};
    }
    function measure() {
      w=stage.clientWidth;h=stage.clientHeight;size=idle.offsetWidth;

      home=box(idle);art=box(select('.tv-artwork'));
      const screen=box(crt), end=box(watcher);
      screenHeight=screen.h;
      landing={x:screen.x+screen.w*.56, y:screen.y+screen.h*.886};
      seat={x:end.x+end.w/2,y:end.y+end.h};
      photoW=person.offsetWidth;photoH=person.offsetHeight;
      palm = box(hand);
      const anchor = claw?.anchor || {x:.095,y:.49};
      hand.style.transformOrigin = (anchor.x*100)+'% '+(anchor.y*100)+'%';
      paper?.measure(w,h,palm.x+palm.w*anchor.x,palm.y+palm.h*anchor.y);
      move(flat,landing.x-art.x-size/2,landing.y-art.y-size*.9625);
      move(smoke,landing.x,landing.y);
      move(skid,seat.x+size*.35,seat.y-size*.11);
    }
    function interactionState() {
      const inAbout=pull.time>pullEnd*.94;
      const inStudio=fall.time>fallEnd-.12 && pull.time<.22;
      hero.inert=fall.time>.16 || pull.time>0;
      studio.inert=!inStudio;
      about.inert=!inAbout || storyClock.reveal>.08;
      night.inert=storyClock.reveal<revealEnd*.97 || displayedCover>=.98;
      if(streamReady!==inStudio){streamReady=inStudio;playback();}
    }

    function drawFall() {
      const t=fall.time;
      const camera=smooth(phase(t,.26,2.0));
      if(t>0 && t<.27){
        const distance=idleAtLift>60?120-idleAtLift:-idleAtLift;
        const neutral=Math.round(idleAtLift+distance*smooth(phase(t,0,.25)))%120;
        sprite(sleepLoop,neutral,12,10);
      }
      move(hero,0,-h*1.06*camera);
      visible(hero,t<2.02);
      idle.style.opacity=t<.26?1:0;
      const drop=phase(t,1.44,2.17);
      const squash=Math.sin(Math.PI*phase(t,2.17,2.32))*.048;
      move(crt,0,-(1-drop**3)*(h+screenHeight*.6),'scale('+(1+squash)+','+(1-squash)+')');
      shadow.style.opacity=phase(t,1.55,2.17);
      copy.style.opacity=phase(t,1.68,2.34);
      copy.style.translate='0 '+(1-easeOut(phase(t,1.68,2.34)))*48+'px';
      const dash=t>=2.51;
      const show=t>=.26 && (t<2.168 || (dash && t<fallEnd-.035));
      visible(actor,show);
      visible(flat,t>=2.13 && t<2.33);
      visible(watcher,t>=fallEnd-.035);
      if(t>=fallEnd-.035) paper?.warm();
      if(t<fallEnd){watchTime=0;sprite(watchLoop,0,9,6);}
      if(show){
        let x,y,angle=0,sx=1,sy=1,n;
        if(!dash){
          if(t<.89)n=Math.round(16*phase(t,.26,.87));
          else if(t<2.06)n=17+Math.round(16*phase(t,.89,2.02));
          else n=34+Math.round(3*phase(t,2.06,2.168));
          const travel=smooth(phase(t,.26,2.02));
          x=lerp(home.x+size/2,landing.x,travel)+Math.sin(Math.PI*travel)*size*.2;
          y=lerp(home.y+size*.9625,landing.y,travel)-Math.sin(Math.PI*travel)*h*.17;
          angle=Math.sin(travel*2*Math.PI)*14;
          const catchBeat=Math.sin(Math.PI*phase(t,1.77,2.0));
          sx+=catchBeat*.06;sy-=catchBeat*.09;
        }else{
          const d=phase(t,2.51,3.07), brake=phase(t,3.07,3.40);
          x=d<1?lerp(w+size,seat.x-size*.36,d):lerp(seat.x-size*.36,seat.x,easeOut(brake));
          y=seat.y-Math.abs(Math.sin(3*Math.PI*d))*size*.085;
          if(d<1)n=38+Math.floor(d*6)%3;
          else if(t<3.24)n=41;
          else n=42+Math.round(18*smooth(phase(t,3.24,4.12)));
          angle=d<1?-6:8*Math.sin(brake*Math.PI);
        }
        if(n!==lastPose){sprite(actor,n,8,8);lastPose=n;}
        move(actor,x-size/2,y-size*.9625,'rotate('+angle+'deg) scale('+sx+','+sy+')');
        actor.style.opacity=1;
      }
      const burst=phase(t,2.14,2.72);
      visible(smoke,burst>0&&burst<1);
      if(burst>0&&burst<1)puffs.forEach((p,i)=>{
        const side=i%2?1:-1;
        move(p,side*(.16+(i%4)*.17)*size*easeOut(burst),
          -(.12+i%3*.18)*size*Math.sin(burst*Math.PI*.9),'scale('+(.25+burst*(.7+i%3*.22))+')');
        p.style.opacity=1-smooth(phase(burst,.5,1));
      });
      visible(skid,t>3.04 && t<3.43);
      skid.style.opacity=1-phase(t,3.15,3.43);
      const shake=Math.sin((t-2.15)*90)*(1-phase(t,2.15,2.44));
      stage.style.translate=t>2.15&&t<2.44?4*shake+'px '+2*shake+'px':'';
      interactionState();
    }
    function drawPull() {
      const t=pull.time;
      const extend=easeOut(phase(t,0,.61));
      const creep=phase(t,.81,1.63), rip=phase(t,1.51,2.52);
      const tug=.12*smooth(creep)+.88*smooth(rip);
      // The tips reach the sheet first. The wrist keeps curling as the sheet moves.
      const first=smooth(phase(t,.34,.88)), gather=smooth(phase(t,.65,1.46));
      const tighten=smooth(phase(t,1.12,2.03));
      const close=.24*first+.47*gather+.29*tighten;
      const pressure=.21*smooth(phase(t,.47,.96))+.36*gather+.43*tighten;
      const travel=w*tug;
      const wrist=-9*(1-extend)-4.5*Math.sin(Math.PI*phase(t,.47,1.72))+3.2*tug;
      const reach=(1-extend)*w*.96;
      const press=palm.h*(.061*Math.sin(Math.PI*phase(t,.42,1.96))-.12*(1-extend));
      if(claw) claw.draw(close);
      else {
        const grip=Math.min(6,Math.floor(close*7));
        if(grip!==lastGrip){sprite(hand,grip,7,1);lastGrip=grip;}
      }
      visible(hand,t>0 && t<pullEnd);
      move(hand,reach+travel,press,'rotate('+wrist+'deg)');
      move(studio,travel,0);
      let tips;
      if(claw && pressure>0 && tug<.999){
        const pivot=claw.anchor, angle=wrist*Math.PI/180;
        const cos=Math.cos(angle),sin=Math.sin(angle);
        tips=claw.contacts(close).map(tip=>{
          const x=(tip.x-pivot.x)*palm.w, y=(tip.y-pivot.y)*palm.h;
          return {x:palm.x+pivot.x*palm.w+reach+x*cos-y*sin,
            y:palm.y+pivot.y*palm.h+press+x*sin+y*cos,pressure:tip.pressure};
        });
      }
      paper?.draw(pressure,tug,tips);
      move(about,(tug-1)*(w-Math.min(w*.055,70)),0);
      visible(about,t>.67);
      // Horizontal shutter blur follows the incoming sheet's velocity; the settled type is crisp.
      const velocity=.12*6*creep*(1-creep)/.82+.88*6*rip*(1-rip)/1.01;
      const blur=Math.round(Math.min(13,w*.012)*velocity);
      if(blur!==lastBlur){
        blurKernel.setAttribute('stdDeviation',blur+' '+(blur*.07).toFixed(2));
        aboutShell.style.filter=blur?'url(#arrival-streak)':'';
        lastBlur=blur;
      }
      interactionState();
    }
    measure();
    const sectionAt=q=>q<.22?0:q<1.78?1:q<3.32?2:3;
    function selectDestination(instant=false) {
      if(!h)return;
      const page=document.scrollingElement || document.documentElement;
      const maxScroll=page.scrollHeight-page.clientHeight;
      const remaining=maxScroll-window.scrollY;
      scrollDepth=(window.scrollY-story.offsetTop)/h;
      const endDepth=(maxScroll-story.offsetTop)/h;
      const index=sectionAt(scrollDepth);
      if(index!==destination){
        if(index>0 && fall.time===0)idleAtLift=Math.floor(idleTime/.068)%120;
        destination=index;
      }
      // Scenery drifts independently. Only the rising end panel carries the title behind the roof.
      nightDepth=phase(scrollDepth,3.82,endDepth-1);
      storyClock.setGoal(index,remaining<=1.5?1:clamp(1-remaining/h),instant);
      heroCopy.style.translate='0 '+(-Math.min(.22,Math.max(0,scrollDepth))*h*.12)+'px';
    }
    function paintStory(force=false){
      const fallTime=storyClock.fall, pullTime=storyClock.pull, cover=storyClock.cover;
      if(force || fallTime!==fall.time){
        if(fallTime===0 && fall.time>0)idleTime=idleAtLift*.068;
        fall.time=fallTime;drawFall();
      }
      if(force || pullTime!==pull.time){
        if(pullTime>0 && pull.time===0)runnerTime=0;
        pull.time=pullTime;drawPull();
      }
      const reveal = storyClock.reveal;
      if(force || reveal!==lastReveal){
        lastReveal=reveal;
        visible(night,reveal>0);
        tape?.draw(reveal/revealEnd);
        interactionState();
      }
      const nightInView = reveal>0 && cover<1;
      const depth = nightDepth*smooth(reveal/revealEnd);
      if(force || nightInView!==lastNightView || depth!==lastNightDepth || cover!==lastNightCover){
        patrol?.setView(nightInView,depth,cover);
        lastNightCover=cover;
        lastNightView=nightInView;
        lastNightDepth=depth;
      }
      if(force || cover!==displayedCover){
        displayedCover=cover;
        footer.style.transform='translate3d(0,'+(100*(1-cover))+'%,0)';
        footer.style.visibility=cover>0?'visible':'hidden';
        footer.inert=cover<.4;
        bar.inert=cover>=.995;
        interactionState();
      }
      window.LemrixCards?.setStoryView(fallTime<2.02 && cover<1,fallTime>0 && pullTime<pullEnd && cover<1);
      const active=cover>.94 ? '' : reveal>revealEnd*.5 ? '#after-hours' :
        pullTime>pullEnd*.6 ? '#about' : fallTime>fallEnd*.47 ? '#stream' : '';
      if (active===lastNav) return;
      lastNav=active;
      for(const link of nav){
        if(link.hash===active && !link.hasAttribute('aria-current'))link.setAttribute('aria-current','location');
        else if(link.hash!==active && link.hasAttribute('aria-current'))link.removeAttribute('aria-current');
      }
    }
    const layerPositions=new WeakMap();
    function positionLayer(el,x,y) {
      const value=x.toFixed(3)+'px '+y.toFixed(3)+'px';
      if(layerPositions.get(el)===value)return;
      layerPositions.set(el,value);el.style.translate=value;
    }
    const animator = (time,deltaMs) => {
      if(lenis)lenis.raf(time*1000);
      if(document.hidden)return;
      storyClock.tick(deltaMs/1000);
      paintStory();
      const dt=Math.min(deltaMs,100)/1000;
      const damping=1-Math.exp(-dt*6);
      drift.x=lerp(drift.x,pointer.x,damping);drift.y=lerp(drift.y,pointer.y,damping);
      if(fall.time===0)positionLayer(sky,drift.x*4,drift.y*3);
      const parallax=phase(fall.time,fallEnd-.03,fallEnd)*(1-phase(pull.time,0,.5));
      positionLayer(tvArt,drift.x*9*parallax,drift.y*3*parallax);
      positionLayer(watcher,drift.x*4*parallax,drift.y*2*parallax);
      if(pull.time>0)positionLayer(halo,drift.x*8,drift.y*4);
      if(fall.time===0 && destination===0){
        idleTime+=dt;
        sprite(sleepLoop,Math.floor(idleTime/.068)%120,12,10);
      }
      if(fall.time===fallEnd && pull.time<.5 && destination>0){
        watchTime+=dt;
        sprite(watchLoop,Math.floor(watchTime/.104)%54,9,6);
      }
      if(pull.time>.67 && lastReveal<revealEnd*.79 && displayedCover<1){
        runnerTime+=Math.min(deltaMs,80)/1000;
        drawRunner?.(runnerTime,photoW,photoH);
      }
    };

    function refresh(){
      if(!live || document.hidden || !stage.clientWidth || !stage.clientHeight)return;
      measure();
      selectDestination();
      paintStory(true);drawRunner?.(runnerTime,photoW,photoH);
    }
    if(gsap && !location.hash && window.scrollY<4){
      gsap.from(hero.querySelectorAll('h1>span,h1>em,.hero-shop'),{
        y:30,rotation:-1.5,opacity:0,stagger:.08,duration:.65,ease:'power3.out',clearProps:'transform,opacity'
      });
    }
    const marker=anchors.find(anchor=>'#'+anchor.id===location.hash);
    if(marker){
      if(lenis)lenis.scrollTo(marker,{immediate:true});else marker.scrollIntoView();
    }
    selectDestination(true);
    paintStory(true);
    document.documentElement.classList.add('story-ready');
    // The native frame clock resumes even if a cached or backgrounded page
    // returns with the animation library's own ticker asleep.
    let frame=0,previous=0,needsMeasure=true,goalDirty=true;
    function tick(now){
      frame=0;
      if(!live || document.hidden)return;
      if(needsMeasure){needsMeasure=false;refresh();}
      if(goalDirty){goalDirty=false;selectDestination();}
      const elapsed=previous?Math.max(0,Math.min(100,now-previous)):0;
      previous=now;
      animator(now/1000,elapsed);
      frame=requestAnimationFrame(tick);
    }
    function sleep(){
      cancelAnimationFrame(frame);frame=0;previous=0;
    }
    function wake(){
      if(document.hidden){sleep();return;}
      needsMeasure=true;goalDirty=true;
      if(gsap?.ticker && !frame)gsap.ticker.wake();
      if(!frame && live){previous=0;frame=requestAnimationFrame(tick);}
    }
    const onScroll=()=>{goalDirty=true;};
    const resize=window.ResizeObserver && new ResizeObserver(wake);
    resize?.observe(stage);
    window.addEventListener('scroll',onScroll,{passive:true});
    window.addEventListener('resize',wake);
    window.visualViewport?.addEventListener('resize',wake);
    window.addEventListener('pageshow',wake);
    window.addEventListener('pagehide',sleep);
    document.addEventListener('visibilitychange',wake);
    document.addEventListener('resume',wake);
    wake();
    return ()=>{
      live=false;sleep();resize?.disconnect();
      window.removeEventListener('scroll',onScroll);
      window.removeEventListener('resize',wake);
      window.visualViewport?.removeEventListener('resize',wake);
      window.removeEventListener('pageshow',wake);
      window.removeEventListener('pagehide',sleep);
      document.removeEventListener('visibilitychange',wake);
      document.removeEventListener('resume',wake);
      for(const el of surfaces.keys()){el.querySelector('canvas')?.remove();el.style.backgroundImage='';}
      lenis?.destroy();
      paper?.destroy();drawRunner?.destroy();claw?.destroy?.();tape?.destroy();
      patrol?.setView(false,0);night.style.visibility='';
      bar.inert=false;footer.inert=false;footer.removeAttribute('style');aboutShell.style.filter='';
      stage.style.translate='';
      stage.removeEventListener('pointermove',aimAtPointer);stage.removeEventListener('pointerleave',centrePointer);
      tvArt.style.translate='';halo.style.translate='';sky.style.translate='';
      visited.forEach(el=>el.removeAttribute('style'));
      [hero,studio,about,night].forEach(el=>el.inert=false);
      nav.forEach(a=>a.removeAttribute('aria-current'));
      panels.forEach((el,i)=>{const id=anchors[i].id;anchors[i].removeAttribute('id');el.id=id;});
      document.documentElement.classList.remove('has-motion','story-ready');
      streamReady=true;playback();window.LemrixCards?.setStoryView();
    };
  }
  let mode='',stop,startupResize;
  function initialise(){
    const root=document.documentElement;
    if(document.hidden)return;
    if(!root.clientWidth || !root.clientHeight){
      if(!startupResize && window.ResizeObserver){
        startupResize=new ResizeObserver(initialise);
        startupResize.observe(root);
      }
      return;
    }
    startupResize?.disconnect();startupResize=null;
    initPatrol();
    const desired=reduced.matches || !window.LemrixStoryClock?'reduced':'full';
    if(mode===desired)return;
    stop?.();mode=desired;
    if(!videoChoiceMade)userPaused=reduced.matches;
    playback();
    if(mode==='reduced'){stop=watchNaturalScene();return;}
    // Revert the introductory GSAP tween too when visitors change motion mode.
    let endStory;
    if(gsap?.context){
      const animations=gsap.context(()=>{endStory=startStory();});
      stop=()=>{endStory();animations.revert();};
    }else stop=startStory();
  }
  window.addEventListener('lemrix-motion-change',initialise);
  window.addEventListener('load',initialise,{once:true});
  window.addEventListener('pageshow',initialise);
  window.addEventListener('resize',initialise);
  document.addEventListener('visibilitychange',initialise);
  document.addEventListener('prerenderingchange',initialise);
  initialise();
})();
