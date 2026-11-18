import { useEffect, useRef, useState } from "react";
import { BsMicFill, BsPaperclip, BsSendFill, BsTrash, BsStopFill, BsGeoAltFill } from "react-icons/bs";
import { useApp } from "../context/AppProvider";
import { startRecording } from "../lib/recorder";
import { fmtDur } from "../lib/format";
import LocationSheet from "./LocationSheet";

export default function Composer({ convId }) {
  const { sendText, sendVoice, sendFiles } = useApp();
  const [text, setText] = useState("");
  const [rec, setRec] = useState(null); // { level, ms }
  const [err, setErr] = useState("");
  const [loc, setLoc] = useState(false);
  const ctrl = useRef(null);
  const fileRef = useRef(null);
  const mounted = useRef(false);
  const starting = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ctrl.current?.cancel(); ctrl.current = null; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const draft = text;
    setText("");
    try { await sendText(convId, draft); }
    catch { if (mounted.current) { setText((current) => current || draft); setErr("Não foi possível guardar a mensagem."); } }
  };

  const finish = async (send) => {
    const c = ctrl.current;
    if (!c) return;
    ctrl.current = null;
    setRec(null);
    if (!send) return c.cancel();
    try {
      const res = await c.stop();
      if (res.dur >= 0.5 && res.blob.size > 0) await sendVoice(convId, res);
    } catch { if (mounted.current) setErr("Não foi possível enviar a gravação."); }
  };

  const start = async () => {
    if (starting.current || ctrl.current) return;
    starting.current = true;
    setErr("");
    try {
      const recording = await startRecording({
        onLevel: (level, ms) => { if (mounted.current) setRec({ level, ms }); },
        onMax: () => finish(true),
      });
      if (!mounted.current) return recording.cancel();
      ctrl.current = recording;
      setRec({ level: 0, ms: 0 });
    } catch (e) {
      if (mounted.current) setErr(e?.name === "NotAllowedError" ? "Permita o acesso ao microfone." : "Não foi possível gravar.");
    } finally { starting.current = false; }
  };

  const onFiles = (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) sendFiles(convId, files).catch(() => { if (mounted.current) setErr("Não foi possível enviar os ficheiros."); });
  };

  if (rec) return (
    <div className="flex items-center gap-3 bg-secondary-gray p-3" role="group" aria-label="A gravar">
      <button aria-label="Cancelar gravação" onClick={() => finish(false)} className="p-2 text-xl text-red-600"><BsTrash /></button>
      <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
      <span className="font-mono text-sm">{fmtDur(rec.ms / 1000)}</span>
      <div className="h-2 flex-1 rounded bg-slate-300"><div className="h-full rounded bg-secondary transition-all" style={{ width: `${Math.min(100, rec.level * 300)}%` }} /></div>
      <button aria-label="Enviar gravação" onClick={() => finish(true)} className="rounded-full bg-secondary p-3 text-white"><BsStopFill /></button>
    </div>
  );

  return (
    <div className="bg-secondary-gray p-2">
      {err && <p role="alert" className="px-2 pb-1 text-xs text-red-600">{err}</p>}
      <form onSubmit={submit} className="flex items-center gap-2">
        <input ref={fileRef} type="file" multiple hidden data-testid="file-input" onChange={onFiles} />
        <button type="button" aria-label="Anexar ficheiro" onClick={() => fileRef.current.click()} className="p-2 text-2xl text-slate-600"><BsPaperclip /></button>
        <button type="button" aria-label="Partilhar localização" title="Partilhar localização" onClick={() => setLoc(true)} className="p-2 text-2xl text-slate-600"><BsGeoAltFill /></button>
        <input
          aria-label="Mensagem" value={text} onChange={(e) => setText(e.target.value)} maxLength={8000} autoComplete="off"
          placeholder="Escreva uma mensagem" className="min-w-0 flex-1 rounded-lg px-4 py-2.5 outline-none"
        />
        {text.trim()
          ? <button aria-label="Enviar" className="rounded-full bg-secondary p-3 text-white"><BsSendFill /></button>
          : <button type="button" aria-label="Gravar mensagem de voz" onClick={start} className="rounded-full bg-secondary p-3 text-white"><BsMicFill /></button>}
      </form>
      {loc && <LocationSheet convId={convId} onClose={() => setLoc(false)} />}
    </div>
  );
}
