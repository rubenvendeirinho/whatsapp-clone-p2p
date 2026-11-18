import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useApp } from "../context/AppProvider";
import Modal from "./Modal";

/** Menu ⋮ de um contacto: bloquear/desbloquear e apagar contacto. */
export default function ContactMenu({ id, name, className = "" }) {
  const { blocked, contacts, blockContact, unblockContact, deleteContact, convs, me } = useApp();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null);       // "block" | "delete"
  const [alsoChat, setAlsoChat] = useState(false);
  const isBlocked = blocked.includes(id);
  const saved = contacts.some((c) => c.id === id);
  const hasChat = convs.some((c) => c.participants.length === 2 && c.participants.includes(id) && c.participants.includes(me));
  const item = "block w-full px-4 py-2 text-left text-sm hover:bg-slate-100";

  const pick = (d) => { setOpen(false); if (d === "unblock") unblockContact(id); else setDialog(d); };

  return (
    <div className={`relative ${className}`} onClick={(e) => e.stopPropagation()}>
      <button aria-label={`Opções de ${name}`} aria-haspopup="menu" aria-expanded={open} title="Mais opções" onClick={() => setOpen((o) => !o)}
        className="rounded-full p-2 hover:bg-secondaryL-g"><BsThreeDotsVertical /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <ul role="menu" className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-lg bg-white py-1 text-base text-slate-800 shadow-lg ring-1 ring-black/10">
            <li role="none"><button role="menuitem" className={item} onClick={() => pick(isBlocked ? "unblock" : "block")}>{isBlocked ? "Desbloquear" : "Bloquear"}</button></li>
            {saved && <li role="none"><button role="menuitem" className={`${item} text-red-600`} onClick={() => pick("delete")}>Apagar contacto</button></li>}
          </ul>
        </>
      )}
      {dialog === "block" && (
        <Modal title={`Bloquear ${name}?`} onClose={() => setDialog(null)}>
          <p className="text-sm text-slate-600">Deixa de receber mensagens, chamadas e ficheiros deste contacto, e ele deixa de ver o seu estado online. Pode desbloquear quando quiser.</p>
          <button onClick={() => { blockContact(id); setDialog(null); }} className="mt-4 w-full rounded-lg bg-red-600 px-4 py-2 font-medium text-white">Bloquear</button>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal title={`Apagar ${name}?`} onClose={() => setDialog(null)}>
          <p className="text-sm text-slate-600">O contacto é removido da sua lista. Se estava bloqueado, continua bloqueado.</p>
          {hasChat && (
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={alsoChat} onChange={(e) => setAlsoChat(e.target.checked)} /> Apagar também a conversa e os ficheiros guardados</label>
          )}
          <button onClick={() => { deleteContact(id, alsoChat); setDialog(null); }} className="mt-4 w-full rounded-lg bg-red-600 px-4 py-2 font-medium text-white">Apagar contacto</button>
        </Modal>
      )}
    </div>
  );
}
