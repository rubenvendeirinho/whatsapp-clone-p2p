import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as db from "../core/db.js";
import { Net } from "../core/net.js";
import { PeerManager } from "../core/peers.js";
import { startRing, stopRing, configureRing } from "../lib/ring.js";
import { loadSettings, saveSettings, cleanSettings } from "../lib/settings.js";
import { cleanLoc, distance, getPosition } from "../lib/geo.js";
import { linkAccount, loadAccount, backupNow, unlinkAccount } from "../core/account.js";
import { memorySink, diskSink, canWriteToDisk, MEM_LIMIT } from "../lib/sinks.js";
import { validateMeta, PERSIST_MAX } from "../lib/validate.js";
import { ID_RE, byTs, convIdOf, normalizeId, safeName, shortId, uid } from "../lib/format.js";

const Ctx = createContext(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => useContext(Ctx);

const previewOf = (m) =>
  m.kind === "text" ? m.text
  : m.kind === "voice" ? "🎤 Mensagem de voz"
  : m.kind === "file" ? `📎 ${m.name}`
  : m.kind === "location" ? "📍 Localização"
  : m.kind === "call" ? (m.call.video ? "📹 Chamada de vídeo" : "📞 Chamada de voz")
  : "";

function notify(title, body) {
  if (typeof document !== "undefined" && document.hidden && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body, tag: title }); } catch { /* ignora */ }
  }
}

export function AppProvider({ identity, onLogout, children }) {
  const me = identity.id;
  const logoutRef = useRef(onLogout);
  logoutRef.current = onLogout;
  const R = useRef(null);
  R.current ??= {
    convMap: new Map(), contactMap: new Map(), online: {}, selectedId: null,
    outBlobs: new Map(), offered: new Set(), flushing: new Map(), q: Promise.resolve(), net: null, peers: null,
    blocked: new Set(), live: new Map(), settings: cleanSettings(null),
  };

  const [ready, setReady] = useState(false);
  const [netState, setNetState] = useState("connecting");
  const [netError, setNetError] = useState("");
  const [online, setOnline] = useState({});
  const [contacts, setContacts] = useState([]);
  const [convs, setConvs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [transfers, setTransfers] = useState({});
  const [call, setCall] = useState(null);
  const [blocked, setBlocked] = useState([]);
  const [settings, setSettingsState] = useState(() => cleanSettings(null));
  const [account, setAccount] = useState(null);       // { email, ts } quando a conta está ligada
  const [backupError, setBackupError] = useState("");

  const api = useMemo(() => {
    const r = R.current;
    const serial = (fn) => { const p = r.q.then(fn); r.q = p.catch(() => {}); return p; };
    const dropTransfer = (id) => setTransfers((t) => { if (!(id in t)) return t; const n = { ...t }; delete n[id]; return n; });
    const commitConvs = () => setConvs([...r.convMap.values()].sort((a, b) => b.lastTs - a.lastTs));
    const setOnlineMap = (m) => { r.online = m; setOnline(m); };

    const touchConv = (participants, last, incoming = false) => {
      const id = convIdOf(participants);
      const prev = r.convMap.get(id) ?? { id, participants: [...new Set(participants)].sort(), lastTs: 0, preview: "", unread: 0 };
      const newer = last.ts >= prev.lastTs;
      const c = {
        ...prev,
        lastTs: newer ? last.ts : prev.lastTs,
        preview: newer ? previewOf(last) : prev.preview,
        unread: id === r.selectedId ? 0 : prev.unread + (incoming ? 1 : 0),
      };
      r.convMap.set(id, c);
      db.put("convs", c);
      commitConvs();
      return c;
    };

    const addMessage = (m, incoming = false) => serial(async () => {
      await db.put("messages", m);
      touchConv(m.participants, m, incoming);
      if (m.convId === r.selectedId) setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].sort(byTs)));
    });

    /** Atualiza uma mensagem de forma atómica (fn recebe o registo atual). */
    const patchMessage = (id, fn) => serial(async () => {
      const cur = await db.get("messages", id);
      if (!cur) return null;
      const next = { ...cur, ...(typeof fn === "function" ? fn(cur) : fn) };
      await db.put("messages", next);
      setMessages((prev) => prev.map((x) => (x.id === id ? next : x)));
      return next;
    });

    const getBlob = async (id) => r.outBlobs.get(id) ?? (await db.get("blobs", id)) ?? null;
    const markDelivered = (id, peers) => patchMessage(id, (cur) => ({ pendingTo: (cur.pendingTo ?? []).filter((x) => !peers.includes(x)) }));
    const dropOffer = (id, peerId) => r.offered.delete(`${id}:${peerId}`);

    // ---------- envio (outbox por destinatário) ----------
    const deliverText = async (m, targets) => {
      const payload = { id: m.id, participants: m.participants, ts: m.ts, text: m.text ?? "" };
      if (m.kind === "location") Object.assign(payload, { kind: "location", loc: m.loc, ...(m.live ? { until: m.live.until } : {}) });
      const delivered = await r.net.sendMsg(targets, payload);
      if (delivered.length) await markDelivered(m.id, delivered);
    };

    const offerMedia = async (m, peerId) => {
      const key = `${m.id}:${peerId}`;
      if (r.offered.has(key) || !r.online[peerId] || r.blocked.has(peerId)) return;
      r.offered.add(key);
      try {
        await r.peers.offerTransfer(peerId, {
          id: m.id, kind: m.kind, name: m.name, size: m.size, mime: m.mime, dur: m.dur, peaks: m.peaks, ts: m.ts, participants: m.participants,
        });
      } catch { r.offered.delete(key); }
    };

    const flush = async (peerId) => {
      if (!r.net || !r.online[peerId] || r.blocked.has(peerId)) return;
      if (r.flushing.has(peerId)) return void (r.flushing.get(peerId).again = true);
      const st = { again: false };
      r.flushing.set(peerId, st);
      try {
        do {
          st.again = false;
          const list = (await db.byIndex("messages", "pending", peerId)).sort(byTs);
          for (const m of list) {
            if (m.kind === "text" || m.kind === "location") await deliverText(m, [peerId]);
            else if (m.kind === "voice" || m.kind === "file") await offerMedia(m, peerId);
          }
        } while (st.again);
      } finally { r.flushing.delete(peerId); }
    };

    const sendMedia = async (convId, kind, blob, extra) => {
      const conv = r.convMap.get(convId);
      if (!conv) return;
      const others = conv.participants.filter((p) => p !== me);
      const m = {
        id: uid(), convId, participants: conv.participants, from: me, ts: Date.now(), kind, dir: "out",
        size: blob.size, pendingTo: others, ...extra,
      };
      r.outBlobs.set(m.id, blob);
      if (blob.size <= PERSIST_MAX) await db.put("blobs", blob, m.id);
      await addMessage(m);
      others.forEach((p) => flush(p));
    };

    // ---------- receção P2P ----------
    const startReceive = async (m, sink, toDisk) => {
      try {
        r.peers.acceptTransfer(m.from, { id: m.id, size: m.size }, sink);
        await patchMessage(m.id, { status: "receiving", toDisk });
      } catch {
        sink.abort();
        await patchMessage(m.id, { status: "offered" });
      }
    };

    const onOffer = ({ peerId, meta: raw }) => serial(async () => {
      const meta = validateMeta(raw, me, peerId);
      if (!meta) return r.peers.declineTransfer(peerId, raw?.id);
      const existing = await db.get("messages", meta.id);
      if (existing) {
        if (existing.dir !== "in" || existing.from !== peerId) return r.peers.declineTransfer(peerId, meta.id);
        if (existing.status === "done") return r.peers.ackTransfer(peerId, meta.id);
        if (existing.status === "declined") return r.peers.declineTransfer(peerId, meta.id);
        const next = { ...existing, status: "offered" };
        await db.put("messages", next);
        setMessages((prev) => prev.map((x) => (x.id === next.id ? next : x)));
        if (meta.kind === "voice" && r.contactMap.has(peerId)) startReceive(next, memorySink(meta.mime), false);
        return;
      }
      const m = {
        id: meta.id, convId: convIdOf(meta.participants), participants: meta.participants, from: peerId, ts: meta.ts,
        kind: meta.kind, dir: "in", name: meta.name, size: meta.size, mime: meta.mime, dur: meta.dur, peaks: meta.peaks, status: "offered",
      };
      await db.put("messages", m);
      touchConv(m.participants, m, true);
      if (m.convId === r.selectedId) setMessages((prev) => [...prev, m].sort(byTs));
      notify(r.contactMap.get(peerId)?.name ?? shortId(peerId), previewOf(m));
      // Voz de contactos conhecidos é aceite automaticamente; ficheiros exigem confirmação.
      if (m.kind === "voice" && r.contactMap.has(peerId)) startReceive(m, memorySink(m.mime), false);
    });

    const onDone = ({ peerId, id, blob }) => serial(async () => {
      if (blob) await db.put("blobs", blob, id);
      const cur = await db.get("messages", id);
      if (cur) {
        const next = { ...cur, status: "done", hasBlob: !!blob, savedToDisk: !blob };
        await db.put("messages", next);
        setMessages((prev) => prev.map((x) => (x.id === id ? next : x)));
      }
      dropTransfer(id);
      r.peers.ackTransfer(peerId, id);                       // só confirma depois de guardado
    });

    // ---------- ações públicas ----------
    const actions = {
      async select(id) {
        r.selectedId = id;
        setSelectedId(id);
        setMessages([]);
        if (!id) return;
        const list = (await db.byIndex("messages", "conv", id)).sort(byTs);
        if (r.selectedId === id) setMessages(list);
        const c = r.convMap.get(id);
        if (c?.unread) { r.convMap.set(id, { ...c, unread: 0 }); db.put("convs", r.convMap.get(id)); commitConvs(); }
      },

      openChat(ids) {
        const participants = [...new Set([me, ...ids])];
        const id = convIdOf(participants);
        if (!r.convMap.has(id)) touchConv(participants, { ts: Date.now(), kind: "none" });
        return actions.select(id);
      },

      async saveContact(rawId, name) {
        const id = normalizeId(rawId);
        name = String(name ?? "").trim().slice(0, 40);
        if (!ID_RE.test(id)) throw new Error("ID inválido");
        if (id === me) throw new Error("Esse é o seu próprio ID");
        if (!name) throw new Error("Indique um nome");
        const c = { id, name };
        r.contactMap.set(id, c);
        await db.put("contacts", c);
        setContacts([...r.contactMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
        return c;
      },

      async sendText(convId, text) {
        text = String(text ?? "").trim().slice(0, 8000);
        const conv = r.convMap.get(convId);
        if (!text || !conv) return;
        const others = conv.participants.filter((p) => p !== me);
        const m = { id: uid(), convId, participants: conv.participants, from: me, ts: Date.now(), kind: "text", text, dir: "out", pendingTo: others };
        await addMessage(m);
        await deliverText(m, others);
      },

      sendVoice: (convId, { blob, mime, dur, peaks }) =>
        sendMedia(convId, "voice", blob, { name: "Mensagem de voz", mime, dur, peaks }),

      async sendFiles(convId, files) {
        for (const f of files) await sendMedia(convId, "file", f, { name: safeName(f.name), mime: f.type || "application/octet-stream" });
      },

      async acceptFile(msgId) {
        const m = await db.get("messages", msgId);
        if (!m || m.dir !== "in" || m.status === "receiving" || m.status === "done") return;
        let sink, toDisk = false;
        try {
          if (m.kind === "voice") sink = memorySink(m.mime);
          else if (canWriteToDisk()) { sink = await diskSink(m.name); toDisk = true; }      // gesto do utilizador
          else if (m.size <= MEM_LIMIT) sink = memorySink(m.mime);
          else return void (await patchMessage(msgId, { status: "failed", error: "too-big" }));
        } catch (e) {
          if (e?.name === "AbortError") return;                                            // cancelou o diálogo
          throw e;
        }
        await startReceive(m, sink, toDisk);
      },

      async declineFile(msgId) {
        const m = await db.get("messages", msgId);
        if (!m || m.dir !== "in") return;
        r.peers.declineTransfer(m.from, msgId);
        await patchMessage(msgId, { status: "declined" });
      },

      async cancelTransfer(msgId) {
        const m = await db.get("messages", msgId);
        if (!m) return;
        if (m.dir === "in") r.peers.cancelTransfer(m.from, msgId);
        else {
          for (const p of m.pendingTo ?? []) { r.peers.cancelTransfer(p, msgId); dropOffer(msgId, p); }
          await patchMessage(msgId, { pendingTo: [], cancelled: true });
        }
        dropTransfer(msgId);
      },

      async retrySend(msgId) {
        const m = await db.get("messages", msgId);
        for (const p of m?.pendingTo ?? []) { dropOffer(msgId, p); flush(p); }
      },

      getBlob,

      async deleteConversation(id) {
        const list = await db.byIndex("messages", "conv", id);
        for (const m of list) { await db.del("messages", m.id); await db.del("blobs", m.id); r.outBlobs.delete(m.id); }
        r.convMap.delete(id);
        await db.del("convs", id);
        commitConvs();
        if (r.selectedId === id) await actions.select(null);
      },

      // ---------- bloquear / apagar contactos ----------
      async blockContact(id) {
        if (!ID_RE.test(id) || id === me) return;
        r.blocked.add(id);
        await db.put("kv", [...r.blocked], "blocked");
        setBlocked([...r.blocked]);
        if (r.peers.call?.peerId === id) r.peers.hangup();
        r.net?.request("block:set", [...r.blocked]).catch(() => {});
      },

      async unblockContact(id) {
        r.blocked.delete(id);
        await db.put("kv", [...r.blocked], "blocked");
        setBlocked([...r.blocked]);
        try { await r.net?.request("block:set", [...r.blocked]); } catch { /* volta a enviar quando reconectar */ }
        actions.rewatch();
      },

      async deleteContact(id, alsoChat = false) {
        r.contactMap.delete(id);
        await db.del("contacts", id);
        setContacts([...r.contactMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
        const cid = convIdOf([me, id]);
        if (alsoChat && r.convMap.has(cid)) await actions.deleteConversation(cid);
      },

      // ---------- definições (toque) ----------
      async setSettings(patch) {
        const next = cleanSettings({ ...r.settings, ...patch });
        r.settings = next;
        setSettingsState(next);
        configureRing(next);
        await saveSettings(next);
      },

      // ---------- localização ----------
      async sendLocation(convId, raw) {
        const loc = cleanLoc(raw);
        const conv = r.convMap.get(convId);
        if (!loc || !conv) throw new Error("Localização inválida");
        const others = conv.participants.filter((p) => p !== me);
        const m = { id: uid(), convId, participants: conv.participants, from: me, ts: Date.now(), kind: "location", loc, dir: "out", pendingTo: others };
        await addMessage(m);
        others.forEach((p) => flush(p));
      },

      /** Partilha em tempo real durante `minutes`. Só funciona com esta página aberta. */
      async startLiveLocation(convId, minutes) {
        const conv = r.convMap.get(convId);
        if (!conv) return;
        const first = cleanLoc(await getPosition());
        const others = conv.participants.filter((p) => p !== me);
        const until = Date.now() + Math.min(480, Math.max(1, minutes)) * 60_000;
        const m = {
          id: uid(), convId, participants: conv.participants, from: me, ts: Date.now(), kind: "location", loc: first, dir: "out",
          pendingTo: others, live: { until, active: true }, updatedAt: Date.now(),
        };
        await addMessage(m);
        others.forEach((p) => flush(p));

        const st = { last: { ...first, t: Date.now() }, watch: null, timer: null };
        r.live.set(m.id, st);
        const push = (loc, end = false) => {
          const targets = others.filter((p) => r.online[p] && !r.blocked.has(p));
          if (targets.length) r.net?.sendMsg(targets, { id: uid(), participants: conv.participants, ts: Date.now(), text: "", kind: "location", liveOf: m.id, loc, ...(end ? { liveEnd: true } : {}) });
        };
        st.push = push;
        st.watch = navigator.geolocation.watchPosition(
          (pos) => {
            const loc = cleanLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0) });
            const now = Date.now();
            if (!loc || now - st.last.t < 10_000) return;
            if (distance(loc, st.last) < 15 && now - st.last.t < 60_000) return;
            st.last = { ...loc, t: now };
            patchMessage(m.id, { loc, updatedAt: now });
            push(loc);
          },
          () => { actions.stopLiveLocation(m.id); },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
        );
        st.timer = setTimeout(() => actions.stopLiveLocation(m.id), until - Date.now());
      },

      async stopLiveLocation(msgId) {
        const st = r.live.get(msgId);
        if (st) {
          navigator.geolocation.clearWatch(st.watch);
          clearTimeout(st.timer);
          r.live.delete(msgId);
        }
        const cur = await db.get("messages", msgId);
        if (!cur?.live?.active) return;
        const loc = cur.loc;
        const others = (cur.participants ?? []).filter((p) => p !== me && r.online[p] && !r.blocked.has(p));
        if (others.length) r.net?.sendMsg(others, { id: uid(), participants: cur.participants, ts: Date.now(), text: "", kind: "location", liveOf: msgId, liveEnd: true, loc });
        await patchMessage(msgId, (c) => ({ live: { ...c.live, active: false } }));
      },

      // ---------- conta por email ----------
      async linkAccount(email, code, password) {
        const a = await linkAccount({ net: r.net, identity, email, code, password });
        setAccount({ email: a.email, ts: a.ts });
        setBackupError("");
      },
      async backupNow() {
        try {
          const a = await backupNow({ net: r.net, identity });
          if (a) setAccount({ email: a.email, ts: a.ts });
          setBackupError("");
        } catch (e) { setBackupError(e.message); throw e; }
      },
      async unlinkAccount() {
        await unlinkAccount({ net: r.net });
        setAccount(null);
      },

      startCall: (peerId, video) => {
        if (r.blocked.has(peerId)) return Promise.reject(new Error("blocked"));
        return r.peers.startCall(peerId, video);
      },
      acceptCall: () => r.peers.acceptCall(),
      hangup: () => r.peers.hangup(),
      toggleMute: () => r.peers.toggleMute(),
      toggleVideo: () => r.peers.toggleVideo(),

      reconnect: () => r.net?.reconnect(),

      /** (Re)define a lista de presença observada e dispara o outbox de quem está online. */
      async rewatch() {
        if (!r.net) return;
        const ids = new Set(r.contactMap.keys());
        for (const c of r.convMap.values()) c.participants.forEach((p) => p !== me && ids.add(p));
        const on = await r.net.watch([...ids]);
        setOnlineMap(Object.fromEntries(on.map((i) => [i, true])));
        on.forEach((i) => flush(i));
      },
    };

    // ---------- arranque ----------
    actions.init = async (isCancelled) => {
      const [cs, cv, bl, st, acct] = await Promise.all([db.all("contacts"), db.all("convs"), db.get("kv", "blocked"), loadSettings(), loadAccount()]);
      if (isCancelled()) return null;
      r.blocked = new Set(Array.isArray(bl) ? bl.filter((b) => ID_RE.test(b)) : []);
      setBlocked([...r.blocked]);
      r.settings = st;
      setSettingsState(st);
      configureRing(st);
      setAccount(acct ? { email: acct.email, ts: acct.ts } : null);
      // Partilhas em tempo real deixam de funcionar quando a página fecha: marca-as como terminadas.
      for (const m of await db.all("messages")) {
        if (m.dir === "out" && m.live?.active) await db.put("messages", { ...m, live: { ...m.live, active: false } });
      }
      cs.forEach((c) => r.contactMap.set(c.id, c));
      cv.forEach((c) => r.convMap.set(c.id, c));
      setContacts(cs.sort((a, b) => a.name.localeCompare(b.name)));
      commitConvs();

      const net = (r.net = new Net(identity));
      const peers = (r.peers = new PeerManager({ myId: me, signal: (to, d) => net.signal(to, d), loadBlob: getBlob }));
      const offs = [];

      offs.push(net.on("diagnostic", setNetError));
      offs.push(net.on("state", (state) => {
        setNetState(state);
        if (state !== "online") {
          setOnlineMap({});
          r.offered.clear();
        }
      }));
      offs.push(net.on("ready", async ({ ice }) => {
        peers.setIce(ice);
        try { await net.request("block:set", [...r.blocked]); } catch { /* o servidor volta a receber na próxima ligação */ }
        actions.rewatch();
      }));
      offs.push(net.on("signal", ({ from, data }) => { if (!r.blocked.has(from)) peers.onSignal(from, data); }));
      offs.push(net.on("presence", ({ id, online: on }) => {
        const m = { ...r.online };
        if (on) m[id] = true; else delete m[id];
        setOnlineMap(m);
        if (on) flush(id);
        else {
          peers.peerOffline(id);
          for (const k of [...r.offered]) if (k.endsWith(`:${id}`)) r.offered.delete(k);
        }
      }));
      offs.push(net.on("msg", ({ from, msg }) => serial(async () => {
        const p = msg?.participants;
        if (!Array.isArray(p) || !p.includes(me) || !p.includes(from) || r.blocked.has(from)) return;
        const loc = msg.kind === "location" ? cleanLoc(msg.loc) : null;
        if (msg.kind === "location" && !loc) return;
        if (msg.liveOf) {                                                      // atualização de localização em direto
          const cur = await db.get("messages", String(msg.liveOf));
          if (!cur || cur.dir !== "in" || cur.from !== from || cur.kind !== "location" || !cur.live) return;
          const ts = Math.min(Number(msg.ts) || Date.now(), Date.now());
          if (ts < (cur.updatedAt ?? 0) && !msg.liveEnd) return;               // fora de ordem
          return void (await patchMessage(cur.id, (c) => ({
            loc, updatedAt: Math.max(ts, c.updatedAt ?? 0), live: { ...c.live, active: msg.liveEnd ? false : c.live.active },
          })));
        }
        if (await db.get("messages", msg.id)) return;                       // deduplicação
        const m = {
          id: msg.id, convId: convIdOf(p), participants: [...new Set(p)].sort(), from, kind: loc ? "location" : "text", dir: "in",
          ts: Math.min(Number(msg.ts) || Date.now(), Date.now()),
          ...(loc
            ? { loc, text: "", ...(Number.isFinite(msg.until) && msg.until > Date.now() ? { live: { until: Math.min(msg.until, Date.now() + 9 * 3600_000), active: true }, updatedAt: Date.now() } : {}) }
            : { text: String(msg.text).slice(0, 8000) }),
        };
        await db.put("messages", m);
        touchConv(m.participants, m, true);
        if (m.convId === r.selectedId) setMessages((prev) => [...prev, m].sort(byTs));
        notify(r.contactMap.get(from)?.name ?? shortId(from), previewOf(m));
      })));

      offs.push(peers.on("xfer:offer", onOffer));
      offs.push(peers.on("xfer:done", onDone));
      offs.push(peers.on("xfer:progress", ({ id, dir, done, total }) => setTransfers((t) => ({ ...t, [id]: { dir, done, total } }))));
      offs.push(peers.on("xfer:acked", ({ id, peerId }) => { dropOffer(id, peerId); dropTransfer(id); markDelivered(id, [peerId]); }));
      offs.push(peers.on("xfer:declined", ({ id, peerId }) => {
        dropOffer(id, peerId); dropTransfer(id);
        patchMessage(id, (cur) => ({
          pendingTo: (cur.pendingTo ?? []).filter((x) => x !== peerId), declinedBy: [...(cur.declinedBy ?? []), peerId],
        }));
      }));
      offs.push(peers.on("xfer:fail", ({ id, peerId, dir }) => {
        dropTransfer(id);
        if (dir === "out") dropOffer(id, peerId);
        else patchMessage(id, (cur) => (cur.status === "done" ? {} : { status: "failed" }));
      }));
      offs.push(peers.on("call", setCall));
      offs.push(peers.on("call:ended", ({ peerId, dir, video, outcome, duration }) => {
        const participants = [me, peerId].sort();
        addMessage({
          id: uid(), convId: convIdOf(participants), participants, from: dir === "out" ? me : peerId, ts: Date.now(),
          kind: "call", dir: dir === "out" ? "out" : "in", call: { video, outcome, duration },
        }, outcome === "missed");
      }));

      return () => {
        offs.forEach((f) => f());
        for (const st of r.live.values()) { navigator.geolocation?.clearWatch(st.watch); clearTimeout(st.timer); }
        r.live.clear();
        peers.dispose(); net.close(); r.net = r.peers = null;
      };
    };

    return actions;
  }, [identity, me]);

  useEffect(() => {
    let cancelled = false, dispose = null;
    api.init(() => cancelled).then((d) => {
      if (!d) return;
      if (cancelled) d(); else { dispose = d; setReady(true); }
    });
    return () => { cancelled = true; dispose?.(); };
  }, [api]);

  // Reobserva presença quando contactos/conversas mudam.
  const watchKey = useMemo(() => {
    const ids = new Set(contacts.map((c) => c.id));
    convs.forEach((c) => c.participants.forEach((p) => p !== me && ids.add(p)));
    return [...ids].sort().join(",");
  }, [contacts, convs, me]);
  useEffect(() => { if (ready && netState === "online") api.rewatch(); }, [ready, netState, watchKey, api]);

  // Toque e notificação de chamadas.
  const nameOf = useCallback(
    (id) => (id === me ? identity.name : contacts.find((c) => c.id === id)?.name ?? shortId(id)),
    [contacts, me, identity.name]
  );
  const callState = call?.state, callPeer = call?.peerId;
  useEffect(() => {
    if (callState === "ringing") { startRing("in", { ringVolume: R.current.settings.ringVolume, ringTone: R.current.settings.ringTone, ringMuted: R.current.settings.ringMuted }); notify("Chamada recebida", nameOf(callPeer)); }
    else if (callState === "calling") startRing("out");
    else stopRing();
    return stopRing;
  }, [callState, callPeer, nameOf]);

  // Cópia de segurança automática (conta por email), 5 s depois de mudar contactos/bloqueados/definições.
  const accountEmail = account?.email;
  useEffect(() => {
    if (!ready || !accountEmail || netState !== "online") return;
    const t = setTimeout(() => { api.backupNow().catch(() => {}); }, 5000);
    return () => clearTimeout(t);
  }, [api, ready, accountEmail, netState, contacts, blocked, settings]);

  // Contactos bloqueados aparecem sempre offline.
  const onlineView = useMemo(() => {
    if (!blocked.length) return online;
    const o = { ...online };
    blocked.forEach((b) => delete o[b]);
    return o;
  }, [online, blocked]);

  const logout = useCallback(() => logoutRef.current?.(), []);

  const value = useMemo(
    () => ({
      ...api, me, identity, ready, netState, netError, online: onlineView, contacts, convs, selectedId, messages, transfers, call, nameOf,
      blocked, settings, account, backupError, logout,
    }),
    [api, me, identity, ready, netState, netError, onlineView, contacts, convs, selectedId, messages, transfers, call, nameOf, blocked, settings, account, backupError, logout]
  );

  return <Ctx.Provider value={value}>{ready ? children : null}</Ctx.Provider>;
}
