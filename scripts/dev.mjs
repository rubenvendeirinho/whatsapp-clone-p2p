// Arranque único, sem shell/npx: funciona também no Windows e com espaços no caminho.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadEnv } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...loadEnv("development", ROOT, ""), ...process.env };
const port = Number(env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 5173) {
  console.error("PORT deve ser uma porta válida, diferente de 5173 (reservada ao Vite).");
  process.exit(1);
}
try {
  createRequire(path.join(ROOT, "server/package.json")).resolve("socket.io");
} catch {
  console.error("Faltam as dependências da sinalização. Execute npm run server:install.");
  process.exit(1);
}
const children = [];
let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
function start(name, script, args = [], childEnv = env) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: ROOT, env: childEnv, stdio: ["inherit", "pipe", "pipe"],
  });
  children.push(child);
  for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on("data", (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) out.write(`[${name}] ${line}\n`);
    });
  }
  child.on("error", (error) => { console.error(`[${name}] ${error.message}`); shutdown(1); });
  child.on("exit", (code) => { if (!stopping) shutdown(code || 1); });
  return child;
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const target = env.SIGNALING_URL || `http://127.0.0.1:${port}`;
// SIGNALING_URL explícito indica um servidor já gerido externamente.
if (!env.SIGNALING_URL) start("sinalização", path.join(ROOT, "server/index.js"));
let healthy = false;
for (let attempt = 0; attempt < 40 && !stopping; attempt++) {
  try {
    const res = await fetch(new URL("/api/health", target), { signal: AbortSignal.timeout(1000) });
    const data = await res.json();
    if (res.ok && data.ok && data.service === "whatsapp-p2p-signaling") { healthy = true; break; }
  } catch { /* Servidor ainda a arrancar. */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!stopping) {
  if (!healthy) {
    console.error(`[sinalização] ${target}/api/health não respondeu como esperado. O Vite não será iniciado sem sinalização.`);
    shutdown(1);
  } else {
    console.log(`[sinalização] Verificado: ${target}/api/health`);
    console.log("Abra o túnel com: ngrok http 5173");
    const vite = path.join(path.dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js");
    start("vite", vite, [], { ...env, SIGNALING_URL: target });
  }
}
