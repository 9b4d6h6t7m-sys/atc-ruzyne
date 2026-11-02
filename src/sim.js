'use strict';
/* Air situation simulation for the APP position: flight model, navigation, ILS, separation monitoring. */

class Aircraft {
  constructor(o) {
    Object.assign(this, {
      cs: o.cs, type: o.type, kind: o.kind || 'arr', orig: o.orig || '', dest: o.dest || '', sq: o.sq || String(1000 + Math.floor(Math.random() * 6777)).replace(/[89]/g, '7'),
      x: o.x, y: o.y, alt: o.alt, hdg: o.hdg ?? 0, ias: o.ias ?? 250, vs: 0, tas: 0, gs: 0, trk: o.hdg ?? 0,
      tgtAlt: o.cfl ?? o.alt, tgtIas: null, tgtHdg: null, turnDir: 0,
      route: (o.route || []).slice(), routeIdx: 0, mode: (o.route && o.route.length) ? 'route' : 'hdg',
      ils: null, locCap: false, gsCap: false, ctl: o.ctl || 'own', star: o.star || '', sid: o.sid || '', rfl: o.rfl || null,
      labelOff: o.labelOff || { dx: 34, dy: -34 }, hist: [], disp: null, stca: false, done: null, lastCmd: '', created: 0,
      xfl: o.xfl || null, spoke: false,
    });
    this.perf = PERF[this.type] || PERF.A320;
    this.wtc = this.perf.wtc;
    if (this.tgtHdg === null) this.tgtHdg = this.hdg;
    this.snapshot();
  }
  get airline() { return AIRLINES[this.cs.slice(0, 3)]; }
  get nextFix() { return this.mode === 'route' ? this.route[this.routeIdx] : null; }
  snapshot() {
    this.disp = { x: this.x, y: this.y, alt: this.alt, gs: this.gs || this.ias, trk: this.trk, vs: this.vs, hdg: this.hdg };
    this.hist.unshift({ x: this.x, y: this.y }); if (this.hist.length > 7) this.hist.pop();
  }
  defaultIas() {
    const p = this.perf, max = p.maxIas || 999;
    let v;
    if (this.kind === 'dep') v = this.alt < 3000 + 1200 ? p.v2 + 25 : (this.alt < 10000 ? 250 : 290);
    else {
      v = this.alt > 10500 ? 280 : 250;
      if (this.ils && this.locCap) {
        const s = this.locGeom(this.ils).s;
        v = s > 12 ? Math.min(v, 200) : s > 7 ? 180 : s > 4.5 ? 160 : p.vapp;
      } else if (this.distTo(0, 0) < 20 && this.alt < 8000) v = Math.min(v, 220);
    }
    return Math.min(v, max);
  }
  distTo(x, y) { return Math.hypot(this.x - x, this.y - y); }
  locGeom(rwyId) {
    const R = RWY[rwyId]; const ux = Math.sin(R.crs * DEG), uy = Math.cos(R.crs * DEG);
    const dx = this.x - R.x, dy = this.y - R.y;
    return { s: -(dx * ux + dy * uy), e: dx * uy - dy * ux, R };
  }
  windCorr(track, wind) {
    if (!wind || !wind.spd) return track;
    const wTo = Geo.norm360(wind.dir + 180);
    const cw = wind.spd * Math.sin((wTo - track) * DEG);
    const tas = Math.max(this.tas, 80);
    return Geo.norm360(track - Math.asin(clamp(cw / tas, -0.5, 0.5)) / DEG);
  }
  update(dt, sim) {
    if (this.done) return;
    const p = this.perf, wind = sim.wind;
    if (this.accClimbAt && sim.t >= this.accClimbAt) { this.accClimbAt = null; this.tgtAlt = Math.max(this.tgtAlt, 24000); }
    this.tas = this.ias * (1 + this.alt / 1000 * 0.02);
    // ---- lateral guidance
    let want = this.hdg;
    if (this.ils && !this.locCap) this.tryLoc(sim);
    if (this.locCap) {
      const g = this.locGeom(this.ils);
      const corr = clamp(g.e * 30, -25, 25);
      want = this.windCorr(Geo.norm360(g.R.crs - corr), wind);
      if (g.s < -0.6 && !this.done) this.goAround(sim, 'not landed');
    } else if (this.mode === 'route') {
      const f = FIX[this.route[this.routeIdx]];
      if (!f) { this.mode = 'hdg'; this.tgtHdg = this.hdg; }
      else {
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        const brg = Geo.brg(this, f);
        const lead = Math.max(0.6, this.tas / 3600 * 25);
        if (d < lead) {
          this.routeIdx++;
          if (this.routeIdx >= this.route.length) { this.mode = 'hdg'; this.tgtHdg = this.hdg; this.turnDir = 0; }
        }
        want = this.windCorr(brg, wind);
      }
    } else want = this.tgtHdg;
    const rate = Math.min(3, 1091 * Math.tan(25 * DEG) / Math.max(this.tas, 90));
    let d = Geo.diff(this.hdg, want);
    if (this.mode === 'hdg' && !this.locCap && this.turnDir && Math.abs(d) > 3) {
      if (this.turnDir < 0 && d > 0) d -= 360; else if (this.turnDir > 0 && d < 0) d += 360;
    } else if (Math.abs(d) <= 3) this.turnDir = 0;
    this.hdg = Geo.norm360(this.hdg + clamp(d, -rate * dt, rate * dt));
    // ---- vertical
    if (this.locCap && !this.gsCap) {
      const g = this.locGeom(this.ils); const gsAlt = g.R.elev + 50 + g.s * 318.4;
      if (this.alt >= gsAlt - 40 && g.s > 0.3) this.gsCap = true;
    }
    if (this.gsCap) {
      const g = this.locGeom(this.ils); const gsAlt = g.R.elev + 50 + Math.max(0, g.s) * 318.4;
      const newAlt = Math.max(gsAlt, this.alt - 3000 / 60 * dt);
      this.vs = (newAlt - this.alt) / dt * 60; this.alt = newAlt;
      if (g.s < 0.08) { this.done = 'landed'; sim.emit('landed', this); return; }
    } else {
      const diff = this.tgtAlt - this.alt;
      const climb = p.cl * (1 - Math.min(0.55, this.alt / 42000));
      const target = diff > 0 ? Math.min(climb, diff * 2 + 50) : Math.max(-p.de, diff * 2 - 50);
      this.vs += clamp(target - this.vs, -450 * dt, 450 * dt);
      this.alt += this.vs / 60 * dt;
      if (Math.abs(this.tgtAlt - this.alt) < 15 && Math.abs(this.vs) < 250) { this.alt = this.tgtAlt; this.vs = 0; }
    }
    // ---- speed
    let tv = this.tgtIas ?? this.defaultIas();
    if (this.ils && this.locCap) { const s = this.locGeom(this.ils).s; if (s < 4.2) tv = p.vapp; }
    this.ias += clamp(tv - this.ias, -p.dec * dt, p.acc * dt);
    // ---- kinematics
    this.tas = this.ias * (1 + this.alt / 1000 * 0.02);
    const wTo = Geo.norm360(wind.dir + 180);
    const vx = Math.sin(this.hdg * DEG) * this.tas + Math.sin(wTo * DEG) * wind.spd;
    const vy = Math.cos(this.hdg * DEG) * this.tas + Math.cos(wTo * DEG) * wind.spd;
    this.gs = Math.hypot(vx, vy); this.trk = Geo.norm360(Math.atan2(vx, vy) / DEG);
    this.x += vx * dt / 3600; this.y += vy * dt / 3600;
    if (Math.hypot(this.x, this.y) > 95) { this.done = 'left'; sim.emit('left', this); }
  }
  tryLoc(sim) {
    const g = this.locGeom(this.ils);
    if (g.s < 1 || g.s > 32 || Math.abs(g.e) > 9) return;
    if (Math.abs(g.e) > g.s * Math.tan(40 * DEG) + 0.5) return;
    const ang = Geo.diff(g.R.crs, this.hdg); // heading relative to course
    const converging = (g.e > 0 && ang < -2) || (g.e < 0 && ang > 2) || Math.abs(g.e) < 0.15;
    if (!converging || Math.abs(ang) > 100) return;
    const rate = Math.min(3, 1091 * Math.tan(25 * DEG) / Math.max(this.tas, 90));
    const vc = this.tas / 3600 * Math.abs(Math.sin(ang * DEG));
    const lead = Math.max(0.12, vc * (Math.abs(ang) / rate) * 0.55);
    if (Math.abs(g.e) <= lead) {
      this.locCap = true; this.mode = 'hdg'; this.turnDir = 0;
      sim.emit('loc', this);
    }
  }
  goAround(sim, why) {
    const R = RWY[this.ils];
    this.locCap = false; this.gsCap = false; this.ils = null; this.mode = 'hdg'; this.tgtHdg = R ? R.crs : this.hdg; this.tgtAlt = 5000; this.tgtIas = null;
    sim.emit('goaround', this, why);
  }
  command(c, sim) {
    switch (c.type) {
      case 'hdg':
        if (this.locCap) { this.locCap = false; this.gsCap = false; this.ils = null; }
        this.mode = 'hdg'; this.tgtHdg = toTrue(c.val); this.turnDir = c.dir || 0; break;
      case 'alt': this.tgtAlt = c.val; if (this.gsCap) { this.gsCap = false; } break;
      case 'spd': this.tgtIas = c.val; break;
      case 'dct': { const i = this.route.indexOf(c.fix); this.route = i >= 0 ? this.route.slice(i) : [c.fix]; this.routeIdx = 0; this.mode = 'route'; this.turnDir = 0; if (this.locCap) { this.locCap = false; this.gsCap = false; this.ils = null; } break; }
      case 'ils': this.ils = c.rwy; break;
      case 'xfer': this.ctl = 'xfer'; this.xferTo = c.to; if (this.kind === 'dep' && c.to === 'ACC') this.accClimbAt = (sim ? sim.t : 0) + 25; break;
      case 'res': if (this.route.length && this.routeIdx < this.route.length) { this.mode = 'route'; this.turnDir = 0; } break;
      case 'assume': this.ctl = 'own'; break;
    }
    this.lastCmd = c.type;
  }
}

class Sim {
  constructor(opts = {}) {
    this.t = opts.t ?? 10 * 3600; this.ac = []; this.wind = opts.wind || { dir: 240, spd: 8 }; this.qnh = 1009; this.rwy = '24';
    this.sweep = opts.sweep ?? 4; this._sweepT = 0; this._stcaT = 0; this.listeners = {}; this.stcaOn = true; this.log = [];
  }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach(f => f(...a)); }
  add(o) { const a = o instanceof Aircraft ? o : new Aircraft(o); a.created = this.t; this.ac.push(a); return a; }
  find(cs) { return this.ac.find(a => a.cs === cs); }
  step(dt) {
    this.t += dt;
    for (const a of this.ac) a.update(dt, this);
    const gone = this.ac.filter(a => a.done);
    if (gone.length) this.ac = this.ac.filter(a => !a.done);
    this._sweepT += dt;
    if (this._sweepT >= this.sweep) { this._sweepT = 0; for (const a of this.ac) a.snapshot(); }
    this._stcaT += dt;
    if (this._stcaT >= 1) { this._stcaT = 0; this.stca(); }
  }
  stca() {
    const prev = new Set(this.ac.filter(a => a.stca).map(a => a.cs));
    for (const a of this.ac) { a.stca = false; a.stcaWith = null; }
    if (!this.stcaOn) return;
    const list = this.ac.filter(a => a.alt > 1700 && !a.gsCap);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (Math.abs(a.alt - b.alt) > 4000) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 25) continue;
      const va = vel(a), vb = vel(b);
      for (let t = 0; t <= 90; t += 5) {
        const dx = (a.x + va.x * t) - (b.x + vb.x * t), dy = (a.y + va.y * t) - (b.y + vb.y * t);
        const za = predAlt(a, t), zb = predAlt(b, t);
        if (Math.hypot(dx, dy) < 3 && Math.abs(za - zb) < 900) { a.stca = b.stca = true; a.stcaWith = b.cs; b.stcaWith = a.cs; break; }
      }
    }
    const now = this.ac.filter(a => a.stca && !prev.has(a.cs));
    if (now.length) this.emit('stca', now);
    function vel(a) { const r = a.gs / 3600; return { x: Math.sin(a.trk * DEG) * r, y: Math.cos(a.trk * DEG) * r }; }
    function predAlt(a, t) { const z = a.alt + a.vs / 60 * t; return a.vs > 0 ? Math.min(z, Math.max(a.tgtAlt, a.alt)) : a.vs < 0 ? Math.max(z, Math.min(a.tgtAlt, a.alt)) : z; }
  }
  separationNow() {
    let worst = null;
    const list = this.ac.filter(a => a.alt > 1700);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; const h = Math.hypot(a.x - b.x, a.y - b.y), v = Math.abs(a.alt - b.alt);
      if (h < 3 && v < 975) { if (!worst || h < worst.h) worst = { a, b, h, v }; }
    }
    return worst;
  }
}

/* Demo traffic for the functional test. Positions use real fixes around TMA Praha. */
function placeOnLeg(fromFix, toFix, nmBefore) {
  const a = FIX[fromFix], b = FIX[toFix]; const brg = Geo.brg(a, b);
  const p = Geo.move(a, brg + 180, nmBefore); return { x: p.x, y: p.y, hdg: brg };
}
function demoTraffic(sim) {
  const R24 = RWY['24'], R06 = RWY['06'];
  const depStart = (route, cs, type, rfl) => {
    const p = Geo.move({ x: R06.x, y: R06.y }, R24.crs, 1.2);
    return { cs, type, kind: 'dep', x: p.x, y: p.y, alt: 2400, hdg: R24.crs, ias: 175, cfl: 5000, route, orig: 'LKPR', ctl: 'own', rfl, sid: route[route.length - 1] };
  };
  const g = placeOnLeg('GOLOP', 'ERASU', 2);
  sim.add({ cs: 'TVS35J', type: 'B38M', kind: 'arr', ...g, alt: 13000, cfl: 10000, ias: 280, route: ['ERASU'], orig: 'LGAV', dest: 'LKPR', star: 'GOLOP4S', ctl: 'own' });
  const r = placeOnLeg('APRAQ', 'ARVEG', -6);
  sim.add({ cs: 'RYR8YD', type: 'B38M', kind: 'arr', ...r, alt: 12000, cfl: 9000, ias: 280, route: ['ARVEG', 'RATEV'], orig: 'LIRF', dest: 'LKPR', star: 'APRAQ2S', ctl: 'own', labelOff: { dx: 34, dy: 18 } });
  const w = placeOnLeg('LOMKI', 'SOMIS', -4);
  sim.add({ cs: 'AFR1083', type: 'A320', kind: 'arr', ...w, alt: 15000, cfl: 11000, ias: 280, route: ['SOMIS', 'EVEMI', 'ERASU'], orig: 'LFPG', dest: 'LKPR', star: 'LOMKI8S', ctl: 'own' });
  const u = placeOnLeg('VLM', 'ARVEG', 4);
  sim.add({ cs: 'UAE139', type: 'B77W', kind: 'arr', ...u, alt: 16000, cfl: 12000, ias: 290, route: ['ARVEG', 'RATEV'], orig: 'OMDB', dest: 'LKPR', star: 'VLM4S', ctl: 'own', labelOff: { dx: 34, dy: 20 } });
  const k = placeOnLeg('GOLOP', 'ERASU', 7);
  sim.add({ cs: 'KLM1355', type: 'E190', kind: 'arr', ...k, alt: 16000, cfl: 13000, ias: 280, route: ['GOLOP', 'ERASU'], orig: 'EHAM', dest: 'LKPR', star: 'GOLOP4S', ctl: 'pend', labelOff: { dx: -110, dy: -30 } });
  const d1 = depStart(['BALTU'], 'DLH1395', 'A20N', 340); Object.assign(d1, Geo.move(d1, R24.crs, 6), { alt: 4600, ias: 230 }); sim.add(d1);
  const d2 = depStart(['VOZ'], 'WZZ2219', 'A21N', 360); Object.assign(d2, Geo.move(d2, R24.crs, 2), { alt: 3000, ias: 200, labelOff: { dx: -118, dy: 10 } }); sim.add(d2);
}
function spawnDeparture(sim, cs, type, exit, rfl) {
  const R24 = RWY['24'], R06 = RWY['06'];
  const p = Geo.move({ x: R06.x, y: R06.y }, R24.crs, 0.8);
  return sim.add({ cs, type, kind: 'dep', x: p.x, y: p.y, alt: 1700, hdg: R24.crs, ias: 160, cfl: 5000, route: [exit], orig: 'LKPR', dest: '', ctl: 'pend', rfl, sid: exit, labelOff: { dx: -118, dy: -26 } });
}
function spawnConflict(sim) {
  const base = { x: 0, y: 14 };
  sim.ac = sim.ac.filter(a => !['BAW852', 'THY3FZ'].includes(a.cs));
  sim.add({ cs: 'BAW852', type: 'A319', kind: 'ovf', x: base.x + 13, y: base.y, alt: 11000, cfl: 11000, hdg: 270, ias: 280, ctl: 'own', orig: 'EGLL', dest: 'LKPR', labelOff: { dx: 30, dy: -40 } });
  sim.add({ cs: 'THY3FZ', type: 'A21N', kind: 'ovf', x: base.x - 13, y: base.y + 0.4, alt: 11000, cfl: 11000, hdg: 90, ias: 280, ctl: 'own', orig: 'LTFM', dest: 'LKPR', labelOff: { dx: -112, dy: 24 } });
  for (const cs of ['BAW852', 'THY3FZ']) { const a = sim.find(cs); a.update(0.01, sim); a.snapshot(); }
}
function stressTraffic(sim, n) {
  sim.ac = [];
  const types = Object.keys(PERF); const als = Object.keys(AIRLINES);
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * 360, r = rnd(3, 55);
    sim.add({ cs: pick(als) + (100 + Math.floor(Math.random() * 8900)), type: pick(types), kind: 'ovf', x: Math.sin(ang * DEG) * r, y: Math.cos(ang * DEG) * r, alt: Math.round(rnd(30, 160)) * 100, hdg: Math.random() * 360, ias: rnd(200, 290), ctl: Math.random() < 0.8 ? 'own' : 'unc', labelOff: { dx: 30, dy: -30 } });
  }
}
