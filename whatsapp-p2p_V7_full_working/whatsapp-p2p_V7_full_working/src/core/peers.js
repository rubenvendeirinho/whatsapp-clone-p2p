// PeerManager: uma RTCPeerConnection por contacto, usada para
//   • DataChannel (ficheiros e mensagens de voz, cifrado DTLS, ponto a ponto)
//   • áudio/vídeo das chamadas
// A sinalização passa pelo servidor (função `signal`), mas os dados nunca.
import { Emitter } from "../lib/emitter.js";

const CHUNK = 16 * 1024;          // tamanho seguro entre browsers
const READ = 256 * 1024;          // leitura do ficheiro em blocos maiores
const HIGH = 1 << 20;             // pausa o envio acima de 1 MiB em buffer
const LOW = 256 * 1024;
const CALL_TIMEOUT = 45_000;
const OPEN_TIMEOUT = 20_000;
const SID = crypto.randomUUID();  // identifica esta sessão da página

export const MEDIA_AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
export const MEDIA_VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" };

class Peer {
  constructor(mgr, id) {
    this.mgr = mgr;
    this.id = id;
    this.polite = mgr.myId < id;      // papéis determinísticos para "perfect negotiation"
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.closed = false;
    this.failures = 0;
    this.remoteSid = null;
    this.incoming = new Map();        // id -> { meta, sink, received, chain, error }
    this.outgoing = new Map();        // id -> { meta, cancelled, sending }
    this.currentIn = null;
    this.sendChain = Promise.resolve();

    const pc = (this.pc = new RTCPeerConnection({ iceServers: mgr.iceServers }));
    const dc = (this.dc = pc.createDataChannel("data", { negotiated: true, id: 0, ordered: true }));
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = LOW;
    this.opened = new Promise((res, rej) => { dc.onopen = () => res(); this._failOpen = rej; });
    this.opened.catch(() => {});

    dc.onmessage = (e) => this.#onData(e.data);
    dc.onclose = () => this.close("closed");

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.#send({ description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } catch (e) { console.warn("negotiation", e); } finally { this.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.#send({ candidate: candidate.toJSON() }); };
    pc.ontrack = (e) => mgr._onTrack(this, e);
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" && ++this.failures < 3) pc.restartIce?.();
      else if (pc.iceConnectionState === "failed") this.close("ice-failed");
    };
  }

  #send(payload) { return this.mgr.signal(this.id, { k: "rtc", sid: SID, ...payload }); }

  async onRtc({ description, candidate }) {
    const pc = this.pc;
    try {
      if (description) {
        const collision = description.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          this.#send({ description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch (e) { if (!this.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn("rtc", e); }
  }

  async ready() {
    if (this.dc.readyState === "open") return;
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), OPEN_TIMEOUT); });
    try { await Promise.race([this.opened, timeout]); } finally { clearTimeout(timer); }
  }

  #json(o) { this.dc.send(JSON.stringify(o)); }

  // ---------- protocolo do DataChannel ----------
  #onData(d) {
    if (typeof d !== "string") return this.#onChunk(d);
    let m;
    try { m = JSON.parse(d); } catch { return; }
    if (!m || typeof m !== "object" || Array.isArray(m)) return;
    switch (m.t) {
      case "offer": this.mgr.emit("xfer:offer", { peerId: this.id, meta: m.meta }); break;
      case "accept": this.#startSend(m.id); break;
      case "decline": this.#remoteRefused(m.id); break;
      case "begin": this.currentIn = this.incoming.has(m.id) ? m.id : null; break;
      case "end": void this.#finishIn(m.id); break;
      case "cancel":
        if (this.outgoing.has(m.id)) this.#remoteRefused(m.id);
        else this.cancel(m.id, true);
        break;
      case "ack":
        if (this.outgoing.delete(m.id)) this.mgr.emit("xfer:acked", { peerId: this.id, id: m.id });
        break;
    }
  }

  #remoteRefused(id) {
    const o = this.outgoing.get(id);
    if (!o) return;
    o.cancelled = true;
    this.outgoing.delete(id);
    this.mgr.emit("xfer:declined", { peerId: this.id, id });
  }

  // --- envio ---
  async offer(meta) {
    await this.ready();
    this.outgoing.set(meta.id, { meta, cancelled: false, sending: false });
    this.#json({ t: "offer", meta });
  }

  #startSend(id) {
    const o = this.outgoing.get(id);
    if (!o || o.sending) return;
    o.sending = true;
    this.sendChain = this.sendChain.then(() => this.#stream(id));       // um envio de cada vez por canal
  }

  async #stream(id) {
    const o = this.outgoing.get(id);
    if (!o) return;
    try {
      const blob = await this.mgr.loadBlob(id);
      if (!blob) throw new Error("no-blob");
      const total = blob.size;
      this.#json({ t: "begin", id });
      let off = 0;
      while (off < total) {
        if (o.cancelled) throw new Error("cancelled");
        const buf = await blob.slice(off, off + READ).arrayBuffer();
        for (let i = 0; i < buf.byteLength; i += CHUNK) {
          if (this.dc.readyState !== "open") throw new Error("closed");
          if (this.dc.bufferedAmount > HIGH) await this.#drain();
          this.dc.send(new Uint8Array(buf, i, Math.min(CHUNK, buf.byteLength - i)));
        }
        off += buf.byteLength;
        this.mgr._progress(id, this.id, "out", off, total);
      }
      if (o.cancelled) throw new Error("cancelled");
      this.#json({ t: "end", id });
    } catch (e) {
      if (!o.cancelled && this.outgoing.delete(id)) {
        try { if (this.dc.readyState === "open") this.#json({ t: "cancel", id }); } catch { /* ignora */ }
        this.mgr.emit("xfer:fail", { peerId: this.id, id, dir: "out", reason: e.message });
      }
    }
  }

  #drain() {
    return new Promise((resolve, reject) => {
      const dc = this.dc;
      const cleanup = () => { dc.removeEventListener("bufferedamountlow", ok); dc.removeEventListener("close", fail); };
      const ok = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error("closed")); };
      dc.addEventListener("bufferedamountlow", ok);
      dc.addEventListener("close", fail);
    });
  }

  // --- receção ---
  accept(meta, sink) {
    if (this.dc.readyState !== "open") throw new Error("offline");
    this.incoming.set(meta.id, { meta, sink, received: 0, chain: Promise.resolve(), error: null });
    this.#json({ t: "accept", id: meta.id });
  }

  decline(id) { try { this.#json({ t: "decline", id }); } catch { /* canal fechado */ } }
  ack(id) { try { this.#json({ t: "ack", id }); } catch { /* o emissor volta a oferecer */ } }

  #onChunk(buf) {
    const t = this.incoming.get(this.currentIn);
    if (!t || !(buf instanceof ArrayBuffer)) return;
    t.received += buf.byteLength;
    if (t.received > t.meta.size) return this.cancel(t.meta.id);          // mais bytes do que anunciado
    t.chain = t.chain.then(() => t.sink.write(buf)).catch((e) => { t.error = e; });
    this.mgr._progress(t.meta.id, this.id, "in", t.received, t.meta.size);
  }

  async #finishIn(id) {
    const t = this.incoming.get(id);
    if (!t || t.finishing) return;
    t.finishing = true;
    await t.chain;
    if (this.incoming.get(id) !== t) return;
    this.incoming.delete(id);
    if (this.currentIn === id) this.currentIn = null;
    if (t.error || t.received !== t.meta.size) {
      await t.sink.abort().catch(() => {});
      try { this.#json({ t: "cancel", id }); } catch { /* ignora */ }
      return this.mgr.emit("xfer:fail", { peerId: this.id, id, dir: "in", reason: t.error?.message || "incomplete" });
    }
    try {
      const blob = await t.sink.close();
      this.mgr.emit("xfer:done", { peerId: this.id, id, blob, meta: t.meta });
    } catch (e) {
      await t.sink.abort().catch(() => {});
      try { this.#json({ t: "cancel", id }); } catch { /* canal fechado */ }
      this.mgr.emit("xfer:fail", { peerId: this.id, id, dir: "in", reason: e.message });
    }
  }

  /** Cancela localmente (e avisa o outro lado, salvo se foi ele a cancelar). */
  cancel(id, remote = false) {
    const t = this.incoming.get(id);
    if (t) {
      this.incoming.delete(id);
      if (this.currentIn === id) this.currentIn = null;
      void t.chain.then(() => t.sink.abort()).catch(() => {});
      this.mgr.emit("xfer:fail", { peerId: this.id, id, dir: "in", reason: "cancelled" });
    }
    const o = this.outgoing.get(id);
    if (o) {
      o.cancelled = true;
      this.outgoing.delete(id);
      this.mgr.emit("xfer:fail", { peerId: this.id, id, dir: "out", reason: "cancelled" });
    }
    if (!remote) { try { this.#json({ t: "cancel", id }); } catch { /* ignora */ } }
  }

  close(reason = "closed") {
    if (this.closed) return;
    this.closed = true;
    if (this.mgr.peers.get(this.id) === this) this.mgr.peers.delete(this.id);
    for (const [id, t] of this.incoming) {
      void t.chain.then(() => t.sink.abort()).catch(() => {});
      this.mgr.emit("xfer:fail", { peerId: this.id, id, dir: "in", reason });
    }
    for (const [id, o] of this.outgoing) {
      o.cancelled = true;
      this.mgr.emit("xfer:fail", { peerId: this.id, id, dir: "out", reason });
    }
    this.incoming.clear();
    this.outgoing.clear();
    this._failOpen?.(new Error(reason));
    try { this.dc.close(); } catch { /* ok */ }
    try { this.pc.close(); } catch { /* ok */ }
    this.mgr._onPeerClosed(this);
  }
}

export class PeerManager extends Emitter {
  /**
   * @param {{myId:string, signal:(to:string,data:object)=>Promise<boolean>, loadBlob:(id:string)=>Promise<Blob|null>}} o
   */
  constructor({ myId, signal, loadBlob }) {
    super();
    this.myId = myId;
    this.signal = signal;
    this.loadBlob = loadBlob;
    this.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    this.peers = new Map();
    this.call = null;
    this._callTimer = null;
    this._lastProg = new Map();
  }

  setIce(servers) { if (Array.isArray(servers) && servers.length) this.iceServers = servers; }

  ensure(id, sid) {
    let p = this.peers.get(id);
    if (p && sid && p.remoteSid && p.remoteSid !== sid) { p.close("session-changed"); p = null; } // o outro lado recarregou
    if (!p) { p = new Peer(this, id); this.peers.set(id, p); }
    if (sid) p.remoteSid = sid;
    return p;
  }

  async onSignal(from, data) {
    if (!data || typeof data !== "object") return;
    if (data.k === "call") return this._onCallSignal(from, data);
    if (data.k === "rtc") await this.ensure(from, data.sid).onRtc(data);
  }

  peerOffline(id) {
    this.peers.get(id)?.close("offline");
    if (this.call?.peerId === id) this._finish(this.call.state === "ringing" ? "missed" : "failed");
  }

  // ---------- transferências ----------
  offerTransfer(peerId, meta) { return this.ensure(peerId).offer(meta); }
  acceptTransfer(peerId, meta, sink) { this.ensure(peerId).accept(meta, sink); }
  declineTransfer(peerId, id) { this.peers.get(peerId)?.decline(id); }
  ackTransfer(peerId, id) { this.peers.get(peerId)?.ack(id); }
  cancelTransfer(peerId, id) { this.peers.get(peerId)?.cancel(id); }
  isOpen(peerId) { return this.peers.get(peerId)?.dc.readyState === "open"; }

  _progress(id, peerId, dir, done, total) {
    const now = performance.now();
    if (done < total && now - (this._lastProg.get(id) ?? 0) < 100) return;
    this._lastProg.set(id, now);
    this.emit("xfer:progress", { id, peerId, dir, done, total });
  }

  // ---------- chamadas ----------
  #snap() {
    const c = this.call;
    return c && { ...c, senders: undefined };
  }
  #update(patch) { if (!this.call) return; Object.assign(this.call, patch); this.emit("call", this.#snap()); }
  #getMedia(video) {
    return navigator.mediaDevices.getUserMedia({ audio: MEDIA_AUDIO, video: video ? MEDIA_VIDEO : false });
  }

  async startCall(peerId, video) {
    if (this.call) throw new Error("busy");
    const stream = await this.#getMedia(video);
    if (this.call) { stream.getTracks().forEach((t) => t.stop()); throw new Error("busy"); }
    const cid = crypto.randomUUID();
    this.call = {
      cid, peerId, dir: "out", video, state: "calling", startedAt: null, muted: false,
      camOn: video, remoteCamOn: false, localStream: stream, remoteStream: new MediaStream(), senders: [],
    };
    this.emit("call", this.#snap());
    this.ensure(peerId);                                           // aquece a ligação enquanto toca
    const ok = await this.signal(peerId, { k: "call", a: "invite", cid, video });
    if (this.call?.cid !== cid) return;
    if (!ok) return this._finish("offline");
    this._callTimer = setTimeout(() => this.#timeout(), CALL_TIMEOUT);
  }

  #timeout() {
    const c = this.call;
    if (!c || (c.state !== "calling" && c.state !== "ringing")) return;
    this.signal(c.peerId, { k: "call", a: "end", cid: c.cid });
    this._finish(c.state === "calling" ? "noanswer" : "missed");
  }

  async acceptCall() {
    const c = this.call;
    if (!c || c.state !== "ringing") return;
    clearTimeout(this._callTimer);
    let stream;
    try { stream = await this.#getMedia(c.video); }
    catch (e) {
      this.signal(c.peerId, { k: "call", a: "reject", cid: c.cid });
      this._finish("failed");
      throw e;
    }
    if (this.call !== c) { stream.getTracks().forEach((t) => t.stop()); return; } // desistiram entretanto
    c.localStream = stream;
    this.#update({ camOn: c.video, state: "connecting" });
    this.#attachLocal();
    this.signal(c.peerId, { k: "call", a: "accept", cid: c.cid });
  }

  #attachLocal() {
    const c = this.call;
    const p = this.ensure(c.peerId);
    for (const t of c.localStream.getTracks()) c.senders.push(p.pc.addTrack(t, c.localStream));
  }

  hangup() {
    const c = this.call;
    if (!c) return;
    const ringing = c.state === "ringing";
    this.signal(c.peerId, { k: "call", a: ringing ? "reject" : "end", cid: c.cid });
    this._finish(ringing ? "rejected" : c.state === "calling" ? "cancelled" : "ended");
  }

  toggleMute() {
    const c = this.call;
    if (!c?.localStream) return;
    const muted = !c.muted;
    c.localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.#update({ muted });
  }

  async toggleVideo() {
    const c = this.call;
    if (!c?.localStream) return;
    let v = c.localStream.getVideoTracks()[0];
    if (v) v.enabled = !v.enabled;
    else {                                                          // voz -> vídeo a meio da chamada
      const s = await navigator.mediaDevices.getUserMedia({ video: MEDIA_VIDEO });
      if (this.call !== c) { s.getTracks().forEach((t) => t.stop()); return; }
      v = s.getVideoTracks()[0];
      c.localStream.addTrack(v);
      c.senders.push(this.ensure(c.peerId).pc.addTrack(v, c.localStream));
    }
    this.#update({ camOn: v.enabled, video: true });
    this.signal(c.peerId, { k: "call", a: "cam", cid: c.cid, on: v.enabled });
  }

  _onTrack(peer, e) {
    const c = this.call;
    if (!c || c.peerId !== peer.id) return;
    const rs = c.remoteStream;
    if (!rs.getTracks().includes(e.track)) rs.addTrack(e.track);
    e.track.onended = () => rs.removeTrack(e.track);
    const patch = { remoteCamOn: c.remoteCamOn || e.track.kind === "video" };
    if (c.state === "connecting" || c.state === "calling") { patch.state = "active"; patch.startedAt = c.startedAt ?? Date.now(); }
    this.#update(patch);
  }

  _onCallSignal(from, d) {
    const c = this.call;
    if (d.a === "invite") {
      if (c) return void this.signal(from, { k: "call", a: "busy", cid: d.cid });
      this.call = {
        cid: d.cid, peerId: from, dir: "in", video: !!d.video, state: "ringing", startedAt: null, muted: false,
        camOn: false, remoteCamOn: false, localStream: null, remoteStream: new MediaStream(), senders: [],
      };
      this._callTimer = setTimeout(() => this.#timeout(), CALL_TIMEOUT);
      return void this.emit("call", this.#snap());
    }
    if (!c || c.cid !== d.cid || c.peerId !== from) return;
    switch (d.a) {
      case "accept":
        if (c.state !== "calling") return;
        clearTimeout(this._callTimer);
        this.#update({ state: "connecting" });
        this.#attachLocal();
        break;
      case "reject": this._finish("rejected"); break;
      case "busy": this._finish("busy"); break;
      case "end": this._finish(c.state === "ringing" ? "missed" : c.state === "calling" ? "noanswer" : "ended"); break;
      case "cam": this.#update({ remoteCamOn: !!d.on }); break;
    }
  }

  _finish(outcome) {
    const c = this.call;
    if (!c) return;
    clearTimeout(this._callTimer);
    this.call = null;
    c.localStream?.getTracks().forEach((t) => t.stop());
    const p = this.peers.get(c.peerId);
    if (p && !p.closed) for (const s of c.senders) { try { p.pc.removeTrack(s); } catch { /* já removido */ } }
    this.emit("call", null);
    this.emit("call:ended", {
      cid: c.cid, peerId: c.peerId, dir: c.dir, video: c.video, outcome,
      duration: c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0,
    });
  }

  _onPeerClosed(peer) {
    if (this.call?.peerId === peer.id && this.call.state !== "ringing") this._finish("failed");
  }

  dispose() {
    this._finish("ended");
    for (const p of [...this.peers.values()]) p.close("dispose");
  }
}
