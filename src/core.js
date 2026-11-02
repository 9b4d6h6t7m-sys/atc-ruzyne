'use strict';
/* Core utilities: geometry, units, aircraft performance, airline telephony. */
const D = window.LKPR;
const DEG = Math.PI / 180;
const KX = Math.cos(D.ref.lat * DEG) * 60; // NM per degree of longitude at reference latitude
const Geo = {
  toNM(lat, lon) { return { x: (lon - D.ref.lon) * KX, y: (lat - D.ref.lat) * 60 }; },
  toM(lat, lon) { const p = Geo.toNM(lat, lon); return { x: p.x * 1852, y: p.y * 1852 }; },
  fromNM(x, y) { return { lat: D.ref.lat + y / 60, lon: D.ref.lon + x / KX }; },
  dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); },
  brg(a, b) { return (Math.atan2(b.x - a.x, b.y - a.y) / DEG + 360) % 360; },
  norm360(a) { return ((a % 360) + 360) % 360; },
  diff(a, b) { let d = Geo.norm360(b - a); if (d > 180) d -= 360; return d; }, // signed shortest turn from a to b
  move(p, brg, d) { return { x: p.x + Math.sin(brg * DEG) * d, y: p.y + Math.cos(brg * DEG) * d }; },
};
const MAGVAR = D.magVar; // degrees east
const toMag = (t) => Geo.norm360(t - MAGVAR);
const toTrue = (m) => Geo.norm360(m + MAGVAR);

// Pre-projected fixes and navaids in NM
const FIX = {};
for (const [n, v] of Object.entries(D.fixes)) { const p = Geo.toNM(v[0], v[1]); FIX[n] = { n, x: p.x, y: p.y, cls: v[2] }; }
for (const [n, v] of Object.entries(D.navaids)) { const p = Geo.toNM(v[0], v[1]); FIX[n] = { n, x: p.x, y: p.y, cls: v[2] === 'NDB' ? 'ndb' : 'vor', freq: v[3], name: v[4] }; }
const RWY = {};
for (const r of D.rwys) {
  const t = Geo.toNM(r.thr[0], r.thr[1]); const e = Geo.toNM(r.end[0], r.end[1]);
  RWY[r.id] = { ...r, x: t.x, y: t.y, ex: e.x, ey: e.y, crs: r.trueHdg };
}

// Aircraft performance (simplified, inspired by public type data). Speeds IAS kt, rates ft/min.
const PERF = {
  A319: { wtc: 'M', vapp: 132, v2: 140, cl: 2400, de: 2000, acc: 1.4, dec: 1.0, size: 34 },
  A320: { wtc: 'M', vapp: 136, v2: 145, cl: 2300, de: 2000, acc: 1.4, dec: 1.0, size: 36 },
  A20N: { wtc: 'M', vapp: 135, v2: 145, cl: 2400, de: 2000, acc: 1.4, dec: 1.0, size: 36 },
  A21N: { wtc: 'M', vapp: 142, v2: 150, cl: 2200, de: 2000, acc: 1.3, dec: 1.0, size: 36 },
  B738: { wtc: 'M', vapp: 145, v2: 150, cl: 2300, de: 2100, acc: 1.4, dec: 1.0, size: 36 },
  B38M: { wtc: 'M', vapp: 145, v2: 150, cl: 2400, de: 2100, acc: 1.4, dec: 1.0, size: 36 },
  E190: { wtc: 'M', vapp: 130, v2: 135, cl: 2500, de: 2000, acc: 1.5, dec: 1.1, size: 29 },
  AT76: { wtc: 'M', vapp: 115, v2: 120, cl: 1500, de: 1500, acc: 1.2, dec: 1.0, size: 27, maxIas: 240 },
  DH8D: { wtc: 'M', vapp: 120, v2: 125, cl: 1900, de: 1800, acc: 1.3, dec: 1.0, size: 28, maxIas: 250 },
  B789: { wtc: 'H', vapp: 145, v2: 160, cl: 2000, de: 2000, acc: 1.2, dec: 0.9, size: 60 },
  B77W: { wtc: 'H', vapp: 150, v2: 165, cl: 1900, de: 2000, acc: 1.1, dec: 0.9, size: 65 },
  A333: { wtc: 'H', vapp: 140, v2: 155, cl: 1900, de: 2000, acc: 1.1, dec: 0.9, size: 60 },
  C525: { wtc: 'L', vapp: 110, v2: 112, cl: 2600, de: 2000, acc: 1.8, dec: 1.2, size: 14 },
  PC12: { wtc: 'L', vapp: 95, v2: 100, cl: 1500, de: 1500, acc: 1.4, dec: 1.0, size: 16, maxIas: 230 },
};

// Airlines: ICAO designator -> telephony and the pilot voice language used for accents.
const AIRLINES = {
  TVS: { tel: 'SKYTRAVEL', lang: 'cs', name: 'Smartwings' },
  RYR: { tel: 'RYANAIR', lang: 'en-IE', name: 'Ryanair' },
  EZY: { tel: 'EASY', lang: 'en-GB', name: 'easyJet UK' },
  EJU: { tel: 'ALPINE', lang: 'en-GB', name: 'easyJet Europe' },
  EZS: { tel: 'TOPSWISS', lang: 'de', name: 'easyJet Switzerland' },
  WZZ: { tel: 'WIZZ AIR', lang: 'hu', name: 'Wizz Air' },
  DLH: { tel: 'LUFTHANSA', lang: 'de', name: 'Lufthansa' },
  EWG: { tel: 'EUROWINGS', lang: 'de', name: 'Eurowings' },
  AFR: { tel: 'AIRFRANS', lang: 'fr', name: 'Air France' },
  KLM: { tel: 'KLM', lang: 'nl', name: 'KLM' },
  BAW: { tel: 'SPEEDBIRD', lang: 'en-GB', name: 'British Airways' },
  AUA: { tel: 'AUSTRIAN', lang: 'de', name: 'Austrian' },
  SWR: { tel: 'SWISS', lang: 'de', name: 'Swiss' },
  LOT: { tel: 'LOT', lang: 'pl', name: 'LOT' },
  VLG: { tel: 'VUELING', lang: 'es', name: 'Vueling' },
  ITY: { tel: 'ITARROW', lang: 'it', name: 'ITA Airways' },
  THY: { tel: 'TURKISH', lang: 'tr', name: 'Turkish Airlines' },
  UAE: { tel: 'EMIRATES', lang: 'en-AU', name: 'Emirates' },
  QTR: { tel: 'QATARI', lang: 'en-IN', name: 'Qatar Airways' },
  SAS: { tel: 'SCANDINAVIAN', lang: 'sv', name: 'SAS' },
  FIN: { tel: 'FINNAIR', lang: 'fi', name: 'Finnair' },
  TVF: { tel: 'FRANCE SOLEIL', lang: 'fr', name: 'Transavia France' },
  AEE: { tel: 'AEGEAN', lang: 'el', name: 'Aegean' },
  DAL: { tel: 'DELTA', lang: 'en-US', name: 'Delta' },
  EIN: { tel: 'SHAMROCK', lang: 'en-IE', name: 'Aer Lingus' },
  ROT: { tel: 'TAROM', lang: 'ro', name: 'TAROM' },
  CFG: { tel: 'CONDOR', lang: 'de', name: 'Condor' },
  BEL: { tel: 'BEELINE', lang: 'nl', name: 'Brussels Airlines' },
  ASL: { tel: 'AIR SERBIA', lang: 'sr', name: 'Air Serbia' },
};
const PHON = ['ALFA','BRAVO','CHARLIE','DELTA','ECHO','FOXTROT','GOLF','HOTEL','INDIA','JULIETT','KILO','LIMA','MIKE','NOVEMBER','OSCAR','PAPA','QUEBEC','ROMEO','SIERRA','TANGO','UNIFORM','VICTOR','WHISKEY','XRAY','YANKEE','ZULU'];
const DIGW = ['zero','one','two','three','four','five','six','seven','eight','niner'];

const Speak = {
  digits(n, len) { let s = String(Math.round(Math.abs(n))); if (len) s = s.padStart(len, '0'); return s.split('').map(c => DIGW[+c]).join(' '); },
  suffix(s) { // flight id like 35J -> "three five Juliett"
    return s.split('').map(c => /\d/.test(c) ? DIGW[+c] : (PHON[c.charCodeAt(0) - 65] || c).toLowerCase().replace(/^\w/, m => m.toUpperCase())).join(' ');
  },
  callsign(ac) { const al = AIRLINES[ac.cs.slice(0, 3)]; const tel = al ? al.tel : ac.cs.slice(0, 3); return `${tel[0]}${tel.slice(1).toLowerCase()} ${Speak.suffix(ac.cs.slice(3))}${ac.wtc === 'H' ? ' heavy' : ''}`; },
  thousands(ft) { // 4000 -> "four thousand", 3500 -> "three thousand five hundred"
    const th = Math.floor(ft / 1000), h = Math.round((ft % 1000) / 100);
    let s = th ? `${DIGW[th] === 'niner' ? 'nine' : DIGW[th]} thousand` : '';
    if (h) s += `${s ? ' ' : ''}${DIGW[h] === 'niner' ? 'nine' : DIGW[h]} hundred`;
    return s;
  },
  level(alt) { return alt >= D.ta + 500 ? `flight level ${Speak.digits(alt / 100)}` : `altitude ${Speak.thousands(alt)} feet`; },
  freq(f) { const [a, b] = f.split('.'); return `${Speak.digits(+a)} decimal ${b.split('').map(c => DIGW[+c]).join(' ')}`; },
  fix(n) { // VORs by name as pilots say them (OKL spelled phonetically), five-letter points as words
    if (n === 'OKL') return 'Oscar Kilo Lima';
    const nav = D.navaids && D.navaids[n]; if (nav && nav[4]) return nav[4][0] + nav[4].slice(1).toLowerCase();
    return n.length <= 3 ? n.split('').map(c => PHON[c.charCodeAt(0) - 65] || c).join(' ') : n[0] + n.slice(1).toLowerCase(); },
};

function fmtAlt(alt, ta = D.ta) {
  if (alt >= ta + 500) return String(Math.round(alt / 100)).padStart(3, '0');
  return 'A' + String(Math.round(alt / 100)).padStart(3, '0');
}
function fmtLevelShort(alt) { return alt >= D.ta + 500 ? 'FL' + String(Math.round(alt / 100)).padStart(3, '0') : (alt / 1000).toFixed(alt % 1000 ? 1 : 0) + ' tis. ft'; }
function hhmmss(sec) { sec = Math.floor(sec) % 86400; const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}
function toast(msg, ms = 2600) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
const Store = {
  ok: (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch (e) { return false; } })(),
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
