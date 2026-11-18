// IndexedDB mínima (sem dependências). Tudo fica no dispositivo do utilizador.
const NAME = "wa-p2p";
const VERSION = 1;
let dbp;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("kv");                                   // identidade, definições
      d.createObjectStore("contacts", { keyPath: "id" });
      d.createObjectStore("convs", { keyPath: "id" });
      const m = d.createObjectStore("messages", { keyPath: "id" });
      m.createIndex("conv", "convId");
      m.createIndex("pending", "pendingTo", { multiEntry: true }); // outbox por destinatário
      d.createObjectStore("blobs");                                // áudio e ficheiros (chave = id da msg)
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

function request(s, mode, run) {
  return open().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction(s, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error("Transação cancelada"));
    tx.onerror = () => reject(tx.error || new Error("Erro no armazenamento"));
    try {
      const req = run(tx.objectStore(s));
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => reject(req.error);
    } catch (e) { tx.abort(); reject(e); }
  }));
}

export const get = (s, key) => request(s, "readonly", (st) => st.get(key));
export const all = (s) => request(s, "readonly", (st) => st.getAll());
export const byIndex = (s, index, key) => request(s, "readonly", (st) => st.index(index).getAll(IDBKeyRange.only(key)));
export const del = (s, key) => request(s, "readwrite", (st) => st.delete(key));
export const put = (s, value, key) => request(s, "readwrite", (st) => key === undefined ? st.put(value) : st.put(value, key));

const STORES = ["kv", "contacts", "convs", "messages", "blobs"];
/** Apaga todos os dados locais (terminar sessão). */
export const wipeAll = () => Promise.all(STORES.map((s) => request(s, "readwrite", (st) => st.clear())));
