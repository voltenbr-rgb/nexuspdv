// Banco local do Nexus PDV (IndexedDB "nexuspdv"), versão 2.
// Cada coisa fica em seu lugar e é gravada sozinha, sem regravar a loja inteira:
//   companies → dados da loja (nome, plano, configurações)
//   products  → um registro por produto            chave [storeId, id]
//   sales     → um registro por venda              chave [storeId, id]
//   outbox    → fila de alterações para enviar à nuvem (sincronização incremental)
const DB_NAME = "nexuspdv";
const LEGACY_DB_NAME = "nexus_pdv_db";
const DB_VERSION = 2;
const COMPANIES = "companies", PRODUCTS = "products", SALES = "sales", OUTBOX = "outbox";
const LOCAL_SALES_LIMIT = 300; // vendas carregadas na memória (as mais recentes)
let dbPromise;

const reqP = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const txDone = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

// Separa a loja em: dados da loja + produtos + vendas
function splitCompany(company) {
  const { products = [], sales = [], ...meta } = company;
  return { meta, products, sales };
}
function writeSplit(tx, company) {
  const { meta, products, sales } = splitCompany(company);
  tx.objectStore(COMPANIES).put(meta);
  products.forEach(p => tx.objectStore(PRODUCTS).put({ ...p, storeId: meta.empresa_id }));
  sales.forEach(s => tx.objectStore(SALES).put({ ...s, storeId: meta.empresa_id }));
}
const stripStore = ({ storeId, ...rest }) => rest;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!db.objectStoreNames.contains(COMPANIES)) db.createObjectStore(COMPANIES, { keyPath: "empresa_id" });
      if (!db.objectStoreNames.contains(PRODUCTS)) {
        const s = db.createObjectStore(PRODUCTS, { keyPath: ["storeId", "id"] });
        s.createIndex("byStore", "storeId");
      }
      if (!db.objectStoreNames.contains(SALES)) {
        const s = db.createObjectStore(SALES, { keyPath: ["storeId", "id"] });
        s.createIndex("byStoreCreated", ["storeId", "createdAt"]);
      }
      if (!db.objectStoreNames.contains(OUTBOX)) {
        const s = db.createObjectStore(OUTBOX, { keyPath: "seq", autoIncrement: true });
        s.createIndex("byStore", "storeId");
      }
      // v1 → v2: tira produtos e vendas de dentro do registro da loja
      if (event.oldVersion >= 1) {
        tx.objectStore(COMPANIES).openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          if (Array.isArray(cursor.value.products) || Array.isArray(cursor.value.sales)) writeSplit(tx, cursor.value);
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).then(async (db) => { await migrateLegacy(db); return db; });
  return dbPromise;
}

// Copia as lojas do banco antigo ("nexus_pdv_db"), se o novo estiver vazio.
async function migrateLegacy(db) {
  try {
    if (!indexedDB.databases) return;
    const list = await indexedDB.databases();
    if (!list.some(d => d.name === LEGACY_DB_NAME)) return;
    if (await reqP(db.transaction(COMPANIES, "readonly").objectStore(COMPANIES).count()) > 0) return;
    const legacy = await reqP(indexedDB.open(LEGACY_DB_NAME));
    if (!legacy.objectStoreNames.contains(COMPANIES)) { legacy.close(); return; }
    const all = await reqP(legacy.transaction(COMPANIES, "readonly").objectStore(COMPANIES).getAll());
    legacy.close();
    if (!all.length) return;
    const tx = db.transaction([COMPANIES, PRODUCTS, SALES], "readwrite");
    all.forEach(c => writeSplit(tx, c));
    await txDone(tx);
  } catch (err) {
    console.warn("Migração do banco local antigo não realizada:", err);
  }
}

async function loadRecentSales(db, storeId) {
  const index = db.transaction(SALES, "readonly").objectStore(SALES).index("byStoreCreated");
  const range = IDBKeyRange.bound([storeId, -Infinity], [storeId, Infinity]);
  const out = [];
  await new Promise((resolve, reject) => {
    const req = index.openCursor(range, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= LOCAL_SALES_LIMIT) return resolve();
      out.push(stripStore(cursor.value));
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out.reverse();
}

// Loja completa: dados + produtos + vendas recentes
export async function getCompany(empresa_id) {
  const db = await openDB();
  const meta = await reqP(db.transaction(COMPANIES, "readonly").objectStore(COMPANIES).get(empresa_id));
  if (!meta) return null;
  const products = (await reqP(db.transaction(PRODUCTS, "readonly").objectStore(PRODUCTS).index("byStore").getAll(empresa_id))).map(stripStore);
  const sales = await loadRecentSales(db, empresa_id);
  return { ...meta, products, sales };
}

// Gravação completa (só no cadastro / primeira abertura no aparelho)
export async function saveCompany(company) {
  const db = await openDB();
  const tx = db.transaction([COMPANIES, PRODUCTS, SALES], "readwrite");
  writeSplit(tx, company);
  await txDone(tx);
  return company;
}

// Grava só os dados da loja (sem produtos e vendas)
export async function saveCompanyMeta(company) {
  const db = await openDB();
  const tx = db.transaction(COMPANIES, "readwrite");
  tx.objectStore(COMPANIES).put(splitCompany(company).meta);
  await txDone(tx);
}

// Grava uma alteração pontual, numa única transação:
// { meta, products: [...], deleteProductIds: [...], sales: [...], outbox: [...] }
export async function commitLocal(storeId, { meta, products = [], deleteProductIds = [], sales = [], outbox = [] }) {
  const db = await openDB();
  const tx = db.transaction([COMPANIES, PRODUCTS, SALES, OUTBOX], "readwrite");
  if (meta) tx.objectStore(COMPANIES).put(splitCompany(meta).meta);
  products.forEach(p => tx.objectStore(PRODUCTS).put({ ...p, storeId }));
  deleteProductIds.forEach(id => tx.objectStore(PRODUCTS).delete([storeId, id]));
  sales.forEach(s => tx.objectStore(SALES).put({ ...s, storeId }));
  outbox.forEach(change => tx.objectStore(OUTBOX).add({ storeId, createdAt: Date.now(), change }));
  await txDone(tx);
}

// Fila de alterações (outbox)
export async function listOutbox(storeId, limit = 200) {
  const db = await openDB();
  const index = db.transaction(OUTBOX, "readonly").objectStore(OUTBOX).index("byStore");
  return reqP(index.getAll(storeId, limit));
}
export async function removeOutbox(seqs) {
  if (!seqs.length) return;
  const db = await openDB();
  const tx = db.transaction(OUTBOX, "readwrite");
  seqs.forEach(seq => tx.objectStore(OUTBOX).delete(seq));
  await txDone(tx);
}
export async function countOutbox(storeId) {
  const db = await openDB();
  return reqP(db.transaction(OUTBOX, "readonly").objectStore(OUTBOX).index("byStore").count(storeId));
}

export async function findCompanyByEmail(email) {
  const db = await openDB();
  const all = await reqP(db.transaction(COMPANIES, "readonly").objectStore(COMPANIES).getAll());
  const meta = all.find(c => String(c.email).toLowerCase() === email.toLowerCase());
  return meta ? getCompany(meta.empresa_id) : null;
}
