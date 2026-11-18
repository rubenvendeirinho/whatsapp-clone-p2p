import { useState } from "react";
import { createIdentity } from "../core/identity";
import { fetchBackup, restoreFromBackup, sendCode } from "../core/account";
import { unlockAudio } from "../lib/ring";

const input = "mb-3 w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm";
const primary = "w-full rounded-lg bg-secondary px-5 py-2.5 font-medium text-white disabled:opacity-50";

function NewIdentity({ onCreated, setErr, secure }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      unlockAudio();
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
      onCreated(await createIdentity(name));
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  return (
    <form onSubmit={submit}>
      <p className="mb-4 text-sm text-slate-600">
        É criada uma chave criptográfica neste dispositivo; o seu ID é derivado dela e ninguém o pode falsificar.
        Depois pode ligar um email (Definições) para guardar o perfil e os contactos e reabri-los noutro dispositivo.
      </p>
      <label htmlFor="name" className="mb-2 block text-sm font-medium">O seu nome</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus required className={input} placeholder="Como o vão ver" />
      <button disabled={!secure || busy} className={primary}>{busy ? "A criar…" : "Criar identidade"}</button>
    </form>
  );
}

function EmailLogin({ onCreated, setErr, secure }) {
  const [step, setStep] = useState("email");           // email -> code -> password
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [info, setInfo] = useState("");
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = (fn) => async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { await fn(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  const ask = run(async () => {
    const mode = await sendCode(email);
    setInfo(mode === "console" ? "O Gmail ainda não está configurado no servidor: o código foi escrito no terminal onde o servidor corre." : "Enviámos um código de 6 dígitos para o seu email.");
    setStep("code");
  });
  const verify = run(async () => { setFound(await fetchBackup(email, code)); setStep("password"); });
  const open = run(async () => {
    unlockAudio();
    onCreated(await restoreFromBackup(found, password));
  });

  return (
    <div>
      {step === "email" && (
        <form onSubmit={ask}>
          <p className="mb-4 text-sm text-slate-600">Entre com o email que ligou à sua conta para recuperar o perfil e os contactos.</p>
          <label htmlFor="email" className="mb-2 block text-sm font-medium">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className={input} placeholder="exemplo@gmail.com" />
          <button disabled={!secure || busy} className={primary}>{busy ? "A enviar…" : "Enviar código"}</button>
        </form>
      )}
      {step === "code" && (
        <form onSubmit={verify}>
          {info && <p className="mb-3 rounded bg-sky-50 p-3 text-sm text-sky-900">{info}</p>}
          <label htmlFor="code" className="mb-2 block text-sm font-medium">Código de 6 dígitos</label>
          <input id="code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} maxLength={7} required autoFocus className={`${input} tracking-widest`} />
          <button disabled={busy || code.replace(/\D/g, "").length !== 6} className={primary}>{busy ? "A verificar…" : "Continuar"}</button>
          <button type="button" onClick={() => { setStep("email"); setErr(""); }} className="mt-2 w-full text-sm text-slate-500 underline">Voltar</button>
        </form>
      )}
      {step === "password" && (
        <form onSubmit={open}>
          <p className="mb-3 text-sm text-slate-600">Conta encontrada. Introduza a palavra-passe de recuperação que escolheu ao ativar a conta; é ela que decifra a cópia de segurança (o servidor não a conhece).</p>
          <label htmlFor="rp" className="mb-2 block text-sm font-medium">Palavra-passe de recuperação</label>
          <input id="rp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus className={input} autoComplete="current-password" />
          <button disabled={busy || !password} className={primary}>{busy ? "A abrir…" : "Abrir conta"}</button>
        </form>
      )}
    </div>
  );
}

export default function Setup({ onCreated, error }) {
  const [tab, setTab] = useState("new");
  const [err, setErr] = useState(error || "");
  const secure = window.isSecureContext && !!crypto?.subtle;
  const change = (t) => { setTab(t); setErr(""); };

  return (
    <div className="min-h-dvh bg-secondary-gray">
      <div className="h-52 bg-secondary" />
      <div className="-mt-32 mx-auto w-[92%] max-w-md rounded-xl bg-white p-8 shadow-xl">
        <h1 className="mb-4 text-2xl font-semibold">WhatsApp P2P</h1>
        {!secure && (
          <p role="alert" className="mb-4 rounded bg-amber-100 p-3 text-sm text-amber-900">
            Esta página precisa de HTTPS (ou localhost) para usar criptografia, microfone, câmara e localização.
          </p>
        )}
        <div className="mb-5 flex gap-2 text-sm" role="tablist">
          {[["new", "Novo neste dispositivo"], ["email", "Entrar com email"]].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => change(k)}
              className={`rounded-full px-3 py-1.5 ${tab === k ? "bg-secondary-green text-green-900" : "bg-gray-200 text-slate-700"}`}>{label}</button>
          ))}
        </div>
        {err && <p role="alert" className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        {tab === "new" ? <NewIdentity onCreated={onCreated} setErr={setErr} secure={secure} /> : <EmailLogin onCreated={onCreated} setErr={setErr} secure={secure} />}
        <p className="mt-4 text-xs text-slate-500">
          Atenção: sem uma conta por email, a chave fica só neste browser. Se limpar os dados do site, perde a identidade e as conversas.
          As mensagens e ficheiros ficam sempre apenas nos dispositivos (a conta guarda perfil e contactos, não conversas).
        </p>
      </div>
    </div>
  );
}
