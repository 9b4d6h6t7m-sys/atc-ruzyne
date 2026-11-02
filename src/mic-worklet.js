/* Microphone capture worklet (copied to docs/mic-worklet.js by tools/build.py).
   Collects the first input channel in blocks of 2048 frames and sends them to the main thread (transferred, no copy),
   with the block peak for the PTT level meter. 'flush' sends the partial block and then {flushed:true}. */
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048; this.buf = new Float32Array(this.size); this.n = 0; this.peak = 0;
    this.port.onmessage = (e) => { if (e.data === 'flush') { this.send(); this.port.postMessage({ flushed: true }); } };
  }
  send() {
    if (!this.n) return;
    const b = this.n === this.size ? this.buf : this.buf.slice(0, this.n);
    this.port.postMessage({ samples: b, peak: this.peak }, [b.buffer]);
    this.buf = new Float32Array(this.size); this.n = 0; this.peak = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) { const v = ch[i]; this.buf[this.n++] = v; const a = v < 0 ? -v : v; if (a > this.peak) this.peak = a; if (this.n === this.size) this.send(); }
    return true;
  }
}
registerProcessor('mic-capture', MicCapture);
