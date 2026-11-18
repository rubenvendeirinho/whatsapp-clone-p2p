const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const ID_RE = /^[A-Z2-7]{20}$/;

export function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export const normalizeId = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z2-7]/g, "");
export const fmtId = (id) => id.match(/.{1,4}/g).join("-");
export const shortId = (id) => `${id.slice(0, 4)}…${id.slice(-4)}`;
export const convIdOf = (ids) => [...new Set(ids)].sort().join(",");
export const uid = () => crypto.randomUUID();
export const byTs = (a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1);

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
export function fmtDay(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(ts);
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
export function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
/** Nome de ficheiro seguro (sem caminhos nem caracteres de controlo). */
export function safeName(name) {
  return Array.from(String(name ?? "ficheiro"), (ch) =>
    ch === "/" || ch === "\\" || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? "_" : ch
  ).join("").slice(0, 200) || "ficheiro";
}
