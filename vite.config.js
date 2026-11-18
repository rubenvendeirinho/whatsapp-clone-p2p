import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Desenvolvimento e preview usam exatamente o mesmo proxy. Nunca aponte
// VITE_SOCKET_URL para localhost se outros dispositivos usarem a app pelo ngrok.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const port = Number(env.PORT || 5000);
  const target = env.SIGNALING_URL || `http://127.0.0.1:${port}`;
  // Hosts de túnel autorizados: defina o seu em TUNNEL_HOSTS (ver .env.example).
  const allowedHosts = [
    ...(env.TUNNEL_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean),
  ];
  const proxy = {
    "/socket.io": { target, ws: true, changeOrigin: true, xfwd: true },
    "/api/health": { target, changeOrigin: true },
    "/api/account": { target, changeOrigin: true },
  };
  return {
    plugins: [react()],
    // Porta fixa: o ngrok não deve continuar na 5173 se o Vite saltar para 5174.
    server: { host: "127.0.0.1", port: 5173, strictPort: true, allowedHosts, proxy },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true, allowedHosts, proxy },
    build: { sourcemap: false },
  };
});
