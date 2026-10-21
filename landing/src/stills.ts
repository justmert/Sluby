// the video stills are painted once at load: layered landscapes with light,
// haze and film grain, so every thumbnail on the page looks like a real frame.
// returns one jpeg data url per scene, in the order of the .f1 to .f6 classes

type Scene = {
  sky: [string, string];
  sun: [number, number, number, string, string];
  haze: string;
  kind: 'dune' | 'hill' | 'mesa' | 'sea' | 'peak';
  stars?: boolean;
  layers: string[];
};

const scenes: Scene[] = [
  {
    sky: ['#f7e3c4', '#f3b17c'],
    sun: [0.68, 0.5, 34, '#fff1d8', 'rgba(255,214,160,.85)'],
    haze: '#f5c493',
    kind: 'dune',
    layers: ['#eebd86', '#e2a46c', '#d18a55', '#b86d3f', '#93522c'],
  },
  {
    sky: ['#f5efd6', '#e9dcae'],
    sun: [0.24, 0.22, 26, '#fffbea', 'rgba(255,246,210,.8)'],
    haze: '#eee5c0',
    kind: 'hill',
    layers: ['#c9c99a', '#a9b277', '#8a9a59', '#6a7c42', '#4b5b2c'],
  },
  {
    sky: ['#f6dfc7', '#eeb48f'],
    sun: [0.8, 0.3, 30, '#fff4e2', 'rgba(255,220,180,.8)'],
    haze: '#f0c3a0',
    kind: 'mesa',
    layers: ['#dca17d', '#cc8058', '#b5653e', '#93492a', '#6c3220'],
  },
  {
    sky: ['#151227', '#4b3352'],
    sun: [0.72, 0.24, 22, '#f4ead6', 'rgba(244,234,214,.35)'],
    haze: '#4a3550',
    kind: 'hill',
    stars: true,
    layers: ['#3a2c45', '#2d2238', '#21192b', '#17111f', '#0e0a14'],
  },
  {
    sky: ['#f6d6b8', '#ee9f74'],
    sun: [0.5, 0.56, 40, '#fff0dc', 'rgba(255,200,150,.9)'],
    haze: '#efa77d',
    kind: 'sea',
    layers: ['#7c5a63'],
  },
  {
    sky: ['#ece6da', '#d5d6cd'],
    sun: [0.3, 0.3, 24, '#fbf7ec', 'rgba(250,246,234,.7)'],
    haze: '#dfe0d6',
    kind: 'peak',
    layers: ['#b3b7b0', '#959c97', '#76807d', '#58625f', '#3a4341'],
  },
];

const rgb = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const A = rgb(a),
    B = rgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
};

const ridge = (k: number, x: number, ph: number, kind: Scene['kind']) => {
  const f = 0.0042 + k * 0.0011;
  let v =
    0.55 * Math.sin(x * f + ph) +
    0.3 * Math.sin(x * f * 2.3 + ph * 1.7) +
    0.15 * Math.sin(x * f * 5.1 + ph * 0.3);
  if (kind === 'peak')
    v = (1 - Math.abs(Math.sin(x * f * 1.4 + ph))) * 1.3 - 0.5 + 0.15 * Math.sin(x * f * 6 + ph);
  if (kind === 'mesa') v = Math.min(v, 0.32 - k * 0.05) + 0.02 * Math.sin(x * 0.09);
  if (kind === 'dune')
    v = 0.8 * Math.sin(x * f + ph + 0.4 * Math.sin(x * f * 0.5)) + 0.2 * Math.sin(x * f * 3 + ph);
  return v;
};

export function paintStills(): string[] {
  const W = 960,
    H = 540;
  // seeded, so the landscapes come out the same on every visit
  let seed = 19;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  return scenes.map((sc) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('2d canvas is not available');
    const horizon = sc.kind === 'sea' ? H * 0.58 : H * 0.62;
    let g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, sc.sky[0]);
    g.addColorStop(1, sc.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (sc.stars) {
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = `rgba(255,248,230,${0.2 + rnd() * 0.7})`;
        const r = rnd() * 1.4 + 0.3;
        ctx.beginPath();
        ctx.arc(rnd() * W, rnd() * horizon * 0.85, r, 0, 7);
        ctx.fill();
      }
    }
    const [sx, sy, sr, sc1, glow] = sc.sun;
    g = ctx.createRadialGradient(sx * W, sy * H, 0, sx * W, sy * H, sr * 9);
    g.addColorStop(0, glow);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = sc1;
    ctx.beginPath();
    ctx.arc(sx * W, sy * H, sr, 0, 7);
    ctx.fill();
    if (sc.kind === 'sea') {
      g = ctx.createLinearGradient(0, horizon, 0, H);
      g.addColorStop(0, '#b06a5e');
      g.addColorStop(0.4, '#6e4553');
      g.addColorStop(1, '#2c1d2c');
      ctx.fillStyle = g;
      ctx.fillRect(0, horizon, W, H - horizon);
      for (let i = 0; i < 90; i++) {
        const t = rnd(),
          y = horizon + 2 + t * t * (H - horizon);
        const w = (30 + rnd() * 90) * (1 + t * 2.2);
        ctx.fillStyle = `rgba(255,226,190,${(0.55 - t * 0.45) * (0.4 + rnd() * 0.6)})`;
        ctx.fillRect(sx * W - w / 2 + (rnd() - 0.5) * 40 * (1 + t * 3), y, w, 1.5 + t * 3);
      }
      // a dark headland on the left
      ctx.fillStyle = '#4a2e36';
      ctx.beginPath();
      ctx.moveTo(0, horizon + 1);
      for (let x = 0; x <= W * 0.42; x += 4)
        ctx.lineTo(
          x,
          horizon +
            1 -
            Math.max(0, 70 * Math.pow(1 - x / (W * 0.42), 1.6) + 6 * Math.sin(x * 0.05)),
        );
      ctx.lineTo(W * 0.42, horizon + 1);
      ctx.closePath();
      ctx.fill();
    } else {
      const n = sc.layers.length;
      sc.layers.forEach((col, k) => {
        const base =
          horizon - 40 + k * ((H - horizon + 60) / n) + (sc.kind === 'peak' ? -70 + k * 10 : 0);
        const amp =
          sc.kind === 'peak' ? 120 - k * 14 : sc.kind === 'mesa' ? 90 - k * 8 : 46 - k * 3;
        const ph = rnd() * 6.28;
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 3) ctx.lineTo(x, base - amp * ridge(k, x, ph, sc.kind));
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.save();
        ctx.clip();
        g = ctx.createLinearGradient(0, base - amp, 0, H);
        g.addColorStop(0, mix(col, sc.haze, 0.18));
        g.addColorStop(1, mix(col, '#000000', 0.25));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        // light from the sun side, shade away from it
        g = ctx.createLinearGradient(sx * W - 500, 0, sx * W + 500, 0);
        g.addColorStop(0, 'rgba(0,0,0,.14)');
        g.addColorStop(0.5, 'rgba(255,240,215,.1)');
        g.addColorStop(1, 'rgba(0,0,0,.14)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        // haze settles in front of every far layer
        if (k < n - 1) {
          const hz = rgb(sc.haze).join(',');
          g = ctx.createLinearGradient(0, base - 10, 0, base + 70);
          g.addColorStop(0, `rgba(${hz},0)`);
          g.addColorStop(0.6, `rgba(${hz},.28)`);
          g.addColorStop(1, `rgba(${hz},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(0, base - 10, W, 80);
        }
      });
    }
    g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(20,10,5,.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H),
      d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() - 0.5) * 16;
      d[i] += v;
      d[i + 1] += v;
      d[i + 2] += v;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/jpeg', 0.86);
  });
}
