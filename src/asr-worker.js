/* ASR worker (module worker, copied to docs/asr-worker.js by tools/build.py).
   Whisper via the vendored transformers.js: WebGPU when available, WASM otherwise; models come from the
   Hugging Face hub at a pinned revision and stay in the browser cache (Cache API, key "transformers-cache").
   Messages in:
     {type:'load', model, revision, device:'webgpu'|'wasm', dtype, threads?, wasmVariant?, localModelPath?}
     {type:'transcribe', id, audio:Float32Array, sampleRate, prompt?, maxTokens?}
   Messages out:
     {type:'progress', file, loaded, total, status}   download progress per file
     {type:'ready', ...}                               model loaded and warmed up (timings, backend details)
     {type:'result', id, text, ms, speech}             transcript (text '' when the recording holds no speech)
     {type:'error', id?, stage, message}
   Audio is resampled to 16 kHz and trimmed to the spoken part here, so the main thread stays free. */
const VENDOR = 'vendor/transformers-4.3.2/';
const BASE = new URL('./', self.location.href);
let T = null, processor = null, tokenizer = null, model = null, info = null, queue = Promise.resolve();
const post = (m) => self.postMessage(m);
const now = () => performance.now();

function safariBelow26() { // same rule transformers.js uses to pick the ONNX Runtime WASM build
  const ua = navigator.userAgent || '';
  const safari = (navigator.vendor || '').includes('Apple') && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/.test(ua);
  const m = ua.match(/Version\/(\d+)/); return safari && !!m && +m[1] < 26;
}

async function lib(o) {
  if (T) return T;
  T = await import(new URL(VENDOR + 'transformers.min.js', BASE).href);
  const plain = o.wasmVariant === 'plain' || (o.wasmVariant !== 'asyncify' && safariBelow26() && !('gpu' in navigator));
  const sfx = plain ? '' : '.asyncify';
  const onnx = T.env.backends.onnx;
  onnx.wasm.wasmPaths = { mjs: new URL(`${VENDOR}ort-wasm-simd-threaded${sfx}.mjs`, BASE).href, wasm: new URL(`${VENDOR}ort-wasm-simd-threaded${sfx}.wasm`, BASE).href };
  onnx.wasm.numThreads = o.threads || (self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1);
  if (o.localModelPath) { T.env.allowLocalModels = true; T.env.localModelPath = o.localModelPath; T.env.allowRemoteModels = !!o.allowRemote; }
  info = { variant: plain ? 'plain' : 'asyncify', threads: onnx.wasm.numThreads, isolated: !!self.crossOriginIsolated, version: T.env.version };
  return T;
}

async function load(o) {
  const t0 = now(); await lib(o);
  const progress = (p) => { if (p.status === 'progress' || p.status === 'done' || p.status === 'initiate') post({ type: 'progress', status: p.status, file: p.file, loaded: p.loaded || 0, total: p.total || 0 }); };
  const opts = { revision: o.revision || 'main', progress_callback: progress };
  if (model) { try { await model.dispose(); } catch (e) {} model = null; }
  processor = await T.AutoProcessor.from_pretrained(o.model, opts);
  tokenizer = processor.tokenizer;
  model = await T.WhisperForConditionalGeneration.from_pretrained(o.model, { ...opts, device: o.device, dtype: o.dtype });
  const loadMs = now() - t0;
  const t1 = now(); await run(new Float32Array(16000), null, 8); // warm-up: allocations, WebGPU shader compilation
  info = { ...info, model: o.model, device: o.device, dtype: o.dtype, loadMs: Math.round(loadMs), warmMs: Math.round(now() - t1),
    sot: tokenizer.convert_tokens_to_ids('<|startoftranscript|>'), prev: tokenizer.convert_tokens_to_ids('<|startofprev|>') };
  post({ type: 'ready', ...info });
}

/* Whisper decoder prompt: <|startofprev|> context <|startoftranscript|> <|notimestamps|>. The context biases the decoder
   towards the given words (callsigns on frequency, fixes). VoiceParser.prompt stays near 110 tokens; 200 is a safety cap
   (Whisper allows 223; prompt + 96 new tokens stay below the 448-token decoder limit). */
function initTokens(prompt) {
  const g = model.generation_config;
  const init = [g.decoder_start_token_id]; if (g.no_timestamps_token_id) init.push(g.no_timestamps_token_id);
  if (!prompt) return init;
  const ids = tokenizer.encode(' ' + prompt.trim(), { add_special_tokens: false }).slice(-200);
  return [tokenizer.convert_tokens_to_ids('<|startofprev|>'), ...ids, ...init];
}

/* Log-mel features as WhisperFeatureExtractor computes them for audio zero-padded to 30 s, but only over the real
   length plus 0.5 s of zeros: every frame further on is silence, whose normalised value is (max - 2) (log10 floor
   -10 clamped to max - 8, then (x + 4) / 4), so it is filled in directly. Identical output, 4-8x less work. */
async function features(audio) {
  const fe = processor.feature_extractor, F = fe.config.nb_max_frames, hop = fe.config.hop_length;
  if (audio.length > fe.config.n_samples - 8000) return (await processor(audio)).input_features;
  const w = new Float32Array(Math.ceil((audio.length + 8000) / hop) * hop); w.set(audio);
  const f = await fe._extract_fbank_features(w); const [M, n] = f.dims; let mx = -Infinity; for (const v of f.data) if (v > mx) mx = v;
  const data = new Float32Array(M * F).fill(Math.max(mx - 2, -1.5));
  for (let m = 0; m < M; m++) data.set(f.data.subarray(m * n, m * n + Math.min(n, F)), m * F);
  return new T.Tensor('float32', data, [1, M, F]);
}

async function run(audio, prompt, maxTokens) {
  const tA = now(); const input_features = await features(audio);
  const tB = now(), feat = tB - tA; const init = initTokens(prompt);
  const out = await model.generate({ inputs: input_features, decoder_input_ids: init, max_new_tokens: maxTokens || 96, num_beams: 1, do_sample: false });
  const seq = (out.sequences || out).tolist()[0].map(Number);
  const text = tokenizer.decode(seq.slice(init.length), { skip_special_tokens: true }).trim();
  return { text, feat, gen: now() - tB, tokens: seq.length - init.length };
}

/* Linear-phase low-pass (windowed sinc) then fractional resampling to 16 kHz. */
function to16k(x, sr) {
  if (sr === 16000) return x;
  const ratio = sr / 16000, fc = 0.92 * 8000 / sr, half = 24, taps = new Float32Array(2 * half + 1); let sum = 0;
  for (let i = -half; i <= half; i++) { const w = 0.42 + 0.5 * Math.cos(Math.PI * i / half) + 0.08 * Math.cos(2 * Math.PI * i / half); const s = i === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * i) / (Math.PI * i); taps[i + half] = s * w; sum += s * w; }
  for (let i = 0; i < taps.length; i++) taps[i] /= sum;
  const n = Math.floor(x.length / ratio), y = new Float32Array(n);
  const f = (k) => { let acc = 0; for (let j = -half; j <= half; j++) { const idx = k + j; if (idx >= 0 && idx < x.length) acc += x[idx] * taps[j + half]; } return acc; };
  for (let i = 0; i < n; i++) { const p = i * ratio, k = Math.floor(p), fr = p - k; y[i] = fr ? f(k) * (1 - fr) + f(k + 1) * fr : f(k); }
  return y;
}

/* Keep the spoken part: 20 ms frames, threshold from the noise floor (quietest frames) and the loudest frame. */
function trim(x) {
  const F = 320, n = Math.floor(x.length / F); if (n < 5) return { audio: x, speech: false, peak: 0, floor: 0 };
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) { let e = 0; for (let j = i * F; j < (i + 1) * F; j++) e += x[j] * x[j]; db[i] = 10 * Math.log10(e / F + 1e-10); }
  const sorted = Array.from(db).sort((a, b) => a - b); const floor = sorted[Math.floor(n * 0.1)], peak = sorted[n - 1];
  const thr = Math.max(floor + 10, peak - 35, -55);
  let a = -1, b = -1, voiced = 0;
  for (let i = 0; i < n; i++) if (db[i] > thr) { if (a < 0) a = i; b = i; voiced++; }
  if (peak > -30 && peak - floor <= 12) return { audio: x, speech: true, peak, floor }; // loud from press to release (no pause to measure the floor): keep all
  const speech = peak > -50 && peak - floor > 12 && voiced >= 8; // at least 160 ms clearly above the noise floor
  if (!speech) return { audio: x, speech: false, peak, floor };
  const s = Math.max(0, (a - 15) * F), e = Math.min(x.length, (b + 1 + 20) * F); // 300 ms before, 400 ms after
  return { audio: x.subarray(s, e), speech: true, peak, floor, start: s / 16000, end: e / 16000 };
}

async function transcribe(m) {
  const t0 = now(); let x = m.audio; if (x.length > m.sampleRate * 30) x = x.subarray(0, m.sampleRate * 30); // Whisper window: 30 s
  x = to16k(x, m.sampleRate); const tr = trim(x); const pre = now() - t0;
  const speech = { dur: +(x.length / 16000).toFixed(2), kept: +(tr.audio.length / 16000).toFixed(2), peak: Math.round(tr.peak), floor: Math.round(tr.floor), voiced: tr.speech };
  if (!tr.speech && !m.noTrim) { post({ type: 'result', id: m.id, text: '', empty: 'silence', ms: { pre: Math.round(pre), total: Math.round(now() - t0) }, speech }); return; }
  const r = await run(m.noTrim ? x : tr.audio, m.prompt, m.maxTokens);
  post({ type: 'result', id: m.id, text: r.text, tokens: r.tokens, ms: { pre: Math.round(pre), feat: Math.round(r.feat), gen: Math.round(r.gen), total: Math.round(now() - t0) }, speech });
}

self.onmessage = (e) => {
  const m = e.data;
  queue = queue.then(async () => {
    try {
      if (m.type === 'load') await load(m);
      else if (m.type === 'transcribe') { if (!model) throw new Error('model not loaded'); await transcribe(m); }
    } catch (err) { post({ type: 'error', id: m.id, stage: m.type, message: String((err && err.message) || err) }); }
  });
};
