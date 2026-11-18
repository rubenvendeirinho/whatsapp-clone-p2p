// Garante que o que o browser produz (WebCrypto) é aceite pelo servidor (node:crypto)
// e que o ID derivado coincide nos dois lados.
import test from "node:test";
import assert from "node:assert/strict";
import { generateIdentityKeys, signNonce } from "../src/lib/crypto.js";
import { verifyAuth, newNonce, idFromXY, iceServersFor, validMsg } from "../server/auth.js";

test("assinatura do cliente é aceite e devolve o mesmo ID", async () => {
  const { id, publicJwk, privateKey } = await generateIdentityKeys();
  const nonce = newNonce();
  const signature = await signNonce(privateKey, nonce);
  assert.equal(verifyAuth({ nonce, jwk: publicJwk, signature }), id);
  assert.equal(idFromXY(publicJwk.x, publicJwk.y), id);
  assert.match(id, /^[A-Z2-7]{20}$/);
});

test("rejeita nonce diferente, assinatura de outra chave e lixo", async () => {
  const a = await generateIdentityKeys();
  const b = await generateIdentityKeys();
  const nonce = newNonce();
  const sigA = await signNonce(a.privateKey, nonce);
  assert.equal(verifyAuth({ nonce: newNonce(), jwk: a.publicJwk, signature: sigA }), null);   // replay com outro desafio
  assert.equal(verifyAuth({ nonce, jwk: b.publicJwk, signature: sigA }), null);               // personificação
  assert.equal(verifyAuth({ nonce, jwk: { kty: "RSA" }, signature: sigA }), null);
  assert.equal(verifyAuth({ nonce, jwk: a.publicJwk, signature: "????" }), null);
  assert.equal(verifyAuth({}), null);
  assert.equal(verifyAuth(undefined), null);
});

test("ICE: STUN por omissão e credenciais TURN temporárias", () => {
  assert.equal(iceServersFor("X", {}).length, 1);
  const s = iceServersFor("ID1", { TURN_URLS: "turn:t.example:3478", TURN_SECRET: "s3cret" }, 1_000_000);
  const turn = s[1];
  assert.equal(turn.username, `${1000 + 43200}:ID1`);
  assert.ok(turn.credential.length > 10);
});

test("validMsg: só aceita mensagens coerentes", () => {
  const A = "A".repeat(20), B = "B".repeat(20), C = "C".repeat(20);
  const msg = { id: "1", ts: 1, text: "olá", participants: [A, B] };
  assert.ok(validMsg(A, [B], msg));
  assert.ok(!validMsg(C, [B], msg), "remetente não pertence aos participantes");
  assert.ok(!validMsg(A, [C], msg), "destinatário não pertence aos participantes");
  assert.ok(!validMsg(A, [B], { ...msg, text: "x".repeat(9000) }));
  assert.ok(!validMsg(A, [], msg));
  assert.ok(!validMsg(A, ["nope"], msg));
});
