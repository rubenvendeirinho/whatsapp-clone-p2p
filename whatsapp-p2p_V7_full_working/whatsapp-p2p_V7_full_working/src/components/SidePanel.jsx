import { useState } from "react";
import { BsChatLeftTextFill, BsPersonPlusFill, BsGearFill } from "react-icons/bs";
import { useApp } from "../context/AppProvider";
import { convTitle, isGroup, othersOf } from "../lib/conv";
import { fmtDay, fmtId } from "../lib/format";
import Avatar from "./Avatar";
import Modal from "./Modal";
import ContactMenu from "./ContactMenu";
import SettingsModal from "./SettingsModal";

function Profile({ onClose }) {
  const { me, identity } = useApp();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(me); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem permissão */ }
  };
  return (
    <Modal title="O meu perfil" onClose={onClose}>
      <div className="flex items-center gap-3">
        <Avatar seed={me} name={identity.name} size={56} />
        <p className="text-lg font-medium">{identity.name}</p>
      </div>
      <p className="mt-4 text-sm text-slate-600">Partilhe este ID para o adicionarem. É derivado da sua chave e não pode ser falsificado.</p>
      <p className="mt-2 break-all rounded bg-slate-100 p-3 font-mono text-sm" data-testid="my-id">{fmtId(me)}</p>
      <button onClick={copy} className="mt-3 rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-white">
        {copied ? "Copiado!" : "Copiar ID"}
      </button>
    </Modal>
  );
}

function AddContact({ onClose, initialId = "", initialName = "" }) {
  const { saveContact } = useApp();
  const [id, setId] = useState(initialId);
  const [name, setName] = useState(initialName);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try { await saveContact(id, name); onClose(); } catch (ex) { setErr(ex.message); }
  };
  return (
    <Modal title="Guardar contacto" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input aria-label="ID do contacto" value={id} onChange={(e) => setId(e.target.value)} placeholder="ID (XXXX-XXXX-XXXX-XXXX-XXXX)"
          className="w-full rounded-lg border bg-gray-50 p-2.5 font-mono text-sm" required />
        <input aria-label="Nome do contacto" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Nome"
          className="w-full rounded-lg border bg-gray-50 p-2.5 text-sm" required />
        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
        <button className="w-full rounded-lg bg-secondary px-4 py-2 font-medium text-white">Guardar</button>
      </form>
    </Modal>
  );
}

function NewChat({ onClose }) {
  const { contacts, openChat } = useApp();
  const [sel, setSel] = useState([]);
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Modal title="Nova conversa" onClose={onClose}>
      {contacts.length === 0 && <p className="text-sm text-slate-500">Ainda não tem contactos. Adicione um primeiro.</p>}
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {contacts.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-slate-100">
              <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} aria-label={c.name} />
              <Avatar seed={c.id} name={c.name} size={36} />
              <span>{c.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <button disabled={!sel.length} onClick={() => { openChat(sel); onClose(); }}
        className="mt-4 w-full rounded-lg bg-secondary px-4 py-2 font-medium text-white disabled:opacity-50">
        {sel.length > 1 ? "Criar grupo" : "Abrir conversa"}
      </button>
    </Modal>
  );
}

export default function SidePanel() {
  const { me, identity, convs, contacts, online, selectedId, select, openChat, nameOf, blocked } = useApp();
  const [tab, setTab] = useState("chats");
  const [modal, setModal] = useState(null);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const chats = convs.filter((c) => !needle || convTitle(c, me, nameOf).toLowerCase().includes(needle));
  const people = contacts.filter((c) => !needle || c.name.toLowerCase().includes(needle));

  return (
    <>
      <header className="flex items-center justify-between bg-secondary-gray p-3">
        <button aria-label="O meu perfil" onClick={() => setModal("profile")} className="flex items-center gap-3">
          <Avatar seed={me} name={identity.name} size={40} />
          <span className="font-medium">{identity.name}</span>
        </button>
        <div className="flex gap-1 text-xl text-slate-600">
          <button aria-label="Nova conversa" title="Nova conversa" onClick={() => setModal("chat")} className="rounded-full p-2 hover:bg-secondaryL-g"><BsChatLeftTextFill /></button>
          <button aria-label="Adicionar contacto" title="Adicionar contacto" onClick={() => setModal("contact")} className="rounded-full p-2 hover:bg-secondaryL-g"><BsPersonPlusFill /></button>
          <button aria-label="Definições" title="Definições" onClick={() => setModal("settings")} className="rounded-full p-2 hover:bg-secondaryL-g"><BsGearFill /></button>
        </div>
      </header>

      <div className="px-3 pt-2">
        <input aria-label="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar"
          className="w-full rounded-lg bg-secondary-gray px-4 py-2 outline-none" />
        <div className="my-2 flex gap-2 text-sm">
          {[["chats", "Conversas"], ["contacts", "Contactos"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-full px-3 py-1.5 ${tab === k ? "bg-secondary-green text-green-900" : "bg-gray-200 text-slate-700"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === "chats" && chats.map((c) => {
          const others = othersOf(c, me);
          const title = convTitle(c, me, nameOf);
          return (
            <li key={c.id}>
              <button onClick={() => select(c.id)} aria-label={`Conversa ${title}`}
                className={`flex w-full items-center gap-3 border-b p-3 text-left hover:bg-secondary-gray ${c.id === selectedId ? "bg-secondary-gray" : ""}`}>
                <Avatar seed={isGroup(c) ? c.id : others[0]} name={title} online={!isGroup(c) && online[others[0]]} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{title}</span>
                    <span className="shrink-0 text-xs text-slate-500">{c.lastTs ? fmtDay(c.lastTs) : ""}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-sm text-slate-600">{c.preview}</span>
                    {c.unread > 0 && <span className="shrink-0 rounded-full bg-secondary px-2 text-xs leading-5 text-white">{c.unread}</span>}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
        {tab === "chats" && !chats.length && <li className="p-6 text-center text-sm text-slate-500">Sem conversas. Adicione um contacto para começar.</li>}

        {tab === "contacts" && people.map((c) => (
          <li key={c.id} className="flex items-center border-b pr-2 text-xl text-slate-600 hover:bg-secondary-gray">
            <button onClick={() => openChat([c.id])} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left text-base text-black" aria-label={`Contacto ${c.name}`}>
              <Avatar seed={c.id} name={c.name} online={online[c.id]} />
              <div className="min-w-0"><p className="truncate">{c.name}{blocked.includes(c.id) && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 align-middle text-xs text-red-700">bloqueado</span>}</p><p className="truncate font-mono text-xs text-slate-500">{fmtId(c.id)}</p></div>
            </button>
            <ContactMenu id={c.id} name={c.name} />
          </li>
        ))}
        {tab === "contacts" && !people.length && <li className="p-6 text-center text-sm text-slate-500">Sem contactos.</li>}
      </ul>

      {modal === "profile" && <Profile onClose={() => setModal(null)} />}
      {modal === "contact" && <AddContact onClose={() => setModal(null)} />}
      {modal === "chat" && <NewChat onClose={() => setModal(null)} />}
      {modal === "settings" && <SettingsModal onClose={() => setModal(null)} />}
    </>
  );
}

export { AddContact };
