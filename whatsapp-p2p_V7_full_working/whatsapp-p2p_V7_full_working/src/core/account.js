// Conta por email: cópia de segurança cifrada (perfil, contactos, bloqueados, definições e chave)
// guardada no servidor para poder reabrir a mesma identidade noutro dispositivo.
import * as db from "./db.js";
import { exportPrivateJwk, importIdentity } from "../lib/crypto.js";
import { deriveBackupKey, decryptJson, encryptJson, newSalt, MIN_PASSWORD } from "../lib/backup.js";
import { cleanSettings } from "../lib/settings.js";
import { ID_RE } from "../lib/format.js";

export { MIN_PASSWORD };

const ERRORS = {
  "email-invalido": "Email inválido.",
  aguarde: "Aguarde cerca de 45 segundos antes de pedir outro código.",
  limite: "Demasiados pedidos. Tente mais tarde.",
  "envio-falhou": "Não foi possível enviar o email. Verifique a configuração do Gmail no servidor.",
  "codigo-invalido": "Código errado ou expirado.",
  "sem-conta": "Não existe conta com este email.",
  "ja-tem-conta": "Esta identidade já está ligada a outro email. Remova a conta primeiro.",
  "email-em-uso": "Este email já pertence a outra identidade. Use «Entrar com email» num dispositivo novo.",
  "copia-invalida": "A cópia de segurança é inválida ou grande demais.",
  "legacy-key": "Esta identidade foi criada numa versão antiga e a chave não pode ser guardada. Termine a sessão, crie uma identidade nova e ative a conta.",
};
export const accountError = (code) => ERRORS[code] ?? "Ocorreu um erro. Tente novamente.";

async function post(route, body) {
  let res;
  try {
    res = await fetch(`/api/account/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    });
  } catch { throw new Error("Servidor inacessível."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(accountError(data.error));
  return data;
}

/** Pede um código por email. Devolve "sent" ou "console" (Gmail não configurado: código no terminal do servidor). */
export const sendCode = (email) => post("send-code", { email }).then((d) => d.mode);

/** Reúne tudo o que entra na cópia de segurança. */
export async function collectBackup(identity) {
  const [contacts, blocked, settings] = await Promise.all([db.all("contacts"), db.get("kv", "blocked"), db.get("kv", "settings")]);
  return {
    v: 1,
    ts: Date.now(),
    identity: { id: identity.id, name: identity.name, publicJwk: identity.publicJwk, privateJwk: await exportPrivateJwk(identity.privateKey) },
    contacts: contacts.map((c) => ({ id: c.id, name: c.name })),
    blocked: Array.isArray(blocked) ? blocked : [],
    settings: cleanSettings(settings),
  };
}

/** Liga o email à identidade (no servidor) e guarda a primeira cópia cifrada. */
export async function linkAccount({ net, identity, email, code, password }) {
  if (String(password).length < MIN_PASSWORD) throw new Error(`A palavra-passe de recuperação precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
  let payload;
  try { payload = await collectBackup(identity); }
  catch (e) { throw new Error(accountError(e.message === "legacy-key" ? "legacy-key" : "copia-invalida")); }
  const salt = newSalt();
  const key = await deriveBackupKey(password, salt);
  const backup = await encryptJson(key, salt, payload);
  const res = await net.request("acct:link", { email, code, backup });
  if (!res?.ok) throw new Error(accountError(res?.error));
  const acct = { email: email.trim().toLowerCase(), salt, key, ts: res.ts };
  await db.put("kv", acct, "account");
  return acct;
}

export const loadAccount = () => db.get("kv", "account");

/** Cópia automática com a chave já derivada (a palavra-passe não fica guardada). */
export async function backupNow({ net, identity }) {
  const acct = await db.get("kv", "account");
  if (!acct) return null;
  const backup = await encryptJson(acct.key, acct.salt, await collectBackup(identity));
  const res = await net.request("acct:backup", { backup });
  if (!res?.ok) throw new Error(accountError(res?.error));
  const next = { ...acct, ts: res.ts };
  await db.put("kv", next, "account");
  return next;
}

export async function unlinkAccount({ net }) {
  const res = await net.request("acct:unlink", {});
  if (!res?.ok) throw new Error(accountError(res?.error));
  await db.del("kv", "account");
}

/** Novo dispositivo, passo 1: valida o código e devolve a cópia cifrada. */
export async function fetchBackup(email, code) {
  const d = await post("restore", { email, code });
  return { email: email.trim().toLowerCase(), id: d.id, backup: d.backup };
}

/** Novo dispositivo, passo 2: decifra com a palavra-passe e repõe identidade, contactos e definições. */
export async function restoreFromBackup({ email, id, backup }, password) {
  const key = await deriveBackupKey(password, backup.salt);
  const data = await decryptJson(key, backup);
  const idn = data?.identity;
  if (!idn || idn.id !== id || !data || data.v !== 1) throw new Error("Cópia de segurança inválida.");
  const privateKey = await importIdentity({ id: idn.id, publicJwk: idn.publicJwk, privateJwk: idn.privateJwk });
  const identity = { id: idn.id, name: String(idn.name || "Eu").slice(0, 40), publicJwk: idn.publicJwk, privateKey, created: Date.now() };
  await db.wipeAll();
  await db.put("kv", identity, "identity");
  for (const c of data.contacts ?? []) {
    if (typeof c?.id === "string" && ID_RE.test(c.id) && c.id !== idn.id) {
      await db.put("contacts", { id: c.id, name: String(c.name ?? "").slice(0, 40) || "Contacto" });
    }
  }
  await db.put("kv", (data.blocked ?? []).filter((b) => typeof b === "string" && ID_RE.test(b)), "blocked");
  await db.put("kv", cleanSettings(data.settings), "settings");
  await db.put("kv", { email, salt: backup.salt, key, ts: Date.now() }, "account");
  return identity;
}
