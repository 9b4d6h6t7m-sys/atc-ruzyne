'use strict';
/* Phraseology: controller and pilot transmissions, command parser (keyboard shorthand and dictated phraseology), radio channel. */

const Phrase = {
  // What the controller says (log text, digits for readability)
  atc(ac, c, sim) {
    const cs = Phrase.csText(ac);
    switch (c.type) {
      case 'hdg': { const dir = c.dir < 0 ? 'turn left ' : c.dir > 0 ? 'turn right ' : ''; return `${cs}, ${dir}heading ${String(c.val).padStart(3, '0')}`; }
      case 'alt': { const v = c.val > ac.alt + 50 ? 'climb' : c.val < ac.alt - 50 ? 'descend' : 'maintain';
        return c.val >= D.ta + 500 ? `${cs}, ${v} flight level ${Math.round(c.val / 100)}` : `${cs}, ${v} altitude ${c.val} feet, QNH ${sim.qnh}`; }
      case 'spd': return c.val === null ? `${cs}, no ATC speed restrictions` : `${cs}, ${c.val < ac.ias - 3 ? 'reduce' : c.val > ac.ias + 3 ? 'increase' : 'maintain'} speed ${c.val} knots`;
      case 'dct': return `${cs}, proceed direct ${c.fix}`;
      case 'ils': return `${cs}, cleared ILS approach runway ${c.rwy}`;
      case 'xfer': return c.to === 'TWR' ? `${cs}, contact Ruzyně Tower ${D.freq.TWR}` : `${cs}, contact Praha Control, good day`;
      case 'res': return `${cs}, resume own navigation`;
      case 'assume': return `${cs}, Praha Radar, radar contact`;
    }
    return cs;
  },
  csText(ac) { const al = AIRLINES[ac.cs.slice(0, 3)]; return al ? `${al.tel[0]}${al.tel.slice(1).toLowerCase()} ${ac.cs.slice(3)}` : ac.cs; },
  // What the pilot says back. Each pilot has a habitual style (hash of the callsign) with some random variation,
  // and every variant uses only words the voice packs contain. Returns display text and spoken text.
  readback(ac, cmds, sim) {
    const parts = [], spoken = []; const h = Sound.hash(ac.cs); const pick = (n) => (h + (Math.random() < 0.3 ? 1 : 0)) % n;
    const fl = (v) => `FL${Math.round(v / 100)}`;
    for (const c of cmds) {
      switch (c.type) {
        case 'hdg': {
          const d = c.dir < 0 ? 'left ' : c.dir > 0 ? 'right ' : ''; const hd = String(c.val).padStart(3, '0'); const sp = Speak.digits(c.val, 3);
          if (d && pick(2)) { parts.push(`turning ${d}heading ${hd}`); spoken.push(`turning ${d}heading ${sp}`); } else { parts.push(`${d}heading ${hd}`); spoken.push(`${d}heading ${sp}`); }
          break; }
        case 'alt': {
          const dir = c.val > ac.alt + 50 ? 1 : c.val < ac.alt - 50 ? -1 : 0;
          const verbs = dir < 0 ? ['descend', 'descending', 'down to'] : dir > 0 ? ['climb', 'climbing', 'up to'] : ['maintain', 'maintaining', 'maintain'];
          const v = verbs[pick(3)];
          if (c.val >= D.ta + 500) { parts.push(`${v} ${fl(c.val)}`); spoken.push(`${v} ${Speak.level(c.val)}`); }
          else { parts.push(`${v} ${c.val} ft, QNH ${sim.qnh}`); spoken.push(`${v} ${Speak.level(c.val)}, Q N H ${Speak.digits(sim.qnh, 4)}`); }
          break; }
        case 'spd': {
          if (c.val === null) { parts.push('no speed restrictions'); spoken.push('no speed restrictions'); break; }
          const dir = c.val < ac.ias - 3 ? -1 : c.val > ac.ias + 3 ? 1 : 0; const sp = Speak.digits(c.val);
          const forms = dir < 0 ? [['reduce speed', 'reduce speed'], ['reducing', 'reducing'], ['speed', 'speed']] : dir > 0 ? [['increase speed', 'increase speed'], ['increasing', 'increasing'], ['speed', 'speed']] : [['maintain speed', 'maintain speed'], ['speed', 'speed'], ['maintain speed', 'maintain speed']];
          const f = forms[pick(3)]; parts.push(`${f[0]} ${c.val} kt`); spoken.push(`${f[1]} ${sp} knots`); break; }
        case 'dct': if (pick(2)) { parts.push(`proceeding direct ${c.fix}`); spoken.push(`proceeding direct ${Speak.fix(c.fix)}`); } else { parts.push(`direct ${c.fix}`); spoken.push(`direct ${Speak.fix(c.fix)}`); } break;
        case 'ils': if (pick(2)) { parts.push(`cleared ILS ${c.rwy}`); spoken.push(`cleared I L S runway ${Speak.digits(+c.rwy, 2)}`); } else { parts.push(`cleared ILS approach ${c.rwy}`); spoken.push(`cleared I L S approach runway ${Speak.digits(+c.rwy, 2)}`); } break;
        case 'xfer':
          if (c.to === 'TWR') { if (pick(2)) { parts.push(`${D.freq.TWR}, good day`); spoken.push(`${Speak.freq(D.freq.TWR)}, good day`); } else { parts.push(`Tower ${D.freq.TWR}, bye`); spoken.push(`Tower ${Speak.freq(D.freq.TWR)}, bye bye`); } }
          else { parts.push('Praha Control, good day'); spoken.push('Praha Control, good day'); }
          break;
        case 'res': parts.push('resuming own navigation'); spoken.push('resuming own navigation'); break;
        case 'assume': parts.push('roger'); spoken.push('roger'); break;
      }
    }
    return { text: `${parts.join(', ')}, ${Phrase.csText(ac)}`, say: `${spoken.join(', ')}, ${Speak.callsign(ac)}` };
  },
};

/* ---------- Parser ---------- */
const Parser = (() => {
  const NUMW = { zero: 0, oh: 0, one: 1, won: 1, two: 2, three: 3, tree: 3, four: 4, fower: 4, five: 5, fife: 5, six: 6, seven: 7, eight: 8, nine: 9, niner: 9 };
  const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const LET = {}; PHON.forEach((w, i) => { LET[w.toLowerCase()] = String.fromCharCode(65 + i); });
  Object.assign(LET, { alpha: 'A', juliet: 'J', juliette: 'J', whisky: 'W', 'x-ray': 'X', xray: 'X', charly: 'C' });
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[m][n];
  }
  // Normalise dictated text: words -> tokens; spoken digits merged into numbers.
  function tokens(text) {
    const raw = text.toLowerCase().replace(/ruzyně/g, 'ruzyne').replace(/[^a-z0-9.\s-]/g, ' ').replace(/(\d)\.(?=\s|$)/g, '$1 ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const w = raw[i];
      if (/^\d+(\.\d+)?$/.test(w)) { out.push({ n: w }); continue; }
      if (/^\d+[a-z]$/.test(w)) { out.push({ n: w.slice(0, -1) }); out.push({ l: w.slice(-1).toUpperCase() }); continue; }
      if (w in NUMW) { out.push({ d: String(NUMW[w]) }); continue; }
      if (w in TEENS) { out.push({ n: String(TEENS[w]) }); continue; }
      if (w === 'hundred' || w === 'thousand') { out.push({ mul: w === 'hundred' ? 100 : 1000 }); continue; }
      if (w === 'decimal' || w === 'point') { out.push({ dec: true }); continue; }
      if (w in LET) { out.push({ l: LET[w] }); continue; }
      out.push({ w });
    }
    // merge digits / numbers / multipliers into numbers
    const res = [];
    for (let i = 0; i < out.length; i++) {
      const t = out[i];
      if (t.d !== undefined || t.n !== undefined) {
        let s = t.d ?? t.n; let j = i + 1;
        while (j < out.length && (out[j].d !== undefined || out[j].dec || (out[j].n !== undefined && out[j - 1].d !== undefined))) { s += out[j].dec ? '.' : (out[j].d ?? out[j].n); j++; }
        let val = parseFloat(s);
        while (j < out.length && out[j].mul) { val *= out[j].mul; j++;
          if (j < out.length && (out[j].d !== undefined || out[j].n !== undefined) && out[j + 1] && out[j + 1].mul === 100) { val += parseFloat(out[j].d ?? out[j].n) * 100; j += 2; } }
        res.push({ num: val, str: s }); i = j - 1; continue;
      }
      res.push(t);
    }
    return res;
  }
  function telKey(cs) { const al = AIRLINES[cs.slice(0, 3)]; return (al ? al.tel : cs.slice(0, 3)).toLowerCase().replace(/\s/g, ''); }
  // Find the callsign at the start of a dictated phrase.
  function matchCallsign(toks, aircraft) {
    let best = null;
    const words = toks.map(t => t.w || '');
    for (const ac of aircraft) {
      const key = telKey(ac.cs), suf = ac.cs.slice(3).toUpperCase();
      for (let i = 0; i < Math.min(3, toks.length); i++) {
        for (let span = 1; span <= 3 && i + span <= toks.length; span++) {
          const cand = toks.slice(i, i + span).map(t => t.w || t.l || '').join('').toLowerCase();
          if (!cand) continue;
          const tol = key.length >= 7 ? 2 : key.length >= 4 ? 1 : 0;
          if (lev(cand, key) <= tol) {
            let j = i + span, s = '';
            while (j < toks.length && (toks[j].num !== undefined || toks[j].l)) { s += toks[j].num !== undefined ? toks[j].str.replace('.', '') : toks[j].l; j++; }
            const sc = s === suf ? 1 : (s && (suf.startsWith(s) || s.startsWith(suf)) ? 0.75 : (s && lev(s, suf) === 1 ? 0.7 : (s ? 0 : 0.5)));
            if (sc > 0 && (!best || sc > best.score)) best = { ac, score: sc, next: j };
          }
        }
      }
      // ICAO code typed directly, e.g. TVS35J
      const t0 = ((toks[0] && toks[0].w) || '').toUpperCase();
      if (t0 && (t0 === ac.cs)) best = { ac, score: 1, next: 1 };
    }
    if (!best) { // suffix only, e.g. "three five juliett, turn left ..."
      let j = 0, s = '';
      while (j < toks.length && (toks[j].num !== undefined || toks[j].l)) { s += toks[j].num !== undefined ? toks[j].str.replace('.', '') : toks[j].l; j++; }
      if (s) { const hits = aircraft.filter(a => a.cs.slice(3).toUpperCase() === s); if (hits.length === 1) best = { ac: hits[0], score: 0.6, next: j }; }
    }
    return best;
  }
  function fixMatch(wordsArr) {
    const names = Object.keys(FIX);
    for (let span = 3; span >= 1; span--) {
      const cand = wordsArr.slice(0, span).join('').toUpperCase(); if (cand.length < 3) continue;
      let best = null;
      for (const n of names) { const d = lev(cand, n); if (d <= (n.length >= 5 ? 1 : 0) && (!best || d < best.d)) best = { n, d }; }
      if (best) return best.n;
    }
    return null;
  }
  function phraseCommands(toks, ac) {
    const s = toks.map(t => t.num !== undefined ? String(t.num) : t.w || (t.l ? t.l.toLowerCase() : '')).join(' ');
    const cmds = []; let m;
    const push = (pos, c) => cmds.push({ pos, c });
    const reH = /(?:turn (left|right) )?(?:fly |continue )?heading (\d{1,3})/g;
    while ((m = reH.exec(s))) { const v = +m[2]; if (v <= 360) push(m.index, { type: 'hdg', val: v === 360 ? 360 : v, dir: m[1] === 'left' ? -1 : m[1] === 'right' ? 1 : 0 }); }
    const reFL = /(climb|descend|maintain)(?: and maintain)?(?: to)? (?:flight level|level|fl) (\d{2,3})/g;
    while ((m = reFL.exec(s))) push(m.index, { type: 'alt', val: +m[2] * 100 });
    const reFT = /(climb|descend|maintain)(?: and maintain)?(?: to)?(?: altitude)? (\d{4,5})(?: feet| ft)?/g;
    while ((m = reFT.exec(s))) { const v = +m[2]; if (v >= 1000 && v <= 20000) push(m.index, { type: 'alt', val: v }); }
    const reS = /(?:(reduce|increase|maintain) )?speed(?: to)? (\d{3})/g;
    while ((m = reS.exec(s))) push(m.index, { type: 'spd', val: +m[2] });
    const reS2 = /(reduce|increase)(?: to)? (\d{3})(?: knots)?/g;
    while ((m = reS2.exec(s))) if (!cmds.some(x => x.c.type === 'spd')) push(m.index, { type: 'spd', val: +m[2] });
    if ((m = /no (?:atc )?speed restrictions?|resume normal speed/.exec(s))) push(m.index, { type: 'spd', val: null });
    const reD = /direct(?: to)? ([a-z ]{3,24})/g;
    while ((m = reD.exec(s))) { const f = fixMatch(m[1].trim().split(' ')); if (f) push(m.index, { type: 'dct', fix: f }); }
    if ((m = /cleared(?: for)?(?: the)? (?:ils|i l s)(?: approach)?(?: runway)? (\d{1,2})/.exec(s))) { const r = String(m[1]).padStart(2, '0'); if (RWY[r]) push(m.index, { type: 'ils', rwy: r }); }
    if ((m = /contact (?:ruzyne )?tower/.exec(s))) push(m.index, { type: 'xfer', to: 'TWR' });
    if ((m = /contact (?:praha|prague) (?:control|radar)/.exec(s))) push(m.index, { type: 'xfer', to: 'ACC' });
    if ((m = /resume own navigation/.exec(s))) push(m.index, { type: 'res' });
    if ((m = /radar contact|identified/.exec(s))) push(m.index, { type: 'assume' });
    return cmds.sort((a, b) => a.pos - b.pos).map(x => x.c);
  }
  // Keyboard shorthand: "35J L270 F80 S180", "TVS35J D ERASU", "KLM1355 AS"
  function shorthand(text, aircraft) {
    const t = text.trim().toUpperCase().split(/\s+/).filter(Boolean); if (!t.length) return null;
    let ac = aircraft.find(a => a.cs === t[0]);
    if (!ac) { const hits = aircraft.filter(a => a.cs.endsWith(t[0]) && t[0].length >= 2); if (hits.length === 1) ac = hits[0]; }
    if (!ac && t[0].length >= 2 && /\d/.test(t[0])) { const hits = aircraft.filter(a => a.cs.includes(t[0])); if (hits.length === 1) ac = hits[0]; }
    if (!ac) return null;
    const cmds = []; const bad = [];
    for (let i = 1; i < t.length; i++) {
      const w = t[i]; let m;
      if ((m = /^H(\d{1,3})$/.exec(w))) cmds.push({ type: 'hdg', val: +m[1], dir: 0 });
      else if ((m = /^([LR])(\d{1,3})$/.exec(w))) cmds.push({ type: 'hdg', val: +m[2], dir: m[1] === 'L' ? -1 : 1 });
      else if ((m = /^FL?(\d{2,3})$/.exec(w))) cmds.push({ type: 'alt', val: +m[1] * 100 });
      else if ((m = /^A(\d{2,5})$/.exec(w))) { let v = +m[1]; if (v < 100) v *= 100; cmds.push({ type: 'alt', val: v }); }
      else if ((m = /^S(\d{3})$/.exec(w))) cmds.push({ type: 'spd', val: +m[1] });
      else if (w === 'SR' || w === 'S') cmds.push({ type: 'spd', val: null });
      else if ((w === 'D' || w === 'DCT') && t[i + 1]) { if (FIX[t[i + 1]]) cmds.push({ type: 'dct', fix: t[++i] }); else bad.push(t[++i]); }
      else if ((m = /^D([A-Z]{3,5})$/.exec(w)) && FIX[m[1]]) cmds.push({ type: 'dct', fix: m[1] });
      else if ((m = /^I(?:LS)?(\d{2})$/.exec(w)) && RWY[m[1]]) cmds.push({ type: 'ils', rwy: m[1] });
      else if (w === 'TWR' || w === 'CT') cmds.push({ type: 'xfer', to: 'TWR' });
      else if (w === 'ACC' || w === 'CC') cmds.push({ type: 'xfer', to: 'ACC' });
      else if (w === 'RES') cmds.push({ type: 'res' });
      else if (w === 'AS' || w === 'ASSUME') cmds.push({ type: 'assume' });
      else bad.push(w);
    }
    return { ac, cmds, bad, mode: 'shorthand' };
  }
  function parse(text, aircraft) {
    const sh = shorthand(text, aircraft);
    if (sh && sh.cmds.length && !sh.bad.length) return sh;
    const toks = tokens(text);
    const cs = matchCallsign(toks, aircraft);
    if (!cs) return { ac: null, cmds: [], bad: [], mode: 'phraseology', error: 'CALLSIGN NOT RECOGNISED' };
    const cmds = phraseCommands(toks.slice(cs.next), cs.ac);
    return { ac: cs.ac, cmds, bad: [], mode: 'phraseology', score: cs.score, error: cmds.length ? null : 'INSTRUCTION NOT RECOGNISED' };
  }
  return { parse, tokens, lev, shorthand };
})();

function cmdLabel(c) {
  switch (c.type) {
    case 'hdg': return `${c.dir < 0 ? 'L' : c.dir > 0 ? 'R' : 'H'}${String(c.val).padStart(3, '0')}`;
    case 'alt': return c.val >= D.ta + 500 ? `FL${String(Math.round(c.val / 100)).padStart(3, '0')}` : `A${String(Math.round(c.val / 100)).padStart(3, '0')}`;
    case 'spd': return c.val === null ? 'SPD NONE' : `S${c.val}`;
    case 'dct': return `DCT ${c.fix}`;
    case 'ils': return `ILS ${c.rwy}`;
    case 'xfer': return c.to === 'TWR' ? 'XFER TWR' : 'XFER ACC';
    case 'res': return 'RESUME NAV';
    case 'assume': return 'ASSUME';
  }
  return c.type;
}

/* ---------- Radio channel: one transmitter at a time, pilot readbacks after a short delay ---------- */
class Comms {
  constructor(sim) { this.sim = sim; this.queue = []; this.busyUntil = 0; this.speaking = false; this.listeners = []; this.entries = []; }
  onLog(fn) { this.listeners.push(fn); }
  log(who, text) { const e = { t: this.sim.t, who, text }; this.entries.push(e); if (this.entries.length > 200) this.entries.shift(); this.listeners.forEach(f => f(e)); }
  atc(ac, cmds) {
    if (!ac || !cmds.length) return;
    const text = cmds.length === 1 ? Phrase.atc(ac, cmds[0], this.sim) : Phrase.atc(ac, cmds[0], this.sim) + ', ' + cmds.slice(1).map(c => Phrase.atc(ac, c, this.sim).split(', ').slice(1).join(', ')).join(', ');
    this.log('atc', text);
    if (cmds.some(c => c.type === 'assume')) ac.ctl = 'own';
    const rb = Phrase.readback(ac, cmds, this.sim);
    this.queue.push({ ac, due: this.sim.t + rnd(1.4, 3.0), text: rb.text, say: rb.say, apply: () => cmds.forEach(c => ac.command(c, this.sim)) });
  }
  pilot(ac, text, say, delay = 0) { this.queue.push({ ac, due: this.sim.t + delay, text, say, call: true }); }
  tick() {
    if (this.speaking || !this.queue.length) return;
    const now = this.sim.t; const i = this.queue.findIndex(q => q.due <= now); if (i < 0) return;
    const q = this.queue.splice(i, 1)[0];
    if (q.apply) q.apply();
    if (q.ac && q.ac.done && !q.call) return;
    this.log('plt', q.text);
    if (q.call) Sound.tone('call');
    if (App.fastRadio) return; // test hook: no real-time audio, the radio is free immediately
    this.speaking = true;
    const done = () => { this.speaking = false; };
    Sound.transmit(q.say, q.ac ? q.ac.cs : null).then(done, done);
  }
}
