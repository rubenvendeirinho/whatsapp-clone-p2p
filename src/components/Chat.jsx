import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BsArrowLeft, BsTelephoneFill, BsCameraVideoFill, BsTrash, BsPersonPlusFill } from "react-icons/bs";
import { useApp } from "../context/AppProvider";
import { convTitle, isGroup, othersOf } from "../lib/conv";
import Avatar from "./Avatar";
import MessageBubble from "./Bubbles";
import Composer from "./Composer";
import ContactMenu from "./ContactMenu";
import Modal from "./Modal";
import { AddContact } from "./SidePanel";

const callError = (e) =>
  e?.message === "busy" ? "Já tem uma chamada em curso."
  : e?.message === "blocked" ? "Contacto bloqueado. Desbloqueie-o para ligar."
  : e?.name === "NotAllowedError" ? "Permita o acesso ao microfone/câmara."
  : e?.name === "NotFoundError" ? "Microfone ou câmara não encontrados."
  : "Não foi possível iniciar a chamada.";

export default function Chat() {
  const { me, convs, selectedId, select, messages, nameOf, online, contacts, call, startCall, sendFiles, deleteConversation, blocked, unblockContact } = useApp();
  const conv = convs.find((c) => c.id === selectedId);
  const listRef = useRef(null);
  const stick = useRef(true);
  const [err, setErr] = useState("");
  const [modal, setModal] = useState(null);
  const [drag, setDrag] = useState(false);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(""), 5000);
    return () => clearTimeout(t);
  }, [err]);

  if (!conv) return null;
  const others = othersOf(conv, me);
  const group = isGroup(conv);
  const title = convTitle(conv, me, nameOf);
  const peer = others[0];
  const peerOnline = !group && online[peer];
  const unknown = !group && !contacts.some((c) => c.id === peer);
  const peerBlocked = !group && blocked.includes(peer);
  const canCall = !group && peerOnline && !call && !peerBlocked;

  const dial = (video) => startCall(peer, video).catch((e) => setErr(callError(e)));
  const onScroll = (e) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files.length) sendFiles(conv.id, [...e.dataTransfer.files]);
  };

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col"
      style={{ background: "#efeae2 url('/bg/tp-light-bg.png') center", backgroundSize: "300px" }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
    >
      <header className="flex items-center justify-between gap-2 bg-secondary-gray p-2">
        <div className="flex min-w-0 items-center gap-3">
          <button aria-label="Voltar" onClick={() => select(null)} className="p-2 text-xl md:hidden"><BsArrowLeft /></button>
          <Avatar seed={group ? conv.id : peer} name={title} online={peerOnline} />
          <div className="min-w-0">
            <p className="truncate font-medium" data-testid="chat-title">{title}</p>
            <p className="truncate text-xs text-slate-500">{group ? `${conv.participants.length} participantes` : peerBlocked ? "bloqueado" : peerOnline ? "online" : "offline"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xl text-slate-600">
          {unknown && <button aria-label="Guardar contacto" title="Guardar contacto" onClick={() => setModal("save")} className="rounded-full p-2 hover:bg-secondaryL-g"><BsPersonPlusFill /></button>}
          {!group && <>
            <button aria-label="Chamada de voz" title="Chamada de voz" disabled={!canCall} onClick={() => dial(false)} className="rounded-full p-2 hover:bg-secondaryL-g disabled:opacity-30"><BsTelephoneFill /></button>
            <button aria-label="Chamada de vídeo" title="Chamada de vídeo" disabled={!!call || peerBlocked} onClick={() => dial(true)} className="rounded-full p-2 hover:bg-secondaryL-g disabled:opacity-30"><BsCameraVideoFill /></button>
          </>}
          {!group && <ContactMenu id={peer} name={title} />}
          <button aria-label="Apagar conversa" title="Apagar conversa" onClick={() => setModal("delete")} className="rounded-full p-2 hover:bg-secondaryL-g"><BsTrash /></button>
        </div>
      </header>

      {err && <div role="alert" className="bg-red-100 px-4 py-1.5 text-center text-sm text-red-800">{err}</div>}

      <ul ref={listRef} onScroll={onScroll} aria-label="Mensagens" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-6">
        {messages.map((m) => <MessageBubble key={m.id} m={m} group={group} />)}
      </ul>

      {peerBlocked ? (
        <div className="flex items-center justify-between gap-3 bg-secondary-gray p-3 text-sm text-slate-700">
          <span>Bloqueou este contacto. Não recebe nem envia mensagens.</span>
          <button onClick={() => unblockContact(peer)} className="shrink-0 rounded-lg bg-secondary px-3 py-1.5 font-medium text-white">Desbloquear</button>
        </div>
      ) : <Composer key={conv.id} convId={conv.id} />}

      {drag && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 text-xl text-white">Largue para enviar ficheiros</div>}
      {modal === "save" && <AddContact onClose={() => setModal(null)} initialId={peer} />}
      {modal === "delete" && (
        <Modal title="Apagar conversa" onClose={() => setModal(null)}>
          <p className="text-sm text-slate-600">As mensagens e ficheiros guardados neste dispositivo serão apagados. O outro lado mantém a sua cópia.</p>
          <button onClick={() => { deleteConversation(conv.id); setModal(null); }} className="mt-4 w-full rounded-lg bg-red-600 px-4 py-2 font-medium text-white">Apagar</button>
        </Modal>
      )}
    </div>
  );
}
