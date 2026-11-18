// Autenticação local por chave pública (sem serviços externos, sem base de dados).
//
// Identidade = par de chaves ECDSA P-256 criado no browser. O ID público é um hash
// da chave pública, por isso ninguém consegue "reclamar" um ID sem possuir a chave
// privada. No login o servidor envia um desafio aleatório e o cliente assina-o.
import { createPublicKey, verify, createHash, createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const ID_RE = /^[A-Z2-7]{20}$/;
export const AUTH_PREFIX = "wa-p2p-auth-v1:";

export function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** ID = base32(sha256("x.y")[0..13]) cortado a 20 chars (100 bits). Igual no cliente. */
export function idFromXY(x, y) {
  const h = createHash("sha256").update(`${x}.${y}`).digest();
  return base32(h.subarray(0, 13)).slice(0, 20);
}

export function newNonce() {
  return randomBytes(24).toString("base64url");
}

/**
 * Valida a prova de posse da chave.
 * @returns {string|null} o ID autenticado, ou null se inválido.
 */
export function verifyAuth({ nonce, jwk, signature } = {}) {
  try {
    if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
    if (typeof jwk.x !== "string" || typeof jwk.y !== "string") return null;
    if (jwk.x.length > 64 || jwk.y.length > 64 || typeof signature !== "string") return null;
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
    const ok = verify(
      "sha256",
      Buffer.from(AUTH_PREFIX + nonce),
      { key, dsaEncoding: "ieee-p1363" }, // formato produzido pelo WebCrypto
      Buffer.from(signature, "base64url")
    );
    return ok ? idFromXY(jwk.x, jwk.y) : null;
  } catch {
    return null;
  }
}

/**
 * Servidores ICE enviados ao cliente após o login.
 *  - ICE_SERVERS: JSON completo (opcional);
 *  - TURN_URLS + TURN_SECRET: credenciais temporárias estilo "TURN REST API"
 *    (coturn com use-auth-secret / static-auth-secret).
 */
export function iceServersFor(id, env = process.env, now = Date.now()) {
  if (env.ICE_SERVERS) {
    try { return JSON.parse(env.ICE_SERVERS); } catch { /* cai para o default */ }
  }
  const servers = [{ urls: (env.STUN_URLS || "stun:stun.l.google.com:19302").split(",").map((s) => s.trim()) }];
  if (env.TURN_URLS && env.TURN_SECRET) {
    const ttl = Number(env.TURN_TTL || 12 * 3600);
    const username = `${Math.floor(now / 1000) + ttl}:${id}`;
    const credential = createHmac("sha1", env.TURN_SECRET).update(username).digest("base64");
    servers.push({ urls: env.TURN_URLS.split(",").map((s) => s.trim()), username, credential });
  }
  return servers;
}

/** Validação de mensagens de chat (o servidor nunca confia no cliente). */
export function validMsg(from, to, msg) {
  if (!Array.isArray(to) || to.length < 1 || to.length > 50) return false;
  if (!to.every((t) => typeof t === "string" && ID_RE.test(t))) return false;
  if (!msg || typeof msg !== "object") return false;
  if (typeof msg.id !== "string" || !msg.id || msg.id.length > 64) return false;
  if (typeof msg.text !== "string" || msg.text.length > 8000) return false;
  if (!Number.isFinite(msg.ts) || msg.ts < 0) return false;
  if (msg.kind !== undefined && msg.kind !== "location") return false;
  if (msg.kind === "location" && !validLoc(msg.loc)) return false;
  if (msg.liveOf !== undefined && (typeof msg.liveOf !== "string" || !msg.liveOf || msg.liveOf.length > 64)) return false;
  if (msg.liveEnd !== undefined && typeof msg.liveEnd !== "boolean") return false;
  if (msg.until !== undefined && !Number.isFinite(msg.until)) return false;
  const p = msg.participants;
  if (!Array.isArray(p) || p.length < 2 || p.length > 51) return false;
  if (!p.every((x) => typeof x === "string" && ID_RE.test(x))) return false;
  return p.includes(from) && to.every((t) => p.includes(t));
}

/** Localização partilhada: coordenadas válidas, precisão e nome opcionais. */
export function validLoc(l) {
  if (!l || typeof l !== "object") return false;
  if (!Number.isFinite(l.lat) || l.lat < -90 || l.lat > 90) return false;
  if (!Number.isFinite(l.lng) || l.lng < -180 || l.lng > 180) return false;
  if (l.acc !== undefined && (!Number.isFinite(l.acc) || l.acc < 0 || l.acc > 1e7)) return false;
  if (l.name !== undefined && (typeof l.name !== "string" || l.name.length > 80)) return false;
  return true;
}
