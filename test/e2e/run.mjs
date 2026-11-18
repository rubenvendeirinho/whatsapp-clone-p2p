// Teste ponta a ponta em Chromium real (WebRTC verdadeiro, microfone/câmara falsos).
// Requer: playwright (com chromium) e esbuild.   Uso: node test/e2e/run.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Hub } from "./hub.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const esbuild = require("esbuild");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT = fs.mkdtempSync(path.join(process.env.E2E_TMP || "/tmp", "wa-e2e-"));

await esbuild.build({
  entryPoints: [path.join(ROOT, "src/main.jsx")], bundle: true, outfile: path.join(OUT, "bundle.js"),
  jsx: "automatic", loader: { ".js": "jsx", ".css": "empty" }, define: { "import.meta.env": "{}" },
  alias: { "socket.io-client": path.join(HERE, "fake-io.js") }, logLevel: "warning",
  nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(":") : [],
});
fs.writeFileSync(path.join(OUT, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
const web = http.createServer((req, res) => {
  const f = req.url.startsWith("/bundle.js") ? "bundle.js" : "index.html";
  res.writeHead(200, { "Content-Type": f.endsWith("js") ? "text/javascript" : "text/html" });
  res.end(fs.readFileSync(path.join(OUT, f)));
}).listen(0);
const URL = `http://localhost:${web.address().port}/`;

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const hub = new Hub();
const errors = [];
let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };
const T = 20000;

async function newUser(name) {
  const ctx = await browser.newContext({ permissions: ["microphone", "camera"] });
  const open = async () => {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });   // força o caminho "memória"
    hub.attach(page);
    await page.goto(URL);
    return page;
  };
  let page = await open();
  await page.getByLabel("O seu nome").fill(name);
  await page.getByRole("button", { name: "Criar identidade" }).click();
  await page.getByRole("button", { name: "O meu perfil" }).waitFor({ timeout: T });
  await page.getByRole("button", { name: "O meu perfil" }).click();
  const id = (await page.getByTestId("my-id").innerText()).replace(/-/g, "");
  await page.getByRole("button", { name: "Fechar" }).click();
  return { name, ctx, id, get page() { return page; }, reopen: async () => { page = await open(); return page; } };
}

const inChat = (page, text) => page.getByRole("list", { name: "Mensagens" }).getByText(text);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const pageHash = (page, sel) => page.evaluate(async (s) => {
  const href = document.querySelector(s).href;
  const buf = await (await fetch(href)).arrayBuffer();
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}, sel);

try {
  console.log("Identidade e autenticação");
  const A = await newUser("Alice"), B = await newUser("Bob");
  if (!/^[A-Z2-7]{20}$/.test(A.id) || A.id === B.id) throw new Error("IDs inválidos");
  ok("identidades criadas localmente (IDs distintos de 100 bits)");
  await new Promise((r) => setTimeout(r, 400));
  if (hub.online.size !== 2) throw new Error(`hub online=${hub.online.size}`);
  ok("autenticação por desafio/assinatura aceite pelo servidor (2 online)");

  const addContact = async (u, other) => {
    await u.page.getByRole("button", { name: "Adicionar contacto" }).click();
    await u.page.getByLabel("ID do contacto").fill(other.id);
    await u.page.getByLabel("Nome do contacto").fill(other.name);
    await u.page.getByRole("button", { name: "Guardar", exact: true }).click();
  };
  await addContact(A, B); await addContact(B, A);
  for (const [u, o] of [[A, B], [B, A]]) {
    await u.page.getByRole("button", { name: "Contactos", exact: true }).click();
    await u.page.getByRole("button", { name: `Contacto ${o.name}` }).click();
    await u.page.getByText("online", { exact: true }).waitFor({ timeout: T });
  }
  ok("contactos guardados; presença 'online' nos dois lados");

  console.log("Texto");
  const send = async (u, text) => { await u.page.getByLabel("Mensagem", { exact: true }).fill(text); await u.page.getByRole("button", { name: "Enviar", exact: true }).click(); };
  await send(A, "olá Bob");
  await inChat(B.page, "olá Bob").waitFor({ timeout: T });
  await A.page.getByLabel("entregue").first().waitFor({ timeout: T });
  ok("mensagem entregue e confirmada (✓✓)");

  console.log("Outbox offline (sem base de dados no servidor)");
  await B.page.close();
  await new Promise((r) => setTimeout(r, 300));
  await send(A, "mensagem offline");
  await A.page.getByLabel("pendente").waitFor({ timeout: T });
  ok("com o destinatário offline a mensagem fica pendente (relógio)");
  const B2 = await B.reopen();
  await B2.getByRole("button", { name: "Conversa Alice" }).click();
  await inChat(B2, "mensagem offline").waitFor({ timeout: T });
  await A.page.getByRole("list", { name: "Mensagens" }).locator("li", { hasText: "mensagem offline" }).getByLabel("entregue").waitFor({ timeout: T });
  ok("ao voltar online a mensagem é entregue automaticamente (persistência do outbox em IndexedDB)");

  console.log("Mensagem de voz (P2P)");
  await A.page.getByRole("button", { name: "Gravar mensagem de voz" }).click();
  await A.page.getByRole("group", { name: "A gravar" }).waitFor();
  await new Promise((r) => setTimeout(r, 1800));
  await A.page.getByRole("button", { name: "Enviar gravação" }).click();
  await B2.getByRole("button", { name: "Reproduzir" }).waitFor({ timeout: T });
  await B2.waitForFunction(() => !document.querySelector('button[aria-label="Reproduzir"]').disabled, null, { timeout: T });
  await A.page.getByRole("button", { name: "Reproduzir" }).waitFor();
  await A.page.waitForFunction(() => document.querySelectorAll('[aria-label="entregue"]').length >= 3, null, { timeout: T });
  ok("áudio gravado (MediaRecorder), enviado por DataChannel e recebido automaticamente por contacto");
  const played = await B2.evaluate(async () => {
    const btn = document.querySelector('button[aria-label="Reproduzir"]');
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    return !!document.querySelector('button[aria-label="Pausar"]');
  });
  if (!played) throw new Error("player não arrancou");
  ok("reprodução da mensagem de voz arranca");

  console.log("Ficheiros P2P (envio simultâneo nos dois sentidos = 'glare' WebRTC)");
  const bufA = crypto.randomBytes(3 * 1024 * 1024 + 123), bufB = crypto.randomBytes(1024 * 1024 + 7);
  await Promise.all([
    A.page.getByTestId("file-input").setInputFiles({ name: "dados-a.bin", mimeType: "application/octet-stream", buffer: bufA }),
    B2.getByTestId("file-input").setInputFiles({ name: "dados-b.bin", mimeType: "application/octet-stream", buffer: bufB }),
  ]);
  await B2.getByRole("button", { name: "Aceitar" }).click({ timeout: T });
  await A.page.getByRole("button", { name: "Aceitar" }).click({ timeout: T });
  await B2.waitForSelector('a[download="dados-a.bin"]', { timeout: 30000 });
  await A.page.waitForSelector('a[download="dados-b.bin"]', { timeout: 30000 });
  const [hA, hB] = await Promise.all([pageHash(B2, 'a[download="dados-a.bin"]'), pageHash(A.page, 'a[download="dados-b.bin"]')]);
  if (hA !== sha(bufA) || hB !== sha(bufB)) throw new Error("hash dos ficheiros difere");
  ok("3 MB e 1 MB recebidos com SHA-256 idêntico, sem corrupção, com glare resolvido");

  console.log("Ficheiro com escrita direta em disco (File System Access API simulada)");
  await B2.evaluate(() => {
    window.__disk = { name: null, bytes: 0, closed: false };
    window.showSaveFilePicker = async ({ suggestedName }) => {
      window.__disk.name = suggestedName;
      return { createWritable: async () => ({
        write: async (b) => { window.__disk.bytes += b.byteLength; },
        close: async () => { window.__disk.closed = true; }, abort: async () => {} }) };
    };
  });
  const bufC = crypto.randomBytes(2 * 1024 * 1024);
  await A.page.getByTestId("file-input").setInputFiles({ name: "grande.bin", mimeType: "application/octet-stream", buffer: bufC });
  await B2.getByRole("button", { name: "Aceitar" }).click({ timeout: T });
  await B2.waitForFunction(() => window.__disk.closed, null, { timeout: 30000 });
  const disk = await B2.evaluate(() => window.__disk);
  if (disk.bytes !== bufC.length || disk.name !== "grande.bin") throw new Error(JSON.stringify(disk));
  ok("receção em streaming para disco (sem acumular em memória)");

  console.log("Recusar ficheiro");
  await A.page.getByTestId("file-input").setInputFiles({ name: "nao.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(1000, 1) });
  await B2.getByRole("button", { name: "Recusar" }).click({ timeout: T });
  await A.page.getByText("Recusado por 1").waitFor({ timeout: T });
  ok("recusa chega ao remetente");

  console.log("Chamadas");
  await A.page.getByRole("button", { name: "Chamada de voz" }).click();
  const dlgB = B2.getByRole("dialog", { name: "Chamada" });
  await dlgB.waitFor({ timeout: T });
  await dlgB.getByTestId("call-peer").getByText("Alice").waitFor();
  await dlgB.getByRole("button", { name: "Atender chamada" }).click();
  const active = /^\d+:\d\d/;
  await A.page.getByTestId("call-state").filter({ hasText: active }).waitFor({ timeout: 30000 });
  await B2.getByTestId("call-state").filter({ hasText: active }).waitFor({ timeout: 30000 });
  const audioTracks = (p) => p.evaluate(() => document.querySelector('[aria-label="Chamada"] video').srcObject.getAudioTracks().length);
  if ((await audioTracks(A.page)) < 1 || (await audioTracks(B2)) < 1) throw new Error("sem áudio remoto");
  ok("chamada de voz atendida; áudio remoto recebido nos dois lados");

  await A.page.getByRole("button", { name: "Ligar câmara" }).click();
  await B2.waitForFunction(() => {
    const v = document.querySelector('[aria-label="Chamada"] video');
    return v?.srcObject?.getVideoTracks().length === 1 && v.className.includes("object-cover");
  }, null, { timeout: 30000 });
  await B2.getByRole("button", { name: "Ligar câmara" }).click();
  await A.page.waitForFunction(() => document.querySelector('[aria-label="Chamada"] video').srcObject.getVideoTracks().length === 1, null, { timeout: 30000 });
  ok("voz → vídeo a meio da chamada (renegociação) nos dois sentidos");

  await A.page.getByRole("button", { name: "Silenciar" }).click();
  await A.page.getByRole("button", { name: "Ativar microfone" }).waitFor();
  ok("mute funciona");

  await A.page.getByRole("button", { name: "Terminar chamada" }).click();
  await dlgB.waitFor({ state: "detached", timeout: T });
  await A.page.getByRole("dialog", { name: "Chamada" }).waitFor({ state: "detached" });
  await B2.getByText(/Chamada de (voz|vídeo) · \d+:\d\d/).waitFor({ timeout: T });
  await A.page.getByText(/Chamada de (voz|vídeo) · \d+:\d\d/).waitFor({ timeout: T });
  ok("terminar chamada limpa os dois lados e regista no histórico");

  await B2.getByRole("button", { name: "Chamada de voz" }).click();
  await A.page.getByRole("dialog", { name: "Chamada" }).getByRole("button", { name: "Recusar chamada" }).click({ timeout: T });
  await B2.getByText("Chamada recusada").waitFor({ timeout: T });
  ok("recusar chamada");

  await B2.getByRole("button", { name: "Chamada de voz" }).click();
  const dlgA = A.page.getByRole("dialog", { name: "Chamada" });
  await dlgA.waitFor({ timeout: T });
  await dlgA.getByRole("button", { name: "Atender chamada" }).click();
  await A.page.getByTestId("call-state").filter({ hasText: active }).waitFor({ timeout: 30000 });
  await B2.getByRole("button", { name: "Terminar chamada" }).click();
  await dlgA.waitFor({ state: "detached", timeout: T });
  ok("segunda chamada na mesma ligação (reutiliza a RTCPeerConnection)");

  console.log("Segurança");
  const fake = await browser.newContext();
  const fp = await fake.newPage();
  hub.attach(fp);
  await fp.goto(URL);
  // Um atacante que apresente a chave pública de Alice com uma assinatura sua não consegue entrar:
  const sid = [...hub.socks.keys()].pop();
  await new Promise((r) => setTimeout(r, 300));
  const s = hub.socks.get(sid);
  const bad = hub.handle(sid, "auth:response", { jwk: { kty: "EC", crv: "P-256", x: "x".repeat(43), y: "y".repeat(43) }, signature: "AAAA" });
  if (!s || bad?.ok) throw new Error("autenticação falsa aceite!");
  ok("assinatura inválida é rejeitada pelo servidor");
  await fake.close();

  const relevant = errors.filter((e) => !/Failed to load resource|favicon|ERR_NAME_NOT_RESOLVED|stun/i.test(e));
  if (relevant.length) throw new Error("erros na consola:\n" + relevant.join("\n"));
  ok("sem erros na consola dos browsers");
  console.log(`\n${passed} verificações OK`);
} catch (e) {
  console.error("\nFALHOU:", e.message);
  if (errors.length) console.error("Erros de consola:\n" + errors.slice(0, 10).join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  web.close();
}
