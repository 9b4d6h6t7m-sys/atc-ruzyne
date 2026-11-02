// Transcribe the evaluation audio with the game's own ASR worker (docs/asr-worker.js: transformers.js Whisper)
// in headless Chromium, and write transcripts in the format eval.js scores.
// usage: node tools/asr_eval/browser.js <model> <voice>... [options]
//   model     tiny.en | base.en | small.en (onnx-community/whisper-<model>, revision pinned in src/voice.js)
//   --device wasm|webgpu   default wasm; webgpu runs on a SwiftShader (CPU) adapter here: correctness only, slow
//   --dtype q8|fp32|...    default: the game's choice for the device
//   --prompt               bias the decoder like the game does (callsigns on frequency, fixes)
//   --threads N            ONNX Runtime WASM threads (the page is cross-origin isolated here; GitHub Pages is not: 1)
//   --limit N              only the first N transmissions per voice
//   --remote               load the model from huggingface.co through the proxy (default: .work/models, see below)
//   --tag NAME             output name suffix
// Output: tools/asr_eval/hyp/tjs-whisper-<model><tag>_<voice>.json and timing in .work/eval/tjs-*.json.
// Models are fetched once with curl into .work/models/onnx-community/whisper-<model>/ (pinned revision).
// Score: HYP=tools/asr_eval/hyp/tjs-whisper-base.en_{v}.json node tools/asr_eval/eval.js gb us cz
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { load } = require('./game'); const G = load();
const ROOT = path.join(__dirname, '../..'), WORK = process.env.ATC_WORK || path.join(ROOT, '.work');
const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes(k);
const model = args[0]; const voices = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').match(/^--(device|dtype|threads|limit|tag)$/));
if (!model || !voices.length) { console.error('usage: node tools/asr_eval/browser.js <tiny.en|base.en|small.en> <voice>... [--prompt] [--device wasm] [--threads 4]'); process.exit(1); }

// Model catalogue shared with the game (src/voice.js): repo, pinned revision, dtypes per device.
const src = fs.readFileSync(path.join(ROOT, 'src/voice.js'), 'utf8');
const MODELS = JSON.parse(src.match(/const ASR_MODELS = (\{[\s\S]*?\n\});/)[1]);
const M = MODELS[model]; if (!M) { console.error('unknown model', model, Object.keys(MODELS)); process.exit(1); }
const device = opt('--device', 'wasm');
const dtype = opt('--dtype', null) ? { encoder_model: opt('--dtype'), decoder_model_merged: opt('--dtype') } : M.dtype[device];
const tag = (flag('--prompt') ? '-prompt' : '') + (opt('--tag', '') ? '-' + opt('--tag') : '');
const limit = +opt('--limit', 0) || Infinity, threads = +opt('--threads', 4);

// Local copy of the pinned model files (only what the chosen dtypes need).
const SUFFIX = { fp32: '', fp16: '_fp16', q8: '_quantized', int8: '_int8', uint8: '_uint8', q4: '_q4', q4f16: '_q4f16', bnb4: '_bnb4' };
const MDIR = path.join(WORK, 'models', M.repo);
if (!flag('--remote')) {
  const files = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
    `onnx/encoder_model${SUFFIX[dtype.encoder_model]}.onnx`, `onnx/decoder_model_merged${SUFFIX[dtype.decoder_model_merged]}.onnx`];
  const rev = fs.existsSync(path.join(MDIR, 'REVISION')) ? fs.readFileSync(path.join(MDIR, 'REVISION'), 'utf8').trim() : null;
  if (rev && rev !== M.revision) { console.error(`${MDIR} holds revision ${rev}, the game pins ${M.revision}: delete it`); process.exit(1); }
  for (const f of files) {
    const p = path.join(MDIR, f); if (fs.existsSync(p) && fs.statSync(p).size) continue;
    fs.mkdirSync(path.dirname(p), { recursive: true }); console.log('downloading', M.repo, f);
    execFileSync('curl', ['-fsSL', '-o', p, `https://huggingface.co/${M.repo}/resolve/${M.revision}/${f}`], { stdio: 'inherit' });
  }
  fs.writeFileSync(path.join(MDIR, 'REVISION'), M.revision + '\n');
}

// Static server: repo root + /models/ -> .work/models/. Cross-origin isolated so WASM can use threads.
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html', '.mp3': 'audio/mpeg', '.onnx': 'application/octet-stream' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/__eval.html') { res.writeHead(200, { 'content-type': 'text/html', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }); return res.end('<!doctype html><title>asr eval</title>'); }
  const file = u.startsWith('/models/') ? path.join(WORK, 'models', u.slice(8)) : path.join(ROOT, u);
  if (!file.startsWith(ROOT) && !file.startsWith(WORK)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, b) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-length': b.length, 'cross-origin-resource-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }); res.end(b);
  });
});

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'dataset.json'), 'utf8'));
// Realistic frequency for the prompt: the addressed aircraft and six others (deterministic per transmission).
const POOL = [...new Set(data.map(d => d.cs))];
function onFrequency(d, i) { let s = i * 7919 + 17; const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; const others = POOL.filter(c => c !== d.cs).sort(() => r() - 0.5).slice(0, 6); const all = [d.cs, ...others].sort(() => r() - 0.5); return all.map(cs => ({ cs, route: [] })); }

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const launch = flag('--remote') && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {};
  // WebGPU in headless Linux Chromium: SwiftShader (CPU) adapter. Checks correctness of the WebGPU path, not its speed.
  if (device === 'webgpu') launch.args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch(launch); const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text().slice(0, 300)); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(base + '/__eval.html');
  const ready = await page.evaluate(async ({ M, device, dtype, threads, remote }) => {
    window.w = new Worker('/docs/asr-worker.js', { type: 'module' });
    window.pending = {}; window.dl = {};
    w.onmessage = (e) => { const m = e.data; if (m.type === 'progress') { window.dl[m.file] = m; return; } const key = m.id !== undefined ? m.id : 'load'; const p = window.pending[key]; if (p) { delete window.pending[key]; p(m); } else if (m.type === 'error') console.error(JSON.stringify(m)); };
    const r = await new Promise((res) => { window.pending.load = res; w.postMessage({ type: 'load', model: M.repo, revision: M.revision, device, dtype, threads, localModelPath: remote ? null : '/models/' }); });
    return r;
  }, { M, device, dtype, threads, remote: flag('--remote') });
  if (ready.type !== 'ready') { console.error('load failed', ready); process.exit(1); }
  console.log('ready', JSON.stringify(ready));
  const fixes = ['ERASU', 'EVEMI', 'GOLOP', 'LOMKI', 'SOMIS', 'ARVEG', 'RATEV', 'APRAQ'];
  for (const v of voices) {
    const hyp = {}, timing = []; let n = 0; const t0 = Date.now();
    for (const [i, d] of data.entries()) {
      if (n++ >= limit) break;
      const prompt = flag('--prompt') ? G.VoiceParser.prompt(onFrequency(d, i), { fixes, rwy: '24' }) : null;
      const r = await page.evaluate(async ({ url, id, prompt }) => {
        const ab = await (await fetch(url)).arrayBuffer();
        const oc = new OfflineAudioContext(1, 16000, 16000); const buf = await oc.decodeAudioData(ab);
        const audio = buf.getChannelData(0).slice();
        return await new Promise((res) => { window.pending[id] = res; w.postMessage({ type: 'transcribe', id, audio, sampleRate: 16000, prompt }, [audio.buffer]); });
      }, { url: `/tools/asr_eval/audio/${v}/${d.id}.mp3`, id: d.id, prompt });
      if (r.type === 'error') { console.error(d.id, r.message); continue; }
      hyp[d.id] = r.text; timing.push({ id: d.id, ...r.ms, dur: r.speech.dur, kept: r.speech.kept, tokens: r.tokens });
      if (n <= 3 || n % 40 === 0) console.log(v, d.id, `${r.ms.total} ms`, JSON.stringify(r.text));
    }
    const out = path.join(__dirname, 'hyp', `tjs-whisper-${model}${tag}_${v}.json`);
    fs.writeFileSync(out, '{\n' + Object.entries(hyp).map(([k, t]) => `${JSON.stringify(k)}: ${JSON.stringify(t)}`).join(',\n') + '\n}\n');
    const tot = timing.map(t => t.total).sort((a, b) => a - b), med = tot[Math.floor(tot.length / 2)], p90 = tot[Math.floor(tot.length * 0.9)];
    const audioS = timing.reduce((a, t) => a + t.dur, 0);
    fs.mkdirSync(path.join(WORK, 'eval'), { recursive: true });
    fs.writeFileSync(path.join(WORK, 'eval', `tjs-whisper-${model}${tag}_${v}.timing.json`), JSON.stringify({ ready, timing }, null, 0));
    console.log(`${v}: ${timing.length} transcripts in ${((Date.now() - t0) / 1000).toFixed(0)} s, per transmission median ${med} ms, p90 ${p90} ms (audio ${(audioS / timing.length).toFixed(1)} s avg) -> ${path.relative(ROOT, out)}`);
  }
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
