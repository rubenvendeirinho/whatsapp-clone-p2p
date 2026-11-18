// Gravação de mensagens de voz (MediaRecorder + AnalyserNode para forma de onda).
const MIMES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
export const MAX_VOICE_MS = 5 * 60 * 1000;

export const pickMime = () => MIMES.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";

function downsample(levels, n) {
  if (!levels.length) return Array(n).fill(0.1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = Math.floor((i * levels.length) / n);
    const e = Math.max(s + 1, Math.floor(((i + 1) * levels.length) / n));
    let m = 0;
    for (let j = s; j < e && j < levels.length; j++) m = Math.max(m, levels[j]);
    out.push(m);
  }
  const mx = Math.max(...out, 0.05);
  return out.map((v) => Math.round(Math.min(1, v / mx) * 100) / 100);
}

export async function startRecording({ onLevel, onMax } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  const levels = [];
  const t0 = Date.now();
  let maxed = false;
  const iv = setInterval(() => {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
    const rms = Math.sqrt(sum / buf.length);
    levels.push(rms);
    onLevel?.(rms, Date.now() - t0);
    if (!maxed && Date.now() - t0 >= MAX_VOICE_MS) { maxed = true; onMax?.(); }
  }, 100);
  rec.start(250);

  const cleanup = () => {
    clearInterval(iv);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        cleanup();
        const type = rec.mimeType || mime || "audio/webm";
        resolve({ blob: new Blob(chunks, { type }), mime: type, dur: Math.round((Date.now() - t0) / 100) / 10, peaks: downsample(levels, 40) });
      };
      rec.stop();
    }),
    cancel() { rec.onstop = null; try { rec.stop(); } catch { /* já parado */ } cleanup(); },
  };
}
