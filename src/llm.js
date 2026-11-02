'use strict';
/* AI pilots, step 1: measure small instruct models on the device (docs/llm-worker.js). The benchmark asks a pilot persona
   three non-standard questions and records load time, time to first token, tokens per second and the answers, so the
   model for AI pilots (P2) is chosen on the iPad's real numbers. A run that never finishes (Safari killed the page for
   memory) is detected at the next start through a flag in localStorage. */
const LLM_MODELS = {
  // WebGPU: q4f16 (needs shader-f16, else q4). WASM: q8 – the WASM build of ONNX Runtime lacks GatherBlockQuantized (4-bit embeddings).
  'lfm2-350m': { label: 'LFM2 350M', repo: 'onnx-community/LFM2-350M-ONNX', revision: 'ecc51d35a7edbc8f9ef6d23b59a5f036dcfc7ee8', mb: { webgpu: 255, wasm: 510 } },
  'qwen3-0.6b': { label: 'Qwen3 0.6B', repo: 'onnx-community/Qwen3-0.6B-ONNX', revision: '58ca03a5e7b354b480b1a82b34bde8dc7b854cc0', mb: { webgpu: 570, wasm: 618 } },
  'gemma3-1b': { label: 'Gemma 3 1B', repo: 'onnx-community/gemma-3-1b-it-ONNX', revision: 'a58439f40017d3b99c7d378ff525e54e0ba08ebf', mb: { webgpu: 763, wasm: 1526 } },
  'lfm2-1.2b': { label: 'LFM2 1.2B', repo: 'onnx-community/LFM2-1.2B-ONNX', revision: 'dd095948cf23919ef2fcb635a156ce59975f35ff', mb: { webgpu: 760, wasm: 1521 } },
};
/* Facts the answers can be checked against (the sim will supply them for real pilots). */
const LLM_PERSONA = 'You are the captain of Air France 1083, an Airbus A320 from Paris Charles de Gaulle to Prague, descending to flight level 110 on the GOLOP arrival. ' +
  'There are 152 persons on board. Fuel endurance is 2 hours 10 minutes. Reply to the controller with one short radio transmission in standard ICAO phraseology, ' +
  'using only these facts, and end it with your callsign "Air France 1083". No explanations.';
const LLM_QUESTIONS = [
  { q: 'Air France 1083, how many persons on board?', expect: /\b152\b|one five two/i },
  { q: 'Air France 1083, say fuel endurance.', expect: /\b2\b.*\b10\b|two hours? (and )?ten|2:10|two one zero/i },
  { q: 'Air France 1083, say your destination.', expect: /prague|praha|lkpr/i },
];

const LLMBench = {
  worker: null, state: 'off', key: Store.get('atc.llm.model', 'lfm2-350m'), files: {}, pending: {}, seq: 0, info: null, err: '',
  results: Store.get('atc.llm.results', []) || [], crashed: null, localModelPath: null, device: null, // tests: local model path, forced device
  setKey(k) { this.key = k; Store.set('atc.llm.model', k); App.emit('llm'); },
  progress() { let l = 0, t = 0; for (const f of Object.values(this.files)) { l += f.loaded; t += f.total; } return t ? l / t : 0; },
  spawn() {
    if (this.worker) this.worker.terminate();
    this.worker = new Worker(ASSET['llm-worker.js'], { type: 'module' });
    this.worker.onmessage = (e) => this.onmsg(e.data);
    this.worker.onerror = (e) => { for (const k of Object.keys(this.pending)) { this.pending[k].rej(new Error('worker: ' + ((e && e.message) || 'chyba'))); delete this.pending[k]; } };
  },
  onmsg(m) {
    if (m.type === 'progress') { if (m.file) { const f = this.files[m.file] || (this.files[m.file] = { loaded: 0, total: 0 }); if (m.total) f.total = m.total; f.loaded = m.status === 'done' ? f.total : Math.max(f.loaded, m.loaded); } App.emit('llmProgress'); return; }
    const key = m.id !== undefined ? m.id : m.type === 'disposed' ? 'dispose' : 'load'; const p = this.pending[key]; if (!p) return; delete this.pending[key];
    if (m.type === 'error') p.rej(new Error(m.message)); else p.res(m);
  },
  call(msg, key, ms) { return new Promise((res, rej) => { const t = setTimeout(() => { delete this.pending[key]; rej(new Error('timeout')); }, ms); this.pending[key] = { res: (m) => { clearTimeout(t); res(m); }, rej: (e) => { clearTimeout(t); rej(e); } }; this.worker.postMessage(msg); }); },
  /* Load the selected model, ask the three questions, store the result (also across restarts). */
  async run() {
    if (this.state === 'loading' || this.state === 'running') return;
    const M = LLM_MODELS[this.key]; const gpu = await ASR.probeGpu();
    const device = this.device || (gpu.ok ? 'webgpu' : 'wasm'), dtype = device === 'webgpu' ? (gpu.f16 ? 'q4f16' : 'q4') : 'q8';
    const rec = { model: this.key, device, dtype, whisper: ASR.state === 'ready' ? `${ASR.model} ${ASR.device}` : 'ne', tts: Object.keys(PilotTTS.models).filter(k => PilotTTS.models[k].state === 'ready').join('+') || 'ne', t: new Date().toISOString().slice(0, 16), answers: [] };
    Store.set('atc.llm.running', rec); // cleared on success: if Safari kills the page, the next start reports it
    Object.assign(this, { state: 'loading', files: {}, err: '', info: null }); App.emit('llm');
    try {
      this.spawn(); this.info = await this.call({ type: 'load', repo: M.repo, revision: M.revision, device, dtype, localModelPath: this.localModelPath }, 'load', 20 * 60000);
      Object.assign(rec, { loadMs: this.info.loadMs, warmMs: this.info.warmMs }); this.state = 'running'; App.emit('llm');
      for (const { q, expect } of LLM_QUESTIONS) {
        const id = ++this.seq; const a = await this.call({ type: 'ask', id, maxTokens: 48, messages: [{ role: 'system', content: LLM_PERSONA }, { role: 'user', content: q }] }, id, 120000);
        rec.answers.push({ q, text: a.text, ok: expect.test(a.text), ttft: a.ttft, tps: a.tps, total: a.total, tokens: a.newTokens }); App.emit('llm');
      }
      this.state = 'ready';
    } catch (e) { this.state = 'error'; this.err = e.message; rec.err = e.message; }
    Store.set('atc.llm.running', null);
    this.results.unshift(rec); this.results.length = Math.min(this.results.length, 8); Store.set('atc.llm.results', this.results); App.emit('llm');
    return rec;
  },
  async unload() { if (!this.worker) return; try { await this.call({ type: 'dispose' }, 'dispose', 30000); } catch (e) {} this.worker.terminate(); this.worker = null; this.state = 'off'; App.emit('llm'); },
  /* At start: a benchmark flag left behind means the page died during that run. */
  checkCrash() { const r = Store.get('atc.llm.running', null); if (r) { this.crashed = r; r.err = 'stránka spadla během měření (pravděpodobně došla paměť)'; this.results.unshift(r); this.results.length = Math.min(this.results.length, 8); Store.set('atc.llm.results', this.results); Store.set('atc.llm.running', null); } },
  line(r) {
    const a = r.answers || []; const med = (k) => { const v = a.map(x => x[k]).filter(x => x).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
    return `${(LLM_MODELS[r.model] || {}).label || r.model} ${r.device} ${r.dtype}: ${r.err ? 'CHYBA ' + r.err : `načtení ${(r.loadMs / 1000).toFixed(1)} s, zahřátí ${(r.warmMs / 1000).toFixed(1)} s, první token ${med('ttft')} ms, ${med('tps')} tok/s, správně ${a.filter(x => x.ok).length}/${a.length}`} (Whisper ${r.whisper}, hlasy ${r.tts}, ${r.t})`;
  },
};
