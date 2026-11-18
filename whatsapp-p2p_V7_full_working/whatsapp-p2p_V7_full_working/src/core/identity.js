import * as db from "./db.js";
import { generateIdentityKeys, idFromJwk } from "../lib/crypto.js";

/** Identidade local: { id, name, publicJwk, privateKey(CryptoKey), created } */
export async function loadIdentity() {
  const ident = await db.get("kv", "identity");
  if (!ident) return null;
  if ((await idFromJwk(ident.publicJwk)) !== ident.id) throw new Error("Identidade corrompida");
  return ident;
}

export async function createIdentity(name) {
  const { id, publicJwk, privateKey } = await generateIdentityKeys();
  const ident = { id, name: name.trim().slice(0, 40) || "Eu", publicJwk, privateKey, created: Date.now() };
  await db.put("kv", ident, "identity");
  return ident;
}

/** Terminar sessão: apaga identidade, contactos, conversas e definições deste dispositivo. */
export const clearLocalData = () => db.wipeAll();
