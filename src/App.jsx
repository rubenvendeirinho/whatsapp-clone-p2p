import { useEffect, useState } from "react";
import { loadIdentity, clearLocalData } from "./core/identity";
import { AppProvider } from "./context/AppProvider";
import { installAudioUnlock } from "./lib/ring";
import Setup from "./components/Setup";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [st, setSt] = useState({ loading: true, identity: null, error: "" });

  useEffect(() => installAudioUnlock(), []);

  useEffect(() => {
    loadIdentity()
      .then((identity) => setSt({ loading: false, identity, error: "" }))
      .catch((e) => setSt({ loading: false, identity: null, error: e.message }));
  }, []);

  const logout = async () => {
    setSt({ loading: false, identity: null, error: "" });   // desmonta a app (fecha ligações) antes de apagar
    await new Promise((r) => setTimeout(r, 50));
    await clearLocalData();
  };

  if (st.loading) return null;
  if (!st.identity) return <Setup error={st.error} onCreated={(identity) => setSt({ loading: false, identity, error: "" })} />;
  return (
    <AppProvider identity={st.identity} onLogout={logout}>
      <Dashboard />
    </AppProvider>
  );
}
