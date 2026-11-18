// Destinos para dados recebidos por P2P.
export const MEM_LIMIT = 300 * 1024 * 1024; // acima disto só com escrita direta em disco

export function memorySink(mime, limit = MEM_LIMIT) {
  let parts = [], size = 0;
  return {
    async write(buf) {
      size += buf.byteLength;
      if (size > limit) throw new Error("too-big");
      parts.push(buf);
    },
    async close() { const b = new Blob(parts, { type: mime || "application/octet-stream" }); parts = []; return b; },
    async abort() { parts = []; },
  };
}

export const canWriteToDisk = () => typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";

/** Tem de ser chamado dentro de um gesto do utilizador (clique). */
export async function diskSink(name) {
  const handle = await window.showSaveFilePicker({ suggestedName: name });
  const w = await handle.createWritable();
  return {
    write: (buf) => w.write(buf),
    async close() { await w.close(); return null; },
    async abort() { try { await w.abort(); } catch { /* ignora */ } },
  };
}
