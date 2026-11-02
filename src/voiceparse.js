'use strict';
/* VoiceParser: turns an imperfect speech-recognition transcript into ATC instructions.
   Speech engines mishear phraseology ("the send flight level", "Sky Trouble 3 5 Juliet", "run with 2 4").
   Instead of exact patterns we use phonetic keys, fuzzy keyword anchors, homophone-aware number reading and
   the list of aircraft actually on frequency. Every result carries a confidence; low confidence -> "say again". */
const VoiceParser = (() => {
  const DIGIT_WORDS = { zero: 0, oh: 0, o: 0, one: 1, won: 1, two: 2, too: 2, to: 2, three: 3, tree: 3, free: 3, four: 4, fower: 4, for: 4, fore: 4, five: 5, fife: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, niner: 9, nina: 9, nana: 9, nein: 9, nyna: 9, under: 9, minor: 9 };
  const SOFT_DIGITS = new Set(['to', 'too', 'for', 'fore', 'won', 'ate', 'oh', 'o', 'free', 'nana', 'nina', 'nyna', 'under', 'minor']); // only digits next to other digits
  const FILLERS = new Set(['a', 'an', 'and', 'or', 'uh', 'um', 'er', 'the', 'of']);
  const LETTERS = {}; PHON.forEach((w, i) => { LETTERS[w.toLowerCase()] = String.fromCharCode(65 + i); });
  Object.assign(LETTERS, { alpha: 'A', alfa: 'A', juliet: 'J', juliette: 'J', julia: 'J', whisky: 'W', xray: 'X', charly: 'C', charlie: 'C', hotels: 'H', kilos: 'K', tangle: 'T', romeos: 'R', yankees: 'Y', foxtrots: 'F' });

  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) { cur[0] = i; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
    return prev[n];
  }
  /* Rough phonetic key: similar-sounding spellings collapse to the same string. */
  function phon(s) {
    s = String(s).toLowerCase().replace(/[^a-z]/g, '');
    if (!s) return '';
    s = s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'kw').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/wh/g, 'w')
      .replace(/th/g, 't').replace(/dh/g, 'd').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/z/g, 's').replace(/v/g, 'f')
      .replace(/dg/g, 'j').replace(/g(?=[eiy])/g, 'j').replace(/kn/g, 'n').replace(/gh/g, 'g').replace(/y/g, 'i').replace(/w(?=[aeiou])/g, 'u').replace(/w/g, '')
      .replace(/d$/, 't').replace(/b/g, 'p').replace(/d/g, 't').replace(/g/g, 'k');
    const first = s[0];
    return (first + s.slice(1).replace(/[aeiou]+/g, 'a')).replace(/(.)\1+/g, '$1');
  }
  function sim(a, b) { const pa = phon(a), pb = phon(b); if (!pa || !pb) return 0; return 1 - lev(pa, pb) / Math.max(pa.length, pb.length); }

  /* Tokenise: split letters from digits ("9f4" -> 9 f 4), separators to spaces, keep each numeral as a token. */
  function tokens(text) {
    const t = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/(\d)\s*[.,]\s*(\d)/g, '$1.$2').replace(/[/\-–—_]/g, ' ').replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/[^a-z0-9. ]/g, ' ').replace(/\.(?!\d)/g, ' ').split(/\s+/).filter(Boolean);
    return t;
  }
  /* Read a digit string starting at token i. Returns {digits, end}. Fillers and soft homophones only count between digits. */
  function readDigits(T, i, maxLen = 5) {
    let s = '', j = i, lastWasDigit = false;
    while (j < T.length && s.length < maxLen) {
      const w = T[j];
      if (/^\d+$/.test(w)) { s += w; lastWasDigit = true; j++; continue; }
      if (/^\d+\.\d+$/.test(w)) { s += w.replace('.', ''); lastWasDigit = true; j++; continue; }
      if (w in DIGIT_WORDS && (!SOFT_DIGITS.has(w) || lastWasDigit || (T[j + 1] && (/^\d/.test(T[j + 1]) || T[j + 1] in DIGIT_WORDS) && !SOFT_DIGITS.has(T[j + 1])))) { s += String(DIGIT_WORDS[w]); lastWasDigit = true; j++; continue; }
      if (w === 'thousand' && s) { s = String(+s * 1000); j++; lastWasDigit = true; continue; }
      if (w === 'hundred' && s) { const th = +s; s = String(th < 10 ? th * 100 : th); j++; continue; }
      if (lastWasDigit && (FILLERS.has(w) || (w.length === 1 && /[a-z]/.test(w))) && T[j + 1] && (/^\d/.test(T[j + 1]) || (T[j + 1] in DIGIT_WORDS && !SOFT_DIGITS.has(T[j + 1])))) { j++; continue; }
      break;
    }
    return { digits: s, end: j };
  }
  /* Find a keyword (possibly multi-word) by phonetic similarity in token windows. Returns {i, end, score}. */
  function find(T, from, to, kw, thr) {
    const kp = kw.split(' '); let best = null;
    for (let i = from; i < Math.min(to, T.length); i++) {
      for (let n = 1; n <= Math.min(kp.length + 1, 4) && i + n <= T.length; n++) {
        const win = T.slice(i, i + n); if (win.some(w => /\d/.test(w))) break;
        const sc = sim(win.join(''), kp.join(''));
        if (sc >= thr && (!best || sc > best.score + 0.01)) best = { i, end: i + n, score: sc };
      }
    }
    return best;
  }
  const spokenTel = (cs) => { const al = AIRLINES[cs.slice(0, 3)]; return al ? al.tel.toLowerCase() : cs.slice(0, 3).toLowerCase(); };

  /* Callsign: telephony by phonetic similarity + suffix (digits and phonetic letters) against aircraft on frequency. */
  function callsign(T, aircraft) {
    const head = Math.min(T.length, 9); let best = null, second = null;
    for (const ac of aircraft) {
      const tel = spokenTel(ac.cs); const suf = ac.cs.slice(3).toUpperCase(); const tw = tel.split(' ').length;
      let telBest = { score: 0, end: 0, start: 0 };
      for (let i = 0; i < Math.min(3, head); i++) for (let n = 1; n <= tw + 2 && i + n <= head; n++) {
        const win = T.slice(i, i + n); if (win.some(w => /^\d/.test(w))) break;
        const sc = sim(win.join(''), tel.replace(/ /g, '')); if (sc > telBest.score) telBest = { score: sc, end: i + n, start: i };
      }
      // suffix right after the telephony (or from the start if the telephony was not heard)
      let j = telBest.score >= 0.5 ? telBest.end : 0, s = '';
      while (j < T.length && s.length < suf.length + 2) {
        const w = T[j];
        if (!s && (w === 'to' || w === 'too') && T[j + 1] && !(T[j + 1] in DIGIT_WORDS && SOFT_DIGITS.has(T[j + 1]))) { s += '2'; j++; continue; }
        const rd = readDigits(T, j, 4); if (rd.digits) { s += rd.digits; j = rd.end; continue; }
        if (w in LETTERS) { s += LETTERS[w]; j++; continue; }
        if (s === suf) break; // complete: only exact digits/letters may extend it (a longer suffix of another flight), never a fuzzy word ("852, radar contact")
        let fz = null; for (const k of Object.keys(LETTERS)) { if (k.length < 4 || w.length < 3) continue; const sc = sim(w, k); if (sc >= 0.66 && (!fz || sc > fz.sc)) fz = { k, sc }; } if (fz) { s += LETTERS[fz.k]; j++; continue; }
        if (w.length === 1 && /[a-z]/.test(w) && suf.includes(w.toUpperCase())) { s += w.toUpperCase(); j++; continue; }
        if (FILLERS.has(w) && s) { j++; continue; }
        break;
      }
      let sufScore = 0;
      if (s === suf) sufScore = 1; else if (s) { const d = lev(s, suf); sufScore = d === 1 ? 0.7 : d === 2 && suf.length >= 4 ? 0.45 : (suf.startsWith(s) && s.length >= 2 ? 0.6 : (s.includes(suf) ? 0.6 : 0)); }
      let score = telBest.score >= 0.45 ? 0.55 * telBest.score + 0.45 * sufScore : 0.8 * sufScore;
      const sameAirline = aircraft.filter(a => a.cs.slice(0, 3) === ac.cs.slice(0, 3)).length;
      if (sameAirline === 1 && telBest.score >= 0.75) score = Math.max(score, 0.62 * telBest.score + 0.2 * sufScore); // the only flight of that airline
      const cand = { ac, score, next: Math.max(j, telBest.end), tel: telBest.score, suf: sufScore, heard: s };
      if (!best || score > best.score) { second = best; best = cand; } else if (!second || score > second.score) second = cand;
    }
    if (!best || best.score < 0.5) return null;
    best.margin = best.score - (second ? second.score : 0);
    if (second && best.margin < 0.08) return { ambiguous: true, options: [best.ac.cs, second.ac.cs] }; // two flights fit: ask again rather than guess
    return best;
  }
  /* Instructions after the callsign. */
  function instructions(T, from) {
    // end: index after the last token the instruction used (for the coverage check in parse)
    const out = []; const add = (pos, c, conf, end) => { if (!out.some(o => o.c.type === c.type)) out.push({ pos, c, conf, end: Math.max(pos + 1, end || 0) }); };
    const N = T.length;
    // heading
    for (const kw of ['heading']) {
      const f = find(T, from, N, kw, 0.6);
      if (f) { const rd = readDigits(T, f.end, 3); const v = +rd.digits; if (rd.digits.length >= 2 && v >= 1 && v <= 360) {
        const pre = T.slice(Math.max(from, f.i - 3), f.i).join(' '); const dir = /left|lift|laugh/.test(pre) ? -1 : /right|write|rite|ride/.test(pre) ? 1 : 0;
        add(f.i, { type: 'hdg', val: v, dir }, f.score, rd.end); } }
    }
    // flight level
    { const f = find(T, from, N, 'flight level', 0.62) || find(T, from, N, 'level', 0.8);
      if (f) { const rd = readDigits(T, f.end, 3); let v = +rd.digits; if (rd.digits.length >= 2 && v >= 10 && v <= 450) add(f.i, { type: 'alt', val: v * 100 }, f.score, rd.end); } }
    // altitude in feet
    if (!out.some(o => o.c.type === 'alt')) {
      const f = find(T, from, N, 'altitude', 0.65);
      if (f) { const rd = readDigits(T, f.end, 5); let v = +rd.digits; if (v > 0 && v < 100) v *= 100; if (v >= 1000 && v <= 20000) add(f.i, { type: 'alt', val: v }, f.score, rd.end); }
      else { for (let i = from; i < N; i++) if (/^(feet|ft|fit|feat)$/.test(T[i])) { let k = i - 1; while (k > from && (/^\d+$/.test(T[k]) || T[k] in DIGIT_WORDS || /thousand|hundred/.test(T[k]))) k--; const rd = readDigits(T, k + 1, 5); const v = +rd.digits; if (v >= 1000 && v <= 20000) add(k + 1, { type: 'alt', val: v }, 0.6, i + 1); break; } }
    }
    // speed
    { const nf = find(T, from, N, 'no speed restriction', 0.72) || find(T, from, N, 'resume normal speed', 0.75);
      if (nf) add(nf.i, { type: 'spd', val: null }, nf.score, nf.end);
      else {
        let f = find(T, from, N, 'speed', 0.7);
        let rd = f ? readDigits(T, f.end + (T[f.end] === 'to' ? 1 : 0), 3) : null;
        if (!(rd && rd.digits.length === 3)) { // "... 220 knots"
          for (let i = from; i < N; i++) if (sim(T[i], 'knots') >= 0.6 || /^(nots?|nuts|knot|nups|ops|notts)$/.test(T[i])) { let k = i - 1; while (k > from && (/^\d+$/.test(T[k]) || T[k] in DIGIT_WORDS)) k--; rd = readDigits(T, k + 1, 3); rd.end = Math.max(rd.end, i + 1); f = { i: k + 1, score: 0.65 }; break; }
        }
        if (rd && rd.digits.length === 3) { const v = +rd.digits; if (v >= 120 && v <= 350) add(f.i, { type: 'spd', val: v }, f.score, rd.end + (/^(knots?|nots?)$/.test(T[rd.end] || '') ? 1 : 0)); }
      } }
    // direct to a fix
    { const f = find(T, from, N, 'direct', 0.75);
      if (f) { let k = f.end; if (T[k] === 'to' || T[k] === 'two') k++; let bestFix = null; const COMMON = /^(flight|level|fight|light|to|the|send|sent|descend|descent|climb|speed|heading|turn|contact|cleared|runway|approach)$/;
        for (let n = 1; n <= 3 && k + n <= N; n++) { const win = T.slice(k, k + n); if (win.some(w => COMMON.test(w) || /\d/.test(w))) break; const cand = win.join(''); for (const name of Object.keys(FIX)) { const sc = sim(cand, name); if (sc >= 0.7 && (!bestFix || sc > bestFix.sc)) bestFix = { name, sc, end: k + n }; } }
        if (bestFix) add(f.i, { type: 'dct', fix: bestFix.name }, Math.min(f.score, bestFix.sc), bestFix.end); } }
    // ILS approach: "approach" or "ils" near a runway number
    { const f = find(T, from, N, 'approach', 0.65) || find(T, from, N, 'i l s', 0.75) || find(T, from, N, 'cleared', 0.75);
      if (f) { for (let i = f.end; i < Math.min(N, f.end + 6); i++) { const rd = readDigits(T, i, 2); if (rd.digits.length === 2 && RWY[rd.digits]) { add(f.i, { type: 'ils', rwy: rd.digits }, f.score, rd.end); break; } if (rd.digits.length === 1 && T[i + 1] && RWY['0' + rd.digits]) { /* "6" -> 06 */ } } } }
    // transfer
    { const c = find(T, from, N, 'contact', 0.7);
      if (c) { const rest = T.slice(c.end, c.end + 5).join(' ');
        if (find(T, c.end, c.end + 4, 'control', 0.66) || find(T, c.end, c.end + 3, 'praha', 0.7)) add(c.i, { type: 'xfer', to: 'ACC' }, c.score, N);
        else if (find(T, c.end, c.end + 4, 'tower', 0.75) || /134|13 4|ruzyn|rosen|risen|resin|roozin/.test(rest)) add(c.i, { type: 'xfer', to: 'TWR' }, c.score, N); } } // a transfer ends the transmission (frequency, greeting)
    // resume own navigation
    { const f = find(T, from, N, 'navigation', 0.7); if (f) add(f.i, { type: 'res' }, f.score, f.end); }
    // radar contact / identified
    { const f = find(T, from, N, 'radar contact', 0.68) || find(T, from, N, 'identified', 0.7); if (f && !out.some(o => o.c.type === 'xfer')) add(f.i, { type: 'assume' }, f.score, f.end); }
    return out.sort((a, b) => a.pos - b.pos);
  }
  function parse(text, aircraft) {
    const T = tokens(text);
    if (!T.length) return { ac: null, cmds: [], conf: 0, error: 'EMPTY' };
    const cs = callsign(T, aircraft);
    if (!cs) return { ac: null, cmds: [], conf: 0, error: 'CALLSIGN NOT RECOGNISED', tokens: T };
    if (cs.ambiguous) return { ac: null, cmds: [], conf: 0, error: 'CALLSIGN AMBIGUOUS ' + cs.options.join('/'), ambiguous: cs.options, tokens: T };
    const from = Math.min(cs.next, T.length); const ins = instructions(T, from);
    const left = unexplained(T, from, ins);
    let conf = ins.length ? Math.min(cs.score, ...ins.map(i => i.conf)) : cs.score * 0.5;
    if (left.length) conf = Math.min(conf, UNEXPLAINED_CONF); // part of the transmission was not understood: ask again rather than act on half of it
    return { ac: cs.ac, cmds: ins.map(i => i.c), conf, csScore: cs.score, margin: cs.margin, heard: cs.heard, unexplained: left, error: ins.length ? null : 'INSTRUCTION NOT RECOGNISED', tokens: T, mode: 'voice' };
  }
  /* Coverage: numbers and instruction words after the callsign that no recognised instruction used. They mean an
     instruction was heard but not understood (e.g. "increase P-260 or nots", "direct arctic"). Each instruction also
     covers up to three words before its keyword (turn left / descend to / cleared) and a QNH group after an altitude. */
  const UNEXPLAINED_CONF = 0.5;
  const KEYWORDS = new Set(['heading', 'level', 'flight', 'speed', 'knots', 'direct', 'approach', 'ils', 'cleared', 'contact', 'descend', 'climb', 'turn', 'navigation', 'altitude', 'feet', 'tower', 'reduce', 'increase', 'runway', 'proceed']);
  function unexplained(T, from, ins) {
    const cov = new Uint8Array(T.length);
    for (const o of ins) {
      let e = o.end;
      if (o.c.type === 'alt') while (e < T.length && e < o.end + 10 && /^(q|n|h|qnh|nh|qh|feet|ft|\d+|decimal|and|a)$/.test(T[e])) e++;
      for (let i = Math.max(from, o.pos - 3); i < Math.min(T.length, e); i++) cov[i] = 1;
    }
    const out = [];
    for (let i = from; i < T.length; i++) { const w = T[i]; if (!cov[i] && (/^\d/.test(w) || KEYWORDS.has(w) || (w in DIGIT_WORDS && !SOFT_DIGITS.has(w)))) out.push(w); }
    return out;
  }
  /* Decoder prompt for the speech recogniser: the callsigns on frequency, written the way Whisper writes them, plus the
     phraseology and fixes in use. Whisper continues the style and vocabulary of its prompt, so telephony designators
     (Skytravel, Speedbird) and fix names come out spelled as the parser expects instead of as similar English words. */
  const PROMPT_TEL = { AIRFRANS: 'Air France', KLM: 'KLM', LOT: 'LOT', CSA: 'CSA', TOPSWISS: 'Top Swiss' };
  const telWritten = (cs) => { const al = AIRLINES[cs.slice(0, 3)]; if (!al) return cs.slice(0, 3); return PROMPT_TEL[al.tel] || al.tel.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' '); };
  function prompt(aircraft, opts = {}) {
    const calls = aircraft.slice(0, 10).map(a => `${telWritten(a.cs)} ${a.cs.slice(3)}`); // with 8 fixes about 110 tokens
    const fixes = [...new Set([...(opts.fixes || []), ...aircraft.flatMap(a => (a.route || []).slice(a.routeIdx || 0))])].filter(f => FIX[f] && f.length === 5).slice(0, 8).map(f => f[0] + f.slice(1).toLowerCase());
    const fx = fixes.length ? ', direct ' + fixes.join(', ') : '';
    if (opts.style === 'calls') return `Praha Radar, ${calls.join(', ')}.${fixes.length ? ' ' + fixes.join(', ') + '.' : ''}`;
    if (opts.style === 'lean') return `Praha Radar, ${calls.join(', ')}. Cleared ILS approach runway ${opts.rwy || '24'}${fx}, contact Ruzyne Tower.`;
    return `Praha Radar, ${calls.join(', ')}. Descend flight level, turn left heading, reduce speed, cleared ILS approach runway ${opts.rwy || '24'}${fx}, contact Ruzyne Tower.`;
  }
  /* Controller's "say again" (Whisper: "say again", "Oh, again?", "set again"): short transmission ending in "again". */
  function isSayAgain(T) {
    const i = T.lastIndexOf('again'); if (i < 0 && !find(T, 0, T.length, 'say again', 0.8)) return false;
    return T.filter(w => !FILLERS.has(w)).length <= 7;
  }
  return { parse, tokens, phon, sim, readDigits, callsign, instructions, prompt, isSayAgain };
})();
