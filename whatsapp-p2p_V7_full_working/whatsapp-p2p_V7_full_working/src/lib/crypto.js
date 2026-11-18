// Primitivas de identidade (WebCrypto). Sem dependências do browser além de `crypto.subtle`,
// por isso são testáveis em Node e partilham o formato com server/auth.js.
import { base32 } from "./format.js";

export const AUTH_PREFIX = "wa-p2p-auth-v1:";
const enc = new TextEncoder();

export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function idFromJwk(jwk) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${jwk.x}.${jwk.y}`)));
  return base32(h.subarray(0, 13)).slice(0, 20);
}

/** Gera um par ECDSA P-256 (a chave privada só é exportável dentro do dispositivo). */
export async function generateIdentityKeys() {
  // Extraível para poder entrar na cópia de segurança cifrada da conta (nunca sai do dispositivo em claro).
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  return { privateKey: kp.privateKey, publicJwk, id: await idFromJwk(publicJwk) };
}

export async function signNonce(privateKey, nonce) {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(AUTH_PREFIX + nonce));
  return b64url(new Uint8Array(sig));
}

export function fromB64url(str) {
  const b = atob(String(str).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (String(str).length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** Exporta a chave privada (JWK) para a cópia de segurança; falha se a chave for antiga e não exportável. */
export async function exportPrivateJwk(privateKey) {
  if (!privateKey.extractable) throw new Error("legacy-key");
  const j = await crypto.subtle.exportKey("jwk", privateKey);
  return { kty: j.kty, crv: j.crv, x: j.x, y: j.y, d: j.d };
}

/** Importa uma identidade guardada e confirma que o ID corresponde à chave pública. */
export async function importIdentity({ id, publicJwk, privateJwk }) {
  if ((await idFromJwk(publicJwk)) !== id) throw new Error("A cópia de segurança não corresponde à identidade.");
  const privateKey = await crypto.subtle.importKey("jwk", { ...privateJwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  return privateKey;
}
