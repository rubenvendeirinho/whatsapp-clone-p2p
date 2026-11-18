import { useState } from "react";
import { useApp } from "../context/AppProvider";
import { sendCode, MIN_PASSWORD } from "../core/account";
import { RING_TONES } from "../lib/settings";
import { previewRing, unlockAudio } from "../lib/ring";
import { fmtId } from "../lib/format";
import Modal from "./Modal";
import Avatar from "./Avatar";

const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const field = "w-full rounded-lg border bg-gray-50 p-2.5 text-sm";

function Section({ title, children }) {
  return (
    <section className="border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Ringtone() {
  const { settings, setSettings } = useApp();
  return (
    <Section title="Toque de chamada">
      <label className="block text-sm text-slate-600" htmlFor="ring-vol">Volume: {Math.round(settings.ringVolume * 100)}%</label>
      <input id="ring-vol" type="range" min="0" max="100" step="5" value={Math.round(settings.ringVolume * 100)} disabled={settings.ringMuted}
        onChange={(e) => setSettings({ ringVolume: Number(e.target.value) / 100 })} className="my-2 w-full accent-[#00a884]" />
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.ringMuted} onChange={(e) => setSettings({ ringMuted: e.target.checked })} /> Silenciar toque
      </label>
      <div className="flex items-center gap-2">
        <select aria-label="Tom do toque" value={settings.ringTone} onChange={(e) => setSettings({ ringTone: e.target.value })} className="rounded-lg border bg-gray-50 p-2 text-sm">
          {RING_TONES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button type="button" onClick={() => { unlockAudio(); previewRing({ ringVolume: settings.ringVolume, ringTone: settings.ringTone, ringMuted: settings.ringMuted }); }}
          className={`${btn} bg-secondary text-white`}>Testar toque</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Se não ouvir o toque, clique primeiro em qualquer parte da página: o browser só permite som depois de uma interação.</p>
    </Section>
  );
}

function Blocked() {
  const { blocked, contacts, unblockContact } = useApp();
  const nameOf = (id) => contacts.find((c) => c.id === id)?.name ?? fmtId(id);
  return (
    <Section title="Contactos bloqueados">
      {!blocked.length && <p className="text-sm text-slate-500">Não há contactos bloqueados.</p>}
      <ul className="space-y-1">
        {blocked.map((id) => (
          <li key={id} className="flex items-center gap-2 rounded p-1">
            <Avatar seed={id} name={nameOf(id)} size={32} />
            <span className="min-w-0 flex-1 truncate text-sm">{nameOf(id)}</span>
            <button onClick={() => unblockContact(id)} className={`${btn} bg-slate-200`}>Desbloquear</button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Account() {
  const { account, linkAccount, backupNow, unlinkAccount, backupError, identity } = useApp();
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [info, setInfo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const legacy = identity.privateKey && identity.privateKey.extractable === false;

  const run = (fn) => async (e) => {
    e?.preventDefault();
    setErr(""); setBusy(true);
    try { await fn(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const ask = run(async () => {
    const mode = await sendCode(email);
    setInfo(mode === "console" ? "Gmail não configurado no servidor: o código foi escrito no terminal do servidor." : "Código enviado para o seu email.");
    setStep("code");
  });
  const link = run(async () => {
    if (pw !== pw2) throw new Error("As palavras-passe não coincidem.");
    await linkAccount(email, code, pw);
    setStep("email"); setCode(""); setPw(""); setPw2("");
  });
  const backup = run(() => backupNow());
  const remove = run(async () => {
    if (!window.confirm("Remover a conta e apagar a cópia de segurança do servidor? Perderá a possibilidade de recuperar esta identidade noutro dispositivo.")) return;
    await unlinkAccount();
  });

  if (account) return (
    <Section title="Conta e cópia de segurança">
      <p className="text-sm">Ligada a <strong>{account.email}</strong></p>
      <p className="mt-1 text-xs text-slate-500">
        Última cópia: {account.ts ? new Date(account.ts).toLocaleString() : "—"}. O perfil, os contactos, os bloqueados e as definições são guardados
        cifrados e atualizados automaticamente. As conversas ficam só nos dispositivos.
      </p>
      {(err || backupError) && <p role="alert" className="mt-2 text-sm text-red-600">{err || backupError}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={backup} disabled={busy} className={`${btn} bg-secondary text-white`}>{busy ? "A guardar…" : "Guardar cópia agora"}</button>
        <button onClick={remove} disabled={busy} className={`${btn} bg-red-100 text-red-700`}>Remover conta</button>
      </div>
    </Section>
  );

  return (
    <Section title="Conta e cópia de segurança">
      {legacy ? (
        <p className="rounded bg-amber-100 p-3 text-sm text-amber-900">
          Esta identidade foi criada numa versão antiga e a chave não pode ser guardada na conta. Termine a sessão (em baixo), crie uma identidade nova e ative a conta.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">Ligue um email para guardar o perfil e os contactos e reabri-los noutro dispositivo sem novo registo.</p>
          {step === "email" ? (
            <form onSubmit={ask} className="space-y-2">
              <input type="email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="exemplo@gmail.com" required className={field} />
              <button disabled={busy} className={`${btn} bg-secondary text-white`}>{busy ? "A enviar…" : "Enviar código"}</button>
            </form>
          ) : (
            <form onSubmit={link} className="space-y-2">
              {info && <p className="rounded bg-sky-50 p-2 text-sm text-sky-900">{info}</p>}
              <input aria-label="Código" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} maxLength={7} placeholder="Código de 6 dígitos" required className={`${field} tracking-widest`} />
              <input type="password" aria-label="Palavra-passe de recuperação" value={pw} onChange={(e) => setPw(e.target.value)} minLength={MIN_PASSWORD} placeholder={`Palavra-passe de recuperação (mín. ${MIN_PASSWORD})`} required className={field} autoComplete="new-password" />
              <input type="password" aria-label="Repetir palavra-passe" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repetir palavra-passe" required className={field} autoComplete="new-password" />
              <p className="text-xs text-slate-500">Esta palavra-passe cifra a cópia no seu dispositivo e o servidor não a conhece: se a perder, não é possível recuperar a conta.</p>
              <div className="flex gap-2">
                <button disabled={busy} className={`${btn} bg-secondary text-white`}>{busy ? "A ativar…" : "Ativar conta"}</button>
                <button type="button" onClick={() => { setStep("email"); setErr(""); }} className={`${btn} bg-slate-200`}>Voltar</button>
              </div>
            </form>
          )}
        </>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
    </Section>
  );
}

function Session() {
  const { logout, account } = useApp();
  const ask = () => {
    const msg = account
      ? "Terminar sessão neste dispositivo? Os dados locais (conversas e ficheiros) serão apagados. Pode voltar a entrar com o email."
      : "Terminar sessão sem conta por email APAGA a identidade, os contactos e as conversas deste dispositivo, sem forma de os recuperar. Continuar?";
    if (window.confirm(msg)) logout();
  };
  return (
    <Section title="Sessão">
      <button onClick={ask} className={`${btn} bg-red-100 text-red-700`}>Terminar sessão</button>
    </Section>
  );
}

export default function SettingsModal({ onClose }) {
  return (
    <Modal title="Definições" onClose={onClose}>
      <div className="space-y-4">
        <Account />
        <Ringtone />
        <Blocked />
        <Session />
      </div>
    </Modal>
  );
}
