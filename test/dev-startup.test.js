import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = http.createServer().listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}

test("dev:all verifica health e respeita PORT personalizado", { timeout: 20000 }, async (t) => {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  delete env.SIGNALING_URL;
  const child = spawn(process.execPath, ["scripts/dev.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  t.after(async () => {
    if (child.exitCode === null) { const ended = once(child, "exit"); child.kill(); await ended; }
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`dev:all terminou antes de ficar pronto:\n${output}`);
    if (output.includes("[vite]") && output.includes("Local:")) break;
    await sleep(100);
  }
  assert.match(output, new RegExp(`Verificado: http://127.0.0.1:${port}/api/health`));
  assert.match(output, /127\.0\.0\.1:5173/);
  const res = await fetch("http://127.0.0.1:5173/api/health");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).service, "whatsapp-p2p-signaling");
});
