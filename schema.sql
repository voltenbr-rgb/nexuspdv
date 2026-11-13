-- Nexus PDV — estrutura do banco D1 "nexuspdv"
-- Pode ser executado mais de uma vez (IF NOT EXISTS).

-- Lojas (clientes do SaaS). A senha fica só como hash PBKDF2: nem a Área Master consegue lê-la.
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,                         -- empresa_id
  store_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  trial_ends_at INTEGER NOT NULL,
  plan TEXT,                                   -- basico | completo | premium
  plan_expires_at INTEGER,
  blocked INTEGER NOT NULL DEFAULT 0,          -- desativado manualmente pela Área Master
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  cashier_open INTEGER NOT NULL DEFAULT 0,
  requested_plan TEXT,                         -- plano que o cliente pediu pelo app
  requested_at INTEGER
);

-- Sessões de login (guardamos só o hash do token).
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  store_id TEXT,                               -- NULL para a sessão master
  role TEXT NOT NULL,                          -- store | master
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_store ON sessions(store_id);

-- Mensagens da Área Master para todas as lojas.
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',          -- info | aviso | urgente
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- Histórico do que a Área Master fez em cada loja.
CREATE TABLE IF NOT EXISTS store_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_store ON store_events(store_id);

-- Limite de tentativas de login (contra tentativa e erro de senha).
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Configurações gerais (ex.: senha da Área Master, só em hash).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- =====================================================================
-- Sincronização incremental de produtos, vendas e configurações
-- Cada linha guarda:
--   modified_at → quando a alteração foi feita no caixa (decide quem vence)
--   updated_at  → quando o servidor gravou (cursor para baixar só o que é novo)
-- =====================================================================
CREATE TABLE IF NOT EXISTS products (
  store_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  code TEXT,
  price REAL NOT NULL DEFAULT 0,
  emoji TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,          -- exclusão vira "lápide" para propagar aos outros aparelhos
  modified_at INTEGER NOT NULL,
  stock_modified_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, id)
);
-- baixar alterações: WHERE store_id = ? AND updated_at >= ? ORDER BY updated_at, id
CREATE INDEX IF NOT EXISTS idx_products_sync ON products(store_id, updated_at, id);
-- busca por código de barras
CREATE INDEX IF NOT EXISTS idx_products_code ON products(store_id, code);

CREATE TABLE IF NOT EXISTS sales (
  store_id TEXT NOT NULL,
  id TEXT NOT NULL,
  number INTEGER,
  created_at INTEGER NOT NULL,
  subtotal REAL,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  payment TEXT,
  received REAL,
  change_value REAL,
  items TEXT NOT NULL,                         -- itens da venda em JSON
  stock_applied INTEGER NOT NULL DEFAULT 0,    -- baixa de estoque já feita (evita baixar duas vezes)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sales_sync ON sales(store_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(store_id, created_at);

CREATE TABLE IF NOT EXISTS store_settings (
  store_id TEXT NOT NULL,
  key TEXT NOT NULL,                           -- hardware | favorites | security
  value TEXT NOT NULL,                         -- JSON
  modified_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, key)
);
CREATE INDEX IF NOT EXISTS idx_settings_sync ON store_settings(store_id, updated_at, key);

-- lista da Área Master (ORDER BY created_at)
CREATE INDEX IF NOT EXISTS idx_stores_created ON stores(created_at);
