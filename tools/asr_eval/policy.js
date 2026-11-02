// Radio policy on recognised transcripts: how many transmissions would be executed correctly, executed wrongly
// (wrong aircraft or wrong/missing instruction, the trainee has to catch it in the readback) or answered "say again",
// for a range of confidence thresholds (Voice.minConf in src/voice.js).
// usage: node tools/asr_eval/policy.js <hyp pattern with {v}>... [--voices gb,us,cz]
//   e.g. node tools/asr_eval/policy.js tools/asr_eval/hyp/whisper-base.en_{v}.json tools/asr_eval/hyp/tjs-whisper-base.en_{v}.json
const { load } = require('./game'); const G = load();
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2); const vi = args.indexOf('--voices');
const voices = vi >= 0 ? args[vi + 1].split(',') : ['gb', 'us', 'cz'];
const pats = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--voices');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'dataset.json'), 'utf8'));
const pool = [...new Set(data.map(d => d.cs))].map(cs => ({ cs, alt: 9000, ias: 250, x: 0, y: 0 }));
const key = (c) => JSON.stringify(c, ['type', 'val', 'dir', 'fix', 'rwy', 'to']);
const TH = [0, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
for (const pat of pats) {
  const rows = [];
  for (const v of voices) {
    const f = pat.replace('{v}', v); if (!fs.existsSync(f)) continue;
    const hyp = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const d of data) {
      const r = G.VoiceParser.parse(hyp[d.id] || '', pool);
      const exp = d.cmds.map(key), got = (r.cmds || []).map(key);
      const ok = r.ac && r.ac.cs === d.cs && got.length === exp.length && exp.every(e => got.includes(e));
      rows.push({ v, executable: !!(r.ac && r.cmds && r.cmds.length), conf: r.conf || 0, ok, wrongAc: !!(r.ac && r.ac.cs !== d.cs) });
    }
  }
  if (!rows.length) continue;
  console.log(`\n${pat}  (${rows.length} transmissions, ${voices.join(' ')})`);
  console.log('minConf  executed ok  executed wrong (wrong aircraft)  say again / no response');
  for (const t of TH) {
    const ex = rows.filter(r => r.executable && r.conf >= t), ok = ex.filter(r => r.ok).length, bad = ex.length - ok, wa = ex.filter(r => r.wrongAc).length;
    const pc = (n) => `${String(Math.round(n / rows.length * 100)).padStart(3)} %`;
    console.log(`  ${t.toFixed(2)}   ${pc(ok)}          ${pc(bad)} (${String(wa).padStart(2)})                  ${pc(rows.length - ex.length)}`);
  }
}
