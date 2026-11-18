// Sinalização autenticada, com HTTP polling e upgrade opcional para WebSocket.
// Alguns proxies/túneis deixam passar HTML mas não o upgrade WebSocket.
import { io } from "socket.io-client";
import { Emitter } from "../lib/emitter.js";
import { signNonce } from "../lib/crypto.js";

export class Net extends Emitter {
  constructor(identity, url = import.meta.env?.VITE_SOCKET_URL || undefined) {
    super();
    this.identity = identity;
    this.url = url;
    this.state = "connecting";
    this.closed = false;
    this.authTimer = null;
    this.retryTimer = null;
    this.lastDiagnostic = 0;
    this.socket = io(url, {
      transports: ["polling", "websocket"],
      upgrade: true,
      tryAllTransports: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 12000,
    });
    const s = this.socket;

    s.on("connect", () => {
      this.#set("connecting");
      this.emit("diagnostic", "");
      clearTimeout(this.authTimer);
      this.authTimer = setTimeout(() => {
        if (this.closed || this.state !== "connecting") return;
        this.emit("diagnostic", "A ligação abriu, mas a autenticação não terminou. Confirme que este endereço aponta para o servidor desta aplicação.");
        this.#set("offline");
        s.disconnect();
        this.retryTimer = setTimeout(() => !this.closed && s.connect(), 2000);
      }, 12000);
    });
    s.on("auth:challenge", async (nonce) => {
      const connectionId = s.id;
      try {
        const signature = await signNonce(this.identity.privateKey, nonce);
        if (this.closed || !s.connected || s.id !== connectionId) return;
        s.timeout(8000).emit("auth:response", { jwk: this.identity.publicJwk, signature }, (err, res) => {
          if (this.closed || s.id !== connectionId) return;
          if (err) {
            this.emit("diagnostic", "O servidor não confirmou a autenticação. Verifique o terminal de sinalização.");
            clearTimeout(this.authTimer);
            this.#set("offline");
            s.disconnect();
            this.retryTimer = setTimeout(() => !this.closed && s.connect(), 2000);
            return;
          }
          clearTimeout(this.authTimer);
          if (res?.ok && res.id === this.identity.id) {
            this.emit("diagnostic", "");
            this.#set("online");
            this.emit("ready", { ice: res.ice });
          } else {
            this.emit("diagnostic", "A assinatura da identidade não foi aceite pelo servidor.");
            this.#set("denied");
            s.disconnect();
          }
        });
      } catch (e) {
        clearTimeout(this.authTimer);
        console.error("[sinalização] Falha ao assinar o desafio:", e);
        this.emit("diagnostic", "Não foi possível assinar a identidade. Abra a aplicação por HTTPS (ngrok) ou localhost; não apague os dados do navegador.");
        this.#set("denied");
        s.disconnect();
      }
    });
    s.on("disconnect", (reason) => {
      clearTimeout(this.authTimer);
      if (this.closed || ["replaced", "denied"].includes(this.state)) return;
      this.#set("offline");
      this.emit("diagnostic", `Ligação interrompida: ${reason || "motivo desconhecido"}.`);
      // O Socket.IO não reconecta sozinho após disconnect(true) do servidor.
      if (reason === "io server disconnect") {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => !this.closed && s.connect(), 2000);
      }
    });
    s.on("connect_error", (err) => {
      if (this.closed) return;
      this.#set("offline");
      this.emit("diagnostic", `Falha na sinalização: ${err.message}. A verificar /api/health…`);
      void this.#diagnose();
    });
    s.on("replaced", () => { this.#set("replaced"); s.disconnect(); });
    s.on("msg", (p) => this.emit("msg", p));
    s.on("signal", (p) => this.emit("signal", p));
    s.on("presence", (p) => this.emit("presence", p));
  }

  async #diagnose() {
    if (Date.now() - this.lastDiagnostic < 5000) return;
    this.lastDiagnostic = Date.now();
    const base = this.url || (typeof location !== "undefined" ? location.origin : null);
    if (!base) return;
    let message;
    try {
      const health = new URL("/api/health", base.replace(/^ws/, "http"));
      const res = await fetch(health, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data?.service === "whatsapp-p2p-signaling") {
        message = "Servidor acessível, mas /socket.io não liga. Verifique se o túnel aponta para a mesma porta da aplicação e se o proxy foi reiniciado.";
      } else {
        message = "Este endereço não alcança a sinalização. Use npm run dev:all e ngrok http 5173; não use preview sem o servidor Node a correr.";
      }
    } catch {
      message = "Servidor inacessível. Inicie npm run dev:all. Se VITE_SOCKET_URL aponta para localhost, remova essa variável para acesso pelo ngrok.";
    }
    if (!this.closed && this.state === "offline") this.emit("diagnostic", message);
  }

  #set(state) { this.state = state; this.emit("state", state); }

  #call(event, payload, fallback) {
    return new Promise((resolve) => {
      if (!this.socket.connected || this.state !== "online") return resolve(fallback);
      this.socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? fallback : res));
    });
  }

  /** Pedido genérico com resposta; rejeita se não houver ligação ou se o servidor não responder. */
  request(event, payload) {
    return new Promise((resolve, reject) => {
      if (!this.socket.connected || this.state !== "online") return reject(new Error("Sem ligação ao servidor."));
      this.socket.timeout(10000).emit(event, payload, (err, res) => (err ? reject(new Error("O servidor não respondeu.")) : resolve(res)));
    });
  }

  sendMsg(to, msg) { return this.#call("msg", { to, msg }, []); }
  signal(to, data) { return this.#call("signal", { to, data }, false); }
  watch(ids) { return this.#call("presence:watch", ids, []); }

  reconnect() {
    if (this.closed) return;
    clearTimeout(this.authTimer);
    clearTimeout(this.retryTimer);
    this.#set("connecting");
    this.emit("diagnostic", "");
    this.socket.disconnect();
    this.socket.connect();
  }

  close() {
    this.closed = true;
    clearTimeout(this.authTimer);
    clearTimeout(this.retryTimer);
    this.socket.close();
  }
}
