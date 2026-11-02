'use strict';
/* Voice control: push-to-talk, microphone capture (AudioWorklet), speech recognition in a worker (Whisper via
   transformers.js), interpretation by VoiceParser and the radio policy (readback / "say again"). */

/* Whisper models (onnx-community ONNX exports), pinned to a hub revision. dtype per device: WASM uses 8-bit weights;
   WebGPU keeps the encoder in fp32 (fp16 overflows on some GPUs) and a 4-bit decoder (the transformers.js WebGPU demo
   setup). mb = download size for that device. Kept JSON-compatible: tools/asr_eval/browser.js reads it. */
const ASR_MODELS = {
  "tiny.en": {"repo": "onnx-community/whisper-tiny.en", "revision": "2575352d61be1bf7225cf8f8b268a4678025fc58", "mb": {"wasm": 41, "webgpu": 120},
    "dtype": {"wasm": {"encoder_model": "q8", "decoder_model_merged": "q8"}, "webgpu": {"encoder_model": "fp32", "decoder_model_merged": "q4"}}},
  "base.en": {"repo": "onnx-community/whisper-base.en", "revision": "51eefc0af78b103839eda9e7e4f4186acc6517fe", "mb": {"wasm": 77, "webgpu": 206},
    "dtype": {"wasm": {"encoder_model": "q8", "decoder_model_merged": "q8"}, "webgpu": {"encoder_model": "fp32", "decoder_model_merged": "q4"}}},
  "small.en": {"repo": "onnx-community/whisper-small.en", "revision": "482fb8ba081b6e906f92efe103622316b2a0cc69", "mb": {"wasm": 249, "webgpu": 410},
    "dtype": {"wasm": {"encoder_model": "q8", "decoder_model_merged": "q8"}, "webgpu": {"encoder_model": "fp16", "decoder_model_merged": "q4"}}}
};

/* ---------- speech recognition: client of docs/asr-worker.js ---------- */
const ASR = {
  worker: null, state: 'off', model: null, device: null, info: null, err: '', fallback: '', files: {}, seq: 0, pending: {}, gpu: null, loading: null,
  pref: { model: Store.get('atc.asr.model', 'base.en'), device: Store.get('atc.asr.device', 'auto') },
  setPref(k, v) { this.pref[k] = v; Store.set('atc.asr.' + k, v); App.emit('asr'); },
  /* WebGPU availability as the app sees it (the worker repeats the check for its own context). */
  async probeGpu() {
    if (this.gpu) return this.gpu;
    let g = { ok: false, why: 'navigator.gpu chybí' };
    if (navigator.gpu) {
      try {
        const a = await navigator.gpu.requestAdapter();
        if (a) { const i = a.info || {}; g = { ok: true, desc: [i.vendor, i.architecture, i.description].filter(Boolean).join(' ') || 'adaptér', f16: a.features.has('shader-f16') }; }
        else g = { ok: false, why: 'žádný adaptér' };
      } catch (e) { g = { ok: false, why: e.message }; }
    }
    this.gpu = g; App.emit('asr'); return g;
  },
  progress() { let l = 0, t = 0; for (const f of Object.values(this.files)) { l += f.loaded; t += f.total; } return t ? l / t : 0; },
  downloaded() { let l = 0; for (const f of Object.values(this.files)) l += f.loaded; return l; },
  /* Load (or switch to) a model. 'auto' prefers WebGPU and falls back to WASM if the WebGPU session cannot be created. */
  load(model, devicePref) {
    model = model || this.pref.model; devicePref = devicePref || this.pref.device;
    if (this.state === 'ready' && this.model === model && (devicePref === 'auto' || devicePref === this.device)) return Promise.resolve(this.info);
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const M = ASR_MODELS[model]; if (!M) throw new Error('neznámý model ' + model);
      const gpu = await this.probeGpu();
      let device = devicePref === 'auto' ? (gpu.ok ? 'webgpu' : 'wasm') : devicePref;
      Object.assign(this, { state: 'loading', model, device, err: '', fallback: '', files: {}, info: null }); App.emit('asr');
      try { this.info = await this.loadOn(M, device); }
      catch (e) {
        if (device !== 'webgpu' || devicePref === 'webgpu') throw e;
        this.fallback = e.message; device = 'wasm'; this.device = device; this.files = {}; App.emit('asr');
        this.info = await this.loadOn(M, device);
      }
      this.state = 'ready'; App.emit('asr'); return this.info;
    })().catch((e) => { this.state = 'error'; this.err = e.message; App.emit('asr'); throw e; }).finally(() => { this.loading = null; });
    return this.loading;
  },
  loadOn(M, device) { this.spawn(); return this.call({ type: 'load', model: M.repo, revision: M.revision, device, dtype: M.dtype[device] }, 'load', 15 * 60000); },
  spawn() {
    if (this.worker) this.worker.terminate();
    for (const k of Object.keys(this.pending)) { this.pending[k].rej(new Error('worker restarted')); delete this.pending[k]; }
    this.worker = new Worker(ASSET['asr-worker.js'], { type: 'module' });
    this.worker.onmessage = (e) => this.onmsg(e.data);
    this.worker.onerror = (e) => { const msg = 'worker: ' + ((e && e.message) || 'chyba'); for (const k of Object.keys(this.pending)) { this.pending[k].rej(new Error(msg)); delete this.pending[k]; } };
  },
  call(msg, key, timeoutMs) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { delete this.pending[key]; rej(new Error('timeout')); }, timeoutMs);
      this.pending[key] = { res: (m) => { clearTimeout(t); res(m); }, rej: (e) => { clearTimeout(t); rej(e); } };
      this.worker.postMessage(msg, msg.audio ? [msg.audio.buffer] : []);
    });
  },
  onmsg(m) {
    if (m.type === 'progress') {
      if (m.file) { const f = this.files[m.file] || (this.files[m.file] = { loaded: 0, total: 0 }); if (m.total) f.total = m.total; f.loaded = m.status === 'done' ? f.total : Math.max(f.loaded, m.loaded); }
      App.emit('asrProgress'); return;
    }
    const key = m.id !== undefined ? m.id : 'load'; const p = this.pending[key]; if (!p) return; delete this.pending[key];
    if (m.type === 'error') p.rej(new Error(m.message)); else p.res(m);
  },
  /* audio: Float32Array at sampleRate (any rate; the worker resamples to 16 kHz). Resolves {text, ms, speech, wall}. */
  async transcribe(audio, sampleRate, prompt) {
    if (this.state !== 'ready') await this.load();
    const id = ++this.seq; const t0 = performance.now();
    const r = await this.call({ type: 'transcribe', id, audio, sampleRate, prompt }, id, 90000);
    r.wall = Math.round(performance.now() - t0); return r;
  },
  label() {
    if (this.state === 'off') return 'nenačten';
    if (this.state === 'loading') return `načítá se ${this.model} (${this.device}) ${Math.round(this.progress() * 100)} %`;
    if (this.state === 'error') return 'chyba: ' + this.err;
    const i = this.info || {}, dt = i.dtype ? `${i.dtype.encoder_model}/${i.dtype.decoder_model_merged}` : '';
    return `${this.model} · ${this.device}${this.device === 'wasm' ? ` (${i.variant}, ${i.threads} vl.)` : ''} · ${dt}`;
  },
};

/* ---------- microphone: getUserMedia -> AudioWorklet (docs/mic-worklet.js) ---------- */
const Mic = {
  stream: null, src: null, node: null, sink: null, chunks: [], n: 0, rec: false, level: 0, t0: 0, flushed: null, workletCtx: null,
  keepOpen: Store.get('atc.mic.keepOpen', false), capturing: false,
  diag: { perm: '–', opens: 0, openMs: 0, rate: 0, track: '–', session: '–', err: '', blocks: 0 },
  async perm() {
    try { if (navigator.permissions && navigator.permissions.query) { const p = await navigator.permissions.query({ name: 'microphone' }); this.diag.perm = p.state; p.onchange = () => { this.diag.perm = p.state; App.emit('voice'); }; } }
    catch (e) { this.diag.perm = 'nelze zjistit'; }
  },
  /* iOS: the page's audio session must allow recording while the microphone is open, and go back to playback after. */
  session(type) {
    try { if (navigator.audioSession) { if (navigator.audioSession.type !== type) navigator.audioSession.type = type; this.diag.session = navigator.audioSession.type; } else this.diag.session = 'nepodporováno'; }
    catch (e) { this.diag.session = 'chyba (' + e.name + ')'; }
  },
  get open() { return !!(this.stream && this.stream.active && this.node); },
  /* Open the microphone (shared promise: a second PTT press while the first one waits reuses it). */
  ensure() {
    if (this.open) return Promise.resolve();
    if (!this.opening) this.opening = this.openNow().finally(() => { this.opening = null; });
    return this.opening;
  },
  async openNow() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia není k dispozici');
    const c = Sound.ensureCtx(); if (!c) throw new Error('Web Audio není k dispozici');
    if (!c.audioWorklet) throw new Error('AudioWorklet není k dispozici');
    const t0 = performance.now(); this.capturing = true; this.session('play-and-record');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { this.capturing = false; this.session('playback'); this.diag.err = e.name; if (e.name === 'NotAllowedError') this.diag.perm = 'denied'; throw new Error(e.name === 'NotAllowedError' ? 'mikrofon není povolený' : e.name + ': ' + e.message); }
    this.diag.perm = 'granted';
    try {
      if (this.workletCtx !== c) { await c.audioWorklet.addModule(ASSET['mic-worklet.js']); this.workletCtx = c; }
      if (c.state !== 'running') { try { await Promise.race([c.resume(), new Promise(r => setTimeout(r, 300))]); } catch (e) {} } // a touch pointerdown is not a user activation: do not wait for one
      this.stream = stream; this.src = c.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(c, 'mic-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.sink = c.createGain(); this.sink.gain.value = 0; // keeps the worklet in the rendering graph, silently
      this.src.connect(this.node); this.node.connect(this.sink); this.sink.connect(c.destination);
      this.node.port.onmessage = (e) => this.onmsg(e.data);
    } catch (e) { stream.getTracks().forEach(t => t.stop()); this.stream = null; this.close(); throw new Error('zachytávání: ' + e.message); }
    const tr = stream.getAudioTracks()[0]; const st = tr && tr.getSettings ? tr.getSettings() : {};
    this.diag.track = `${(tr && tr.label) || 'mikrofon'} · ${st.sampleRate || c.sampleRate} Hz${st.echoCancellation ? ' · EC' : ''}${st.noiseSuppression ? ' · NS' : ''}${st.autoGainControl ? ' · AGC' : ''}`;
    this.diag.rate = c.sampleRate; this.diag.opens++; this.diag.openMs = Math.round(performance.now() - t0);
    if (tr) tr.onended = () => { this.close(); App.emit('voice'); };
  },
  onmsg(m) {
    if (m.samples) {
      this.diag.blocks++; this.level = Math.max(m.peak, this.level * 0.7);
      if (this.rec) { this.chunks.push(m.samples); this.n += m.samples.length; if (this.n > this.diag.rate * 30 && this.onLimit) this.onLimit(); }
    } else if (m.flushed && this.flushed) { const f = this.flushed; this.flushed = null; f(); }
  },
  start() { this.chunks = []; this.n = 0; this.rec = true; this.t0 = performance.now(); },
  /* Ends the recording; resolves {audio, sampleRate, ms} once the worklet has delivered its last block. */
  async stop() {
    if (!this.rec) return null;
    if (this.node) await new Promise((res) => { this.flushed = res; this.node.port.postMessage('flush'); setTimeout(res, 300); });
    this.rec = false; this.flushed = null;
    const audio = new Float32Array(this.n); let o = 0; for (const c of this.chunks) { audio.set(c, o); o += c.length; } this.chunks = [];
    const out = { audio, sampleRate: this.diag.rate || 48000, ms: Math.round(performance.now() - this.t0) };
    if (!this.keepOpen) this.close();
    return out;
  },
  close() {
    try { if (this.src) this.src.disconnect(); if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); } if (this.sink) this.sink.disconnect(); } catch (e) {}
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = this.src = this.node = this.sink = null; this.rec = false; this.level = 0;
    if (this.capturing) { this.capturing = false; this.session('playback'); }
  },
};

/* ---------- push-to-talk and the radio policy ---------- */
const Voice = {
  ptt: false, phase: 'idle', src: '', blocked: false, learning: false, last: null, history: [], pendingTx: 0, gen: 0,
  key: Store.get('atc.voice.key', null), usePrompt: Store.get('atc.voice.prompt', true),
  minConf: 0.6, // below: the pilot asks "say again" (tuned on tools/asr_eval, see CLAUDE.md)
  stats: { tx: 0, ok: 0, sayAgain: 0, ambiguous: 0, noCs: 0, empty: 0, blocked: 0, errors: 0, cut: 0, src: {} },
  emit() { App.emit('voice'); },
  set(k, v) { this[k] = v; Store.set(k === 'usePrompt' ? 'atc.voice.prompt' : 'atc.voice.' + k, v); this.emit(); },
  /* Aircraft the controller can address: on this frequency (own or calling in), not transferred, not landed. */
  onFreq() { return App.sim.ac.filter(a => !a.done && (a.ctl === 'own' || a.ctl === 'pend')); },
  rwy() { return '24'; },
  /* Key used as PTT: Space, or a learned key (Bluetooth pedal). Space only when no text field has focus. */
  isKey(e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement && document.activeElement.tagName) || '');
    if (this.key && e.code === this.key.code) return !typing || e.key.length !== 1; // a pedal that sends a printable key does not steal typing
    return e.code === 'Space' && !typing;
  },
  learn() { this.learning = true; this.emit(); toast('Stiskni pedál nebo klávesu, která bude PTT (Esc zruší).', 4000); },
  keydown(e) {
    if (this.learning) {
      e.preventDefault(); e.stopPropagation(); this.learning = false;
      if (e.key !== 'Escape') { this.set('key', { code: e.code, key: e.key }); toast(`PTT klávesa: ${e.code || e.key}`); } else this.emit();
      return true;
    }
    if (!this.isKey(e)) return false;
    e.preventDefault(); e.stopPropagation(); if (!e.repeat) this.down(this.key && e.code === this.key.code ? 'pedal' : 'key');
    return true;
  },
  keyup(e) { if (!this.ptt || !this.isKey(e)) return false; e.preventDefault(); e.stopPropagation(); this.up(); return true; },
  async down(src) {
    if (this.ptt) return;
    const gen = ++this.gen; this.ptt = true; this.src = src; this.stats.src[src] = (this.stats.src[src] || 0) + 1; App.feature('ptt', src);
    this.blocked = !!App.comms.speaking; // stepping on a pilot: in reality neither transmission gets through
    App.comms.txOn(); this.phase = 'opening'; this.emit();
    const mic = Mic.ensure(); // the microphone first: the controller is already speaking
    if (ASR.state === 'off' || ASR.state === 'error') setTimeout(() => ASR.load().catch(() => {}), 50); // first use: start the model download now
    try { await mic; }
    catch (e) { if (gen === this.gen) { this.ptt = false; App.comms.txOff(); this.fail('MIC ' + e.message); } return; }
    if (gen !== this.gen) return; // a newer press took over
    if (!this.ptt) { if (!Mic.keepOpen) Mic.close(); this.phase = this.pendingTx > 0 ? 'asr' : 'idle'; this.stats.cut++; this.last = { outcome: 'PTT RELEASED BEFORE THE MICROPHONE OPENED', t: App.sim.t }; this.emit(); return; }
    if (Sound.ctx && Sound.ctx.state !== 'running') { // iOS after backgrounding: the capture graph does not run until a tap resumes audio
      this.ptt = false; App.comms.txOff(); if (!Mic.keepOpen) Mic.close(); toast('Zvuk je pozastavený: klepni kamkoli a pak znovu stiskni PTT.', 3500); this.fail('AUDIO SUSPENDED'); return;
    }
    Mic.onLimit = () => { toast('Vysílání delší než 30 s bylo ukončeno.', 3000); this.up(); };
    Mic.start(); this.phase = 'tx'; this.emit();
  },
  async up() {
    if (!this.ptt) return;
    this.ptt = false;
    if (this.phase !== 'tx') { App.comms.txOff(); this.emit(); return; } // still opening: down() finishes the cleanup
    const rec = await Mic.stop(); App.comms.txOff(); this.stats.tx++;
    if (!rec) { this.phase = 'idle'; this.emit(); return; }
    if (this.blocked) { this.stats.blocked++; App.comms.log('sys', 'BLOCKED: simultaneous transmission, instruction not received'); this.done({ outcome: 'BLOCKED', dur: rec.audio.length / rec.sampleRate }); return; }
    this.phase = 'asr'; this.pendingTx++; this.emit();
    const aircraft = this.onFreq();
    try {
      const r = await ASR.transcribe(rec.audio, rec.sampleRate, this.usePrompt ? VoiceParser.prompt(aircraft, { rwy: this.rwy() }) : null);
      this.pendingTx--; this.handle(r, this.onFreq(), rec.audio.length / rec.sampleRate, rec.ms);
    } catch (e) { this.pendingTx--; this.fail('ASR ' + e.message); }
  },
  fail(msg) { this.stats.errors++; if (!this.ptt) this.phase = this.pendingTx > 0 ? 'asr' : 'idle'; this.last = { outcome: msg, t: App.sim.t, err: true }; this.history.unshift(this.last); this.history.length = Math.min(this.history.length, 20); this.emit(); },
  /* Radio policy for a recognised transmission. Phrases stay inside the voice-pack vocabulary (tools/tts/packgen.py). */
  handle(r, aircraft, dur, recMs) {
    const text = (r.text || '').replace(/\s+/g, ' ').trim(); const comms = App.comms; const pct = (x) => Math.round(x * 100) + ' %';
    const res = { text, dur: +(dur || 0).toFixed(1), hold: recMs ? +(recMs / 1000).toFixed(1) : null, wall: r.wall || 0, ms: r.ms || {}, t: App.sim.t, device: ASR.device };
    if (!text || r.empty || !/[a-z0-9]/i.test(text)) { this.stats.empty++; res.outcome = 'NO SPEECH'; return this.done(res); }
    const p = VoiceParser.parse(text, aircraft); res.conf = p.conf || 0;
    if (p.ac && p.cmds.length && p.conf >= this.minConf) {
      this.stats.ok++; res.outcome = `${p.ac.cs} ${p.cmds.map(cmdLabel).join(' ')}`;
      comms.atc(p.ac, p.cmds, { text, note: `→ ${res.outcome} · ${pct(p.conf)}`, delay: rnd(0.8, 1.8) });
    } else if (p.ac) { // callsign understood, instruction not (or not reliably): that pilot asks to repeat
      this.stats.sayAgain++; res.outcome = `${p.ac.cs} SAY AGAIN`;
      comms.log('atc', text, `→ ${p.ac.cs} ${p.cmds.map(cmdLabel).join(' ') || 'INSTRUCTION ?'} · ${pct(p.conf)} · SAY AGAIN`);
      comms.pilot(p.ac, `say again, ${Phrase.csText(p.ac)}`, `say again, ${Speak.callsign(p.ac)}`, rnd(1, 2));
    } else if (p.ambiguous) { // two flights fit: one of them asks whom the call was for
      this.stats.ambiguous++; res.outcome = `CALLSIGN ${p.ambiguous.join(' / ')} ?`;
      comms.log('atc', text, `→ ${p.ambiguous.join(' / ')} ? · CALLSIGN AMBIGUOUS`);
      const ac = aircraft.find(a => a.cs === p.ambiguous[0]); if (ac) comms.pilot(ac, 'Praha Radar, say again', 'Praha Radar, say again', rnd(1, 2));
    } else { // no callsign: a pilot answers only if it sounded like an instruction
      this.stats.noCs++; res.outcome = 'CALLSIGN ?';
      comms.log('atc', text, '→ CALLSIGN NOT RECOGNISED');
      if (aircraft.length && p.tokens && p.tokens.length >= 3) comms.pilot(pick(aircraft), 'Praha Radar, say again', 'Praha Radar, say again', rnd(1.2, 2.4));
    }
    this.done(res);
  },
  done(res) { if (!this.ptt) this.phase = this.pendingTx > 0 ? 'asr' : 'idle'; this.last = res; this.history.unshift(res); this.history.length = Math.min(this.history.length, 20); this.emit(); },
  latencies() { return this.history.filter(h => h.wall).map(h => h.wall).sort((a, b) => a - b); },
  /* Pipeline check without a microphone: a voice pack (American voice, DAL pool) speaks a controller instruction to an
     aircraft on frequency, rendered offline at 16 kHz through the radio filter, then ASR -> parser -> radio policy. */
  async selfTest(cs) {
    const aircraft = this.onFreq(); const pref = ['AFR', 'DLH', 'UAE', 'BAW', 'KLM', 'EZY', 'AUA']; // telephony Whisper writes reliably
    const ac = (cs ? aircraft.find(a => a.cs === cs) : null) || pref.map(p => aircraft.find(a => a.ctl === 'own' && a.alt > 8000 && a.cs.startsWith(p))).find(Boolean) || aircraft.find(a => a.alt > 8000) || aircraft[0];
    if (!ac) throw new Error('no aircraft on frequency');
    const fl = Math.max(60, Math.floor(ac.alt / 1000) * 10 - 20); const say = `${Speak.callsign(ac)}, descend flight level ${Speak.digits(fl)}`;
    Sound.ensureCtx(); const r0 = await VoicePack.renderOffline(say, 'DAL94'); if (!r0.samples) throw new Error('voice pack lacks: ' + r0.missing);
    this.phase = 'asr'; this.pendingTx++; this.emit();
    let r; try { r = await ASR.transcribe(Float32Array.from(r0.samples), r0.sr, this.usePrompt ? VoiceParser.prompt(aircraft, { rwy: this.rwy() }) : null); }
    finally { this.pendingTx--; }
    this.handle(r, this.onFreq(), r0.samples.length / r0.sr); this.stats.selfTests = (this.stats.selfTests || 0) + 1;
    return { expect: `${ac.cs} FL${String(fl).padStart(3, '0')}`, got: this.last.outcome, text: this.last.text, ms: r.wall };
  },
  hud() {
    if (this.learning) return 'PRESS PTT KEY…';
    if (this.phase === 'opening') return 'MIC…';
    if (this.phase === 'tx') return 'TX';
    if (this.phase === 'asr') return ASR.state === 'loading' ? `MODEL ${Math.round(ASR.progress() * 100)} %` : 'ASR…';
    if (ASR.state === 'loading') return `MODEL ${Math.round(ASR.progress() * 100)} %`;
    if (ASR.state === 'error') return 'ASR ERROR';
    return this.last ? this.last.outcome : `PTT · ${this.key ? 'SPACE / ' + (this.key.code || this.key.key).toUpperCase() : 'SPACE'}`;
  },
};

/* PTT control for a radar view: hold the button (finger, Pencil, mouse); shows phase, level and the last outcome. */
function pttControl(container) {
  const hud = el('div', { class: 'ptt-hud', 'aria-live': 'polite' });
  const btn = el('button', { class: 'ptt-btn', 'aria-label': 'Push to talk' }, el('span', { text: 'PTT' }));
  const box = el('div', { class: 'ptt' }, hud, btn); container.append(box);
  let pid = null;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (pid !== null) return; pid = e.pointerId; try { btn.setPointerCapture(e.pointerId); } catch (_) {} App.inputSeen(e, 'down'); Voice.down(e.pointerType || 'touch'); });
  const end = (e) => { if (e.pointerId !== pid) return; pid = null; Voice.up(); };
  btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', end); btn.addEventListener('lostpointercapture', end);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  let raf = 0; const meter = () => { btn.style.setProperty('--lvl', Voice.phase === 'tx' ? Math.min(1, Mic.level * 3).toFixed(2) : '0'); raf = Voice.phase === 'tx' ? requestAnimationFrame(meter) : 0; };
  const render = () => {
    hud.textContent = Voice.hud(); box.dataset.phase = Voice.phase; box.classList.toggle('err', !!(Voice.last && Voice.last.err) || ASR.state === 'error');
    box.classList.toggle('say', !!(Voice.last && /SAY AGAIN|\?/.test(Voice.last.outcome || '')) && Voice.phase === 'idle');
    if (!raf) meter();
  };
  App.on('voice', render); App.on('asr', render); App.on('asrProgress', render); render();
  return { box, btn, hud };
}
