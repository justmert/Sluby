import { Component, type KeyboardEvent, type PointerEvent } from 'react';
import { paintStills } from './stills';
import { cipherNeedsResize, drawCipher } from './cipher';
import { startSilk } from './silk';

type Role = 'admin' | 'member';
type Seen = '' | 'in';

type State = {
  heroY: number;
  heroO: number;
  manP: number;
  studioP: number;
  scatP: number;
  cmpX: number;
  priv: boolean;
  mode: number;
  bar: number;
  stage: number;
  stagePct: number;
  libP: number;
  buf: number;
  role: Role;
  seenCmp: Seen;
  seenLink: Seen;
  seenEnd: Seen;
  seenDev: Seen;
  seenLens: Seen;
  seenDirect: Seen;
};

type SeenKey = 'seenCmp' | 'seenLink' | 'seenEnd' | 'seenDev' | 'seenLens' | 'seenDirect';

const GRAIN = 0.5;
const GITHUB = 'https://github.com/justmert/Sluby';
const DOCS = 'https://docs.sluby.app';

const cl = (v: number) => Math.max(0, Math.min(1, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const Logo = ({ size, stroke }: { size: number; stroke: string }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#0f6b7a"></rect>
    <path
      d="M23 8.75h-9a3.625 3.625 0 0 0 0 7.25h4a3.625 3.625 0 0 1 0 7.25H9"
      fill="none"
      stroke={stroke}
      strokeWidth="4"
      strokeLinejoin="round"
    ></path>
  </svg>
);

const Arrow = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6"></path>
  </svg>
);

const PlayIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5.5v13l11-6.5z" fill="#1f1a14"></path>
  </svg>
);

const Lock = ({ size, width, label }: { size: number; width: string; label?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="#d4612a"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={label ? undefined : 'true'}
    aria-label={label}
    style={label ? undefined : { flexShrink: 0 }}
  >
    <rect x="5" y="11" width="14" height="10" rx="2"></rect>
    <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
  </svg>
);

export class Landing extends Component<object, State> {
  state: State = {
    heroY: 0,
    heroO: 1,
    manP: 1,
    studioP: 1,
    scatP: 0.5,
    cmpX: 52,
    priv: false,
    mode: 1,
    bar: 30,
    stage: 1,
    stagePct: 40,
    libP: 1,
    buf: 0,
    role: 'admin',
    seenCmp: '',
    seenLink: '',
    seenEnd: '',
    seenDev: '',
    seenLens: '',
    seenDirect: '',
  };

  // the ten tiles that survive, spread over the grid
  alive = new Set([1, 5, 8, 10, 15, 19, 20, 23, 26, 28]);
  // order the dead tiles go dark in, so it ripples instead of sweeping row by row
  deadRank = (() => {
    const dead: number[] = [];
    for (let i = 0; i < 30; i++) if (!this.alive.has(i)) dead.push(i);
    let s = 11;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const shuffled = dead.map((i) => ({ i, k: rnd() })).sort((a, b) => a.k - b.k);
    const rank: Record<number, number> = {};
    shuffled.forEach((d, k) => {
      rank[d.i] = k;
    });
    return rank;
  })();

  // the stream timeline: bar heights look like a waveform, and three of the
  // thirty eight pieces come through the server (the start and one fallback)
  barH = Array.from({ length: 38 }, (_, i) =>
    Math.round(
      26 + 70 * Math.abs(Math.sin(i * 0.61) * Math.cos(i * 0.23 + 0.4)) + 4 * Math.sin(i * 2.7),
    ),
  );
  viaServer = new Set([0, 1, 24]);

  cv: HTMLCanvasElement | null = null;
  man: HTMLElement | null = null;
  studio: HTMLElement | null = null;
  scat: HTMLElement | null = null;
  lensEl: HTMLElement | null = null;
  lensBox: HTMLDivElement | null = null;
  lensImg: HTMLDivElement | null = null;
  lensRing: HTMLDivElement | null = null;
  noise: HTMLCanvasElement | null = null;
  directEl: HTMLElement | null = null;
  lib: HTMLElement | null = null;
  cmp: HTMLDivElement | null = null;
  linkEl: HTMLElement | null = null;
  devEl: HTMLElement | null = null;
  endEl: HTMLElement | null = null;

  reduce = false;
  dragging = false;
  picked = false;
  lensHover = false;
  lensTarget: { x: number; y: number } | null = null;
  raf = 0;
  animRaf = 0;
  cycle = 0;
  tick = 0;
  io: IntersectionObserver | null = null;
  stillsEl: HTMLStyleElement | null = null;
  stopSilk: (() => void) | null = null;

  setX(clientX: number) {
    if (!this.cmp) return;
    const r = this.cmp.getBoundingClientRect();
    const x = Math.max(4, Math.min(96, ((clientX - r.left) / r.width) * 100));
    this.setState({ cmpX: x });
  }
  cmpDown = (e: PointerEvent) => {
    this.dragging = true;
    this.setX(e.clientX);
  };
  cmpMove = (e: PointerEvent) => {
    if (this.dragging || e.pointerType === 'mouse') this.setX(e.clientX);
  };
  cmpKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.setState({ cmpX: Math.max(4, this.state.cmpX - 6) });
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.setState({ cmpX: Math.min(96, this.state.cmpX + 6) });
    }
  };
  togglePriv = () => this.setState({ priv: !this.state.priv });
  lensMove = (e: PointerEvent) => {
    if (!this.lensBox) return;
    const r = this.lensBox.getBoundingClientRect();
    this.lensHover = true;
    this.lensTarget = {
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    };
  };
  lensLeave = () => {
    this.lensHover = false;
  };
  onUp = () => {
    this.dragging = false;
  };
  onScroll = () => {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.measure();
    });
  };

  componentDidMount() {
    this.stillsEl = document.createElement('style');
    this.stillsEl.textContent = paintStills()
      .map((u, i) => `.sl .f${i + 1}{background-image:url(${u})}`)
      .join('\n');
    document.head.appendChild(this.stillsEl);
    this.reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    window.addEventListener('resize', this.onScroll);
    this.measure();

    const keys = new Map<Element | null, SeenKey>([
      [this.cmp, 'seenCmp'],
      [this.linkEl, 'seenLink'],
      [this.endEl, 'seenEnd'],
      [this.devEl, 'seenDev'],
      [this.lensEl, 'seenLens'],
      [this.directEl, 'seenDirect'],
    ]);
    const io = new IntersectionObserver(
      (entries) => {
        const next: Partial<Record<SeenKey, Seen>> = {};
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const k = keys.get(en.target);
          if (k) next[k] = 'in';
          io.unobserve(en.target);
        });
        if (Object.keys(next).length) this.setState(next as Pick<State, SeenKey>);
      },
      { threshold: 0.15 },
    );
    this.io = io;
    keys.forEach((_, el) => {
      if (el) io.observe(el);
    });

    // the device keeps rotating until someone picks one
    this.cycle = window.setInterval(() => {
      if (!this.picked) this.setState({ mode: (this.state.mode + 1) % 3 });
    }, 2600);
    this.tick = window.setInterval(() => {
      let { stage, stagePct } = this.state;
      stagePct += 4;
      if (stagePct > 100) {
        stagePct = 0;
        stage = (stage + 1) % 4;
      }
      const next: Partial<State> = { bar: (this.state.bar + 0.6) % 100, stage, stagePct };
      // one play: pieces arrive, the playhead follows, a short rest, then a new play
      if (this.state.seenDirect)
        next.buf = this.reduce ? 44 : this.state.buf >= 64 ? 0 : this.state.buf + 0.32;
      this.setState(next as State);
      if (this.lensBox && this.noise) {
        const r = this.lensBox.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) drawCipher(this.noise, false);
      }
    }, 120);
    if (this.noise) drawCipher(this.noise, true);
    if (document.fonts && document.fonts.ready)
      document.fonts.ready.then(() => {
        if (this.noise) drawCipher(this.noise, true);
      });

    if (this.cv) this.stopSilk = startSilk(this.cv, this.reduce);
    this.anim();
  }

  // the lens moves every frame, so it writes to the dom directly instead of
  // re-rendering the whole page 60 times a second
  anim() {
    const cur = { x: 50, y: 50 };
    const loop = () => {
      const t = performance.now() / 1000;
      const box = this.lensBox && this.lensBox.getBoundingClientRect();
      if (box && this.lensImg && this.lensRing && box.bottom > 0 && box.top < window.innerHeight) {
        const R = Math.max(70, Math.min(170, box.width * 0.13));
        const tgt =
          this.lensHover && this.lensTarget
            ? this.lensTarget
            : this.reduce
              ? { x: 50, y: 50 }
              : { x: 50 + 30 * Math.sin(t * 0.42), y: 50 + 24 * Math.sin(t * 0.67 + 1) };
        const k = this.lensHover ? 0.22 : 0.08;
        cur.x += (tgt.x - cur.x) * k;
        cur.y += (tgt.y - cur.y) * k;
        this.lensImg.style.clipPath = `circle(${R.toFixed(1)}px at ${cur.x.toFixed(2)}% ${cur.y.toFixed(2)}%)`;
        const px = (cur.x / 100) * box.width,
          py = (cur.y / 100) * box.height;
        const rs = this.lensRing.style;
        rs.width = rs.height = `${(R * 2).toFixed(1)}px`;
        rs.transform = `translate(${(px - R).toFixed(1)}px, ${(py - R).toFixed(1)}px)`;
      }
      this.animRaf = requestAnimationFrame(loop);
    };
    loop();
  }

  componentWillUnmount() {
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    window.removeEventListener('resize', this.onScroll);
    if (this.io) this.io.disconnect();
    if (this.stillsEl) this.stillsEl.remove();
    clearInterval(this.cycle);
    clearInterval(this.tick);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.animRaf);
    if (this.stopSilk) this.stopSilk();
  }

  measure() {
    const vh = window.innerHeight;
    const next: Partial<State> = {};
    const y = window.scrollY || 0;
    next.heroY = Math.min(y * 0.35, 260);
    next.heroO = cl(1 - y / 700);
    if (this.man) {
      const r = this.man.getBoundingClientRect();
      next.manP = cl((vh * 0.75 - r.top) / (r.height * 0.7));
    }
    if (this.studio) {
      const r = this.studio.getBoundingClientRect();
      next.studioP = cl((vh - r.top) / (vh * 0.9));
    }
    if (this.lib) {
      const r = this.lib.getBoundingClientRect();
      next.libP = cl((vh * 0.9 - r.top) / (r.height * 0.8));
    }
    if (this.noise && cipherNeedsResize(this.noise)) drawCipher(this.noise, true);
    if (this.scat) {
      const r = this.scat.getBoundingClientRect();
      next.scatP = r.height > vh + 50 ? cl(-r.top / (r.height - vh)) : 0.45;
    }
    this.setState(next as State);
  }

  renderVals() {
    const st = this.state;

    // the strike lands first, then "your own" drops in below it
    const sk = ease(cl((st.manP - 0.15) / 0.35));
    const ow = ease(cl((st.manP - 0.45) / 0.3));

    const sp = ease(st.studioP);
    const pub = '#a8a29e',
      pri = '#57534e';
    const cards = [
      {
        title: 'Launch walkthrough',
        len: '4:12',
        f: 'f1',
        meta: '4:12 · 1080p',
        acc: 'Public',
        accC: pub,
      },
      {
        title: 'Workshop, part one',
        len: '52:08',
        f: 'f4',
        meta: '52:08 · 1080p',
        acc: 'Private',
        accC: pri,
      },
      {
        title: 'Field notes from the coast',
        len: '9:47',
        f: 'f2',
        meta: '9:47',
        acc: 'Public',
        accC: pub,
        busy: true,
      },
      {
        title: 'Quarterly town hall',
        len: '1:03:20',
        f: 'f6',
        meta: '1:03:20 · 720p',
        acc: 'Private',
        accC: pri,
      },
      {
        title: 'Studio tour',
        len: '2:31',
        f: 'f5',
        meta: '2:31 · 1080p',
        acc: 'Public',
        accC: pub,
      },
      {
        title: 'Interview, take two',
        len: '18:05',
        f: 'f3',
        meta: '18:05 · 1080p',
        acc: 'Public',
        accC: pub,
      },
    ].map((c) => ({ ...c, busy: !!c.busy }));
    const stageNames = ['Uploading', 'Transcoding', 'Storing on Sia', 'Publishing'];

    // thirty pieces: split, twenty go dark, then the survivors rebuild them
    const p = st.scatP;
    const a = ease(cl(p / 0.2));
    const b = cl((p - 0.26) / 0.28);
    const c = cl((p - 0.6) / 0.24);
    const e = ease(cl((p - 0.86) / 0.1));
    const gap = 18 * a * (1 - e);
    const rad = 10 * a * (1 - e);
    let darkCount = 0;
    const tiles = [];
    for (let i = 0; i < 30; i++) {
      const col = i % 6,
        row = Math.floor(i / 6);
      const live = this.alive.has(i);
      let ry = 0,
        ol = 0,
        gl = 0,
        s = 1 - 0.06 * a * (1 - e);
      if (!live) {
        const start = (this.deadRank[i] / 20) * 0.6;
        const f1 = ease(cl((b - start) / 0.4));
        const f2 = ease(cl((c - start) / 0.4));
        ry = 180 * f1 + 180 * f2;
        if (ry > 90 && ry < 270) darkCount++;
      } else {
        const on = cl(b * 3) * (1 - cl(c * 1.5));
        ol = on;
        gl = on * 0.55;
        s += 0.04 * on;
      }
      tiles.push({
        bx: ((col / 5) * 100).toFixed(2),
        by: ((row / 4) * 100).toFixed(2),
        ry: ry.toFixed(1),
        ol: ol.toFixed(2),
        gl: gl.toFixed(2),
        s: s.toFixed(3),
        rad: rad.toFixed(1),
      });
    }
    const online = 30 - darkCount;
    const phase = p < 0.25 ? 0 : p < 0.58 ? 1 : 2;
    const phaseTexts = [
      'By default, every video is split into thirty pieces, and each piece goes to a different independent host.',
      'Now twenty of those hosts go dark. Maybe they are down, maybe they are gone for good.',
      'Any ten pieces are enough to rebuild the rest, so the video keeps playing.',
    ];
    const phases = [cl(p / 0.25), cl((p - 0.25) / 0.33), cl((p - 0.58) / 0.38)].map((v) =>
      (v * 100).toFixed(1),
    );

    // stream timeline: loaded bars take their source colour, played ones go solid
    const loaded = Math.min(38, Math.floor(st.buf));
    const headAt = cl((st.buf - 5) / 38) * 38;
    let siaN = 0;
    const bars = this.barH.map((hgt, i) => {
      const isLoaded = i < loaded;
      const srv = this.viaServer.has(i);
      if (isLoaded && !srv) siaN++;
      return {
        h: hgt,
        c: !isLoaded ? 'rgba(31,26,20,.1)' : srv ? '#e8743b' : '#1f1a14',
        o: !isLoaded ? 1 : i < headAt ? 1 : 0.42,
        s: isLoaded ? 1 : 0.3,
      };
    });
    const fromSia = loaded ? Math.round((siaN / loaded) * 100) : 0;

    // team and overview: numbers count up as the section scrolls in
    const lp = ease(st.libP);
    const pl = Math.round(3418 * lp);
    const mins = Math.round(1300 * lp);
    const vn = Math.max(3, Math.round(48 * lp));
    const stats = [
      {
        label: 'Videos',
        value: String(vn),
        hint: `${Math.max(0, vn - 3)} ready, 2 processing, 1 uploading`,
      },
      {
        label: 'Stored on Sia',
        value: `${(38.4 * lp).toFixed(1)} GB`,
        hint: 'before Sia adds redundancy',
      },
      {
        label: 'Playable time',
        value: `${Math.floor(mins / 60)} h ${mins % 60} m`,
        hint: 'across ready videos',
      },
      { label: 'Plays, last 30 days', value: pl.toLocaleString('en-US'), hint: 'from your sites' },
    ];
    const isAdmin = st.role === 'admin';
    const nav: [string, boolean][] = [
      ['Overview', false],
      ['Videos', false],
      ['Upload', false],
      ['Developers', false],
      ['Members', true],
      ['Health', true],
      ['Metrics', true],
      ['Settings', false],
    ];
    const navItems = nav.map(([label, adm]) => ({
      label,
      adm,
      bg: adm && !isAdmin ? 'transparent' : '#ffffff',
      edge: adm && !isAdmin ? 'rgba(31,26,20,.14)' : 'rgba(31,26,20,.1)',
      fg: adm && !isAdmin ? 'rgba(31,26,20,.32)' : '#1f1a14',
      dec: adm && !isAdmin ? 'line-through' : 'none',
    }));
    const roles = (
      [
        ['admin', 'Admin'],
        ['member', 'Member'],
      ] as [Role, string][]
    ).map(([k, label]) => ({
      label,
      on: st.role === k,
      pick: () => this.setState({ role: k }),
    }));
    const roleText = isAdmin
      ? 'Admins do everything members do, and also manage members and see server health and metrics.'
      : 'Members upload and manage videos, API keys and webhooks.';

    const devs = [
      {
        w: 40,
        h: 96,
        r: 38,
        p: '46px 14px 26px',
        bg: '#1f1a14',
        vr: 14,
        barH: 0,
        barO: 0,
        txtH: 0,
        txtH2: 0,
        txtO: 0,
        msgH: 34,
        msgO: 1,
      },
      {
        w: 92,
        h: 86,
        r: 16,
        p: '16px 22px 22px',
        bg: '#1f1a14',
        vr: 10,
        barH: 14,
        barO: 1,
        txtH: 34,
        txtH2: 30,
        txtO: 1,
        msgH: 0,
        msgO: 0,
      },
      {
        w: 100,
        h: 74,
        r: 10,
        p: '12px',
        bg: '#0e0b08',
        vr: 4,
        barH: 0,
        barO: 0,
        txtH: 0,
        txtH2: 0,
        txtO: 0,
        msgH: 0,
        msgO: 0,
      },
    ];
    const labels = ['A message', 'Your website', 'The big screen'];
    const modes = labels.map((label, i) => ({
      label,
      on: st.mode === i,
      pick: () => {
        this.picked = true;
        this.setState({ mode: i });
      },
    }));

    return {
      heroY: st.heroY.toFixed(1),
      heroO: st.heroO.toFixed(3),
      strW: (104 * sk).toFixed(1),
      strO: (1 - 0.62 * sk).toFixed(2),
      ownO: ow.toFixed(3),
      ownY: (24 * (1 - ow)).toFixed(1),
      tilt: (24 * (1 - sp)).toFixed(2),
      tiltS: (0.9 + 0.1 * sp).toFixed(3),
      cards,
      stageName: stageNames[st.stage],
      stageStep: `${st.stage + 1} of 4`,
      stageSegs: [0, 1, 2, 3].map((k) => (k < st.stage ? 100 : k === st.stage ? st.stagePct : 0)),
      tiles,
      gap: gap.toFixed(1),
      online,
      countColor: online < 30 ? '#d4612a' : '#1f1a14',
      phaseText: phaseTexts[phase],
      phases,
      endO: e.toFixed(3),
      playS: (0.8 + 0.2 * e).toFixed(3),
      bars,
      head: ((headAt / 38) * 100).toFixed(2),
      fromSia,
      stats,
      navItems,
      roles,
      roleText,
      gridO: e >= 0.999 ? 0 : 1,
      cmpX: st.cmpX.toFixed(2),
      cmpR: (100 - st.cmpX).toFixed(2),
      leftLabelO: (0.35 + (0.65 * st.cmpX) / 100).toFixed(2),
      rightLabelO: (0.35 + 0.65 * (1 - st.cmpX / 100)).toFixed(2),
      linkText: st.priv
        ? 'your-site.com/watch/pb_x7Kq2v?expires=…'
        : 'your-site.com/watch/pb_x7Kq2v',
      dev: devs[st.mode],
      isTv: st.mode === 2,
      modes,
      bar: st.bar.toFixed(1),
    };
  }

  render() {
    const st = this.state;
    const v = this.renderVals();
    return (
      <div
        className="sl"
        style={{
          position: 'relative',
          width: '100%',
          background: '#f4eee3',
          color: '#1f1a14',
          fontFamily: "'Figtree Variable', system-ui, sans-serif",
          fontSize: '18px',
          lineHeight: 1.55,
          overflowX: 'clip',
        }}
      >
        <div className="grain" aria-hidden="true" style={{ opacity: GRAIN }}></div>

        <header
          style={{
            position: 'relative',
            minHeight: '840px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <canvas
            ref={(el) => {
              this.cv = el;
            }}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'block',
            }}
          ></canvas>
          <nav
            className="wrap"
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '28px',
              paddingBottom: '28px',
            }}
          >
            <a
              href="#top"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                color: '#1f1a14',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: '22px',
                letterSpacing: '-0.03em',
              }}
            >
              <Logo size={34} stroke="#f4eee3" />
              <span>Sluby</span>
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
              <a className="navlink" href={DOCS}>
                Docs
              </a>
              <a className="navlink" href="https://app.sluby.app">
                App
              </a>
              <a className="navlink" href={GITHUB}>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"></path>
                </svg>
                <span>GitHub</span>
              </a>
            </div>
          </nav>
          <div
            className="wrap"
            style={{
              position: 'relative',
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              paddingBottom: '110px',
              transform: `translateY(${v.heroY}px)`,
              opacity: v.heroO,
            }}
          >
            <h1 className="disp hero-h" style={{ fontSize: '136px', maxWidth: '1100px' }}>
              <span className="rise" style={{ display: 'inline-block', animationDelay: '.15s' }}>
                Host your videos.
              </span>{' '}
              <span className="rise it" style={{ display: 'inline-block', animationDelay: '.35s' }}>
                Keep them yours.
              </span>
            </h1>
            <div
              className="split"
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: '32px',
                marginTop: '44px',
                flexWrap: 'wrap',
              }}
            >
              <p
                className="rise"
                style={{
                  margin: 0,
                  maxWidth: '500px',
                  fontSize: '21px',
                  color: 'rgba(31,26,20,.78)',
                  animationDelay: '.6s',
                }}
              >
                Sluby is free, open source video hosting you run yourself. Upload once, share
                anywhere, and keep every file on Sia.
              </p>
              <div
                className="rise"
                style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', animationDelay: '.8s' }}
              >
                <a className="btn btn-ink" href={GITHUB}>
                  Get Sluby
                </a>
                <a className="btn btn-line" href="#how">
                  See how it works
                </a>
              </div>
            </div>
          </div>
        </header>

        <section
          ref={(el) => {
            this.man = el;
          }}
          style={{ position: 'relative', padding: '220px 0 200px' }}
        >
          <div className="wrap">
            <p
              className="disp man"
              style={{
                fontSize: '108px',
                lineHeight: 1.06,
                letterSpacing: '-0.05em',
                maxWidth: '1180px',
                margin: 0,
              }}
            >
              Your videos live on{' '}
              <span style={{ position: 'relative', display: 'inline-block', whiteSpace: 'nowrap' }}>
                <span style={{ color: `rgba(31,26,20,${v.strO})` }}>someone else's</span>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '-2%',
                    top: '55%',
                    height: '0.075em',
                    width: `${v.strW}%`,
                    borderRadius: '99px',
                    background: '#e8743b',
                  }}
                ></span>
                <span
                  className="it"
                  style={{
                    position: 'absolute',
                    left: '10%',
                    top: '88%',
                    fontSize: '0.66em',
                    color: '#d4612a',
                    whiteSpace: 'nowrap',
                    opacity: v.ownO,
                    transform: `translateY(${v.ownY}px) rotate(-4deg)`,
                  }}
                >
                  your own
                </span>
              </span>{' '}
              terms.
            </p>
            <p
              style={{
                margin: '150px 0 0',
                maxWidth: '460px',
                fontSize: '21px',
                color: 'rgba(31,26,20,.68)',
                opacity: v.ownO,
                transform: `translateY(${v.ownY}px)`,
              }}
            >
              Sluby puts them back on your own server and your own domain, with nobody else deciding
              what happens to them.
            </p>
          </div>
        </section>

        <section
          ref={(el) => {
            this.studio = el;
          }}
          style={{ position: 'relative', padding: '20px 0 200px' }}
        >
          <div className="wrap">
            <div
              className="split"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                gap: '40px',
                marginBottom: '72px',
              }}
            >
              <h2 className="disp big-h" style={{ fontSize: '80px', maxWidth: '720px' }}>
                Everything you upload,{' '}
                <span className="it" style={{ color: '#9a8a74' }}>
                  in one calm place.
                </span>
              </h2>
              <p
                style={{
                  margin: 0,
                  maxWidth: '380px',
                  fontSize: '19px',
                  color: 'rgba(31,26,20,.68)',
                }}
              >
                Invite your team, upload big files, watch each video get ready, and decide who gets
                to see it. A dropped upload picks up where it stopped.
              </p>
            </div>
            <div style={{ perspective: '1800px' }}>
              <div
                style={{
                  transform: `rotateX(${v.tilt}deg) scale(${v.tiltS})`,
                  transformOrigin: '50% 0%',
                  borderRadius: '18px',
                  background: '#ffffff',
                  color: '#1c1917',
                  boxShadow:
                    '0 50px 90px -50px rgba(80,55,30,.45), 0 20px 40px -30px rgba(80,55,30,.25), 0 0 0 1px rgba(60,45,30,.1)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    height: '44px',
                    padding: '0 18px',
                    borderBottom: '1px solid #e7e5e4',
                    background: '#fafaf9',
                  }}
                >
                  <span
                    style={{
                      width: '11px',
                      height: '11px',
                      borderRadius: '50%',
                      background: '#e7e5e4',
                    }}
                  ></span>
                  <span
                    style={{
                      width: '11px',
                      height: '11px',
                      borderRadius: '50%',
                      background: '#e7e5e4',
                    }}
                  ></span>
                  <span
                    style={{
                      width: '11px',
                      height: '11px',
                      borderRadius: '50%',
                      background: '#e7e5e4',
                    }}
                  ></span>
                  <span
                    className="mono"
                    style={{ marginLeft: '18px', fontSize: '13px', color: '#78716c' }}
                  >
                    your-site.com/studio/videos
                  </span>
                </div>
                <div style={{ display: 'flex' }}>
                  <div
                    className="hide-s"
                    style={{
                      flex: '0 0 210px',
                      padding: '22px 14px',
                      borderRight: '1px solid #e7e5e4',
                      background: '#fafaf9',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      fontSize: '15px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '0 10px 18px',
                        fontWeight: 700,
                      }}
                    >
                      <Logo size={22} stroke="#ffffff" />
                      Sluby Studio
                    </div>
                    <div style={{ padding: '9px 10px', borderRadius: '8px', color: '#57534e' }}>
                      Overview
                    </div>
                    <div
                      style={{
                        padding: '9px 10px',
                        borderRadius: '8px',
                        background: '#f0efed',
                        color: '#1c1917',
                        fontWeight: 600,
                      }}
                    >
                      Videos
                    </div>
                    <div style={{ padding: '9px 10px', borderRadius: '8px', color: '#57534e' }}>
                      Upload
                    </div>
                    <div style={{ padding: '9px 10px', borderRadius: '8px', color: '#57534e' }}>
                      Developers
                    </div>
                    <div style={{ padding: '9px 10px', borderRadius: '8px', color: '#57534e' }}>
                      Members
                    </div>
                    <div style={{ padding: '9px 10px', borderRadius: '8px', color: '#57534e' }}>
                      Settings
                    </div>
                    <div
                      style={{
                        marginTop: 'auto',
                        padding: '14px 10px 0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      <span style={{ display: 'flex' }}>
                        <span
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            background: '#e8a87c',
                            boxShadow: '0 0 0 2px #fafaf9',
                          }}
                        ></span>
                        <span
                          style={{
                            width: '28px',
                            height: '28px',
                            marginLeft: '-8px',
                            borderRadius: '50%',
                            background: '#a3b18a',
                            boxShadow: '0 0 0 2px #fafaf9',
                          }}
                        ></span>
                        <span
                          style={{
                            width: '28px',
                            height: '28px',
                            marginLeft: '-8px',
                            borderRadius: '50%',
                            background: '#c9a7a0',
                            boxShadow: '0 0 0 2px #fafaf9',
                          }}
                        ></span>
                      </span>
                      <span style={{ fontSize: '13px', color: '#78716c' }}>3 members</span>
                    </div>
                  </div>
                  <div style={{ flex: '1 1 auto', minWidth: 0, padding: '26px' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '14px',
                        marginBottom: '18px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                        <span
                          style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}
                        >
                          Videos
                        </span>
                        <span style={{ fontSize: '14px', color: '#78716c' }}>24 videos</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          className="hide-s"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            width: '240px',
                            height: '40px',
                            padding: '0 14px',
                            borderRadius: '10px',
                            background: '#ffffff',
                            boxShadow: 'inset 0 0 0 1px #d6d3d1',
                            fontSize: '14px',
                            color: '#78716c',
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden="true"
                          >
                            <circle cx="11" cy="11" r="7"></circle>
                            <path d="M20 20l-3.5-3.5"></path>
                          </svg>
                          Search videos
                        </div>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            height: '40px',
                            padding: '0 16px',
                            borderRadius: '10px',
                            background: '#0f6b7a',
                            color: '#ffffff',
                            fontWeight: 600,
                            fontSize: '14px',
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M12 19V5M5 12l7-7 7 7"></path>
                          </svg>
                          Upload
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        marginBottom: '22px',
                        flexWrap: 'wrap',
                        fontSize: '13px',
                      }}
                    >
                      <span
                        style={{
                          padding: '6px 12px',
                          borderRadius: '999px',
                          background: '#1c1917',
                          color: '#ffffff',
                          fontWeight: 600,
                        }}
                      >
                        All
                      </span>
                      <span
                        style={{
                          padding: '6px 12px',
                          borderRadius: '999px',
                          boxShadow: 'inset 0 0 0 1px #d6d3d1',
                          color: '#57534e',
                        }}
                      >
                        Public
                      </span>
                      <span
                        style={{
                          padding: '6px 12px',
                          borderRadius: '999px',
                          boxShadow: 'inset 0 0 0 1px #d6d3d1',
                          color: '#57534e',
                        }}
                      >
                        Private
                      </span>
                      <span
                        style={{
                          padding: '6px 12px',
                          borderRadius: '999px',
                          boxShadow: 'inset 0 0 0 1px #d6d3d1',
                          color: '#57534e',
                        }}
                      >
                        Processing
                      </span>
                    </div>
                    <div className="vgrid">
                      {v.cards.map((cd) => (
                        <div
                          key={cd.title}
                          style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
                        >
                          <div
                            className={cd.f}
                            style={{
                              position: 'relative',
                              aspectRatio: '16 / 9',
                              borderRadius: '12px',
                              overflow: 'hidden',
                            }}
                          >
                            {!cd.busy && (
                              <span
                                className="mono"
                                style={{
                                  position: 'absolute',
                                  right: '8px',
                                  bottom: '8px',
                                  padding: '2px 7px',
                                  borderRadius: '6px',
                                  background: 'rgba(28,25,23,.7)',
                                  fontSize: '12px',
                                  color: '#ffffff',
                                }}
                              >
                                {cd.len}
                              </span>
                            )}
                            {cd.busy && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background:
                                    'linear-gradient(to top, rgba(20,16,12,.86) 0%, rgba(20,16,12,.45) 45%, rgba(20,16,12,.1) 100%)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'flex-end',
                                  padding: '14px',
                                  gap: '10px',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    fontSize: '13px',
                                    color: '#ffffff',
                                  }}
                                >
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      fontWeight: 600,
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: '7px',
                                        height: '7px',
                                        borderRadius: '50%',
                                        background: '#ffffff',
                                        boxShadow: '0 0 0 4px rgba(255,255,255,.22)',
                                      }}
                                    ></span>
                                    {v.stageName}
                                  </span>
                                  <span className="mono" style={{ opacity: 0.75 }}>
                                    {v.stageStep}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                                    gap: '4px',
                                  }}
                                >
                                  {v.stageSegs.map((w, k) => (
                                    <div
                                      key={k}
                                      style={{
                                        height: '4px',
                                        borderRadius: '4px',
                                        background: 'rgba(255,255,255,.25)',
                                        overflow: 'hidden',
                                      }}
                                    >
                                      <div
                                        style={{
                                          height: '100%',
                                          width: `${w}%`,
                                          background: '#ffffff',
                                        }}
                                      ></div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px',
                              fontSize: '14px',
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 600,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {cd.title}
                            </span>
                            <span
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: '10px',
                                color: '#78716c',
                                fontSize: '13px',
                              }}
                            >
                              <span>{cd.meta}</span>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  color: '#57534e',
                                }}
                              >
                                <span
                                  style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    background: cd.accC,
                                  }}
                                ></span>
                                {cd.acc}
                              </span>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="how"
          ref={(el) => {
            this.scat = el;
          }}
          style={{ position: 'relative', height: '2600px' }}
        >
          <div
            style={{
              position: 'sticky',
              top: 0,
              minHeight: '760px',
              display: 'flex',
              alignItems: 'center',
              padding: '64px 0',
            }}
          >
            <div
              className="wrap split"
              style={{ display: 'flex', alignItems: 'center', gap: '64px' }}
            >
              <div style={{ flex: '1 1 380px', minWidth: 0 }}>
                <h2 className="disp big-h" style={{ fontSize: '72px' }}>
                  Thirty pieces.{' '}
                  <span className="it" style={{ color: '#9a8a74' }}>
                    Any ten bring it back.
                  </span>
                </h2>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '14px',
                    marginTop: '44px',
                  }}
                >
                  <span
                    className="disp"
                    style={{
                      fontSize: '124px',
                      lineHeight: 0.9,
                      color: v.countColor,
                      fontVariantNumeric: 'tabular-nums',
                      transition: 'color .5s',
                    }}
                  >
                    {v.online}
                  </span>
                  <span style={{ fontSize: '18px', color: 'rgba(31,26,20,.6)' }}>
                    pieces playing
                  </span>
                </div>
                <p
                  style={{
                    margin: '28px 0 0',
                    minHeight: '90px',
                    maxWidth: '420px',
                    fontSize: '21px',
                    lineHeight: 1.45,
                  }}
                >
                  {v.phaseText}
                </p>
                <div style={{ display: 'flex', gap: '8px', marginTop: '18px', maxWidth: '420px' }}>
                  {v.phases.map((w, k) => (
                    <div
                      key={k}
                      style={{
                        flex: '1 1 0',
                        height: '4px',
                        borderRadius: '4px',
                        background: 'rgba(31,26,20,.12)',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{ height: '100%', width: `${w}%`, background: '#1f1a14' }}></div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ flex: '1.25 1 480px', minWidth: 0, width: '100%' }}>
                <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10' }}>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                      gridTemplateRows: 'repeat(5, minmax(0, 1fr))',
                      gap: `${v.gap}px`,
                      opacity: v.gridO,
                    }}
                  >
                    {v.tiles.map((t, k) => (
                      <div
                        key={k}
                        className="tcell"
                        style={{ borderRadius: `${t.rad}px`, transform: `scale(${t.s})` }}
                      >
                        <div
                          className="tin"
                          style={{ transform: `rotateY(${t.ry}deg)`, borderRadius: `${t.rad}px` }}
                        >
                          <div
                            className="face f1"
                            style={{
                              backgroundSize: '600% 500%',
                              backgroundPosition: `${t.bx}% ${t.by}%`,
                              boxShadow: `inset 0 0 0 2px rgba(255,248,236,${t.ol}), 0 14px 30px -10px rgba(120,60,20,${t.gl})`,
                            }}
                          ></div>
                          <div className="face back">
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#9a8a74"
                              strokeWidth="2"
                              strokeLinecap="round"
                              aria-hidden="true"
                            >
                              <path d="M6 6l12 12M18 6L6 18"></path>
                            </svg>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    className="f1"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 2,
                      borderRadius: '6px',
                      opacity: v.endO,
                      pointerEvents: 'none',
                      boxShadow: '0 40px 90px -40px rgba(120,60,20,.6)',
                    }}
                  ></div>
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: '84px',
                      height: '84px',
                      margin: '-42px 0 0 -42px',
                      borderRadius: '50%',
                      background: 'rgba(255,248,236,.92)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 3,
                      opacity: v.endO,
                      transform: `scale(${v.playS})`,
                    }}
                  >
                    <PlayIcon size={30} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          ref={(el) => {
            this.lensEl = el;
          }}
          className="slab"
          style={{
            position: 'relative',
            padding: '160px 0 170px',
            background: '#1c1814',
            color: '#f4eee3',
          }}
        >
          <div className="wrap">
            <div style={{ textAlign: 'center', maxWidth: '900px', margin: '0 auto 72px' }}>
              <h2 className={`disp big-h rv ${st.seenLens}`} style={{ fontSize: '88px' }}>
                Hosts keep it.{' '}
                <span className="it" style={{ color: '#f08a55' }}>
                  Only you can see it.
                </span>
              </h2>
              <p
                className={`rv d1 ${st.seenLens}`}
                style={{
                  margin: '30px auto 0',
                  maxWidth: '540px',
                  fontSize: '19px',
                  color: 'rgba(244,238,227,.7)',
                }}
              >
                Every piece is encrypted on your server before it goes to Sia. The hosts that store
                it only ever hold scrambled data.
              </p>
            </div>
            <div
              ref={(el) => {
                this.lensBox = el;
              }}
              className={`rv d2 ${st.seenLens}`}
              onPointerMove={this.lensMove}
              onPointerLeave={this.lensLeave}
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '2 / 1',
                minHeight: '340px',
                borderRadius: '24px',
                overflow: 'hidden',
                touchAction: 'pan-y',
                background: '#241f1a',
                boxShadow: 'inset 0 0 0 1px rgba(244,238,227,.08)',
              }}
            >
              <canvas
                ref={(el) => {
                  this.noise = el;
                }}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  display: 'block',
                }}
              ></canvas>
              <div
                ref={(el) => {
                  this.lensImg = el;
                }}
                className="f5"
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  clipPath: 'circle(0px at 50% 50%)',
                  willChange: 'clip-path',
                }}
              ></div>
              <div
                ref={(el) => {
                  this.lensRing = el;
                }}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 0,
                  height: 0,
                  borderRadius: '50%',
                  boxShadow: '0 0 0 2px #f08a55, 0 0 80px rgba(240,138,85,.3)',
                  pointerEvents: 'none',
                  willChange: 'transform',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '100%',
                    transform: 'translate(-50%, 14px)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 14px',
                    borderRadius: '999px',
                    background: '#f08a55',
                    color: '#1f1a14',
                    fontWeight: 600,
                    fontSize: '14px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="8" cy="15" r="4"></circle>
                    <path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2"></path>
                  </svg>
                  Your key
                </span>
              </div>
              <span
                className="mono"
                style={{
                  position: 'absolute',
                  left: '24px',
                  top: '22px',
                  padding: '6px 12px',
                  borderRadius: '999px',
                  background: 'rgba(28,24,20,.85)',
                  fontSize: '13px',
                  color: 'rgba(244,238,227,.7)',
                }}
              >
                what a host stores
              </span>
            </div>
          </div>
        </section>

        <section
          ref={(el) => {
            this.directEl = el;
          }}
          style={{ position: 'relative', padding: '200px 0 190px' }}
        >
          <div
            className="wrap split"
            style={{ display: 'flex', gap: '72px', alignItems: 'center' }}
          >
            <div style={{ flex: '1 1 360px', minWidth: 0 }}>
              <h2 className={`disp big-h rv ${st.seenDirect}`} style={{ fontSize: '76px' }}>
                Your server doesn't carry{' '}
                <span className="it" style={{ color: '#9a8a74' }}>
                  every view.
                </span>
              </h2>
              <p
                className={`rv d1 ${st.seenDirect}`}
                style={{
                  margin: '30px 0 0',
                  maxWidth: '430px',
                  fontSize: '19px',
                  color: 'rgba(31,26,20,.7)',
                }}
              >
                Every video plays from Sia. Your server relays the first seconds so playback starts
                fast, then the viewer's browser reads the rest straight from the Sia hosts. The
                Studio shows how much of each play came direct.
              </p>
              <div
                className={`rv d2 ${st.seenDirect}`}
                style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', marginTop: '56px' }}
              >
                <span
                  className="disp huge"
                  style={{ fontSize: '168px', lineHeight: 0.8, fontVariantNumeric: 'tabular-nums' }}
                >
                  {v.fromSia}
                  <span style={{ fontSize: '0.5em', letterSpacing: '-0.02em' }}>%</span>
                </span>
                <span
                  style={{
                    paddingBottom: '6px',
                    fontSize: '17px',
                    lineHeight: 1.35,
                    color: 'rgba(31,26,20,.62)',
                  }}
                >
                  in this example,
                  <br />
                  came straight from Sia
                </span>
              </div>
            </div>
            <div
              className={`rv d2 ${st.seenDirect}`}
              style={{ flex: '1.25 1 520px', minWidth: 0, width: '100%' }}
            >
              <div
                style={{
                  padding: '18px 18px 26px',
                  borderRadius: '28px',
                  background: '#fbf8f2',
                  boxShadow: '0 50px 90px -50px rgba(80,55,30,.4), 0 0 0 1px rgba(60,45,30,.08)',
                }}
              >
                <div
                  className="f6 live"
                  style={{
                    position: 'relative',
                    aspectRatio: '16 / 9',
                    borderRadius: '16px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: '72px',
                      height: '72px',
                      margin: '-36px 0 0 -36px',
                      borderRadius: '50%',
                      background: 'rgba(255,248,236,.9)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="#1f1a14"></path>
                    </svg>
                  </div>
                </div>
                <div style={{ position: 'relative', height: '92px', margin: '26px 8px 0' }}>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: '4px',
                    }}
                  >
                    {v.bars.map((b, k) => (
                      <div
                        key={k}
                        className="bar"
                        style={{
                          height: `${b.h}%`,
                          background: b.c,
                          opacity: b.o,
                          transform: `scaleY(${b.s})`,
                        }}
                      ></div>
                    ))}
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      top: '-10px',
                      bottom: '-6px',
                      left: `${v.head}%`,
                      width: '2px',
                      marginLeft: '-1px',
                      background: '#1f1a14',
                      borderRadius: '2px',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '-6px',
                        width: '12px',
                        height: '12px',
                        marginLeft: '-6px',
                        borderRadius: '50%',
                        background: '#1f1a14',
                      }}
                    ></span>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '16px',
                    margin: '22px 8px 0',
                    flexWrap: 'wrap',
                    fontSize: '15px',
                    color: 'rgba(31,26,20,.7)',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '3px',
                        background: '#1f1a14',
                      }}
                    ></span>
                    Straight from Sia
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '3px',
                        background: '#e8743b',
                      }}
                    ></span>
                    From Sia via your server
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          ref={(el) => {
            this.lib = el;
          }}
          style={{ position: 'relative', padding: '150px 0 200px' }}
        >
          <div
            className="wrap split"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: '40px',
            }}
          >
            <h2 className="disp big-h" style={{ fontSize: '92px', maxWidth: '820px' }}>
              Run it together.{' '}
              <span className="it" style={{ color: '#9a8a74' }}>
                See how it's going.
              </span>
            </h2>
            <p
              style={{ margin: 0, maxWidth: '360px', fontSize: '19px', color: 'rgba(31,26,20,.7)' }}
            >
              Invite your team with a link, decide who runs the server, and keep an eye on plays,
              storage and health from one page.
            </p>
          </div>
          <div
            className="wrap split"
            style={{ display: 'flex', gap: '28px', alignItems: 'stretch', marginTop: '80px' }}
          >
            <div
              style={{
                flex: '0 1 420px',
                minWidth: 0,
                width: '100%',
                padding: '28px',
                borderRadius: '28px',
                background: '#fbf8f2',
                boxShadow: '0 0 0 1px rgba(60,45,30,.08)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                role="group"
                aria-label="Show the Studio as"
                style={{
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  gap: '4px',
                  padding: '4px',
                  borderRadius: '999px',
                  background: 'rgba(31,26,20,.07)',
                }}
              >
                {v.roles.map((ro) => (
                  <button
                    key={ro.label}
                    type="button"
                    className="seg"
                    aria-pressed={ro.on}
                    onClick={ro.pick}
                    style={{
                      minHeight: '40px',
                      background: ro.on ? '#1f1a14' : 'transparent',
                      color: ro.on ? '#f4eee3' : '#1f1a14',
                    }}
                  >
                    {ro.label}
                  </button>
                ))}
              </div>
              <div
                style={{
                  marginTop: '24px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  fontSize: '15px',
                }}
              >
                {v.navItems.map((ni) => (
                  <span
                    key={ni.label}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                      padding: '8px 14px',
                      borderRadius: '999px',
                      background: ni.bg,
                      boxShadow: `inset 0 0 0 1px ${ni.edge}`,
                      color: ni.fg,
                      transition: 'color .35s, background .35s, box-shadow .35s',
                    }}
                  >
                    <span style={{ textDecoration: ni.dec }}>{ni.label}</span>
                    {ni.adm && <Lock size={13} width="2.4" label="admins only" />}
                  </span>
                ))}
              </div>
              <p style={{ margin: '12px 2px 0', fontSize: '13px', color: '#b8551f' }}>
                The lock marks what only admins see.
              </p>
              <p
                style={{
                  margin: '22px 2px 24px',
                  minHeight: '52px',
                  fontSize: '17px',
                  color: 'rgba(31,26,20,.75)',
                }}
              >
                {v.roleText}
              </p>
              <div
                style={{
                  marginTop: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '16px',
                  background: '#1f1a14',
                  color: '#f4eee3',
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#f08a55"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path>
                  <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>
                </svg>
                <span style={{ fontSize: '15px', lineHeight: 1.4 }}>
                  Invite links can be for one person or a whole group, and last a day, a week or a
                  month.
                </span>
              </div>
            </div>
            <div
              className="stats"
              style={{
                flex: '1 1 520px',
                minWidth: 0,
                width: '100%',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gridTemplateRows: 'auto auto 1fr',
                gap: '16px',
              }}
            >
              {v.stats.map((sx) => (
                <div
                  key={sx.label}
                  style={{
                    padding: '26px 26px 22px',
                    borderRadius: '24px',
                    background: '#fbf8f2',
                    boxShadow: '0 0 0 1px rgba(60,45,30,.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    minWidth: 0,
                  }}
                >
                  <span style={{ fontSize: '15px', color: 'rgba(31,26,20,.6)' }}>{sx.label}</span>
                  <span
                    className="disp sval"
                    style={{
                      fontSize: '56px',
                      lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sx.value}
                  </span>
                  <span style={{ fontSize: '14px', color: 'rgba(31,26,20,.5)' }}>{sx.hint}</span>
                </div>
              ))}
              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  alignItems: 'center',
                  alignContent: 'center',
                  gap: '18px',
                  flexWrap: 'wrap',
                  padding: '18px 24px',
                  borderRadius: '20px',
                  background: '#1f1a14',
                  color: '#f4eee3',
                  fontSize: '15px',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: '9px',
                      height: '9px',
                      borderRadius: '50%',
                      background: '#8fc27a',
                      boxShadow: '0 0 0 5px rgba(143,194,122,.18)',
                    }}
                  ></span>
                  All working
                </span>
                <span style={{ color: 'rgba(244,238,227,.6)' }}>Database OK</span>
                <span style={{ color: 'rgba(244,238,227,.6)' }}>Queue OK</span>
                <span style={{ color: 'rgba(244,238,227,.6)' }}>Sia storage OK</span>
                <span
                  style={{
                    flexBasis: '100%',
                    paddingTop: '10px',
                    borderTop: '1px solid rgba(244,238,227,.12)',
                    color: 'rgba(244,238,227,.6)',
                  }}
                >
                  The storage check compares your videos with what Sia holds, every hour.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section style={{ position: 'relative', padding: '40px 0 190px' }}>
          <div className="wrap">
            <div
              className="split"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                gap: '40px',
                marginBottom: '64px',
              }}
            >
              <h2
                className={`disp big-h rv ${st.seenCmp}`}
                style={{ fontSize: '88px', maxWidth: '760px' }}
              >
                Your video,{' '}
                <span className="it" style={{ color: '#9a8a74' }}>
                  with nothing in front of it.
                </span>
              </h2>
              <p
                className={`rv d1 ${st.seenCmp}`}
                style={{
                  margin: 0,
                  maxWidth: '360px',
                  fontSize: '19px',
                  color: 'rgba(31,26,20,.7)',
                }}
              >
                No ads, no suggested videos, no one else's logo. A Sluby watch page is the video and
                nothing more.
              </p>
            </div>
            <div
              ref={(el) => {
                this.cmp = el;
              }}
              className={`rv d2 ${st.seenCmp}`}
              onPointerDown={this.cmpDown}
              onPointerMove={this.cmpMove}
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '16 / 9',
                borderRadius: '24px',
                overflow: 'hidden',
                touchAction: 'pan-y',
                userSelect: 'none',
                boxShadow: '0 60px 110px -50px rgba(80,55,30,.5), 0 0 0 1px rgba(60,45,30,.1)',
              }}
            >
              <div className="f2" style={{ position: 'absolute', inset: 0 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: '84px',
                    height: '84px',
                    margin: '-42px 0 0 -42px',
                    borderRadius: '50%',
                    background: 'rgba(255,248,236,.9)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <PlayIcon size={32} />
                </div>
                <div
                  className="mono"
                  style={{
                    position: 'absolute',
                    right: '24px',
                    bottom: '22px',
                    padding: '8px 14px',
                    borderRadius: '999px',
                    background: 'rgba(255,248,236,.9)',
                    color: '#1f1a14',
                    fontSize: '14px',
                  }}
                >
                  your-site.com/watch/pb_x7Kq2v
                </div>
              </div>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  clipPath: `inset(0 ${v.cmpR}% 0 0)`,
                  background: '#242424',
                }}
              >
                <div style={{ position: 'absolute', left: 0, top: 0, width: '74%', height: '78%' }}>
                  <div
                    className="f2"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      filter: 'saturate(.35) brightness(.6)',
                    }}
                  ></div>
                  <div
                    style={{
                      position: 'absolute',
                      left: '20px',
                      top: '20px',
                      padding: '7px 14px',
                      borderRadius: '6px',
                      background: '#f6d548',
                      color: '#1b1f20',
                      fontWeight: 700,
                      fontSize: '14px',
                    }}
                  >
                    Ad · skip in 5
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '32%',
                      transform: 'translateX(-50%)',
                      width: '62%',
                      padding: '18px 20px',
                      borderRadius: '10px',
                      background: 'rgba(255,255,255,.94)',
                      color: '#1b1f20',
                      fontSize: '15px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>Sponsored: try something else</span>
                    <span
                      style={{
                        padding: '8px 14px',
                        borderRadius: '6px',
                        background: '#2a62d9',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '13px',
                      }}
                    >
                      Learn more
                    </span>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      right: '18px',
                      top: '18px',
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,.75)',
                    }}
                  ></div>
                </div>
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    width: '26%',
                    height: '100%',
                    padding: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  <div
                    style={{
                      height: '12px',
                      width: '60%',
                      borderRadius: '4px',
                      background: '#4a4a4a',
                    }}
                  ></div>
                  <div style={{ flexGrow: 1, borderRadius: '8px', background: '#3a3a3a' }}></div>
                  <div style={{ flexGrow: 1, borderRadius: '8px', background: '#353535' }}></div>
                  <div style={{ flexGrow: 1, borderRadius: '8px', background: '#303030' }}></div>
                  <div style={{ flexGrow: 1, borderRadius: '8px', background: '#2c2c2c' }}></div>
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    width: '74%',
                    height: '22%',
                    padding: '0 22px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                  }}
                >
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '50%',
                      background: '#4a4a4a',
                      flexShrink: 0,
                    }}
                  ></div>
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}
                  >
                    <div
                      style={{
                        height: '12px',
                        width: '55%',
                        borderRadius: '4px',
                        background: '#4a4a4a',
                      }}
                    ></div>
                    <div
                      style={{
                        height: '10px',
                        width: '35%',
                        borderRadius: '4px',
                        background: '#3a3a3a',
                      }}
                    ></div>
                  </div>
                  <div
                    style={{
                      padding: '10px 18px',
                      borderRadius: '999px',
                      background: '#c8312b',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '14px',
                    }}
                  >
                    Subscribe
                  </div>
                </div>
              </div>
              <button
                className="handle"
                type="button"
                aria-label="Drag to compare their page with yours"
                onKeyDown={this.cmpKey}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${v.cmpX}%`,
                  width: '64px',
                  marginLeft: '-32px',
                  border: 0,
                  padding: 0,
                  background: 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: '31px',
                    width: '2px',
                    background: '#fbf8f2',
                  }}
                ></span>
                <span
                  style={{
                    position: 'relative',
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: '#fbf8f2',
                    boxShadow: '0 10px 30px rgba(31,26,20,.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#1f1a14"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 6l-6 6 6 6M15 6l6 6-6 6"></path>
                  </svg>
                </span>
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '22px',
                fontWeight: 600,
                fontSize: '17px',
              }}
            >
              <span style={{ opacity: v.leftLabelO, transition: 'opacity .3s' }}>Their page</span>
              <span style={{ opacity: v.rightLabelO, transition: 'opacity .3s', color: '#d4612a' }}>
                Your page
              </span>
            </div>
          </div>
        </section>

        <section
          ref={(el) => {
            this.linkEl = el;
          }}
          className="slab"
          style={{
            position: 'relative',
            padding: '160px 0',
            background: '#e8743b',
            color: '#1f1a14',
          }}
        >
          <div
            className="wrap"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '64px', alignItems: 'center' }}
          >
            <div style={{ flex: '1 1 380px', minWidth: 0 }}>
              <h2 className={`disp big-h rv ${st.seenLink}`} style={{ fontSize: '72px' }}>
                One link. <span className="it">It plays wherever you put it.</span>
              </h2>
              <p
                className={`rv d1 ${st.seenLink}`}
                style={{
                  margin: '32px 0 0',
                  maxWidth: '440px',
                  fontSize: '19px',
                  color: 'rgba(31,26,20,.78)',
                }}
              >
                Send it in a message, drop it into your site, or open it on the big screen. The
                picture adjusts to every screen and every connection.
              </p>
              <div
                className={`rv d2 ${st.seenLink}`}
                style={{
                  marginTop: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '8px 8px 8px 20px',
                  borderRadius: '999px',
                  background: '#f4eee3',
                  maxWidth: '100%',
                }}
              >
                {st.priv && <Lock size={18} width="2" />}
                <span
                  className="mono"
                  style={{
                    flexGrow: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '15px',
                  }}
                >
                  {v.linkText}
                </span>
                <button
                  type="button"
                  className="seg"
                  aria-pressed={st.priv}
                  onClick={this.togglePriv}
                  style={{
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    background: st.priv ? '#1f1a14' : 'rgba(31,26,20,.08)',
                    color: st.priv ? '#f4eee3' : '#1f1a14',
                  }}
                >
                  <span
                    style={{
                      position: 'relative',
                      width: '34px',
                      height: '20px',
                      borderRadius: '999px',
                      background: st.priv ? '#e8743b' : 'rgba(31,26,20,.3)',
                      transition: 'background .3s',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: '3px',
                        left: `${st.priv ? 17 : 3}px`,
                        width: '14px',
                        height: '14px',
                        borderRadius: '50%',
                        background: '#f4eee3',
                        transition: 'left .3s',
                      }}
                    ></span>
                  </span>
                  Private
                </button>
              </div>
              <p
                style={{
                  margin: '18px 0 0 20px',
                  minHeight: '28px',
                  fontSize: '16px',
                  fontWeight: 500,
                  opacity: st.priv ? 1 : 0,
                  transition: 'opacity .4s',
                }}
              >
                Private videos open only from links that run out.
              </p>
            </div>
            <div style={{ flex: '1.3 1 480px', minWidth: 0 }}>
              <div style={{ position: 'relative', width: '100%', aspectRatio: '760 / 520' }}>
                <div
                  className="morph"
                  style={{
                    width: `${v.dev.w}%`,
                    height: `${v.dev.h}%`,
                    borderRadius: `${v.dev.r}px`,
                    padding: v.dev.p,
                    background: v.dev.bg,
                    boxShadow: '0 60px 110px -50px rgba(70,25,0,.7)',
                  }}
                >
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    <div
                      className="chrome"
                      style={{
                        display: 'flex',
                        gap: '7px',
                        alignItems: 'center',
                        height: `${v.dev.barH}px`,
                        opacity: v.dev.barO,
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: '#4a4037',
                        }}
                      ></span>
                      <span
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: '#4a4037',
                        }}
                      ></span>
                      <span
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: '#4a4037',
                        }}
                      ></span>
                      <span
                        style={{
                          marginLeft: '12px',
                          height: '10px',
                          width: '40%',
                          borderRadius: '4px',
                          background: '#3a322a',
                        }}
                      ></span>
                    </div>
                    <div
                      className="chrome"
                      style={{
                        height: `${v.dev.txtH}px`,
                        opacity: v.dev.txtO,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '9px',
                      }}
                    >
                      <span
                        style={{
                          height: '16px',
                          width: '58%',
                          borderRadius: '4px',
                          background: '#4a4037',
                        }}
                      ></span>
                      <span
                        style={{
                          height: '9px',
                          width: '90%',
                          borderRadius: '4px',
                          background: '#332b24',
                        }}
                      ></span>
                    </div>
                    <div
                      className="chrome"
                      style={{
                        height: `${v.dev.msgH}px`,
                        opacity: v.dev.msgO,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        alignItems: 'flex-start',
                      }}
                    >
                      <span
                        style={{
                          padding: '9px 14px',
                          borderRadius: '16px 16px 16px 4px',
                          background: '#3a322a',
                          fontSize: '14px',
                          color: '#f4eee3',
                        }}
                      >
                        you have to see this
                      </span>
                    </div>
                    <div
                      className="f3 live"
                      style={{
                        position: 'relative',
                        flexGrow: 1,
                        borderRadius: `${v.dev.vr}px`,
                        overflow: 'hidden',
                        minHeight: 0,
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          width: '56px',
                          height: '56px',
                          margin: '-28px 0 0 -28px',
                          borderRadius: '50%',
                          background: 'rgba(255,248,236,.9)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <PlayIcon size={22} />
                      </div>
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          bottom: 0,
                          height: '4px',
                          width: '100%',
                          background: 'rgba(31,26,20,.35)',
                        }}
                      >
                        <div
                          style={{ height: '100%', width: `${v.bar}%`, background: '#f4eee3' }}
                        ></div>
                      </div>
                    </div>
                    <div
                      className="chrome"
                      style={{
                        height: `${v.dev.txtH2}px`,
                        opacity: v.dev.txtO,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '9px',
                      }}
                    >
                      <span
                        style={{
                          height: '9px',
                          width: '96%',
                          borderRadius: '4px',
                          background: '#332b24',
                        }}
                      ></span>
                      <span
                        style={{
                          height: '9px',
                          width: '70%',
                          borderRadius: '4px',
                          background: '#332b24',
                        }}
                      ></span>
                    </div>
                  </div>
                </div>
                {v.isTv && (
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: '3%',
                      width: '22%',
                      height: '4px',
                      transform: 'translateX(-50%)',
                      borderRadius: '4px',
                      background: '#1f1a14',
                    }}
                  ></div>
                )}
              </div>
              <div
                role="group"
                aria-label="Where it plays"
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '28px',
                  flexWrap: 'wrap',
                }}
              >
                {v.modes.map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    className="seg"
                    aria-pressed={m.on}
                    onClick={m.pick}
                    style={{
                      background: m.on ? '#1f1a14' : 'rgba(31,26,20,.1)',
                      color: m.on ? '#f4eee3' : '#1f1a14',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          ref={(el) => {
            this.devEl = el;
          }}
          style={{ position: 'relative', padding: '190px 0 170px' }}
        >
          <div
            className="wrap split"
            style={{ display: 'flex', gap: '80px', alignItems: 'flex-start' }}
          >
            <div style={{ flex: '1 1 380px', minWidth: 0 }}>
              <h2 className={`disp big-h rv ${st.seenDev}`} style={{ fontSize: '72px' }}>
                Building your own app?{' '}
                <span className="it" style={{ color: '#9a8a74' }}>
                  Bring Sluby along.
                </span>
              </h2>
              <p
                className={`rv d1 ${st.seenDev}`}
                style={{
                  margin: '28px 0 0',
                  maxWidth: '420px',
                  fontSize: '19px',
                  color: 'rgba(31,26,20,.7)',
                }}
              >
                A ready-made player and a small toolkit put your videos inside your own site, and
                the guides walk you through the rest.
              </p>
              <div
                className={`rv d2 ${st.seenDev} mono`}
                style={{
                  marginTop: '32px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '12px',
                  maxWidth: '100%',
                  padding: '14px 20px',
                  borderRadius: '14px',
                  background: '#1f1a14',
                  color: '#f4eee3',
                  fontSize: '15px',
                  overflowX: 'auto',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ color: '#f08a55' }}>$</span>npm install @sluby/player @sluby/sdk
              </div>
            </div>
            <div
              className={`rv d2 ${st.seenDev}`}
              style={{
                flex: '1.2 1 440px',
                minWidth: 0,
                width: '100%',
                borderBottom: '1px solid rgba(31,26,20,.14)',
              }}
            >
              <a className="big-link" href={`${DOCS}/self-hosting`}>
                <span>Start in a few minutes</span>
                <Arrow />
              </a>
              <a className="big-link" href={`${DOCS}/studio/share`}>
                <span>Share and embed videos</span>
                <Arrow />
              </a>
              <a className="big-link" href="https://www.npmjs.com/package/@sluby/player">
                <span>The player for your site</span>
                <Arrow />
              </a>
              <a className="big-link" href={`${DOCS}/self-hosting/production`}>
                <span>Put it on your own domain</span>
                <Arrow />
              </a>
            </div>
          </div>
        </section>

        <section
          ref={(el) => {
            this.endEl = el;
          }}
          className="slab"
          style={{
            position: 'relative',
            padding: '150px 0 160px',
            background: '#1c1814',
            color: '#f4eee3',
          }}
        >
          <div
            className="wrap"
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '56px' }}
          >
            <svg
              className={`draw ${st.seenEnd}`}
              viewBox="0 0 32 32"
              aria-hidden="true"
              style={{ flex: '0 0 auto', width: '260px', height: '260px' }}
            >
              <path
                pathLength={1}
                d="M23 8.75h-9a3.625 3.625 0 0 0 0 7.25h4a3.625 3.625 0 0 1 0 7.25H9"
                fill="none"
                stroke="#f08a55"
                strokeWidth="3.2"
                strokeLinejoin="round"
                strokeLinecap="round"
              ></path>
            </svg>
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <h2 className={`disp big-h rv ${st.seenEnd}`} style={{ fontSize: '92px' }}>
                Free and open source.{' '}
                <span className="it" style={{ color: '#f08a55' }}>
                  Yours to run.
                </span>
              </h2>
              <div
                className={`rv d1 ${st.seenEnd}`}
                style={{
                  display: 'flex',
                  gap: '14px',
                  flexWrap: 'wrap',
                  marginTop: '44px',
                  alignItems: 'center',
                }}
              >
                <a className="btn btn-ember" href={GITHUB}>
                  Get Sluby on GitHub
                </a>
                <a className="btn btn-pale" href={DOCS}>
                  Read the docs
                </a>
              </div>
            </div>
          </div>
        </section>

        <footer className="wrap" style={{ paddingTop: '90px', paddingBottom: '48px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: '48px',
            }}
          >
            <div
              style={{
                flex: '1 1 280px',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  fontWeight: 700,
                  fontSize: '20px',
                  letterSpacing: '-0.03em',
                }}
              >
                <Logo size={30} stroke="#f4eee3" />
                Sluby
              </div>
              <p
                style={{
                  margin: 0,
                  maxWidth: '300px',
                  fontSize: '16px',
                  color: 'rgba(31,26,20,.6)',
                }}
              >
                Video hosting you run yourself, stored on Sia.
              </p>
            </div>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '160px' }}
            >
              <span style={{ fontSize: '14px', color: 'rgba(31,26,20,.45)', marginBottom: '8px' }}>
                Docs
              </span>
              <a className="flink" href={`${DOCS}/self-hosting`}>
                Install Sluby
              </a>
              <a className="flink" href={`${DOCS}/self-hosting/production`}>
                Running it for real
              </a>
              <a className="flink" href={`${DOCS}/studio/share`}>
                Share and embed
              </a>
              <a className="flink" href={`${DOCS}/developers/reference/api-conventions`}>
                API
              </a>
            </div>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '160px' }}
            >
              <span style={{ fontSize: '14px', color: 'rgba(31,26,20,.45)', marginBottom: '8px' }}>
                Project
              </span>
              <a className="flink" href="https://app.sluby.app">
                Sluby app
              </a>
              <a className="flink" href={GITHUB}>
                GitHub
              </a>
              <a className="flink" href="https://www.npmjs.com/package/@sluby/player">
                Player on npm
              </a>
              <a className="flink" href="https://www.npmjs.com/package/@sluby/sdk">
                Toolkit on npm
              </a>
              <a className="flink" href={`${GITHUB}/blob/main/LICENSE`}>
                Apache 2.0 license
              </a>
            </div>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '160px' }}
            >
              <span style={{ fontSize: '14px', color: 'rgba(31,26,20,.45)', marginBottom: '8px' }}>
                Sia
              </span>
              <a className="flink" href="https://sia.tech">
                What is Sia?
              </a>
              <a className="flink" href="https://sia.storage">
                sia.storage
              </a>
            </div>
          </div>
        </footer>
      </div>
    );
  }
}
