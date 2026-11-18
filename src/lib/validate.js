import { ID_RE, safeName } from "./format.js";

export const MAX_FILE = 20 * 1024 ** 3;          // limite de sanidade
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const PERSIST_MAX = 50 * 1024 * 1024;     // até aqui o ficheiro fica guardado para envio posterior

/** Valida/normaliza os metadados de uma oferta P2P vinda de outro utilizador (nunca confiar). */
export function validateMeta(meta, me, from) {
  if (!meta || typeof meta !== "object") return null;
  const { id, kind, size, mime, dur, peaks, participants } = meta;
  if (typeof id !== "string" || id.length > 64 || !id) return null;
  if (kind !== "voice" && kind !== "file") return null;
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE) return null;
  if (!Array.isArray(participants) || participants.length < 2 || participants.length > 51) return null;
  if (!participants.every((p) => typeof p === "string" && ID_RE.test(p))) return null;
  if (!participants.includes(me) || !participants.includes(from)) return null;
  const m = typeof mime === "string" ? mime.slice(0, 100) : "";
  if (kind === "voice" && (size > VOICE_MAX_BYTES || !m.startsWith("audio/"))) return null;
  return {
    id, kind, size, mime: m,
    name: kind === "voice" ? "Mensagem de voz" : safeName(meta.name),
    ts: Number.isFinite(meta.ts) ? Math.min(meta.ts, Date.now()) : Date.now(),
    dur: Number.isFinite(dur) ? Math.max(0, Math.min(dur, 3600)) : 0,
    peaks: Array.isArray(peaks) ? peaks.slice(0, 64).map((n) => Math.max(0, Math.min(1, Number(n) || 0))) : null,
    participants: [...new Set(participants)].sort(),
  };
}
