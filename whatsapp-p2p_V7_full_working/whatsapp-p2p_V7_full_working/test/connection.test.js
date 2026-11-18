import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import { createServer, preview } from "vite";
import config from "../vite.config.js";
import { Net } from "../src/core/net.js";
import { generateIdentityKeys } from "../src/lib/crypto.js";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function event(emitter, name, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`Timeout: ${name}`)); }, timeout);
    const off = emitter.on(name, (value) => { clearTimeout(timer); off(); resolve(value); });
  });
}
async function port() {
  const s = http.createServer(); s.listen(0, "127.0.0.1"); await once(s, "listening");
  const p = s.address().port; await new Promise((resolve) => s.close(resolve)); return p;
}
async function health(url) {
  for (let n = 0; n < 80; n++) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok && (await res.json()).service === "whatsapp-p2p-signaling") return;
    } catch { /* Ainda a arrancar. */ }
    await pause(100);
  }
  throw new Error(`Servidor não ficou pronto: ${url}`);
}
async function pair(url, t) {
  const a = new Net(await generateIdentityKeys(), url);
  const b = new Net(await generateIdentityKeys(), url);
  t.after(() => { a.close(); b.close(); });
  await Promise.all([event(a, "ready"), event(b, "ready")]);
  assert.equal(a.state, "online"); assert.equal(b.state, "online");
  return [a, b];
}
async function exchange(a, b) {
  assert.deepEqual(await a.watch([b.identity.id]), [b.identity.id]);
  for (const [from, to] of [[a, b], [b, a]]) {
    const message = { id: crypto.randomUUID(), ts: Date.now(), text: "Olá pelo túnel", participants: [a.identity.id, b.identity.id] };
    const received = event(to, "msg");
    assert.deepEqual(await from.sendMsg([to.identity.id], message), [to.identity.id]);
    assert.deepEqual(await received, { from: from.identity.id, msg: message });
  }
  const signal = event(b, "signal");
  assert.equal(await a.signal(b.identity.id, { type: "offer", sdp: "teste" }), true);
  assert.equal((await signal).from, a.identity.id);
}

test("sinalização real através de desenvolvimento, preview e túnel sem WebSocket", { timeout: 90000 }, async (t) => {
  const backendPort = await port();
  const upstream = `http://127.0.0.1:${backendPort}`;
  const child = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: String(backendPort) }, stdio: "ignore" });
  t.after(async () => { if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; } });
  await health(upstream);
  const oldPort = process.env.PORT;
  const oldTarget = process.env.SIGNALING_URL;
  const oldHosts = process.env.TUNNEL_HOSTS;
  process.env.PORT = String(backendPort); delete process.env.SIGNALING_URL;
  process.env.TUNNEL_HOSTS = "test-tunnel.ngrok-free.app";
  const c = config({ mode: "test" });
  if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort;
  if (oldTarget !== undefined) process.env.SIGNALING_URL = oldTarget;
  if (oldHosts === undefined) delete process.env.TUNNEL_HOSTS; else process.env.TUNNEL_HOSTS = oldHosts;
  assert.equal(c.server.proxy["/socket.io"].target, upstream, "PORT personalizado é respeitado pelo proxy");
  const dev = await createServer({ ...c, configFile: false, server: { ...c.server, port: 0 }, logLevel: "silent" });
  t.after(() => dev.close()); await dev.listen();
  const devUrl = `http://127.0.0.1:${dev.httpServer.address().port}`;

  await t.test("health pelo proxy e validação de Host do ngrok", async () => {
    await health(devUrl);
    const statusForHost = (host) => new Promise((resolve, reject) => {
      const req = http.get(devUrl, { headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
    });
    assert.equal(await statusForHost("test-tunnel.ngrok-free.app"), 200);
    assert.equal(await statusForHost("evil.example.com"), 403);
  });

  await t.test("dois Net reais autenticam e trocam presença, texto e sinalização", async (t) => {
    const [a, b] = await pair(devUrl, t); await exchange(a, b);
    for (let n = 0; n < 30 && a.socket.io.engine.transport.name !== "websocket"; n++) await pause(100);
    assert.equal(a.socket.io.engine.transport.name, "websocket", "upgrade continua disponível");
  });

  const tunnel = http.createServer((req, res) => {
    const forwarded = http.request(devUrl + req.url, {
      method: req.method,
      headers: { ...req.headers, host: "test-tunnel.ngrok-free.app", origin: "https://test-tunnel.ngrok-free.app" },
    }, (reply) => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
    forwarded.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(forwarded);
  });
  tunnel.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
  tunnel.listen(0, "127.0.0.1"); await once(tunnel, "listening");
  t.after(() => new Promise((resolve) => { tunnel.close(resolve); tunnel.closeAllConnections(); }));
  const tunnelUrl = `http://127.0.0.1:${tunnel.address().port}`;
  await t.test("WebSocket bloqueado: autenticação e chat funcionam por polling", async (t) => {
    const [a, b] = await pair(tunnelUrl, t); await exchange(a, b);
    await pause(500);
    assert.equal(a.socket.io.engine.transport.name, "polling");
    assert.equal(b.socket.io.engine.transport.name, "polling");
  });

  await t.test("reconecta e reautentica depois de perder o transporte", async (t) => {
    const [a, b] = await pair(devUrl, t);
    const ready = event(a, "ready");
    a.socket.io.engine.close();
    await ready; await exchange(a, b);
  });

  await t.test("preview também autentica e entrega mensagens pelo proxy", async (t) => {
    const pre = await preview({ ...c, configFile: false, preview: { ...c.preview, port: 0 }, logLevel: "silent" });
    t.after(() => new Promise((resolve) => pre.httpServer.close(resolve)));
    const url = `http://127.0.0.1:${pre.httpServer.address().port}`;
    await health(url);
    const [a, b] = await pair(url, t); await exchange(a, b);
    a.close(); b.close();
  });
});
