import test from 'node:test';
import assert from 'node:assert/strict';
import { Accounts, validBackup, createMailer } from '../server/accounts.js';
import { validMsg, validLoc } from '../server/auth.js';
import { generateIdentityKeys, exportPrivateJwk, importIdentity, signNonce } from '../src/lib/crypto.js';
import { deriveBackupKey, encryptJson, decryptJson, newSalt } from '../src/lib/backup.js';
import { cleanSettings } from '../src/lib/settings.js';
import { cleanLoc, distance } from '../src/lib/geo.js';
import { worldPx, fromWorldPx } from '../src/lib/mapmath.js';

const A = 'A'.repeat(20), B = 'B'.repeat(20);
const BK = { salt: 'saltsaltsalt', iv: 'iviviviv', ct: 'cipher' };
const mk = () => { let t = 1_000_000; const a = new Accounts(null, () => t); a.tick = (ms) => (t += ms); return a; };

test('conta: pedir código, ligar email e restaurar', () => {
  const a = mk();
  const { code } = a.issueCode('Ana@Gmail.com', '1.1.1.1');
  assert.match(code, /^\d{6}$/);
  assert.equal(a.link({ email: 'ana@gmail.com', code: '000000', id: A, backup: BK }).error, 'codigo-invalido');
  const r = a.issueCode('ana@gmail.com'); assert.equal(r.error, 'aguarde');
  a.tick(60_000);
  const c2 = a.issueCode('ana@gmail.com', '1.1.1.1').code;
  assert.deepEqual(Object.keys(a.link({ email: 'ana@gmail.com', code: c2, id: A, backup: BK })).sort(), ['ok', 'ts']);
  assert.equal(a.status(A).email, 'ana@gmail.com');
  a.tick(60_000);
  const c3 = a.issueCode('ana@gmail.com', '1.1.1.1').code;
  const res = a.restore('ana@gmail.com', c3);
  assert.equal(res.ok, true); assert.equal(res.id, A); assert.deepEqual(res.backup, BK);
  assert.equal(a.restore('ana@gmail.com', c3).error, 'codigo-invalido');   // código é de uso único
});

test('conta: código expira, limita tentativas e email não pode ser de outra identidade', () => {
  const a = mk();
  let c = a.issueCode('x@y.pt').code;
  a.tick(11 * 60_000);
  assert.equal(a.restore('x@y.pt', c).error, 'codigo-invalido');
  a.tick(60_000);
  c = a.issueCode('x@y.pt').code;
  for (let i = 0; i < 5; i++) assert.equal(a.restore('x@y.pt', '999999' === c ? '111111' : '999999').error, 'codigo-invalido');
  assert.equal(a.restore('x@y.pt', c).error, 'codigo-invalido');          // tentativas esgotadas
  a.tick(60_000);
  const ok = a.issueCode('x@y.pt').code;
  assert.ok(a.link({ email: 'x@y.pt', code: ok, id: A, backup: BK }).ok);
  a.tick(60_000);
  const other = a.issueCode('x@y.pt').code;
  assert.equal(a.link({ email: 'x@y.pt', code: other, id: B, backup: BK }).error, 'email-em-uso');
  assert.equal(a.setBackup(B, BK).error, 'sem-conta');
  assert.ok(a.setBackup(A, { ...BK, ct: 'novo' }).ok);
  assert.ok(a.remove(A).ok); assert.equal(a.status(A), null);
});

test('conta: emails inválidos e limites por hora', () => {
  const a = mk();
  assert.equal(a.issueCode('sem-arroba').error, 'email-invalido');
  for (let i = 0; i < 5; i++) { a.tick(60_000); assert.ok(a.issueCode('l@l.pt').code); }
  a.tick(60_000);
  assert.equal(a.issueCode('l@l.pt').error, 'limite');
  assert.equal(validBackup({ salt: 's'.repeat(10), iv: 'i', ct: 'x'.repeat(100_000) }), false);
});

test('mailer: sem Gmail configurado escreve o código no terminal', async () => {
  const lines = [];
  const m = createMailer({}, { log: (s) => lines.push(s), error() {} });
  assert.equal(m.configured, false);
  assert.equal(await m.sendCode('a@b.pt', '123456'), 'console');
  assert.match(lines[0], /123456/);
});

test('localização: validação no servidor e no cliente', () => {
  const msg = { id: 'm', ts: 1, text: '', kind: 'location', loc: { lat: 38.7, lng: -9.1, acc: 12 }, participants: [A, B] };
  assert.equal(validMsg(A, [B], msg), true);
  assert.equal(validMsg(A, [B], { ...msg, loc: { lat: 91, lng: 0 } }), false);
  assert.equal(validMsg(A, [B], { ...msg, loc: { lat: 0, lng: NaN } }), false);
  assert.equal(validMsg(A, [B], { ...msg, kind: 'outro' }), false);
  assert.equal(validMsg(A, [B], { ...msg, liveOf: 'x', liveEnd: true, until: Date.now() }), true);
  assert.equal(validMsg(A, [B], { ...msg, loc: undefined }), false);
  assert.equal(validLoc({ lat: 0, lng: 0, name: 'x'.repeat(81) }), false);
  assert.deepEqual(cleanLoc({ lat: '10', lng: 20, acc: -5, x: 1 }), { lat: 10, lng: 20, acc: 0 });
  assert.equal(cleanLoc({ lat: 200, lng: 0 }), null);
  assert.ok(Math.abs(distance({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195) < 200);
});

test('mapa: conversão coordenadas <-> pixéis é reversível', () => {
  for (const [lat, lng, z] of [[38.72, -9.14, 15], [-33.9, 151.2, 12], [64.1, -21.9, 5]]) {
    const p = worldPx(lat, lng, z), b = fromWorldPx(p.x, p.y, z);
    assert.ok(Math.abs(b.lat - lat) < 1e-6 && Math.abs(b.lng - lng) < 1e-6);
  }
});

test('definições: valores inválidos voltam ao padrão', () => {
  assert.deepEqual(cleanSettings({ ringVolume: 5, ringTone: 'zzz', ringMuted: 1 }), { ringVolume: 1, ringTone: 'classic', ringMuted: true });
  assert.equal(cleanSettings(null).ringVolume, 0.7);
  assert.equal(cleanSettings({ ringVolume: 'abc' }).ringVolume, 0.7);
});

test('cópia de segurança cifrada: identidade recuperada assina e palavra-passe errada falha', async () => {
  const { id, publicJwk, privateKey } = await generateIdentityKeys();
  const payload = { v: 1, identity: { id, publicJwk, privateJwk: await exportPrivateJwk(privateKey) }, contacts: [{ id: A, name: 'Ana' }] };
  const salt = newSalt();
  const env = await encryptJson(await deriveBackupKey('segredo-forte', salt), salt, payload);
  assert.ok(validBackup(env));
  assert.ok(!JSON.stringify(env).includes('"d"') && !JSON.stringify(env).includes('Ana'));
  const back = await decryptJson(await deriveBackupKey('segredo-forte', env.salt), env);
  const key = await importIdentity({ id, publicJwk: back.identity.publicJwk, privateJwk: back.identity.privateJwk });
  const sig = await signNonce(key, 'n');
  const pub = await crypto.subtle.importKey('jwk', { ...publicJwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(sig, 'base64url'), new TextEncoder().encode('wa-p2p-auth-v1:n')));
  await assert.rejects(async () => decryptJson(await deriveBackupKey('errada-errada', env.salt), env), /errada/);
  await assert.rejects(importIdentity({ id: 'Z'.repeat(20), publicJwk, privateJwk: back.identity.privateJwk }));
});
