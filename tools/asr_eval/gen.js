// Generate controller transmissions (spoken text for TTS + ground-truth commands).
const { load } = require('./game'); const G = load(); const fs = require('fs');
let seed = 20261102; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const CS = ['TVS35J', 'RYR8YD', 'AFR1083', 'UAE139', 'KLM1355', 'DLH1395', 'WZZ2219', 'BAW852', 'EZY452', 'LOT511', 'ITY417', 'VLG29GF', 'THY3FZ', 'QTR291', 'SWR2KA', 'AUA131', 'EWG7NK', 'SAS767', 'FIN1KT', 'DAL94', 'AEE48C', 'TVS2AB', 'TVS7K3', 'RYR5TR'];
const TEL_TTS = { AIRFRANS: 'Air France', KLM: 'K L M', LOT: 'Lot', RYANAIR: 'Ryanair' };
const D9 = ['zero', 'one', 'two', 'tree', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const digits = (n, len) => String(n).padStart(len || 0, '0').split('').map(c => D9[+c]).join(' ');
const csSpoken = (cs) => { const al = G.AIRLINES[cs.slice(0, 3)]; const tel = TEL_TTS[al.tel] || (al.tel[0] + al.tel.slice(1).toLowerCase()); return tel + ' ' + cs.slice(3).split('').map(c => /\d/.test(c) ? D9[+c] : G.PHON[c.charCodeAt(0) - 65][0] + G.PHON[c.charCodeAt(0) - 65].slice(1).toLowerCase()).join(' '); };
const FIXES = ['ERASU', 'GOLOP', 'LOMKI', 'BAGRU', 'APRAQ', 'SOMIS', 'EVEMI', 'ARVEG', 'RATEV', 'AKEVA', 'BAROX', 'KENOK', 'KUVIX', 'ARTUP', 'VENOX', 'BALTU', 'DOBEN'];
const thousands = (ft) => { const th = Math.floor(ft / 1000), h = Math.round((ft % 1000) / 100); let s = th ? `${th === 9 ? 'nine' : D9[th]} thousand` : ''; if (h) s += ` ${h === 9 ? 'nine' : D9[h]} hundred`; return s.trim(); };
function cmd() {
  const t = pick(['hdg', 'hdg', 'alt', 'alt', 'spd', 'dct', 'ils', 'xfer', 'assume', 'res']);
  if (t === 'hdg') { const v = (Math.floor(rnd() * 36) + 1) * 10; const dir = pick([-1, 1, 0]); return { c: { type: 'hdg', val: v, dir }, say: `${dir < 0 ? 'turn left heading' : dir > 0 ? 'turn right heading' : 'fly heading'} ${digits(v, 3)}` }; }
  if (t === 'alt') { if (rnd() < 0.75) { const fl = (Math.floor(rnd() * 19) + 6) * 10; const v = pick(['descend', 'climb', 'descend to', 'climb to']); return { c: { type: 'alt', val: fl * 100 }, say: `${v} flight level ${digits(fl)}` }; }
    const ft = pick([3000, 3500, 4000, 5000]); return { c: { type: 'alt', val: ft }, say: `descend altitude ${thousands(ft)} feet, Q N H one zero zero niner` }; }
  if (t === 'spd') { if (rnd() < 0.15) return { c: { type: 'spd', val: null }, say: 'no speed restriction' }; const v = (Math.floor(rnd() * 13) + 16) * 10; return { c: { type: 'spd', val: v }, say: `${pick(['reduce speed', 'reduce speed to', 'increase speed'])} ${digits(v)} knots` }; }
  if (t === 'dct') { const f = pick(FIXES); return { c: { type: 'dct', fix: f }, say: `${pick(['proceed direct', 'direct'])} ${f[0] + f.slice(1).toLowerCase()}` }; }
  if (t === 'ils') { const r = pick(['24', '24', '06', '30']); return { c: { type: 'ils', rwy: r }, say: `cleared I L S approach runway ${digits(+r, 2)}` }; }
  if (t === 'xfer') { if (rnd() < 0.6) return { c: { type: 'xfer', to: 'TWR' }, say: 'contact Roozinyeh Tower one tree four decimal five six zero' }; return { c: { type: 'xfer', to: 'ACC' }, say: 'contact Praha Control, good day' }; }
  if (t === 'assume') return { c: { type: 'assume' }, say: pick(['radar contact', 'identified']) };
  return { c: { type: 'res' }, say: 'resume own navigation' };
}
const out = [];
for (let i = 0; i < 160; i++) {
  const cs = pick(CS); const n = rnd() < 0.45 ? 1 : rnd() < 0.7 ? 2 : 3; const cmds = []; const used = new Set();
  while (cmds.length < n) { const c = cmd(); if (used.has(c.c.type)) continue; if ((c.c.type === 'xfer' || c.c.type === 'assume') && cmds.length) continue; used.add(c.c.type); cmds.push(c); if (c.c.type === 'xfer' || c.c.type === 'assume') break; }
  out.push({ id: 'c' + String(i).padStart(3, '0'), cs, cmds: cmds.map(c => c.c), say: `${csSpoken(cs)}, ${cmds.map(c => c.say).join(', ')}` });
}
fs.writeFileSync(__dirname + '/dataset.json', JSON.stringify(out, null, 0));
console.log(out.length, 'transmissions'); console.log(out.slice(0, 4).map(o => o.say).join('\n'));
