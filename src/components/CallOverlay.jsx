import { useEffect, useRef, useState } from "react";
import { BsTelephoneFill, BsTelephoneXFill, BsMicMuteFill, BsMicFill, BsCameraVideoFill, BsCameraVideoOffFill, BsVolumeUpFill, BsVolumeMuteFill } from "react-icons/bs";
import { useApp } from "../context/AppProvider";
import { fmtDur } from "../lib/format";
import { audioBlocked, unlockAudio } from "../lib/ring";
import Avatar from "./Avatar";

/** `speaker` liga/desliga o som do interlocutor; `sinkId` escolhe a saída de áudio (desktop, quando o browser permite). */
function Stream({ stream, muted, className, style, speaker = true, sinkId = "" }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream ?? null; }, [stream]);
  useEffect(() => {
    const el = ref.current;
    if (!el || muted) return;
    el.muted = !speaker;
    if (sinkId && typeof el.setSinkId === "function") el.setSinkId(sinkId).catch(() => {});
  }, [speaker, sinkId, muted, stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} style={style} />;
}

/** Lista de saídas de áudio (só quando o browser deixa escolher; em telemóveis é o sistema que decide). */
function useOutputs(active) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!active || !navigator.mediaDevices?.enumerateDevices || typeof HTMLMediaElement === "undefined" || !("setSinkId" in HTMLMediaElement.prototype)) return;
    let dead = false;
    const load = () => navigator.mediaDevices.enumerateDevices().then((d) => { if (!dead) setList(d.filter((x) => x.kind === "audiooutput")); }).catch(() => {});
    load();
    navigator.mediaDevices.addEventListener?.("devicechange", load);
    return () => { dead = true; navigator.mediaDevices.removeEventListener?.("devicechange", load); };
  }, [active]);
  return list;
}

const STATE_TEXT = { calling: "A chamar…", ringing: "Chamada recebida", connecting: "A ligar…" };

export default function CallOverlay() {
  const { call, nameOf, acceptCall, hangup, toggleMute, toggleVideo } = useApp();
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState("");
  const [speaker, setSpeaker] = useState(true);
  const [sinkId, setSinkId] = useState("");
  const outputs = useOutputs(!!call?.localStream);
  const callId = call?.cid;

  useEffect(() => { setSpeaker(true); }, [callId]);       // cada chamada começa com o alta-voz ligado

  useEffect(() => {
    if (call?.state !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [call?.state]);

  if (!call) return null;
  const name = nameOf(call.peerId);
  const showRemote = call.remoteCamOn && call.remoteStream.getVideoTracks().length > 0;
  const showLocal = call.camOn && call.localStream?.getVideoTracks().length > 0;
  const hidden = { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" };
  const accept = () => acceptCall().catch(() => setErr("Não foi possível aceder ao microfone/câmara."));
  const camToggle = () => toggleVideo().catch(() => setErr("Não foi possível aceder à câmara."));

  return (
    <div role="dialog" aria-label="Chamada" className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-slate-900 p-6 text-white">
      {/* O vídeo remoto também reproduz o áudio; fora do ecrã quando não há imagem. */}
      <Stream stream={call.remoteStream} speaker={speaker} sinkId={sinkId} className={showRemote ? "absolute inset-0 h-full w-full object-cover" : ""} style={showRemote ? undefined : hidden} />
      {showLocal && <Stream stream={call.localStream} muted className="absolute right-4 top-4 z-10 h-40 w-28 rounded-lg border border-white/30 object-cover md:h-48 md:w-36" />}

      <div className="relative z-10 mt-10 flex flex-col items-center gap-3 text-center drop-shadow">
        {!showRemote && <Avatar seed={call.peerId} name={name} size={112} />}
        <p className="text-2xl font-medium" data-testid="call-peer">{name}</p>
        <p className="text-sm text-slate-200" data-testid="call-state">
          {call.state === "active" ? fmtDur((now - call.startedAt) / 1000) : STATE_TEXT[call.state]}
          {call.video ? " · vídeo" : " · voz"}
        </p>
        {err && <p role="alert" className="rounded bg-red-600/80 px-3 py-1 text-sm">{err}</p>}
        {call.state === "ringing" && audioBlocked() && (
          <button onClick={unlockAudio} className="rounded bg-white/20 px-3 py-1 text-sm">Toque aqui para ativar o som do toque</button>
        )}
        {call.state !== "ringing" && !speaker && <p className="rounded bg-black/40 px-3 py-1 text-xs">Alta-voz desligado: não ouve o interlocutor</p>}
      </div>

      {outputs.length > 1 && call.state !== "ringing" && (
        <label className="relative z-10 -mb-2 flex items-center gap-2 text-sm text-slate-200">
          Saída de áudio
          <select value={sinkId} onChange={(e) => setSinkId(e.target.value)} className="max-w-[220px] rounded bg-white/20 px-2 py-1 text-white">
            <option value="" className="text-black">Predefinida</option>
            {outputs.filter((o) => o.deviceId && o.deviceId !== "default").map((o) => <option key={o.deviceId} value={o.deviceId} className="text-black">{o.label || "Dispositivo de áudio"}</option>)}
          </select>
        </label>
      )}

      <div className="relative z-10 mb-6 flex items-center gap-5 text-2xl">
        {call.state === "ringing" ? (
          <>
            <button aria-label="Recusar chamada" onClick={hangup} className="rounded-full bg-red-600 p-5"><BsTelephoneXFill /></button>
            <button aria-label="Atender chamada" onClick={accept} className="rounded-full bg-green-600 p-5"><BsTelephoneFill /></button>
          </>
        ) : (
          <>
            {call.localStream && (
              <>
                <button aria-label={call.muted ? "Ativar microfone" : "Silenciar"} onClick={toggleMute} className="rounded-full bg-white/20 p-4">
                  {call.muted ? <BsMicMuteFill /> : <BsMicFill />}
                </button>
                <button aria-label={call.camOn ? "Desligar câmara" : "Ligar câmara"} onClick={camToggle} className="rounded-full bg-white/20 p-4">
                  {call.camOn ? <BsCameraVideoFill /> : <BsCameraVideoOffFill />}
                </button>
                <button aria-label={speaker ? "Desligar alta-voz" : "Ligar alta-voz"} aria-pressed={speaker} onClick={() => setSpeaker((v) => !v)}
                  className={`rounded-full p-4 ${speaker ? "bg-white text-slate-900" : "bg-white/20"}`}>
                  {speaker ? <BsVolumeUpFill /> : <BsVolumeMuteFill />}
                </button>
              </>
            )}
            <button aria-label="Terminar chamada" onClick={hangup} className="rounded-full bg-red-600 p-5"><BsTelephoneXFill /></button>
          </>
        )}
      </div>
    </div>
  );
}
