// A single texture holds the printed scene during the pull. Its crease field and the
// lighting layer share an anchor, so the printed ink and the sheet bend together.
window.LemrixPaperTexture = function (scene) {
  const map = new Image();
  map.src = new URL('assets/paper-fold-map.png', document.currentScript?.src || location.href).href;
  const detail = new Image();
  detail.src = new URL('assets/finger-fold-vectors.png', document.currentScript?.src || location.href).href;
  let canvas, gpu, software, placement;
  const shaderVertex = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      uv = vec2(position.x * .5 + .5, .5 - position.y * .5);
      gl_Position = vec4(position, 0., 1.);
    }`;
  const shaderFragment = `
    precision mediump float;
    uniform sampler2D ink;
    uniform sampler2D crease;
    uniform sampler2D fingerCreases;
    uniform vec4 fingers[4];
    uniform vec2 axes[4];
    uniform vec2 size;
    uniform vec2 grip;
    uniform float radius;
    uniform float pressure;
    varying vec2 uv;
    void main() {
      vec2 local = (uv * size - grip) / (2. * radius) + .5;
      vec2 boundary = min(uv, 1. - uv);
      float margin = smoothstep(0., .105, min(boundary.x,boundary.y));
      vec2 delta = texture2D(crease, local).rg - vec2(128./255.);
      vec2 offset = pressure * radius * .24 * delta;
      for (int i=0;i<4;i++) {
        vec4 finger=fingers[i];
        if(finger.w<=.001) continue;
        vec2 axial=axes[i], normal=vec2(-axial.y,axial.x);
        vec2 relative = uv*size-finger.xy;
        vec2 localTip=vec2(dot(relative,axial),dot(relative,normal))/(2.*finger.z)+.5;
        if(any(lessThanEqual(localTip,vec2(0.))) || any(greaterThanEqual(localTip,vec2(1.)))) continue;
        vec2 tile=vec2((float(i)+localTip.x)*.25,localTip.y);
        vec2 dv=texture2D(fingerCreases,tile).rg-vec2(128./255.);
        offset+=finger.z*.34*finger.w*(axial*dv.x+normal*dv.y);
      }
      gl_FragColor = texture2D(ink, uv + margin * offset / size);
    }`;

  function makeCanvas() {
    const element = document.createElement('canvas');
    element.className = 'folded-print';
    element.setAttribute('aria-hidden','true');
    scene.querySelector('.crease-light').before(element);
    return element;
  }

  function hardwareSurface(element) {
    const gl = element.getContext('webgl', {
      alpha:false, antialias:false, depth:false, stencil:false,
      preserveDrawingBuffer:false, powerPreference:'low-power', failIfMajorPerformanceCaveat:true
    });
    if (!gl) return null;
    const program = gl.createProgram();
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader,source);gl.compileShader(shader);
      gl.attachShader(program,shader);gl.deleteShader(shader);
    };
    compile(gl.VERTEX_SHADER,shaderVertex);compile(gl.FRAGMENT_SHADER,shaderFragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) { gl.deleteProgram(program);return null; }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program,'position');
    gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    const uniform = name => gl.getUniformLocation(program,name);
    const size=uniform('size'),grip=uniform('grip'),radius=uniform('radius'),pressure=uniform('pressure');
    const fingers=uniform('fingers[0]'), axes=uniform('axes[0]');
    const fingerValues=new Float32Array(16), axisValues=new Float32Array(8);
    const textures = [0,1,2].map(i=>{
      const texture=gl.createTexture();
      gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      return texture;
    });
    gl.uniform1i(uniform('ink'),0);gl.uniform1i(uniform('crease'),1);gl.uniform1i(uniform('fingerCreases'),2);
    const upload = (i,img) => {
      gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
    };
    upload(1,map);upload(2,detail);
    return {
      prepare(image,b) {
        if (gl.isContextLost()) return false;
        const ratio=Math.min(devicePixelRatio||1,1.6,1536/b.w,1400/b.h);
        element.width=Math.round(b.w*ratio);element.height=Math.round(b.h*ratio);
        gl.viewport(0,0,element.width,element.height);
        upload(0,image);gl.uniform2f(size,b.w,b.h);gl.uniform2f(grip,b.x,b.y);gl.uniform1f(radius,b.r);
        return true;
      },
      render(amount,patches){
        fingerValues.fill(0);
        patches.forEach(f=>{
          const i=f.index;
          fingerValues.set([f.x,f.y,f.radius,f.pressure],4*i);
          axisValues.set([f.cos,f.sin],2*i);
        });
        gl.uniform4fv(fingers,fingerValues);gl.uniform2fv(axes,axisValues);
        gl.uniform1f(pressure,amount);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      },
      destroy(){textures.forEach(t=>gl.deleteTexture(t));gl.deleteBuffer(buffer);gl.deleteProgram(program);}
    };
  }

  function pixels(image) {
    const surface=document.createElement('canvas');
    surface.width=image.naturalWidth;surface.height=image.naturalHeight;
    const ctx=surface.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(image,0,0);
    return ctx.getImageData(0,0,surface.width,surface.height).data;
  }

  // On devices without WebGL, combine the five displacement fields on a small grid,
  // then interpolate inside each cell. Untouched cells keep their original printing.
  function softwareSurface(element) {
    const ctx=element.getContext('2d',{alpha:false,willReadFrequently:true});
    const largeMap=pixels(map), fingersMap=pixels(detail);
    const cell=5, dim=detail.naturalHeight;
    let width,height,ratio,cols,rows,baseX,baseY,dx,dy,edge;
    let source,target,result,geometryKey;
    function prepare(image,b) {
      ratio=Math.min(devicePixelRatio||1,1.25,1024/b.w,980/b.h);
      width=element.width=Math.round(b.w*ratio);height=element.height=Math.round(b.h*ratio);
      ctx.drawImage(image,0,0,width,height);
      source=new Uint32Array(ctx.getImageData(0,0,width,height).data.buffer);
      target=ctx.createImageData(width,height);
      result=new Uint32Array(target.data.buffer);
      const key=[width,height,b.x,b.y,b.r].join('/');
      if(geometryKey===key)return true;
      geometryKey=key;
      cols=Math.ceil(width/cell)+1;rows=Math.ceil(height/cell)+1;
      const length=cols*rows;
      baseX=new Float32Array(length);baseY=new Float32Array(length);
      dx=new Float32Array(length);dy=new Float32Array(length);edge=new Float32Array(length);
      const radius=b.r*ratio, dim=map.naturalWidth;
      for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
        const x=Math.min(width-1,i*cell),y=Math.min(height-1,j*cell),k=j*cols+i;
        const border=Math.min(1,Math.min(x,width-1-x)/(.105*width),Math.min(y,height-1-y)/(.105*height));
        edge[k]=border*border*(3-2*border);
        const u=(x-b.x*ratio)/(2*radius)+.5,v=(y-b.y*ratio)/(2*radius)+.5;
        if(u<=0||u>=1||v<=0||v>=1)continue;
        const m=4*(Math.floor(v*dim)*dim+Math.floor(u*dim));
        const amount=edge[k]*radius*.24/255;
        baseX[k]=amount*(largeMap[m]-128);baseY[k]=amount*(largeMap[m+1]-128);
      }
      return true;
    }

    function addFinger(f) {
      const n=f.index;
      if(f.pressure<.001)return;
      const cx=f.x*ratio, cy=f.y*ratio, r=f.radius*ratio;
      const firstX=Math.max(0,Math.floor((cx-r)/cell)),lastX=Math.min(cols-1,Math.ceil((cx+r)/cell));
      const firstY=Math.max(0,Math.floor((cy-r)/cell)),lastY=Math.min(rows-1,Math.ceil((cy+r)/cell));
      const factor=r*.34*f.pressure/255;
      for(let j=firstY;j<=lastY;j++)for(let i=firstX;i<=lastX;i++){
        const x=i*cell-cx,y=j*cell-cy;
        const u=(x*f.cos+y*f.sin)/(2*r)+.5,v=(y*f.cos-x*f.sin)/(2*r)+.5;
        if(u<=0||u>=1||v<=0||v>=1)continue;
        const idx=4*((Math.floor(v*dim)*4+n)*dim+Math.floor(u*dim));
        const vx=fingersMap[idx]-128,vy=fingersMap[idx+1]-128, k=j*cols+i;
        dx[k]+=edge[k]*factor*(vx*f.cos-vy*f.sin);
        dy[k]+=edge[k]*factor*(vx*f.sin+vy*f.cos);
      }
    }

    function render(amount,patches) {
      for(let k=0;k<dx.length;k++){dx[k]=baseX[k]*amount;dy[k]=baseY[k]*amount;}
      patches.forEach(addFinger);
      result.set(source);
      for(let j=0;j<rows-1;j++)for(let i=0;i<cols-1;i++){
        const a=j*cols+i,b=a+1,c=a+cols,d=c+1;
        if(Math.max(Math.abs(dx[a]),Math.abs(dx[b]),Math.abs(dx[c]),Math.abs(dx[d]),
          Math.abs(dy[a]),Math.abs(dy[b]),Math.abs(dy[c]),Math.abs(dy[d]))<.49)continue;
        const x=i*cell, y=j*cell, right=Math.min(cell,width-x), bottom=Math.min(cell,height-y);
        for(let line=0;line<bottom;line++){
          const t=line/cell;let vx=dx[a]+(dx[c]-dx[a])*t, vy=dy[a]+(dy[c]-dy[a])*t;
          const stepX=(dx[b]+(dx[d]-dx[b])*t-vx)/cell;
          const stepY=(dy[b]+(dy[d]-dy[b])*t-vy)/cell;
          let pos=(y+line)*width+x;
          for(let col=0;col<right;col++,pos++,vx+=stepX,vy+=stepY){
            result[pos]=source[pos+Math.round(vx)+width*Math.round(vy)];
          }
        }
      }
      ctx.putImageData(target,0,0);
    }
    return {prepare,render,destroy(){baseX=baseY=dx=dy=edge=source=target=result=null;}};
  }

  function prepare(image) {
    if (!image || !placement || !map.complete || !map.naturalWidth || !detail.complete || !detail.naturalWidth) return false;
    try {
      if (!canvas) {
        canvas=makeCanvas();
        gpu=hardwareSurface(canvas);
        if (!gpu) {
          canvas.remove();canvas=makeCanvas();software=softwareSurface(canvas);
        }
      }
      return (gpu||software).prepare(image,placement);
    } catch {return false;}
  }
  return {
    measure(w,h,x,y,r){placement={w,h,x,y,r};},
    prepare,
    render(amount,patches=[],coverage=amount){
      (gpu||software).render(amount,patches);
      canvas.style.opacity=Math.min(1,coverage*5).toFixed(3);
    },
    clear(){if(canvas)canvas.style.opacity='0';},
    destroy(){gpu?.destroy();software?.destroy();canvas?.remove();}
  };
};
