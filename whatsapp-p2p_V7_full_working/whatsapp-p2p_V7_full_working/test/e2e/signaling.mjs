// Dois navegadores com React, IndexedDB e Socket.IO REAIS, sem o Hub simulado.
// O proxy de teste bloqueia WebSocket deliberadamente e simula o Host do ngrok.
import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import { createServer } from "vite";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import config from "../../vite.config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = http.createServer().listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
const backendPort = await freePort();
const target = `http://127.0.0.1:${backendPort}`;
let child;
function startBackend() { child = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: String(backendPort) }, stdio: "inherit" }); }
async function healthy() {
  for (let n = 0; n < 100; n++) {
    try { if ((await (await fetch(target + "/api/health")).json()).ok) return; } catch { /* aguarda */ }
    await sleep(100);
  }
  throw new Error("Sinalização não ficou pronta");
}
let dev, tunnel, browser;
const errors = [];
try {
  startBackend(); await healthy();
  process.env.TUNNEL_HOSTS = "test-tunnel.ngrok-free.app";
  const c = config({ mode: "test" });
  for (const value of Object.values(c.server.proxy)) value.target = target;
  dev = await createServer({ ...c, configFile: false, server: { ...c.server, port: 0 }, logLevel: "silent" });
  await dev.listen();
  const devUrl = `http://127.0.0.1:${dev.httpServer.address().port}`;
  tunnel = http.createServer((req, res) => {
    const request = http.request(devUrl + req.url, { method: req.method, headers: {
      ...req.headers, host: "test-tunnel.ngrok-free.app", origin: "https://test-tunnel.ngrok-free.app",
    } }, (response) => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    request.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(request);
  });
  tunnel.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
  tunnel.listen(0, "127.0.0.1"); await once(tunnel, "listening");
  const url = `http://127.0.0.1:${tunnel.address().port}`;
  browser = await chromium.launch();
  async function user(name) {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByLabel("O seu nome").fill(name);
    await page.getByRole("button", { name: "Criar identidade" }).click();
    await page.getByRole("button", { name: "O meu perfil" }).click();
    const id = (await page.getByTestId("my-id").innerText()).replace(/-/g, "");
    await page.getByRole("button", { name: "Fechar" }).click();
    await page.getByRole("status").waitFor({ state: "hidden", timeout: 20000 });
    return { ctx, page, id, name };
  }
  const a = await user("Alice"), b = await user("Bob");
  console.log("OK: duas identidades autenticadas na UI, com servidor Socket.IO real");
  for (const [u, other] of [[a, b], [b, a]]) {
    await u.page.getByRole("button", { name: "Adicionar contacto" }).click();
    await u.page.getByLabel("ID do contacto").fill(other.id);
    await u.page.getByLabel("Nome do contacto").fill(other.name);
    await u.page.getByRole("button", { name: "Guardar", exact: true }).click();
    await u.page.getByRole("button", { name: "Contactos", exact: true }).click();
    await u.page.getByRole("button", { name: `Contacto ${other.name}` }).click();
    await u.page.getByText("online", { exact: true }).waitFor();
  }
  async function send(from, to, text) {
    await from.page.getByLabel("Mensagem", { exact: true }).fill(text);
    await from.page.getByRole("button", { name: "Enviar", exact: true }).click();
    await to.page.getByRole("list", { name: "Mensagens" }).getByText(text, { exact: true }).waitFor();
    await from.page.getByRole("list", { name: "Mensagens" }).locator("li", { hasText: text }).getByLabel("entregue").waitFor();
  }
  await send(a, b, "Mensagem real A para B"); await send(b, a, "Resposta real B para A");
  console.log("OK: presença e mensagens nos dois sentidos, mesmo com WebSocket bloqueado");
  const ended = once(child, "exit"); child.kill(); await ended;
  await a.page.getByRole("status").waitFor(); await b.page.getByRole("status").waitFor();
  console.log("OK: perda do servidor é mostrada na UI");
  startBackend(); await healthy();
  for (const u of [a, b]) await u.page.getByRole("status").waitFor({ state: "hidden", timeout: 25000 });
  await a.page.getByText("online", { exact: true }).waitFor();
  await send(a, b, "Mensagem após reinício do servidor");
  console.log("OK: reconexão e reautenticação automáticas após reinício, com nova entrega");
  assert.deepEqual(errors, []);
  console.log("OK: sem exceções JavaScript nas páginas");
} finally {
  await browser?.close();
  if (tunnel) await new Promise((resolve) => { tunnel.close(resolve); tunnel.closeAllConnections(); });
  await dev?.close();
  if (child?.exitCode === null) { const ended = once(child, "exit"); child.kill(); await ended; }
}
