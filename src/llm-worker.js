/* LLM worker (module worker, copied to docs/llm-worker.js by tools/build.py): a small instruct model via the vendored
   transformers.js, WebGPU (q4f16) or WASM (q8). Used by the "AI piloti – měření" test to find out whether a model fits
   next to Whisper and the pilot voices on the device, and how fast it answers. First step towards AI pilots (P2).
   Messages in:  {type:'load', repo, revision, device, dtype, localModelPath?}, {type:'ask', id, messages, maxTokens}, {type:'dispose'}
   Messages out: {type:'progress', file, loaded, total, status}, {type:'ready', loadMs, warmMs, device, dtype},
                 {type:'answer', id, text, promptTokens, newTokens, ttft, tps, total}, {type:'error', id?, message} */
const VENDOR = 'vendor/transformers-4.3.2/';
const BASE = new URL('./', self.location.href);
let T = null, tok = null, model = null, queue = Promise.resolve();
const post = (m) => self.postMessage(m);
const now = () => performance.now();

async function lib() {
  if (T) return T;
  T = await import(new URL(VENDOR + 'transformers.min.js', BASE).href);
  const ua = navigator.userAgent || ''; const m = ua.match(/Version\/(\d+)/);
  const oldSafari = (navigator.vendor || '').includes('Apple') && !/CriOS|FxiOS|Chrome|Android/.test(ua) && !!m && +m[1] < 26;
  const sfx = oldSafari && !('gpu' in navigator) ? '' : '.asyncify';
  T.env.backends.onnx.wasm.wasmPaths = { mjs: new URL(`${VENDOR}ort-wasm-simd-threaded${sfx}.mjs`, BASE).href, wasm: new URL(`${VENDOR}ort-wasm-simd-threaded${sfx}.wasm`, BASE).href };
  T.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  return T;
}

async function load(m) {
  const t0 = now(); await lib();
  if (m.localModelPath) { T.env.allowLocalModels = true; T.env.localModelPath = m.localModelPath; T.env.allowRemoteModels = false; } // tests
  const progress = (p) => { if (p.status === 'progress' || p.status === 'done' || p.status === 'initiate') post({ type: 'progress', status: p.status, file: p.file, loaded: p.loaded || 0, total: p.total || 0 }); };
  if (model) { try { await model.dispose(); } catch (e) {} model = null; }
  tok = await T.AutoTokenizer.from_pretrained(m.repo, { revision: m.revision, progress_callback: progress });
  model = await T.AutoModelForCausalLM.from_pretrained(m.repo, { revision: m.revision, device: m.device, dtype: m.dtype, progress_callback: progress });
  const loadMs = now() - t0; const t1 = now();
  await generate([{ role: 'user', content: 'Say ready.' }], 2); // warm-up: allocations, WebGPU shaders
  post({ type: 'ready', loadMs: Math.round(loadMs), warmMs: Math.round(now() - t1), device: m.device, dtype: m.dtype });
}

async function generate(messages, maxTokens) {
  const inputs = tok.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, enable_thinking: false });
  const n0 = inputs.input_ids.dims[1]; let first = 0; const t0 = now();
  const streamer = new T.TextStreamer(tok, { skip_prompt: true, skip_special_tokens: true, callback_function: () => {}, token_callback_function: () => { if (!first) first = now(); } });
  const out = await model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, streamer });
  const t1 = now(); const ids = (out.sequences || out).tolist()[0].slice(n0).map(Number);
  const text = tok.decode(ids, { skip_special_tokens: true }).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { text, promptTokens: n0, newTokens: ids.length, ttft: Math.round((first || t1) - t0), tps: ids.length > 1 && first ? +((ids.length - 1) / ((t1 - first) / 1000)).toFixed(1) : 0, total: Math.round(t1 - t0) };
}

self.onmessage = (e) => {
  const m = e.data;
  queue = queue.then(async () => {
    try {
      if (m.type === 'load') await load(m);
      else if (m.type === 'ask') { if (!model) throw new Error('model not loaded'); post({ type: 'answer', id: m.id, ...(await generate(m.messages, m.maxTokens || 48)) }); }
      else if (m.type === 'dispose') { if (model) { await model.dispose(); model = null; } post({ type: 'disposed' }); }
    } catch (err) { post({ type: 'error', id: m.id, stage: m.type, message: String((err && err.message) || err) }); }
  });
};
