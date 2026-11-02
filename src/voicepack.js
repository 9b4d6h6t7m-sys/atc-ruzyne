'use strict';
/* Pilot voice packs. Each voice is one MP3 sprite (16 kHz) with an index of fragments per vocabulary unit:
   [mid_start, mid_dur, end_start, end_dur]. A transmission is split into clauses, matched greedily against the
   vocabulary, scheduled fragment by fragment and coloured by a VHF radio chain (band limit, compression, soft clip).
   Hybrid by design: if a pack is not loaded yet or a word is missing, the caller falls back to the device voice. */
const VP_ALWAYS_END = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner', 'nine', 'heavy',
  'alfa', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliett', 'kilo', 'lima', 'mike', 'november',
  'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee', 'zulu']);
const VP_DIGITS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner', 'nine', 'decimal']);
/* Airline -> voice pool. Accents follow the operator's home base where a voice exists; otherwise a neutral voice. */
const VP_MAP = {
  TVS: ['cz_m1'], CSA: ['cz_m1'], RYR: ['ie_m1', 'gb_m1', 'sc_m1'], EIN: ['ie_m1'], EZY: ['gb_m1', 'gb_f1', 'sc_m1', 'gb_m2'],
  EJU: ['gb_m2', 'gb_f1', 'it_m1', 'fr_f1'], EZS: ['gb_m2', 'fr_f1'], WZZ: ['cz_m1', 'gb_m2', 'it_m1'], DLH: ['gb_m2', 'us_m1'],
  EWG: ['gb_m2', 'us_m1'], CFG: ['gb_m2'], AUA: ['gb_m2', 'us_m1'], SWR: ['gb_m2', 'fr_f1'], AFR: ['fr_f1'], TVF: ['fr_f1'],
  BEL: ['fr_f1', 'gb_m2'], KLM: ['gb_m2', 'us_m1'], BAW: ['gb_m1', 'gb_f1', 'sc_m1'], LOT: ['cz_m1'], ASL: ['cz_m1'], ROT: ['it_m1', 'cz_m1'],
  VLG: ['es_m1'], ITY: ['it_m1'], AEE: ['it_m1', 'es_m1'], THY: ['gb_m2', 'es_m1', 'us_m1'], UAE: ['au_m1', 'gb_m1', 'in_m1', 'ar_m1'],
  QTR: ['in_m1', 'ar_m1', 'gb_m2'], ETD: ['ar_m1', 'in_m1', 'au_m1'], SAS: ['gb_m2', 'us_m1'], FIN: ['gb_m2', 'us_m1'], DAL: ['us_m1'],
  KAL: ['ko_m1'],
};
const VP_DEFAULT = ['gb_m1', 'us_m1', 'gb_m2', 'au_m1'];
const VP_RATE = { cz_m1: 1.08, ko_m1: 1.05, ar_m1: 1.04 }; // slow-speaking models are played a little faster
const VP_LABEL = { cz_m1: 'český přízvuk', gb_m1: 'britský', gb_m2: 'britský 2', gb_f1: 'britský, žena', sc_m1: 'skotský', ie_m1: 'irský', us_m1: 'americký', au_m1: 'australský', in_m1: 'indický', ar_m1: 'arabský', es_m1: 'španělský', ko_m1: 'korejský', fr_f1: 'francouzský, žena', it_m1: 'italský' };

const VoicePack = {
  enabled: true, base: 'voices/', packs: {}, loading: {}, offset: null,
  stats: { pack: 0, device: 0, missing: {}, loadErr: 0, lastErr: '', loaded: [] },
  voiceFor(cs) {
    let pool = (VP_MAP[cs.slice(0, 3)] || VP_DEFAULT).filter(id => !this.dead[id]); if (!pool.length) pool = VP_DEFAULT.filter(id => !this.dead[id]);
    const h = Sound.hash(cs); const id = pool[h % Math.max(1, pool.length)] || 'gb_m1'; return { id, rate: (0.95 + ((h >> 5) % 12) / 100) * (VP_RATE[id] || 1) };
  },
  dead: {}, // voices whose files are missing: their airlines move to the default pool
  load(id) {
    if (this.packs[id]) return Promise.resolve(this.packs[id]);
    if (this.loading[id]) return this.loading[id];
    const c = Sound.ensureCtx(); if (!c) return Promise.reject(new Error('no audio'));
    this.loading[id] = (async () => {
      const [ix, data] = await Promise.all([
        fetch(this.base + id + '.json').then(r => { if (!r.ok) throw new Error('index HTTP ' + r.status); return r.json(); }),
        fetch(this.base + id + '.mp3').then(r => { if (!r.ok) throw new Error('audio HTTP ' + r.status); return r.arrayBuffer(); }),
      ]);
      const buf = await new Promise((res, rej) => { const p = c.decodeAudioData(data, res, rej); if (p && p.then) p.then(res, rej); });
      const pack = { id, desc: ix.desc, u: ix.u, buf, off: this.measureOffset(buf, ix.u) };
      this.packs[id] = pack; this.stats.loaded.push(id); App.emit('voicepack', id); return pack;
    })().catch(e => { this.stats.loadErr++; this.stats.lastErr = id + ': ' + e.message; delete this.loading[id]; if (/HTTP 404/.test(e.message)) this.dead[id] = true; App.emit('voicepack', id); throw e; });
    return this.loading[id];
  },
  /* MP3 decoders may or may not compensate the encoder delay: measure the real onset of the first fragment. */
  measureOffset(buf, u) {
    const d = buf.getChannelData(0), sr = buf.sampleRate; const first = Math.min(...Object.values(u).map(v => v[0]));
    const from = Math.max(0, Math.floor((first - 0.06) * sr)), to = Math.min(d.length, Math.floor((first + 0.2) * sr));
    let peak = 0; for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(d[i]));
    const thr = peak * 0.08; let on = -1; for (let i = from; i < to; i++) if (Math.abs(d[i]) > thr) { on = i; break; }
    if (on < 0) return 0; return clamp(on / sr - (first + 0.012), -0.05, 0.12);
  },
  preload(callsigns) { const ids = new Set(callsigns.map(cs => this.voiceFor(cs).id)); for (const id of ids) this.load(id).catch(() => {}); },
  norm(t) { return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/-/g, ' ').replace(/[^a-z0-9, ]/g, ' ').replace(/\s+/g, ' ').trim(); },
  /* Greedy longest match per clause; null plus the missing word if the pack cannot say it. */
  plan(text, pack) {
    const seq = [];
    for (const cl of this.norm(text).split(',').map(s => s.trim()).filter(Boolean)) {
      const w = cl.split(' '); const units = []; let i = 0;
      while (i < w.length) {
        let hit = null; for (let n = Math.min(7, w.length - i); n >= 1; n--) { const k = w.slice(i, i + n).join(' '); if (pack.u[k]) { hit = k; i += n; break; } }
        if (!hit) return { missing: w[i] };
        units.push(hit);
      }
      units.forEach((k, j) => seq.push({ k, end: j === units.length - 1 || VP_ALWAYS_END.has(k), digit: VP_DIGITS.has(k) }));
      seq.push({ pause: true });
    }
    if (seq.length) seq.pop();
    return { seq };
  },
  /* Schedule all fragments of a plan into node graph `dest` starting at t; returns the end time. */
  schedule(c, pack, p, rate, dest, t) {
    for (let i = 0; i < p.seq.length; i++) {
      const it = p.seq[i];
      if (it.pause) { t += 0.15 / rate; continue; }
      const e = pack.u[it.k]; const s = Math.max(0, (it.end ? e[2] : e[0]) + pack.off), d = it.end ? e[3] : e[1];
      const src = c.createBufferSource(); src.buffer = pack.buf; src.playbackRate.value = rate;
      const g = c.createGain(); const dur = d / rate; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.006); g.gain.setValueAtTime(1, t + dur - 0.008); g.gain.linearRampToValueAtTime(0, t + dur);
      src.connect(g); g.connect(dest); src.start(t, s, d + 0.01); src.stop(t + dur + 0.02);
      const next = p.seq[i + 1]; t += dur + (next && !next.pause ? (it.digit && next.digit ? 0.065 : 0.03) / rate : 0);
    }
    return t;
  },
  /* Test helper: render a transmission offline (same radio chain) and return the samples. */
  async renderOffline(text, cs) {
    const v = this.voiceFor(cs); const pack = await this.load(v.id); const p = this.plan(text, pack); if (!p.seq) return { missing: p.missing };
    const sr = 16000; const oc = new OfflineAudioContext(1, sr * 12, sr); const saveBus = Sound.bus; Sound.bus = oc.destination;
    try { const fx = this.chain(oc); const end = this.schedule(oc, pack, p, v.rate, fx.input, 0.05); const buf = await oc.startRendering(); return { sr, voice: v.id, samples: Array.from(buf.getChannelData(0).subarray(0, Math.ceil((end + 0.1) * sr))) }; }
    finally { Sound.bus = saveBus; }
  },
  chain(c) {
    const f = (type, freq, q = 0.707) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = q; return b; };
    const input = c.createGain(); const hp1 = f('highpass', 300), hp2 = f('highpass', 300), lp1 = f('lowpass', 3500), lp2 = f('lowpass', 3900);
    const mid = f('peaking', 2200, 0.8); mid.gain.value = 5; // presence: keeps consonants (s, f, t, k) audible inside the radio band
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -28; comp.knee.value = 4; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.09;
    const shaper = c.createWaveShaper(); if (!this.curve) { const n = 1024; this.curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; this.curve[i] = Math.tanh(1.9 * x) / Math.tanh(1.9); } } shaper.curve = this.curve;
    const out = c.createGain(); out.gain.value = 1.1 * Sound.vol;
    input.connect(hp1); hp1.connect(hp2); hp2.connect(lp1); lp1.connect(lp2); lp2.connect(mid); mid.connect(comp); comp.connect(shaper); shaper.connect(out); out.connect(Sound.bus);
    return { input, out };
  },
  /* Resolves true when the pack spoke the transmission, false when the caller should use the device voice. */
  async speak(text, cs) {
    if (!this.enabled || !Sound.ctx || !cs) return false;
    const v = this.voiceFor(cs); let pack = this.packs[v.id];
    if (!pack) { try { pack = await Promise.race([this.load(v.id), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))]); } catch (e) { this.stats.device++; return false; } }
    const p = this.plan(text, pack);
    if (!p.seq) { this.stats.missing[p.missing] = (this.stats.missing[p.missing] || 0) + 1; this.stats.device++; return false; }
    return new Promise((resolve) => {
      Sound.whenRunning(() => {
        const c = Sound.ctx; const fx = this.chain(c); const rate = v.rate * Sound.rateMul;
        if (Sound.radioFx) { Sound.tone('click'); Sound.noiseOn(); }
        const t = this.schedule(c, pack, p, rate, fx.input, c.currentTime + 0.09);
        this.stats.pack++; Sound.lastVoiceUsed = `${v.id} · ${pack.desc}`;
        setTimeout(() => { Sound.noiseOff(); setTimeout(() => { try { fx.out.disconnect(); } catch (e) {} }, 400); resolve(true); }, Math.max(0, (t - c.currentTime) * 1000 + 40));
      });
      if (Sound.ctx.state !== 'running') setTimeout(() => resolve(false), 500);
    });
  },
};
