/* TTS worker (module worker, copied to docs/tts-worker.js by tools/build.py): pilot voices synthesised in the browser.
   Piper (VITS) voices from rhasspy/piper-voices at a pinned revision run on ONNX Runtime WASM (vendored standalone
   bundle); text -> IPA phonemes by espeak-ng (vendored phonemizer, WASM). A whole transmission is synthesised at once,
   so numbers and phrases get natural rhythm and intonation instead of the word-by-word voice packs.
   Model files are kept in the Cache API ("atc-tts-v1"; URLs carry the pinned revision, so entries never go stale).
   Messages in:
     {type:'load', model, url}                  url: model URL without extension (…/en_GB-vctk-medium)
     {type:'synth', id, model, url, text, speaker, lengthScale, espeak}
   Messages out:
     {type:'progress', model, loaded, total}    download progress of the .onnx file
     {type:'ready', model, ms, sampleRate}
     {type:'audio', id, samples, sampleRate, ms:{phon, infer}, phonemes}
     {type:'error', id?, model?, message} */
const VENDOR = 'vendor/transformers-4.3.2/';
const BASE = new URL('./', self.location.href);
const CACHE = 'atc-tts-v1';
let ort = null, phon = null, queue = Promise.resolve();
const models = {}, loading = {};
const post = (m, t) => self.postMessage(m, t || []);

async function libs() {
  if (!ort) {
    ort = await import(new URL(VENDOR + 'ort.wasm.bundle.min.mjs', BASE).href);
    ort.env.wasm.wasmPaths = { mjs: new URL(VENDOR + 'ort-wasm-simd-threaded.mjs', BASE).href, wasm: new URL(VENDOR + 'ort-wasm-simd-threaded.wasm', BASE).href };
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  }
  if (!phon) phon = await import(new URL(VENDOR + 'phonemizer.js', BASE).href);
}

async function fetchCached(url, onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { cache = null; }
  const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('/').pop()}`);
  const total = +res.headers.get('content-length') || 0; const parts = []; let loaded = 0;
  if (res.body && res.body.getReader) { const rd = res.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); loaded += value.length; if (onProgress) onProgress(loaded, total); } }
  else { const b = new Uint8Array(await res.arrayBuffer()); parts.push(b); loaded = b.length; }
  const buf = new Uint8Array(loaded); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  if (cache) { try { await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) {} }
  return buf;
}

function load(m) {
  if (models[m.model]) return Promise.resolve(models[m.model]);
  if (loading[m.model]) return loading[m.model];
  loading[m.model] = (async () => {
    const t0 = performance.now(); await libs();
    const cfg = JSON.parse(new TextDecoder().decode(await fetchCached(m.url + '.onnx.json')));
    const bytes = await fetchCached(m.url + '.onnx', (loaded, total) => post({ type: 'progress', model: m.model, loaded, total }));
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    models[m.model] = { cfg, session };
    post({ type: 'ready', model: m.model, ms: Math.round(performance.now() - t0), sampleRate: cfg.audio.sample_rate });
    return models[m.model];
  })().catch((e) => { delete loading[m.model]; throw e; });
  return loading[m.model];
}

/* Clauses keep their punctuation: Piper was trained on espeak output with "," and "." that shape pauses and intonation. */
async function phonemes(text, voice) {
  const parts = text.split(/([,.!?;:])/); let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i].trim(), punct = parts[i + 1] || '';
    if (clause) out += (out && !/ $/.test(out) ? ' ' : '') + (await phon.phonemize(clause, voice)).join(' ');
    if (punct && out) out += punct + ' ';
  }
  out = out.trim(); if (!/[.!?]$/.test(out)) out += '.';
  return out;
}
/* Piper's phonemes_to_ids: BOS, then each phoneme (NFD codepoints) followed by PAD, then EOS. */
function toIds(ph, map) {
  const ids = [...map['^']];
  for (const ch of ph.normalize('NFD')) { const v = map[ch]; if (!v) continue; ids.push(...v, ...map['_']); }
  ids.push(...map['$']); return ids;
}
/* Trim leading/trailing silence (keep 60 ms) and bring voiced RMS to the level of the voice packs. */
function finish(x, sr) {
  const F = Math.round(sr * 0.01), n = Math.floor(x.length / F); const e = new Float32Array(n); let mx = 0;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * F; j < (i + 1) * F; j++) s += x[j] * x[j]; e[i] = Math.sqrt(s / F); if (e[i] > mx) mx = e[i]; }
  const thr = mx * 0.03; let a = 0, b = n - 1; while (a < n && e[a] < thr) a++; while (b > a && e[b] < thr) b--;
  const s0 = Math.max(0, (a - 6) * F), s1 = Math.min(x.length, (b + 7) * F); const y = x.slice(s0, s1);
  let v = 0, cnt = 0; for (let i = a; i <= b; i++) if (e[i] > mx * 0.1) { v += e[i] * e[i]; cnt++; }
  const rms = cnt ? Math.sqrt(v / cnt) : mx; const g = Math.min(4, 0.13 / Math.max(rms, 1e-4));
  for (let i = 0; i < y.length; i++) y[i] = Math.max(-0.98, Math.min(0.98, y[i] * g));
  return y;
}

async function synth(m) {
  const md = await load(m);
  const t0 = performance.now(); const ph = await phonemes(m.text, m.espeak || md.cfg.espeak.voice);
  const ids = toIds(ph, md.cfg.phoneme_id_map); const t1 = performance.now(); const inf = md.cfg.inference || {};
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, (v) => BigInt(v)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([m.noise ?? inf.noise_scale ?? 0.667, m.lengthScale ?? inf.length_scale ?? 1, m.noiseW ?? inf.noise_w ?? 0.8]), [3]),
  };
  if (md.session.inputNames.includes('sid')) { const sid = typeof m.speaker === 'string' ? (md.cfg.speaker_id_map || {})[m.speaker] : m.speaker; feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(sid || 0)]), [1]); }
  const out = await md.session.run(feeds); const sr = md.cfg.audio.sample_rate;
  const samples = finish(out[md.session.outputNames[0]].data, sr);
  post({ type: 'audio', id: m.id, samples, sampleRate: sr, ms: { phon: Math.round(t1 - t0), infer: Math.round(performance.now() - t1) }, phonemes: ph }, [samples.buffer]);
}

self.onmessage = (e) => {
  const m = e.data; const fail = (err) => post({ type: 'error', id: m.id, model: m.model, message: String((err && err.message) || err) });
  if (m.type === 'load') { load(m).catch(fail); return; } // downloads run in parallel; a synthesis waits only for its own model
  queue = queue.then(() => synth(m)).catch(fail);
};
