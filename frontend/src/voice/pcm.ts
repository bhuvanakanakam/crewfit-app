const TARGET_RATE = 24000;

export function floatTo16BitPcm(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export function pcm16ToFloat(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const out = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let i = 0; i < out.length; i++) {
    out[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))];
  }
  return out;
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private next = 0;
  private phrase = 0;
  private sources: AudioBufferSourceNode[] = [];

  async ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  cancel() {
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.next = this.ctx?.currentTime ?? 0;
    this.phrase = 0;
  }

  /** Reset the played-so-far clock at the start of a reply. */
  startPhrase() {
    this.phrase = 0;
  }

  /** Milliseconds of this phrase that have actually come out of the speakers. */
  playedMs() {
    return Math.max(0, this.phrase * 1000 - this.queuedMs());
  }

  stop() {
    this.cancel();
    void this.ctx?.close();
    this.ctx = null;
  }

  queuedMs() {
    if (!this.ctx) return 0;
    return Math.max(0, (this.next - this.ctx.currentTime) * 1000);
  }

  async pushBase64(b64: string) {
    await this.pushPcm(fromBase64(b64));
  }

  async pushPcm(bytes: ArrayBuffer) {
    const ctx = await this.ensure();
    const pcm = pcm16ToFloat(bytes);
    if (pcm.length === 0) return;
    const buf = ctx.createBuffer(1, pcm.length, TARGET_RATE);
    buf.getChannelData(0).set(pcm);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const t = Math.max(ctx.currentTime, this.next);
    src.start(t);
    this.next = t + buf.duration;
    this.phrase += buf.duration;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
  }
}
