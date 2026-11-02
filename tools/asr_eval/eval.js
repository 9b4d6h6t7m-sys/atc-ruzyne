// Score the game's parser on Whisper transcripts: callsign accuracy and full-transmission accuracy.
const { load } = require('./game'); const G = load(); const WORK = process.env.ATC_WORK || require('path').join(__dirname, '../../.work');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(__dirname + '/dataset.json', 'utf8'));
const pool = [...new Set(data.map(d => d.cs))].map(cs => ({ cs, alt: 9000, ias: 250, x: 0, y: 0 }));
const key = (c) => JSON.stringify(c, ['type', 'val', 'dir', 'fix', 'rwy', 'to']);
const voices = process.argv.slice(2);
for (const v of voices) {
  const hyp = JSON.parse(fs.readFileSync(`${WORK}/asr/eval/hyp_${v}.json`, 'utf8'));
  let csOk = 0, allOk = 0, cmdOk = 0, cmdN = 0, wrongAc = 0; const fails = [];
  for (const d of data) {
    const r = (process.env.OLD ? G.Parser : G.VoiceParser).parse(hyp[d.id] || '', pool);
    const okCs = r.ac && r.ac.cs === d.cs; if (okCs) csOk++; else if (r.ac) wrongAc++;
    const got = (r.cmds || []).map(key), exp = d.cmds.map(key);
    for (const e of exp) { cmdN++; if (okCs && got.includes(e)) cmdOk++; }
    const all = okCs && got.length === exp.length && exp.every(e => got.includes(e));
    if (all) allOk++; else if (fails.length < 400) fails.push({ id: d.id, say: d.say, hyp: hyp[d.id], got: r.ac ? r.ac.cs + ' ' + (r.cmds || []).map(G.cmdLabel).join(' ') : '-', exp: d.cs + ' ' + d.cmds.map(G.cmdLabel).join(' ') });
  }
  const n = data.length;
  console.log(`${v}: callsign ${Math.round(csOk / n * 100)} %, instructions ${Math.round(cmdOk / cmdN * 100)} %, whole transmission ${Math.round(allOk / n * 100)} %, wrong aircraft ${wrongAc}`);
  fs.writeFileSync(`${WORK}/asr/eval/fails_${v}.json`, JSON.stringify(fails, null, 1));
}
