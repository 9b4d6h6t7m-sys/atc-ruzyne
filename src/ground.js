'use strict';
/* Aerodrome: surface movement display (A-SMGCS style) with scripted demo traffic, RIMCAS demo, false targets and an out-of-window view. */
const GC = {
  bg: '#5c5865', pave: '#7b7a82', twy: '#77767e', rwy: '#a33a3d', rwyOff: '#6d6670', cl: 'rgba(255,255,255,0.75)', twyCl: 'rgba(235,205,80,0.55)',
  arr: '#63e08c', dep: '#5db8ff', veh: '#ffad33', stand: 'rgba(240,240,248,0.85)', hp: '#ff4a3d', label: '500 12px "Barlow Condensed", "Avenir Next Condensed", sans-serif',
};
const GM = (lat, lon) => Geo.toM(lat, lon); // metres east/north of ARP
const RW24 = RWY['24'], RW06 = RWY['06'];
const THR24 = GM(...RW24.thr), THR06 = GM(...RW06.thr);
const U24 = { x: Math.sin(RW24.crs * DEG), y: Math.cos(RW24.crs * DEG) };
const onRwy24 = (d) => ({ x: THR24.x + U24.x * d, y: THR24.y + U24.y * d });

function pathFrom(latlons) { return latlons.map(([la, lo]) => GM(la, lo)); }
function polyLen(p) { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return s; }
function along(p, d) {
  for (let i = 1; i < p.length; i++) {
    const L = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    if (d <= L || i === p.length - 1) { const t = L ? clamp(d / L, 0, 1) : 0; return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * t, y: p[i - 1].y + (p[i].y - p[i - 1].y) * t, hdg: Geo.norm360(Math.atan2(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) / DEG) }; }
    d -= L;
  }
  const n = p.length - 1; return { x: p[n].x, y: p[n].y, hdg: 0 };
}

const GROUND_PATHS = {
  depTaxi: pathFrom([[50.10707, 14.26319], [50.10775, 14.26394]]),
  depTaxi2: pathFrom([[50.10775, 14.26394], [50.10806, 14.26326], [50.10822, 14.26275], [50.11068, 14.26536], [50.11289, 14.27281], [50.11391, 14.27623], [50.11444, 14.27651], [50.11503, 14.27606], [50.11522, 14.27556]]),
  lineUp: pathFrom([[50.11522, 14.27556], [50.11550, 14.27482], [50.11555, 14.27300]]),
  arrTaxi: pathFrom([[50.10810, 14.24721], [50.10816, 14.25056], [50.10795, 14.25196], [50.10592, 14.25773], [50.10519, 14.25938], [50.10470, 14.26146], [50.10416, 14.26151]]),
  follow: pathFrom([[50.10148, 14.26706], [50.10147, 14.26835], [50.10545, 14.28173], [50.10536, 14.28325], [50.10435, 14.28537], [50.10413, 14.28585]]),
  bird: pathFrom([[50.11068, 14.26537], [50.11200, 14.26560], [50.11345, 14.26520], [50.11360, 14.26200], [50.11420, 14.26190], [50.11650, 14.26290]]),
};

class GroundTraffic {
  constructor() { this.t = 0; this.items = []; this.alerts = []; this.falseT = null; this.nextFalse = 8; this.events = []; this.reset(); }
  reset() {
    this.items = [
      { cs: 'TVS7K3', type: 'B38M', kind: 'dep', stand: '19', phase: 'stand', t0: 4, d: 0, spd: 0, size: 36, alt: 0, info: 'SID VENOX 5A · RWY 24' },
      { cs: 'EZS98KH', type: 'A320', kind: 'arr', stand: '7', phase: 'final', d: -5600, spd: 70, size: 36, alt: 300, info: 'LSGG-LKPR · RWY 24' },
      { cs: 'FOLLOW3', type: 'VEH', kind: 'veh', phase: 'loop', d: 0, spd: 8, size: 6, alt: 0, info: 'FOLLOW-ME' },
    ];
  }
  spawnBird() {
    this.items = this.items.filter(i => i.cs !== 'BIRD1');
    this.items.push({ cs: 'BIRD1', type: 'VEH', kind: 'veh', phase: 'bird', d: 0, spd: 9, size: 6, alt: 0, info: 'BIRD CONTROL', hold: 0 });
    const arr = this.items.find(i => i.cs === 'EZS98KH');
    if (arr) { Object.assign(arr, { phase: 'final', d: -5200, spd: 68, alt: 290, ga: false }); }
    else this.items.push({ cs: 'EZS98KH', type: 'A320', kind: 'arr', stand: '7', phase: 'final', d: -5200, spd: 68, size: 36, alt: 290, info: 'LSGG-LKPR · RWY 24' });
  }
  pos(it) {
    switch (it.phase) {
      case 'stand': { const p = GROUND_PATHS.depTaxi[0]; return { x: p.x, y: p.y, hdg: 216 }; }
      case 'push': { const q = along(GROUND_PATHS.depTaxi, it.d); return { x: q.x, y: q.y, hdg: Geo.norm360(q.hdg + 180) }; }
      case 'taxi': return along(GROUND_PATHS.depTaxi2, it.d);
      case 'hold': return along(GROUND_PATHS.depTaxi2, polyLen(GROUND_PATHS.depTaxi2));
      case 'lineup': return along(GROUND_PATHS.lineUp, it.d);
      case 'roll': case 'air': { const p = onRwy24(104 + it.d); return { x: p.x, y: p.y, hdg: RW24.crs }; }
      case 'final': case 'landroll': { const p = onRwy24(it.d); return { x: p.x, y: p.y, hdg: RW24.crs }; }
      case 'ga': { const p = onRwy24(it.d); return { x: p.x, y: p.y, hdg: RW24.crs }; }
      case 'exit': return along(GROUND_PATHS.arrTaxi, it.d);
      case 'parked': return along(GROUND_PATHS.arrTaxi, polyLen(GROUND_PATHS.arrTaxi));
      case 'loop': { const L = polyLen(GROUND_PATHS.follow); const dd = it.d % (2 * L); const q = dd < L ? along(GROUND_PATHS.follow, dd) : along(GROUND_PATHS.follow, 2 * L - dd); return dd < L ? q : { ...q, hdg: Geo.norm360(q.hdg + 180) }; }
      case 'bird': return along(GROUND_PATHS.bird, it.d);
    }
    return { x: 0, y: 0, hdg: 0 };
  }
  step(dt) {
    this.t += dt; const kt = 0.5144;
    for (const it of this.items) {
      switch (it.phase) {
        case 'stand': if (this.t > it.t0) { it.phase = 'push'; it.d = 0; this.ev(`${it.cs} PUSHBACK STAND ${it.stand}`); } break;
        case 'push': it.d += 2 * dt; if (it.d >= polyLen(GROUND_PATHS.depTaxi)) { it.phase = 'taxi'; it.d = 0; this.ev(`${it.cs} TAXI RWY 24`); } break;
        case 'taxi': it.d += 9 * dt; if (it.d >= polyLen(GROUND_PATHS.depTaxi2)) { it.phase = 'hold'; it.hold = this.t; this.ev(`${it.cs} HOLDING POINT RWY 24`); } break;
        case 'hold': if (this.t - it.hold > 12 && !this.rwyBusy(it)) { it.phase = 'lineup'; it.d = 0; } break;
        case 'lineup': it.d += 5 * dt; if (it.d >= polyLen(GROUND_PATHS.lineUp)) { it.phase = 'roll'; it.d = 0; it.spd = 0; this.ev(`${it.cs} TAKE-OFF RWY 24`); } break;
        case 'roll': it.spd = Math.min(165 * kt, it.spd + 2.0 * dt); it.d += it.spd * dt; if (it.spd > 150 * kt) { it.phase = 'air'; } break;
        case 'air': it.spd = Math.min(180 * kt, it.spd + 1 * dt); it.d += it.spd * dt; it.alt += 9 * dt; if (it.d > 9000) { Object.assign(it, { phase: 'stand', t0: this.t + 25, d: 0, spd: 0, alt: 0 }); } break;
        case 'final': {
          it.d += it.spd * dt; it.alt = Math.max(0, -it.d * Math.tan(3 * DEG) + 15);
          if (this.bird && this.bird.onRwy && it.d > -1200 && !it.ga) { it.ga = true; it.phase = 'ga'; this.ev(`${it.cs} GO AROUND (RWY OCCUPIED)`); }
          if (it.d >= 380) { it.phase = 'landroll'; it.alt = 0; this.ev(`${it.cs} LANDED RWY 24`); }
          break; }
        case 'ga': it.d += it.spd * dt; it.alt += 8 * dt; it.spd = Math.min(170 * kt, it.spd + 1 * dt); if (it.d > 7000) { Object.assign(it, { phase: 'final', d: -9000, spd: 68, alt: 470, ga: false }); } break;
        case 'landroll': it.spd = Math.max(9, it.spd - 2.2 * dt); it.d += it.spd * dt; if (it.d >= 2060) { it.phase = 'exit'; it.d = 0; this.ev(`${it.cs} VACATED RWY 24`); } break;
        case 'exit': it.spd = 8; it.d += it.spd * dt; if (it.d >= polyLen(GROUND_PATHS.arrTaxi)) { it.phase = 'parked'; it.parkT = this.t; } break;
        case 'parked': if (this.t - it.parkT > 20) Object.assign(it, { phase: 'final', d: -9000, spd: 68, alt: 470, ga: false }); break;
        case 'loop': it.d += it.spd * dt; break;
        case 'bird': {
          const L = polyLen(GROUND_PATHS.bird);
          const p = this.pos(it);
          it.onRwy = this.distToRwy24(p) < 30;
          if (it.onRwy && it.hold < 22) { it.hold += dt; } else it.d += it.spd * dt;
          if (it.d >= L) this.items = this.items.filter(x => x !== it);
          break; }
      }
    }
    this.bird = this.items.find(i => i.cs === 'BIRD1') || null;
    // RIMCAS: vehicle on runway while an arrival is on final
    this.alerts = [];
    const arr = this.items.find(i => i.kind === 'arr' && (i.phase === 'final'));
    if (this.bird && this.bird.onRwy && arr) { const dist = -arr.d; this.alerts.push({ stage: dist < 2200 ? 2 : 1, a: this.bird, b: arr }); }
    // false target from ground clutter
    if (this.falseT) { if (this.t > this.falseT.until) this.falseT = null; }
    else if (this.t > this.nextFalse) { const spots = [[50.1131, 14.2556], [50.1009, 14.2423], [50.0985, 14.2702]]; const s = pick(spots); const m = GM(s[0], s[1]); this.falseT = { x: m.x + rnd(-40, 40), y: m.y + rnd(-40, 40), until: this.t + rnd(2.5, 5) }; this.nextFalse = this.t + rnd(12, 24); App.feature('falseTarget'); }
  }
  rwyBusy(except) { return this.items.some(i => i !== except && (i.phase === 'roll' || i.phase === 'landroll' || (i.phase === 'final' && i.d > -2800) || (i.cs === 'BIRD1' && i.onRwy))); }
  distToRwy24(p) { const vx = p.x - THR24.x, vy = p.y - THR24.y; const s = vx * U24.x + vy * U24.y; const e = Math.abs(vx * U24.y - vy * U24.x); return (s < -60 || s > 3760) ? 999 : e; }
  ev(t) { this.events.push(t); if (this.events.length > 40) this.events.shift(); if (this.onEvent) this.onEvent(t); }
}

class GroundView {
  constructor(container, traffic) {
    this.wrap = container; this.tr = traffic; this.canvas = el('canvas'); container.append(this.canvas); this.ctx = this.canvas.getContext('2d');
    this.map = document.createElement('canvas'); this.mapKey = '';
    const tw = GM(D.ground.tower[0], D.ground.tower[1]);
    this.cx = tw.x - 350; this.cy = tw.y + 250; this.scale = 0.30; this.sel = null; this.hits = []; this.lastAlert = 0;
    this.pz = new PanZoom(this.canvas, {
      hit: (x, y) => this.hit(x, y),
      tap: (di) => { const h = di.target; this.sel = h ? h.it : null; if (h) App.feature('groundTap', di.type); },
      dragStart: (di) => { di.drag = 'pan'; }, drag: (di, dx, dy) => { this.cx -= dx / this.scale; this.cy += dy / this.scale; },
      zoom: (f, x, y) => { const b = this.s2w(x, y); this.scale = clamp(this.scale * f, 0.05, 3); const a = this.s2w(x, y); this.cx += b.x - a.x; this.cy += b.y - a.y; },
      pan: (dx, dy) => { this.cx -= dx / this.scale; this.cy += dy / this.scale; },
      hover: (x, y) => { const h = x === null ? null : this.hit(x, y); this.hover = h ? h.it : null; },
    });
    new ResizeObserver(() => this.resize()).observe(container); this.resize();
  }
  resize() { const r = this.wrap.getBoundingClientRect(); this.dpr = Math.min(2, window.devicePixelRatio || 1); this.W = Math.max(10, r.width); this.H = Math.max(10, r.height); for (const c of [this.canvas, this.map]) { c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr); } this.mapKey = ''; }
  w2s(x, y) { return { x: this.W / 2 + (x - this.cx) * this.scale, y: this.H / 2 - (y - this.cy) * this.scale }; }
  s2w(x, y) { return { x: this.cx + (x - this.W / 2) / this.scale, y: this.cy - (y - this.H / 2) / this.scale }; }
  hit(x, y) { for (const h of this.hits) if (h.seq && Math.abs(h.x - x) < 47 && Math.abs(h.y - y) < 11) return h; let best = null, bd = 26; for (const h of this.hits) { if (h.seq) continue; const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } } return best; }
  renderMap() {
    const key = [this.cx.toFixed(1), this.cy.toFixed(1), this.scale.toFixed(4), this.W, this.H].join('|'); if (key === this.mapKey) return; this.mapKey = key;
    const c = this.map.getContext('2d'); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = GC.bg; c.fillRect(0, 0, this.W, this.H);
    const P = (la, lo) => { const m = GM(la, lo); return this.w2s(m.x, m.y); };
    c.fillStyle = GC.pave;
    for (const poly of D.ground.pave) { c.beginPath(); for (const ring of poly) { ring.forEach((p, i) => { const s = P(p[0], p[1]); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.closePath(); } c.fill('evenodd'); }
    c.strokeStyle = GC.twy; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = Math.max(2, 23 * this.scale);
    for (const t of D.ground.twy) { c.beginPath(); t.p.forEach((p, i) => { const s = P(p[0], p[1]); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.stroke(); }
    for (const id of ['06', '12']) { const r = RWY[id]; const a = P(...r.thr), b = P(...r.end); c.strokeStyle = GC.rwy; c.lineCap = 'butt'; c.lineWidth = Math.max(3, 45 * this.scale); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([Math.max(2, 30 * this.scale), Math.max(2, 20 * this.scale)]); c.strokeStyle = GC.cl; c.lineWidth = Math.max(0.6, 0.9 * this.scale); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]); }
    c.strokeStyle = GC.twyCl; c.lineWidth = 1; for (const t of D.ground.twy) { c.beginPath(); t.p.forEach((p, i) => { const s = P(p[0], p[1]); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.stroke(); }
    c.strokeStyle = GC.hp; c.lineWidth = Math.max(1.5, 3 * this.scale); for (const h of D.ground.hp) { if (!/24|06|13/.test(h.n)) continue; c.beginPath(); h.p.forEach((p, i) => { const s = P(p[0], p[1]); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.stroke(); }
    if (this.scale > 0.18) { c.font = GC.label; c.fillStyle = GC.stand; c.textAlign = 'center'; c.textBaseline = 'middle'; for (const s of D.ground.stands) { const q = P(s.lat, s.lon); c.fillText(s.n, q.x, q.y); } c.textAlign = 'left'; }
    if (this.scale > 0.14) { c.font = GC.label; c.fillStyle = 'rgba(245,220,120,0.9)'; const seen = new Set(); for (const t of D.ground.twy) { const n = t.n.split(' ')[0]; if (n.length > 2 || seen.has(n)) continue; seen.add(n); const m = t.p[Math.floor(t.p.length / 2)]; const q = P(m[0], m[1]); c.fillText(n, q.x + 4, q.y - 4); } }
    c.font = '600 13px "Barlow Condensed", sans-serif'; c.fillStyle = '#f2f2f6'; for (const id of ['06', '24', '12', '30']) { const r = RWY[id]; const q = P(...r.thr); const back = Geo.move({ x: 0, y: 0 }, r.crs + 180, 22); c.fillText(id, q.x + back.x - 6, q.y - back.y + 4); }
    const tw = P(D.ground.tower[0], D.ground.tower[1]); c.fillStyle = '#9fe3ff'; c.fillRect(tw.x - 4, tw.y - 4, 8, 8); c.fillText('TWR', tw.x + 7, tw.y + 4);
  }
  plane(c, s, hdg, size, col) {
    const k = Math.max(0.5, size * this.scale / 36) * 9; c.save(); c.translate(s.x, s.y); c.rotate(hdg * DEG); c.fillStyle = col;
    c.beginPath(); c.moveTo(0, -k); c.lineTo(0.18 * k, -0.5 * k); c.lineTo(k, 0.05 * k); c.lineTo(k, 0.2 * k); c.lineTo(0.18 * k, 0.05 * k); c.lineTo(0.14 * k, 0.65 * k); c.lineTo(0.45 * k, 0.85 * k); c.lineTo(0.45 * k, 0.97 * k); c.lineTo(0, 0.85 * k); c.lineTo(-0.45 * k, 0.97 * k); c.lineTo(-0.45 * k, 0.85 * k); c.lineTo(-0.14 * k, 0.65 * k); c.lineTo(-0.18 * k, 0.05 * k); c.lineTo(-k, 0.2 * k); c.lineTo(-k, 0.05 * k); c.lineTo(-0.18 * k, -0.5 * k); c.closePath(); c.fill(); c.restore();
  }
  draw(now) {
    if (!this.W) return; this.renderMap();
    const c = this.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.map, 0, 0); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.hits = []; c.font = GC.label; c.textBaseline = 'top';
    const blink = (now / 400 | 0) % 2;
    // speed vectors for airborne and rolling traffic: one tick per minute (1 and 2 min)
    for (const it of this.tr.items) {
      if (!['final', 'ga', 'air', 'roll'].includes(it.phase) || it.spd < 5) continue;
      const p = this.tr.pos(it); const s = this.w2s(p.x, p.y); const ux = Math.sin(p.hdg * DEG), uy = Math.cos(p.hdg * DEG);
      const e2 = this.w2s(p.x + ux * it.spd * 120, p.y + uy * it.spd * 120);
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(e2.x, e2.y); c.stroke();
      for (const sec of [60, 120]) { const q = this.w2s(p.x + ux * it.spd * sec, p.y + uy * it.spd * sec); const nx = -(e2.y - s.y), ny = e2.x - s.x; const L = Math.hypot(nx, ny) || 1; c.beginPath(); c.moveTo(q.x - nx / L * 5, q.y - ny / L * 5); c.lineTo(q.x + nx / L * 5, q.y + ny / L * 5); c.stroke(); }
    }
    for (const it of this.tr.items) {
      const p = this.tr.pos(it); const s = this.w2s(p.x, p.y);
      if (it.phase === 'air' && it.alt > 1070) continue; // above the 3500 ft upper filter
      const col = it.kind === 'arr' ? GC.arr : it.kind === 'dep' ? GC.dep : GC.veh;
      if (it.kind === 'veh') { c.fillStyle = col; c.save(); c.translate(s.x, s.y); c.rotate(p.hdg * DEG); c.fillRect(-3, -5, 6, 10); c.restore(); }
      else this.plane(c, s, p.hdg, it.size, col);
      if (it === this.sel) { c.strokeStyle = '#ffffff'; c.lineWidth = 1.2; c.beginPath(); c.arc(s.x, s.y, 14, 0, Math.PI * 2); c.stroke(); }
      const expanded = it === this.sel || it === this.hover;
      const altTxt = it.alt > 5 ? ' ' + String(Math.round((it.alt * 3.28 + 1158) / 100)).padStart(3, '0') : '';
      const L = [it.cs, it.kind === 'veh' ? it.info : `${it.type} ${it.kind === 'arr' ? '▼' : '▲'}${altTxt}`];
      if (expanded) { L.push(it.info); L.push(this.phaseEn(it.phase)); }
      let w = 0; for (const t of L) w = Math.max(w, c.measureText(t).width);
      const lx = s.x + 12, ly = s.y - 30;
      if (expanded) { c.fillStyle = 'rgba(20,18,26,0.7)'; c.fillRect(lx - 3, ly - 2, w + 6, L.length * 13 + 3); }
      const al = this.tr.alerts.find(a => a.a === it || a.b === it);
      if (al) { c.fillStyle = al.stage === 2 ? (blink ? '#ff3b30' : '#a51d16') : '#ffb000'; c.fillRect(lx - 3, ly - 17, 52, 14); c.fillStyle = '#1a1000'; c.fillText('RIMCAS', lx, ly - 16); }
      c.fillStyle = col; L.forEach((t, i) => c.fillText(t, lx, ly + i * 13));
      c.strokeStyle = col; c.lineWidth = 0.8; c.beginPath(); c.moveTo(s.x + 4, s.y - 4); c.lineTo(lx - 2, ly + 8); c.stroke();
      this.hits.push({ it, x: s.x, y: s.y }); this.hits.push({ it, x: lx + w / 2, y: ly + 10 });
    }
    if (this.tr.falseT && blink) { const s = this.w2s(this.tr.falseT.x, this.tr.falseT.y); c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.2; c.strokeRect(s.x - 4, s.y - 4, 8, 8); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillText('?', s.x + 7, s.y - 8); }
    if (this.tr.alerts.length && now - this.lastAlert > 2600) { this.lastAlert = now; Sound.tone('rimcas'); App.feature('rimcas'); }
    this.drawSequence(c); this.drawTargetInfo(c); this.drawStatus(c, blink);
  }
  /* Top bar modelled on the Prague tower working position: runway boxes with owner, altitude filter, met, alert state. */
  drawStatus(c, blink) {
    const W = this.W, H = 26; c.fillStyle = 'rgba(24,22,30,0.92)'; c.fillRect(0, 0, W, H); c.textBaseline = 'middle'; c.font = '600 13px "Barlow Condensed", sans-serif';
    // right side first so the left side can stop before it
    const alert = this.tr.alerts.length; const right = alert ? 'RIMCAS ALERT' : 'System Status OK'; const rw = c.measureText(right).width;
    c.fillStyle = alert ? (blink ? '#ff3b30' : '#c02a22') : '#3ccf7a'; c.fillText(right, W - rw - 10, H / 2 + 0.5);
    const lvp = this.lvp ? 'LVP' : 'NORMAL'; const lw = c.measureText(lvp).width; const lx = W - rw - lw - 26;
    c.fillStyle = this.lvp ? '#ffb000' : '#bdbac6'; c.fillText(lvp, lx, H / 2 + 0.5);
    const limit = lx - 14; let x = 8;
    const fits = (w) => x + w <= limit;
    const boxT = (txt, fg, bg, bd) => { const w = c.measureText(txt).width + 14; if (!fits(w)) return; c.fillStyle = bg; c.fillRect(x, 4, w, H - 8); c.strokeStyle = bd || fg; c.lineWidth = 1; c.strokeRect(x + 0.5, 4.5, w - 1, H - 9); c.fillStyle = fg; c.fillText(txt, x + 7, H / 2 + 0.5); x += w + 6; };
    const txt = (t, gap = 14) => { const w = c.measureText(t).width; if (!fits(w)) return; c.fillStyle = '#d7d5de'; c.fillText(t, x, H / 2 + 0.5); x += w + gap; };
    const bird = this.tr.bird && this.tr.bird.onRwy;
    boxT(`06-24 ${bird ? 'VEH' : 'TEC'}`, '#e9fff1', bird ? '#7a5a10' : '#1f6b3e', bird ? '#ffcf4d' : '#3ccf7a');
    boxT('12-30 TPC', '#ffe9e9', '#6e2226', '#ff5a5a');
    txt('LOW OFF'); txt('UP 35', 18); txt('↓24 ↑24', 18); txt(`QNH ${App.sim ? App.sim.qnh : 1009}`); txt('W 240/08', 18);
  }
  /* Sequence list on the left: departures (blue) and arrivals (green), tap selects the target. */
  drawSequence(c) {
    const items = this.tr.items.filter(i => i.kind !== 'veh' && !(i.phase === 'air' && i.alt > 1070));
    const order = { hold: 0, lineup: 0, roll: 0, taxi: 1, push: 2, stand: 3, final: 0, ga: 1, landroll: 2, exit: 3, parked: 4 };
    const deps = items.filter(i => i.kind === 'dep').sort((a, b) => (order[a.phase] ?? 5) - (order[b.phase] ?? 5));
    const arrs = items.filter(i => i.kind === 'arr').sort((a, b) => (order[a.phase] ?? 5) - (order[b.phase] ?? 5));
    let y = 34; const x = 8, w = 92; c.font = '600 12px "Barlow Condensed", sans-serif'; c.textBaseline = 'middle';
    const head = (t) => { c.fillStyle = 'rgba(215,213,222,0.75)'; c.fillText(t, x + 2, y + 6); y += 14; };
    const row = (it, col) => { c.fillStyle = it === this.sel ? 'rgba(255,255,255,0.18)' : 'rgba(18,16,24,0.78)'; c.fillRect(x, y, w, 20); c.strokeStyle = col; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, 19); c.fillStyle = col; c.fillText(it.cs, x + 6, y + 10.5); c.fillStyle = 'rgba(230,230,236,0.75)'; const ph = this.phaseShort(it.phase); c.fillText(ph, x + w - 6 - c.measureText(ph).width, y + 10.5); this.hits.push({ it, x: x + w / 2, y: y + 10, seq: true }); y += 23; };
    head('DEP'); deps.forEach(i => row(i, GC.dep)); y += 4; head('ARR'); arrs.forEach(i => row(i, GC.arr));
  }
  drawTargetInfo(c) {
    const it = this.sel; if (!it) return;
    const perf = PERF[it.type]; const wtc = it.kind === 'veh' ? '–' : (perf ? perf.wtc : 'M');
    const ms = (Sound.hash(it.cs) & 0xffffff).toString(16).toUpperCase().padStart(6, '0');
    const kt = Math.round((it.spd || 0) / 0.5144);
    const eta = it.kind === 'arr' && it.phase === 'final' ? hhmmss((App.sim ? App.sim.t : 36000) + Math.max(0, -it.d) / Math.max(it.spd, 1)).slice(0, 5) : '–';
    const rows = [['Callsign', it.cs], ['Type', it.type], ['WTC', wtc], ['Speed', `${kt} kt`], [it.kind === 'arr' ? 'ETA' : 'ETD', it.kind === 'arr' ? eta : (it.phase === 'stand' ? hhmmss((App.sim ? App.sim.t : 36000) + 120).slice(0, 5) : '–')], ['Mode S', ms], ['Stand', it.stand || '–']];
    const x = 8, w = 150, h = 18 + rows.length * 16; const y = this.H - h - 8;
    c.fillStyle = 'rgba(18,16,24,0.88)'; c.fillRect(x, y, w, h); c.strokeStyle = 'rgba(215,213,222,0.45)'; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    c.font = '600 12px "Barlow Condensed", sans-serif'; c.textBaseline = 'middle'; c.fillStyle = '#d7d5de'; c.fillText('Target Information', x + 7, y + 10);
    rows.forEach(([k, v], i) => { c.fillStyle = 'rgba(215,213,222,0.65)'; c.fillText(k, x + 7, y + 26 + i * 16); c.fillStyle = '#f2f2f6'; c.fillText(String(v), x + 70, y + 26 + i * 16); });
  }
  phaseShort(p) { return { stand: 'STND', push: 'PUSH', taxi: 'TAXI', hold: 'HOLD', lineup: 'LNUP', roll: 'ROLL', air: 'AIR', final: 'FIN', ga: 'GA', landroll: 'LAND', exit: 'VAC', parked: 'PARK' }[p] || ''; }
  phaseEn(p) { return { stand: 'ON STAND', push: 'PUSHBACK', taxi: 'TAXI', hold: 'HOLDING POINT', lineup: 'LINING UP', roll: 'TAKE-OFF ROLL', air: 'AIRBORNE', final: 'FINAL', ga: 'GO AROUND', landroll: 'LANDING ROLL', exit: 'VACATING', parked: 'PARKED', loop: 'APRON', bird: 'MANOEUVRING AREA' }[p] || p; }
}
