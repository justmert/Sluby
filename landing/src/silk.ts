// warm silk: soft colour fields that drift, folded by slow waves, one of
// them follows the pointer. the left side stays paper so the headline reads.
// returns a function that stops it

const vs = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const fs = `precision highp float;
uniform vec2 r;uniform float t;uniform vec2 m;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float wt(vec2 q,vec2 c,float k){vec2 d=q-c;return k/pow(dot(d,d)+.012,1.25);}
void main(){
 vec2 uv=gl_FragCoord.xy/r;
 float as=r.x/r.y;
 vec2 q=vec2(uv.x*as,uv.y);
 vec2 mm=vec2(m.x*as,m.y);
 float T=t*.12;
 q.x+=.07*sin(q.y*3.1+T*1.3)+.035*sin(q.y*7.3-T);
 q.y+=.06*sin(q.x*2.7-T*1.1)+.03*sin(q.x*6.1+T*.7);
 vec2 dm=q-mm;q-=dm*.22*exp(-dot(dm,dm)*5.);
 vec3 paper=vec3(.957,.933,.89);
 vec3 apri=vec3(.98,.78,.6);
 vec3 emb=vec3(.91,.455,.231);
 vec3 rose=vec3(.8,.47,.43);
 vec3 butt=vec3(.99,.87,.66);
 vec3 coco=vec3(.36,.2,.14);
 float w0=wt(q,vec2(as*.08,.42),.9)+wt(q,vec2(as*.35,.12),.5)+wt(q,vec2(as*.3,.9),.45);
 float w1=wt(q,vec2(as*(.66+.06*sin(T*.9)),.8+.07*cos(T*.7)),.32);
 float w2=wt(q,vec2(as*(.92+.04*sin(T*.8+1.)),.42+.12*sin(T*.6)),.3);
 float w3=wt(q,vec2(as*(1.02+.03*cos(T*.5)),.96),.22);
 float w4=wt(q,mm,.12);
 float w5=wt(q,vec2(as*(1.06+.04*sin(T)),.1+.05*cos(T*.8)),.06);
 vec3 c=(paper*w0+apri*w1+emb*w2+rose*w3+butt*w4+coco*w5)/(w0+w1+w2+w3+w4+w5);
 float f=sin((q.x*1.3+q.y*2.1)*3.2+sin(q.x*2.2+T)*1.4+T*.6);
 c*=.955+.045*f;
 c+=.035*smoothstep(.75,1.,f);
 c+=(h(gl_FragCoord.xy+fract(t*.7)*91.)-.5)*.05;
 gl_FragColor=vec4(c,smoothstep(0.,.22,uv.y));
}`;

export function startSilk(cv: HTMLCanvasElement, reduce: boolean): () => void {
  const gl = cv.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) return () => {};
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
    return s;
  };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(pr) ?? 'shader link failed');
  gl.useProgram(pr);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(pr, 'r');
  const uT = gl.getUniformLocation(pr, 't');
  const uM = gl.getUniformLocation(pr, 'm');

  const target = { x: 0.78, y: 0.62 };
  const mouse = { x: 0.78, y: 0.62 };
  const onMouse = (e: PointerEvent) => {
    const b = cv.getBoundingClientRect();
    target.x = (e.clientX - b.left) / b.width;
    target.y = 1 - (e.clientY - b.top) / b.height;
  };
  window.addEventListener('pointermove', onMouse, { passive: true });

  let raf = 0;
  const start = performance.now();
  const frame = () => {
    // skip drawing once the header has scrolled away
    if (!reduce && cv.getBoundingClientRect().bottom < 0) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(cv.clientWidth * dpr),
      hgt = Math.floor(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== hgt) {
      cv.width = w;
      cv.height = hgt;
    }
    gl.viewport(0, 0, w, hgt);
    mouse.x += (target.x - mouse.x) * 0.05;
    mouse.y += (target.y - mouse.y) * 0.05;
    gl.uniform2f(uR, w, hgt);
    gl.uniform1f(uT, reduce ? 12 : (performance.now() - start) / 1000 + 12);
    gl.uniform2f(uM, mouse.x, mouse.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduce) raf = requestAnimationFrame(frame);
  };
  frame();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMouse);
  };
}
