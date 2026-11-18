import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { io } from 'socket.io-client';
import { generateIdentityKeys, signNonce } from '../src/lib/crypto.js';
import { validMsg } from '../server/auth.js';
import { validateMeta } from '../src/lib/validate.js';
import { safeName } from '../src/lib/format.js';
import { PeerManager } from '../src/core/peers.js';
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import * as db from '../src/core/db.js';

const A = 'A'.repeat(20), B = 'B'.repeat(20);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('texto: rejeita IDs vazios e datas não finitas ou negativas', () => {
  const msg = { id: 'm', ts: 1, text: 'olá', participants: [A, B] };
  assert.equal(validMsg(A, [B], msg), true);
  assert.equal(validMsg(A, [B], { ...msg, id: '' }), false);
  for (const ts of [NaN, Infinity, -Infinity, -1]) assert.equal(validMsg(A, [B], { ...msg, ts }), false);
});

test('ofertas P2P: tamanho deve ser um inteiro seguro', () => {
  const meta = { id: 'f', kind: 'file', size: 0, participants: [A, B] };
  assert.ok(validateMeta(meta, A, B));
  for (const size of [0.5, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) assert.equal(validateMeta({ ...meta, size }, A, B), null);
});

test('nomes: remove caminhos e caracteres de controlo sem perder acentos', () => {
  assert.equal(safeName('../áudio\\teste\u0000\u001f\u007f'), '.._áudio_teste___');
  assert.equal(safeName(''), 'ficheiro');
  assert.equal(safeName('a'.repeat(250)).length, 200);
});

function fakeManager() {
  const saved = globalThis.RTCPeerConnection;
  class FakePC {
    createDataChannel() { return { readyState: 'open', send() {}, close() {} }; }
    close() {}
  }
  globalThis.RTCPeerConnection = FakePC;
  const mgr = new PeerManager({ myId: A, signal: async () => true, loadBlob: async () => null });
  const peer = mgr.ensure(B);
  return { mgr, peer, cleanup() { mgr.dispose(); globalThis.RTCPeerConnection = saved; } };
}

test('DataChannel: ignora JSON nulo, listas e JSON inválido', () => {
  const { peer, cleanup } = fakeManager();
  try {
    for (const data of ['null', '[]', '3', '"x"', '{']) assert.doesNotThrow(() => peer.dc.onmessage({ data }));
  } finally { cleanup(); }
});

test('transferência: falha ao fechar o destino é reportada sem rejeição não tratada', async () => {
  const { mgr, peer, cleanup } = fakeManager();
  try {
    let aborted = false;
    const failures = [];
    mgr.on('xfer:fail', (e) => failures.push(e));
    peer.accept({ id: 'f', size: 0 }, {
      async write() {}, async close() { throw new Error('disk-full'); }, async abort() { aborted = true; },
    });
    peer.dc.onmessage({ data: JSON.stringify({ t: 'end', id: 'f' }) });
    await delay(10);
    assert.equal(aborted, true);
    assert.equal(failures[0].reason, 'disk-full');
  } finally { cleanup(); }
});

test('transferência: fim duplicado só fecha o destino uma vez', async () => {
  const { peer, cleanup } = fakeManager();
  try {
    let closes = 0;
    peer.accept({ id: 'f', size: 0 }, { async write() {}, async abort() {}, async close() { closes++; return new Blob([]); } });
    peer.dc.onmessage({ data: '{"t":"end","id":"f"}' });
    peer.dc.onmessage({ data: '{"t":"end","id":"f"}' });
    await delay(10);
    assert.equal(closes, 1);
  } finally { cleanup(); }
});

test('IndexedDB: operações e índices persistem depois do commit', async () => {
  const msg = { id: 'db-test', convId: 'conv', pendingTo: [B] };
  await db.put('messages', msg);
  assert.deepEqual(await db.get('messages', msg.id), msg);
  assert.deepEqual(await db.byIndex('messages', 'pending', B), [msg]);
  await db.del('messages', msg.id);
  assert.equal(await db.get('messages', msg.id), undefined);
});

test('IndexedDB: abort após sucesso do pedido não é confundido com commit', async () => {
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const req = original.apply(this, args);
    req.addEventListener('success', () => this.transaction.abort());
    return req;
  };
  try {
    await assert.rejects(db.put('kv', 'valor', 'aborted'));
    assert.equal(await db.get('kv', 'aborted'), undefined);
  } finally { IDBObjectStore.prototype.put = original; }
});

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
}

test('servidor real: HTTP malformado e acknowledgements inválidos não o terminam', { timeout: 20000 }, async () => {
  const reservation = http.createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const child = spawn(process.execPath, ['server/index.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d; });
  child.stderr.on('data', (d) => { logs += d; });
  const clients = [];
  try {
    for (let i = 0; i < 100 && !logs.includes('Signaling em'); i++) {
      assert.equal(child.exitCode, null, logs);
      await delay(30);
    }
    assert.match(logs, /Signaling em/);
    assert.equal(await get(port, '/%ZZ'), 400);
    assert.equal(await get(port, '/%00'), 400);
    assert.equal(await get(port, '/..%2fdist-other%2fsecret'), 403);
    assert.equal(await get(port, '/'), 200);
    async function login() {
      const identity = await generateIdentityKeys();
      const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], autoConnect: false, reconnection: false });
      clients.push(socket);
      const ready = new Promise((resolve, reject) => {
        socket.on('connect_error', reject);
        socket.on('auth:challenge', async (nonce) => {
          try {
            const signature = await signNonce(identity.privateKey, nonce);
            socket.emit('auth:response', { jwk: identity.publicJwk, signature }, (res) => res.ok ? resolve() : reject(new Error('auth')));
          } catch (e) { reject(e); }
        });
      });
      socket.connect(); await ready;
      return { socket, identity };
    }
    const a = await login(), b = await login();
    a.socket.emit('msg', {}, { invalid: true });
    a.socket.emit('signal', {}, 'not-a-function');
    a.socket.emit('presence:watch', [], { invalid: true });
    const received = once(b.socket, 'msg');
    const msg = { id: 'real', text: 'teste', ts: Date.now(), participants: [a.identity.id, b.identity.id] };
    const delivered = await a.socket.timeout(3000).emitWithAck('msg', { to: [b.identity.id], msg });
    assert.deepEqual(delivered, [b.identity.id]);
    assert.equal((await received)[0].msg.text, 'teste');
    await delay(100);
    assert.equal(child.exitCode, null, logs);
    assert.equal(await get(port, '/'), 200);
  } finally {
    clients.forEach((s) => s.close());
    const exited = once(child, 'exit'); child.kill(); await exited;
  }
});
