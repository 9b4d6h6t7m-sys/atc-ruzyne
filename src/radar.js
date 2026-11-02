'use strict';
/* Radar display in the spirit of the TopSky APP screen: map, tracks, labels, command menu. */
const RC = {
  bg: '#2a5884', tmaFill: 'rgba(10, 34, 86, 0.30)', tmaLine: 'rgba(165, 205, 242, 0.42)', ctrLine: 'rgba(215, 232, 250, 0.62)',
  border: 'rgba(238, 246, 255, 0.88)', river: 'rgba(125, 190, 240, 0.40)', ring: 'rgba(170, 205, 240, 0.16)',
  fix: 'rgba(195, 220, 245, 0.85)', fixTxt: 'rgba(195, 220, 245, 0.78)', rwy: '#ffffff', cl: 'rgba(255,255,255,0.72)',
  own: '#ffffff', unc: '#a9c8e6', pend: '#ffd36b', xfer: '#8fb6d9', stca: '#ff4d4d', sel: 'rgba(255,255,255,0.9)',
  font: '500 13px "Barlow Condensed", "Avenir Next Condensed", "Arial Narrow", sans-serif',
  fontSm: '500 11px "Barlow Condensed", "Avenir Next Condensed", "Arial Narrow", sans-serif',
};

class PanZoom {
  /* Shared pointer handling: tap, drag, pinch, wheel, hover. Callbacks receive screen coordinates in CSS px. */
  constructor(elm, h) {
    this.el = elm; this.h = h; this.p = new Map(); this.pinch = null; this.downInfo = null;
    elm.addEventListener('pointerdown', e => this.down(e));
    elm.addEventListener('pointermove', e => this.move(e));
    elm.addEventListener('pointerup', e => this.up(e));
    elm.addEventListener('pointercancel', e => this.up(e, true));
    elm.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch' && this.h.hover) this.h.hover(null, null, e); });
    elm.addEventListener('wheel', e => { e.preventDefault(); const r = this.el.getBoundingClientRect(); const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)); this.h.zoom && this.h.zoom(f, e.clientX - r.left, e.clientY - r.top, 'wheel'); }, { passive: false });
    elm.addEventListener('contextmenu', e => { e.preventDefault(); const r = this.el.getBoundingClientRect(); this.h.context && this.h.context(e.clientX - r.left, e.clientY - r.top, e); });
    let gs = 1;
    elm.addEventListener('gesturestart', e => { e.preventDefault(); gs = 1; });
    elm.addEventListener('gesturechange', e => { e.preventDefault(); const r = this.el.getBoundingClientRect(); const f = e.scale / gs; gs = e.scale; this.h.zoom && this.h.zoom(f, e.clientX - r.left || r.width / 2, e.clientY - r.top || r.height / 2, 'gesture'); });
  }
  xy(e) { const r = this.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  down(e) {
    try { this.el.setPointerCapture(e.pointerId); } catch (_) {}
    const q = this.xy(e); this.p.set(e.pointerId, q);
    App.inputSeen(e, 'down');
    if (this.p.size === 2) {
      const [a, b] = [...this.p.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      if (this.downInfo && this.downInfo.drag && this.h.dragEnd) this.h.dragEnd(this.downInfo);
      this.downInfo = null; App.gestureSeen('pinch'); return;
    }
    this.downInfo = { id: e.pointerId, x0: q.x, y0: q.y, x: q.x, y: q.y, t0: performance.now(), moved: false, type: e.pointerType, button: e.button, target: this.h.hit ? this.h.hit(q.x, q.y) : null, ev: e };
    if (this.h.pressStart) this.h.pressStart(this.downInfo);
  }
  move(e) {
    const q = this.xy(e);
    if (!this.p.has(e.pointerId)) { if (this.h.hover && (e.pointerType === 'mouse' || e.pointerType === 'pen')) this.h.hover(q.x, q.y, e); App.inputSeen(e, 'hover'); return; }
    this.p.set(e.pointerId, q);
    if (this.pinch && this.p.size === 2) {
      const [a, b] = [...this.p.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (this.h.zoom) this.h.zoom(d / this.pinch.d, mx, my, 'pinch');
      if (this.h.pan) this.h.pan(mx - this.pinch.mx, my - this.pinch.my);
      this.pinch = { d, mx, my }; return;
    }
    const di = this.downInfo; if (!di || di.id !== e.pointerId) return;
    const dx = q.x - di.x, dy = q.y - di.y; di.x = q.x; di.y = q.y;
    if (!di.moved && Math.hypot(q.x - di.x0, q.y - di.y0) > 7) { di.moved = true; if (this.h.dragStart) this.h.dragStart(di); }
    if (di.moved) { if (this.h.drag) this.h.drag(di, dx, dy); }
  }
  up(e, cancel) {
    this.p.delete(e.pointerId);
    if (this.p.size < 2) this.pinch = null;
    const di = this.downInfo; if (!di || di.id !== e.pointerId) return;
    this.downInfo = null;
    if (cancel) { if (di.moved && this.h.dragEnd) this.h.dragEnd(di); return; }
    if (di.moved) { if (this.h.dragEnd) this.h.dragEnd(di); }
    else if (this.h.tap) this.h.tap(di, performance.now() - di.t0);
  }
}

class RadarView {
  constructor(container, sim, opts = {}) {
    this.wrap = container; this.sim = sim; this.opts = opts;
    this.canvas = el('canvas'); container.append(this.canvas); this.ctx = this.canvas.getContext('2d');
    this.map = document.createElement('canvas'); this.mapKey = '';
    this.cx = opts.cx ?? 0; this.cy = opts.cy ?? -1; this.scale = opts.scale ?? 7.5; this.vecMin = 1;
    this.sel = null; this.hover = null; this.hits = []; this.W = 0; this.H = 0; this.dpr = 1; this.blink = 0;
    this.menu = opts.menu === false ? null : new CommandMenu(this);
    this.pz = new PanZoom(this.canvas, {
      hit: (x, y) => this.hitTest(x, y),
      tap: (di) => this.onTap(di),
      dragStart: (di) => {
        const t = di.target; const held = performance.now() - di.t0 > 330;
        if (t && this.opts.gestures && ((di.type === 'pen' && t.kind === 'target') || held)) { di.drag = 'vector'; this.vec = { ac: t.ac, x: di.x, y: di.y, type: di.type }; this.updVec(); return; }
        if (t && t.kind === 'label') { di.drag = 'label'; di.ac = t.ac; App.feature('labelDrag'); } else di.drag = 'pan';
      },
      drag: (di, dx, dy) => { if (di.drag === 'vector') { this.vec.x = di.x; this.vec.y = di.y; this.updVec(); return; } if (di.drag === 'label') { di.ac.labelOff.dx += dx; di.ac.labelOff.dy += dy; } else { this.cx -= dx / this.scale; this.cy += dy / this.scale; App.feature('pan'); } },
      dragEnd: (di) => { if (di.drag === 'vector') this.finishVec(); },
      zoom: (f, x, y, how) => this.zoomAt(f, x, y, how),
      pan: (dx, dy) => { this.cx -= dx / this.scale; this.cy += dy / this.scale; },
      hover: (x, y, e) => { const h = x === null ? null : this.hitTest(x, y); const ac = h ? h.ac : null; if (ac && ac !== this.hover) App.feature('hoverLabel', e && e.pointerType); this.hover = ac; this.canvas.style.cursor = ac ? 'pointer' : 'default'; },
      context: (x, y) => { const h = this.hitTest(x, y); App.feature('rightClick'); if (h) this.select(h.ac, true); },
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }
  resize() {
    const r = this.wrap.getBoundingClientRect(); this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(10, r.width); this.H = Math.max(10, r.height);
    for (const c of [this.canvas, this.map]) { c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr); }
    this.mapKey = '';
  }
  zoomAt(f, x, y, how) {
    const before = this.s2w(x, y); this.scale = clamp(this.scale * f, 1.2, 60); const after = this.s2w(x, y);
    this.cx += before.x - after.x; this.cy += before.y - after.y; App.feature('zoom', how);
  }
  w2s(x, y) { return { x: this.W / 2 + (x - this.cx) * this.scale, y: this.H / 2 - (y - this.cy) * this.scale }; }
  s2w(x, y) { return { x: this.cx + (x - this.W / 2) / this.scale, y: this.cy - (y - this.H / 2) / this.scale }; }
  /* Vector gesture: drag from a target (Pencil, or finger after a short hold) to a point = heading, to a fix = direct. */
  updVec() {
    const v = this.vec; if (!v) return; const ac = v.ac; const w = this.s2w(v.x, v.y); v.fix = null; let best = 16;
    for (const f of Object.values(FIX)) { const s = this.w2s(f.x, f.y); const d = Math.hypot(s.x - v.x, s.y - v.y); if (d < best && f.cls !== 'ndb') { best = d; v.fix = f.n; } }
    const tgt = v.fix ? FIX[v.fix] : w; v.hdg = Math.round(toMag(Geo.brg(ac.disp, tgt)) / 5) * 5 || 360;
    const a = this.w2s(ac.disp.x, ac.disp.y); v.len = Math.hypot(v.x - a.x, v.y - a.y);
  }
  finishVec() {
    const v = this.vec; this.vec = null; if (!v || v.len < 18 || !this.opts.onCommand) return;
    if (v.ac.ctl === 'unc' || v.ac.ctl === 'xfer') { toast(`${v.ac.cs} is not under your control`, 2000); return; }
    const cmd = v.fix ? { type: 'dct', fix: v.fix } : { type: 'hdg', val: v.hdg, dir: 0 };
    this.opts.onCommand(v.ac, [cmd]); App.feature(v.fix ? 'gestDct' : 'gestHdg', v.type);
  }
  hitTest(x, y) {
    for (let i = this.hits.length - 1; i >= 0; i--) { const h = this.hits[i]; if (h.kind === 'label' && x >= h.x - 4 && x <= h.x + h.w + 4 && y >= h.y - 4 && y <= h.y + h.h + 4) return h; }
    let best = null, bd = 18;
    for (const h of this.hits) if (h.kind === 'target') { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  onTap(di) {
    const h = di.target;
    if (h) { this.select(h.ac, true); App.feature('tapLabel', di.type); }
    else { this.select(null); }
  }
  select(ac, openMenu) {
    this.sel = ac; App.selAc = ac; App.emit('select', ac);
    if (this.menu) { if (ac && openMenu) { const p = this.w2s(ac.disp.x, ac.disp.y); this.menu.open(ac, p.x, p.y); } else this.menu.close(); }
    if (this.opts.onSelect) this.opts.onSelect(ac);
  }
  /* ---------- map ---------- */
  renderMap() {
    const key = [this.cx.toFixed(3), this.cy.toFixed(3), this.scale.toFixed(3), this.W, this.H, this.sim.rwy].join('|');
    if (key === this.mapKey) return; this.mapKey = key;
    const c = this.map.getContext('2d'); const dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = RC.bg; c.fillRect(0, 0, this.W, this.H);
    const path = (pts, close) => { c.beginPath(); pts.forEach((p, i) => { const q = Geo.toNM(p[0], p[1]); const s = this.w2s(q.x, q.y); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); if (close) c.closePath(); };
    for (const t of D.tma) { path(t.p, true); c.fillStyle = RC.tmaFill; c.fill(); }
    c.lineWidth = 1; c.strokeStyle = RC.tmaLine; for (const t of D.tma) { path(t.p, true); c.stroke(); }
    c.strokeStyle = RC.river; c.lineWidth = 1.2; for (const rs of Object.values(D.rivers)) for (const ln of rs) { path(ln, false); c.stroke(); }
    c.strokeStyle = RC.border; c.lineWidth = 1.3; path(D.border, true); c.stroke();
    c.setLineDash([5, 4]); c.strokeStyle = RC.ctrLine; c.lineWidth = 1; path(D.ctr, true); c.stroke(); c.setLineDash([]);
    const okl = Geo.toNM(D.okl[0], D.okl[1]); const o = this.w2s(okl.x, okl.y);
    c.strokeStyle = RC.ring; for (let r = 10; r <= 60; r += 10) { c.beginPath(); c.arc(o.x, o.y, r * this.scale, 0, Math.PI * 2); c.stroke(); }
    // extended centreline of the runway in use, ticks every NM
    const R = RWY[this.sim.rwy];
    if (R) {
      const back = Geo.norm360(R.crs + 180); c.strokeStyle = RC.cl; c.lineWidth = 1;
      const a = this.w2s(R.x, R.y), farP = Geo.move(R, back, 20), b = this.w2s(farP.x, farP.y);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      for (let n = 1; n <= 20; n++) { const p = Geo.move(R, back, n); const s = this.w2s(p.x, p.y); const len = n % 5 === 0 ? 7 : 3.5; const nx = Math.cos(back * DEG) * len, ny = Math.sin(back * DEG) * len; c.beginPath(); c.moveTo(s.x - nx, s.y - ny); c.lineTo(s.x + nx, s.y + ny); c.stroke(); }
    }
    c.strokeStyle = RC.rwy; c.lineWidth = 2.4; for (const id of ['06', '12']) { const r = RWY[id]; const a = this.w2s(r.x, r.y), b = this.w2s(r.ex, r.ey); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    // fixes and navaids
    c.font = RC.fontSm; c.textBaseline = 'middle';
    for (const f of Object.values(FIX)) {
      const s = this.w2s(f.x, f.y); if (s.x < -40 || s.y < -20 || s.x > this.W + 40 || s.y > this.H + 20) continue;
      const far = Math.hypot(f.x, f.y) > 45;
      c.strokeStyle = RC.fix; c.lineWidth = 1;
      if (f.cls === 'vor') { c.beginPath(); for (let k = 0; k < 6; k++) { const an = k * Math.PI / 3; const px = s.x + Math.cos(an) * 5, py = s.y + Math.sin(an) * 5; k ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath(); c.stroke(); c.fillStyle = RC.fix; c.fillRect(s.x - 1, s.y - 1, 2, 2); }
      else if (f.cls === 'ndb') { c.beginPath(); c.arc(s.x, s.y, 3.5, 0, Math.PI * 2); c.stroke(); }
      else { c.beginPath(); c.moveTo(s.x, s.y - 4); c.lineTo(s.x + 3.6, s.y + 2.6); c.lineTo(s.x - 3.6, s.y + 2.6); c.closePath(); if (f.cls === 'iaf') { c.fillStyle = 'rgba(195,220,245,0.35)'; c.fill(); } c.stroke(); }
      if (this.scale > 4 || !far) { c.fillStyle = RC.fixTxt; c.fillText(f.n, s.x + 6, s.y - 6); }
    }
    const ap = this.w2s(0, 0); c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = RC.fontSm; c.fillText('LKPR', ap.x + 10, ap.y + 14);
  }
  /* ---------- labels ---------- */
  lines(ac, expanded) {
    const d = ac.disp; const alt = fmtAlt(d.alt);
    const tr = d.vs > 250 ? '↑' : d.vs < -250 ? '↓' : '=';
    const gs = String(Math.round(d.gs / 10)).padStart(2, '0');
    const nf = ac.locCap ? 'LOC' + ac.ils : ac.mode === 'route' ? (ac.nextFix || '') : ('H' + String(Math.round(toMag(ac.tgtHdg))).padStart(3, '0'));
    if (ac.ctl === 'unc' || ac.ctl === 'xfer') {
      const L = [`${ac.cs}`, `${alt}${tr}${gs}`];
      if (expanded) L.push(`${ac.type}/${ac.wtc} ${ac.kind === 'dep' ? ac.sid : ac.orig}`);
      return L;
    }
    const cfl = ac.ils && ac.gsCap ? 'GS' : fmtAlt(ac.tgtAlt).replace(/^A/, 'A');
    const extra = [ac.tgtIas ? 'S' + ac.tgtIas : '', ac.ils && !ac.locCap ? 'I' + ac.ils : ''].filter(Boolean).join(' ');
    const L = [`${ac.cs} ${ac.wtc === 'M' ? '' : ac.wtc}`.trim(), `${alt}${tr}${gs} ${nf}`.trim(), `${cfl}${extra ? ' ' + extra : ''}`];
    if (expanded) { L.push(`${ac.type}/${ac.wtc} ${ac.kind === 'dep' ? 'SID ' + ac.sid : ac.star || ac.orig}`); L.push(`A${ac.sq} ${ac.kind === 'dep' ? ac.orig + '→' + (ac.dest || '') : ac.orig + '→' + ac.dest}`); }
    return L;
  }
  draw(now) {
    if (!this.W) return;
    this.renderMap();
    const c = this.ctx, dpr = this.dpr; c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.map, 0, 0); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.blink = (now / 500 | 0) % 2;
    this.hits = []; c.font = RC.font; c.textBaseline = 'top';
    const lh = 14;
    for (const ac of this.sim.ac) {
      const d = ac.disp; const s = this.w2s(d.x, d.y);
      if (s.x < -200 || s.y < -200 || s.x > this.W + 200 || s.y > this.H + 200) continue;
      const col = ac.stca ? RC.stca : ac.ctl === 'own' ? RC.own : ac.ctl === 'pend' ? RC.pend : ac.ctl === 'xfer' ? RC.xfer : RC.unc;
      // history
      for (let i = 1; i < ac.hist.length; i++) { const h = this.w2s(ac.hist[i].x, ac.hist[i].y); c.globalAlpha = 0.55 - i * 0.07; c.fillStyle = col; c.beginPath(); c.arc(h.x, h.y, 1.7, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1;
      // speed vector
      const vl = d.gs * this.vecMin / 60 * this.scale; c.strokeStyle = col; c.lineWidth = 1;
      c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + Math.sin(d.trk * DEG) * vl, s.y - Math.cos(d.trk * DEG) * vl); c.stroke();
      // symbol
      c.lineWidth = 1.4;
      if (ac.ctl === 'own' || ac.ctl === 'pend' || ac.stca) { c.strokeStyle = col; c.strokeRect(s.x - 3.5, s.y - 3.5, 7, 7); if (ac.stca) { c.beginPath(); c.arc(s.x, s.y, 9, 0, Math.PI * 2); c.stroke(); } }
      else { c.strokeStyle = col; c.beginPath(); c.moveTo(s.x - 4, s.y); c.lineTo(s.x + 4, s.y); c.moveTo(s.x, s.y - 4); c.lineTo(s.x, s.y + 4); c.stroke(); }
      this.hits.push({ kind: 'target', ac, x: s.x, y: s.y });
      // label
      const expanded = ac === this.hover || ac === this.sel;
      const L = this.lines(ac, expanded);
      let w = 0; for (const t of L) w = Math.max(w, c.measureText(t).width);
      const lx = s.x + ac.labelOff.dx, ly = s.y + ac.labelOff.dy, h = L.length * lh;
      // leader line to closest label edge
      const ax = clamp(s.x, lx, lx + w), ay = clamp(s.y, ly, ly + h);
      c.strokeStyle = col; c.globalAlpha = 0.8; c.lineWidth = 1; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(ax, ay); c.stroke(); c.globalAlpha = 1;
      if (ac.stca && this.blink) { c.fillStyle = 'rgba(150, 0, 0, 0.55)'; c.fillRect(lx - 3, ly - 2, w + 6, h + 3); }
      if (expanded) { c.fillStyle = 'rgba(5, 20, 40, 0.55)'; c.fillRect(lx - 3, ly - 2, w + 6, h + 3); c.strokeStyle = ac === this.sel ? RC.sel : 'rgba(255,255,255,0.45)'; c.strokeRect(lx - 3.5, ly - 2.5, w + 7, h + 4); }
      c.fillStyle = col;
      L.forEach((t, i) => c.fillText(t, lx, ly + i * lh));
      if (ac.ctl !== 'unc' && ac.ctl !== 'xfer' && L[2]) { // underline cleared level
        const cw = c.measureText(L[2].split(' ')[0]).width; c.fillRect(lx, ly + 2 * lh + 12.5, cw, 1);
      }
      if (ac.stca) { c.fillStyle = RC.stca; c.fillText('STCA', lx, ly - lh - 1); }
      this.hits.push({ kind: 'label', ac, x: lx, y: ly, w, h });
    }
    if (this.vec) { // live vector gesture
      const v = this.vec, a = this.w2s(v.ac.disp.x, v.ac.disp.y); const end = v.fix ? this.w2s(FIX[v.fix].x, FIX[v.fix].y) : { x: v.x, y: v.y };
      c.strokeStyle = '#ffd36b'; c.lineWidth = 1.6; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(end.x, end.y); c.stroke(); c.setLineDash([]);
      if (v.fix) { c.beginPath(); c.arc(end.x, end.y, 9, 0, Math.PI * 2); c.stroke(); }
      const txt = v.fix ? `DCT ${v.fix}` : `HDG ${String(v.hdg).padStart(3, '0')}`; c.font = '600 15px "IBM Plex Mono", monospace'; const tw = c.measureText(txt).width;
      c.fillStyle = 'rgba(5,20,40,0.85)'; c.fillRect(end.x + 12, end.y - 26, tw + 12, 22); c.fillStyle = '#ffd36b'; c.textBaseline = 'middle'; c.fillText(txt, end.x + 18, end.y - 15); c.font = RC.font; c.textBaseline = 'top';
    }
    // scale bar + range readout
    c.fillStyle = 'rgba(220,235,250,0.85)'; c.font = RC.fontSm; c.textBaseline = 'alphabetic';
    const nm = this.scale > 14 ? 5 : this.scale > 5 ? 10 : 20; const px = nm * this.scale;
    c.fillRect(this.W - 20 - px, this.H - 18, px, 2); c.fillText(`${nm} NM`, this.W - 20 - px, this.H - 24);
  }
}

/* ---------- Command menu (touch-first) ---------- */
class CommandMenu {
  constructor(view) {
    this.view = view; this.tab = 'hdg'; this.turn = 0;
    this.root = el('div', { class: 'cmd-menu', role: 'dialog', 'aria-label': 'Command menu', style: 'display:none' });
    view.wrap.append(this.root);
    this.root.addEventListener('pointerdown', e => { e.stopPropagation(); App.inputSeen(e, 'down'); });
  }
  open(ac, sx, sy) { this.ac = ac; this.anchor = { sx, sy }; this.root.style.display = 'grid'; this.render(); App.feature('menuOpen'); }
  close() { this.ac = null; this.root.style.display = 'none'; }
  place(sx, sy) {
    const W = this.view.W, H = this.view.H, mw = this.root.offsetWidth || 336, mh = this.root.offsetHeight || 420;
    let x = sx + 40 + mw > W ? sx - 40 - mw : sx + 40; let y = sy - mh / 2;
    x = clamp(x, 8, W - mw - 8); y = clamp(y, 8, H - mh - 8);
    this.root.style.left = x + 'px'; this.root.style.top = y + 'px';
  }
  issue(cmd) { const ac = this.ac; if (!ac) return; this.view.opts.onCommand(ac, [cmd]); App.feature('menuCmd'); this.render(); }
  render() {
    const ac = this.ac; if (!ac) return;
    const r = this.root; r.innerHTML = '';
    const cur = `${fmtAlt(ac.alt)} ${String(Math.round(toMag(ac.hdg))).padStart(3, '0')}° ${Math.round(ac.ias)}KT`;
    r.append(el('div', { class: 'cmd-head' }, el('b', { text: ac.cs }), el('span', { text: `${ac.type}/${ac.wtc} · ${cur}` }), el('button', { class: 'x', 'aria-label': 'Close', onclick: () => this.view.select(null) }, '×')));
    if (ac.ctl === 'pend') r.append(el('button', { class: 'cmd-wide', style: 'background:#5a4a12;border-color:#ffd36b;color:#ffe4a0', onclick: () => this.issue({ type: 'assume' }) }, 'ASSUME'));
    const tabs = [['hdg', 'HDG'], ['alt', 'CFL'], ['spd', 'SPD'], ['dct', 'DCT'], ['app', 'APP'], ['xfer', 'XFER']];
    const tb = el('div', { class: 'cmd-tabs', role: 'tablist' });
    for (const [k, t] of tabs) tb.append(el('button', { 'aria-pressed': String(this.tab === k), onclick: () => { this.tab = k; this.render(); } }, t));
    r.append(tb);
    const body = el('div', { class: 'cmd-body' }); r.append(body);
    if (this.tab === 'hdg') this.hdgBody(body, ac);
    else if (this.tab === 'alt') {
      const g = el('div', { class: 'cmd-grid' });
      const lv = [3000, 3500, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 19000, 21000, 23000, 24000];
      for (const v of lv) { const b = el('button', { onclick: () => this.issue({ type: 'alt', val: v }) }, v >= D.ta + 500 ? 'FL' + String(v / 100).padStart(3, '0') : 'A' + String(v / 100).padStart(3, '0')); if (v === ac.tgtAlt) b.classList.add('clr'); if (Math.abs(v - ac.alt) < 500) b.classList.add('cur'); g.append(b); }
      body.append(g);
    } else if (this.tab === 'spd') {
      const g = el('div', { class: 'cmd-grid' });
      for (const v of [160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 280]) { const b = el('button', { onclick: () => this.issue({ type: 'spd', val: v }) }, String(v)); if (v === ac.tgtIas) b.classList.add('clr'); g.append(b); }
      body.append(g, el('button', { class: 'cmd-wide', onclick: () => this.issue({ type: 'spd', val: null }) }, 'SPEED: NO RESTRICTION'));
    } else if (this.tab === 'dct') {
      const list = Object.values(FIX).filter(f => f.cls !== 'ndb').map(f => ({ f, d: Math.hypot(f.x - ac.x, f.y - ac.y) })).filter(o => o.d < 70).sort((a, b) => a.d - b.d).slice(0, 16);
      const routeFirst = ac.route.slice(ac.routeIdx).filter(n => FIX[n]);
      const names = [...new Set([...routeFirst, ...list.map(o => o.f.n)])].slice(0, 16);
      const g = el('div', { class: 'cmd-grid' });
      for (const n of names) { const b = el('button', { onclick: () => this.issue({ type: 'dct', fix: n }) }, n); if (routeFirst.includes(n)) b.classList.add('clr'); g.append(b); }
      body.append(g, el('button', { class: 'cmd-wide', onclick: () => this.issue({ type: 'res' }) }, 'RESUME OWN NAVIGATION'));
    } else if (this.tab === 'app') {
      const g = el('div', { class: 'cmd-grid cols2' });
      for (const id of ['24', '06', '30', '12']) { const b = el('button', { onclick: () => this.issue({ type: 'ils', rwy: id }) }, 'ILS ' + id); if (ac.ils === id) b.classList.add('clr'); g.append(b); }
      body.append(g, el('p', { style: 'margin:0;font-size:12px;color:#a8c4e0;font-family:var(--font-mono)' }, 'LOC capture on crossing the extended centreline · intercept ≤ 30°'));
    } else if (this.tab === 'xfer') {
      body.append(el('button', { class: 'cmd-wide', onclick: () => this.issue({ type: 'xfer', to: 'TWR' }) }, `TWR · Ruzyně Tower ${D.freq.TWR}`));
      body.append(el('button', { class: 'cmd-wide', onclick: () => this.issue({ type: 'xfer', to: 'ACC' }) }, 'ACC · Praha Control'));
    }
    if (this.anchor) this.place(this.anchor.sx, this.anchor.sy); // tabs differ in height: keep the whole menu on screen
  }
  hdgBody(body, ac) {
    const wrap = el('div', { class: 'dial-wrap' }); const cv = el('canvas', { width: 380, height: 380, 'aria-label': 'Heading dial' });
    const side = el('div', { class: 'dial-side' });
    const seg = el('div', { class: 'cmd-grid cols3' });
    [[0, 'SHORT'], [-1, 'LEFT'], [1, 'RIGHT']].forEach(([v, t]) => { const b = el('button', { style: 'font-size:12px', onclick: () => { this.turn = v; this.render(); } }, t); if (this.turn === v) b.classList.add('clr'); seg.append(b); });
    side.append(seg);
    const q = el('div', { class: 'cmd-grid cols2' });
    const curMag = Math.round(toMag(ac.hdg) / 5) * 5;
    [[-20, 'L20'], [20, 'R20'], [-10, 'L10'], [10, 'R10']].forEach(([dv, t]) => q.append(el('button', { onclick: () => this.issue({ type: 'hdg', val: (Geo.norm360(curMag + dv) || 360), dir: Math.sign(dv) }) }, t)));
    side.append(q, el('button', { class: 'cmd-wide', onclick: () => this.issue({ type: 'hdg', val: Math.round(toMag(ac.hdg)) || 360, dir: 0 }) }, 'PRESENT HDG'));
    wrap.append(cv, side); body.append(wrap);
    let cand = null;
    const draw = () => {
      const c = cv.getContext('2d'); const S = 380; c.clearRect(0, 0, S, S); const cx = S / 2, cy = S / 2, R = 160;
      c.strokeStyle = 'rgba(150,195,240,0.6)'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
      c.font = '600 26px "Barlow Condensed", sans-serif'; c.fillStyle = '#cfe4fa'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let a = 0; a < 360; a += 10) { const r1 = a % 30 === 0 ? R - 24 : R - 12; const an = (a - 90) * DEG; c.beginPath(); c.moveTo(cx + Math.cos(an) * r1, cy + Math.sin(an) * r1); c.lineTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R); c.stroke(); if (a % 30 === 0) c.fillText(String(a / 10 || 36), cx + Math.cos(an) * (R - 46), cy + Math.sin(an) * (R - 46)); }
      const mark = (deg, col, len) => { const an = (deg - 90) * DEG; c.strokeStyle = col; c.lineWidth = 6; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(an) * len, cy + Math.sin(an) * len); c.stroke(); };
      mark(toMag(ac.hdg), '#7fd3ff', R - 30);
      if (ac.mode === 'hdg' && !ac.locCap) mark(toMag(ac.tgtHdg), '#ffd36b', R - 60);
      if (cand !== null) mark(cand, '#ffffff', R);
      c.fillStyle = '#ffffff'; c.font = '600 44px "IBM Plex Mono", monospace'; c.fillText(cand !== null ? String(cand).padStart(3, '0') : String(Math.round(toMag(ac.hdg))).padStart(3, '0'), cx, cy);
    };
    const angle = (e) => { const r = cv.getBoundingClientRect(); const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2; let a = Math.atan2(x, -y) / DEG; a = Math.round(Geo.norm360(a) / 5) * 5; return a === 0 ? 360 : a; };
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); cand = angle(e); draw(); });
    cv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') { if (cand !== null) { cand = angle(e); draw(); } } });
    cv.addEventListener('pointerup', e => { if (cand !== null) { const v = cand; cand = null; this.issue({ type: 'hdg', val: v, dir: this.turn }); } });
    draw();
  }
}
