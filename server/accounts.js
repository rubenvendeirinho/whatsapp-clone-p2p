// Contas por email (opcionais). O servidor guarda apenas:
//   email -> { id (identidade), backup cifrado no cliente }
// A cópia de segurança é cifrada no browser com uma palavra-passe de recuperação que o
// servidor nunca recebe; o código por email só prova que a pessoa controla o email.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomInt, randomBytes, timingSafeEqual } from "node:crypto";

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export const CODE_TTL = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const MAX_BACKUP_CHARS = 90_000;

export const normEmail = (e) => String(e ?? "").trim().toLowerCase().slice(0, 254);

const sha = (s) => createHash("sha256").update(s).digest();

/** Valida o formato do envelope cifrado (o servidor não consegue ler o conteúdo). */
export function validBackup(b) {
  return !!b && typeof b === "object" && typeof b.salt === "string" && typeof b.iv === "string" && typeof b.ct === "string"
    && b.salt.length > 8 && b.salt.length < 100 && b.iv.length < 100 && b.ct.length > 0
    && b.salt.length + b.iv.length + b.ct.length < MAX_BACKUP_CHARS;
}

export class Accounts {
  /** @param {string|null} file ficheiro JSON (null = só memória, útil em testes) */
  constructor(file, now = () => Date.now()) {
    this.file = file;
    this.now = now;
    this.byEmail = new Map();                 // email -> { email, id, backup, ts, created }
    this.codes = new Map();                   // email -> { hash, salt, exp, tries, last }
    this.sendLog = new Map();                 // chave (email|ip) -> [timestamps]
    if (file && fs.existsSync(file)) {
      try {
        for (const a of JSON.parse(fs.readFileSync(file, "utf8")).accounts ?? []) this.byEmail.set(a.email, a);
      } catch (e) { console.error("[contas] ficheiro ilegível, a começar vazio:", e.message); }
    }
  }

  #save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ accounts: [...this.byEmail.values()] }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);            // escrita atómica
  }

  byId(id) {
    for (const a of this.byEmail.values()) if (a.id === id) return a;
    return null;
  }

  #limited(key, max, windowMs) {
    const t = this.now();
    const list = (this.sendLog.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= max) { this.sendLog.set(key, list); return true; }
    list.push(t);
    this.sendLog.set(key, list);
    return false;
  }

  /** Gera um código de 6 dígitos. Devolve { code } ou { error }. */
  issueCode(emailRaw, ip = "") {
    const email = normEmail(emailRaw);
    if (!EMAIL_RE.test(email)) return { error: "email-invalido" };
    const prev = this.codes.get(email);
    if (prev && this.now() - prev.last < 45_000) return { error: "aguarde" };
    if (this.#limited(`e:${email}`, 5, 3_600_000) || this.#limited(`i:${ip}`, 20, 3_600_000)) return { error: "limite" };
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const salt = randomBytes(8).toString("hex");
    this.codes.set(email, { hash: sha(salt + code), salt, exp: this.now() + CODE_TTL, tries: 0, last: this.now() });
    return { email, code };
  }

  /** Verifica (e consome) um código. */
  checkCode(emailRaw, codeRaw) {
    const email = normEmail(emailRaw);
    const c = this.codes.get(email);
    if (!c || this.now() > c.exp) { this.codes.delete(email); return false; }
    if (++c.tries > MAX_ATTEMPTS) { this.codes.delete(email); return false; }
    const ok = timingSafeEqual(sha(c.salt + String(codeRaw ?? "").replace(/\D/g, "")), c.hash);
    if (ok) this.codes.delete(email);
    return ok;
  }

  /** Associa um email a uma identidade e guarda a primeira cópia. */
  link({ email: emailRaw, code, id, backup }) {
    const email = normEmail(emailRaw);
    if (!validBackup(backup)) return { error: "copia-invalida" };
    const mine = this.byId(id);
    if (mine && mine.email !== email) return { error: "ja-tem-conta" };
    const other = this.byEmail.get(email);
    if (other && other.id !== id) return { error: "email-em-uso" };
    if (!this.checkCode(email, code)) return { error: "codigo-invalido" };
    this.byEmail.set(email, { email, id, backup, ts: this.now(), created: other?.created ?? this.now() });
    this.#save();
    return { ok: true, ts: this.now() };
  }

  setBackup(id, backup) {
    const a = this.byId(id);
    if (!a) return { error: "sem-conta" };
    if (!validBackup(backup)) return { error: "copia-invalida" };
    a.backup = backup;
    a.ts = this.now();
    this.#save();
    return { ok: true, ts: a.ts };
  }

  /** Devolve a cópia cifrada se o código for válido (usado ao entrar num novo dispositivo). */
  restore(emailRaw, code) {
    const email = normEmail(emailRaw);
    const a = this.byEmail.get(email);
    if (!this.checkCode(email, code)) return { error: "codigo-invalido" };
    if (!a) return { error: "sem-conta" };
    return { ok: true, id: a.id, backup: a.backup };
  }

  remove(id) {
    const a = this.byId(id);
    if (!a) return { ok: true };
    this.byEmail.delete(a.email);
    this.#save();
    return { ok: true };
  }

  status(id) {
    const a = this.byId(id);
    return a ? { email: a.email, ts: a.ts } : null;
  }
}

/**
 * Envio por Gmail (SMTP) com uma palavra-passe de aplicação:
 *   GMAIL_USER=o.teu@gmail.com   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
 * Sem estas variáveis (ou sem o pacote nodemailer) o código é escrito no terminal do servidor.
 */
export function createMailer(env = process.env, log = console) {
  const user = env.GMAIL_USER, pass = (env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  let transport = null;
  const ready = async () => {
    if (!user || !pass) return null;
    if (transport) return transport;
    try {
      const nodemailer = (await import("nodemailer")).default;
      transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
      return transport;
    } catch (e) {
      log.error("[email] pacote nodemailer em falta. Execute npm run server:install.", e.message);
      return null;
    }
  };
  return {
    configured: !!(user && pass),
    /** @returns {Promise<"sent"|"console">} */
    async sendCode(to, code) {
      const t = await ready();
      if (!t) {
        log.log(`\n[email] (Gmail não configurado) Código para ${to}: ${code}\n`);
        return "console";
      }
      await t.sendMail({
        from: `"WhatsApp P2P" <${user}>`,
        to,
        subject: `${code} é o seu código WhatsApp P2P`,
        text: `O seu código de verificação é ${code}.\nExpira em 10 minutos. Se não pediu este código, ignore esta mensagem.`,
      });
      return "sent";
    },
  };
}
