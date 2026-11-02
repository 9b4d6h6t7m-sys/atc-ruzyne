'use strict';
/* Test definitions: each test mounts a live view, lists checks and reports what was detected automatically. */
const yes = (b) => b ? ['ano', 'ok'] : ['ne', 'bad'];
const fmtVis = (v) => v >= 10000 ? '10 km+' : v >= 1000 ? (v / 1000).toFixed(1) + ' km' : Math.round(v) + ' m';
const sliderToVis = (t) => t >= 100 ? 30000 : Math.round(80 * Math.pow(10000 / 80, t / 99));
const visToSlider = (v) => v >= 10000 ? 100 : Math.round(99 * Math.log(v / 80) / Math.log(10000 / 80));
const featN = (n) => (App.features[n] ? App.features[n].n : 0);
const featD = (n) => (App.features[n] ? [...App.features[n].d].join(', ') : '');

class RadioLog {
  constructor(container) {
    this.el = el('div', { class: 'radio-log', 'aria-live': 'polite' }); container.append(this.el);
    for (const e of App.comms.entries.slice(-30)) this.add(e);
    App.comms.onLog(e => this.add(e));
  }
  add(e) {
    const cls = e.who === 'atc' ? 'atc' : e.who === 'plt' ? 'plt' : 'sys';
    const who = e.who === 'atc' ? 'ATC' : e.who === 'plt' ? 'PILOT' : 'INFO';
    const row = el('div', { class: cls }, el('span', { class: 't', text: hhmmss(e.t) }), `${who}: ${e.text}`);
    if (e.note) row.append(el('span', { class: 'note', text: ' ' + e.note }));
    this.el.append(row);
    while (this.el.children.length > 60) this.el.firstChild.remove();
    this.el.scrollTop = this.el.scrollHeight;
  }
}

function commandLine(container, opts = {}) {
  const box = el('div', { class: 'cmdline' });
  const inp = el('input', { type: 'text', id: opts.id || ('cmd-' + Math.random().toString(36).slice(2)), placeholder: 'CMD  35J L270 F80 S180', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Command line' });
  const HINT = 'H/L/R heading · F flight level · A altitude · S speed · D direct · I24 ILS · TWR/ACC transfer · AS assume · TAB callsign · ↑ history';
  const hint = el('div', { class: 'hint', text: HINT });
  box.append(hint, inp); container.append(box);
  const hist = []; let hi = -1;
  const idle = () => { const s = App.selAc && !App.selAc.done ? App.selAc : null; return s ? `SELECTED ${s.cs} · type the instruction only, e.g. L270 F80` : HINT; };
  const show = () => { if (!inp.value.trim()) { hint.textContent = idle(); return; } const r = resolveCmd(inp.value); hint.textContent = describeParse(r) + (r.ctx ? '  (selected)' : ''); };
  inp.addEventListener('input', show); inp.addEventListener('focus', show);
  App.on('select', () => { if (!inp.value.trim()) hint.textContent = idle(); });
  inp.addEventListener('keydown', e => {
    e.stopPropagation(); App.keySeen(e);
    if (e.key === 'Enter') {
      const r = resolveCmd(inp.value);
      if (r.ac && r.cmds.length) { App.comms.atc(r.ac, r.cmds); App.feature('cmdline'); if (r.ctx) App.feature('cmdContext'); hist.unshift(inp.value.trim()); hist.length = Math.min(hist.length, 30); hi = -1; inp.value = ''; hint.textContent = `SENT  ${r.ac.cs} · ${r.cmds.map(cmdLabel).join(' ')}`; }
      else hint.textContent = 'REJECTED  ' + (r.error || 'CHECK CALLSIGN AND INSTRUCTION');
    } else if (e.key === 'Tab') {
      e.preventDefault(); const parts = inp.value.trim().toUpperCase().split(/\s+/); const tok = parts[0] || '';
      const c = tok ? App.sim.ac.filter(a => a.cs.startsWith(tok) || a.cs.includes(tok)) : [];
      if (c.length === 1) { parts[0] = c[0].cs; inp.value = parts.join(' ') + (parts.length === 1 ? ' ' : ''); App.feature('cmdTab'); show(); }
      else hint.textContent = c.length ? 'MATCHES  ' + c.map(a => a.cs).join(' ') : 'NO MATCH';
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); if (!hist.length) return; hi = clamp(hi + (e.key === 'ArrowUp' ? 1 : -1), -1, hist.length - 1); inp.value = hi < 0 ? '' : hist[hi]; App.feature('cmdHistory'); show();
    } else if (e.key === 'Escape') { inp.value = ''; inp.blur(); }
  });
  App.cmdInputs.push(inp);
  return inp;
}
/* A command without a recognisable callsign goes to the aircraft selected on the radar. */
function resolveCmd(txt) {
  const r = Parser.parse(txt, App.sim.ac);
  if ((!r.ac || !r.cmds.length) && App.selAc && !App.selAc.done && txt.trim()) { const r2 = Parser.parse(App.selAc.cs + ' ' + txt, App.sim.ac); if (r2.ac && r2.cmds.length) return { ...r2, ctx: true }; }
  return r;
}
function describeParse(r) {
  if (!r || !r.ac) return 'CALLSIGN ?';
  return `${r.ac.cs} (${r.mode}) · ${r.cmds.length ? r.cmds.map(cmdLabel).join(' ') : 'INSTRUCTION ?'}${r.bad && r.bad.length ? ' · UNKNOWN: ' + r.bad.join(' ') : ''}`;
}

/* ATC panel: callsign quick-pick, command keys and numeric keypad that build a shorthand command line. */
function mountDock(v, view, testId) {
  const dock = el('div', { class: 'dock' }); v.append(dock);
  const csRow = el('div', { class: 'dock-cs' }); const fixRow = el('div', { class: 'dock-fix', style: 'display:none' });
  const line = el('input', { type: 'text', class: 'dock-line', placeholder: 'CMD  e.g. 35J L270 F80', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Command line' });
  const fb = el('div', { class: 'dock-fb', text: 'SELECT CALLSIGN' });
  let viaPad = false, idle = null;
  const parsed = () => Parser.parse(line.value, App.sim.ac);
  const refresh = () => { const r = parsed(); fb.textContent = line.value.trim() ? describeParse(r) : 'SELECT CALLSIGN'; fb.classList.toggle('ok', !!(r.ac && r.cmds.length)); };
  const send = (how) => { const r = parsed(); if (!(r.ac && r.cmds.length)) { fb.textContent = 'REJECTED  ' + (r.error || 'CHECK CALLSIGN AND INSTRUCTION'); fb.classList.remove('ok'); return; } App.comms.atc(r.ac, r.cmds); App.feature(how); fb.textContent = `SENT  ${r.ac.cs} · ${r.cmds.map(cmdLabel).join(' ')}`; line.value = ''; viaPad = false; fixRow.style.display = 'none'; renderCs(); };
  const put = (t, replaceCs) => { viaPad = true; let v0 = line.value.trim(); if (replaceCs) { const parts = v0.split(/\s+/).filter(Boolean); if (parts.length && App.sim.ac.some(a => a.cs === parts[0])) parts[0] = t; else parts.unshift(t); v0 = parts.join(' '); } else v0 = v0 + t; line.value = v0; refresh(); };
  const sel = () => { const p = line.value.trim().split(/\s+/)[0]; return App.sim.ac.find(a => a.cs === p); };
  const renderCs = () => { csRow.innerHTML = ''; const cur = sel(); const list = App.sim.ac.filter(a => a.ctl === 'own' || a.ctl === 'pend').sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)); for (const a of list) csRow.append(el('button', { class: 'cs-chip' + (a === cur ? ' on' : '') + (a.ctl === 'pend' ? ' pend' : ''), onclick: () => { put(a.cs, true); renderCs(); view.select(a, false); } }, a.cs)); if (!list.length) csRow.append(el('span', { class: 'dock-empty', text: 'NO AIRCRAFT UNDER CONTROL' })); };
  const key = (label, fn, cls = '') => el('button', { class: 'dk ' + cls, onclick: fn }, label);
  const showFix = () => { const ac = sel(); fixRow.innerHTML = ''; const base = ac || { x: 0, y: 0, route: [], routeIdx: 0 }; const route = (base.route || []).slice(base.routeIdx || 0).filter(n => FIX[n]); const near = Object.values(FIX).filter(f => f.cls !== 'ndb').map(f => ({ n: f.n, d: Math.hypot(f.x - base.x, f.y - base.y) })).sort((a, b) => a.d - b.d).slice(0, 10).map(o => o.n); for (const n of [...new Set([...route, ...near])].slice(0, 12)) fixRow.append(el('button', { class: 'cs-chip', onclick: () => { put(' D ' + n); fixRow.style.display = 'none'; } }, n)); fixRow.style.display = 'flex'; };
  const keys = el('div', { class: 'dock-keys' },
    key('HDG', () => put(' H')), key('L', () => put(' L')), key('R', () => put(' R')), key('CFL', () => put(' F')), key('ALT', () => put(' A')), key('SPD', () => put(' S')), key('DCT', showFix), key('ILS 24', () => put(' I24')), key('TWR', () => put(' TWR')), key('ACC', () => put(' ACC')), key('ASSUME', () => put(' AS')),
    key('SEND', () => send(viaPad ? 'padSend' : 'kbdSend'), 'send'),
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(d => key(d, () => put(d), 'num')),
    key('⌫', () => { line.value = line.value.replace(/\s+$/, '').slice(0, -1).replace(/\s+$/, ''); refresh(); }, 'num'), key('CLR', () => { line.value = ''; refresh(); renderCs(); }, 'num'));
  line.addEventListener('input', () => { refresh(); renderCs(); clearTimeout(idle); });
  line.addEventListener('keydown', (e) => { e.stopPropagation(); App.keySeen(e); if (e.key === 'Enter') { e.preventDefault(); send(viaPad ? 'padSend' : 'kbdSend'); } });
  dock.append(csRow, fixRow, el('div', { class: 'dock-row' }, line, fb), keys);
  renderCs(); setInterval(() => { if (App.active === testId && dock.offsetParent && !line.value) renderCs(); }, 2000);
  return { dock, line, renderCs };
}

const TESTS = [
  {
    id: 'radar', name: 'Radar APP',
    howto: 'Klepni na label: otevře se <b>menu povelů</b> (HDG, CFL, SPD, DCT, APP, XFER). <b>Gesto</b>: táhni Pencilem z letadla kam má letět nebo na bod, prstem nejdřív chvilku podrž. Tlačítko <b>PANEL</b> zapne panel ATC. Na klávesnici: po klepnutí na label stačí psát jen pokyn (např. <i>L270 F80</i>), Tab doplní volací znak, šipky nahoru a dolů vrací předchozí povely. <b>PTT</b> vpravo nebo mezerník: hlasový pokyn (test Hlasové ovládání), pauza je na klávese P. Mapu posuneš tažením prázdného místa.',
    checks: [
      { id: 'render', t: 'Mapa TMA a letadla se vykreslují, pohyb je čitelný' },
      { id: 'label', t: 'Klepnutí nebo najetí na label ho rozbalí', auto: () => featN('tapLabel') + featN('hoverLabel') > 0 },
      { id: 'drag', t: 'Label jde přesunout tažením', auto: () => featN('labelDrag') > 0 },
      { id: 'menu', t: 'Menu povelů se otevře a dá se v něm vybírat', auto: () => featN('menuCmd') > 0 },
      { id: 'exec', t: 'Letadlo povel provede (zatočí, změní hladinu nebo rychlost)' },
      { id: 'readback', t: 'Pilot odpoví textem i hlasem' },
      { id: 'stca', t: 'Konflikt spustí výstrahu STCA: červený label a tón', auto: () => featN('stca') > 0 },
      { id: 'zoom', t: 'Zoom a posun mapy fungují', auto: () => featN('zoom') > 0 && featN('pan') > 0 },
      { id: 'time', t: 'Pauza a zrychlení 2× a 4× fungují', auto: () => featN('speed') > 0 },
      { id: 'english', t: 'Celé rozhraní radaru je anglicky a dává smysl' },
    ],
    auto: () => [['Povely z menu', String(featN('menuCmd'))], ['Povely z příkazového řádku', String(featN('cmdline'))], ['Zoom', featD('zoom') || '–'], ['Najetí na label', featD('hoverLabel') || '–'], ['STCA výstrahy', String(featN('stca'))], ['Zvuk', Sound.status() === 'on' ? 'běží' : Sound.status() === 'paused' ? 'pozastavený, klepni' : 'vypnutý', Sound.status() === 'on' ? 'ok' : 'warn']],
    actions(box) {
      box.append(el('button', { class: 'btn warn-btn', onclick: () => { spawnConflict(App.sim); toast('Dvě letadla letí proti sobě ve FL110. Výstraha STCA přijde do minuty.'); } }, 'Vyvolat konflikt (STCA)'));
    },
    mount(v) {
      const wrap = el('div', { class: 'canvas-wrap' }); v.append(wrap);
      this.view = new RadarView(wrap, App.sim, { onCommand: (ac, cmds) => App.comms.atc(ac, cmds), gestures: true });
      App.radars.push(this.view);
      const tb = el('div', { class: 'view-toolbar' });
      const sweepBtn = el('button', { class: 'vt-btn', onclick: () => { App.sim.sweep = App.sim.sweep === 4 ? 1 : 4; sweepBtn.textContent = `UPDATE ${App.sim.sweep} s`; } }, `UPDATE ${App.sim.sweep} s`);
      const vecBtn = el('button', { class: 'vt-btn', onclick: () => { this.view.vecMin = this.view.vecMin % 3 + 1; vecBtn.textContent = `VECTOR ${this.view.vecMin} min`; } }, 'VECTOR 1 min');
      const panelBtn = el('button', { class: 'vt-btn', 'aria-pressed': 'false', onclick: () => {
        const on = !wrap.classList.contains('with-dock'); wrap.classList.toggle('with-dock', on); this.dockUi.dock.style.display = on ? 'grid' : 'none';
        this.cmd.parentElement.style.display = on ? 'none' : ''; this.log.el.classList.toggle('top', on); panelBtn.setAttribute('aria-pressed', String(on)); setTimeout(() => this.view.resize(), 20); App.feature('panelToggle'); } }, 'PANEL');
      tb.append(sweepBtn, vecBtn, el('button', { class: 'vt-btn', onclick: () => { Object.assign(this.view, { cx: 0, cy: -1, scale: 7.5 }); } }, 'HOME'), panelBtn);
      v.append(tb); this.log = new RadioLog(v); this.cmd = commandLine(v, { id: 'cmd-radar' });
      this.dockUi = mountDock(v, this.view, 'radar'); this.dockUi.dock.style.display = 'none'; this.ptt = pttControl(v);
    },
    draw(now) { this.view.draw(now); },
  },
  {
    id: 'ground', name: 'Letiště a výhled z věže',
    howto: 'Nahoře je <b>výhled z okna věže</b>, dole pozemní radar A‑SMGCS. Výhled otáčíš tažením do stran, nahoru a dolů, <b>dalekohled</b> je roztažení dvěma prsty nebo kolečko, dvojí klepnutí vrátí pohled. Hranici mezi oběma částmi můžeš posunout tažením. Na A‑SMGCS klepni na letadlo nebo na řádek v seznamu vlevo: dole se ukáže <b>Target Information</b>. Letadla ve vzduchu mají vektor se značkou každou minutu, podle kterého věžní odhaduje, jestli stihne pustit odlet. Denní dobu a dohlednost nastavíš v ovládání instruktora.',
    checks: [
      { id: 'map', t: 'Mapa letiště se vykreslí (dráhy, pojezdové dráhy, stání)' },
      { id: 'move', t: 'Letadla a vozidla se plynule pohybují po pojezdových drahách' },
      { id: 'label', t: 'Klepnutí na letadlo nebo řádek seznamu ukáže Target Information', auto: () => featN('groundTap') > 0 },
      { id: 'rimcas', t: 'Výstraha RIMCAS při vjezdu vozidla na dráhu (barva a tón)', auto: () => featN('rimcas') > 0 },
      { id: 'window', t: 'Výhled z věže jde otáčet a přibližovat', auto: () => featN('windowPan') > 0 && featN('windowZoom') > 0 },
      { id: 'day', t: 'Denní výhled: modrá obloha, slunce, mraky, krajina' },
      { id: 'night', t: 'Noc a soumrak: světla dráhy, pojezdových drah a letadel vypadají přesvědčivě', auto: () => featN('tod') > 0 },
      { id: 'fog', t: 'Snížená dohlednost výhled změní, světla mají v mlze halo', auto: () => featN('fog') > 0 },
      { id: 'false', t: 'Na A‑SMGCS je vidět blikající falešný cíl s otazníkem', auto: () => featN('falseTarget') > 0 },
    ],
    auto: () => [['RIMCAS výstrahy', String(featN('rimcas'))], ['Falešné cíle', String(featN('falseTarget'))], ['Otočení výhledu', String(featN('windowPan'))], ['Dalekohled', String(featN('windowZoom'))]],
    actions(box) {
      const T = TESTS.find(t => t.id === 'ground'); const wv = T.wv;
      box.append(el('button', { class: 'btn warn-btn', onclick: () => { App.gt.spawnBird(); toast('Vozidlo ochrany proti ptákům vjíždí na dráhu 24, letadlo je na finále.'); } }, 'Vozidlo na dráhu (RIMCAS)'));
      const seg = el('div', { class: 'seg-row', role: 'group', 'aria-label': 'Denní doba' });
      for (const [k, t] of [['day', 'Den'], ['dusk', 'Soumrak'], ['night', 'Noc']]) seg.append(el('button', { 'aria-pressed': String(wv && wv.tod === k), onclick: () => { if (wv) wv.tod = k; App.feature('tod', k); App.renderChecks(); } }, t));
      const visOut = el('output', { text: wv ? fmtVis(wv.vis) : '' });
      const vis = el('input', { type: 'range', min: '0', max: '100', value: wv ? String(visToSlider(wv.vis)) : '100', id: 'vis-range', 'aria-label': 'Dohlednost' });
      vis.addEventListener('input', () => { if (!wv) return; wv.vis = sliderToVis(+vis.value); T.gv.lvp = wv.vis < 550; visOut.textContent = fmtVis(wv.vis); App.feature('fog'); });
      box.append(el('div', { class: 'label-sm', text: 'Denní doba' }), seg, el('div', { class: 'range-row compact' }, el('label', { for: 'vis-range', text: 'Dohlednost' }), vis, visOut));
    },
    mount(v) {
      const split = el('div', { class: 'split-v' }); const top = el('div'), bar = el('div', { class: 'split-bar', role: 'separator', 'aria-label': 'Posunout hranici' }), bot = el('div'); split.append(top, bar, bot); v.append(split);
      let frac = Store.get('atc.demo.split', 52) || 52; const apply = () => { split.style.gridTemplateRows = `minmax(0, ${frac}fr) 12px minmax(0, ${100 - frac}fr)`; };
      apply();
      bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); const r = split.getBoundingClientRect(); const mv = (m) => { frac = clamp((m.clientY - r.top) / r.height * 100, 25, 78); apply(); }; const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); Store.set('atc.demo.split', Math.round(frac)); }; bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); });
      this.wv = new WindowView(top, App.gt); this.gv = new GroundView(bot, App.gt);
      const look = (h, p, f) => { this.wv.heading = h; if (p !== undefined) this.wv.pitch = p; if (f) this.wv.fov = f; App.feature('windowPan'); };
      const tags = el('button', { class: 'vt-btn', 'aria-pressed': 'false', onclick: () => { this.wv.tags = !this.wv.tags; tags.setAttribute('aria-pressed', String(this.wv.tags)); } }, 'TAGS');
      top.append(el('div', { class: 'window-ctrl' },
        el('button', { class: 'vt-btn', 'aria-label': 'Look left', onclick: () => look(Geo.norm360(this.wv.heading - 30)) }, '◀'),
        el('button', { class: 'vt-btn', 'aria-label': 'Look right', onclick: () => look(Geo.norm360(this.wv.heading + 30)) }, '▶'),
        el('button', { class: 'vt-btn', onclick: () => look(42, -4, 42) }, 'THR 24'),
        el('button', { class: 'vt-btn', onclick: () => look(258, -4, 40) }, 'THR 06'),
        el('button', { class: 'vt-btn', onclick: () => look(300, -14, 78) }, 'APRON'),
        el('button', { class: 'vt-btn', onclick: () => { this.wv.fov = this.wv.fov > 30 ? 14 : 78; App.feature('windowZoom'); } }, 'BINO'), tags));
      bot.append(el('div', { class: 'view-toolbar br' }, el('button', { class: 'vt-btn', onclick: () => { const tw = GM(D.ground.tower[0], D.ground.tower[1]); Object.assign(this.gv, { cx: tw.x - 350, cy: tw.y + 250, scale: 0.30 }); } }, 'HOME')));
    },
    draw(now) { this.wv.simTime = App.sim.t; this.wv.draw(now); this.gv.draw(now); },
  },
  {
    id: 'strips', name: 'Stripy',
    howto: 'Přetáhni strip do jiné sekce (například z DELIVERY do GROUND) prstem, Pencilem i myší. Změň pořadí stripů v sekci. <b>Klepnutím</b> na strip přepneš stav povolení (CLR).',
    checks: [
      { id: 'dragtouch', t: 'Přetažení stripu prstem', auto: () => (App.features.stripMove && App.features.stripMove.d.has('touch')) || false },
      { id: 'dragpen', t: 'Přetažení stripu Pencilem', auto: () => (App.features.stripMove && App.features.stripMove.d.has('pen')) || false },
      { id: 'dragmouse', t: 'Přetažení stripu myší nebo trackpadem', auto: () => (App.features.stripMove && App.features.stripMove.d.has('mouse')) || false },
      { id: 'reorder', t: 'Změna pořadí v sekci', auto: () => featN('stripReorder') > 0 },
      { id: 'tap', t: 'Klepnutí přepne stav CLR', auto: () => featN('stripTap') > 0 },
    ],
    auto: () => [['Přesuny', `${featN('stripMove')} (${featD('stripMove') || '–'})`], ['Změny pořadí', String(featN('stripReorder'))], ['Klepnutí', String(featN('stripTap'))]],
    mount(v) { const w = el('div', { class: 'canvas-wrap' }); v.append(w); this.bay = new StripBay(w); },
  },
  {
    id: 'touch', name: 'Dotyk a gesta',
    howto: 'V ploše vyzkoušej <b>klepnutí</b>, <b>dvojité klepnutí</b>, <b>dlouhé podržení</b> (půl sekundy), <b>tažení</b> a <b>roztažení dvěma prsty</b>. Rozpoznaná gesta se rozsvítí zeleně.',
    checks: [
      { id: 'tap', t: 'Klepnutí', auto: () => !!App.gest.tap }, { id: 'double', t: 'Dvojité klepnutí', auto: () => !!App.gest.double },
      { id: 'long', t: 'Dlouhé podržení', auto: () => !!App.gest.long }, { id: 'drag', t: 'Tažení', auto: () => !!App.gest.drag },
      { id: 'pinch', t: 'Dva prsty (přiblížení)', auto: () => !!App.gest.pinch2 },
    ],
    auto: () => [['Dotykové body', String(navigator.maxTouchPoints || 0)], ['Dotyk zaznamenán', App.inputs.touch ? 'ano' : 'ne', App.inputs.touch ? 'ok' : '']],
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page);
      const chips = el('div', { class: 'chips' }); const names = { tap: 'Klepnutí', double: 'Dvojité klepnutí', long: 'Dlouhé podržení', drag: 'Tažení', pinch2: 'Dva prsty' };
      const pad = el('div', { class: 'pad', style: 'height: 420px' }, el('span', { class: 'padhint', text: 'Testovací plocha' })); const cv = el('canvas'); pad.append(cv);
      page.append(el('div', { class: 'card' }, el('h3', { text: 'Rozpoznaná gesta' }), chips), pad);
      const refresh = () => { chips.innerHTML = ''; for (const [k, t] of Object.entries(names)) chips.append(el('span', { class: 'chip' + (App.gest[k] ? ' on' : ''), text: t })); App.refreshChecks(); };
      refresh();
      const pts = new Map(); let lastTap = 0, pinch0 = null; const marks = [];
      pad.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') { App.inputSeen(e, 'down'); } else App.inputSeen(e, 'down'); pad.setPointerCapture(e.pointerId); const r = pad.getBoundingClientRect(); pts.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
        if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
        const p = pts.get(e.pointerId); p.lt = setTimeout(() => { if (!p.moved && pts.has(e.pointerId)) { App.gest.long = true; marks.push({ ...p, c: '#f6b73c', r: 26 }); refresh(); } }, 520); });
      pad.addEventListener('pointermove', e => { const p = pts.get(e.pointerId); if (!p) return; const r = pad.getBoundingClientRect(); p.x = e.clientX - r.left; p.y = e.clientY - r.top; if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 10) { p.moved = true; if (pts.size === 1 && !App.gest.drag) { App.gest.drag = true; refresh(); } } marks.push({ x: p.x, y: p.y, c: '#4fa3ff', r: 3 });
        if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; if (Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - pinch0) > 40 && !App.gest.pinch2) { App.gest.pinch2 = true; refresh(); } } });
      const end = e => { const p = pts.get(e.pointerId); if (!p) return; clearTimeout(p.lt); pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; const dur = performance.now() - p.t0; if (!p.moved && dur < 350) { const now = performance.now(); if (now - lastTap < 350) { App.gest.double = true; marks.push({ ...p, c: '#35c779', r: 20 }); } else { App.gest.tap = true; marks.push({ ...p, c: '#e7eef6', r: 14 }); } lastTap = now; refresh(); } };
      pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
      this.draw = () => { const r = pad.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); } const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height); while (marks.length > 400) marks.shift(); for (const m of marks) { c.strokeStyle = m.c; c.fillStyle = m.c; c.beginPath(); c.arc(m.x, m.y, m.r, 0, Math.PI * 2); m.r > 4 ? c.stroke() : c.fill(); } for (const p of pts.values()) { c.strokeStyle = '#fff'; c.beginPath(); c.arc(p.x, p.y, 30, 0, Math.PI * 2); c.stroke(); } };
    },
  },
  {
    id: 'pencil', name: 'Apple Pencil',
    howto: 'Kresli do plochy Pencilem a měň přítlak. Na iPadu Pro M2 zkus pero jen <b>přiblížit nad displej</b> bez dotyku: hra má zachytit najetí (hover). Ve hře tím rozbalíš label bez klepnutí.',
    checks: [
      { id: 'draw', t: 'Pencil kreslí do plochy', auto: () => App.inputs.pen > 0 },
      { id: 'pressure', t: 'Tloušťka čáry reaguje na přítlak', auto: () => App.inputs.maxPressure > 0.05 && App.inputs.maxPressure < 0.99 },
      { id: 'hover', t: 'Najetí perem nad displej je zachyceno', auto: () => App.inputs.penHover > 0 },
    ],
    auto: () => [['Pero zaznamenáno', ...yes(App.inputs.pen > 0)], ['Max. přítlak', App.inputs.maxPressure.toFixed(2)], ['Najetí (hover)', ...yes(App.inputs.penHover > 0)], ['Náklon', App.inputs.tilt || '–']],
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page);
      const pad = el('div', { class: 'pad', style: 'height: 520px' }, el('span', { class: 'padhint', text: 'Kresli Pencilem. Prst a myš kreslí šedě.' })); const cv = el('canvas'); pad.append(cv); page.append(pad);
      const strokes = []; let cur = null; let hover = null;
      const pos = e => { const r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      pad.addEventListener('pointerdown', e => { App.inputSeen(e, 'down'); pad.setPointerCapture(e.pointerId); cur = { pen: e.pointerType === 'pen', pts: [{ ...pos(e), p: e.pressure }] }; strokes.push(cur); App.refreshChecks(); });
      pad.addEventListener('pointermove', e => { if (e.pointerType === 'pen' && e.buttons === 0) { App.inputSeen(e, 'hover'); hover = pos(e); App.refreshChecks(); return; } if (!cur) return; App.inputSeen(e, 'move'); for (const ce of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) cur.pts.push({ ...pos(ce), p: ce.pressure }); });
      const up = () => { cur = null; App.refreshChecks(); }; pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
      pad.addEventListener('pointerleave', () => { hover = null; });
      this.draw = () => { const r = pad.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); } const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height); c.lineCap = 'round';
        for (const s of strokes) for (let i = 1; i < s.pts.length; i++) { const a = s.pts[i - 1], b = s.pts[i]; c.strokeStyle = s.pen ? '#4fa3ff' : '#8a97a6'; c.lineWidth = s.pen ? 1 + b.p * 12 : 3; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
        if (hover) { c.strokeStyle = '#f6b73c'; c.beginPath(); c.arc(hover.x, hover.y, 16, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#f6b73c'; c.font = '13px var(--font-ui)'; c.fillText('hover', hover.x + 20, hover.y); } };
    },
  },
  {
    id: 'mouse', name: 'Myš a trackpad',
    howto: 'Připoj myš nebo trackpad. V ploše jen <b>pohybuj kurzorem</b> (najetí), klikni <b>pravým tlačítkem</b> (nebo dvěma prsty na trackpadu) a <b>posuň kolečkem</b> (dvěma prsty).',
    checks: [
      { id: 'hover', t: 'Najetí kurzorem je zachyceno', auto: () => App.inputs.mouseHover > 0 },
      { id: 'right', t: 'Pravé tlačítko / sekundární klik', auto: () => App.gest.right },
      { id: 'wheel', t: 'Kolečko nebo posun dvěma prsty', auto: () => App.gest.wheel },
    ],
    auto: () => [['Myš zaznamenána', ...yes(App.inputs.mouse + App.inputs.mouseHover > 0)], ['Jemný ukazatel', ...yes(matchMedia('(any-pointer: fine)').matches)], ['Najetí podporováno', ...yes(matchMedia('(any-hover: hover)').matches)]],
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page);
      const chips = el('div', { class: 'chips' }); const pad = el('div', { class: 'pad', style: 'height: 460px' }, el('span', { class: 'padhint', text: 'Pohybuj kurzorem, klikni pravým, posuň kolečkem' })); const cv = el('canvas'); pad.append(cv);
      page.append(el('div', { class: 'card' }, el('h3', { text: 'Zachycené vstupy' }), chips), pad);
      const refresh = () => { chips.innerHTML = ''; [['Najetí', App.inputs.mouseHover > 0], ['Pravé tlačítko', App.gest.right], ['Kolečko', App.gest.wheel]].forEach(([t, on]) => chips.append(el('span', { class: 'chip' + (on ? ' on' : ''), text: t }))); App.refreshChecks(); };
      refresh(); let hp = null; let wheelY = 0;
      pad.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { App.inputSeen(e, e.buttons ? 'move' : 'hover'); const r = pad.getBoundingClientRect(); hp = { x: e.clientX - r.left, y: e.clientY - r.top }; if (App.inputs.mouseHover === 1) refresh(); } });
      pad.addEventListener('contextmenu', e => { e.preventDefault(); App.gest.right = true; refresh(); });
      pad.addEventListener('wheel', e => { e.preventDefault(); wheelY += e.deltaY; App.gest.wheel = true; refresh(); }, { passive: false });
      this.draw = () => { const r = pad.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); } const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height);
        if (hp) { c.strokeStyle = '#4fa3ff'; c.beginPath(); c.moveTo(hp.x - 20, hp.y); c.lineTo(hp.x + 20, hp.y); c.moveTo(hp.x, hp.y - 20); c.lineTo(hp.x, hp.y + 20); c.stroke(); }
        c.fillStyle = '#93a4b7'; c.font = '14px sans-serif'; c.fillText(`Posun kolečkem: ${Math.round(wheelY)} px`, 14, r.height - 16); };
    },
  },
  {
    id: 'keyboard', name: 'Klávesnice',
    howto: 'Piš do příkazového řádku, například <b>35J L270</b>, <b>TVS35J F80 S180</b>, <b>AFR1083 D ERASU</b>, <b>KLM1355 AS</b> nebo <b>RYR8YD I24</b>, a potvrď klávesou Enter. Když nic není vybrané, stačí začít psát: řádek se aktivuje sám. Klávesa P mimo řádek přepíná pauzu, mezerník je PTT hlasového ovládání.',
    checks: [
      { id: 'keys', t: 'Stisky kláves se zobrazují v záznamu', auto: () => App.keys.length > 0 },
      { id: 'cmd', t: 'Povel z příkazového řádku letadlo provede', auto: () => featN('cmdline') > 0 },
      { id: 'focus', t: 'Psaní bez klepnutí do řádku řádek aktivuje', auto: () => featN('autoFocus') > 0 },
    ],
    auto: () => [['Stisknuté klávesy', String(App.keys.length)], ['Poslední', App.keys.slice(-1)[0] || '–'], ['Povely odeslané klávesnicí', String(featN('cmdline'))]],
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page);
      this.log = el('div', { class: 'keylog' });
      const mr = el('div', { class: 'mini-radar', style: 'height: 430px' });
      page.append(el('div', { class: 'card' }, el('h3', { text: 'Záznam kláves' }), this.log), mr);
      this.view = new RadarView(mr, App.sim, { menu: false, scale: 5.5 }); App.radars.push(this.view);
      new RadioLog(mr); commandLine(mr, { id: 'cmd-kbd' });
      App.on('key', () => { this.log.innerHTML = ''; for (const k of App.keys.slice(-14)) this.log.append(el('span', { text: k })); });
    },
    draw(now) { this.view.draw(now); },
  },
  {
    id: 'voices', name: 'Hlasy pilotů',
    howto: 'Piloti mluví <b>neurálními hlasy</b>: celá relace se syntetizuje najednou přímo v iPadu (stejní mluvčí jako dřív, ale souvislá řeč a čísla ve skupinách). Modely se stáhnou při prvním použití (VCTK 77 MB, L2-ARCTIC 77 MB, český 63 MB); do té doby a u francouzského a italského hlasu mluví <b>balíčky</b>. Pusť si posádky, přepínačem <b>Zdroj hlasu</b> porovnej neurální hlas s balíčky a pak poslouchej provoz na radaru.',
    checks: [
      { id: 'neural', t: 'Neurální hlasy zní jako souvislá řeč, ne jako diktování', auto: () => PilotTTS.stats.tts > 0 },
      { id: 'numbers', t: 'Čísla (hladiny, kurzy, rychlosti) jsou přehledná a srozumitelná' },
      { id: 'hear', t: 'Slyším piloty vlastními hlasy (ne hlasy iPadu)', auto: () => VoicePack.stats.pack + PilotTTS.stats.tts > 0 },
      { id: 'accent', t: 'Přízvuky jednotlivých posádek se liší' },
      { id: 'radio', t: 'Rádiový zvuk (filtr, šum, cvaknutí) zní věrohodně' },
      { id: 'speed', t: 'Řeč je srozumitelná a nezpožďuje se' },
      { id: 'variety', t: 'Piloti neodpovídají pořád stejnou frází' },
    ],
    auto: () => [['Neurální modely', PilotTTS.label(), Object.values(PilotTTS.models).some(s => s.state === 'ready') ? 'ok' : Object.values(PilotTTS.models).some(s => s.state === 'error') ? 'bad' : 'warn'],
      ['Neurální relace', `${PilotTTS.stats.tts}${PilotTTS.median('ms') !== null ? ` · syntéza medián ${PilotTTS.median('ms')} ms (${PilotTTS.median('rtf').toFixed(2)}× délky)` : ''}`], ['Chyba syntézy', PilotTTS.stats.lastErr || '–', PilotTTS.stats.lastErr ? 'bad' : ''],
      ['Načtené balíčky', VoicePack.stats.loaded.join(' ') || 'zatím žádný', VoicePack.stats.loaded.length ? 'ok' : 'warn'], ['Relace z balíčků', String(VoicePack.stats.pack)], ['Hlasem iPadu (záloha)', String(VoicePack.stats.device)], ['Chybějící slova', Object.keys(VoicePack.stats.missing).join(' ') || '–'], ['Chyba načtení', VoicePack.stats.lastErr || '–', VoicePack.stats.loadErr ? 'bad' : ''], ['Poslední hlas', Sound.lastVoiceUsed || '–']],
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page);
      const grid = el('div', { class: 'voice-grid' });
      const samples = [['TVS35J', 'Smartwings'], ['RYR8YD', 'Ryanair'], ['BAW852', 'British Airways'], ['EZY452', 'easyJet'], ['AFR1083', 'Air France'], ['ITY417', 'ITA Airways'], ['VLG29GF', 'Vueling'], ['DLH1395', 'Lufthansa'], ['KLM1355', 'KLM'], ['LOT511', 'LOT'], ['WZZ2219', 'Wizz Air'], ['UAE139', 'Emirates'], ['QTR291', 'Qatar'], ['DAL94', 'Delta'], ['THY3FZ', 'Turkish']];
      const cmdSets = [[{ type: 'hdg', val: 270, dir: -1 }, { type: 'alt', val: 8000 }], [{ type: 'spd', val: 220 }], [{ type: 'dct', fix: 'ERASU' }], [{ type: 'ils', rwy: '24' }], [{ type: 'xfer', to: 'TWR' }], [{ type: 'alt', val: 5000 }]];
      let n = 0;
      const render = () => {
        grid.innerHTML = '';
        for (const [cs, name] of samples) {
          const vv = VoicePack.voiceFor(cs); const pk = VoicePack.packs[vv.id]; const sp = PilotTTS.spec(cs); const ms = sp && PilotTTS.models[sp.model];
          const b = el('button', { class: 'btn', onclick: () => { Sound.unlock(); const ac = { cs, alt: 9000, ias: 250, wtc: /UAE|QTR|KAL|DAL/.test(cs) ? 'H' : 'M' }; const rb = Phrase.readback(ac, cmdSets[n++ % cmdSets.length], App.sim); Sound.transmit(rb.say, cs).then(() => setTimeout(() => { render(); App.refreshChecks(); }, 50)); } },
            el('span', { text: `${name} (${cs})` }), el('small', { text: `${VP_LABEL[vv.id] || vv.id} · ${!PilotTTS.enabled || !sp ? (pk ? 'balíček' : 'balíček se načítá') : ms && ms.state === 'ready' ? 'neurální' : 'neurální se načítá'}` }));
          grid.append(b);
        }
      };
      render(); App.on('voicepack', render); App.on('audio', render); App.on('tts', render);
      const mode = el('div', { class: 'seg-row', role: 'group', 'aria-label': 'Zdroj hlasu' });
      const modes = [['neural', 'Neurální'], ['pack', 'Balíčky'], ['device', 'Jen iPad']];
      const cur = () => PilotTTS.enabled ? 'neural' : VoicePack.enabled ? 'pack' : 'device';
      const setMode = (k) => { PilotTTS.enabled = k === 'neural'; VoicePack.enabled = k !== 'device'; Store.set('atc.tts.on', PilotTTS.enabled); if (PilotTTS.enabled) { Sound.unlock(); PilotTTS.preload(samples.map(s => s[0])); } [...mode.children].forEach((b, i) => b.setAttribute('aria-pressed', String(modes[i][0] === k))); render(); };
      for (const [k, t] of modes) mode.append(el('button', { onclick: () => setMode(k) }, t));
      const loadAll = el('button', { class: 'btn', onclick: () => { Sound.unlock(); VoicePack.preload(samples.map(s => s[0])); PilotTTS.preload(samples.map(s => s[0])); } }, 'Načíst všechny hlasy');
      setMode(cur());
      const rr = (label, min, max, step, val, fn, fmt) => { const id = 'r-' + label.replace(/\W/g, ''); const inp = el('input', { type: 'range', min, max, step, value: val, id }); const out = el('output', { for: id, text: fmt(val) }); inp.addEventListener('input', () => { fn(+inp.value); out.textContent = fmt(+inp.value); }); return el('div', { class: 'range-row' }, el('label', { for: id, text: label }), inp, out); };
      page.append(el('div', { class: 'card' }, el('h3', { text: 'Posádky' }), el('p', { class: 'howto', text: 'Každé klepnutí přehraje jiný typ zpětného čtení. Pod názvem je hlas, který posádka dostala.' }), grid),
        el('div', { class: 'card' }, el('h3', { text: 'Zdroj hlasu' }), mode, loadAll),
        el('div', { class: 'card' }, el('h3', { text: 'Nastavení zvuku' }), rr('Hlasitost', 0, 1, 0.05, Sound.vol, x => Sound.vol = x, x => Math.round(x * 100) + ' %'), rr('Rychlost řeči', 0.8, 1.25, 0.05, Sound.rateMul, x => Sound.rateMul = x, x => x.toFixed(2) + '×'), rr('Hlasitost šumu', 0, 0.15, 0.01, Sound.noiseVol, x => Sound.noiseVol = x, x => Math.round(x * 100))));
    },
  },
  {
    id: 'input', name: 'Zadávání povelů',
    howto: 'Zvolená kombinace: <b>gesto na radaru</b> pro kurz a přímý let (Pencilem rovnou z letadla, prstem po krátkém podržení), <b>menu labelu</b> pro ostatní a <b>panel ATC</b> dole jako zrychlovač pro víc pokynů v jedné relaci. Na radaru APP (test 1) panel zapneš tlačítkem PANEL.',
    checks: [
      { id: 'pad', t: 'Panel ATC: povel sestavím a letadlo ho provede', auto: () => featN('padSend') > 0 },
      { id: 'gesthdg', t: 'Gesto: tažení z letadla nastaví kurz', auto: () => featN('gestHdg') > 0 },
      { id: 'gestdct', t: 'Gesto: tažení na bod dá přímý let', auto: () => featN('gestDct') > 0 },
      { id: 'speed', t: 'Zadání je dost rychlé i při více letadlech najednou' },
    ],
    auto: () => [['Panel ATC (odesláno)', String(featN('padSend'))], ['Gesto kurz', `${featN('gestHdg')} (${featD('gestHdg') || '–'})`], ['Gesto přímý let', `${featN('gestDct')} (${featD('gestDct') || '–'})`]],
    mount(v) {
      const wrap = el('div', { class: 'canvas-wrap with-dock' }); v.append(wrap);
      this.view = new RadarView(wrap, App.sim, { onCommand: (ac, cmds) => App.comms.atc(ac, cmds), gestures: true, scale: 6.2 });
      App.radars.push(this.view); new RadioLog(v).el.classList.add('top');
      this.dock = mountDock(v, this.view, 'input'); pttControl(v);
    },
    draw(now) { this.view.draw(now); },
  },
  {
    id: 'voice', name: 'Hlasové ovládání',
    howto: 'Drž <b>PTT</b> (kulaté tlačítko vpravo, <b>mezerník</b> nebo naučený <b>pedál</b>) a řekni celý pokyn s volacím znakem, např. <i>„Skytravel three five Juliett, descend flight level eight zero“</i>. PTT pusť až po posledním slově. Rozpoznaný text se objeví v rádiovém záznamu a dole v tabulce, pilot pokyn zopakuje, nebo požádá o „say again“. První stisk stáhne model rozpoznávání (velikost u volby modelu), další spuštění ho vezme z paměti prohlížeče. <b>Samotest</b> ověří rozpoznávání bez mikrofonu hlasem z balíčku. Pauza je teď na klávese <b>P</b>.',
    checks: [
      { id: 'perm', t: 'Prohlížeč se zeptal na mikrofon a povolení platí', auto: () => Mic.diag.perm === 'granted' },
      { id: 'model', t: 'Model rozpoznávání se stáhne a načte', auto: () => ASR.state === 'ready' },
      { id: 'webgpu', t: 'Rozpoznávání běží na WebGPU (ne na záložním WASM)', auto: () => ASR.state === 'ready' && ASR.device === 'webgpu' },
      { id: 'self', t: 'Samotest bez mikrofonu pokyn správně rozpozná', auto: () => (Voice.selfOk || 0) > 0 },
      { id: 'pttbtn', t: 'PTT tlačítkem na obrazovce (prst nebo Pencil)', auto: () => !!(Voice.stats.src.touch || Voice.stats.src.pen || Voice.stats.src.mouse) },
      { id: 'pttkey', t: 'PTT mezerníkem na klávesnici', auto: () => !!Voice.stats.src.key },
      { id: 'pedal', t: 'PTT pedálem (po naučení klávesy)', auto: () => !!Voice.stats.src.pedal },
      { id: 'recog', t: 'Rozpoznaný text odpovídá tomu, co jsem řekl' },
      { id: 'exec', t: 'Pilot pokyn zopakuje a letadlo ho provede', auto: () => Voice.stats.ok > 0 },
      { id: 'sayagain', t: 'Při nesrozumitelném pokynu pilot požádá o zopakování', auto: () => Voice.stats.sayAgain + Voice.stats.ambiguous > 0 },
      { id: 'latency', t: 'Odezva od puštění PTT po odpověď pilota je přijatelná' },
      { id: 'playback', t: 'Hlasy pilotů a tóny po vysílání hrají normálně nahlas' },
    ],
    auto: () => {
      const g = ASR.gpu, i = ASR.info || {}, lat = Voice.latencies(), st = Voice.stats;
      return [['Mikrofon', Mic.diag.perm, Mic.diag.perm === 'granted' ? 'ok' : Mic.diag.perm === 'denied' ? 'bad' : ''],
        ['Zachytávání', Mic.diag.opens ? `${Mic.diag.track} · otevření ${Mic.diag.openMs} ms` : '–'],
        ['Audio session', Mic.diag.session],
        ['WebGPU', g ? (g.ok ? `ano · ${g.desc}${g.f16 ? ' · f16' : ''}` : 'ne · ' + g.why) : 'zjišťuje se', g ? (g.ok ? 'ok' : 'warn') : ''],
        ['Model', ASR.label(), ASR.state === 'ready' ? 'ok' : ASR.state === 'error' ? 'bad' : ASR.state === 'loading' ? 'warn' : ''],
        ['Stahování', ASR.state === 'loading' || ASR.downloaded() ? `${(ASR.downloaded() / 1e6).toFixed(0)} MB (${Math.round(ASR.progress() * 100)} %)` : '–'],
        ['WebGPU selhalo, WASM', ASR.fallback || '–', ASR.fallback ? 'warn' : ''],
        ['Načtení / zahřátí', i.loadMs ? `${(i.loadMs / 1000).toFixed(1)} s / ${(i.warmMs / 1000).toFixed(1)} s` : '–'],
        ['Odezva ASR', lat.length ? `poslední ${lat.length ? (Voice.history.find(h => h.wall) || {}).wall : '–'} ms · medián ${lat[Math.floor(lat.length / 2)]} ms` : '–'],
        ['Relace', `${st.tx} · ok ${st.ok} · say again ${st.sayAgain} · znak? ${st.ambiguous + st.noCs} · ticho ${st.empty} · blok ${st.blocked} · chyby ${st.errors}`],
        ['PTT klávesy', 'Space' + (Voice.key ? ' + ' + (Voice.key.code || Voice.key.key) : '')]];
    },
    actions(box) {
      const seg = (label, items, cur, fn) => { const r = el('div', { class: 'seg-row', role: 'group', 'aria-label': label }); for (const [k, t] of items) r.append(el('button', { 'aria-pressed': String(cur === k), onclick: () => { fn(k); App.renderChecks(); } }, t)); return [el('div', { class: 'label-sm', text: label }), r]; };
      const mb = (m) => { const M = ASR_MODELS[m].mb; return el('span', {}, m, el('br'), el('small', { text: `${M.wasm}/${M.webgpu}` })); };
      box.append(...seg('Model (MB pro WASM/WebGPU)', [['tiny.en', mb('tiny.en')], ['base.en', mb('base.en')], ['small.en', mb('small.en')]], ASR.pref.model, (k) => ASR.setPref('model', k)));
      box.append(...seg('Zařízení', [['auto', 'Auto'], ['webgpu', 'WebGPU'], ['wasm', 'WASM']], ASR.pref.device, (k) => ASR.setPref('device', k)));
      const load = el('button', { class: 'btn primary', onclick: () => { ASR.load().then(() => toast('Model je načtený.'), (e) => toast('Model se nenačetl: ' + e.message, 5000)); } }, 'Načíst / přepnout model');
      const self = el('button', { class: 'btn', onclick: async () => { self.disabled = true; try { const r = await Voice.selfTest(); const ok = r.got === r.expect; if (ok) Voice.selfOk = (Voice.selfOk || 0) + 1; toast(`${ok ? 'Samotest OK' : 'Samotest nesedí'}: čekáno ${r.expect}, rozpoznáno ${r.got} (${r.ms} ms)`, 5000); } catch (e) { toast('Samotest selhal: ' + e.message, 5000); } self.disabled = false; App.refreshChecks(); } }, 'Samotest bez mikrofonu');
      const learn = el('button', { class: 'btn', onclick: () => Voice.learn() }, Voice.key ? `PTT pedál: ${Voice.key.code || Voice.key.key} (naučit znovu)` : 'Naučit PTT pedál');
      const tog = (label, get, set) => el('button', { class: 'btn', 'aria-pressed': String(get()), onclick: () => { set(!get()); App.renderChecks(); } }, `${label}: ${get() ? 'ano' : 'ne'}`);
      box.append(el('div', { class: 'btn-row' }, load, self), learn,
        el('button', { class: 'btn', 'aria-pressed': String(Mic.stayOpen), onclick: () => { const on = !Mic.stayOpen; Mic.keepOpen = on; Store.set('atc.mic.keepOpen', on); if (!on) { Mic.autoKeep = ''; Mic.noAuto = true; if (!Voice.ptt) Mic.close(); } App.renderChecks(); } },
          `Mikrofon trvale otevřený: ${Mic.keepOpen ? 'ano' : Mic.autoKeep ? 'auto (' + Mic.autoKeep + ')' : 'ne'}`),
        tog('Potlačení ozvěny a šumu, AGC', () => Mic.processing, (v) => { Mic.processing = v; Store.set('atc.mic.processing', v); if (!Voice.ptt) Mic.close(); }),
        tog('Prompt s volacími znaky', () => Voice.usePrompt, (v) => Voice.set('usePrompt', v)),
        tog('PTT tlačítko vlevo', () => document.body.classList.contains('ptt-left'), (v) => { document.body.classList.toggle('ptt-left', v); Store.set('atc.voice.pttLeft', v); }));
    },
    mount(v) {
      const wrap = el('div', { class: 'canvas-wrap with-dock' }); v.append(wrap);
      this.view = new RadarView(wrap, App.sim, { onCommand: (ac, cmds) => App.comms.atc(ac, cmds), gestures: true, scale: 6.2 });
      App.radars.push(this.view); new RadioLog(v).el.classList.add('top'); pttControl(v);
      const panel = el('div', { class: 'vpanel' }); v.append(panel);
      const render = () => {
        panel.innerHTML = '';
        panel.append(el('div', { class: 'vrow head' }, el('span', { text: 'TIME' }), el('span', { text: 'REC' }), el('span', { text: 'ASR' }), el('span', { text: 'HEARD' }), el('span', { text: 'RESULT' })));
        if (!Voice.history.length) panel.append(el('div', { class: 'vrow empty', text: 'No transmissions yet. Hold PTT and speak, or run the self-test.' }));
        for (const h of Voice.history) panel.append(el('div', { class: 'vrow' + (h.err ? ' err' : /SAY AGAIN|\?|NO SPEECH|BLOCKED/.test(h.outcome || '') ? ' warn' : '') },
          el('span', { text: hhmmss(h.t || 0) }), el('span', { text: h.dur ? h.dur.toFixed(1) + ' s' : '–' }), el('span', { text: h.wall ? h.wall + ' ms' : '–' }),
          el('span', { class: 'heard', text: h.text ? `“${h.text}”` : '–' }), el('span', { text: (h.outcome || '') + (h.conf ? ` · ${Math.round(h.conf * 100)} %` : '') })));
      };
      App.on('voice', render); render();
      ASR.probeGpu(); Mic.perm();
    },
    draw(now) { this.view.draw(now); },
  },
  {
    id: 'ai', name: 'AI piloti – měření',
    howto: 'Příprava AI pilotů: změří se, jestli se malý jazykový model vejde do iPadu vedle rozpoznávání řeči a neurálních hlasů a jak rychle odpovídá. Vyber model, klepni na <b>Spustit měření</b> a počkej na stažení (velikost je u volby) a tři odpovědi pilota na nestandardní otázky. Realistické zatížení: nejdřív načti Whisper v testu Hlasové ovládání a pusť pár relací pilotů. Měř od nejmenšího modelu. Kdyby se aplikace během měření znovu načetla (Safari ji ukončí, když dojde paměť), zapíše se to do výsledků.',
    checks: [
      { id: 'runs', t: 'Model se stáhne, načte a odpovídá', auto: () => LLMBench.results.some(r => !r.err && r.answers && r.answers.length) },
      { id: 'sense', t: 'Odpovědi dávají smysl, jsou krátké a končí volacím znakem' },
      { id: 'fast', t: 'Odpověď přijde dost rychle (první token do 1 s)' },
      { id: 'stable', t: 'Aplikace nespadla ani s načteným Whisperem a hlasy', auto: () => LLMBench.results.some(r => !r.err) && !LLMBench.results.some(r => /spadla/.test(r.err || '')) },
    ],
    auto: () => [['Stav', LLMBench.state === 'loading' ? `stahuje a načítá ${Math.round(LLMBench.progress() * 100)} %` : LLMBench.state === 'running' ? 'odpovídá…' : LLMBench.state === 'error' ? 'chyba: ' + LLMBench.err : LLMBench.state === 'ready' ? 'hotovo' : '–', LLMBench.state === 'error' ? 'bad' : LLMBench.state === 'ready' ? 'ok' : ''],
      ['WebGPU', ASR.gpu ? (ASR.gpu.ok ? 'ano' + (ASR.gpu.f16 ? ' · f16' : '') : 'ne') : '–'], ['Whisper načten', ASR.state === 'ready' ? ASR.label() : 'ne'], ['Neurální hlasy', PilotTTS.label()],
      ['Pád při měření', LLMBench.crashed ? `ano (${(LLM_MODELS[LLMBench.crashed.model] || {}).label || LLMBench.crashed.model})` : 'ne', LLMBench.crashed ? 'bad' : '']],
    actions(box) {
      const r = el('div', { class: 'seg-row', role: 'group', 'aria-label': 'Model' });
      for (const [k, M] of Object.entries(LLM_MODELS)) r.append(el('button', { 'aria-pressed': String(LLMBench.key === k), onclick: () => { LLMBench.setKey(k); App.renderChecks(); } }, el('span', {}, M.label, el('br'), el('small', { text: `${M.mb.webgpu} MB` }))));
      box.append(el('div', { class: 'label-sm', text: 'Model (stažení přes WebGPU)' }), r,
        el('div', { class: 'btn-row' }, el('button', { class: 'btn primary', onclick: () => { LLMBench.run().then((x) => x && toast(x.err ? 'Měření selhalo: ' + x.err : 'Měření hotovo.', 4000)); } }, 'Spustit měření'), el('button', { class: 'btn', onclick: () => LLMBench.unload() }, 'Uvolnit model')));
    },
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page); const card = el('div', { class: 'card' }); page.append(card);
      const render = () => {
        card.innerHTML = ''; card.append(el('h3', { text: 'Výsledky měření' }));
        if (!LLMBench.results.length) card.append(el('p', { class: 'howto', text: 'Zatím nic nebylo změřeno.' }));
        for (const r of LLMBench.results) {
          card.append(el('p', { class: 'llm-line', text: LLMBench.line(r) }));
          for (const a of r.answers || []) card.append(el('div', { class: 'vrow' + (a.ok ? '' : ' warn') }, el('span', { text: a.ttft + ' ms' }), el('span', { text: a.tps + ' t/s' }), el('span', { text: a.total + ' ms' }), el('span', { class: 'heard', text: 'ATC: ' + a.q }), el('span', { text: 'PILOT: ' + a.text })));
        }
      };
      App.on('llm', render); render(); ASR.probeGpu();
    },
  },
  {
    id: 'alerts', name: 'Výstražné zvuky',
    howto: 'Přehraj jednotlivé tóny. Výstraha STCA hlásí hrozící konflikt ve vzduchu, RIMCAS konflikt na dráze, tón volání oznamuje, že se ozývá pilot. Potom <b>přepni do jiné aplikace, vrať se a klepni kamkoli</b>: zvuk se má obnovit sám a tlačítko nahoře má ukázat Zvuk zapnutý. Vyzkoušej to i se zapnutým tichým režimem.',
    checks: [{ id: 'stca', t: 'Tón STCA je slyšet' }, { id: 'rimcas', t: 'Tón RIMCAS je slyšet' }, { id: 'call', t: 'Tón volání je slyšet' }, { id: 'resume', t: 'Po návratu z jiné aplikace stačí jedno klepnutí a zvuk zase hraje' }, { id: 'silent', t: 'Tóny hrají i v tichém režimu' }],
    auto: () => [['Web Audio', ...yes(!!(window.AudioContext || window.webkitAudioContext))], ['Zvuk zapnutý', ...yes(Sound.enabled)], ['Stav kontextu', Sound.ctx ? Sound.ctx.state : '–', Sound.ctx && Sound.ctx.state === 'running' ? 'ok' : 'warn'], ['Audio session', Sound.diag.session], ['Udržovací médium', Sound.diag.media], ['Zahozené zvuky', String(Sound.diag.dropped)]],
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page);
      const b = (t, k) => el('button', { class: 'btn', onclick: () => { Sound.unlock(); Sound.tone(k); setTimeout(() => App.refreshChecks(), 500); } }, t);
      page.append(el('div', { class: 'card' }, el('h3', { text: 'Tóny' }), el('div', { class: 'btn-row' }, b('STCA', 'stca'), b('RIMCAS', 'rimcas'), b('Volání pilota', 'call'), b('Cvaknutí vysílačky', 'click'))));
    },
  },
  {
    id: 'display', name: 'Displej a zařízení',
    howto: 'V každém rohu obrazovky má být <b>oranžový trojúhelník</b>. Když některý chybí, část aplikace je schovaná pod lištou prohlížeče. Drž iPad na šířku.',
    checks: [{ id: 'corners', t: 'Vidím všechny čtyři rohové trojúhelníky' }, { id: 'legible', t: 'Písmo a tlačítka jsou čitelné a pohodlně se ovládají' }],
    auto: () => {
      const ipad = /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
      return [['Zařízení', ipad ? 'iPad' : (navigator.platform || '–')], ['Okno (CSS px)', `${innerWidth} × ${innerHeight}`], ['Obrazovka', `${screen.width} × ${screen.height}`], ['Hustota pixelů', String(devicePixelRatio)], ['Orientace', innerWidth > innerHeight ? 'na šířku' : 'na výšku', innerWidth > innerHeight ? 'ok' : 'warn'], ['Dotykové body', String(navigator.maxTouchPoints || 0)]];
    },
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page);
      this.kv = el('div', { class: 'kv' });
      page.append(el('div', { class: 'card' }, el('h3', { text: 'Zjištěné údaje' }), this.kv), el('div', { class: 'card' }, el('h3', { text: 'Tip' }), el('p', { class: 'howto', text: 'Nejvíc místa získáš, když stránku otevřeš v Safari a skryješ panel záložek. Seznam testů vlevo schováš tlačítkem v horní liště.' })),
        el('div', { class: 'card' }, el('h3', { text: 'Zdroje dat' }), el('p', { class: 'howto', text: 'Dráhy, body, TMA a CTR: AIP ČR (ŘLP ČR, AIRAC 2026). Další body a mapa letiště: X-Plane navdata 2013 (licence GPL, R. A. Peel), zjednodušeno. Hranice a řeky: Natural Earth. Data jsou zjednodušená pro výcvikovou hru a nejsou určena k navigaci.' })));
    },
    show() {
      document.body.classList.remove('corners-off');
      const ua = navigator.userAgent; const rows = [['User agent', ua], ['Viewport', `${innerWidth} × ${innerHeight}`], ['visualViewport', window.visualViewport ? `${Math.round(visualViewport.width)} × ${Math.round(visualViewport.height)} (zoom ${visualViewport.scale})` : '–'], ['Jemný ukazatel', String(matchMedia('(any-pointer: fine)').matches)], ['Hrubý ukazatel', String(matchMedia('(any-pointer: coarse)').matches)], ['Najetí', String(matchMedia('(any-hover: hover)').matches)], ['Snížený pohyb', String(matchMedia('(prefers-reduced-motion: reduce)').matches)], ['Samostatný režim', String(!!navigator.standalone || matchMedia('(display-mode: standalone)').matches)]];
      this.kv.innerHTML = ''; for (const [k, val] of rows) this.kv.append(el('div', { class: 'k', text: k }), el('div', { class: 'v', text: val }));
    },
    hide() { document.body.classList.add('corners-off'); },
  },
  {
    id: 'storage', name: 'Ukládání',
    howto: 'Zavři stránku a otevři ji znovu. <b>Počet spuštění</b> se má zvýšit o jedna a tvé odpovědi v testech mají zůstat vyplněné. Potom přepni do jiné aplikace a vrať se: simulace se mezitím má sama <b>pozastavit</b>.',
    checks: [{ id: 'count', t: 'Počet spuštění se po novém otevření zvýšil' }, { id: 'keep', t: 'Odpovědi v testech zůstaly vyplněné' }, { id: 'pause', t: 'Po návratu z jiné aplikace je simulace pozastavená', auto: () => App.hiddenCount > 0 }],
    auto: () => [['localStorage', ...yes(Store.ok)], ['IndexedDB', App.idbStatus || '…', App.idbStatus === 'ok' ? 'ok' : ''], ['Počet spuštění', String(App.launches)], ['Přechody na pozadí', String(App.hiddenCount)]],
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page);
      page.append(el('div', { class: 'card' }, el('h3', { text: `Toto je ${App.launches}. spuštění` }), el('p', { class: 'howto', text: 'Ukládání do prohlížeče slouží jen pro pohodlí: na jiném zařízení ani v jiném prohlížeči se neprojeví. Postup kampaně proto bude mít i tlačítko pro export.' })));
    },
  },
  {
    id: 'perf', name: 'Výkon',
    howto: 'Zátěžový test vykreslí hodně letadel najednou. Spusť měření a sleduj, jestli je pohyb plynulý. Výsledek se doplní automaticky.',
    checks: [{ id: 'smooth', t: 'Při plném provozu je obraz plynulý', auto: () => App.perfResult ? App.perfResult.avg >= 40 : null }],
    auto: () => [['Snímky za sekundu', App.fps ? App.fps.toFixed(0) : '–'], ['Výsledek měření', App.perfResult ? `průměr ${App.perfResult.avg.toFixed(0)} fps, minimum ${App.perfResult.min.toFixed(0)} fps při ${App.perfResult.n} letadlech` : 'neměřeno']],
    mount(v) {
      const wrap = el('div', { class: 'canvas-wrap' }); v.append(wrap);
      this.sim = new Sim({ sweep: 1 }); stressTraffic(this.sim, 120);
      this.view = new RadarView(wrap, this.sim, { menu: false, scale: 6 });
      const n = el('output', { text: '120 letadel' });
      const sl = el('input', { type: 'range', min: '20', max: '250', step: '10', value: '120', id: 'perf-n', 'aria-label': 'Počet letadel', style: 'width:180px' });
      sl.addEventListener('input', () => { stressTraffic(this.sim, +sl.value); n.textContent = sl.value + ' letadel'; });
      const run = el('button', { class: 'vt-btn warn', onclick: () => { this.measure = { t0: performance.now(), frames: [], n: +sl.value }; run.textContent = 'Měřím 10 s…'; } }, 'Spustit měření 10 s');
      this.runBtn = run;
      v.append(el('div', { class: 'view-toolbar' }, run, el('label', { class: 'vt-btn', for: 'perf-n', style: 'display:flex;align-items:center;gap:8px' }, sl, n)));
    },
    tick(dt) { if (!App.paused) for (let t = 0; t < dt; t += 0.25) this.sim.step(Math.min(0.25, dt - t)); },
    draw(now) {
      this.view.draw(now);
      if (this.measure) { const m = this.measure; m.frames.push(now); if (now - m.t0 > 10000) { const dts = []; for (let i = 1; i < m.frames.length; i++) dts.push(m.frames[i] - m.frames[i - 1]); const avg = 1000 / (dts.reduce((a, b) => a + b, 0) / dts.length); const worst = 1000 / Math.max(...dts.slice(5)); App.perfResult = { avg, min: worst, n: m.n }; this.measure = null; this.runBtn.textContent = 'Spustit měření 10 s'; App.refreshChecks(); toast(`Průměr ${avg.toFixed(0)} snímků za sekundu`); } }
    },
  },
  {
    id: 'results', name: 'Výsledky', summary: true,
    howto: 'Tady je souhrn všech odpovědí a automaticky zjištěných údajů. Tlačítkem je zkopíruješ a vložíš mi je do chatu.',
    checks: [], auto: () => [],
    mount(v) {
      const page = el('div', { class: 'panel-page' }); v.append(page);
      this.stats = el('div', { class: 'kv' }); this.pre = el('div', { class: 'result-pre' });
      const copy = el('button', { class: 'btn primary', onclick: async () => { const txt = App.resultText(); try { await navigator.clipboard.writeText(txt); toast('Výsledky jsou zkopírované. Vlož je do chatu.'); } catch (e) { const r = document.createRange(); r.selectNodeContents(this.pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Kopírování bylo zablokováno. Text je označený, zkopíruj ho ručně.'); } } }, 'Zkopírovat výsledky');
      const clear = el('button', { class: 'btn', onclick: () => {
        if (this._armed) { App.results = {}; Store.set('atc.demo.results', {}); this._armed = false; clear.textContent = 'Vymazat odpovědi'; App.refreshAll(); toast('Odpovědi jsou vymazané'); return; }
        this._armed = true; clear.textContent = 'Opravdu vymazat? Klepni znovu';
        setTimeout(() => { this._armed = false; clear.textContent = 'Vymazat odpovědi'; }, 4000);
      } }, 'Vymazat odpovědi');
      page.append(el('div', { class: 'card' }, el('h3', { text: 'Souhrn' }), this.stats, el('div', { class: 'btn-row' }, copy, clear)), this.pre);
    },
    show() { this.render(); },
    render() {
      let ok = 0, bad = 0, open = 0;
      for (const t of TESTS) for (const c of t.checks) { const v = (App.results[t.id] || {})[c.id]; if (v === 'ok') ok++; else if (v === 'bad') bad++; else open++; }
      this.stats.innerHTML = '';
      [['Funguje', ok], ['Nefunguje', bad], ['Bez odpovědi', open]].forEach(([k, v]) => this.stats.append(el('div', { class: 'k', text: k }), el('div', { class: 'v', text: String(v) })));
      this.pre.textContent = App.resultText();
    },
  },
];
