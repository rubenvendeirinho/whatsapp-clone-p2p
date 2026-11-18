import { useEffect, useRef, useState } from "react";
import { BsCheck2All, BsClock, BsPlayFill, BsPauseFill, BsFileEarmark, BsDownload } from "react-icons/bs";
import { useApp } from "../context/AppProvider";
import { fmtDur, fmtSize, fmtTime } from "../lib/format";
import { fmtCoords, osmLink } from "../lib/geo";
import MapView from "./MapView";

function useBlobUrl(id, enabled) {
  const { getBlob } = useApp();
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    let u, dead = false;
    getBlob(id).then((b) => { if (b && !dead) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { dead = true; if (u) URL.revokeObjectURL(u); setUrl(null); };
  }, [id, enabled, getBlob]);
  return url;
}

const hasData = (m) => m.dir === "out" || (m.status === "done" && m.hasBlob);

function Ticks({ m }) {
  if (m.dir !== "out" || m.kind === "call") return null;
  const waiting = (m.pendingTo ?? []).length > 0;
  if (m.cancelled) return null;
  return waiting
    ? <BsClock className="inline text-slate-400" title="A aguardar entrega" aria-label="pendente" />
    : <BsCheck2All className="inline text-sky-500" title="Entregue" aria-label="entregue" />;
}

function Transfer({ m }) {
  const { transfers, cancelTransfer, acceptFile, declineFile, retrySend, online } = useApp();
  const t = transfers[m.id];
  const pct = t ? Math.round((t.done / Math.max(1, t.total)) * 100) : 0;
  const bar = t && (
    <div className="mt-1 h-1.5 w-full rounded bg-slate-200"><div className="h-full rounded bg-secondary" style={{ width: `${pct}%` }} /></div>
  );
  const btn = "rounded-full px-3 py-1 text-xs font-medium";

  if (m.dir === "in") {
    if (m.status === "offered") return (
      <div className="mt-2 flex gap-2">
        <button onClick={() => acceptFile(m.id)} disabled={!online[m.from]} className={`${btn} bg-secondary text-white disabled:opacity-50`}>Aceitar</button>
        <button onClick={() => declineFile(m.id)} className={`${btn} bg-slate-200`}>Recusar</button>
      </div>
    );
    if (m.status === "receiving") return (
      <div className="mt-2">{bar}<div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>A receber… {pct}%</span><button onClick={() => cancelTransfer(m.id)} className="underline">Cancelar</button></div></div>
    );
    if (m.status === "failed") return <p className="mt-1 text-xs text-red-600">Falhou. Peça ao remetente para reenviar.</p>;
    if (m.status === "declined") return <p className="mt-1 text-xs text-slate-500">Recusado</p>;
    return null;
  }
  if (m.cancelled) return <p className="mt-1 text-xs text-slate-500">Envio cancelado</p>;
  const waiting = m.pendingTo ?? [];
  if (waiting.length) return (
    <div className="mt-2">
      {bar}
      <div className="mt-1 flex justify-between gap-3 text-xs text-slate-500">
        <span>{t ? `A enviar… ${pct}%` : waiting.some((p) => online[p]) ? "A aguardar aceitação…" : "A aguardar que o contacto fique online"}</span>
        <span className="space-x-2">
          {!t && waiting.some((p) => online[p]) && <button onClick={() => retrySend(m.id)} className="underline">Reenviar</button>}
          <button onClick={() => cancelTransfer(m.id)} className="underline">Cancelar</button>
        </span>
      </div>
    </div>
  );
  if ((m.declinedBy ?? []).length) return <p className="mt-1 text-xs text-slate-500">Recusado por {m.declinedBy.length}</p>;
  return null;
}

function VoicePlayer({ m }) {
  const url = useBlobUrl(m.id, hasData(m));
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    if (!url) return;
    const a = new Audio(url);
    audio.current = a;
    a.ontimeupdate = () => setT(a.currentTime);
    a.onended = () => { setPlaying(false); setT(0); };
    a.onpause = () => setPlaying(false);
    a.onplay = () => setPlaying(true);
    return () => { a.pause(); audio.current = null; setPlaying(false); setT(0); };
  }, [url]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    a.playbackRate = rate;
    if (playing) a.pause(); else a.play().catch(() => {});
  };
  const cycle = () => {
    const n = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(n);
    if (audio.current) audio.current.playbackRate = n;
  };
  const peaks = m.peaks?.length ? m.peaks : Array(40).fill(0.35);
  const frac = m.dur ? Math.min(1, t / m.dur) : 0;

  return (
    <div className="min-w-[220px]">
      <div className="flex items-center gap-2">
        <button aria-label={playing ? "Pausar" : "Reproduzir"} disabled={!url} onClick={toggle}
          className="rounded-full bg-secondary p-2 text-xl text-white disabled:opacity-40">
          {playing ? <BsPauseFill /> : <BsPlayFill />}
        </button>
        <div className="flex h-8 flex-1 items-center gap-[2px]" aria-hidden>
          {peaks.map((p, i) => (
            <span key={i} className={`w-[3px] rounded ${i / peaks.length < frac ? "bg-teal-600" : "bg-slate-400"}`} style={{ height: `${6 + p * 22}px` }} />
          ))}
        </div>
        <button onClick={cycle} className="rounded-full bg-black/10 px-2 py-0.5 text-xs">{rate}x</button>
      </div>
      <div className="ml-11 text-xs text-slate-500">{fmtDur(playing || t ? t : m.dur)}</div>
      <Transfer m={m} />
    </div>
  );
}

function FileCard({ m }) {
  const ok = hasData(m);
  const url = useBlobUrl(m.id, ok);
  const image = m.mime?.startsWith("image/") && m.size < 20 * 1024 * 1024;
  return (
    <div className="min-w-[220px] max-w-[320px]">
      {image && url && <img src={url} alt={m.name} className="mb-2 max-h-64 rounded" />}
      <div className="flex items-center gap-3 rounded bg-black/5 p-2">
        <BsFileEarmark className="text-3xl text-slate-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm" title={m.name}>{m.name}</p>
          <p className="text-xs text-slate-500">{fmtSize(m.size)}{m.savedToDisk ? " · guardado no disco" : ""}</p>
        </div>
        {url && <a href={url} download={m.name} aria-label={`Guardar ${m.name}`} className="text-xl text-slate-600"><BsDownload /></a>}
      </div>
      <Transfer m={m} />
    </div>
  );
}

function LocationCard({ m }) {
  const { stopLiveLocation } = useApp();
  const [now, setNow] = useState(Date.now());
  const live = m.live?.active && now < m.live.until;
  useEffect(() => {
    if (!m.live?.active) return;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [m.live?.active]);
  const mine = m.dir === "out";
  return (
    <div className="w-[min(280px,70vw)]">
      <div className="overflow-hidden rounded-md">
        <MapView center={m.loc} zoom={15} markers={[m.loc]} height={150} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-slate-600">
          {live ? <span className="font-medium text-red-600">● Em direto até {fmtTime(m.live.until)}</span>
            : m.live ? "Partilha em direto terminada" : fmtCoords(m.loc)}
        </span>
        <a href={osmLink(m.loc)} target="_blank" rel="noreferrer noopener" className="shrink-0 text-teal-700 underline">Abrir no mapa</a>
      </div>
      {m.loc.acc ? <p className="text-[.66rem] text-slate-500">Precisão ~{Math.round(m.loc.acc)} m{m.updatedAt && m.live ? ` · atualizado ${fmtTime(m.updatedAt)}` : ""}</p> : null}
      {live && mine && <button onClick={() => stopLiveLocation(m.id)} className="mt-1 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">Parar partilha</button>}
    </div>
  );
}

const CALL_TEXT = {
  missed: () => "Chamada perdida",
  rejected: (c, m) => (m.dir === "out" ? "Chamada recusada" : "Chamada recusada por si"),
  noanswer: () => "Sem resposta",
  cancelled: () => "Chamada cancelada",
  busy: () => "Contacto ocupado",
  failed: () => "Chamada falhou",
  offline: () => "Contacto offline",
};
function CallEntry({ m }) {
  const c = m.call;
  const kind = c.video ? "Chamada de vídeo" : "Chamada de voz";
  const text = c.outcome === "ended" ? `${kind} · ${fmtDur(c.duration)}` : CALL_TEXT[c.outcome]?.(c, m) ?? kind;
  return (
    <li className="my-2 flex justify-center">
      <span className="rounded-lg bg-white/90 px-3 py-1 text-xs text-slate-600 shadow-sm">{text} · {fmtTime(m.ts)}</span>
    </li>
  );
}

export default function MessageBubble({ m, group }) {
  const { nameOf } = useApp();
  if (m.kind === "call") return <CallEntry m={m} />;
  const mine = m.dir === "out";
  return (
    <li className={`relative mb-2 w-fit min-w-[80px] max-w-[85%] rounded-lg px-2 py-1 shadow-sm md:max-w-[65%] ${mine ? "ms-auto bg-secondary-green" : "bg-white"}`}>
      {group && !mine && <p className="text-xs font-medium text-teal-700">{nameOf(m.from)}</p>}
      {m.kind === "text" && <p className="whitespace-pre-wrap break-words text-[15px]">{m.text}</p>}
      {m.kind === "voice" && <VoicePlayer m={m} />}
      {m.kind === "file" && <FileCard m={m} />}
      {m.kind === "location" && <LocationCard m={m} />}
      <p className="mt-0.5 flex items-center justify-end gap-1 text-[.66rem] text-slate-500">
        {fmtTime(m.ts)} <Ticks m={m} />
      </p>
    </li>
  );
}

