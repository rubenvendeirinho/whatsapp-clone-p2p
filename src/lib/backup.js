// Cópia de segurança cifrada no cliente: PBKDF2 (palavra-passe de recuperação) + AES-GCM.
// O servidor só vê texto cifrado; sem a palavra-passe a cópia não pode ser lida.
import { b64url, fromB64url } from "./crypto.js";

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD = 8;
const enc = new TextEncoder(), dec = new TextDecoder();

export const newSalt = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

/** Chave AES-GCM derivada; não exportável, por isso pode ficar guardada no IndexedDB para cópias automáticas. */
export async function deriveBackupKey(password, saltB64) {
  const base = await crypto.subtle.importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64url(saltB64), iterations: PBKDF2_ITERATIONS },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

export async function encryptJson(key, saltB64, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value)));
  return { salt: saltB64, iv: b64url(iv), ct: b64url(new Uint8Array(ct)) };
}

export async function decryptJson(key, { iv, ct }) {
  try {
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, key, fromB64url(ct));
    return JSON.parse(dec.decode(buf));
  } catch {
    throw new Error("Palavra-passe de recuperação errada.");
  }
}
