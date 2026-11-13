import { getCompany, saveCompany, saveCompanyMeta, commitLocal, listOutbox, removeOutbox, countOutbox, findCompanyByEmail } from "./db.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (n) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const now = () => Date.now();
const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
const HIDE_MS = 24 * 60 * 60 * 1000;
const DEMO_PRODUCTS = [
  { id:"p1", name:"Café tradicional 500g", category:"Mercearia", code:"78910001", price:18.9, stock:24, emoji:"☕" },
  { id:"p2", name:"Arroz tipo 1 5kg", category:"Mercearia", code:"78910002", price:27.5, stock:18, emoji:"🍚" },
  { id:"p3", name:"Feijão carioca 1kg", category:"Mercearia", code:"78910003", price:8.99, stock:31, emoji:"🫘" },
  { id:"p4", name:"Refrigerante 2L", category:"Bebidas", code:"78910004", price:10.5, stock:16, emoji:"🥤" },
  { id:"p5", name:"Água mineral 500ml", category:"Bebidas", code:"78910005", price:2.5, stock:48, emoji:"💧" },
  { id:"p6", name:"Suco de uva 1L", category:"Bebidas", code:"78910006", price:12.9, stock:12, emoji:"🧃" },
  { id:"p7", name:"Detergente 500ml", category:"Limpeza", code:"78910007", price:2.79, stock:36, emoji:"🧴" },
  { id:"p8", name:"Sabão em pó 1kg", category:"Limpeza", code:"78910008", price:14.9, stock:9, emoji:"🫧" },
  { id:"p9", name:"Biscoito recheado", category:"Mercearia", code:"78910009", price:3.75, stock:20, emoji:"🍪" }
];
let currentCompany = null, cart = [], activeCategory = "Todos", authMode = "login", toastTimer;

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
// [NEXUS THEME] tema de caixa: laranja (padrão), amarelo ou escuro
// verde = padrão (branco com verde e detalhes amarelos); azul = branco com azul
const THEMES = { amarelo: "#f59e0b", verde: "#1f8a65", laranja: "#f97316", azul: "#1e40af" };
const DEFAULT_THEME = "amarelo";
// Tema da loja (escolhido pelo ADM e sincronizado) e alternância azul (por aparelho, botão do topo)
const baseTheme = () => {
  const t = currentCompany?.appearance || localStorage.getItem("nexus_base_theme") || DEFAULT_THEME;
  return THEMES[t] ? t : DEFAULT_THEME;
};
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  document.body.classList.add("theme-light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[theme]);
  $$("[data-theme-choice]").forEach(b => b.classList.toggle("active", b.dataset.themeChoice === baseTheme()));
  const toggle = $("#themeToggle");
  if (toggle) {
    toggle.querySelector(".tt-icon").textContent = theme === "azul" ? "🎨" : "🔵";
    toggle.querySelector(".tt-label").textContent = theme === "azul" ? "Tema padrão" : "Modo azul";
  }
}
function refreshTheme() {
  const base = baseTheme();
  localStorage.setItem("nexus_base_theme", base);
  const blue = localStorage.getItem("nexus_blue_mode") === "1";
  applyTheme(blue ? "azul" : (base === "azul" ? DEFAULT_THEME : base));
}
refreshTheme();
// Aparência: só dentro das Configurações ADM (trancadas por senha)
$$("[data-theme-choice]").forEach(b => b.addEventListener("click", async () => {
  if (!currentCompany) return;
  currentCompany.appearance = b.dataset.themeChoice;
  localStorage.setItem("nexus_blue_mode", b.dataset.themeChoice === "azul" ? "1" : "0");
  refreshTheme();
  await recordSetting("appearance");
  toast("Aparência da loja salva.");
}));
$("#themeToggle").addEventListener("click", () => {
  const isBlue = document.body.dataset.theme === "azul";
  localStorage.setItem("nexus_blue_mode", isBlue ? "0" : "1");
  refreshTheme();
});

function showModal(mode) {
  authMode = mode;
  $("#authModal").classList.remove("hidden");
  $("#authError").textContent = "";
  $("#companyName").classList.toggle("hidden", mode === "login");
  $("#companyLabel").classList.toggle("hidden", mode === "login");
  $("#companyName").required = mode !== "login"; // campo escondido não pode bloquear o "Entrar"
  $("#modalTitle").textContent = mode === "login" ? "Acesse sua loja." : "Crie sua loja.";
  $("#modalDescription").textContent = mode === "login" ? "Entre com os dados do seu estabelecimento." : "Sua demonstração fica pronta em instantes.";
  $("#authSubmit").textContent = mode === "login" ? "Entrar na minha loja →" : "Criar conta e começar →";
  $("#modalSwitch").innerHTML = mode === "login" ? 'Ainda não tem conta? <button id="switchAuthMode">Criar conta grátis</button>' : 'Já tem uma conta? <button id="switchAuthMode">Entrar</button>';
  $("#switchAuthMode").addEventListener("click", () => showModal(mode === "login" ? "register" : "login"));
}
function closeModal() { $("#authModal").classList.add("hidden"); }
// Clique fora da janela não fecha (para não perder o que foi digitado): balança e mostra onde fechar
function nudgeModal(backdrop) {
  const card = backdrop.querySelector(".modal-card");
  card?.classList.remove("nudge"); void card?.offsetWidth; card?.classList.add("nudge");
  const x = card?.querySelector(".modal-x");
  x?.classList.remove("pulse-x"); void x?.offsetWidth; x?.classList.add("pulse-x");
  toast(x ? "Para sair, clique no X no canto da janela." : "Conclua ou cancele para sair.");
}
$("#openLogin").addEventListener("click", () => showModal("login"));
["openTrial","heroTrial","howTrial"].forEach(id => $("#"+id).addEventListener("click", () => showModal("register")));
$$("[data-close-modal]").forEach(b => b.addEventListener("click", closeModal));
$("#authModal").addEventListener("click", (e) => { if (e.target.id === "authModal") nudgeModal(e.target); });

function makeCompanyId() { return "emp_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16); }
async function hashDemoPassword(password) {
  // Hash local apenas para reduzir exposição casual; não substitui autenticação segura no backend.
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
// [NEXUS CLOUD] Cadastro e login pela nuvem (D1), com modo local quando não há conexão.
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#authError"), btn = $("#authSubmit");
  err.textContent = "";
  const email = $("#emailInput").value.trim().toLowerCase();
  const password = $("#passwordInput").value;
  const passwordHash = await hashDemoPassword(password);
  btn.disabled = true;
  try {
    const result = authMode === "register"
      ? await registerFlow({ storeName: $("#companyName").value.trim(), email, password, passwordHash })
      : await loginFlow({ email, password, passwordHash });
    if (result.error) { err.textContent = result.error; return; }
    currentCompany = result.company;
    localStorage.setItem("nexus_current_company", currentCompany.empresa_id);
    $("#authForm").reset();
    closeModal(); enterApp();
    if (result.mustChangePassword) openPasswordModal();
    if (result.localOnly) toast("Sem conexão com a nuvem: usando o modo local deste aparelho.");
  } catch (ex) {
    console.error(ex);
    err.textContent = "Não foi possível salvar os dados. Verifique se o navegador permite armazenamento local.";
  } finally {
    btn.disabled = false;
  }
});

async function loadSession() {
  const id = localStorage.getItem("nexus_current_company");
  if (!id) return;
  const company = await getCompany(id);
  if (company) { currentCompany = company; enterApp(); if (company.server?.mustChangePassword && getToken()) openPasswordModal(); }
}
// Grava só os dados da loja. Produtos, vendas e configurações usam gravações pontuais (record*).
function persist() { return saveCompanyMeta(currentCompany); }
function enterApp() {
  $("#landingView").classList.add("hidden"); $("#appView").classList.remove("hidden");
  document.body.classList.add("in-app");
  $("#storeNameSide").textContent = currentCompany.storeName;
  applyBranding(currentCompany.storeName);            // [NEXUS CLOUD] app vira "PDV <loja>"
  refreshTheme();
  setConnection(false); renderPlanStatus(); renderBlocked();
  renderProducts(); renderInventory(); updateCart(); renderTrialBanner();
  showPanel("pos");
  startHeartbeat();
  refreshSyncBadge();
}
function exitApp() {
  stopHeartbeat();
  const token = getToken();
  if (token) api("auth/logout", { token }).catch(() => {});
  clearToken();
  localStorage.removeItem("nexus_current_company");
  currentCompany = null; cart = []; admUnlocked = false;
  applyBranding("");
  $("#broadcastArea").innerHTML = "";
  $("#blockedOverlay").classList.add("hidden");
  $("#passwordModal").classList.add("hidden");
  $("#appView").classList.add("hidden"); $("#landingView").classList.remove("hidden");
  document.body.classList.remove("in-app");
  $("#trialBanner").classList.add("hidden");
}
$("#logoutBtn").addEventListener("click", () => exitApp());

// Aviso do teste de 7 dias: conta os dias e volta a cada 24 h depois de fechado.
// No último dia (e depois de vencer) não dá para fechar: o botão vira "Conhecer os planos".
function renderTrialBanner() {
  const banner = $("#trialBanner"), text = banner.querySelector("span");
  const closeBtn = $("#dismissTrial"), plansBtn = $("#bannerPlans");
  if (!currentCompany) { banner.classList.add("hidden"); return; }
  const code = currentCompany.server?.status?.code;
  if (code === "ativo" || code === "desativado") { banner.classList.add("hidden"); return; }
  const remaining = currentCompany.trialEndsAt - now();
  const days = Math.max(0, Math.ceil(remaining / (24*60*60*1000)));
  const locked = code === "pendente" || days <= 1;
  closeBtn.classList.toggle("hidden", locked);
  plansBtn.classList.toggle("hidden", !locked);
  if (!locked) {
    const hiddenAt = Number(localStorage.getItem(`nexus_banner_hidden_${currentCompany.empresa_id}`) || 0);
    if (now() - hiddenAt < HIDE_MS) { banner.classList.add("hidden"); return; }
  }
  if (code === "pendente" || remaining <= 0) text.innerHTML = "⚠️ Seu teste grátis terminou. Escolha um plano para continuar usando o PDV.";
  else if (days <= 1) text.innerHTML = "⏳ <strong>Último dia</strong> do seu teste grátis!";
  else text.innerHTML = `⚠️ Teste grátis: restam <strong id="daysRemaining">${days}</strong> dias.`;
  banner.classList.remove("hidden");
}
$("#dismissTrial").addEventListener("click", () => {
  if (!currentCompany) return;
  localStorage.setItem(`nexus_banner_hidden_${currentCompany.empresa_id}`, String(now()));
  $("#trialBanner").classList.add("hidden");
});

function showPanel(panel) {
  ["pos","products","admin"].forEach(name => $("#"+name+"Panel").classList.toggle("hidden", name !== panel));
  $$("[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === panel));
  const today = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const titles = {pos:[today.toUpperCase(), currentCompany?.storeName || "Frente de caixa"],products:["ESTOQUE","Produtos e estoque"],admin:["CONFIGURAÇÕES","Painel administrativo"]};
  $("#pageEyebrow").textContent = titles[panel][0]; $("#pageTitle").textContent = titles[panel][1];
  if (panel !== "admin") admUnlocked = false;   // saiu do ADM: tranca de novo
  if (panel === "admin") { renderAdminGate(); if (admUnlocked) { loadSecuritySettings(); loadHardwareSettings(); } }
  if (panel === "pos") focusScanner(); // [NEXUS HW]
}
$$("[data-view]").forEach(b => b.addEventListener("click", () => showPanel(b.dataset.view)));

function renderProducts() {
  const term = ($("#productSearch")?.value || "").trim().toLowerCase();
  const favs = new Set(currentCompany.favorites || []);
  const products = sortedProducts().filter(p =>
    (activeCategory === "Todos" || (activeCategory === "Favoritos" ? favs.has(p.id) : p.category === activeCategory)) &&
    `${p.name} ${p.code}`.toLowerCase().includes(term));
  $("#productCount").textContent = `${products.length} ${products.length === 1 ? "produto" : "produtos"} · toque no card para adicionar`;
  $("#productsTitle").textContent = activeCategory === "Todos" ? "Todos os produtos" : activeCategory === "Favoritos" ? "♥ Favoritos" : activeCategory;
  renderCategories();
  $("#productGrid").innerHTML = products.map(p => {
    const stockClass = p.stock <= 0 ? "out" : p.stock < 10 ? "low" : "";
    const stockText = p.stock <= 0 ? "Sem estoque" : `${p.stock} em estoque`;
    return `<div class="product-card" data-card="${p.id}" role="button" tabindex="-1" aria-label="Adicionar ${escapeHTML(p.name)}">
      <button class="fav-btn ${favs.has(p.id) ? "on" : ""}" type="button" data-fav="${p.id}" aria-label="Favoritar">${favs.has(p.id) ? "♥" : "♡"}</button>
      <div class="product-media">${p.emoji || "📦"}</div>
      <div class="product-row"><b>${escapeHTML(p.name)}</b><strong class="product-price">${money(p.price)}</strong></div>
      <small class="product-code">${escapeHTML(p.category)}${p.code ? ` · ${escapeHTML(p.code)}` : ""}</small>
      <div class="product-foot"><span class="stock-badge ${stockClass}">${stockText}</span><span class="add-btn">+ Adicionar</span></div>
    </div>`;
  }).join("") || '<p class="empty-cart">Nenhum produto encontrado.</p>';
  $$("[data-card]").forEach(card => card.addEventListener("click", (e) => {
    if (e.target.closest("[data-fav]")) return;
    addToCart(card.dataset.card);
    card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
  }));
  $$("[data-fav]").forEach(b => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const set = new Set(currentCompany.favorites || []);
    set.has(b.dataset.fav) ? set.delete(b.dataset.fav) : set.add(b.dataset.fav);
    currentCompany.favorites = [...set];
    await recordSetting("favorites"); renderProducts();
  }));
}
function escapeHTML(str) { return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
$("#productSearch").addEventListener("input", renderProducts);
// Coluna de categorias (montada a partir dos produtos cadastrados)
const CATEGORY_ICONS = { Todos: "🏪", Favoritos: "♥", Mercearia: "🛒", Bebidas: "🥤", Limpeza: "🧽", Padaria: "🥖", Hortifruti: "🥬", Frios: "🧀", Açougue: "🥩", Higiene: "🧴", Bazar: "🧺", Tabacaria: "🚬" };
function renderCategories() {
  const counts = {};
  currentCompany.products.forEach(p => { counts[p.category || "Outros"] = (counts[p.category || "Outros"] || 0) + 1; });
  const favCount = (currentCompany.favorites || []).filter(id => currentCompany.products.some(p => p.id === id)).length;
  const cats = [["Todos", currentCompany.products.length], ["Favoritos", favCount], ...Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))];
  if (!cats.some(([c]) => c === activeCategory)) activeCategory = "Todos";
  $("#categoryList").innerHTML = cats.map(([c, n]) => `<button type="button" class="cat-item ${c === activeCategory ? "active" : ""}" data-cat="${escapeHTML(c)}">
      <span class="cat-ico">${CATEGORY_ICONS[c] || "🏷️"}</span><span class="cat-name">${escapeHTML(c)}</span><span class="cat-count">${n}</span></button>`).join("");
  $$("[data-cat]").forEach(b => b.addEventListener("click", () => {
    activeCategory = b.dataset.cat;
    $(".col-products")?.scrollTo({ top: 0 });
    renderProducts();
  }));
}
$("#productSearch").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const code = e.target.value.trim();
    const product = currentCompany.products.find(p => p.code === code);
    if (product) { addToCart(product.id); e.target.value = ""; renderProducts(); }
  }
});
function addToCart(id) {
  const p = currentCompany.products.find(x => x.id === id);
  if (!p) return;
  const line = cart.find(x => x.id === id);
  if (line) line.qty++; else cart.push({ id, qty: 1 });
  updateCart();
}
// Desconto da venda atual (R$ ou %) e forma de pagamento escolhida no carrinho
let cartDiscount = { type: "valor", value: 0 }, cartPay = "Dinheiro";
function cartTotals() {
  const items = cart.map(line => ({ ...line, product: currentCompany.products.find(p => p.id === line.id) })).filter(x => x.product);
  const subtotal = items.reduce((n, x) => n + x.product.price * x.qty, 0);
  let discount = cartDiscount.type === "pct" ? subtotal * cartDiscount.value / 100 : cartDiscount.value;
  discount = Math.min(subtotal, Math.max(0, Math.round(discount * 100) / 100));
  return { items, subtotal, discount, total: Math.round((subtotal - discount) * 100) / 100 };
}
function updateCart() {
  if (!currentCompany) return;
  const { items, subtotal, discount, total } = cartTotals();
  const count = items.reduce((n,x) => n+x.qty,0);
  $("#cartCount").textContent = `${count} ${count === 1 ? "item" : "itens"}`;
  $("#subtotalValue").textContent = money(subtotal);
  $("#discountValue").textContent = discount > 0 ? `- ${money(discount)}` : money(0);
  $("#discountBtn").textContent = discount > 0 ? (cartDiscount.type === "pct" ? `Desconto (${cartDiscount.value}%) ✎` : "Desconto ✎") : "＋ Desconto";
  $("#totalValue").textContent = money(total);
  $("#checkoutBtn").disabled = !items.length;
  $("#reprintBtn").disabled = !currentCompany.sales?.length; // [NEXUS HW]
  $$("#payChips [data-pay]").forEach(b => b.classList.toggle("active", b.dataset.pay === cartPay));
  $("#cartItems").innerHTML = items.length ? items.map(x => `<div class="cart-item">
      <span class="ci-thumb">${x.product.emoji || "📦"}</span>
      <div class="cart-item-info"><b>${escapeHTML(x.product.name)}</b><small>${money(x.product.price)} un.</small><strong class="ci-total">${money(x.product.price*x.qty)}</strong></div>
      <div class="qty-control"><div class="qrow"><button data-qty="${x.id}" data-delta="-1" aria-label="Diminuir">−</button><span>${x.qty}</span><button data-qty="${x.id}" data-delta="1" aria-label="Aumentar">+</button></div><button class="ci-remove" data-remove="${x.id}" type="button">Remover</button></div>
    </div>`).join("") : '<div class="empty-cart">Seu carrinho está vazio.<br><small>Bipe ou toque em um produto.</small></div>';
  $$("[data-qty]").forEach(b => b.addEventListener("click", async () => {
    if (Number(b.dataset.delta) < 0 && !await authorize("removeItem")) return;
    const line = cart.find(x => x.id === b.dataset.qty); if (!line) return;
    line.qty += Number(b.dataset.delta);
    if (line.qty <= 0) cart = cart.filter(x => x !== line);
    if (!cart.length) cartDiscount = { type: "valor", value: 0 };
    updateCart();
  }));
  $$("[data-remove]").forEach(b => b.addEventListener("click", async () => {
    if (!await authorize("removeItem")) return;
    cart = cart.filter(x => x.id !== b.dataset.remove);
    if (!cart.length) cartDiscount = { type: "valor", value: 0 };
    updateCart();
  }));
}
$$("#payChips [data-pay]").forEach(b => b.addEventListener("click", () => { cartPay = b.dataset.pay; updateCart(); }));
$("#discountBtn").addEventListener("click", async () => {
  if (!cart.length) { toast("Adicione produtos antes de dar desconto."); return; }
  if (!await authorize("discount")) return;
  const raw = prompt("Desconto da venda:\n• em reais: 5,00\n• em porcentagem: 10%\nDeixe vazio para remover.", cartDiscount.value ? (cartDiscount.type === "pct" ? `${cartDiscount.value}%` : String(cartDiscount.value).replace(".", ",")) : "");
  if (raw === null) return;
  const text = raw.trim();
  if (!text) { cartDiscount = { type: "valor", value: 0 }; updateCart(); return; }
  const isPct = text.endsWith("%");
  const value = Number(text.replace("%", "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || (isPct && value > 100)) { toast("Desconto inválido."); return; }
  cartDiscount = { type: isPct ? "pct" : "valor", value };
  updateCart();
});
$("#clearCart").addEventListener("click", async () => { if (!cart.length || !await authorize("removeItem")) return; cart = []; cartDiscount = { type: "valor", value: 0 }; updateCart(); });
// [NEXUS HW] "Finalizar venda" abre o modal de pagamento/troco/impressão (ver finalizeSale no módulo de periféricos).
$("#checkoutBtn").addEventListener("click", openCheckout);

const sortedProducts = () => [...currentCompany.products].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
const marginOf = (p) => (p.cost > 0 && p.price > 0) ? Math.round((p.price - p.cost) / p.price * 100) : null;
function renderInventory() {
  $("#inventoryTable").innerHTML = sortedProducts().map(p => {
    const m = marginOf(p);
    return `<tr><td><strong>${p.emoji || "📦"} ${escapeHTML(p.name)}</strong></td><td>${escapeHTML(p.category)}</td><td>${escapeHTML(p.code)}</td>
      <td>${p.cost > 0 ? money(p.cost) : "—"}</td><td><b>${money(p.price)}</b></td><td class="${m !== null && m < 15 ? "stock-low" : ""}">${m === null ? "—" : m + "%"}</td>
      <td class="${p.stock < 10 ? "stock-low" : ""}">${p.stock} un.</td><td><button class="table-action" data-edit="${p.id}">Editar</button> <button class="table-action" data-delete="${p.id}">Excluir</button></td></tr>`;
  }).join("") || '<tr><td colspan="8" class="empty-cart">Nenhum produto cadastrado ainda.</td></tr>';
  $$("[data-edit]").forEach(b => b.addEventListener("click", () => editProduct(b.dataset.edit)));
  $$("[data-delete]").forEach(b => b.addEventListener("click", () => deleteProduct(b.dataset.delete)));
}
async function editProduct(id) {
  if (!await authorize("editProduct")) return;
  const p = currentCompany.products.find(x => x.id === id);
  if (p) openProductModal("", false, p, { skipAuth: true });
}
async function deleteProduct(id) {
  if (!await authorize("deleteProduct")) return;
  if (!confirm("Deseja realmente excluir este produto?")) return;
  currentCompany.products = currentCompany.products.filter(p => p.id !== id);
  cart = cart.filter(x => x.id !== id);
  await recordProductDelete(id); renderInventory(); renderProducts(); updateCart(); toast("Produto excluído.");
}
$("#addProductBtn").addEventListener("click", () => openProductModal("")); // [NEXUS HW] modal no lugar dos prompts



// ==========================================================================
// [NEXUS HW] Periféricos de balcão: leitor de código de barras USB e impressora térmica
// ==========================================================================
const HW_DEFAULTS = { paperWidth: "80", storeName: "", document: "", contact: "", footer: "Obrigado pela preferência!\nNão é documento fiscal." };
function getHardware() {
  return { ...HW_DEFAULTS, storeName: currentCompany?.storeName || "", ...(currentCompany?.hardware || {}) };
}
const isModalOpen = () => $$(".modal-backdrop, .master-view, .blocked-overlay").some(m => !m.classList.contains("hidden"));
const isPosVisible = () => Boolean(currentCompany) && !$("#appView").classList.contains("hidden") && !$("#posPanel").classList.contains("hidden");
const isTypingTarget = (el) => Boolean(el?.matches?.("input, textarea, select, [contenteditable='true']"));
function parseMoney(value) {
  let s = String(value ?? "").trim().replace(/[R$\s]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// ---------- Som de "bip" (Web Audio API, sem arquivos externos) ----------
let audioCtx;
function beep(ok = true) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const tones = ok ? [[1800, 0, 0.07]] : [[320, 0, 0.12], [240, 0.15, 0.16]];
    tones.forEach(([freq, start, dur]) => {
      const t = audioCtx.currentTime + start;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = ok ? "sine" : "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(ok ? 0.12 : 0.05, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
    });
  } catch { /* sem áudio disponível: segue sem som */ }
}

// ---------- Leitor de código de barras (HID / teclado) ----------
const scannerInput = $("#scannerInput");
let scannerFlashTimer, pendingScanCode = "";
function setScannerStatus(state, text) {
  const el = $("#scannerStatus");
  el.className = `scanner-status ${state}`;
  el.querySelector("span").textContent = text;
}
function restoreScannerStatus() {
  if (scannerFlashTimer) return; // deixa o feedback de leitura terminar
  if (document.activeElement === scannerInput) setScannerStatus("ready", "Leitor USB pronto");
  else setScannerStatus("paused", "Leitor pausado · tecle F2");
}
function flashScanner(ok, text) {
  clearTimeout(scannerFlashTimer);
  const bar = $("#scannerBar");
  bar.classList.remove("flash-ok", "flash-err");
  bar.classList.add(ok ? "flash-ok" : "flash-err");
  setScannerStatus(ok ? "ready" : "error", text);
  scannerFlashTimer = setTimeout(() => {
    scannerFlashTimer = null;
    bar.classList.remove("flash-ok", "flash-err");
    restoreScannerStatus();
  }, 1400);
}
function focusScanner() {
  if (!isPosVisible() || isModalOpen()) return;
  scannerInput.focus({ preventScroll: true });
  restoreScannerStatus();
}
function showScanAlert(code) {
  pendingScanCode = code;
  $("#scannerAlertCode").textContent = code;
  $("#scannerAlert").classList.remove("hidden");
}
function hideScanAlert() {
  pendingScanCode = "";
  $("#scannerAlert").classList.add("hidden");
}
function handleScan(raw) {
  const code = String(raw ?? "").trim();
  scannerInput.value = "";
  if (!code || !currentCompany) return;
  const product = currentCompany.products.find(p => String(p.code || "").trim() === code);
  if (isPosVisible() && !isModalOpen()) scannerInput.focus({ preventScroll: true });
  if (product) {
    addToCart(product.id);
    beep(true);
    hideScanAlert();
    flashScanner(true, `✓ ${product.name}`);
  } else {
    beep(false);
    showScanAlert(code);
    flashScanner(false, "Código não encontrado");
  }
}
scannerInput.addEventListener("keydown", (e) => {
  // Leitores enviam Enter (alguns, Tab) ao final do código
  if ((e.key === "Enter" || e.key === "Tab") && scannerInput.value.trim()) {
    e.preventDefault();
    handleScan(scannerInput.value);
  }
});
scannerInput.addEventListener("focus", restoreScannerStatus);
scannerInput.addEventListener("blur", () => setTimeout(restoreScannerStatus, 0));
$("#scannerFocusBtn").addEventListener("click", focusScanner);
$("#scannerAlertClose").addEventListener("click", () => { hideScanAlert(); focusScanner(); });
$("#scannerQuickAdd").addEventListener("click", () => openProductModal(pendingScanCode, true));
// Clicou em produto, categoria, carrinho etc.: o foco volta sozinho para o leitor
$("#posPanel").addEventListener("click", (e) => {
  if (!isTypingTarget(e.target) && !e.target.closest("label")) setTimeout(focusScanner, 0);
});

// Atalhos globais + captura de bipagem mesmo com o foco fora de qualquer campo
let wedgeBuffer = "", wedgeLast = 0;
document.addEventListener("keydown", (e) => {
  if (!currentCompany || $("#appView").classList.contains("hidden")) return;
  if (e.key === "F2") {
    e.preventDefault();
    if (isModalOpen()) return;
    if (!isPosVisible()) showPanel("pos");
    focusScanner();
    return;
  }
  if (e.key === "F4" && isPosVisible() && !isModalOpen()) { e.preventDefault(); openCheckout(); return; }
  if (e.key === "Escape") {
    if (!$("#checkoutModal").classList.contains("hidden")) closeCheckout();
    else if (!$("#productModal").classList.contains("hidden")) closeProductModal();
    return;
  }
  if (!isPosVisible() || isModalOpen() || isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = performance.now();
  if (t - wedgeLast > 80) wedgeBuffer = ""; // digitação humana é mais lenta que o leitor
  wedgeLast = t;
  if (e.key === "Enter") {
    if (wedgeBuffer.length >= 3) { e.preventDefault(); handleScan(wedgeBuffer); }
    wedgeBuffer = "";
  } else if (e.key.length === 1) {
    wedgeBuffer += e.key;
  }
});

// ---------- Cadastro rápido de produto (sem travar o caixa) ----------
let productModalFromScanner = false;
const NEW_CATEGORY = "__nova__";
const cleanCategory = (v) => String(v || "").trim().replace(/\s+/g, " ").slice(0, 40).replace(/^./, c => c.toUpperCase());
const BASE_CATEGORIES = ["Mercearia", "Bebidas", "Limpeza"];
let editingProductId = null;
function fillCategorySelect(selected) {
  const cats = [...new Set([...BASE_CATEGORIES, ...currentCompany.products.map(p => p.category).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("#pfCategory").innerHTML = cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("") + `<option value="${NEW_CATEGORY}">➕ Nova categoria…</option>`;
  $("#pfCategory").value = selected && cats.includes(selected) ? selected : (activeCategory !== "Todos" && activeCategory !== "Favoritos" && cats.includes(activeCategory) ? activeCategory : cats[0]);
  $("#pfNewCatWrap").classList.add("hidden");
}
function updateMarginPreview() {
  const price = parseMoney($("#pfPrice").value), cost = parseMoney($("#pfCost").value);
  const el = $("#pfMargin");
  if (Number.isFinite(price) && price > 0 && Number.isFinite(cost) && cost > 0) {
    const m = Math.round((price - cost) / price * 100);
    el.textContent = `${m}% · lucro ${money(price - cost)}`;
    el.style.color = m < 0 ? "var(--danger)" : m < 15 ? "#b45309" : "var(--good)";
  } else { el.textContent = "—"; el.style.color = ""; }
}
async function openProductModal(code = "", fromScanner = false, product = null, { skipAuth = false } = {}) {
  if (!skipAuth && !await authorize("addProduct")) { focusScanner(); return; }
  productModalFromScanner = fromScanner;
  editingProductId = product?.id || null;
  $("#productForm").reset();
  fillCategorySelect(product?.category);
  $("#pfCode").value = product ? (product.code || "") : code;
  $("#pfName").value = product?.name || "";
  $("#pfPrice").value = product ? String(product.price).replace(".", ",") : "";
  $("#pfCost").value = product?.cost > 0 ? String(product.cost).replace(".", ",") : "";
  $("#pfStock").value = product ? product.stock : "0";
  $("#pfStockLabel").textContent = product ? "Estoque atual" : "Estoque inicial";
  $("#productModalTitle").textContent = product ? "Editar produto" : "Novo produto";
  $("#productModalEyebrow").textContent = product ? "EDIÇÃO DE PRODUTO" : "CADASTRO DE PRODUTO";
  $("#productFormSubmit").textContent = product ? "Salvar alterações →" : "Cadastrar produto →";
  $("#productFormError").textContent = "";
  updateMarginPreview();
  $("#productModal").classList.remove("hidden");
  setTimeout(() => (product ? $("#pfName") : code ? $("#pfName") : $("#pfCode")).focus(), 30);
}
$("#pfCategory").addEventListener("change", () => {
  const isNew = $("#pfCategory").value === NEW_CATEGORY;
  $("#pfNewCatWrap").classList.toggle("hidden", !isNew);
  if (isNew) setTimeout(() => $("#pfNewCategory").focus(), 20);
});
$("#pfPrice").addEventListener("input", updateMarginPreview);
$("#pfCost").addEventListener("input", updateMarginPreview);
function closeProductModal() {
  $("#productModal").classList.add("hidden");
  focusScanner();
}
$$("[data-close-product]").forEach(b => b.addEventListener("click", closeProductModal));
$("#productModal").addEventListener("click", (e) => { if (e.target.id === "productModal") nudgeModal(e.target); });
$("#pfCode").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#pfName").focus(); } });
$("#productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#productFormError");
  const code = $("#pfCode").value.trim(), name = $("#pfName").value.trim();
  const price = parseMoney($("#pfPrice").value);
  const costText = $("#pfCost").value.trim();
  const cost = costText ? parseMoney(costText) : null;
  const stockText = String($("#pfStock").value).trim();
  const stock = Number(stockText || 0);
  let category = $("#pfCategory").value;
  if (category === NEW_CATEGORY) category = cleanCategory($("#pfNewCategory").value);
  if (!name) { err.textContent = "Informe o nome do produto."; $("#pfName").focus(); return; }
  if (!category) { err.textContent = "Escolha uma categoria ou digite a nova."; return; }
  if (!Number.isFinite(price) || price <= 0) { err.textContent = "Informe o preço de venda (ex.: 9,90)."; $("#pfPrice").focus(); return; }
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) { err.textContent = "Preço de custo inválido. Deixe em branco se não quiser informar."; return; }
  if (!Number.isInteger(stock) || stock < 0) { err.textContent = "O estoque deve ser um número inteiro."; return; }
  if (code && currentCompany.products.some(p => p.id !== editingProductId && String(p.code || "").trim() === code)) { err.textContent = "Já existe outro produto com este código."; return; }
  const emojiFor = (cat) => CATEGORY_ICONS[cat] || "📦";
  let product, stockChanged = true;
  if (editingProductId) {
    product = currentCompany.products.find(p => p.id === editingProductId);
    if (!product) { err.textContent = "Este produto foi excluído."; return; }
    stockChanged = stockText !== "" && stock !== product.stock;   // só manda estoque se mudou de verdade
    Object.assign(product, { name, category, code, price, cost: cost ?? null, ...(stockChanged ? { stock } : {}) });
    if (!product.emoji || product.emoji === "📦") product.emoji = emojiFor(category);
  } else {
    product = { id: crypto.randomUUID(), name, category, code, price, cost: cost ?? null, stock, emoji: emojiFor(category) };
    currentCompany.products.push(product);
  }
  try { await recordProduct(product, { stockChanged }); } catch (ex) { console.error(ex); err.textContent = "Não foi possível salvar o produto."; return; }
  renderInventory(); renderProducts();
  $("#productModal").classList.add("hidden");
  if (editingProductId) {
    toast("Produto atualizado.");
  } else if (productModalFromScanner) {
    hideScanAlert(); addToCart(product.id); beep(true);
    toast(`${name} cadastrado e adicionado à venda.`);
  } else {
    toast("Produto cadastrado.");
  }
  focusScanner();
});

// ---------- Finalização de venda: pagamento, troco e impressão ----------
const selectedPay = () => $("input[name=payMethod]:checked")?.value || "Dinheiro";
const cartTotal = () => cartTotals().total;
function updateChange() {
  const isCash = selectedPay() === "Dinheiro";
  $("#cashBox").classList.toggle("hidden", !isCash);
  const total = cartTotal(), received = parseMoney($("#cashReceived").value);
  const hasValue = isCash && Number.isFinite(received);
  $("#changeValue").textContent = money(hasValue ? Math.max(0, received - total) : 0);
  $("#changeValue").style.color = hasValue && received < total ? "var(--danger)" : "";
}
function openCheckout() {
  if (!cart.length) return;
  $("#checkoutTotal").textContent = money(cartTotal());
  $("#cashReceived").value = "";
  $("#checkoutError").textContent = "";
  $("#printAfterSale").checked = true; // marcada por padrão
  const payInput = $(`input[name=payMethod][value="${cartPay}"]`) || $('input[name=payMethod][value="Dinheiro"]');
  payInput.checked = true;
  updateChange();
  $("#checkoutModal").classList.remove("hidden");
  setTimeout(() => $("#cashReceived").focus(), 30);
}
function closeCheckout() {
  $("#checkoutModal").classList.add("hidden");
  focusScanner();
}
$$("[data-close-checkout]").forEach(b => b.addEventListener("click", closeCheckout));
$("#checkoutModal").addEventListener("click", (e) => { if (e.target.id === "checkoutModal") nudgeModal(e.target); });
$$("input[name=payMethod]").forEach(r => r.addEventListener("change", () => {
  updateChange();
  if (selectedPay() === "Dinheiro") $("#cashReceived").focus();
}));
$("#cashReceived").addEventListener("input", updateChange);
$("#checkoutModal").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); finalizeSale(); }
});
$("#confirmSaleBtn").addEventListener("click", finalizeSale);

let finalizing = false;
async function finalizeSale() {
  if (finalizing || !cart.length) return;
  const errorEl = $("#checkoutError");
  const items = cart.map(line => {
    const p = currentCompany.products.find(x => x.id === line.id);
    return { productId: p.id, name: p.name, price: p.price, qty: line.qty };
  });
  for (const line of items) {
    const p = currentCompany.products.find(x => x.id === line.productId);
    if (p.stock < line.qty) { errorEl.textContent = `Estoque insuficiente: ${p.name} (${p.stock} un.)`; return; }
  }
  const { subtotal, discount, total } = cartTotals();
  const payment = selectedPay();
  let received = total, change = 0;
  if (payment === "Dinheiro" && $("#cashReceived").value.trim()) {
    const r = parseMoney($("#cashReceived").value);
    if (!Number.isFinite(r) || r < total - 0.005) { errorEl.textContent = "O valor recebido é menor que o total."; return; }
    received = r;
    change = Math.round((r - total) * 100) / 100;
  }
  finalizing = true;
  try {
    items.forEach(line => { currentCompany.products.find(p => p.id === line.productId).stock -= line.qty; });
    currentCompany.saleSeq = (currentCompany.saleSeq ?? currentCompany.sales.length) + 1;
    const sale = { id: crypto.randomUUID(), number: currentCompany.saleSeq, createdAt: now(), items, subtotal, discount, total, payment, received, change };
    currentCompany.sales.push(sale);
    // grava só a venda nova e os produtos que tiveram estoque baixado
    const touched = [...new Set(items.map(l => l.productId))].map(id => currentCompany.products.find(p => p.id === id)).filter(Boolean);
    await recordSale(sale, touched);
    cart = []; cartDiscount = { type: "valor", value: 0 }; cartPay = "Dinheiro";
    renderProducts(); renderInventory(); updateCart();
    $("#checkoutModal").classList.add("hidden");
    toast(`Venda #${String(sale.number).padStart(6, "0")} de ${money(total)} registrada!${change > 0 ? ` Troco: ${money(change)}` : ""}`);
    if ($("#printAfterSale").checked) printReceipt(sale);
    else focusScanner();
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Não foi possível registrar a venda. Tente novamente.";
  } finally {
    finalizing = false;
  }
}

// ---------- Recibo térmico (comprovante não fiscal) ----------
const fmtDateTime = (ts) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(ts);
function receiptHTML(sale, cfg) {
  const e = escapeHTML;
  const width = cfg.paperWidth === "58" ? "w58" : "w80";
  const number = sale.test ? "TESTE" : sale.number ? String(sale.number).padStart(6, "0") : String(sale.id).slice(0, 8).toUpperCase();
  const count = sale.items.reduce((n, it) => n + it.qty, 0);
  const items = sale.items.map(it => `
    <div class="r-item"><div class="r-item-name">${it.qty} x ${e(it.name)}</div>
    <div class="r-row r-sub"><span>${money(it.price)} un.</span><span>${money(it.price * it.qty)}</span></div></div>`).join("");
  const cash = sale.payment === "Dinheiro" && sale.change > 0
    ? `<div class="r-row"><span>Recebido</span><span>${money(sale.received)}</span></div>
       <div class="r-row r-bold"><span>Troco</span><span>${money(sale.change)}</span></div>` : "";
  return `<div class="receipt-paper ${width}">
    <div class="r-center r-bold r-xl">${e(cfg.storeName || "Minha Loja")}</div>
    ${cfg.document ? `<div class="r-center">CNPJ/CPF: ${e(cfg.document)}</div>` : ""}
    ${cfg.contact ? `<div class="r-center r-pre">${e(cfg.contact)}</div>` : ""}
    <div class="r-sep"></div>
    <div class="r-center r-bold">COMPROVANTE DE VENDA</div>
    ${sale.test ? `<div class="r-center r-bold">*** CUPOM DE TESTE ***</div>` : ""}
    <div class="r-row"><span>Pedido</span><span>#${number}</span></div>
    <div class="r-row"><span>Data</span><span>${fmtDateTime(sale.createdAt)}</span></div>
    <div class="r-sep"></div>
    ${items}
    <div class="r-sep"></div>
    <div class="r-row r-small"><span>Qtd. itens</span><span>${count}</span></div>
    ${sale.discount > 0 ? `<div class="r-row"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div><div class="r-row"><span>Desconto</span><span>- ${money(sale.discount)}</span></div>` : ""}
    <div class="r-row r-total"><span>TOTAL</span><span>${money(sale.total)}</span></div>
    <div class="r-row"><span>Pagamento</span><span>${e(sale.payment || "Não informado")}</span></div>
    ${cash}
    <div class="r-sep"></div>
    ${cfg.footer ? `<div class="r-center r-pre">${e(cfg.footer)}</div>` : ""}
  </div>`;
}
let printPageStyle;
function printReceipt(sale, cfg = getHardware()) {
  const box = $("#receiptPrint");
  box.innerHTML = receiptHTML(sale, cfg);
  // Mede o cupom para a página ter a altura exata (sem papel em branco no final)
  box.classList.add("measuring");
  const heightMm = Math.ceil(box.firstElementChild.getBoundingClientRect().height * 25.4 / 96) + 4;
  box.classList.remove("measuring");
  printPageStyle ||= document.head.appendChild(document.createElement("style"));
  printPageStyle.textContent = `@page{size:${cfg.paperWidth === "58" ? 58 : 80}mm ${heightMm}mm;margin:0}`;
  setTimeout(() => window.print(), 60);
}
window.addEventListener("afterprint", () => setTimeout(focusScanner, 50));
$("#reprintBtn").addEventListener("click", async () => {
  if (!await authorize("reprint")) return;
  const last = currentCompany?.sales?.at(-1);
  if (!last) { toast("Nenhuma venda registrada ainda."); return; }
  printReceipt(last);
});

// ---------- Configuração de Hardware (PDV) ----------
const testSale = () => ({
  id: "teste", test: true, createdAt: now(), payment: "Dinheiro", total: 24.3, received: 30, change: 5.7,
  items: [{ name: "Produto de teste A", price: 9.9, qty: 2 }, { name: "Produto de teste B com nome longo", price: 4.5, qty: 1 }]
});
function readHardwareForm() {
  return {
    paperWidth: $("input[name=hwPaper]:checked")?.value || "80",
    storeName: $("#hwStoreName").value.trim(),
    document: $("#hwDocument").value.trim(),
    contact: $("#hwContact").value.trim(),
    footer: $("#hwFooter").value.trim()
  };
}
function renderHwPreview() { $("#hwPreview").innerHTML = receiptHTML(testSale(), readHardwareForm()); }
function loadHardwareSettings() {
  const hw = getHardware();
  $$("input[name=hwPaper]").forEach(r => { r.checked = r.value === hw.paperWidth; });
  $("#hwStoreName").value = hw.storeName;
  $("#hwDocument").value = hw.document;
  $("#hwContact").value = hw.contact;
  $("#hwFooter").value = hw.footer;
  $("#hardwareStatus").textContent = "";
  renderHwPreview();
}
$$(".hw-form input, .hw-form textarea").forEach(el => el.addEventListener("input", renderHwPreview));
$$("input[name=hwPaper]").forEach(r => r.addEventListener("change", renderHwPreview));
$("#saveHardwareBtn").addEventListener("click", async () => {
  currentCompany.hardware = readHardwareForm();
  try {
    await recordSetting("hardware");
    $("#hardwareStatus").textContent = "Configuração de hardware salva.";
    toast("Configuração de hardware salva.");
  } catch (err) {
    console.error(err);
    $("#hardwareStatus").textContent = "Não foi possível salvar.";
  }
});
$("#testPrintBtn").addEventListener("click", () => printReceipt(testSale(), readHardwareForm()));
// [/NEXUS HW]

// ==========================================================================
// [NEXUS ADM] Senhas e permissões
// O dono escolhe, para cada ação, se o atendente faz livre, com a senha do
// atendente/supervisor, ou se só o ADM pode. Senhas guardadas com PBKDF2.
// ==========================================================================
const PERMISSIONS = [
  { key: "deleteProduct", label: "Excluir produto", hint: "Na tela Produtos e estoque", def: "admin" },
  { key: "editProduct", label: "Alterar preço ou estoque", hint: "Na tela Produtos e estoque", def: "admin" },
  { key: "addProduct", label: "Cadastrar produto novo", hint: "Inclui o cadastro rápido pelo leitor", def: "livre" },
  { key: "discount", label: "Dar desconto na venda", hint: "Em R$ ou %", def: "supervisor" },
  { key: "removeItem", label: "Tirar item ou limpar a venda", hint: "Botões −, Remover e Limpar do carrinho", def: "livre" },
  { key: "reprint", label: "Reimprimir recibo", hint: "Botão Reimprimir último recibo", def: "livre" }
];
const LEVELS = { livre: "✅ Livre (sem senha)", supervisor: "🟡 Senha do atendente", admin: "🔴 Só senha do ADM" };

async function hashSecret(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
}
async function verifySecret(password, stored) {
  if (!stored) return false;
  if (!stored.startsWith("pbkdf2$")) return (await hashDemoPassword(password)) === stored; // senha mestre antiga
  const [, iter, saltB64, hashB64] = stored.split("$");
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: Number(iter) }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits))) === hashB64;
}
function sec() {
  const s = (currentCompany.security ||= {});
  if (s.enabled && s.passwordHash && !s.adminHash) s.adminHash = s.passwordHash; // migra a "senha mestre" antiga
  s.permissions ||= {};
  return s;
}
const permLevel = (key) => sec().permissions[key] || PERMISSIONS.find(p => p.key === key)?.def || "livre";

// Janela de senha (no lugar do prompt, que mostrava a senha em texto aberto)
let permResolve = null;
function askPassword({ title, desc, label = "Senha", hashes = [], noPassword = false }) {
  return new Promise((resolve) => {
    permResolve = (ok) => { permResolve = null; $("#permModal").classList.add("hidden"); resolve(ok); };
    $("#permTitle").textContent = title;
    $("#permDesc").textContent = desc;
    $("#permLabel").textContent = label;
    $("#permError").textContent = "";
    $("#permPass").value = "";
    $("#permFieldWrap").classList.toggle("hidden", noPassword);
    $("#permSubmit").textContent = noPassword ? "Ir para Configurações ADM →" : "Autorizar →";
    $("#permForm").dataset.mode = noPassword ? "setup" : "check";
    $("#permForm")._hashes = hashes;
    $("#permModal").classList.remove("hidden");
    setTimeout(() => (noPassword ? $("#permSubmit") : $("#permPass")).focus(), 30);
  });
}
$("#permForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!permResolve) return;
  if (e.target.dataset.mode === "setup") { permResolve(false); showPanel("admin"); return; }
  const pass = $("#permPass").value;
  for (const h of e.target._hashes) if (await verifySecret(pass, h)) { permResolve(true); return; }
  $("#permError").textContent = "Senha incorreta.";
  $("#permPass").select();
});
const cancelPerm = () => { if (permResolve) { permResolve(false); focusScanner(); } };
$$("[data-close-perm]").forEach(b => b.addEventListener("click", cancelPerm));
$("#permModal").addEventListener("click", (e) => { if (e.target.id === "permModal") nudgeModal(e.target); });

async function authorize(key) {
  const level = permLevel(key);
  if (level === "livre") return true;
  const s = sec();
  const perm = PERMISSIONS.find(p => p.key === key);
  if (!s.adminHash) {
    await askPassword({ title: "Crie a senha do ADM", desc: `"${perm.label}" precisa de senha, mas a senha do administrador ainda não foi criada.`, noPassword: true });
    return false;
  }
  const useSup = level === "supervisor" && s.supervisorHash;
  return askPassword({
    title: perm.label,
    desc: useSup ? "Digite a senha do atendente/supervisor ou a do ADM." : "Esta ação precisa da senha do ADM.",
    label: useSup ? "Senha do atendente ou do ADM" : "Senha do ADM",
    hashes: useSup ? [s.supervisorHash, s.adminHash] : [s.adminHash]
  });
}

// ---------- Área do ADM trancada ----------
let admUnlocked = false;
function renderAdminGate() {
  const hasAdmin = Boolean(sec().adminHash);
  $("#adminLock").classList.toggle("hidden", admUnlocked);
  $("#adminContent").classList.toggle("hidden", !admUnlocked);
  if (admUnlocked) return;
  $("#admLockForm").reset();
  $("#admLockError").textContent = "";
  $("#admOwnerWrap").classList.toggle("hidden", hasAdmin);
  $("#admConfirmWrap").classList.toggle("hidden", hasAdmin);
  $("#admLockTitle").textContent = hasAdmin ? "Área do administrador" : "Crie a senha do ADM";
  $("#admLockDesc").textContent = hasAdmin
    ? "Digite a senha do ADM para ver e mudar as configurações da loja."
    : "Primeiro acesso: confirme a senha da sua conta e crie a senha do administrador. Só quem souber essa senha entra aqui.";
  $("#admPassLabel").textContent = hasAdmin ? "Senha do ADM" : "Nova senha do ADM (mínimo 4)";
  $("#admLockSubmit").textContent = hasAdmin ? "Entrar no ADM →" : "Criar senha e entrar →";
  setTimeout(() => (hasAdmin ? $("#admPass") : $("#admOwnerPass")).focus(), 30);
}
$("#admLockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#admLockError"), s = sec();
  const pass = $("#admPass").value;
  if (s.adminHash) {
    if (!await verifySecret(pass, s.adminHash)) { err.textContent = "Senha do ADM incorreta."; $("#admPass").select(); return; }
  } else {
    if ((await hashDemoPassword($("#admOwnerPass").value)) !== currentCompany.passwordHash) { err.textContent = "A senha da conta não confere."; return; }
    if (pass.length < 4) { err.textContent = "A senha do ADM precisa ter pelo menos 4 caracteres."; return; }
    if (pass !== $("#admPass2").value) { err.textContent = "As senhas não são iguais."; return; }
    s.adminHash = await hashSecret(pass);
    delete s.enabled; delete s.passwordHash;
    await recordSetting("security");
    toast("Senha do ADM criada.");
  }
  admUnlocked = true;
  renderAdminGate(); loadSecuritySettings(); loadHardwareSettings();
});
$("#admLockNow").addEventListener("click", () => { admUnlocked = false; renderAdminGate(); toast("Configurações ADM trancadas."); });

function loadSecuritySettings() {
  const s = sec();
  $("#permTable").innerHTML = PERMISSIONS.map(p => {
    const level = permLevel(p.key);
    return `<div class="perm-row"><div><b>${p.label}</b><small>${p.hint}</small></div>
      <select data-perm="${p.key}" data-level="${level}" aria-label="${p.label}">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${k === level ? "selected" : ""}>${v}</option>`).join("")}</select></div>`;
  }).join("");
  $$("[data-perm]").forEach(sel => sel.addEventListener("change", async () => {
    sec().permissions[sel.dataset.perm] = sel.value;
    sel.dataset.level = sel.value;
    await recordSetting("security");
    $("#securityStatus").textContent = "Permissão salva.";
  }));
  $("#supervisorState").textContent = s.supervisorHash ? "✓ Criada. O atendente usa esta senha nas ações marcadas em amarelo." : "Não criada: as ações em amarelo pedem a senha do ADM.";
  $("#removeSupPass").disabled = !s.supervisorHash;
  $("#securityStatus").textContent = "";
}
async function saveNewPassword(inputA, inputB, field, okMsg) {
  const a = $(inputA).value, b = $(inputB).value;
  if (a.length < 4) { $("#securityStatus").textContent = "A senha precisa ter pelo menos 4 caracteres."; return; }
  if (a !== b) { $("#securityStatus").textContent = "As senhas não são iguais."; return; }
  sec()[field] = await hashSecret(a);
  await recordSetting("security");
  $(inputA).value = ""; $(inputB).value = "";
  loadSecuritySettings(); toast(okMsg);
}
$("#saveAdminPass").addEventListener("click", () => saveNewPassword("#newAdminPass", "#newAdminPass2", "adminHash", "Senha do ADM trocada."));
$("#saveSupPass").addEventListener("click", () => saveNewPassword("#newSupPass", "#newSupPass2", "supervisorHash", "Senha do atendente salva."));
$("#removeSupPass").addEventListener("click", async () => {
  if (!confirm("Remover a senha do atendente? As ações em amarelo passam a pedir a senha do ADM.")) return;
  delete sec().supervisorHash;
  await recordSetting("security");
  loadSecuritySettings(); toast("Senha do atendente removida.");
});
// [/NEXUS ADM]

// ==========================================================================
// [NEXUS SYNC] Sincronização incremental com a nuvem
// Cada alteração entra numa fila (outbox) e é enviada sozinha. Do servidor,
// só baixamos o que mudou desde o último cursor.
// ==========================================================================
const productPayload = (p) => ({ name: p.name, category: p.category, code: p.code || "", price: p.price, cost: p.cost ?? null, emoji: p.emoji || "📦" });
const SYNC_SETTING_KEYS = ["hardware", "favorites", "security", "appearance"];
const syncMeta = () => (currentCompany.sync ||= { baselineDone: false, cursors: {} });

// Gravações pontuais (aparelho + fila para a nuvem)
async function recordProduct(p, { stockChanged = true } = {}) {
  const m = Date.now();
  await commitLocal(currentCompany.empresa_id, {
    products: [p],
    outbox: [{ t: "p", op: "u", id: p.id, m, d: productPayload(p), ...(stockChanged ? { s: p.stock } : {}) }]
  });
  scheduleSync();
}
async function recordProductDelete(id) {
  await commitLocal(currentCompany.empresa_id, { deleteProductIds: [id], outbox: [{ t: "p", op: "d", id, m: Date.now() }] });
  scheduleSync();
}
async function recordSale(sale, changedProducts) {
  await commitLocal(currentCompany.empresa_id, {
    meta: currentCompany, sales: [sale], products: changedProducts,
    outbox: [{ t: "s", d: sale, a: true }]   // a: true → o servidor dá baixa no estoque
  });
  scheduleSync();
}
async function recordSetting(key) {
  await commitLocal(currentCompany.empresa_id, { meta: currentCompany, outbox: [{ t: "c", k: key, v: currentCompany[key] ?? null, m: Date.now() }] });
  scheduleSync();
}

// Primeira vez com a nuvem: envia o que já existe no aparelho (uma única vez).
// Com marca de tempo 1, nunca sobrescreve o que outro aparelho já enviou.
async function ensureBaseline() {
  const sync = syncMeta();
  if (sync.baselineDone) return;
  const outbox = [
    ...currentCompany.products.map(p => ({ t: "p", op: "u", id: p.id, m: 1, d: productPayload(p), s: p.stock })),
    ...currentCompany.sales.map(s => ({ t: "s", d: s, a: false })),   // estoque já está descontado no aparelho
    ...SYNC_SETTING_KEYS.filter(k => currentCompany[k] !== undefined).map(k => ({ t: "c", k, v: currentCompany[k], m: 1 }))
  ];
  sync.baselineDone = true;
  await commitLocal(currentCompany.empresa_id, { meta: currentCompany, outbox });
}

// Junta alterações repetidas do mesmo produto/configuração (vale a última)
function coalesce(entries) {
  const out = [], lastIndex = new Map();
  for (const e of entries) {
    const c = e.change;
    const key = c.t === "p" ? `p:${c.id}` : c.t === "c" ? `c:${c.k}` : null;
    if (key && lastIndex.has(key)) {
      const prev = out[lastIndex.get(key)];
      // mantém a mudança de estoque explícita se a anterior tinha e a nova não
      out[lastIndex.get(key)] = (c.t === "p" && c.op === "u" && prev.op === "u" && c.s === undefined && prev.s !== undefined) ? { ...c, s: prev.s } : c;
    } else {
      if (key) lastIndex.set(key, out.length);
      out.push(c);
    }
  }
  return out;
}

let syncing = false, syncTimer = null, syncState = { pending: 0, lastOk: 0, error: false };
function scheduleSync(delay = 1500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(console.error), delay);
  refreshSyncBadge();
}
async function refreshSyncBadge() {
  if (!currentCompany) return;
  syncState.pending = await countOutbox(currentCompany.empresa_id).catch(() => 0);
  const el = $("#syncStatus");
  if (!el) return;
  if (!getToken()) { el.textContent = "Somente neste aparelho"; el.className = "sync-status local"; return; }
  if (syncState.pending) { el.textContent = `${syncState.pending} ${syncState.pending === 1 ? "alteração" : "alterações"} para enviar`; el.className = "sync-status pending"; }
  else if (syncState.error) { el.textContent = "Sincronização pausada"; el.className = "sync-status pending"; }
  else { el.textContent = syncState.lastOk ? `Sincronizado às ${new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(syncState.lastOk)}` : "Sincronizando..."; el.className = "sync-status ok"; }
}

async function syncNow() {
  if (syncing || !currentCompany || !getToken() || !navigator.onLine) { refreshSyncBadge(); return; }
  const storeId = currentCompany.empresa_id;
  syncing = true;
  try {
    await ensureBaseline();
    // 1) Envia a fila em lotes
    for (let round = 0; round < 20; round++) {
      const batch = await listOutbox(storeId, 150);
      if (!batch.length) break;
      const r = await api("sync/push", { body: { changes: coalesce(batch) } });
      if (!r.ok) { syncState.error = true; if (r.status === 401) heartbeat(); return; }
      await removeOutbox(batch.map(b => b.seq));
    }
    // 2) Baixa só as novidades (só depois de enviar, para não desfazer alterações locais)
    let changed = false;
    for (let round = 0; round < 30; round++) {
      const c = syncMeta().cursors || {};
      const qs = new URLSearchParams({ pt: c.p?.t || 0, pi: c.p?.i || "", st: c.s?.t || 0, si: c.s?.i || "", ct: c.c?.t || 0, ci: c.c?.i || "" });
      const r = await api(`sync/pull?${qs}`, { method: "GET" });
      if (!r.ok || !currentCompany || currentCompany.empresa_id !== storeId) { syncState.error = true; return; }
      changed = (await applyPull(r.data)) || changed;
      if (!r.data.more) break;
    }
    syncState.error = false;
    syncState.lastOk = Date.now();
    if (changed) { renderProducts(); renderInventory(); updateCart(); }
  } finally {
    syncing = false;
    refreshSyncBadge();
  }
}

async function applyPull(data) {
  const storeId = currentCompany.empresa_id;
  // Não sobrescreve o que ainda está na fila para enviar
  const pending = await listOutbox(storeId, 5000);
  const pendingProducts = new Set(pending.filter(e => e.change.t === "p").map(e => e.change.id));
  const pendingSettings = new Set(pending.filter(e => e.change.t === "c").map(e => e.change.k));
  const putProducts = [], delIds = [], newSales = [];
  let changed = false;
  for (const p of data.products) {
    if (pendingProducts.has(p.id)) continue;
    const i = currentCompany.products.findIndex(x => x.id === p.id);
    if (p.deleted) {
      if (i >= 0) { currentCompany.products.splice(i, 1); delIds.push(p.id); cart = cart.filter(x => x.id !== p.id); changed = true; }
      continue;
    }
    const next = { id: p.id, name: p.name, category: p.category || "Mercearia", code: p.code || "", price: Number(p.price), cost: p.cost ?? null, stock: Number(p.stock), emoji: p.emoji || "📦" };
    if (i >= 0) currentCompany.products[i] = { ...currentCompany.products[i], ...next }; else currentCompany.products.push(next);
    putProducts.push(next); changed = true;
  }
  const known = new Set(currentCompany.sales.map(s => s.id));
  for (const s of data.sales) {
    if (known.has(s.id)) continue;
    newSales.push(s); currentCompany.sales.push(s);
    currentCompany.saleSeq = Math.max(currentCompany.saleSeq || 0, Number(s.number) || 0);
  }
  if (newSales.length) currentCompany.sales.sort((a, b) => a.createdAt - b.createdAt);
  for (const st of data.settings) {
    if (pendingSettings.has(st.key) || !SYNC_SETTING_KEYS.includes(st.key)) continue;
    currentCompany[st.key] = st.value; changed = true;
  }
  syncMeta().cursors = data.cursors;
  if (data.settings.some(st => st.key === "appearance")) refreshTheme();
  await commitLocal(storeId, { meta: currentCompany, products: putProducts, deleteProductIds: delIds, sales: newSales });
  return changed || newSales.length > 0;
}
window.addEventListener("online", () => scheduleSync(500));
// [/NEXUS SYNC]

// ==========================================================================
// [NEXUS CLOUD] Nuvem (Cloudflare D1), app instalável (PWA) e Área Master
// ==========================================================================
const TOKEN_KEY = "nexus_token";
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);
const DAY_MS = 24 * 60 * 60 * 1000;
const fmtDate = (ts) => ts ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(ts) : "—";
const fmtDateTimeShort = (ts) => ts ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(ts) : "—";

async function api(path, { method = "POST", body, token = getToken(), timeout = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`/api/${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && method !== "GET" && method !== "DELETE" ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    let data = null;
    try { data = await res.json(); } catch { /* resposta sem JSON */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}
// Servidor fora do ar, sem internet ou API ainda não publicada
const serverUnavailable = (r) => r.status === 0 || r.status === 404 || r.status >= 500;

const AUTH_ERRORS = {
  invalid_email: "Informe um e-mail válido.",
  weak_password: "A senha precisa ter pelo menos 4 caracteres.",
  store_name_required: "Informe o nome da loja.",
  email_exists: "Este e-mail já tem uma loja cadastrada. Use Entrar.",
  invalid_credentials: "E-mail ou senha incorretos.",
  too_many_attempts: "Muitas tentativas. Aguarde alguns minutos e tente de novo."
};

function newLocalCompany({ empresa_id, storeName, email, passwordHash }) {
  const startedAt = now();
  return {
    empresa_id, storeName, email, passwordHash,
    createdAt: startedAt, trialEndsAt: startedAt + TRIAL_MS, trialDismissedAt: 0,
    products: structuredClone(DEMO_PRODUCTS), sales: [], security: { enabled: false, passwordHash: "" }
  };
}
function applyServerStore(company, srv) {
  company.server = {
    status: srv.status, plan: srv.plan, planName: srv.planName, planExpiresAt: srv.planExpiresAt,
    trialEndsAt: srv.trialEndsAt, mustChangePassword: Boolean(srv.mustChangePassword),
    requestedPlan: srv.requestedPlan || null
  };
  company.trialEndsAt = srv.trialEndsAt;
}
async function upsertLocalCompany(srv, passwordHash, { isNewStore = false } = {}) {
  let company = await getCompany(srv.id);
  // Loja aberta pela primeira vez neste aparelho: começa vazia e baixa tudo da nuvem
  // Loja nova: produtos de exemplo, enviados à nuvem na primeira sincronização.
  // Loja existente aberta pela primeira vez neste aparelho: começa vazia e baixa tudo da nuvem.
  company ||= isNewStore
    ? newLocalCompany({ empresa_id: srv.id, storeName: srv.storeName, email: srv.email, passwordHash })
    : { ...newLocalCompany({ empresa_id: srv.id, storeName: srv.storeName, email: srv.email, passwordHash }), products: [], sync: { baselineDone: true, cursors: {} } };
  company.storeName = srv.storeName;
  company.email = srv.email;
  company.passwordHash = passwordHash; // permite entrar sem internet neste aparelho
  applyServerStore(company, srv);
  await saveCompany(company);
  return company;
}

async function registerFlow({ storeName, email, password, passwordHash }) {
  if (!storeName) return { error: AUTH_ERRORS.store_name_required };
  const empresa_id = makeCompanyId();
  const r = await api("auth/register", { body: { storeName, email, password, empresaId: empresa_id }, token: "" });
  if (r.ok) {
    setToken(r.data.token);
    return { company: await upsertLocalCompany(r.data.store, passwordHash, { isNewStore: true }) };
  }
  if (!serverUnavailable(r)) return { error: AUTH_ERRORS[r.data?.error] || "Não foi possível criar a conta." };
  // Sem servidor: cria a loja só neste aparelho. Ela sobe para a nuvem no próximo login com internet.
  if (await findCompanyByEmail(email)) return { error: "Este e-mail já possui uma loja neste aparelho. Use Entrar." };
  const company = newLocalCompany({ empresa_id, storeName, email, passwordHash });
  await saveCompany(company);
  return { company, localOnly: true };
}

async function loginFlow({ email, password, passwordHash }) {
  const r = await api("auth/login", { body: { email, password }, token: "" });
  if (r.ok) {
    setToken(r.data.token);
    return { company: await upsertLocalCompany(r.data.store, passwordHash), mustChangePassword: r.data.store.mustChangePassword };
  }
  if (r.status === 401) {
    // Loja criada antes da nuvem existir: envia para o servidor mantendo o mesmo código da loja
    const local = await findCompanyByEmail(email);
    if (local && !local.server && local.passwordHash === passwordHash) {
      const reg = await api("auth/register", { body: { storeName: local.storeName, email, password, empresaId: local.empresa_id }, token: "" });
      if (reg.ok) {
        setToken(reg.data.token);
        toast("Sua loja foi conectada à nuvem.");
        return { company: await upsertLocalCompany(reg.data.store, passwordHash) };
      }
    }
    return { error: AUTH_ERRORS.invalid_credentials };
  }
  if (!serverUnavailable(r)) return { error: AUTH_ERRORS[r.data?.error] || "Não foi possível entrar." };
  const local = await findCompanyByEmail(email);
  if (local && local.passwordHash === passwordHash) return { company: local, localOnly: true };
  return { error: "Sem conexão com o servidor, e esta loja ainda não foi aberta neste aparelho." };
}

// ---------- Nome do app: "PDV + nome da loja" ----------
function applyBranding(name) {
  const label = name ? `PDV ${name}` : "Nexus PDV";
  document.title = name ? label : "Nexus PDV — Frente de caixa simples e inteligente";
  $("#appleTitle").setAttribute("content", label);
  $("#manifestLink").setAttribute("href", name ? `/api/manifest?loja=${encodeURIComponent(name)}` : "/api/manifest");
  try { name ? localStorage.setItem("nexus_store_name", name) : localStorage.removeItem("nexus_store_name"); } catch {}
  const initials = (name || "Minha Loja").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  $("#storeAvatar").textContent = initials || "PD";
}

// ---------- Status do plano, conexão e bloqueio ----------
function setConnection(online) {
  const pill = $("#connectionPill");
  pill.classList.toggle("online", online);
  pill.classList.toggle("local", !online);
  pill.querySelector("span").textContent = online ? "Conectado à nuvem" : "Modo local";
}
function renderPlanStatus() {
  const el = $("#storePlanStatus");
  const s = currentCompany?.server;
  let text = "● Modo local (sem nuvem)", cls = "st-yellow";
  if (s) {
    const code = s.status?.code;
    if (code === "ativo") { text = `● ${s.status.label} · até ${fmtDate(s.planExpiresAt)}`; cls = "st-green"; }
    else if (code === "teste") {
      const days = Math.max(0, Math.ceil((s.trialEndsAt - now()) / DAY_MS));
      text = `● Teste grátis · ${days} ${days === 1 ? "dia" : "dias"}`;
    }
    else if (code === "pendente") text = "● Pagamento pendente";
    else if (code === "desativado") { text = "● Acesso suspenso"; cls = "st-red"; }
  }
  el.textContent = text;
  el.className = cls;
}
function renderBlocked() {
  const s = currentCompany?.server;
  const blocked = s?.status?.code === "desativado";
  $("#blockedOverlay").classList.toggle("hidden", !blocked);
  if (blocked) {
    $("#blockedText").textContent = s.status.label === "Vencido"
      ? "Seu plano venceu há mais de 7 dias. Fale com o suporte para reativar o seu PDV."
      : "Seu acesso foi desativado. Fale com o suporte para reativar o seu PDV.";
    document.activeElement?.blur?.();
  }
}
$("#blockedLogout").addEventListener("click", () => exitApp());

// ---------- Mensagens da Área Master ----------
const dismissedKey = () => `nexus_bc_dismissed_${currentCompany?.empresa_id}`;
function renderBroadcasts(list = []) {
  let dismissed = [];
  try { dismissed = JSON.parse(localStorage.getItem(dismissedKey()) || "[]"); } catch {}
  const icons = { info: "ℹ️", aviso: "⚠️", urgente: "🚨" };
  $("#broadcastArea").innerHTML = list.filter(b => !dismissed.includes(b.id)).map(b => `
    <div class="bc-msg ${escapeHTML(b.level)}"><span class="bc-icon">${icons[b.level] || "ℹ️"}</span>
      <div><b>${escapeHTML(b.title)}</b><p>${escapeHTML(b.body)}</p></div>
      <button type="button" data-dismiss-bc="${Number(b.id)}" aria-label="Fechar mensagem">×</button></div>`).join("");
  $$("[data-dismiss-bc]").forEach(btn => btn.addEventListener("click", () => {
    dismissed.push(Number(btn.dataset.dismissBc));
    localStorage.setItem(dismissedKey(), JSON.stringify(dismissed.slice(-50)));
    btn.closest(".bc-msg").remove();
  }));
}

// ---------- Sinal de "caixa ligado" ----------
let heartbeatTimer = null;
async function heartbeat() {
  if (!currentCompany) return;
  if (!getToken()) { setConnection(false); return; }
  const r = await api("heartbeat", { body: { cashierOpen: true } });
  if (!currentCompany) return;
  if (r.ok) {
    setConnection(true);
    const before = JSON.stringify(currentCompany.server || {});
    applyServerStore(currentCompany, r.data.store);
    if (JSON.stringify(currentCompany.server) !== before) persist().catch(console.error);
    renderPlanStatus(); renderTrialBanner(); renderBlocked(); renderBroadcasts(r.data.broadcasts);
    syncNow().catch(console.error); // [NEXUS SYNC] envia a fila e baixa novidades
  } else if (r.status === 401) {
    clearToken();
    toast("Sua sessão foi encerrada. Entre novamente.");
    exitApp();
  } else {
    setConnection(false);
  }
}
function startHeartbeat() {
  stopHeartbeat();
  heartbeat();
  heartbeatTimer = setInterval(heartbeat, 30000);
}
function stopHeartbeat() { clearInterval(heartbeatTimer); heartbeatTimer = null; clearTimeout(syncTimer); }
function sendCashierClosed() {
  const token = getToken();
  if (!token || !currentCompany) return;
  const blob = new Blob([JSON.stringify({ token, cashierOpen: false })], { type: "application/json" });
  navigator.sendBeacon?.("/api/heartbeat", blob);
}
window.addEventListener("pagehide", sendCashierClosed);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && currentCompany) heartbeat(); });
window.addEventListener("online", () => { if (currentCompany) heartbeat(); });

// ---------- Troca de senha obrigatória ----------
function openPasswordModal() {
  $("#passwordForm").reset();
  $("#passwordFormError").textContent = "";
  $("#passwordModal").classList.remove("hidden");
  setTimeout(() => $("#newPass1").focus(), 30);
}
$("#passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = $("#newPass1").value, p2 = $("#newPass2").value, err = $("#passwordFormError");
  if (p1.length < 4) { err.textContent = "A senha precisa ter pelo menos 4 caracteres."; return; }
  if (p1 !== p2) { err.textContent = "As senhas não são iguais."; return; }
  const r = await api("auth/password", { body: { newPassword: p1 } });
  if (!r.ok) { err.textContent = r.status === 0 ? "Sem conexão. Tente de novo." : "Não foi possível salvar a senha."; return; }
  currentCompany.passwordHash = await hashDemoPassword(p1);
  if (currentCompany.server) currentCompany.server.mustChangePassword = false;
  await persist();
  $("#passwordModal").classList.add("hidden");
  toast("Nova senha salva.");
  focusScanner();
});

// ---------- App instalável (PWA) ----------
let deferredInstall = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  $("#installAppBtn").classList.remove("hidden");
});
if (isIOS && !isStandalone()) $("#installAppBtn").classList.remove("hidden");
$("#installAppBtn").addEventListener("click", async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null;
    $("#installAppBtn").classList.add("hidden");
  } else if (isIOS) {
    toast("No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.");
  }
});
window.addEventListener("appinstalled", () => { $("#installAppBtn").classList.add("hidden"); toast("App instalado! Procure o ícone na tela inicial."); });
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(console.warn));
}

// ---------- Planos (página inicial e dentro do app) ----------
$$(".plan-btn").forEach(b => b.addEventListener("click", () => showModal("register")));
function openPlansModal() {
  const grid = $("#plansModalGrid");
  grid.innerHTML = $(".pricing-grid").innerHTML;
  const requested = currentCompany?.server?.requestedPlan;
  grid.querySelectorAll(".plan-btn").forEach(btn => {
    btn.textContent = "Quero este plano →";
    btn.addEventListener("click", () => requestPlan(btn.dataset.plan));
  });
  if (requested) grid.insertAdjacentHTML("beforeend", `<p class="plan-requested">✓ Pedido enviado. Nossa equipe vai entrar em contato para ativar.</p>`);
  $("#plansModal").classList.remove("hidden");
}
async function requestPlan(plan) {
  const names = { basico: "Básico", completo: "Completo", premium: "Premium" };
  if (!getToken()) { toast("Conecte-se à internet e entre de novo para pedir o plano."); return; }
  const r = await api("plan-request", { body: { plan } });
  if (!r.ok) { toast("Não foi possível enviar o pedido. Tente de novo."); return; }
  if (currentCompany.server) currentCompany.server.requestedPlan = plan;
  $("#plansModal").classList.add("hidden");
  toast(`Pedido do plano ${names[plan]} enviado! Nossa equipe vai ativar o seu acesso.`);
  focusScanner();
}
const closePlansModal = () => { $("#plansModal").classList.add("hidden"); focusScanner(); };
$$("[data-close-plans]").forEach(b => b.addEventListener("click", closePlansModal));
$("#plansModal").addEventListener("click", (e) => { if (e.target.id === "plansModal") nudgeModal(e.target); });
$("#bannerPlans").addEventListener("click", openPlansModal);
$("#blockedPlans").addEventListener("click", openPlansModal);

// ==========================================================================
// Área Master
// ==========================================================================
const MASTER_KEY = "nexus_master_token";
let masterToken = sessionStorage.getItem(MASTER_KEY) || "";
let masterSetupMode = false, masterData = null, masterFilter = "todos", masterTimer = null;
const tempPasswords = {};
const PERIOD_LABELS = { 15: "15 dias", 30: "30 dias", 90: "3 meses", 180: "6 meses", 365: "1 ano" };

$("#masterDot").addEventListener("click", async () => {
  if (masterToken && await loadMaster()) { openMasterView(); return; }
  openMasterLogin();
});
async function openMasterLogin() {
  $("#masterLoginForm").reset();
  $("#masterLoginError").textContent = "";
  $("#masterLoginModal").classList.remove("hidden");
  const r = await api("master/status", { method: "GET", token: "" });
  if (serverUnavailable(r)) { $("#masterLoginError").textContent = "Servidor indisponível no momento."; }
  masterSetupMode = r.ok && r.data && !r.data.configured;
  $("#masterSetupFields").classList.toggle("hidden", !masterSetupMode);
  $("#masterConfirmWrap").classList.toggle("hidden", !masterSetupMode);
  $("#masterLoginDesc").textContent = masterSetupMode
    ? "Primeiro acesso: informe o código de configuração e crie a sua senha master (mínimo 8 caracteres)."
    : "Digite a senha master.";
  $("#masterLoginSubmit").textContent = masterSetupMode ? "Criar senha e entrar →" : "Entrar →";
  $("#masterPass").setAttribute("autocomplete", masterSetupMode ? "new-password" : "current-password");
  setTimeout(() => (masterSetupMode ? $("#masterSetupCode") : $("#masterPass")).focus(), 30);
}
const closeMasterLogin = () => $("#masterLoginModal").classList.add("hidden");
$$("[data-close-master-login]").forEach(b => b.addEventListener("click", closeMasterLogin));
$("#masterLoginModal").addEventListener("click", (e) => { if (e.target.id === "masterLoginModal") nudgeModal(e.target); });
$("#masterLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#masterLoginError");
  err.textContent = "";
  const password = $("#masterPass").value;
  let r;
  if (masterSetupMode) {
    if (password.length < 8) { err.textContent = "A senha master precisa ter pelo menos 8 caracteres."; return; }
    if (password !== $("#masterPass2").value) { err.textContent = "As senhas não são iguais."; return; }
    r = await api("master/setup", { body: { code: $("#masterSetupCode").value.trim().toUpperCase(), password }, token: "" });
  } else {
    r = await api("master/login", { body: { password }, token: "" });
  }
  if (!r.ok) {
    const map = { invalid_credentials: "Senha incorreta.", invalid_setup_code: "Código de primeiro acesso inválido.", too_many_attempts: "Muitas tentativas. Aguarde 15 minutos.", already_configured: "A senha master já foi criada. Recarregue a página." };
    err.textContent = map[r.data?.error] || "Não foi possível entrar.";
    return;
  }
  masterToken = r.data.token;
  sessionStorage.setItem(MASTER_KEY, masterToken);
  closeMasterLogin();
  if (await loadMaster()) openMasterView();
});

function openMasterView() {
  $("#masterView").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  clearInterval(masterTimer);
  masterTimer = setInterval(loadMaster, 20000);
}
function closeMasterView() {
  $("#masterView").classList.add("hidden");
  document.body.style.overflow = "";
  clearInterval(masterTimer);
  focusScanner();
}
$("#masterClose").addEventListener("click", closeMasterView);
$("#masterRefresh").addEventListener("click", () => loadMaster().then(ok => ok && toast("Painel atualizado.")));
$("#masterLogout").addEventListener("click", async () => {
  await api("master/logout", { token: masterToken });
  masterToken = ""; sessionStorage.removeItem(MASTER_KEY);
  closeMasterView();
  toast("Você saiu da Área Master.");
});

async function masterApi(path, opts = {}) {
  const r = await api(path, { ...opts, token: masterToken });
  if (r.status === 401) {
    masterToken = ""; sessionStorage.removeItem(MASTER_KEY);
    closeMasterView();
    toast("Sessão master expirada. Entre de novo.");
  }
  return r;
}
async function loadMaster() {
  const r = await masterApi("master/overview", { method: "GET" });
  if (!r.ok) { if (r.status !== 401 && !$("#masterView").classList.contains("hidden")) toast("Não foi possível atualizar o painel."); return false; }
  masterData = r.data;
  renderMaster();
  return true;
}
function renderMaster() {
  const d = masterData;
  if (!d) return;
  $("#masterUpdated").textContent = `Atualizado às ${new Intl.DateTimeFormat("pt-BR", { timeStyle: "medium" }).format(d.serverTime)} · atualiza sozinho a cada 20 s`;
  $("#kpiTotal").textContent = d.kpis.total;
  $("#kpiOnline").textContent = d.kpis.online;
  $("#kpiTeste").textContent = d.kpis.teste;
  $("#kpiAtivo").textContent = d.kpis.ativo;
  $("#kpiPendente").textContent = d.kpis.pendente;
  $("#kpiDesativado").textContent = d.kpis.desativado;
  // mensagens
  $("#bcList").innerHTML = d.broadcasts.length ? d.broadcasts.map(b => `
    <div class="bc-item ${escapeHTML(b.level)}"><button type="button" data-remove-bc="${Number(b.id)}">Remover</button>
      <b>${escapeHTML(b.title)}</b><p>${escapeHTML(b.body)}</p><small>Enviada em ${fmtDateTimeShort(b.createdAt)}</small></div>`).join("")
    : '<p class="muted-text">Nenhuma mensagem ativa.</p>';
  $$("[data-remove-bc]").forEach(btn => btn.addEventListener("click", async () => {
    const r = await masterApi(`master/broadcasts/${btn.dataset.removeBc}`, { method: "DELETE" });
    if (r.ok) { toast("Mensagem removida."); loadMaster(); }
  }));
  renderMasterStores();
}
function storeMatches(s) {
  const term = $("#masterSearch").value.trim().toLowerCase();
  if (term && !`${s.storeName} ${s.email}`.toLowerCase().includes(term)) return false;
  if (masterFilter === "todos") return true;
  if (masterFilter === "online") return s.online;
  if (masterFilter === "pedidos") return Boolean(s.requestedPlan);
  return s.status.code === masterFilter;
}
function renderMasterStores() {
  const d = masterData;
  const list = d.stores.filter(storeMatches);
  const planOptions = Object.entries(d.plans).map(([k, p]) => `<option value="${k}">${escapeHTML(p.name)}</option>`).join("");
  const periodOptions = d.periods.map(n => `<option value="${n}" ${n === 30 ? "selected" : ""}>${PERIOD_LABELS[n] || n + " dias"}</option>`).join("");
  $("#masterStores").innerHTML = list.length ? list.map(s => {
    const seen = s.lastSeenAt ? `visto ${fmtDateTimeShort(s.lastSeenAt)}` : "nunca abriu o caixa";
    const validity = s.plan && s.planExpiresAt
      ? `Plano ${escapeHTML(s.planName || s.plan)} até <b>${fmtDate(s.planExpiresAt)}</b>`
      : `Teste até <b>${fmtDate(s.trialEndsAt)}</b>`;
    const temp = tempPasswords[s.id];
    return `<div class="store-card ${s.status.color}">
      <div>
        <div class="store-head"><b>${escapeHTML(s.storeName)}</b>
          <span class="status-pill ${s.status.color}">${escapeHTML(s.status.label)}</span>
          ${s.requestedPlan ? `<span class="request-tag">📩 Pediu ${escapeHTML(s.requestedPlanName || s.requestedPlan)} · ${fmtDate(s.requestedAt)}</span>` : ""}
          <span class="online-tag ${s.online ? "on" : ""}"><i class="dot ${s.online ? "green pulse-dot" : "gray"}"></i>${s.online ? "Caixa ligado" : "Offline"}</span>
        </div>
        <div class="store-meta">${escapeHTML(s.email)}<br>Cadastro em ${fmtDate(s.createdAt)} · ${validity}<br>${s.online ? "Usando agora" : seen}</div>
      </div>
      <div class="store-actions">
        <div class="row"><select data-plan-for="${s.id}" aria-label="Plano">${planOptions}</select><select data-period-for="${s.id}" aria-label="Período">${periodOptions}</select></div>
        <button class="btn btn-primary" type="button" data-activate="${s.id}">✓ Ativar pacote</button>
        <div class="row">
          <button class="btn btn-secondary" type="button" data-reset="${s.id}">🔑 Redefinir senha</button>
          ${s.blocked
            ? `<button class="btn btn-ok" type="button" data-block="${s.id}" data-blocked="0">Reativar</button>`
            : `<button class="btn btn-danger" type="button" data-block="${s.id}" data-blocked="1">Desativar</button>`}
        </div>
      </div>
      ${temp ? `<div class="temp-pass">Senha provisória de <b>${escapeHTML(s.storeName)}</b>: <code>${escapeHTML(temp)}</code> <button class="btn btn-secondary" type="button" data-copy-temp="${s.id}">Copiar</button><small>O cliente cria uma senha nova no próximo login.</small></div>` : ""}
    </div>`;
  }).join("") : '<p class="empty-list">Nenhuma loja encontrada.</p>';

  // mantém o plano atual selecionado
  list.forEach(s => { const sel = $(`[data-plan-for="${s.id}"]`); if (sel && (s.requestedPlan || s.plan)) sel.value = s.requestedPlan || s.plan; });
  $$("[data-activate]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.activate;
    const plan = $(`[data-plan-for="${id}"]`).value, days = Number($(`[data-period-for="${id}"]`).value);
    const store = masterData.stores.find(s => s.id === id);
    if (!confirm(`Ativar ${masterData.plans[plan].name} por ${PERIOD_LABELS[days]} para "${store.storeName}"?`)) return;
    const r = await masterApi(`master/stores/${id}/plan`, { body: { plan, days } });
    if (r.ok) { toast(`Pacote ativado até ${fmtDate(r.data.store.planExpiresAt)}.`); loadMaster(); }
    else toast("Não foi possível ativar o pacote.");
  }));
  $$("[data-reset]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.reset;
    const store = masterData.stores.find(s => s.id === id);
    if (!confirm(`Redefinir a senha de "${store.storeName}"? A senha atual deixa de funcionar e o caixa dele será desconectado.`)) return;
    const r = await masterApi(`master/stores/${id}/reset-password`, {});
    if (r.ok) { tempPasswords[id] = r.data.tempPassword; renderMasterStores(); }
    else toast("Não foi possível redefinir a senha.");
  }));
  $$("[data-copy-temp]").forEach(btn => btn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(tempPasswords[btn.dataset.copyTemp]); toast("Senha copiada."); } catch { toast("Copie a senha manualmente."); }
  }));
  $$("[data-block]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.block, blocked = btn.dataset.blocked === "1";
    const store = masterData.stores.find(s => s.id === id);
    if (blocked && !confirm(`Desativar "${store.storeName}"? O PDV dele fica bloqueado até você reativar.`)) return;
    const r = await masterApi(`master/stores/${id}/block`, { body: { blocked } });
    if (r.ok) { toast(blocked ? "Loja desativada." : "Loja reativada."); loadMaster(); }
    else toast("Não foi possível alterar a loja.");
  }));
}
$("#masterSearch").addEventListener("input", () => masterData && renderMasterStores());
$$("[data-mfilter]").forEach(b => b.addEventListener("click", () => {
  masterFilter = b.dataset.mfilter;
  $$("[data-mfilter]").forEach(x => x.classList.toggle("active", x === b));
  if (masterData) renderMasterStores();
}));
$("#broadcastForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { title: $("#bcTitle").value.trim(), body: $("#bcBody").value.trim(), level: $("#bcLevel").value };
  if (!body.body) return;
  const r = await masterApi("master/broadcasts", { body });
  if (r.ok) { $("#broadcastForm").reset(); toast("Mensagem enviada para todas as lojas."); loadMaster(); }
  else toast("Não foi possível enviar a mensagem.");
});
// [/NEXUS CLOUD]
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#permModal").classList.contains("hidden")) cancelPerm();
  else if (!$("#plansModal").classList.contains("hidden")) closePlansModal();
  else if (!$("#masterLoginModal").classList.contains("hidden")) closeMasterLogin();
  else if (!$("#masterView").classList.contains("hidden")) closeMasterView();
});

window.addEventListener("offline", () => { if (currentCompany) { setConnection(false); toast("Você está offline. O caixa continua funcionando neste aparelho."); } });
loadSession().catch(console.error);
