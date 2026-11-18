// Toque de chamada sintetizado (sem ficheiros de áudio), com volume e tom regulláveis.
// Os browsers só deixam tocar áudio depois de uma interação: unlockAudio() é chamado no
// primeiro clique/tecla para que o toque seja audível quando chega uma chamada.
let ctx = null, master = null, timer = null, current = null;
const settings = { volume: 0.7, tone: "classic", muted: false };

const gainFor = (v) => (settings.muted ? 0 : Math.pow(v, 1.6) * 0.5);   // curva suave; 1.0 = bem audível

function context() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = gainFor(settings.volume);
    master.connect(ctx.destination);
  }
  return ctx;
}

export function unlockAudio() {
  const c = context();
  if (c && c.state === "suspended") c.resume().catch(() => {});
  return !!c && c.state === "running";
}
export const audioBlocked = () => !!ctx && ctx.state !== "running";

export function installAudioUnlock() {
  const h = () => unlockAudio();
  for (const e of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(e, h, { passive: true });
  return () => { for (const e of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(e, h); };
}

export function configureRing(next) {
  Object.assign(settings, { volume: next.ringVolume ?? settings.volume, tone: next.ringTone ?? settings.tone, muted: next.ringMuted ?? settings.muted });
  if (master && ctx) master.gain.setTargetAtTime(gainFor(settings.volume), ctx.currentTime, 0.02);
}

function note(freq, start, dur, type = "sine", level = 1) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(level, start + 0.02);
  g.gain.setValueAtTime(level, start + Math.max(0.03, dur - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(master);
  o.start(start);
  o.stop(start + dur + 0.02);
}

// [duração do ciclo em ms, função que agenda as notas]
const TONES = {
  classic: { every: 3000, play: (t) => { for (const s of [0, 0.5]) { note(440, t + s, 0.4, "sine", 0.9); note(480, t + s, 0.4, "sine", 0.9); } } },
  soft:    { every: 2600, play: (t) => { [523.25, 659.25, 783.99].forEach((f, i) => note(f, t + i * 0.22, 0.5, "triangle", 0.8)); } },
  digital: { every: 2000, play: (t) => { for (let i = 0; i < 4; i++) note(i % 2 ? 1175 : 880, t + i * 0.15, 0.11, "square", 0.35); } },
};

/** @param {"in"|"out"} kind "in" = chamada recebida (toque); "out" = a chamar (tom de espera, mais discreto). */
export function startRing(kind = "in", opts) {
  stopRing();
  if (opts) configureRing(opts);
  const c = context();
  if (!c) return;
  c.resume?.().catch(() => {});
  const spec = kind === "in" ? TONES[settings.tone] ?? TONES.classic : { every: 3500, play: (t) => note(425, t, 1.0, "sine", 0.5) };
  const run = () => { if (ctx && ctx.state === "running") spec.play(ctx.currentTime + 0.02); };
  run();
  timer = setInterval(run, spec.every);
  current = kind;
}

export function stopRing() {
  clearInterval(timer);
  timer = null;
  current = null;
}

/** Pré-visualização do toque nas definições. */
export function previewRing(opts) {
  configureRing(opts);
  startRing("in");
  setTimeout(() => { if (current === "in") stopRing(); }, 3200);
}
