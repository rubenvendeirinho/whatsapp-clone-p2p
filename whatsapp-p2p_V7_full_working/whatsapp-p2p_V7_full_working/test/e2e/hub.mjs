// Hub de teste: reproduz os handlers de server/index.js usando as MESMAS funções de validação
// (server/auth.js), mas sem socket.io (usa bindings do Playwright em vez de websockets).
import { newNonce, verifyAuth, validMsg, ID_RE } from "../../server/auth.js";

export class Hub {
  socks = new Map(); online = new Map(); n = 0;

  attach(page) {
    page.exposeFunction("__hubConnect", async () => {
      const sid = ++this.n, nonce = newNonce();
      this.socks.set(sid, { page, id: null, nonce, watching: new Set() });
      setTimeout(() => this.push(sid, "connect"), 50);
      setTimeout(() => this.push(sid, "auth:challenge", nonce), 80);
      return sid;
    });
    page.exposeFunction("__hubEmit", (sid, event, payload) => this.handle(sid, event, payload));
    page.on("close", () => {
      for (const [sid, s] of this.socks) if (s.page === page) this.drop(sid);
    });
  }

  push(sid, event, payload) {
    this.socks.get(sid)?.page.evaluate(([a, b, c]) => window.__deliver?.(a, b, c), [sid, event, payload]).catch(() => {});
  }

  presence(id, on) {
    for (const [sid, s] of this.socks) if (s.watching.has(id)) this.push(sid, "presence", { id, online: on });
  }

  drop(sid) {
    const s = this.socks.get(sid);
    this.socks.delete(sid);
    if (s?.id && this.online.get(s.id) === sid) { this.online.delete(s.id); this.presence(s.id, false); }
  }

  handle(sid, event, p) {
    const s = this.socks.get(sid);
    if (!s) return;
    if (event === "auth:response") {
      const id = verifyAuth({ nonce: s.nonce, jwk: p?.jwk, signature: p?.signature });
      if (!id) return { ok: false };
      const prev = this.online.get(id);
      if (prev && prev !== sid) this.drop(prev);
      s.id = id; this.online.set(id, sid);
      this.presence(id, true);
      return { ok: true, id, ice: [{ urls: "stun:stun.l.google.com:19302" }] };
    }
    if (!s.id) return;
    if (event === "msg") {
      if (!validMsg(s.id, p?.to, p?.msg)) return [];
      const out = [];
      for (const to of new Set(p.to)) {
        const t = this.online.get(to);
        if (t && to !== s.id) { this.push(t, "msg", { from: s.id, msg: p.msg }); out.push(to); }
      }
      return out;
    }
    if (event === "signal") {
      const t = typeof p?.to === "string" && ID_RE.test(p.to) && this.online.get(p.to);
      if (!t || typeof p.data !== "object") return false;
      this.push(t, "signal", { from: s.id, data: p.data });
      return true;
    }
    if (event === "presence:watch") {
      s.watching = new Set((p || []).filter((i) => ID_RE.test(i)));
      return [...s.watching].filter((i) => this.online.has(i));
    }
  }
}
