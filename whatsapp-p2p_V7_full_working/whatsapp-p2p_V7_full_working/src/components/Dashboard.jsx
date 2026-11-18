import { useApp } from "../context/AppProvider";
import SidePanel from "./SidePanel";
import Chat from "./Chat";
import CallOverlay from "./CallOverlay";

const BANNERS = {
  offline: "Sem ligação ao servidor. A tentar reconectar…",
  connecting: "A ligar ao servidor…",
  replaced: "Esta identidade foi aberta noutro separador. Recarregue a página para usar aqui.",
  denied: "O servidor recusou a identidade. Recarregue a página.",
};

export default function Dashboard() {
  const { selectedId, netState, netError, reconnect } = useApp();
  return (
    <div className="fontpro-text flex h-dvh flex-col overflow-hidden bg-secondary-gray">
      {BANNERS[netState] && (
        <div role="status" className="bg-amber-100 px-4 py-1.5 text-center text-sm text-amber-900">
          <div>{BANNERS[netState]}</div>
          {netError && <div className="mt-1 text-xs">{netError}</div>}
          {netState === "offline" && <button type="button" onClick={reconnect} className="mt-1 underline">Tentar novamente</button>}
        </div>
      )}
      <div className="mx-auto flex min-h-0 w-full flex-1 2xl:max-w-[1500px]">
        <aside className={`${selectedId ? "hidden md:flex" : "flex"} w-full flex-col border-r bg-white md:w-[380px] md:shrink-0`}>
          <SidePanel />
        </aside>
        <main className={`${selectedId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
          {selectedId ? <Chat key={selectedId} /> : (
            <div className="m-auto text-center text-slate-500">
              <p className="text-xl">Selecione ou crie uma conversa</p>
              <p className="mt-2 text-sm">Mensagens, voz, ficheiros e chamadas são ponto a ponto.</p>
            </div>
          )}
        </main>
      </div>
      <CallOverlay />
    </div>
  );
}
