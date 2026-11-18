// Servidor de sinalização: autentica por chave pública, retransmite mensagens e sinais
// WebRTC e informa presença. Mensagens, contactos e ficheiros nunca ficam no servidor.
// Única persistência (opcional): contas por email com uma cópia de segurança JÁ CIFRADA
// no cliente (server/data/accounts.json).
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { newNonce, verifyAuth, iceServersFor, validMsg, ID_RE } from "./auth.js";
import { Accounts, createMailer, validBackup, EMAIL_RE, normEmail } from "./accounts.js";

const PORT = Number(process.env.PORT || 5000);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "..", "dist");
const accounts = new Accounts(process.env.ACCOUNTS_FILE || path.join(HERE, "data", "accounts.json"));
const mailer = createMailer();
const ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,https://localhost:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(self), microphone=(self), display-capture=(self), geolocation=(self)",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; media-src 'self' blob: mediastream:; " +
    "connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",").pop().trim();

function readJson(req, max = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) { reject(new Error("grande")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("json")); } });
    req.on("error", reject);
  });
}

/** API HTTP das contas (pedir código e restaurar num dispositivo novo). */
async function accountApi(req, res, route) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "metodo" });
  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { ok: false, error: "pedido-invalido" }); }
  if (route === "send-code") {
    const r = accounts.issueCode(body.email, clientIp(req));
    if (r.error) return json(res, r.error === "email-invalido" ? 400 : 429, { ok: false, error: r.error });
    try {
      const mode = await mailer.sendCode(r.email, r.code);
      return json(res, 200, { ok: true, mode });
    } catch (e) {
      console.error("[email] falha ao enviar:", e.message);
      return json(res, 502, { ok: false, error: "envio-falhou" });
    }
  }
  if (route === "restore") {
    const r = accounts.restore(body.email, body.code);
    return json(res, r.ok ? 200 : r.error === "sem-conta" ? 404 : 401, r.ok ? r : { ok: false, error: r.error });
  }
  return json(res, 404, { ok: false, error: "desconhecido" });
}

function serveStatic(req, res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const route = (req.url || "").split("?")[0];
  if (route.startsWith("/api/account/")) return void accountApi(req, res, route.slice("/api/account/".length));
  if ((req.url || "").split("?")[0] === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ ok: true, service: "whatsapp-p2p-signaling", transports: ["polling", "websocket"] }));
  }
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || "/").split("?")[0]); }
  catch { res.writeHead(400); return res.end("Caminho inválido"); }
  if (urlPath.includes("\0")) { res.writeHead(400); return res.end(); }
  let file = path.resolve(DIST, "." + (urlPath.startsWith("/") ? urlPath : "/" + urlPath));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("Signaling server OK. Corra `npm run build` na raiz para servir a app daqui.");
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html"); // SPA
  const ext = path.extname(file);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  const stream = fs.createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

const useTLS = process.env.TLS_KEY && process.env.TLS_CERT;
const httpServer = useTLS
  ? https.createServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) }, serveStatic)
  : http.createServer(serveStatic);

const io = new Server(httpServer, {
  cors: { origin: ORIGINS },
  maxHttpBufferSize: 128 * 1024, // sinais e mensagens são pequenos; ficheiros nunca passam aqui
  transports: ["polling", "websocket"],
});

/** Emite presença de `id` apenas a quem o observa e NÃO o bloqueou. */
function emitPresence(id, on) {
  const room = io.sockets.adapter.rooms.get(`w:${id}`);
  if (!room) return;
  for (const sid of room) {
    const s = io.sockets.sockets.get(sid);
    if (!s || s.data.blocked?.has(id)) continue;                          // quem observa bloqueou-o
    if (on && online.get(id)?.data.blocked?.has(s.data.id)) continue;     // ele bloqueou quem observa
    s.emit("presence", { id, online: on });
  }
}
/** `id` está online e nenhum dos dois bloqueou o outro? */
function visibleTo(watcher, id) {
  const s = online.get(id);
  return !!s && !s.data.blocked?.has(watcher) && !online.get(watcher)?.data.blocked?.has(id);
}

/** id -> socket (uma sessão por identidade; a mais recente substitui a anterior) */
const online = new Map();

io.on("connection", (socket) => {
  // --- limitação de ritmo (token bucket) + só aceita auth antes de autenticar ---
  let tokens = 60, last = Date.now();
  socket.use(([event], next) => {
    const now = Date.now();
    tokens = Math.min(60, tokens + ((now - last) / 1000) * 30);
    last = now;
    if (--tokens < 0) return next(new Error("rate-limit"));
    if (!socket.data.id && event !== "auth:response") return next(new Error("unauthenticated"));
    next();
  });
  socket.on("error", () => {});

  const nonce = newNonce();
  socket.emit("auth:challenge", nonce);
  const timer = setTimeout(() => !socket.data.id && socket.disconnect(true), 10_000);

  socket.on("auth:response", (payload, ack) => {
    if (socket.data.id || typeof ack !== "function") return;
    const id = verifyAuth({ nonce, jwk: payload?.jwk, signature: payload?.signature });
    if (!id) { ack({ ok: false, error: "invalid-signature" }); return socket.disconnect(true); }
    clearTimeout(timer);

    const prev = online.get(id);
    if (prev && prev !== socket) { prev.emit("replaced"); prev.data.id = null; prev.disconnect(true); }
    socket.data.id = id;
    online.set(id, socket);
    ack({ ok: true, id, ice: iceServersFor(id) });
    socket.data.blocked = new Set();
    emitPresence(id, true);
  });

  socket.on("msg", (payload, reply) => {
    const ack = typeof reply === "function" ? reply : () => {};
    const from = socket.data.id;
    if (!payload || !validMsg(from, payload.to, payload.msg)) return ack?.([]);
    const delivered = [];
    for (const to of new Set(payload.to)) {
      const s = to !== from && online.get(to);
      if (s && !s.data.blocked?.has(from)) { s.emit("msg", { from, msg: payload.msg }); delivered.push(to); }
    }
    ack?.(delivered);
  });

  socket.on("signal", (payload, reply) => {
    const ack = typeof reply === "function" ? reply : () => {};
    const from = socket.data.id;
    const to = payload?.to;
    const s = typeof to === "string" && ID_RE.test(to) && to !== from && online.get(to);
    if (!s || s.data.blocked?.has(from) || typeof payload.data !== "object" || payload.data === null) return ack?.(false);
    s.emit("signal", { from, data: payload.data }); // "from" vem sempre do servidor
    ack?.(true);
  });

  socket.on("presence:watch", (ids, reply) => {
    const ack = typeof reply === "function" ? reply : () => {};
    if (!Array.isArray(ids)) return ack?.([]);
    for (const room of socket.rooms) if (room.startsWith("w:")) socket.leave(room);
    const valid = [...new Set(ids)].filter((i) => typeof i === "string" && ID_RE.test(i)).slice(0, 500);
    valid.forEach((i) => socket.join(`w:${i}`));
    ack?.(valid.filter((i) => visibleTo(socket.data.id, i)));
  });

  // --- bloqueio: o servidor deixa de entregar mensagens/sinais e esconde a presença ---
  socket.on("block:set", (ids, reply) => {
    const ack = typeof reply === "function" ? reply : () => {};
    const me = socket.data.id;
    if (!Array.isArray(ids)) return ack(false);
    const next = new Set(ids.filter((i) => typeof i === "string" && ID_RE.test(i) && i !== me).slice(0, 1000));
    const prev = socket.data.blocked ?? new Set();
    socket.data.blocked = next;
    // quem foi bloqueado passa a ver-me offline; ao desbloquear volta a ver-me online
    for (const id of next) {
      const o = online.get(id);
      if (!prev.has(id) && o?.rooms.has(`w:${me}`)) o.emit("presence", { id: me, online: false });
    }
    for (const id of prev) {
      const o = online.get(id);
      if (!next.has(id) && o?.rooms.has(`w:${me}`) && !o.data.blocked?.has(me)) o.emit("presence", { id: me, online: true });
    }
    ack(true);
  });

  // --- contas por email ---
  socket.on("acct:status", (_p, reply) => typeof reply === "function" && reply({ ok: true, account: accounts.status(socket.data.id) }));
  socket.on("acct:link", (p, reply) => {
    if (typeof reply !== "function") return;
    if (typeof p?.email !== "string" || !EMAIL_RE.test(normEmail(p.email))) return reply({ ok: false, error: "email-invalido" });
    reply(accounts.link({ email: p.email, code: p.code, id: socket.data.id, backup: p.backup }));
  });
  socket.on("acct:backup", (p, reply) => {
    if (typeof reply !== "function") return;
    reply(validBackup(p?.backup) ? accounts.setBackup(socket.data.id, p.backup) : { error: "copia-invalida" });
  });
  socket.on("acct:unlink", (_p, reply) => typeof reply === "function" && reply(accounts.remove(socket.data.id)));

  socket.on("disconnect", () => {
    clearTimeout(timer);
    const id = socket.data.id;
    if (id && online.get(id) === socket) {
      online.delete(id);
      emitPresence(id, false);
    }
  });
});

httpServer.listen(PORT, () => console.log(`Signaling em ${useTLS ? "https" : "http"}://localhost:${PORT}`));
