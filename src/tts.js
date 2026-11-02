'use strict';
/* Pilot voices synthesised at run time (docs/tts-worker.js): the same Piper speakers the voice packs were made from,
   but a whole transmission at once, so numbers and phrases have natural rhythm and intonation. Readbacks are
   synthesised as soon as they are queued (Comms), so they are ready when the pilot answers. Voice packs stay the
   fallback (model not downloaded yet, synthesis error) and still serve the Kokoro voices (fr_f1, it_m1). */
const TTS_REPO = { repo: 'rhasspy/piper-voices', revision: 'b4e358ffcb232591bf73a540e70f7de528e4174a' };
const TTS_MODELS = {
  // base: the model's own length scale; noise/noiseW lower than the trained defaults keep digits steady and clear
  vctk: { path: 'en/en_GB/vctk/medium/en_GB-vctk-medium', mb: 77, label: 'VCTK (britské, irský, skotský, americký, australský, indický)', base: 1.4, noise: 0.333, noiseW: 0.333 },
  l2arctic: { path: 'en/en_US/l2arctic/medium/en_US-l2arctic-medium', mb: 77, label: 'L2-ARCTIC (arabský, španělský, korejský přízvuk)', base: 1.05, noise: 0.45, noiseW: 0.4 },
  jirka: { path: 'cs/cs_CZ/jirka/medium/cs_CZ-jirka-medium', mb: 63, label: 'český hlas s anglickými fonémy', base: 1.0, espeak: 'en-gb', noise: 0.45, noiseW: 0.4 },
};
/* voice-pack id -> [model, speaker, speed] (speakers and speeds as in tools/tts/packgen.py) */
const TTS_VOICES = {
  gb_m1: ['vctk', 'p232', 1.06], gb_m2: ['vctk', 'p226', 1.06], gb_f1: ['vctk', 'p228', 1.06], sc_m1: ['vctk', 'p260', 1.06],
  ie_m1: ['vctk', 'p245', 1.06], us_m1: ['vctk', 'p345', 1.06], au_m1: ['vctk', 'p374', 1.06], in_m1: ['vctk', 'p251', 1.04],
  ar_m1: ['l2arctic', 'ABA', 1.0], es_m1: ['l2arctic', 'EBVS', 1.0], ko_m1: ['l2arctic', 'HKK', 1.0], cz_m1: ['jirka', 0, 1.1],
};
/* Spoken forms espeak would get wrong (as in the voice-pack vocabulary). */
const TTS_SAY = [[/\bklm\b/gi, 'K L M'], [/\bcsa\b/gi, 'C S A'], [/\bryanair\b/gi, 'Ryan air'], [/\btopswiss\b/gi, 'Top Swiss'], [/\bairfrans\b/gi, 'Air France'],
  [/\bruzyn[eě]\b/gi, 'Roozinyeh'], [/\bquebec\b/gi, 'kebeck'], [/\bxray\b/gi, 'x-ray'], [/\bitarrow\b/gi, 'Itarrow']];

const PilotTTS = {
  enabled: Store.get('atc.tts.on', true), worker: null, models: {}, cache: new Map(), seq: 0, pending: {},
  pace: 0.98, // overall speaking rate on top of the per-voice speed: brisk, but numbers stay easy to follow
  stats: { tts: 0, fallback: 0, errors: 0, lastErr: '', synth: [], last: null },
  url(model) { return `https://huggingface.co/${TTS_REPO.repo}/resolve/${TTS_REPO.revision}/${TTS_MODELS[model].path}`; },
  spawn() {
    if (this.worker) return this.worker;
    this.worker = new Worker(ASSET['tts-worker.js'], { type: 'module' });
    this.worker.onmessage = (e) => this.onmsg(e.data);
    this.worker.onerror = (e) => { const msg = 'worker: ' + ((e && e.message) || 'chyba'); for (const k of Object.keys(this.pending)) { this.pending[k].rej(new Error(msg)); delete this.pending[k]; } };
    return this.worker;
  },
  onmsg(m) {
    if (m.type === 'progress') { const s = this.models[m.model]; if (s) { s.loaded = m.loaded; s.total = m.total || s.total; } App.emit('tts'); return; }
    if (m.type === 'ready') { Object.assign(this.models[m.model], { state: 'ready', ms: m.ms }); App.emit('tts'); return; }
    if (m.type === 'error' && m.id === undefined) { const s = this.models[m.model]; if (s) Object.assign(s, { state: 'error', err: m.message }); this.stats.lastErr = m.message; App.emit('tts'); return; }
    const p = this.pending[m.id]; if (!p) return; delete this.pending[m.id];
    if (m.type === 'error') p.rej(new Error(m.message)); else p.res(m);
  },
  /* Start downloading a model (once); the voice packs speak meanwhile. */
  ensure(model) {
    const s = this.models[model]; if (s && s.state !== 'error') return;
    this.models[model] = { state: 'loading', loaded: 0, total: TTS_MODELS[model].mb * 1e6, ms: 0, err: '' };
    this.spawn().postMessage({ type: 'load', model, url: this.url(model) }); App.emit('tts');
  },
  preload(callsigns) { if (!this.enabled) return; const need = new Set(callsigns.map(cs => this.spec(cs)).filter(Boolean).map(s => s.model)); for (const m of ['vctk', 'jirka', 'l2arctic']) if (need.has(m)) this.ensure(m); },
  spec(cs) {
    const v = VoicePack.voiceFor(cs); const t = TTS_VOICES[v.id]; if (!t) return null;
    const M = TTS_MODELS[t[0]]; return { voice: v.id, model: t[0], speaker: t[1], espeak: M.espeak, noise: M.noise, noiseW: M.noiseW, lengthScale: M.base / (t[2] * this.pace * v.rate * Sound.rateMul) };
  },
  norm(text) { let t = String(text); for (const [re, s] of TTS_SAY) t = t.replace(re, s); return t; },
  /* Synthesis promise for a transmission (cached by callsign + text); null when this voice cannot be synthesised now. */
  prepare(text, cs) {
    if (!this.enabled || !cs) return null;
    const sp = this.spec(cs); if (!sp) return null;
    const key = cs + '|' + text; if (this.cache.has(key)) return this.cache.get(key);
    const st = this.models[sp.model]; if (!st || st.state !== 'ready') { this.ensure(sp.model); return null; }
    const id = ++this.seq; const t0 = performance.now();
    const p = new Promise((res, rej) => { this.pending[id] = { res, rej }; this.spawn().postMessage({ type: 'synth', id, model: sp.model, url: this.url(sp.model), text: this.norm(text), speaker: sp.speaker, lengthScale: sp.lengthScale, noise: sp.noise, noiseW: sp.noiseW, espeak: sp.espeak }); })
      .then((r) => { r.sp = sp; r.wall = Math.round(performance.now() - t0); const dur = r.samples.length / r.sampleRate; this.stats.synth.push({ ms: r.wall, rtf: r.wall / 1000 / Math.max(dur, 0.1) }); if (this.stats.synth.length > 50) this.stats.synth.shift(); this.stats.last = { text, voice: sp.voice, ms: r.wall, dur: +dur.toFixed(2) }; return r; });
    p.catch(() => {}); this.cache.set(key, p); while (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value);
    return p;
  },
  /* Resolves true when the transmission was spoken with a synthesised voice, false when the caller should fall back. */
  async speak(text, cs) {
    const p = this.prepare(text, cs); if (!p) return false;
    let r; try { r = await p; } catch (e) { this.stats.errors++; this.stats.lastErr = e.message; return false; } finally { this.cache.delete(cs + '|' + text); }
    return this.play(r);
  },
  play(r) {
    return new Promise((resolve) => {
      if (!Sound.ctx) { resolve(false); return; }
      let started = false;
      Sound.whenRunning(() => {
        started = true; const c = Sound.ctx; const buf = c.createBuffer(1, r.samples.length, r.sampleRate); buf.getChannelData(0).set(r.samples);
        const fx = VoicePack.chain(c); const src = c.createBufferSource(); src.buffer = buf; src.connect(fx.input);
        if (Sound.radioFx) { Sound.tone('click'); Sound.noiseOn(); }
        src.start(c.currentTime + 0.09); this.stats.tts++; Sound.lastVoiceUsed = `${r.sp.voice} · Piper ${r.sp.model}`;
        src.onended = () => { Sound.noiseOff(); setTimeout(() => { try { fx.out.disconnect(); } catch (e) {} }, 400); resolve(true); };
      });
      setTimeout(() => { if (!started) resolve(false); }, 600);
    });
  },
  median(k) { const v = this.stats.synth.map(s => s[k]).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; },
  label() {
    const parts = Object.entries(this.models).map(([m, s]) => `${m} ${s.state === 'ready' ? 'ok' : s.state === 'loading' ? Math.round(100 * s.loaded / Math.max(1, s.total)) + ' %' : 'chyba'}`);
    return parts.join(', ') || 'nenačteno';
  },
};
