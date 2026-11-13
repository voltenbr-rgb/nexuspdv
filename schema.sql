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
  cashier_open INTEGER NOT NULL DEFAULT 0
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
