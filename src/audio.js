'use strict';
/* Sound: pilot voices (speechSynthesis), radio noise and alert tones (Web Audio).
   iOS notes: Web Audio starts suspended and may be muted by Silent Mode; it is also interrupted when the app goes to the
   background. Fixes: playback audio session where supported, a silent looping media element that moves iOS into the
   playback category, and a resume attempt on every user gesture until the context is really running. */
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|pipe organ|ralph|junior|kathy|princess|fred/i;
const SILENT_WAV = 'data:audio/wav;base64,UklGRsQPAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAPAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
const Sound = {
  ctx: null, enabled: false, wanted: false, ttsOk: 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined',
  voices: [], radioFx: true, vol: 0.9, rateMul: 1.0, noiseVol: 0.05, profiles: {}, lastVoiceUsed: '', ttsEvents: { start: 0, end: 0, error: 0 },
  diag: { unlocks: 0, resumes: 0, resumeFails: 0, dropped: 0, session: '–', media: '–' },
  init() {
    if (!this.ttsOk) return;
    const load = () => { try { const v = speechSynthesis.getVoices() || []; if (v.length) this.voices = v.filter(x => !NOVELTY.test(x.name)); } catch (e) {} };
    load();
    try { speechSynthesis.onvoiceschanged = () => { load(); this.profiles = {}; App.emit('voices'); }; } catch (e) {}
    let n = 0; const iv = setInterval(() => { load(); if (this.voices.length || ++n > 20) { clearInterval(iv); App.emit('voices'); } }, 500);
  },
  /* 'off' before the first gesture, 'on' when the audio context runs, 'paused' when iOS suspended or interrupted it */
  status() {
    if (!this.enabled) return 'off';
    if (!this.ctx) return this.ttsOk ? 'on' : 'off';
    return this.ctx.state === 'running' ? 'on' : 'paused';
  },
  ensureCtx() {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    if (!this.ctx || this.ctx.state === 'closed') {
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { this.ctx = new AC(); } catch (e2) { this.ctx = null; return null; } }
      this.buildNoise();
      this.ctx.onstatechange = () => App.emit('audio');
    }
    return this.ctx;
  },
  /* Must run inside a user gesture (touchend, click, keydown). Safe to call repeatedly. */
  unlock() {
    this.wanted = true; this.diag.unlocks++;
    // while the microphone is open (push-to-talk) the session must stay 'play-and-record' (see Mic in voice.js)
    const type = typeof Mic !== 'undefined' && Mic.capturing ? 'play-and-record' : 'playback';
    try { if (navigator.audioSession) { if (navigator.audioSession.type !== type) navigator.audioSession.type = type; this.diag.session = navigator.audioSession.type; } else this.diag.session = 'nepodporováno'; } catch (e) { this.diag.session = 'chyba'; }
    const c = this.ensureCtx();
    if (c) {
      if (c.state !== 'running') { this.diag.resumes++; try { const p = c.resume(); if (p && p.then) p.then(() => App.emit('audio'), () => { this.diag.resumeFails++; App.emit('audio'); }); } catch (e) { this.diag.resumeFails++; } }
      try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, c.sampleRate); s.connect(c.destination); s.start(0); } catch (e) {}
    }
    this.keepAlive(true);
    if (this.ttsOk) { try { if (!this.ttsPrimed) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); this.ttsPrimed = true; } if (speechSynthesis.paused) speechSynthesis.resume(); } catch (e) {} }
    this.enabled = true; App.emit('audio');
  },
  /* Silent looping media element: keeps iOS in the playback audio category so Web Audio is not muted by Silent Mode. */
  keepAlive(on) {
    if (on) {
      if (!this.silent) { const a = document.createElement('audio'); a.src = SILENT_WAV; a.loop = true; a.preload = 'auto'; a.setAttribute('playsinline', ''); a.setAttribute('aria-hidden', 'true'); this.silent = a; }
      try { const p = this.silent.play(); if (p && p.then) p.then(() => { this.diag.media = 'běží'; }, (e) => { this.diag.media = 'odmítnuto (' + (e && e.name || 'chyba') + ')'; }); } catch (e) { this.diag.media = 'chyba'; }
    } else if (this.silent) { try { this.silent.pause(); } catch (e) {} this.diag.media = 'pozastaveno'; }
  },
  /* True when everything is running; used by the gesture hook to decide whether to unlock again. */
  live() { return this.enabled && (!this.ctx || this.ctx.state === 'running') && (!this.silent || !this.silent.paused); },
  onHidden() { this.stopAll(); this.keepAlive(false); App.emit('audio'); },
  onVisible() {
    if (!this.wanted) return;
    if (this.ttsOk) { try { speechSynthesis.cancel(); if (speechSynthesis.paused) speechSynthesis.resume(); } catch (e) {} }
    if (this.ctx && this.ctx.state !== 'running') { try { this.ctx.resume().then(() => App.emit('audio'), () => App.emit('audio')); } catch (e) {} }
    App.emit('audio');
  },
  buildNoise() {
    const c = this.ctx; const len = c.sampleRate * 2; const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0; // light pink-ish noise
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    this.noiseBuf = buf;
    this.bus = c.createGain(); this.bus.gain.value = 1; this.bus.connect(c.destination);
  },
  /* Run fn once the context is running; if iOS still holds it suspended, retry briefly, then drop (needs a tap). */
  whenRunning(fn) {
    const c = this.ctx; if (!c) return;
    if (c.state === 'running') { fn(); return; }
    let done = false; const t = setTimeout(() => { if (!done) { done = true; this.diag.dropped++; App.emit('audio'); } }, 400);
    try { c.resume().then(() => { if (!done && c.state === 'running') { done = true; clearTimeout(t); fn(); } }, () => {}); } catch (e) {}
  },
  noiseOn() {
    if (!this.ctx || !this.radioFx || !this.noiseBuf) return;
    this.whenRunning(() => {
      this.noiseOff(true);
      const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.6;
      const g = c.createGain(); const t = c.currentTime;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(this.noiseVol * 4, t + 0.02); g.gain.linearRampToValueAtTime(this.noiseVol, t + 0.09);
      src.connect(bp).connect(g).connect(this.bus); src.start();
      this.noise = { src, g };
    });
  },
  noiseOff(immediate) {
    const n = this.noise; if (!n || !this.ctx) return; this.noise = null;
    const t = this.ctx.currentTime;
    try {
      if (immediate) { n.src.stop(); return; }
      n.g.gain.cancelScheduledValues(t); n.g.gain.setValueAtTime(this.noiseVol * 5, t); n.g.gain.linearRampToValueAtTime(this.noiseVol * 3, t + 0.06); n.g.gain.linearRampToValueAtTime(0, t + 0.16);
      n.src.stop(t + 0.2);
    } catch (e) {}
  },
  tone(kind) { if (!this.ctx) return; this.whenRunning(() => this.playTone(kind)); },
  playTone(kind) {
    const c = this.ctx; const t0 = c.currentTime + 0.01;
    const beep = (f, t, dur, vol = 0.18, type = 'square') => { const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.setValueAtTime(vol, t + dur - 0.02); g.gain.linearRampToValueAtTime(0, t + dur); o.connect(g).connect(this.bus); o.start(t); o.stop(t + dur + 0.02); };
    if (kind === 'stca') { for (let i = 0; i < 3; i++) { beep(880, t0 + i * 0.5, 0.18, 0.12); beep(660, t0 + i * 0.5 + 0.22, 0.18, 0.12); } }
    else if (kind === 'rimcas') { for (let i = 0; i < 5; i++) beep(1050, t0 + i * 0.22, 0.12, 0.13); }
    else if (kind === 'call') { beep(1320, t0, 0.09, 0.08, 'sine'); beep(1760, t0 + 0.1, 0.12, 0.06, 'sine'); }
    else if (kind === 'click') { beep(2400, t0, 0.02, 0.05, 'square'); }
  },
  hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); },
  byLang(lang) {
    const l = lang.toLowerCase();
    let v = this.voices.filter(x => x.lang && x.lang.toLowerCase().replace('_', '-').startsWith(l));
    const local = v.filter(x => x.localService); if (local.length) v = local;
    return v;
  },
  profileFor(cs, langOverride) {
    const key = cs + '|' + (langOverride || '');
    if (this.profiles[key]) return this.profiles[key];
    const al = AIRLINES[cs.slice(0, 3)]; const lang = langOverride || (al ? al.lang : 'en-GB'); const h = this.hash(cs);
    let pool = this.byLang(lang); let used = lang;
    if (!pool.length) { const fb = ['en-GB', 'en-US', 'en-AU', 'en-IE', 'en-IN', 'en-ZA', 'en']; for (const f of fb) { pool = this.byLang(f); if (pool.length) { used = f; break; } } }
    const voice = pool.length ? pool[h % pool.length] : null;
    const native = used.startsWith('en');
    const p = { voice, lang: voice ? voice.lang : used, wanted: lang, pitch: 0.86 + (h % 30) / 100, rate: (native ? 1.04 : 0.95) + ((h >> 5) % 12) / 100, fallback: !voice || !voice.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)) };
    this.profiles[key] = p; return p;
  },
  estimate(text, rate) { return Math.max(1.2, text.split(/\s+/).length * 0.34 / (rate || 1)); },
  say(text, profile) {
    return new Promise((resolve) => {
      const rate = (profile ? profile.rate : 1) * this.rateMul;
      if (!this.enabled || !this.ttsOk || document.hidden) { setTimeout(resolve, this.estimate(text, rate) * 1000); return; }
      let finished = false; const fin = () => { if (finished) return; finished = true; this.noiseOff(); clearTimeout(wd); resolve(); };
      const wd = setTimeout(fin, (this.estimate(text, rate) + 4) * 1000);
      try {
        const u = new SpeechSynthesisUtterance(text);
        if (profile && profile.voice) { u.voice = profile.voice; u.lang = profile.voice.lang; } else u.lang = 'en-GB';
        u.pitch = profile ? profile.pitch : 1; u.rate = rate; u.volume = this.vol;
        u.onstart = () => { this.ttsEvents.start++; this.noiseOn(); };
        u.onend = () => { this.ttsEvents.end++; fin(); };
        u.onerror = () => { this.ttsEvents.error++; fin(); };
        this.lastVoiceUsed = profile && profile.voice ? `${profile.voice.name} (${profile.voice.lang})` : 'výchozí';
        if (this.radioFx) this.tone('click');
        speechSynthesis.speak(u);
      } catch (e) { fin(); }
    });
  },
  /* Pilot transmission: voice pack first, device voice as the fallback (hybrid). */
  async transmit(text, cs) {
    if (this.enabled && cs && VoicePack.enabled && this.ctx && !document.hidden) { try { if (await VoicePack.speak(text, cs)) return; } catch (e) {} }
    return this.say(text, cs ? this.profileFor(cs) : null);
  },
  stopAll() { try { speechSynthesis.cancel(); } catch (e) {} this.noiseOff(true); },
};
