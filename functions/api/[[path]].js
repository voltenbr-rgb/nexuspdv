// Nexus PDV — API (Cloudflare Pages Functions + D1 "nexuspdv", binding DB)
// Rotas em /api/*. Senhas ficam só em hash PBKDF2; tokens de sessão só em hash SHA-256.

const DAY = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 7;
const GRACE_DAYS = 7;                 // depois do vencimento: amarelo por 7 dias, depois vermelho
const ONLINE_WINDOW = 150 * 1000;     // caixa "ligado" se deu sinal nos últimos 2,5 min
const STORE_SESSION_MS = 30 * DAY;
const MASTER_SESSION_MS = 12 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100000;     // limite máximo do Workers
const PLANS = {
  basico:   { name: "Básico",   price: 39.9 },
  completo: { name: "Completo", price: 99.9 },
  premium:  { name: "Premium",  price: 189.9 }
};
const PERIODS = [15, 30, 90, 180, 365];

// ---------- utilidades ----------
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (text) => hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new HttpError(status, code); };

function timingSafeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}
async function verifyPassword(password, stored) {
  const [scheme, iter, saltB64, hashB64] = String(stored || "").split("$");
  if (scheme !== "pbkdf2") return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: Number(iter) }, key, 256);
  return timingSafeEqual(b64(bits), hashB64);
}
function tempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join("");
}
const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

async function readBody(request) {
  if (request.method === "GET" || request.method === "DELETE") return {};
  const text = await request.text();
  if (text.length > 20000) fail(413, "payload_too_large");
  try { return text ? JSON.parse(text) : {}; } catch { fail(400, "invalid_json"); }
}

// ---------- limite de tentativas ----------
async function rateLimit(db, key, max, windowMs) {
  const now = Date.now();
  const row = await db.prepare("SELECT count, window_start FROM login_attempts WHERE key = ?").bind(key).first();
  if (!row || now - row.window_start > windowMs) {
    await db.prepare("INSERT OR REPLACE INTO login_attempts (key, count, window_start) VALUES (?, 1, ?)").bind(key, now).run();
    return;
  }
  if (row.count >= max) fail(429, "too_many_attempts");
  await db.prepare("UPDATE login_attempts SET count = count + 1 WHERE key = ?").bind(key).run();
}
const clearRateLimit = (db, key) => db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();

// ---------- status da loja ----------
function storeStatus(s, now = Date.now()) {
  if (s.blocked) return { code: "desativado", color: "red", label: "Desativado" };
  if (s.plan && s.plan_expires_at > now) return { code: "ativo", color: "green", label: `Plano ${PLANS[s.plan]?.name || s.plan}` };
  if (!s.plan_expires_at && s.trial_ends_at > now) return { code: "teste", color: "yellow", label: "Em teste" };
  const end = Math.max(s.plan_expires_at || 0, s.trial_ends_at || 0);
  if (end > now) return { code: "teste", color: "yellow", label: "Em teste" };
  if (now - end <= GRACE_DAYS * DAY) return { code: "pendente", color: "yellow", label: "Pagamento pendente" };
  return { code: "desativado", color: "red", label: "Vencido" };
}
function publicStore(s, now = Date.now()) {
  return {
    id: s.id, storeName: s.store_name, email: s.email, createdAt: s.created_at,
    trialEndsAt: s.trial_ends_at, plan: s.plan, planName: s.plan ? PLANS[s.plan]?.name : null,
    planExpiresAt: s.plan_expires_at, status: storeStatus(s, now),
    mustChangePassword: Boolean(s.must_change_password)
  };
}
function masterStore(s, now = Date.now()) {
  return {
    ...publicStore(s, now), blocked: Boolean(s.blocked), lastSeenAt: s.last_seen_at,
    online: Boolean(s.cashier_open) && (now - (s.last_seen_at || 0) < ONLINE_WINDOW)
  };
}

// ---------- sessões ----------
async function createSession(db, role, storeId, ms) {
  const token = randomToken();
  const now = Date.now();
  await db.prepare("INSERT INTO sessions (token_hash, store_id, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), storeId, role, now, now + ms).run();
  // limpeza leve de sessões vencidas
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
  return token;
}
async function getSession(db, request, body, role) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (body?.token || "");
  if (!token) fail(401, "unauthorized");
  const row = await db.prepare("SELECT * FROM sessions WHERE token_hash = ?").bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now() || row.role !== role) fail(401, "unauthorized");
  return { ...row, tokenHash: row.token_hash };
}
async function requireStore(db, request, body) {
  const session = await getSession(db, request, body, "store");
  const store = await db.prepare("SELECT * FROM stores WHERE id = ?").bind(session.store_id).first();
  if (!store) fail(401, "unauthorized");
  return { session, store };
}
const requireMaster = (db, request, body) => getSession(db, request, body, "master");
const logEvent = (db, storeId, action, detail) =>
  db.prepare("INSERT INTO store_events (store_id, action, detail, created_at) VALUES (?, ?, ?, ?)").bind(storeId, action, detail || null, Date.now()).run();
async function activeBroadcasts(db) {
  const { results } = await db.prepare("SELECT id, title, body, level, created_at FROM broadcasts WHERE active = 1 ORDER BY id DESC LIMIT 10").all();
  return results.map(b => ({ id: b.id, title: b.title, body: b.body, level: b.level, createdAt: b.created_at }));
}

// ---------- senha master ----------
async function masterConfigured(env, db) {
  if (env.MASTER_PASSWORD) return true;
  return Boolean(await db.prepare("SELECT 1 FROM settings WHERE key = 'master_password_hash'").first());
}
async function checkMasterPassword(env, db, password) {
  if (env.MASTER_PASSWORD) return timingSafeEqual(password, env.MASTER_PASSWORD);
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'master_password_hash'").first();
  return row ? verifyPassword(password, row.value) : false;
}

// ---------- rotas ----------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// Manifesto do app instalável: "PDV <nome da loja>"
route("GET", /^manifest$/, async ({ url }) => {
  const store = cleanText(url.searchParams.get("loja"), 40);
  const name = store ? `PDV ${store}` : "Nexus PDV";
  const manifest = {
    id: "/", name, short_name: name.length > 12 && store ? `PDV ${store}`.slice(0, 24) : name,
    description: "Frente de caixa Nexus PDV", lang: "pt-BR",
    start_url: "/?app=1", scope: "/", display: "standalone",
    background_color: "#fff8ee", theme_color: "#f97316",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
  return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=300" } });
});

route("GET", /^health$/, async ({ db }) => {
  await db.prepare("SELECT 1").first();
  return json({ ok: true });
});

route("POST", /^auth\/register$/, async ({ db, body, ip }) => {
  await rateLimit(db, `register:${ip}`, 10, 60 * 60 * 1000);
  const storeName = cleanText(body.storeName, 60);
  const email = cleanText(body.email, 254).toLowerCase();
  const password = String(body.password || "");
  if (!storeName) fail(400, "store_name_required");
  if (!validEmail(email)) fail(400, "invalid_email");
  if (password.length < 4 || password.length > 128) fail(400, "weak_password");
  if (await db.prepare("SELECT 1 FROM stores WHERE email = ?").bind(email).first()) fail(409, "email_exists");
  let id = /^emp_[a-f0-9]{16}$/.test(body.empresaId || "") ? body.empresaId : "";
  if (!id || await db.prepare("SELECT 1 FROM stores WHERE id = ?").bind(id).first()) id = "emp_" + hex(crypto.getRandomValues(new Uint8Array(8)));
  const now = Date.now();
  await db.prepare(`INSERT INTO stores (id, store_name, email, password_hash, created_at, trial_ends_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, storeName, email, await hashPassword(password), now, now + TRIAL_DAYS * DAY).run();
  await logEvent(db, id, "cadastro", "Teste grátis de 7 dias");
  const store = await db.prepare("SELECT * FROM stores WHERE id = ?").bind(id).first();
  const token = await createSession(db, "store", id, STORE_SESSION_MS);
  return json({ token, store: publicStore(store) }, 201);
});

route("POST", /^auth\/login$/, async ({ db, body, ip }) => {
  const email = cleanText(body.email, 254).toLowerCase();
  const password = String(body.password || "");
  await rateLimit(db, `login-ip:${ip}`, 30, 15 * 60 * 1000);
  await rateLimit(db, `login:${email}`, 10, 15 * 60 * 1000);
  const store = await db.prepare("SELECT * FROM stores WHERE email = ?").bind(email).first();
  if (!store || !await verifyPassword(password, store.password_hash)) fail(401, "invalid_credentials");
  await clearRateLimit(db, `login:${email}`);
  const token = await createSession(db, "store", store.id, STORE_SESSION_MS);
  return json({ token, store: publicStore(store) });
});

route("POST", /^auth\/password$/, async ({ db, request, body }) => {
  const { session, store } = await requireStore(db, request, body);
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < 4 || newPassword.length > 128) fail(400, "weak_password");
  await db.prepare("UPDATE stores SET password_hash = ?, must_change_password = 0 WHERE id = ?").bind(await hashPassword(newPassword), store.id).run();
  // derruba as outras sessões da loja
  await db.prepare("DELETE FROM sessions WHERE store_id = ? AND token_hash != ?").bind(store.id, session.tokenHash).run();
  await logEvent(db, store.id, "senha", "Senha alterada pelo cliente");
  return json({ ok: true });
});

route("POST", /^auth\/logout$/, async ({ db, request, body }) => {
  const { session, store } = await requireStore(db, request, body);
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.tokenHash).run();
  await db.prepare("UPDATE stores SET cashier_open = 0 WHERE id = ?").bind(store.id).run();
  return json({ ok: true });
});

// Sinal de vida do caixa + mensagens + status da assinatura
route("POST", /^heartbeat$/, async ({ db, request, body }) => {
  const { store } = await requireStore(db, request, body);
  const now = Date.now();
  await db.prepare("UPDATE stores SET last_seen_at = ?, cashier_open = ? WHERE id = ?").bind(now, body.cashierOpen === false ? 0 : 1, store.id).run();
  return json({ store: publicStore(store, now), broadcasts: await activeBroadcasts(db), serverTime: now });
});

// ----- Área Master -----
route("GET", /^master\/status$/, async ({ db, env }) => json({ configured: await masterConfigured(env, db) }));

route("POST", /^master\/setup$/, async ({ db, env, body, ip }) => {
  await rateLimit(db, `master-setup:${ip}`, 5, 15 * 60 * 1000);
  if (await masterConfigured(env, db)) fail(409, "already_configured");
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'master_setup_code'").first();
  if (!row || !timingSafeEqual(await sha256(String(body.code || "").trim()), row.value)) fail(401, "invalid_setup_code");
  const password = String(body.password || "");
  if (password.length < 8) fail(400, "weak_password");
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('master_password_hash', ?)").bind(await hashPassword(password)),
    db.prepare("DELETE FROM settings WHERE key = 'master_setup_code'")
  ]);
  const token = await createSession(db, "master", null, MASTER_SESSION_MS);
  return json({ token });
});

route("POST", /^master\/login$/, async ({ db, env, body, ip }) => {
  await rateLimit(db, `master:${ip}`, 5, 15 * 60 * 1000);
  if (!await checkMasterPassword(env, db, String(body.password || ""))) fail(401, "invalid_credentials");
  await clearRateLimit(db, `master:${ip}`);
  const token = await createSession(db, "master", null, MASTER_SESSION_MS);
  return json({ token });
});

route("POST", /^master\/logout$/, async ({ db, request, body }) => {
  const session = await requireMaster(db, request, body);
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.tokenHash).run();
  return json({ ok: true });
});

route("POST", /^master\/password$/, async ({ db, env, request, body }) => {
  await requireMaster(db, request, body);
  if (env.MASTER_PASSWORD) fail(409, "managed_by_secret");
  if (!await checkMasterPassword(env, db, String(body.current || ""))) fail(401, "invalid_credentials");
  const next = String(body.newPassword || "");
  if (next.length < 8) fail(400, "weak_password");
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('master_password_hash', ?)").bind(await hashPassword(next)).run();
  return json({ ok: true });
});

route("GET", /^master\/overview$/, async ({ db, request, body }) => {
  await requireMaster(db, request, body);
  const now = Date.now();
  const { results } = await db.prepare("SELECT * FROM stores ORDER BY created_at DESC LIMIT 1000").all();
  const stores = results.map(s => masterStore(s, now));
  const kpis = { total: stores.length, online: 0, teste: 0, ativo: 0, pendente: 0, desativado: 0 };
  stores.forEach(s => { kpis[s.status.code]++; if (s.online) kpis.online++; });
  const { results: msgs } = await db.prepare("SELECT * FROM broadcasts WHERE active = 1 ORDER BY id DESC LIMIT 50").all();
  return json({
    kpis, stores, serverTime: now, plans: PLANS, periods: PERIODS,
    broadcasts: msgs.map(b => ({ id: b.id, title: b.title, body: b.body, level: b.level, createdAt: b.created_at }))
  });
});

route("POST", /^master\/stores\/(emp_[a-f0-9]{16})\/plan$/, async ({ db, request, body, params }) => {
  await requireMaster(db, request, body);
  const plan = String(body.plan || "");
  const days = Number(body.days);
  if (!PLANS[plan]) fail(400, "invalid_plan");
  if (!PERIODS.includes(days)) fail(400, "invalid_period");
  const store = await db.prepare("SELECT * FROM stores WHERE id = ?").bind(params[0]).first();
  if (!store) fail(404, "not_found");
  const now = Date.now();
  const base = store.plan_expires_at && store.plan_expires_at > now ? store.plan_expires_at : now;
  const expires = base + days * DAY;
  await db.prepare("UPDATE stores SET plan = ?, plan_expires_at = ?, blocked = 0 WHERE id = ?").bind(plan, expires, store.id).run();
  await logEvent(db, store.id, "plano", `${PLANS[plan].name} +${days} dias`);
  const updated = await db.prepare("SELECT * FROM stores WHERE id = ?").bind(store.id).first();
  return json({ store: masterStore(updated) });
});

route("POST", /^master\/stores\/(emp_[a-f0-9]{16})\/block$/, async ({ db, request, body, params }) => {
  await requireMaster(db, request, body);
  const blocked = body.blocked ? 1 : 0;
  const res = await db.prepare("UPDATE stores SET blocked = ? WHERE id = ?").bind(blocked, params[0]).run();
  if (!res.meta.changes) fail(404, "not_found");
  if (blocked) await db.batch([
    db.prepare("DELETE FROM sessions WHERE store_id = ?").bind(params[0]),
    db.prepare("UPDATE stores SET cashier_open = 0 WHERE id = ?").bind(params[0])
  ]);
  await logEvent(db, params[0], blocked ? "desativado" : "reativado", null);
  const updated = await db.prepare("SELECT * FROM stores WHERE id = ?").bind(params[0]).first();
  return json({ store: masterStore(updated) });
});

route("POST", /^master\/stores\/(emp_[a-f0-9]{16})\/reset-password$/, async ({ db, request, body, params }) => {
  await requireMaster(db, request, body);
  const temp = tempPassword();
  const res = await db.prepare("UPDATE stores SET password_hash = ?, must_change_password = 1 WHERE id = ?").bind(await hashPassword(temp), params[0]).run();
  if (!res.meta.changes) fail(404, "not_found");
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE store_id = ?").bind(params[0]),
    db.prepare("UPDATE stores SET cashier_open = 0 WHERE id = ?").bind(params[0])
  ]);
  await logEvent(db, params[0], "senha", "Senha redefinida pela Área Master");
  return json({ tempPassword: temp });
});

route("POST", /^master\/broadcasts$/, async ({ db, request, body }) => {
  await requireMaster(db, request, body);
  const title = cleanText(body.title, 80) || "Aviso";
  const text = String(body.body ?? "").trim().slice(0, 1000);
  const level = ["info", "aviso", "urgente"].includes(body.level) ? body.level : "info";
  if (!text) fail(400, "message_required");
  const res = await db.prepare("INSERT INTO broadcasts (title, body, level, created_at) VALUES (?, ?, ?, ?)").bind(title, text, level, Date.now()).run();
  return json({ id: res.meta.last_row_id }, 201);
});

route("DELETE", /^master\/broadcasts\/(\d+)$/, async ({ db, request, body, params }) => {
  await requireMaster(db, request, body);
  await db.prepare("UPDATE broadcasts SET active = 0 WHERE id = ?").bind(Number(params[0])).run();
  return json({ ok: true });
});

// ---------- entrada ----------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  try {
    for (const r of routes) {
      const m = path.match(r.pattern);
      if (!m) continue;
      if (r.method !== request.method) continue;
      if (!env.DB && !/^manifest$/.test(path)) fail(503, "db_not_configured");
      const body = await readBody(request);
      const ip = request.headers.get("cf-connecting-ip") || "local";
      return await r.handler({ request, env, db: env.DB, url, body, ip, params: m.slice(1) });
    }
    return json({ error: "not_found" }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status);
    console.error(err);
    return json({ error: "server_error" }, 500);
  }
}
