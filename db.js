// IndexedDB simples: dados separados por empresa_id.
// Banco local: "nexuspdv" (mesmo nome do banco do backend).
const DB_NAME = "nexuspdv";
const LEGACY_DB_NAME = "nexus_pdv_db"; // nome antigo: os dados são copiados automaticamente uma única vez
const DB_VERSION = 1;
const STORE = "companies";
let dbPromise;

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Copia as lojas do banco antigo ("nexus_pdv_db") para o novo ("nexuspdv"), se ele estiver vazio.
async function migrateLegacy(db) {
  try {
    if (!indexedDB.databases) return;
    const list = await indexedDB.databases();
    if (!list.some(d => d.name === LEGACY_DB_NAME)) return;
    const count = await requestToPromise(db.transaction(STORE, "readonly").objectStore(STORE).count());
    if (count > 0) return;
    const legacy = await requestToPromise(indexedDB.open(LEGACY_DB_NAME));
    if (!legacy.objectStoreNames.contains(STORE)) { legacy.close(); return; }
    const all = await requestToPromise(legacy.transaction(STORE, "readonly").objectStore(STORE).getAll());
    legacy.close();
    if (!all.length) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      all.forEach(c => tx.objectStore(STORE).put(c));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Migração do banco local antigo não realizada:", err);
  }
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "empresa_id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).then(async (db) => { await migrateLegacy(db); return db; });
  return dbPromise;
}
export async function getCompany(empresa_id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(empresa_id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
export async function saveCompany(company) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(company);
    tx.oncomplete = () => resolve(company);
    tx.onerror = () => reject(tx.error);
  });
}
export async function findCompanyByEmail(email) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.find(c => c.email.toLowerCase() === email.toLowerCase()) || null);
    req.onerror = () => reject(req.error);
  });
}
