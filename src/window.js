'use strict';
/* Out-of-window view from the tower cab. Canvas 2D perspective renderer:
   sky (sun, clouds, stars), distant land and Prague skyline, field patchwork, aerodrome surfaces and markings,
   buildings, low-poly 3D aircraft with shadows, airfield lighting by night and in fog, cab mullions.
   World units are metres east/north of the aerodrome reference point, z up from aerodrome level. */

const WV_TOD = {
  day: { zen: [28, 88, 176], mid: [58, 128, 210], low: [118, 172, 228], hor: [196, 218, 236], fog: [184, 190, 198], far: [96, 118, 132], skyLand: [128, 146, 158], amb: 0.62, dif: 0.48, lightsK: 0.0, stars: 0, cloudTop: [255, 255, 255], cloudBot: [190, 200, 214] },
  dusk: { zen: [16, 26, 62], mid: [46, 52, 102], low: [100, 90, 136], hor: [168, 124, 136], fog: [92, 84, 96], far: [44, 40, 56], skyLand: [70, 58, 70], amb: 0.30, dif: 0.15, lightsK: 0.85, stars: 0.25, cloudTop: [250, 178, 150], cloudBot: [96, 82, 110] },
  night: { zen: [3, 6, 14], mid: [7, 12, 26], low: [14, 20, 36], hor: [36, 32, 42], fog: [24, 24, 30], far: [10, 11, 15], skyLand: [12, 13, 17], amb: 0.10, dif: 0.0, lightsK: 1.0, stars: 1, cloudTop: [44, 44, 56], cloudBot: [26, 24, 32] },
};
const WV_GROUND = {
  day: { grass: [96, 122, 66], grass2: [104, 128, 72], asphalt: [58, 60, 66], concrete: [158, 158, 152], twy: [118, 118, 116], paint: [236, 236, 230], yellow: [222, 182, 52] },
  dusk: { grass: [42, 50, 38], grass2: [46, 54, 40], asphalt: [44, 44, 50], concrete: [76, 74, 78], twy: [60, 60, 64], paint: [140, 136, 140], yellow: [130, 104, 48] },
  night: { grass: [11, 14, 12], grass2: [12, 15, 13], asphalt: [16, 17, 20], concrete: [30, 30, 33], twy: [22, 22, 25], paint: [52, 52, 56], yellow: [50, 42, 22] },
};
const FIELD_COLS = [[110, 92, 60], [124, 104, 66], [96, 118, 62], [82, 104, 54], [138, 120, 78], [104, 86, 58], [72, 96, 52], [116, 128, 74], [92, 78, 54]];
const AC_DIMS = { B38M: [39.5, 35.9], B738: [39.5, 35.8], A320: [37.6, 35.8], A20N: [37.6, 35.8], A21N: [44.5, 35.8], A319: [33.8, 35.8], E190: [36.2, 28.7], E195: [38.7, 28.7], B77W: [73.9, 64.8], B788: [56.7, 60.1], B789: [62.8, 60.1], A333: [63.7, 60.3], AT76: [27.2, 27.1], DH8D: [32.8, 28.4], CRJ9: [36.2, 24.9] };
/* Generic livery colours per operator: body, tail, engine. No logos, just colour fields. */
const LIVERY = {
  TVS: [[238, 240, 244], [24, 70, 160], [24, 70, 160]], CSA: [[238, 240, 244], [200, 30, 40], [30, 60, 140]], EZS: [[240, 240, 240], [255, 102, 0], [255, 102, 0]], EZY: [[240, 240, 240], [255, 102, 0], [255, 102, 0]],
  RYR: [[236, 238, 244], [10, 40, 110], [10, 40, 110]], DLH: [[236, 236, 236], [12, 32, 82], [200, 200, 205]], UAE: [[240, 240, 240], [196, 30, 40], [180, 180, 186]], KLM: [[0, 161, 222], [0, 161, 222], [210, 210, 214]],
  AFR: [[244, 244, 246], [240, 240, 244], [36, 60, 140]], WZZ: [[240, 240, 244], [196, 0, 120], [40, 30, 90]], BAW: [[236, 236, 240], [30, 40, 110], [180, 180, 186]], THY: [[240, 240, 240], [200, 16, 46], [180, 180, 186]],
  ETD: [[220, 206, 178], [140, 110, 60], [200, 190, 170]], QTR: [[234, 234, 236], [92, 6, 52], [180, 180, 186]], LOT: [[240, 240, 240], [20, 40, 100], [20, 40, 100]], AUA: [[240, 240, 240], [220, 20, 30], [200, 200, 204]],
};
const VEH_COL = { FOLLOW3: [236, 196, 30], BIRD1: [236, 236, 230] };
const WV_LIGHT_CSS = { w: '#fff6dc', y: '#ffd67a', r: '#ff4636', g: '#5cff96', b: '#6c8cff', o: '#ffc884', f: '#ffffff' };

function wvRng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s >>> 0) / 4294967296; }; }
function mixC(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
function rgb(c, a) { return a === undefined || a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`; }
function sunPos(ms, lat, lon) {
  const d = (ms - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + 0.98560028 * d) * DEG, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG, e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24; const ha = (gmst * 15 + lon) * DEG - ra; const la = lat * DEG;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { az: Geo.norm360(az / DEG), el: el / DEG };
}

class WindowView {
  constructor(container, traffic) {
    this.wrap = container; this.tr = traffic; this.canvas = el('canvas', { 'aria-label': 'Out-of-window view from the tower cab' }); container.append(this.canvas); this.ctx = this.canvas.getContext('2d');
    const tw = GM(D.ground.tower[0], D.ground.tower[1]); this.cam = { x: tw.x, y: tw.y, z: 47 };
    this.heading = 28; this.pitch = -9; this.fov = 78; this.vis = 30000; this.tod = 'day'; this.tags = false; this.simTime = 10.5 * 3600;
    this.t0 = performance.now();
    this.world = this.buildWorld();
    this.sprites = {}; this.spriteTod = '';
    new ResizeObserver(() => this.resize()).observe(container); this.resize();
    let lastTap = 0;
    new PanZoom(this.canvas, {
      dragStart: (di) => { di.drag = 'look'; },
      drag: (di, dx, dy) => { this.heading = Geo.norm360(this.heading - dx * this.fov / this.W); this.pitch = clamp(this.pitch + dy * this.fov / this.W, -32, 6); App.feature('windowPan'); },
      zoom: (f) => { this.fov = clamp(this.fov / f, 8, 100); App.feature('windowZoom'); },
      tap: () => { const now = performance.now(); if (now - lastTap < 320) { this.fov = 78; this.pitch = -9; } lastTap = now; },
    });
  }
  get night() { return this.tod === 'night'; }
  set night(v) { this.tod = v ? 'night' : 'day'; }
  resize() { const r = this.wrap.getBoundingClientRect(); this.dpr = Math.min(1.5, window.devicePixelRatio || 1); this.W = Math.max(10, r.width); this.H = Math.max(10, r.height); this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr); }

  /* ---------- static world ---------- */
  buildWorld() {
    const rnd = wvRng(20261031);
    const M = (la, lo) => GM(la, lo);
    const W = { fields: [], pave: [], twyStrips: [], twyLines: [], rwys: [], marks: [], hpLines: [], buildings: [], masts: [], lights: [], villages: [], stars: [], clouds: [], skyline: [] };
    // aerodrome outline: convex hull of runway ends and pavement, grown by 380 m
    const pts = [];
    for (const r of D.rwys) { pts.push(M(...r.thr)); }
    for (const poly of D.ground.pave) for (const p of poly[0]) pts.push(M(p[0], p[1]));
    const hull = convexHull(pts); const cx = hull.reduce((a, p) => a + p.x, 0) / hull.length, cy = hull.reduce((a, p) => a + p.y, 0) / hull.length;
    W.hull = hull.map(p => { const dx = p.x - cx, dy = p.y - cy, L = Math.hypot(dx, dy) || 1; return { x: p.x + dx / L * 380, y: p.y + dy / L * 380 }; });
    // field patchwork outside the aerodrome: jittered 520 m grid within 9.5 km
    const S = 520, N = 19, jit = {}; const J = (i, j) => { const k = i + ',' + j; if (!jit[k]) { const r2 = wvRng((i + 100) * 7919 + (j + 100) * 104729); jit[k] = { x: i * S + (r2() - 0.5) * 220, y: j * S + (r2() - 0.5) * 220 }; } return jit[k]; };
    for (let i = -N; i < N; i++) for (let j = -N; j < N; j++) {
      const c = { x: (i + 0.5) * S, y: (j + 0.5) * S }; const d = Math.hypot(c.x - this.cam.x, c.y - this.cam.y); if (d > 9500) continue;
      if (pointInPoly(c, W.hull)) continue;
      const r2 = wvRng((i + 300) * 31337 + (j + 300) * 7919 + 17); let col = FIELD_COLS[Math.floor(r2() * FIELD_COLS.length)];
      const forest = r2() < 0.16; if (forest) col = [52, 70, 44];
      const village = !forest && r2() < 0.05; if (village) { col = [118, 104, 92]; W.villages.push({ x: c.x, y: c.y, n: 6 + Math.floor(r2() * 10), seed: Math.floor(r2() * 1e6) }); }
      W.fields.push({ pts: [J(i, j), J(i + 1, j), J(i + 1, j + 1), J(i, j + 1)], col, forest, d });
    }
    // pavement and taxiway strips
    for (const poly of D.ground.pave) W.pave.push(poly.map(ring => ring.map(p => M(p[0], p[1]))));
    const strip = (a, b, w) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; const nx = -dy / L * w / 2, ny = dx / L * w / 2; return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }]; };
    for (const t of D.ground.twy) { const p = t.p.map(q => M(q[0], q[1])); W.twyLines.push(p); for (let i = 1; i < p.length; i++) if (Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) > 2) W.twyStrips.push(strip(p[i - 1], p[i], 21)); }
    // runways, markings
    const quad = (a, ux, uy, s0, s1, o0, o1) => { const nx = -uy, ny = ux; return [{ x: a.x + ux * s0 + nx * o0, y: a.y + uy * s0 + ny * o0 }, { x: a.x + ux * s1 + nx * o0, y: a.y + uy * s1 + ny * o0 }, { x: a.x + ux * s1 + nx * o1, y: a.y + uy * s1 + ny * o1 }, { x: a.x + ux * s0 + nx * o1, y: a.y + uy * s0 + ny * o1 }]; };
    for (const id of ['06', '12']) {
      const r = D.rwys.find(x => x.id === id); const a = M(...r.thr), b = M(...r.end); const L = Math.hypot(b.x - a.x, b.y - a.y); const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      W.rwys.push({ id, a, b, L, ux, uy, pts: quad(a, ux, uy, 0, L, -22.5, 22.5) });
      const mk = [];
      mk.push(quad(a, ux, uy, 0, L, -22.0, -21.1), quad(a, ux, uy, 0, L, 21.1, 22.0));
      for (let s = 60; s < L - 60; s += 50) mk.push(quad(a, ux, uy, s, s + 30, -0.45, 0.45));
      for (const end of [0, 1]) { // threshold stripes, aiming point, touchdown zone at both ends
        const o = end ? b : a, vx = end ? -ux : ux, vy = end ? -uy : uy;
        for (let k = 0; k < 6; k++) { const off = 3 + k * 3.4; mk.push(quad(o, vx, vy, 6, 36, off, off + 1.8), quad(o, vx, vy, 6, 36, -off - 1.8, -off)); }
        mk.push(quad(o, vx, vy, 400, 460, 9, 16), quad(o, vx, vy, 400, 460, -16, -9));
        for (const [s, n] of [[150, 3], [300, 2], [600, 2], [750, 1], [900, 1]]) for (let k = 0; k < n; k++) { const off = 4 + k * 3; mk.push(quad(o, vx, vy, s, s + 22.5, off, off + 1.8), quad(o, vx, vy, s, s + 22.5, -off - 1.8, -off)); }
      }
      W.marks.push(...mk.map(p => ({ pts: p, rwy: id })));
    }
    for (const h of D.ground.hp) { const p = h.p.map(q => M(q[0], q[1])); if (p.length >= 2) W.hpLines.push({ n: h.n, a: p[0], b: p[p.length - 1] }); }
    // buildings: piers next to contact gates, hangar, cargo, a few generic blocks behind aprons
    const box = (c, hdg, len, wid, h, col, glass) => { const u = { x: Math.sin(hdg * DEG), y: Math.cos(hdg * DEG) }; const n = { x: u.y, y: -u.x }; const p = []; for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.push({ x: c.x + u.x * a * len / 2 + n.x * b * wid / 2, y: c.y + u.y * a * len / 2 + n.y * b * wid / 2 }); return { base: p, h, col, glass: !!glass, c }; };
    for (const g of D.ground.gates) {
      const s = M(g.lat, g.lon); const u = { x: Math.sin(g.hdg * DEG), y: Math.cos(g.hdg * DEG) };
      if (/Hangar/.test(g.n)) W.buildings.push(box({ x: s.x + u.x * 70, y: s.y + u.y * 70 }, g.hdg, 70, 95, 26, [176, 180, 186]));
      else if (/Cargo/.test(g.n)) W.buildings.push(box({ x: s.x + u.x * 60, y: s.y + u.y * 60 }, g.hdg, 55, 130, 15, [168, 162, 150]));
      else if (/South/.test(g.n)) W.buildings.push(box({ x: s.x + u.x * 55, y: s.y + u.y * 55 }, g.hdg, 30, 70, 11, [190, 186, 176], true));
      else W.buildings.push(box({ x: s.x + u.x * 42, y: s.y + u.y * 42 }, g.hdg, 22, 90, 13, [196, 200, 206], true));
    }
    // landside and support buildings: random blocks east to south of the tower, kept off pavement and taxiways
    { const r3 = wvRng(4242); const twyPts = []; for (const t of W.twyLines) for (const q of t) twyPts.push(q);
      const rw = D.rwys.filter(r => r.id === '06' || r.id === '12').map(r => { const a = M(...r.thr), b = M(...r.end); return { a, b }; });
      const segDist = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y; const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy), 0, 1); return Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t); };
      const onPave = (p) => W.pave.some(poly => pointInPoly(p, poly[0]));
      for (let brg = 70; brg <= 135; brg += 6) for (let dist = 380; dist <= 1400; dist += 80) {
        if (r3() > 0.34) continue; const a = (brg + (r3() - 0.5) * 5) * DEG, dd = dist + (r3() - 0.5) * 40; const p = { x: this.cam.x + Math.sin(a) * dd, y: this.cam.y + Math.cos(a) * dd };
        if (onPave(p) || rw.some(r => segDist(p, r.a, r.b) < 200) || twyPts.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 70)) continue;
        const kind = r3(); const hdg = Math.round(r3() * 3) * 30 + 15;
        let bl; if (kind < 0.25) bl = box(p, hdg, 60 + r3() * 40, 30 + r3() * 20, 8 + r3() * 5, [150, 152, 156]);
        else if (kind < 0.7) bl = box(p, hdg, 20 + r3() * 30, 16 + r3() * 18, 8 + r3() * 10, [178 + r3() * 30, 172 + r3() * 28, 162 + r3() * 26], r3() < 0.5);
        else bl = box(p, hdg, 30 + r3() * 30, 24 + r3() * 16, 12 + r3() * 10, [120 + r3() * 40, 136 + r3() * 30, 150 + r3() * 30], true);
        bl.lit = 0.2 + r3() * 0.6; W.buildings.push(bl);
      }
    }
    // apron floodlight masts on every third stand, offset behind the stand
    D.ground.stands.forEach((s, i) => { if (i % 3) return; const p = M(s.lat, s.lon); W.masts.push({ x: p.x + 38, y: p.y - 22, h: 24 }); });
    // ---- lights ----
    const Lt = W.lights; const add = (x, y, z, c, kind, extra) => Lt.push({ x, y, z, c, kind, i: Lt.length, ...extra });
    { // RWY 06/24 (24 in use: approach from the north-east)
      const r = W.rwys.find(q => q.id === '06'); const a24 = r.b, ux = -r.ux, uy = -r.uy, L = r.L; const nx = -uy, ny = ux;
      for (let s = 0; s <= L + 0.1; s += 60) for (const sg of [-1, 1]) add(a24.x + ux * s + nx * 23.5 * sg, a24.y + uy * s + ny * 23.5 * sg, 0.4, s > L - 600 ? 'y' : 'w', 'rwy');
      for (let s = 7.5; s < L; s += 15) { const left = L - s; const c = left < 300 ? 'r' : left < 900 ? ((Math.round(s / 15) % 2) ? 'r' : 'w') : 'w'; add(a24.x + ux * s, a24.y + uy * s, 0.1, c, 'cl'); }
      for (let s = 60; s <= 900; s += 60) for (const sg of [-1, 1]) for (let k = 0; k < 3; k++) { const o = (9 + k * 1.5) * sg; add(a24.x + ux * s + nx * o, a24.y + uy * s + ny * o, 0.1, 'w', 'tdz'); }
      for (let o = -22.5; o <= 22.6; o += 3) add(a24.x + nx * o, a24.y + ny * o, 0.4, 'g', 'thr');
      for (let k = 0; k < 5; k++) for (const sg of [-1, 1]) { const o = (25 + k * 3) * sg; add(a24.x + nx * o, a24.y + ny * o, 0.4, 'g', 'thr'); }
      const e = r.a; for (let o = -21; o <= 21.1; o += 6) add(e.x + nx * o, e.y + ny * o, 0.4, 'r', 'end');
      // approach lighting RWY 24 (CAT II/III): centreline barrettes, crossbars, red side rows, sequenced flashers
      for (let s = 30; s <= 900; s += 30) { for (let k = -2; k <= 2; k++) add(a24.x - ux * s + nx * k * 1.0, a24.y - uy * s + ny * k * 1.0, 1 + s * 0.004, 'w', 'als'); if (s >= 300) add(a24.x - ux * s, a24.y - uy * s, 1.6 + s * 0.004, 'f', 'sfl', { seq: (900 - s) / 600 }); }
      for (const s of [150, 300]) for (let o = -15; o <= 15.1; o += 1.5) add(a24.x - ux * s + nx * o, a24.y - uy * s + ny * o, 1 + s * 0.004, 'w', 'als');
      for (let s = 30; s <= 270; s += 30) for (const sg of [-1, 1]) for (let k = 0; k < 3; k++) { const o = (9 + k * 1.5) * sg; add(a24.x - ux * s + nx * o, a24.y - uy * s + ny * o, 1 + s * 0.004, 'r', 'als'); }
    }
    for (const t of W.twyLines) { let acc = 0; for (let i = 1; i < t.length; i++) { const a = t[i - 1], b = t[i]; const L = Math.hypot(b.x - a.x, b.y - a.y); let s = (30 - acc) % 30; while (s <= L) { add(a.x + (b.x - a.x) * s / L, a.y + (b.y - a.y) * s / L, 0.1, 'g', 'twy'); s += 30; } acc = (acc + L) % 30; } }
    for (const h of W.hpLines) { const L = Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y); const n = Math.max(2, Math.round(L / 3)); for (let k = 0; k <= n; k++) add(h.a.x + (h.b.x - h.a.x) * k / n, h.a.y + (h.b.y - h.a.y) * k / n, 0.3, 'r', 'stop', { hp: h.n }); }
    for (const m of W.masts) add(m.x, m.y, m.h, 'o', 'mast');
    for (const b of W.buildings) if (b.h >= 20) for (const p of b.base) add(p.x, p.y, b.h + 0.5, 'r', 'obst');
    for (const v of W.villages) { const r2 = wvRng(v.seed); for (let k = 0; k < v.n; k++) add(v.x + (r2() - 0.5) * 380, v.y + (r2() - 0.5) * 380, 3, 'o', 'town'); }
    // stars (azimuth/elevation), clouds (world), Prague skyline (azimuth band)
    for (let k = 0; k < 320; k++) W.stars.push({ az: rnd() * 360, el: 2 + Math.pow(rnd(), 0.7) * 80, m: 0.25 + rnd() * 0.75, tw: rnd() * 6.28 });
    for (let k = 0; k < 46; k++) { const ang = rnd() * 6.283, dist = 2500 + Math.sqrt(rnd()) * 30000; const base = 1300 + rnd() * 900; const n = 6 + Math.floor(rnd() * 9); const puffs = []; const sz = 160 + rnd() * 260; for (let q = 0; q < n; q++) puffs.push({ dx: (rnd() - 0.5) * sz * 4.2, dy: (rnd() - 0.5) * sz * 2.6, dz: rnd() * sz * 0.9, r: sz * (0.55 + rnd() * 0.7) }); puffs.sort((p1, p2) => p1.dz - p2.dz); W.clouds.push({ x: this.cam.x + Math.sin(ang) * dist, y: this.cam.y + Math.cos(ang) * dist, z: base, puffs }); }
    for (let az = 84; az <= 138; az += 0.35) { const r2 = rnd(); if (r2 < 0.55) W.skyline.push({ az, w: 0.12 + rnd() * 0.3, h: 0.04 + Math.pow(rnd(), 2.2) * (az > 108 && az < 122 ? 0.24 : 0.12) }); }
    W.tvTower = { az: 102.2, dist: 13550, h: 216 + 270 - 360 }; // Žižkov TV tower: top relative to aerodrome level (m)
    return W;
  }

  /* ---------- projection ---------- */
  setupCam() {
    const h = this.heading * DEG, p = this.pitch * DEG; this.sh = Math.sin(h); this.ch = Math.cos(h); this.sp = Math.sin(p); this.cp = Math.cos(p);
    this.F = (this.W / 2) / Math.tan(this.fov / 2 * DEG); this.cxS = this.W / 2; this.cyS = this.H / 2;
    this.horY = this.cyS + this.F * Math.tan(p);
  }
  T(x, y, z) { const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z; const r = dx * this.ch - dy * this.sh; const fh = dx * this.sh + dy * this.ch; return { f: fh * this.cp + dz * this.sp, r, u: -fh * this.sp + dz * this.cp, d: Math.hypot(dx, dy) }; }
  S(q) { return { x: this.cxS + this.F * q.r / q.f, y: this.cyS - this.F * q.u / q.f }; }
  dirS(az, el) { const a = az * DEG, e = el * DEG; const v = { x: Math.sin(a) * Math.cos(e), y: Math.cos(a) * Math.cos(e), z: Math.sin(e) }; const r = v.x * this.ch - v.y * this.sh; const fh = v.x * this.sh + v.y * this.ch; const f = fh * this.cp + v.z * this.sp, u = -fh * this.sp + v.z * this.cp; if (f <= 0.01) return null; return { x: this.cxS + this.F * r / f, y: this.cyS - this.F * u / f }; }
  elevY(el) { return this.cyS - this.F * Math.tan(el * DEG - this.pitch * DEG); }
  clip(qs) { const out = [], N = 1; for (let i = 0; i < qs.length; i++) { const a = qs[i], b = qs[(i + 1) % qs.length]; const ai = a.f > N, bi = b.f > N; if (ai) out.push(a); if (ai !== bi) { const t = (N - a.f) / (b.f - a.f); out.push({ f: N, r: a.r + (b.r - a.r) * t, u: a.u + (b.u - a.u) * t, d: a.d + (b.d - a.d) * t }); } } return out; }
  polyPath(c, pts, z = 0) { const qs = this.clip(pts.map(p => this.T(p.x, p.y, p.z ?? z))); if (qs.length < 3) return false; let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9; const ss = qs.map(q => { const s = this.S(q); if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x; if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y; return s; }); if (maxX < -5 || minX > this.W + 5 || maxY < -5 || minY > this.H + 5) return false; c.moveTo(ss[0].x, ss[0].y); for (let i = 1; i < ss.length; i++) c.lineTo(ss[i].x, ss[i].y); c.closePath(); return true; }
  fogK(d) { return Math.exp(-3 * d / this.vis); }
  fogged(col, d) { const k = this.fogK(d); return mixC(this.P.fog, col, k); }

  /* ---------- sprites ---------- */
  buildSprites() {
    const mk = (size, stops) => { const cv = document.createElement('canvas'); cv.width = cv.height = size; const g = cv.getContext('2d'); const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); for (const [o, c] of stops) gr.addColorStop(o, c); g.fillStyle = gr; g.fillRect(0, 0, size, size); return cv; };
    const L = { w: [255, 246, 222], y: [255, 214, 120], r: [255, 52, 40], g: [70, 255, 140], b: [80, 120, 255], o: [255, 196, 120], f: [255, 255, 255] };
    this.sprites = {}; for (const [k, c] of Object.entries(L)) this.sprites[k] = mk(64, [[0, `rgba(255,255,255,1)`], [0.12, `rgba(${c},1)`], [0.32, `rgba(${c},0.38)`], [1, `rgba(${c},0)`]]);
    const P = this.P; const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 54, 4, 64, 64, 64); gr.addColorStop(0, rgb(P.cloudTop, 0.95)); gr.addColorStop(0.55, rgb(mixC(P.cloudTop, P.cloudBot, 0.5), 0.75)); gr.addColorStop(1, rgb(P.cloudBot, 0)); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    this.sprites.cloud = cv;
    this.sprites.pool = mk(64, [[0, 'rgba(255,200,130,0.55)'], [0.5, 'rgba(255,180,110,0.18)'], [1, 'rgba(255,170,100,0)']]);
    this.spriteTod = this.tod;
  }

  /* ---------- frame ---------- */
  draw(now) {
    if (!this.W) return; const c = this.ctx; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.P = WV_TOD[this.tod]; this.G = WV_GROUND[this.tod]; if (this.spriteTod !== this.tod) this.buildSprites();
    this.setupCam(); const t = (now - this.t0) / 1000; this.time = t;
    const fogAmt = clamp(1 - (this.vis - 600) / 7400, 0, 0.96);
    if (this.tod === 'day') { const s = sunPos(Date.UTC(2026, 9, 31) + this.simTime * 1000, 50.106, 14.266); this.sun = s; }
    else if (this.tod === 'dusk') this.sun = { az: 252, el: -3.5 }; else this.sun = { az: 0, el: -40 };
    const sv = { x: Math.sin(this.sun.az * DEG) * Math.cos(this.sun.el * DEG), y: Math.cos(this.sun.az * DEG) * Math.cos(this.sun.el * DEG), z: Math.sin(this.sun.el * DEG) }; this.sunV = sv;
    this.drawSky(c, fogAmt, t);
    this.drawFarLand(c, fogAmt, t);
    this.drawGround(c);
    this.drawObjects(c, t);
    this.drawLights(c, t);
    this.drawFrame(c);
  }
  drawSky(c, fogAmt, t) {
    const P = this.P; const W = this.W, hy = this.horY;
    const yAt = (e) => this.elevY(e);
    const top = Math.min(0, yAt(Math.min(70, 80 + this.pitch))); const g = c.createLinearGradient(0, top, 0, hy);
    const col = (cc) => rgb(mixC(cc, P.fog, fogAmt));
    const pos = (e) => clamp((yAt(e) - top) / Math.max(1, hy - top), 0, 1);
    g.addColorStop(0, col(P.zen)); g.addColorStop(pos(18), col(P.mid)); g.addColorStop(pos(5), col(P.low)); g.addColorStop(pos(0.8), col(P.hor)); g.addColorStop(1, col(P.hor));
    c.fillStyle = g; c.fillRect(0, 0, W, this.H); // whole canvas: nothing from the previous frame may survive
    // sun glow and disc
    if (this.sun.el > -12) {
      const s = this.dirS(this.sun.az, this.sun.el); const glowCol = this.tod === 'dusk' ? '255,150,90' : '255,244,220';
      if (s && s.x > -W && s.x < 2 * W) {
        const R = this.F * (this.tod === 'dusk' ? 1.5 : 0.9) * (1 - fogAmt * 0.5); const gr = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, R);
        const a0 = this.tod === 'dusk' ? 0.95 : 0.55; gr.addColorStop(0, `rgba(${glowCol},${a0 * (1 - fogAmt)})`); gr.addColorStop(0.3, `rgba(${glowCol},${a0 * 0.35 * (1 - fogAmt)})`); gr.addColorStop(1, `rgba(${glowCol},0)`);
        c.fillStyle = gr; c.fillRect(0, 0, W, hy + 2);
        if (this.sun.el > 0 && fogAmt < 0.8) { const r = Math.max(3, this.F * Math.tan(0.27 * DEG)); c.fillStyle = `rgba(255,253,240,${1 - fogAmt})`; c.beginPath(); c.arc(s.x, s.y, r, 0, 6.283); c.fill(); }
      }
    }
    // stars
    if (P.stars > 0 && fogAmt < 0.6) {
      c.fillStyle = '#ffffff';
      for (const st of this.world.stars) { const s = this.dirS(st.az, st.el); if (!s || s.x < 0 || s.x > W || s.y < 0 || s.y > hy) continue; const a = P.stars * st.m * (0.75 + 0.25 * Math.sin(t * 2.3 + st.tw)) * (1 - fogAmt) * clamp(st.el / 8, 0.2, 1); c.globalAlpha = a; const r = st.m > 0.85 ? 1.3 : 0.8; c.fillRect(s.x - r / 2, s.y - r / 2, r, r); }
      c.globalAlpha = 1;
    }
    // clouds drift towards 060 (wind 240/08)
    if (fogAmt < 0.75) {
      const drift = t * 4.1; const ox = Math.sin(60 * DEG) * drift, oy = Math.cos(60 * DEG) * drift;
      const list = [];
      for (const cl of this.world.clouds) { const q = this.T(cl.x + ox, cl.y + oy, cl.z); if (q.f < 200) continue; list.push({ cl, q }); }
      list.sort((a, b) => b.q.f - a.q.f);
      const sp = this.sprites.cloud;
      for (const { cl, q } of list) {
        const fade = clamp(1.25 - q.d / 30000, 0, 1) * (1 - fogAmt) * (this.tod === 'night' ? 0.55 : 1); if (fade <= 0.02) continue;
        c.globalAlpha = fade;
        for (const p of cl.puffs) { const qq = this.T(cl.x + ox + p.dx, cl.y + oy + p.dy, cl.z + p.dz); if (qq.f < 100) continue; const s = this.S(qq); const r = this.F * p.r / qq.f; if (s.x + r < 0 || s.x - r > W || s.y + r < 0 || s.y - r > hy + r) continue; c.drawImage(sp, s.x - r, s.y - r * 0.8, 2 * r, 1.6 * r); }
      }
      c.globalAlpha = 1;
    }
  }
  drawFarLand(c, fogAmt, t) {
    const P = this.P; const W = this.W; const hy = this.horY;
    const farFog = clamp(1 - this.vis / 12000, 0, 1);
    const base = mixC(P.far, P.fog, Math.max(farFog, 0.25));
    // distant forest and hills just above and below the geometric horizon
    const yLow = this.elevY(-1.2);
    c.fillStyle = rgb(base); c.beginPath(); c.moveTo(0, yLow);
    const step = 6; for (let x = 0; x <= W + step; x += step) { const az = this.heading + Math.atan((x - this.cxS) / this.F) / DEG; const n = Math.sin(az * 0.21) * 0.5 + Math.sin(az * 0.53 + 1.3) * 0.3 + Math.sin(az * 1.7) * 0.12 + Math.sin(az * 4.1) * 0.06; const e = -0.16 + 0.32 * n + (az > 190 && az < 250 ? 0.18 : 0); c.lineTo(x, this.elevY(e)); }
    c.lineTo(W, yLow); c.closePath(); c.fill();
    // Prague skyline to the east and the Žižkov TV tower
    if (this.vis > 9000) {
      const k = clamp((this.vis - 9000) / 9000, 0, 1); const sky = mixC(P.skyLand, P.fog, 0.35);
      c.fillStyle = rgb(sky, 0.85 * k);
      for (const b of this.world.skyline) { const s1 = this.dirS(b.az, 0), s2 = this.dirS(b.az + b.w, 0); if (!s1 || !s2) continue; const y0 = this.elevY(-0.05), y1 = this.elevY(-0.05 + b.h); if (s2.x < 0 || s1.x > W) continue; c.fillRect(s1.x, y1, Math.max(1, s2.x - s1.x), y0 - y1); }
      const tv = this.world.tvTower; const top = Math.atan2(tv.h - this.cam.z, tv.dist) / DEG; const st = this.dirS(tv.az, 0);
      if (st && st.x > -20 && st.x < W + 20) {
        const yb = this.elevY(-0.06), yt = this.elevY(top); const w = Math.max(1.2, this.F * 30 / tv.dist);
        c.fillRect(st.x - w / 2, yt, w, yb - yt); c.fillRect(st.x - w, yt + (yb - yt) * 0.35, w * 2, Math.max(1, (yb - yt) * 0.08));
        if (this.tod !== 'day') { const on = (t % 1.5) < 0.75; if (on) { c.fillStyle = `rgba(255,60,40,${k})`; c.fillRect(st.x - 1.2, yt - 1.2, 2.4, 2.4); } }
      }
      if (this.tod !== 'day') { // city lights: warm dots along the skyline and a glow over the city
        const s = this.dirS(112, 0); if (s) { const R = this.F * Math.tan(30 * DEG); const gr = c.createRadialGradient(s.x, this.elevY(0), 0, s.x, this.elevY(0), R); gr.addColorStop(0, `rgba(255,170,90,${0.22 * k})`); gr.addColorStop(1, 'rgba(255,170,90,0)'); c.fillStyle = gr; c.fillRect(s.x - R, this.elevY(12), 2 * R, this.elevY(-1) - this.elevY(12)); }
        c.fillStyle = `rgba(255,214,150,${0.9 * k})`; const r2 = wvRng(7);
        for (let i = 0; i < 260; i++) { const az = 84 + r2() * 54, e = -0.22 + r2() * 0.24; const p = this.dirS(az, e); if (p && p.x > 0 && p.x < W) c.fillRect(p.x, p.y, 1, 1); }
      }
    }
  }
  drawGround(c) {
    const G = this.G, P = this.P; const w = this.world;
    // whole ground under the horizon first
    c.fillStyle = rgb(this.fogged(mixC(G.grass, P.far, 0.4), 6000)); c.fillRect(0, this.elevY(-0.55), this.W, this.H);
    // fields far to near
    const vis = this.vis;
    const fields = w.fields; const order = fields.map(f => ({ f, d: Math.hypot(f.pts[0].x - this.cam.x, f.pts[0].y - this.cam.y) })).filter(o => o.d < vis * 1.4 + 600).sort((a, b) => b.d - a.d);
    const night = this.tod === 'night', dusk = this.tod === 'dusk';
    for (const { f, d } of order) { c.beginPath(); if (!this.polyPath(c, f.pts)) continue; let col = f.col; if (night) col = mixC(col, [8, 10, 9], 0.88); else if (dusk) col = mixC(col, [30, 30, 36], 0.6); c.fillStyle = rgb(this.fogged(col, d)); c.fill(); }
    // aerodrome grass
    c.beginPath(); if (this.polyPath(c, w.hull)) { c.fillStyle = rgb(this.fogged(G.grass, 1200)); c.fill(); }
    // pavement (apron) and taxiways
    c.beginPath(); let any = false; for (const poly of w.pave) for (const ring of poly) any = this.polyPath(c, ring) || any; if (any) { c.fillStyle = rgb(this.fogged(G.concrete, 900)); c.fill('evenodd'); }
    c.beginPath(); any = false; for (const s of w.twyStrips) any = this.polyPath(c, s) || any; if (any) { c.fillStyle = rgb(this.fogged(G.twy, 900)); c.fill(); }
    for (const r of w.rwys) { c.beginPath(); if (this.polyPath(c, r.pts)) { const mid = { x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 }; c.fillStyle = rgb(this.fogged(G.asphalt, Math.hypot(mid.x - this.cam.x, mid.y - this.cam.y))); c.fill(); } }
    // markings (white) and taxi lines (yellow), only within a useful range
    const markRange = Math.min(5500, vis * 1.1);
    c.beginPath(); any = false; for (const m of w.marks) { const p = m.pts[0]; const d = Math.hypot(p.x - this.cam.x, p.y - this.cam.y); if (d > markRange) continue; any = this.polyPath(c, m.pts) || any; }
    if (any) { c.fillStyle = rgb(this.fogged(G.paint, Math.min(markRange, 2500)), 0.9); c.fill(); }
    const lineBuckets = [[0, 500, 1.4], [500, 1200, 0.9], [1200, 2600, 0.6]];
    c.strokeStyle = rgb(this.fogged(G.yellow, 900), 0.85); c.lineCap = 'round';
    for (const [d0, d1, lw] of lineBuckets) {
      if (d0 > vis) break; c.lineWidth = lw; c.beginPath();
      for (const line of w.twyLines) for (let i = 1; i < line.length; i++) { const a = line[i - 1], b = line[i]; const d = Math.hypot(a.x - this.cam.x, a.y - this.cam.y); if (d < d0 || d >= d1) continue; const qa = this.T(a.x, a.y, 0), qb = this.T(b.x, b.y, 0); if (qa.f < 2 || qb.f < 2) continue; const sa = this.S(qa), sb = this.S(qb); c.moveTo(sa.x, sa.y); c.lineTo(sb.x, sb.y); }
      c.stroke();
    }
    // holding position markings
    c.strokeStyle = rgb(this.fogged(G.yellow, 900)); c.lineWidth = 1.6; c.beginPath();
    for (const h of w.hpLines) { const qa = this.T(h.a.x, h.a.y, 0), qb = this.T(h.b.x, h.b.y, 0); if (qa.f < 2 || qb.f < 2 || qa.d > vis) continue; const sa = this.S(qa), sb = this.S(qb); c.moveTo(sa.x, sa.y); c.lineTo(sb.x, sb.y); }
    c.stroke();
    // apron floodlight pools
    if (this.tod !== 'day') { c.globalCompositeOperation = 'lighter'; for (const m of w.masts) { const q = this.T(m.x, m.y, 0); if (q.f < 5 || q.d > vis * 1.3) continue; const s = this.S(q); const rx = this.F * 70 / q.f, ry = rx * Math.max(0.12, (this.cam.z) / Math.max(q.d, 1)); c.globalAlpha = 0.8 * this.fogK(q.d * 0.6); c.drawImage(this.sprites.pool, s.x - rx, s.y - ry, 2 * rx, 2 * ry); } c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
  }
  /* ---------- 3D objects ---------- */
  acFaces(it, p) {
    const dims = AC_DIMS[it.type] || [36, 34]; const L = dims[0], SP = dims[1]; const R = L * 0.053; const zc = R + Math.max(1.4, L * 0.04);
    const liv = LIVERY[it.cs.slice(0, 3)] || [[236, 238, 242], [120, 130, 150], [190, 192, 198]];
    const body = liv[0], tail = liv[1], eng = liv[2], wing = [196, 200, 206], belly = mixC(body, [150, 154, 160], 0.35);
    const F = [];
    const st = [[0.5, 0, -0.2], [0.485, 0.42, -0.12], [0.455, 0.76, -0.04], [0.39, 0.96, 0], [0.30, 1, 0], [-0.24, 1, 0], [-0.37, 0.7, 0.28], [-0.5, 0.18, 0.62]];
    const ring = (x, r, dz) => { const out = []; for (let k = 0; k < 8; k++) { const a = k / 8 * 6.2832; out.push([x * L, Math.cos(a) * r * R, zc + dz * R + Math.sin(a) * r * R]); } return out; };
    const rings = st.map(s => ring(s[0], s[1], s[2]));
    for (let i = 1; i < rings.length; i++) for (let k = 0; k < 8; k++) { const a = rings[i - 1][k], b = rings[i - 1][(k + 1) % 8], cc = rings[i][(k + 1) % 8], d = rings[i][k]; const lower = Math.sin((k + 0.5) / 8 * 6.2832) < -0.2; F.push({ v: [a, b, cc, d], c: lower ? belly : body, closed: true }); }
    const w0 = 0.07 * L, w1 = -0.13 * L, sweep = Math.tan(26 * DEG) * SP / 2, tipC = 0.32 * (w0 - w1), zw = zc - 0.55 * R;
    for (const sg of [-1, 1]) {
      F.push({ v: [[w0, sg * R * 0.9, zw], [w0 - sweep, sg * SP / 2, zw + SP * 0.03], [w0 - sweep - tipC, sg * SP / 2, zw + SP * 0.03], [w1, sg * R * 0.9, zw]], c: wing, two: true });
      const hs = SP * 0.17, h0 = -0.36 * L, h1 = -0.48 * L, zh = zc + 0.25 * R;
      F.push({ v: [[h0, sg * R * 0.4, zh], [h0 - hs * 0.6, sg * hs, zh + 0.2], [h0 - hs * 0.6 - 0.35 * (h0 - h1), sg * hs, zh + 0.2], [h1, sg * R * 0.3, zh]], c: wing, two: true });
      const ey = sg * SP * 0.18, ex0 = 0.15 * L, ex1 = 0.03 * L, ez = zw - R * 0.75, er = R * 0.5;
      const er1 = [], er2 = []; for (let k = 0; k < 6; k++) { const a = k / 6 * 6.2832; er1.push([ex0, ey + Math.cos(a) * er, ez + Math.sin(a) * er]); er2.push([ex1, ey + Math.cos(a) * er * 0.85, ez + Math.sin(a) * er * 0.85]); }
      for (let k = 0; k < 6; k++) F.push({ v: [er1[k], er1[(k + 1) % 6], er2[(k + 1) % 6], er2[k]], c: eng, closed: true });
      F.push({ v: er1.slice().reverse(), c: [30, 32, 36], closed: true });
    }
    if ((it.alt || 0) < 12) { // landing gear: nose leg and two main legs with wheels
      const leg = (x, y, z1, w) => { F.push({ v: [[x + w, y, 0.2], [x - w, y, 0.2], [x - w, y, z1], [x + w, y, z1]], c: [70, 72, 76], two: true }); F.push({ v: [[x + 0.6, y - 0.35, 0], [x - 0.6, y - 0.35, 0], [x - 0.6, y - 0.35, 1.1], [x + 0.6, y - 0.35, 1.1]], c: [24, 24, 26], two: true }); F.push({ v: [[x + 0.6, y + 0.35, 0], [x - 0.6, y + 0.35, 0], [x - 0.6, y + 0.35, 1.1], [x + 0.6, y + 0.35, 1.1]], c: [24, 24, 26], two: true }); };
      leg(0.36 * L, 0, zc - R * 0.95, 0.18); leg(-0.03 * L, -R * 1.6, zw, 0.3); leg(-0.03 * L, R * 1.6, zw, 0.3);
    }
    const fz0 = zc + R * 0.7, fz1 = zc + R + 0.16 * L;
    F.push({ v: [[-0.29 * L, 0, fz0], [-0.43 * L, 0, fz1], [-0.505 * L, 0, fz1], [-0.49 * L, 0, fz0]], c: tail, two: true, fin: true });
    return { F, L, SP, zc, R };
  }
  drawObjects(c, t) {
    const vis = this.vis; const objs = [];
    for (const b of this.world.buildings) { const q = this.T(b.c.x, b.c.y, b.h / 2); if (q.f < 3 || q.d > vis * 1.3) continue; objs.push({ kind: 'bld', b, f: q.f, d: q.d }); }
    for (const it of this.tr.items) { const p = this.tr.pos(it); const q = this.T(p.x, p.y, (it.alt || 0) + 4); if (q.f < 3 || q.d > vis * 1.5) continue; objs.push({ kind: it.kind === 'veh' ? 'veh' : 'ac', it, p, f: q.f, d: q.d }); }
    for (const m of this.world.masts) { const q = this.T(m.x, m.y, m.h / 2); if (q.f < 3 || q.d > vis) continue; objs.push({ kind: 'mast', m, f: q.f, d: q.d }); }
    objs.sort((a, b) => b.f - a.f);
    // shadows first (sunlit day only): aircraft and vehicles
    if (this.tod === 'day' && this.sunV.z > 0.08 && vis > 1500) {
      c.beginPath(); let any = false;
      for (const o of objs) if (o.kind === 'ac') { const m = this.acFaces(o.it, o.p); for (const f of m.F) { const w = f.v.map(v => this.toWorld(v, o)).map(v => ({ x: v.x - v.z / this.sunV.z * this.sunV.x, y: v.y - v.z / this.sunV.z * this.sunV.y, z: 0 })); any = this.polyPath(c, w) || any; } }
      if (any) { c.fillStyle = 'rgba(10,14,20,0.30)'; c.fill('nonzero'); }
    }
    for (const o of objs) {
      if (o.kind === 'bld') this.drawBuilding(c, o.b, o.d);
      else if (o.kind === 'ac') this.drawAircraft(c, o, t);
      else if (o.kind === 'veh') this.drawVehicle(c, o, t);
      else if (o.kind === 'mast') { const a = this.T(o.m.x, o.m.y, 0), b = this.T(o.m.x, o.m.y, o.m.h); if (a.f < 2 || b.f < 2) continue; const sa = this.S(a), sb = this.S(b); c.strokeStyle = rgb(this.fogged(this.tod === 'day' ? [120, 124, 130] : [30, 30, 34], o.d)); c.lineWidth = Math.max(0.6, this.F * 0.5 / a.f); c.beginPath(); c.moveTo(sa.x, sa.y); c.lineTo(sb.x, sb.y); c.stroke(); }
    }
    if (this.tags) { c.font = '600 11px "Barlow Condensed", sans-serif'; c.textBaseline = 'bottom'; for (const o of objs) if (o.kind === 'ac' || o.kind === 'veh') { const q = this.T(o.p.x, o.p.y, (o.it.alt || 0) + 14); if (q.f < 3) continue; const s = this.S(q); c.fillStyle = 'rgba(0,0,0,0.45)'; const w = c.measureText(o.it.cs).width; c.fillRect(s.x - w / 2 - 3, s.y - 15, w + 6, 14); c.fillStyle = o.it.kind === 'arr' ? '#7df0a4' : o.it.kind === 'dep' ? '#8fd0ff' : '#ffc560'; c.fillText(o.it.cs, s.x - w / 2, s.y - 2); } }
  }
  toWorld(v, o) {
    const h = o.p.hdg * DEG; const pitch = (o.it.phase === 'air' || o.it.phase === 'ga') ? 8 * DEG : o.it.phase === 'final' ? 2.5 * DEG : 0;
    const x = v[0] * Math.cos(pitch) - (v[2]) * Math.sin(pitch) * 0, zAdd = v[0] * Math.sin(pitch);
    const fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h);
    return { x: o.p.x + fx * x + rx * v[1], y: o.p.y + fy * x + ry * v[1], z: (o.it.alt || 0) + v[2] + zAdd };
  }
  shade(col, n, d, boost = 0) {
    const P = this.P; const s = this.sunV; const lam = Math.max(0, n.x * s.x + n.y * s.y + n.z * s.z); const sky = 0.5 + 0.5 * n.z;
    let k = P.amb * (0.65 + 0.35 * sky) + P.dif * lam + boost; k = clamp(k, 0, 1.25);
    return rgb(this.fogged([col[0] * k, col[1] * k, col[2] * k], d));
  }
  drawAircraft(c, o, t) {
    const m = this.acFaces(o.it, o.p); const faces = [];
    for (const f of m.F) {
      const w = f.v.map(v => this.toWorld(v, o)); const qs = w.map(v => this.T(v.x, v.y, v.z)); if (qs.some(q => q.f < 1)) continue;
      const a = w[0], b = w[1], cc = w[2], dd = w[3] || w[2]; let ux, uy, uz, vx, vy, vz;
      if (w.length === 4) { ux = cc.x - a.x; uy = cc.y - a.y; uz = cc.z - a.z; vx = dd.x - b.x; vy = dd.y - b.y; vz = dd.z - b.z; } else { ux = b.x - a.x; uy = b.y - a.y; uz = b.z - a.z; vx = cc.x - a.x; vy = cc.y - a.y; vz = cc.z - a.z; if (w.length > 4) { const e = w[Math.floor(w.length / 2)]; vx = e.x - a.x; vy = e.y - a.y; vz = e.z - a.z; } }
      let n = { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx }; const nl = Math.hypot(n.x, n.y, n.z) || 1; n = { x: n.x / nl, y: n.y / nl, z: n.z / nl };
      if (f.closed) n = { x: -n.x, y: -n.y, z: -n.z };
      let mx = 0, my = 0, mz = 0; for (const q of w) { mx += q.x; my += q.y; mz += q.z; } mx = mx / w.length - this.cam.x; my = my / w.length - this.cam.y; mz = mz / w.length - this.cam.z; const facing = n.x * mx + n.y * my + n.z * mz;
      if (f.closed && facing > 0.0001) continue; if (!f.closed && facing > 0) n = { x: -n.x, y: -n.y, z: -n.z };
      faces.push({ ss: qs.map(q => this.S(q)), depth: qs.reduce((s, q) => s + q.f, 0) / qs.length, col: f.c, n, fin: f.fin });
    }
    faces.sort((a, b) => b.depth - a.depth);
    const boostFin = this.tod !== 'day' ? 0.35 : 0;
    c.lineJoin = 'round';
    for (const f of faces) { c.beginPath(); c.moveTo(f.ss[0].x, f.ss[0].y); for (let i = 1; i < f.ss.length; i++) c.lineTo(f.ss[i].x, f.ss[i].y); c.closePath(); const fill = this.shade(f.col, f.n, o.d, f.fin ? boostFin : 0); c.fillStyle = fill; c.strokeStyle = fill; c.lineWidth = 0.6; c.fill(); c.stroke(); }
    // aircraft lights are drawn in the light pass
    o.m = m;
    (this.acLights || (this.acLights = [])).push(o);
  }
  drawVehicle(c, o) {
    const col = VEH_COL[o.it.cs] || [236, 196, 30]; const h = o.p.hdg * DEG; const fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h);
    const P = (a, b, z) => ({ x: o.p.x + fx * a + rx * b, y: o.p.y + fy * a + ry * b, z });
    const top = [P(2.5, 1, 1.7), P(2.5, -1, 1.7), P(-2.5, -1, 1.7), P(-2.5, 1, 1.7)];
    const sides = [[P(2.5, 1, 0), P(2.5, -1, 0), P(2.5, -1, 1.7), P(2.5, 1, 1.7)], [P(-2.5, 1, 0), P(-2.5, -1, 0), P(-2.5, -1, 1.7), P(-2.5, 1, 1.7)], [P(2.5, 1, 0), P(-2.5, 1, 0), P(-2.5, 1, 1.7), P(2.5, 1, 1.7)], [P(2.5, -1, 0), P(-2.5, -1, 0), P(-2.5, -1, 1.7), P(2.5, -1, 1.7)]];
    for (const s of sides) { c.beginPath(); if (this.polyPath(c, s)) { c.fillStyle = this.shade(col, { x: 0, y: 0, z: 0 }, o.d); c.fill(); } }
    c.beginPath(); if (this.polyPath(c, top)) { c.fillStyle = this.shade(col, { x: 0, y: 0, z: 1 }, o.d, 0.1); c.fill(); }
    (this.vehLights || (this.vehLights = [])).push(o);
  }
  drawBuilding(c, b, d) {
    const G = this.tod; const col = G === 'day' ? b.col : G === 'dusk' ? mixC(b.col, [40, 40, 50], 0.65) : mixC(b.col, [14, 14, 18], 0.88);
    const walls = []; for (let i = 0; i < 4; i++) { const a = b.base[i], bb = b.base[(i + 1) % 4]; const q = this.T((a.x + bb.x) / 2, (a.y + bb.y) / 2, b.h / 2); walls.push({ a, b: bb, f: q.f }); }
    walls.sort((x, y) => y.f - x.f);
    for (const w of walls) {
      const n = { x: -(w.b.y - w.a.y), y: (w.b.x - w.a.x), z: 0 }; const nl = Math.hypot(n.x, n.y) || 1; n.x /= nl; n.y /= nl;
      const mid = { x: (w.a.x + w.b.x) / 2 - this.cam.x, y: (w.a.y + w.b.y) / 2 - this.cam.y }; if (n.x * mid.x + n.y * mid.y > 0) continue;
      const quad = [{ x: w.a.x, y: w.a.y, z: 0 }, { x: w.b.x, y: w.b.y, z: 0 }, { x: w.b.x, y: w.b.y, z: b.h }, { x: w.a.x, y: w.a.y, z: b.h }];
      c.beginPath(); if (!this.polyPath(c, quad)) continue; c.fillStyle = this.shade(col, n, d); c.fill();
      if (b.glass) {
        const band = [{ x: w.a.x, y: w.a.y, z: b.h * 0.25 }, { x: w.b.x, y: w.b.y, z: b.h * 0.25 }, { x: w.b.x, y: w.b.y, z: b.h * 0.8 }, { x: w.a.x, y: w.a.y, z: b.h * 0.8 }]; c.beginPath();
        if (this.polyPath(c, band)) {
          c.fillStyle = this.tod === 'day' ? rgb(this.fogged([92, 120, 146], d), 0.85) : rgb(this.fogged([255, 190, 120], d * 0.5), (this.tod === 'night' ? 0.42 : 0.3) * (b.lit ?? 1)); c.fill();
          const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y); const n = Math.min(24, Math.floor(len / 7)); if (n > 1 && d < Math.min(2500, this.vis * 0.8)) { c.strokeStyle = this.tod === 'day' ? rgb(this.fogged([40, 52, 64], d), 0.5) : 'rgba(12,10,8,0.65)'; c.lineWidth = 1; c.beginPath(); for (let k = 1; k < n; k++) { const f = k / n; const x = w.a.x + (w.b.x - w.a.x) * f, y = w.a.y + (w.b.y - w.a.y) * f; const q1 = this.T(x, y, b.h * 0.25), q2 = this.T(x, y, b.h * 0.8); if (q1.f < 2 || q2.f < 2) continue; const s1 = this.S(q1), s2 = this.S(q2); c.moveTo(s1.x, s1.y); c.lineTo(s2.x, s2.y); } c.stroke(); }
        }
      }
    }
    c.beginPath(); if (this.polyPath(c, b.base.map(p => ({ x: p.x, y: p.y, z: b.h })))) { c.fillStyle = this.shade(col, { x: 0, y: 0, z: 1 }, d, -0.05); c.fill(); }
  }
  /* ---------- lights ---------- */
  drawLights(c, t) {
    const P = this.P; const day = this.tod === 'day'; const vis = this.vis; const lvp = vis < 3000;
    const k0 = day ? (lvp ? 0.75 : 0) : P.lightsK; const lightVis = vis * 1.8;
    c.globalCompositeOperation = day ? 'source-over' : 'lighter';
    const sp = this.sprites; const stopOff = new Set(); for (const it of this.tr.items) if (it.phase === 'lineup') stopOff.add('HP 24');
    const flash = (t * 2) % 1; const small = {};
    if (k0 > 0) for (const L of this.world.lights) {
      if (L.kind === 'stop' && stopOff.has(L.hp)) continue;
      if (day && (L.kind === 'town' || L.kind === 'mast' || L.kind === 'obst')) continue;
      if (L.kind === 'sfl') { if (Math.abs(flash - L.seq) > 0.06) continue; }
      const q = this.T(L.x, L.y, L.z); if (q.f < 4 || q.d > lightVis) continue;
      if ((L.kind === 'twy' || L.kind === 'town') && q.d > 1800 && (L.i & 1)) continue;
      const s = this.S(q); if (s.x < -10 || s.x > this.W + 10 || s.y < -10 || s.y > this.H + 10) continue;
      const fk = Math.exp(-3 * q.d / lightVis); let a = k0 * fk; if (a < 0.03) continue;
      let r = clamp(this.F * 0.9 / q.f, 1.1, 6) * (L.kind === 'mast' ? 2.2 : L.kind === 'sfl' ? 3 : L.kind === 'town' ? 0.8 : 1) * (1 + (1 - fk) * (lvp ? 2.2 : 0.6));
      if (L.kind === 'twy' || L.kind === 'stop') r *= 0.85; if (L.kind === 'obst') r *= 1.1;
      if (r < 2.4 && !lvp) { (small[L.c] || (small[L.c] = [])).push(s.x, s.y, r, Math.min(1, a)); continue; }
      c.globalAlpha = Math.min(1, a); c.drawImage(sp[L.c] || sp.w, s.x - r, s.y - r, 2 * r, 2 * r);
      if (lvp && L.kind !== 'twy') { const R = r * 4.5; c.globalAlpha = Math.min(0.35, a * 0.4); c.drawImage(sp[L.c] || sp.w, s.x - R, s.y - R, 2 * R, 2 * R); }
    }
    // small, distant lights as plain squares, batched by colour (much cheaper than sprites)
    for (const [col, arr] of Object.entries(small)) { c.fillStyle = WV_LIGHT_CSS[col] || '#fff'; for (let i = 0; i < arr.length; i += 4) { c.globalAlpha = arr[i + 3]; const z = Math.max(1, arr[i + 2] * 0.9); c.fillRect(arr[i] - z / 2, arr[i + 1] - z / 2, z, z); } }
    // aircraft and vehicle lights (also by day: beacons, strobes, landing lights)
    const blink = (per, on, off = 0) => ((t + off) % per) < on;
    for (const o of (this.acLights || [])) {
      const m = o.m, it = o.it; const moving = it.phase !== 'stand' && it.phase !== 'parked'; const rwy = ['roll', 'air', 'final', 'landroll', 'ga', 'lineup'].includes(it.phase);
      const L = [];
      const tipF = 0.07 * m.L - Math.tan(26 * DEG) * m.SP / 2 - 0.3; const zw = m.zc - 0.55 * m.R + m.SP * 0.03;
      if (!day) { L.push([[tipF, -m.SP / 2, zw], 'r', 1], [[tipF, m.SP / 2, zw], 'g', 1], [[-0.5 * m.L, 0, m.zc + m.R * 0.6], 'w', 0.9]); }
      if (moving && blink(1.1, 0.12, o.d * 0.001)) { L.push([[0, 0, m.zc + m.R + 0.2], 'r', day ? 1.6 : 1.4], [[0, 0, m.zc - m.R - 0.2], 'r', day ? 1.4 : 1.2]); }
      if (rwy && (blink(1.25, 0.06) || blink(1.25, 0.06, -0.12))) { L.push([[tipF, -m.SP / 2, zw], 'f', day ? 2.2 : 2], [[tipF, m.SP / 2, zw], 'f', day ? 2.2 : 2]); }
      if (['final', 'roll', 'air', 'ga'].includes(it.phase)) { L.push([[0.1 * m.L, -m.R * 1.4, m.zc - m.R * 0.6], 'w', day ? 3.4 : 3.6], [[0.1 * m.L, m.R * 1.4, m.zc - m.R * 0.6], 'w', day ? 3.4 : 3.6]); }
      else if (moving && !day) L.push([[0.42 * m.L, 0, 1.2], 'w', 1.6]);
      for (const [v, col, size] of L) {
        const w = this.toWorld(v, o); const q = this.T(w.x, w.y, w.z); if (q.f < 3) continue; const s = this.S(q);
        const fk = Math.exp(-3 * q.d / lightVis); const r = clamp(this.F * 0.8 / q.f, 1.2, 7) * size * (1 + (1 - fk) * 0.8);
        c.globalAlpha = Math.min(1, (day ? 0.95 : 1) * fk); c.drawImage(sp[col], s.x - r, s.y - r, 2 * r, 2 * r);
      }
    }
    for (const o of (this.vehLights || [])) { if (!blink(0.8, 0.4, o.d * 0.002)) continue; const q = this.T(o.p.x, o.p.y, 2.1); if (q.f < 3) continue; const s = this.S(q); const r = clamp(this.F * 0.8 / q.f, 1.2, 6) * 1.5; c.globalAlpha = Math.exp(-3 * q.d / lightVis); c.drawImage(sp.o, s.x - r, s.y - r, 2 * r, 2 * r); }
    this.acLights = []; this.vehLights = [];
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  drawFrame(c) {
    const W = this.W, H = this.H;
    // cab mullions fixed in the world: 12 glazing panels
    const frameCol = this.tod === 'day' ? '#15181c' : '#060708';
    for (let k = 0; k < 12; k++) { const az = k * 30 + 15; const s = this.dirS(az, 0); if (!s || s.x < -10 || s.x > W + 10) continue; const w = clamp(this.F * 0.012, 2.5, 7); const g = c.createLinearGradient(s.x - w / 2, 0, s.x + w / 2, 0); g.addColorStop(0, frameCol); g.addColorStop(0.5, this.tod === 'day' ? '#2a3038' : '#0c0e11'); g.addColorStop(1, frameCol); c.fillStyle = g; c.fillRect(s.x - w / 2, 0, w, H); }
    // roof edge and console sill
    let g = c.createLinearGradient(0, 0, 0, H * 0.06); g.addColorStop(0, '#0b0d10'); g.addColorStop(1, 'rgba(11,13,16,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H * 0.06);
    g = c.createLinearGradient(0, H - 16, 0, H); g.addColorStop(0, 'rgba(8,10,12,0)'); g.addColorStop(1, '#08090b'); c.fillStyle = g; c.fillRect(0, H - 16, W, 16);
    if (this.tod !== 'day') { g = c.createLinearGradient(0, H * 0.7, 0, H); g.addColorStop(0, 'rgba(60,110,170,0)'); g.addColorStop(1, 'rgba(60,110,170,0.07)'); c.fillStyle = g; c.fillRect(0, H * 0.7, W, H * 0.3); }
    // heading readout
    c.font = '600 12px "IBM Plex Mono", monospace'; c.textBaseline = 'bottom';
    const zoom = (78 / this.fov); const txt = `HDG ${String(Math.round(this.heading) || 360).padStart(3, '0')}  ×${zoom.toFixed(1)}  VIS ${this.vis >= 10000 ? '10 km+' : this.vis >= 1000 ? (this.vis / 1000).toFixed(1) + ' km' : Math.round(this.vis) + ' m'}`;
    const tw = c.measureText(txt).width; c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(8, H - 26, tw + 12, 20); c.fillStyle = 'rgba(255,255,255,0.88)'; c.fillText(txt, 14, H - 9);
  }
}

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y); const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function pointInPoly(pt, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside; } return inside; }
