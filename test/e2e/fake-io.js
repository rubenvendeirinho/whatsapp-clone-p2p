// Substitui o "socket.io-client" no teste: fala com o Hub (Node) através de bindings do Playwright.
const socks = new Map();
window.__deliver = (sid, event, payload) => {
  const s = socks.get(sid);
  if (!s) return;
  if (event === "connect") s.connected = true;
  (s.h[event] ?? []).forEach((f) => f(payload));
};

export function io() {
  const s = {
    connected: false, h: {}, sid: null,
    on(e, f) { (s.h[e] ??= []).push(f); return s; },
    emit(e, p, ack) { window.__hubEmit(s.sid, e, p).then((r) => ack && ack(r)); },
    timeout() { return { emit: (e, p, cb) => s.emit(e, p, (r) => cb(null, r)) }; },
    disconnect() { s.connected = false; },
    close() { s.connected = false; },
  };
  window.__hubConnect().then((sid) => { s.sid = sid; socks.set(sid, s); });
  return s;
}
