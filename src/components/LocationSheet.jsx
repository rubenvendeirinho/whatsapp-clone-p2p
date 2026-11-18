import { useEffect, useState } from "react";
import { BsGeoAltFill, BsPinMapFill, BsBroadcast } from "react-icons/bs";
import { useApp } from "../context/AppProvider";
import { fmtCoords, geoError, getPosition } from "../lib/geo";
import Modal from "./Modal";
import MapView from "./MapView";

const DEFAULT_CENTER = { lat: 38.7223, lng: -9.1393 };   // Lisboa, usado só se não houver GPS
const row = "flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-slate-100";

export default function LocationSheet({ convId, onClose }) {
  const { sendLocation, startLiveLocation } = useApp();
  const [mode, setMode] = useState("menu");      // menu | current | pick | live
  const [pos, setPos] = useState(null);          // posição do dispositivo
  const [picked, setPicked] = useState(null);    // ponto escolhido no mapa
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [key, setKey] = useState(0);

  const locate = async () => {
    setErr(""); setBusy(true);
    try { const p = await getPosition(); setPos(p); setPicked({ lat: p.lat, lng: p.lng }); setKey((k) => k + 1); return p; }
    catch (e) { setErr(geoError(e)); return null; }
    finally { setBusy(false); }
  };

  useEffect(() => { if (mode === "current" && !pos) locate(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === "pick" && !pos) locate(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (loc) => {
    setBusy(true); setErr("");
    try { await sendLocation(convId, loc); onClose(); }
    catch { setErr("Não foi possível enviar a localização."); setBusy(false); }
  };
  const live = async (minutes) => {
    setBusy(true); setErr("");
    try { await startLiveLocation(convId, minutes); onClose(); }
    catch (e) { setErr(e?.code !== undefined ? geoError(e) : "Não foi possível iniciar a partilha."); setBusy(false); }
  };

  return (
    <Modal title="Partilhar localização" onClose={onClose}>
      {err && <p role="alert" className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}

      {mode === "menu" && (
        <div className="space-y-1">
          <button className={row} onClick={() => setMode("current")}><BsGeoAltFill className="text-xl text-secondary" /><span><span className="block font-medium">Localização atual</span><span className="text-xs text-slate-500">Envia a sua posição neste momento</span></span></button>
          <button className={row} onClick={() => setMode("pick")}><BsPinMapFill className="text-xl text-secondary" /><span><span className="block font-medium">Escolher no mapa</span><span className="text-xs text-slate-500">Arraste o mapa até ao local e envie</span></span></button>
          <button className={row} onClick={() => setMode("live")}><BsBroadcast className="text-xl text-secondary" /><span><span className="block font-medium">Localização em tempo real</span><span className="text-xs text-slate-500">O contacto vê a sua posição a mover-se</span></span></button>
        </div>
      )}

      {mode === "current" && (
        <div>
          {pos ? (
            <>
              <div className="overflow-hidden rounded-lg border"><MapView center={pos} zoom={16} markers={[pos]} height={200} /></div>
              <p className="mt-2 text-sm">{fmtCoords(pos)}{pos.acc ? ` · precisão ~${pos.acc} m` : ""}</p>
              <button disabled={busy} onClick={() => send(pos)} className="mt-3 w-full rounded-lg bg-secondary px-4 py-2 font-medium text-white disabled:opacity-50">Enviar esta localização</button>
            </>
          ) : <p className="text-sm text-slate-600">{busy ? "A obter localização…" : "Sem localização."}</p>}
          {!busy && !pos && <button onClick={locate} className="mt-3 w-full rounded-lg bg-slate-200 px-4 py-2 text-sm">Tentar novamente</button>}
        </div>
      )}

      {mode === "pick" && (
        <div>
          <div className="overflow-hidden rounded-lg border">
            <MapView center={pos ?? DEFAULT_CENTER} zoom={pos ? 16 : 13} interactive pin height={280} onMove={setPicked} recenterKey={key} />
          </div>
          <p className="mt-2 text-sm">{picked ? fmtCoords(picked) : "Arraste o mapa para escolher o ponto"}</p>
          <div className="mt-3 flex gap-2">
            <button disabled={busy} onClick={locate} className="rounded-lg bg-slate-200 px-3 py-2 text-sm disabled:opacity-50">A minha posição</button>
            <button disabled={busy || !picked} onClick={() => send(picked)} className="flex-1 rounded-lg bg-secondary px-4 py-2 font-medium text-white disabled:opacity-50">Enviar este ponto</button>
          </div>
        </div>
      )}

      {mode === "live" && (
        <div>
          <p className="mb-3 text-sm text-slate-600">A posição é atualizada enquanto esta página estiver aberta. Pode parar a qualquer momento.</p>
          <div className="grid grid-cols-3 gap-2">
            {[[15, "15 minutos"], [60, "1 hora"], [480, "8 horas"]].map(([m, label]) => (
              <button key={m} disabled={busy} onClick={() => live(m)} className="rounded-lg bg-secondary px-2 py-3 text-sm font-medium text-white disabled:opacity-50">{label}</button>
            ))}
          </div>
          {busy && <p className="mt-3 text-sm text-slate-600">A obter localização…</p>}
        </div>
      )}

      {mode !== "menu" && <button onClick={() => { setMode("menu"); setErr(""); }} className="mt-3 w-full text-sm text-slate-500 underline">Voltar</button>}
    </Modal>
  );
}
