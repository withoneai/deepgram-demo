// Mic -> 16 kHz linear16 chunks of ~50 ms, posted to the main thread.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.out = new Int16Array(800);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Simple decimation with averaging; plenty for speech.
    while (this.pos < ch.length) {
      const start = Math.floor(this.pos);
      const end = Math.min(Math.floor(this.pos + this.ratio), ch.length);
      let sum = 0;
      for (let i = start; i < Math.max(end, start + 1); i++) sum += ch[i];
      const s = Math.max(-1, Math.min(1, sum / Math.max(end - start, 1)));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) {
        let peak = 0;
        for (let i = 0; i < this.n; i++) peak = Math.max(peak, Math.abs(this.out[i]));
        this.port.postMessage({ pcm: this.out.buffer.slice(0), level: peak / 0x7fff });
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor("pcm-worklet", PcmWorklet);
