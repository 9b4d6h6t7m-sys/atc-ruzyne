'use strict';
/* Application shell: top bar, test navigation, checklist, main loop. */
const App = {
  ls: {}, on(ev, fn) { (this.ls[ev] = this.ls[ev] || []).push(fn); }, emit(ev, ...a) { (this.ls[ev] || []).forEach(f => { try { f(...a); } catch (e) { console.error(e); } }); },
  speed: 1, paused: false, features: {}, inputs: { touch: 0, pen: 0, mouse: 0, penHover: 0, mouseHover: 0, maxPressure: 0, tilt: '' },
  gest: {}, keys: [], radars: [], cmdInputs: [], results: {}, fps: 0, hiddenCount: 0, active: null, mounted: {}, perfResult: null,
  feature(name, detail) { const f = this.features[name] || (this.features[name] = { n: 0, d: new Set() }); f.n++; if (detail) f.d.add(detail); this.refreshChecksSoon(); },
  gestureSeen(name) { this.feature(name); },
  inputSeen(e, phase) {
    const t = e.pointerType; if (!t) return;
    if (phase === 'hover') { if (t === 'pen') this.inputs.penHover++; else if (t === 'mouse') this.inputs.mouseHover++; }
    else if (this.inputs[t] !== undefined) this.inputs[t]++;
    if (t === 'pen' && e.pressure) this.inputs.maxPressure = Math.max(this.inputs.maxPressure, e.pressure);
    if (t === 'pen' && (e.tiltX || e.tiltY)) this.inputs.tilt = `${Math.round(e.tiltX)}° / ${Math.round(e.tiltY)}°`;
    if (phase !== 'move') this.refreshChecksSoon();
  },
  keySeen(e) { const k = e.key === ' ' ? 'Mezera' : e.key; this.keys.push((e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.metaKey ? 'Cmd+' : '') + k); if (this.keys.length > 200) this.keys.shift(); this.emit('key'); this.refreshChecksSoon(); },
  setVerdict(test, check, v) { const r = this.results[test] || (this.results[test] = {}); r[check] = r[check] === v ? undefined : v; Store.set('atc.demo.results', this.results); this.renderChecks(); this.renderNav(); },
  setNote(test, txt) { const r = this.results[test] || (this.results[test] = {}); r._note = txt; Store.set('atc.demo.results', this.results); },
  refreshChecksSoon() { if (this._rcs) return; this._rcs = setTimeout(() => { this._rcs = null; this.refreshChecks(); }, 250); },
  refreshChecks() {
    const t = this.activeTest; if (!t) return;
    if (this.autoBox) this.fillAuto(t);
    for (const c of t.checks) { const d = document.getElementById(`det-${t.id}-${c.id}`); if (d) { const a = c.auto ? c.auto() : null; d.textContent = a ? 'zachyceno automaticky' : ''; } }
    if (t.summary && t.render) t.render();
    Store.set('atc.demo.inputs', this.inputs);
  },
  refreshAll() { this.renderChecks(); this.renderNav(); },
};

function buildShell() {
  const app = el('div', { id: 'app' });
  // top bar
  const tb = el('header', { id: 'topbar' });
  const navBtn = el('button', { class: 'tb-btn icon-btn', 'aria-label': 'Skrýt nebo zobrazit seznam testů', onclick: () => { app.classList.toggle('nav-hidden'); setTimeout(() => App.radars.forEach(r => r.resize()), 50); } }, svgIcon('menu'));
  App.clockEl = el('span', { class: 'clock', text: '10:00:00 UTC' });
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Rychlost simulace' });
  const sp = [[0, svgIcon('pause'), 'Pauza'], [1, '1×'], [2, '2×'], [4, '4×']];
  App.speedBtns = sp.map(([v, label, aria]) => { const b = el('button', { 'aria-label': aria || `Rychlost ${v}×`, onclick: () => setSpeed(v) }, label); seg.append(b); return { v, b }; });
  App.audioBtn = el('button', { class: 'tb-btn', onclick: () => { Sound.unlock(); } }, 'Zapnout zvuk');
  App.fpsEl = el('span', { class: 'fps', text: '– fps' });
  tb.append(navBtn, el('div', { class: 'brand' }, el('b', { text: 'LKPR · ATC' }), el('span', { text: 'test funkcí v0.5' })), App.clockEl, seg, el('div', { class: 'tb-spacer' }), App.fpsEl, App.audioBtn, el('button', { class: 'tb-btn primary', onclick: () => App.show('results') }, 'Výsledky'));
  // nav
  App.navEl = el('nav', { id: 'testnav', 'aria-label': 'Testy' });
  App.stage = el('main', { id: 'stage' });
  App.checksEl = el('aside', { id: 'checks', 'aria-label': 'Kontrolní seznam' });
  app.append(tb, App.navEl, App.stage, App.checksEl);
  document.body.append(app, el('div', { id: 'toast', role: 'status' }), el('div', { id: 'rotate-hint', text: 'Otoč iPad na šířku, rozvržení je navržené pro orientaci na šířku.' }));
  for (const c of ['tl', 'tr', 'bl', 'br']) document.body.append(el('div', { class: 'corner ' + c, 'aria-hidden': 'true' }));
  document.body.classList.add('corners-off');
  App.on('audio', () => { const st = Sound.status(); if (st === 'on' && !App._vpPreloaded) { App._vpPreloaded = true; VoicePack.preload(App.sim.ac.map(a => a.cs).concat(['TVS35J', 'EZY452', 'BAW852'])); PilotTTS.preload(App.sim.ac.map(a => a.cs)); } App.audioBtn.textContent = st === 'on' ? 'Zvuk zapnutý' : st === 'paused' ? 'Obnovit zvuk' : 'Zapnout zvuk'; App.audioBtn.classList.toggle('on', st === 'on'); App.audioBtn.classList.toggle('warn', st === 'paused'); App.refreshChecksSoon(); });
}
function svgIcon(kind) {
  const ns = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(ns, 'svg'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', kind === 'pause' ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z'); s.append(p); return s;
}
function setSpeed(v) {
  if (v === 0) App.paused = !App.paused; else { App.speed = v; App.paused = false; }
  for (const { v: sv, b } of App.speedBtns) b.setAttribute('aria-pressed', String(sv === 0 ? App.paused : (!App.paused && App.speed === sv)));
  App.feature('speed', v ? v + 'x' : 'pause');
}

App.renderNav = function () {
  this.navEl.innerHTML = '';
  TESTS.forEach((t, i) => {
    if (t.summary) this.navEl.append(el('div', { class: 'nav-sep' }));
    let ok = 0, bad = 0; for (const c of t.checks) { const v = (this.results[t.id] || {})[c.id]; if (v === 'ok') ok++; if (v === 'bad') bad++; }
    const st = bad ? 'bad' : (t.checks.length && ok === t.checks.length) ? 'ok' : (ok ? 'part' : '');
    this.navEl.append(el('button', { class: 'nav-item', 'aria-current': String(this.active === t.id), onclick: () => this.show(t.id) },
      el('span', { class: 'num', text: t.summary ? '' : String(i + 1) }), el('span', { text: t.name }), t.summary ? null : el('span', { class: 'dot ' + st, 'aria-label': st === 'ok' ? 'vše funguje' : st === 'bad' ? 'něco nefunguje' : st === 'part' ? 'částečně' : 'netestováno' })));
  });
};
App.renderChecks = function () {
  const t = this.activeTest; const box = this.checksEl; box.innerHTML = '';
  box.append(el('h2', { text: t.name }));
  if (t.actions) { const a = el('div', { class: 'actions' }); try { t.actions(a); } catch (e) { console.error(e); } box.append(el('div', { class: 'instr' }, el('div', { class: 'label-sm', text: 'Ovládání instruktora' }), a)); }
  box.append(el('p', { class: 'howto', html: t.howto }));
  this.autoBox = el('div', { class: 'auto' }); box.append(el('div', { class: 'label-sm', text: 'Zjištěno automaticky' }), this.autoBox); this.fillAuto(t);
  const r = this.results[t.id] || {};
  for (const c of t.checks) {
    const v = r[c.id]; const a = c.auto ? c.auto() : null;
    box.append(el('div', { class: 'check' + (v === 'ok' ? ' ok' : v === 'bad' ? ' bad' : '') }, el('p', { text: c.t }), el('div', { class: 'detected', id: `det-${t.id}-${c.id}`, text: a ? 'zachyceno automaticky' : '' }),
      el('div', { class: 'verdict' }, el('button', { class: 'yes', 'aria-pressed': String(v === 'ok'), onclick: () => this.setVerdict(t.id, c.id, 'ok') }, 'Funguje'), el('button', { class: 'no', 'aria-pressed': String(v === 'bad'), onclick: () => this.setVerdict(t.id, c.id, 'bad') }, 'Nefunguje'))));
  }
  if (t.checks.length) {
    const id = 'note-' + t.id; const ta = el('textarea', { class: 'note', id, placeholder: 'Poznámka k tomuto testu (nepovinné)' }); ta.value = r._note || '';
    ta.addEventListener('input', () => this.setNote(t.id, ta.value)); ta.addEventListener('keydown', e => e.stopPropagation());
    box.append(el('label', { class: 'label-sm', for: id, text: 'Poznámka' }), ta);
    const idx = TESTS.indexOf(t); const next = TESTS[idx + 1];
    if (next) box.append(el('button', { class: 'btn primary', onclick: () => this.show(next.id) }, `Další test: ${next.name}`));
  }
};
App.fillAuto = function (t) {
  const rows = t.auto ? t.auto() : []; this.autoBox.innerHTML = '';
  if (!rows.length) { this.autoBox.append(el('div', { class: 'k', text: 'Nic se neměří.' })); return; }
  for (const [k, v, cls] of rows) this.autoBox.append(el('div', { class: 'row' }, el('span', { class: 'k', text: k }), el('span', { class: 'v ' + (cls || ''), text: v })));
};
App.show = function (id) {
  const t = TESTS.find(x => x.id === id); if (!t) return;
  if (this.activeTest && this.activeTest.hide) this.activeTest.hide();
  for (const v of this.stage.querySelectorAll('.view')) v.classList.remove('active');
  let v = this.mounted[id];
  if (!v) { v = el('section', { class: 'view', 'aria-label': t.name }); this.stage.append(v); this.mounted[id] = v; v.classList.add('active'); try { t.mount(v); } catch (e) { console.error(e); v.append(el('p', { style: 'padding:20px;color:#ff5c57', text: 'Chyba při spuštění testu: ' + e.message })); } }
  v.classList.add('active');
  this.active = id; this.activeTest = t; Store.set('atc.demo.active', id); this.checksEl.scrollTop = 0;
  if (t.show) t.show();
  this.renderNav(); this.renderChecks();
  setTimeout(() => this.radars.forEach(r => r.resize()), 30);
};
App.resultText = function () {
  const ipad = /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const L = ['ATC Ruzyně · test funkcí v0.5 · výsledky', `Datum: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `Zařízení: ${ipad ? 'iPad' : navigator.platform}, okno ${innerWidth}×${innerHeight}, DPR ${devicePixelRatio}, dotykové body ${navigator.maxTouchPoints || 0}`,
    `Vstupy: dotyk ${this.inputs.touch}, pero ${this.inputs.pen} (hover ${this.inputs.penHover}, max. přítlak ${this.inputs.maxPressure.toFixed(2)}), myš ${this.inputs.mouse} (hover ${this.inputs.mouseHover}), klávesy ${this.keys.length}`,
    `Zvuk: syntéza ${Sound.ttsOk ? 'ano' : 'ne'}, hlasů ${Sound.voices.length}, jazyky ${[...new Set(Sound.voices.map(v => v.lang))].join(' ') || '–'}, přehráno ${Sound.ttsEvents.end}, chyb ${Sound.ttsEvents.error}`,
    `Zvukový systém: stav ${Sound.status()}, kontext ${Sound.ctx ? Sound.ctx.state : '–'}, audioSession ${Sound.diag.session}, médium ${Sound.diag.media}, odemknutí ${Sound.diag.unlocks}, obnovení ${Sound.diag.resumes} (selhalo ${Sound.diag.resumeFails}), zahozené zvuky ${Sound.diag.dropped}`,
    `Hlasové balíčky: načteno ${VoicePack.stats.loaded.join(' ') || '–'}, relací z balíčků ${VoicePack.stats.pack}, hlasem zařízení ${VoicePack.stats.device}, chybějící slova ${Object.keys(VoicePack.stats.missing).join(' ') || '–'}${VoicePack.stats.loadErr ? ', chyby načtení ' + VoicePack.stats.lastErr : ''} · výkon: ${this.perfResult ? `${this.perfResult.avg.toFixed(0)} fps průměr, ${this.perfResult.min.toFixed(0)} fps minimum, ${this.perfResult.n} letadel` : 'neměřeno'}`,
    `Úložiště: localStorage ${Store.ok ? 'ano' : 'ne'}, IndexedDB ${this.idbStatus || '–'}, spuštění ${this.launches}, přechody na pozadí ${this.hiddenCount}`,
    `Neurální hlasy: ${PilotTTS.enabled ? 'zapnuto' : 'vypnuto'}, modely ${PilotTTS.label()}${Object.values(PilotTTS.models).filter(s => s.ms).map(s => '').length ? ', načtení ' + Object.entries(PilotTTS.models).filter(([, s]) => s.ms).map(([m, s]) => m + ' ' + (s.ms / 1000).toFixed(1) + ' s').join(', ') : ''}, relací ${PilotTTS.stats.tts}, záloha balíčkem ${PilotTTS.stats.fallback}, syntéza medián ${PilotTTS.median('ms') ?? '–'} ms (${PilotTTS.median('rtf') !== null ? PilotTTS.median('rtf').toFixed(2) + '× délky' : '–'})${PilotTTS.stats.lastErr ? ', chyba ' + PilotTTS.stats.lastErr : ''}`,
    ...voiceReport(), ...LLMBench.results.slice(0, 4).map(r => `AI model: ${LLMBench.line(r)}` + (r.answers || []).map(a => `\n  "${a.q}" -> "${a.text}" (${a.ok ? 'fakta ok' : 'fakta NE'}, ${a.ttft} ms do 1. tokenu, ${a.total} ms celkem)`).join('')), ''];
  TESTS.forEach((t, i) => {
    if (t.summary) return; const r = this.results[t.id] || {};
    L.push(`[${i + 1}] ${t.name}`);
    for (const c of t.checks) { const v = r[c.id]; const a = c.auto ? c.auto() : null; L.push(`  ${v === 'ok' ? 'FUNGUJE  ' : v === 'bad' ? 'NEFUNGUJE' : '–        '} ${c.t}${a ? ' (zachyceno automaticky)' : ''}`); }
    if (r._note) L.push(`  Poznámka: ${r._note}`);
  });
  return L.join('\n');
};

/* Voice control summary for the results report: backend, timings and the last transcripts (for tuning the parser). */
function voiceReport() {
  const st = Voice.stats, i = ASR.info || {}, g = ASR.gpu, lat = Voice.latencies();
  const L = [`Hlasové ovládání: model ${ASR.label()}${ASR.fallback ? ` (WebGPU selhalo: ${ASR.fallback})` : ''}, WebGPU ${g ? (g.ok ? 'ano ' + g.desc + (g.f16 ? ' f16' : '') : 'ne (' + g.why + ')') : '–'}, načtení ${i.loadMs ? (i.loadMs / 1000).toFixed(1) + ' s' : '–'}, zahřátí ${i.warmMs ? (i.warmMs / 1000).toFixed(1) + ' s' : '–'}, prompt ${Voice.usePrompt ? 'ano' : 'ne'}`,
    `Mikrofon: ${Mic.diag.perm}, ${Mic.diag.track}, otevření ${Mic.diag.openMs} ms (${Mic.diag.opens}×), trvale otevřený ${Mic.keepOpen ? 'ano' : Mic.autoKeep ? 'auto (' + Mic.autoKeep + ')' : 'ne'}, EC/NS/AGC ${Mic.processing ? 'ano' : 'ne'}, audioSession ${Mic.diag.session}${Mic.diag.err ? ', chyba ' + Mic.diag.err : ''}; PTT ${Object.entries(st.src).map(([k, v]) => k + ' ' + v).join(', ') || '–'}${Voice.key ? ', pedál ' + (Voice.key.code || Voice.key.key) : ''}`,
    `Relace: ${st.tx}, provedeno ${st.ok}, say again ${st.sayAgain}, opakování na žádost ${st.repeat || 0}, nejasný znak ${st.ambiguous}, bez znaku ${st.noCs}, ticho ${st.empty}, blokováno ${st.blocked}, PTT puštěno před otevřením mikrofonu ${st.cut}, chyby ${st.errors}, samotest ${Voice.selfOk || 0}/${st.selfTests || 0}; odezva ASR medián ${lat.length ? lat[Math.floor(lat.length / 2)] + ' ms' : '–'}`];
  // per transmission: audio length / PTT hold time, ASR wall time (features + decoder), transcript, outcome
  for (const h of Voice.history.slice(0, 12)) L.push(`  ${hhmmss(h.t || 0)} ${h.dur ? h.dur.toFixed(1) + (h.hold ? '/' + h.hold.toFixed(1) : '') + ' s' : ''} ${h.wall ? h.wall + ' ms' + (h.ms && h.ms.gen ? ` (${h.ms.feat}+${h.ms.gen})` : '') : ''} "${h.text || ''}" -> ${h.outcome || ''}${h.conf ? ' (' + Math.round(h.conf * 100) + ' %)' : ''}`);
  return L;
}

/* ---------- demo world ---------- */
function setupWorld() {
  App.sim = new Sim({ sweep: 4 }); App.comms = new Comms(App.sim); App.gt = new GroundTraffic();
  demoTraffic(App.sim);
  const sim = App.sim, comms = App.comms;
  const klm = sim.find('KLM1355'); if (klm) comms.pilot(klm, 'Praha Radar, KLM 1355, descending FL130, inbound GOLOP', `Praha Radar, ${Speak.callsign(klm)}, descending flight level one three zero, inbound Golop`, 6);
  sim.on('stca', (list) => { Sound.tone('stca'); App.feature('stca'); comms.log('sys', `STCA ${list.map(a => a.cs).join(' / ')}`); if (Sound.status() === 'paused') toast('Výstraha STCA: zvuk je pozastavený, klepni kamkoli pro obnovení.', 3000); });
  sim.on('loc', (ac) => { if (ac.ctl === 'own') comms.pilot(ac, `established localizer runway ${ac.ils}, ${Phrase.csText(ac)}`, `established localizer runway ${Speak.digits(+ac.ils, 2)}, ${Speak.callsign(ac)}`, rnd(1, 3)); });
  sim.on('landed', (ac) => comms.log('sys', `${ac.cs} LANDED RWY ${ac.ils || ''}${ac.ctl !== 'xfer' ? ' (NOT TRANSFERRED TO TWR)' : ''}`));
  sim.on('goaround', (ac, why) => { comms.log('sys', `${ac.cs} MISSED APPROACH`); comms.pilot(ac, `going around, ${Phrase.csText(ac)}`, `going around, ${Speak.callsign(ac)}`, 1); });
  sim.on('left', (ac) => comms.log('sys', `${ac.cs} LEFT AREA`));
  App.gt.onEvent = (t) => { if (App.active === 'ground') toast(t, 2000); };
  // keep the demo alive: new arrivals every 100 s and departures every 150 s of simulated time
  App.spawnT = sim.t + 100; App.depT = sim.t + 70;
}
function maintainWorld() {
  const sim = App.sim;
  if (sim.t >= App.depT) {
    App.depT = sim.t + 150;
    if (sim.ac.filter(a => a.kind === 'dep').length < 4) {
      const al = pick(['EZY', 'TVS', 'RYR', 'WZZ', 'DLH', 'KLM', 'AFR']); const cs = al + Math.floor(rnd(10, 99)) + pick(['ZR', 'K', 'A', 'TX', 'P']);
      const exit = pick(['BALTU', 'VOZ', 'VENOX', 'DOBEN']);
      const a = spawnDeparture(sim, cs, pick(['A21N', 'A320', 'B38M', 'E190']), exit, 350); VoicePack.preload([cs]); PilotTTS.preload([cs]);
      App.comms.pilot(a, `Praha Radar, ${Phrase.csText(a)}, passing 1700 feet climbing 5000 feet, ${exit} departure`, `Praha Radar, ${Speak.callsign(a)}, passing one thousand seven hundred feet, climbing five thousand feet, ${Speak.fix(exit)} departure`, 2);
    }
  }
  if (sim.t < App.spawnT) return; App.spawnT = sim.t + 100;
  if (sim.ac.length > 12) return;
  const entries = [['GOLOP', 'ERASU', ['ERASU']], ['LOMKI', 'SOMIS', ['SOMIS', 'EVEMI', 'ERASU']], ['APRAQ', 'ARVEG', ['ARVEG', 'RATEV']], ['VLM', 'ARVEG', ['ARVEG', 'RATEV']]];
  const [a, b, route] = pick(entries); const p = placeOnLeg(a, b, -2);
  const al = pick(['TVS', 'RYR', 'EZY', 'WZZ', 'DLH', 'AFR', 'KLM', 'BAW', 'LOT', 'AUA', 'SWR', 'THY']);
  const cs = al + (Math.floor(rnd(100, 999))) + (Math.random() < 0.5 ? pick(['A', 'B', 'C', 'K', 'M']) : '');
  VoicePack.preload([cs]); PilotTTS.preload([cs]);
  sim.add({ cs, type: pick(['A320', 'B38M', 'A21N', 'E190', 'B738', 'A20N']), kind: 'arr', ...p, alt: 15000, cfl: 11000, ias: 280, route, orig: pick(['EGLL', 'EDDF', 'LFPG', 'LIRF', 'EHAM', 'LEMD', 'EPWA', 'LOWW']), dest: 'LKPR', star: a, ctl: 'pend', labelOff: { dx: 34, dy: -34 } });
  App.comms.pilot(sim.find(cs), `Praha Radar, ${Phrase.csText(sim.find(cs))}, FL150 descending FL110, inbound ${a}`, `Praha Radar, ${Speak.callsign(sim.find(cs))}, flight level one five zero, descending flight level one one zero, inbound ${Speak.fix(a)}`, 8);
}

/* ---------- main loop ---------- */
let lastT = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
  fpsN++; if (now - fpsT > 1000) { App.fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; App.fpsEl.textContent = App.fps.toFixed(0) + ' fps'; }
  if (!App.paused) {
    let left = dt * App.speed; while (left > 1e-6) { const s = Math.min(0.1, left); App.sim.step(s); App.gt.step(s); left -= s; }
    maintainWorld();
  }
  App.comms.tick();
  App.clockEl.textContent = hhmmss(App.sim.t) + ' UTC';
  const t = App.activeTest;
  if (t) { try { if (t.tick) t.tick(dt * App.speed); if (t.draw) t.draw(now); } catch (e) { if (!App._drawErr) { App._drawErr = true; console.error(e); toast('Chyba vykreslování: ' + e.message, 6000); } } }
  requestAnimationFrame(frame);
}

/* ---------- boot ---------- */
function boot() {
  App.results = Store.get('atc.demo.results', {}) || {};
  const savedIn = Store.get('atc.demo.inputs', null); if (savedIn && typeof savedIn === 'object') for (const k of Object.keys(App.inputs)) if (savedIn[k] !== undefined) App.inputs[k] = savedIn[k];
  App.launches = (Store.get('atc.launches', 0) || 0) + 1; Store.set('atc.launches', App.launches);
  try {
    const req = indexedDB.open('atc-demo', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => { try { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(Date.now(), 'last'); tx.oncomplete = () => { App.idbStatus = 'ok'; App.refreshChecks(); }; tx.onerror = () => { App.idbStatus = 'chyba'; }; } catch (e) { App.idbStatus = 'chyba'; } };
    req.onerror = () => { App.idbStatus = 'nedostupná'; };
  } catch (e) { App.idbStatus = 'nedostupná'; }
  buildShell(); setupWorld(); Sound.init(); setSpeed(1);
  // Audio may only start inside a user gesture. Keep trying on every gesture until the context really runs (iOS suspends it after backgrounding).
  const unlockHook = () => { if (!Sound.live()) Sound.unlock(); };
  for (const ev of ['touchend', 'click', 'keydown', 'pointerup']) window.addEventListener(ev, unlockHook, true);
  window.addEventListener('pagehide', () => { Voice.up(); Sound.onHidden(); });
  window.addEventListener('blur', () => Voice.up()); // a key released outside the window never sends keyup
  // Push-to-talk keys (Space, learned pedal key) are handled in the capture phase, before text fields and shortcuts.
  window.addEventListener('keydown', (e) => { if (Voice.keydown(e)) App.feature('pttKey', e.code); }, true);
  window.addEventListener('keyup', (e) => { Voice.keyup(e); }, true);
  App.on('voice', () => App.refreshChecksSoon()); App.on('asr', () => App.refreshChecksSoon()); App.on('tts', () => App.refreshChecksSoon()); App.on('llm', () => App.refreshChecksSoon()); App.on('llmProgress', () => App.refreshChecksSoon());
  App.on('asr', () => { if (ASR.state === 'ready') Store.set('atc.asr.auto', true); });
  Mic.perm(); ASR.probeGpu(); LLMBench.checkCrash(); document.body.classList.toggle('ptt-left', !!Store.get('atc.voice.pttLeft', false));
  if (Store.get('atc.asr.auto', false)) setTimeout(() => ASR.load().catch(() => {}), 2500); // model used before: load it from the browser cache
  window.addEventListener('pageshow', () => Sound.onVisible());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { App.hiddenCount++; Voice.up(); if (!Voice.ptt) Mic.close(); /* release the microphone (and the headset's call mode) in the background */ if (!App.paused) { setSpeed(0); App.autoPaused = true; } Sound.onHidden(); return; }
    Sound.onVisible();
    if (App.autoPaused) { App.autoPaused = false; toast('Simulace se pozastavila, když byla aplikace na pozadí. Pokračuj tlačítkem 1×. Zvuk se obnoví prvním klepnutím.', 4200); App.refreshChecks(); }
  });
  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    App.keySeen(e);
    if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setSpeed(0); return; } // Space is push-to-talk
    if (e.key === 'Escape') { App.radars.forEach(r => r.select(null)); return; }
    if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const inp = App.cmdInputs.find(i => i.offsetParent !== null);
      if (inp) { e.preventDefault(); inp.focus(); inp.value += e.key.toUpperCase(); inp.dispatchEvent(new Event('input')); App.feature('autoFocus'); }
    }
  });
  window.addEventListener('resize', () => App.radars.forEach(r => r.resize()));
  const start = Store.get('atc.demo.active', 'radar');
  App.show(TESTS.some(t => t.id === start) ? start : 'radar');
  requestAnimationFrame(frame);
}
window.addEventListener('DOMContentLoaded', boot);
window.addEventListener('error', (e) => { try { toast('Chyba: ' + e.message, 6000); } catch (_) {} });
