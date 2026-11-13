import { getCompany, saveCompany, findCompanyByEmail } from "./db.js";

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
const THEMES = { laranja: "#f97316", amarelo: "#f59e0b", dark: "#0b1020" };
function setTheme(theme) {
  if (!THEMES[theme]) theme = "laranja";
  document.body.dataset.theme = theme;
  document.body.classList.toggle("theme-light", theme !== "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[theme]);
  localStorage.setItem("nexus_theme_v2", theme);
  $$("[data-theme-choice]").forEach(b => b.classList.toggle("active", b.dataset.themeChoice === theme));
}
$$("[data-theme-choice]").forEach(b => b.addEventListener("click", () => setTheme(b.dataset.themeChoice)));
setTheme(localStorage.getItem("nexus_theme_v2") || "laranja");

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
$("#openLogin").addEventListener("click", () => showModal("login"));
["openTrial","heroTrial","howTrial"].forEach(id => $("#"+id).addEventListener("click", () => showModal("register")));
$$("[data-close-modal]").forEach(b => b.addEventListener("click", closeModal));
$("#authModal").addEventListener("click", e => { if (e.target.id === "authModal") closeModal(); });

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
function persist() { return saveCompany(currentCompany); }
function enterApp() {
  $("#landingView").classList.add("hidden"); $("#appView").classList.remove("hidden");
  document.body.classList.add("in-app");
  $("#storeNameSide").textContent = currentCompany.storeName;
  applyBranding(currentCompany.storeName);            // [NEXUS CLOUD] app vira "PDV <loja>"
  setConnection(false); renderPlanStatus(); renderBlocked();
  renderProducts(); renderInventory(); updateCart(); renderTrialBanner();
  showPanel("pos");
  startHeartbeat();
}
function exitApp() {
  stopHeartbeat();
  const token = getToken();
  if (token) api("auth/logout", { token }).catch(() => {});
  clearToken();
  localStorage.removeItem("nexus_current_company");
  currentCompany = null; cart = [];
  applyBranding("");
  $("#broadcastArea").innerHTML = "";
  $("#blockedOverlay").classList.add("hidden");
  $("#passwordModal").classList.add("hidden");
  $("#appView").classList.add("hidden"); $("#landingView").classList.remove("hidden");
  document.body.classList.remove("in-app");
  $("#trialBanner").classList.add("hidden");
}
$("#logoutBtn").addEventListener("click", () => exitApp());

function renderTrialBanner() {
  const banner = $("#trialBanner"), text = banner.querySelector("span");
  if (!currentCompany) { banner.classList.add("hidden"); return; }
  const code = currentCompany.server?.status?.code;
  if (code === "ativo" || code === "desativado") { banner.classList.add("hidden"); return; }
  const hiddenAt = Number(localStorage.getItem(`nexus_banner_hidden_${currentCompany.empresa_id}`) || 0);
  if (now() - hiddenAt < HIDE_MS) { banner.classList.add("hidden"); return; }
  if (code === "pendente") {
    text.innerHTML = "⚠️ Pagamento pendente: regularize seu plano para não ter o acesso suspenso.";
    banner.classList.remove("hidden"); return;
  }
  const remaining = currentCompany.trialEndsAt - now();
  if (remaining <= 0) { text.innerHTML = "⚠️ Seu período de teste terminou. Escolha um plano para continuar."; banner.classList.remove("hidden"); return; }
  const days = Math.max(1, Math.ceil(remaining / (24*60*60*1000)));
  text.innerHTML = `⚠️ Você está no Teste Grátis: <strong id="daysRemaining">${days}</strong> ${days === 1 ? "dia restante" : "dias restantes"}.`;
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
  const titles = {pos:["OPERAÇÃO","Frente de caixa"],products:["ESTOQUE","Produtos e estoque"],admin:["CONFIGURAÇÕES","Painel administrativo"]};
  $("#pageEyebrow").textContent = titles[panel][0]; $("#pageTitle").textContent = titles[panel][1];
  if (panel === "admin") { loadSecuritySettings(); loadHardwareSettings(); } // [NEXUS HW]
  if (panel === "pos") focusScanner(); // [NEXUS HW]
}
$$("[data-view]").forEach(b => b.addEventListener("click", () => showPanel(b.dataset.view)));

function renderProducts() {
  const term = ($("#productSearch")?.value || "").trim().toLowerCase();
  const products = currentCompany.products.filter(p => (activeCategory === "Todos" || p.category === activeCategory) && `${p.name} ${p.code}`.toLowerCase().includes(term));
  $("#productGrid").innerHTML = products.map(p => `<button class="product-tile" data-add-product="${p.id}"><span class="product-emoji">${p.emoji || "📦"}</span><b>${escapeHTML(p.name)}</b><small>${escapeHTML(p.category)} · ${p.stock} em estoque</small><strong>${money(p.price)}</strong></button>`).join("") || '<p class="empty-cart">Nenhum produto encontrado.</p>';
  $$("[data-add-product]").forEach(b => b.addEventListener("click", () => addToCart(b.dataset.addProduct)));
}
function escapeHTML(str) { return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
$("#productSearch").addEventListener("input", renderProducts);
$$(".chip").forEach(b => b.addEventListener("click", () => { activeCategory = b.dataset.category; $$(".chip").forEach(x => x.classList.toggle("active", x === b)); renderProducts(); }));
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
function updateCart() {
  if (!currentCompany) return;
  const items = cart.map(line => ({...line, product: currentCompany.products.find(p => p.id === line.id)})).filter(x => x.product);
  const count = items.reduce((n,x) => n+x.qty,0);
  const total = items.reduce((n,x) => n+x.product.price*x.qty,0);
  $("#cartCount").textContent = `${count} ${count === 1 ? "item" : "itens"}`;
  $("#subtotalValue").textContent = money(total); $("#totalValue").textContent = money(total);
  $("#checkoutBtn").disabled = !items.length;
  $("#reprintBtn").disabled = !currentCompany.sales?.length; // [NEXUS HW]
  $("#cartItems").innerHTML = items.length ? items.map(x => `<div class="cart-item"><div class="cart-item-info"><b>${escapeHTML(x.product.name)}</b><small>${money(x.product.price)} · ${money(x.product.price*x.qty)}</small></div><div class="qty-control"><button data-qty="${x.id}" data-delta="-1">−</button><span>${x.qty}</span><button data-qty="${x.id}" data-delta="1">+</button></div></div>`).join("") : '<div class="empty-cart">Seu carrinho está vazio.<br><small>Adicione produtos para começar.</small></div>';
  $$("[data-qty]").forEach(b => b.addEventListener("click", () => {
    const line = cart.find(x => x.id === b.dataset.qty); line.qty += Number(b.dataset.delta);
    if (line.qty <= 0) cart = cart.filter(x => x !== line);
    updateCart();
  }));
}
$("#clearCart").addEventListener("click", () => { cart = []; updateCart(); });
// [NEXUS HW] "Finalizar venda" abre o modal de pagamento/troco/impressão (ver finalizeSale no módulo de periféricos).
$("#checkoutBtn").addEventListener("click", openCheckout);

function renderInventory() {
  $("#inventoryTable").innerHTML = currentCompany.products.map(p => `<tr><td><strong>${p.emoji || "📦"} ${escapeHTML(p.name)}</strong></td><td>${escapeHTML(p.category)}</td><td>${escapeHTML(p.code)}</td><td>${money(p.price)}</td><td class="${p.stock < 10 ? "stock-low" : ""}">${p.stock} un.</td><td><button class="table-action" data-edit="${p.id}">Editar</button> <button class="table-action" data-delete="${p.id}">Excluir</button></td></tr>`).join("");
  $$("[data-edit]").forEach(b => b.addEventListener("click", () => editProduct(b.dataset.edit)));
  $$("[data-delete]").forEach(b => b.addEventListener("click", () => deleteProduct(b.dataset.delete)));
}
async function authorizeSensitiveAction(action) {
  if (!currentCompany.security?.enabled) return true;
  const password = prompt(`Autorização necessária para: ${action}\nDigite a senha mestre:`);
  if (password === null) return false;
  const hash = await hashDemoPassword(password);
  if (hash !== currentCompany.security.passwordHash) { toast("Senha mestre incorreta."); return false; }
  return true;
}
async function editProduct(id) {
  if (!await authorizeSensitiveAction("alterar preço/estoque")) return;
  const p = currentCompany.products.find(x => x.id === id);
  const price = prompt(`Novo preço para ${p.name}:`, p.price);
  if (price === null) return;
  const parsed = Number(price.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) { toast("Informe um preço válido."); return; }
  p.price = parsed;
  const stock = prompt("Quantidade em estoque:", p.stock);
  if (stock !== null && Number.isInteger(Number(stock)) && Number(stock) >= 0) p.stock = Number(stock);
  await persist(); renderInventory(); renderProducts(); toast("Produto atualizado.");
}
async function deleteProduct(id) {
  if (!await authorizeSensitiveAction("excluir produto")) return;
  if (!confirm("Deseja realmente excluir este produto?")) return;
  currentCompany.products = currentCompany.products.filter(p => p.id !== id);
  cart = cart.filter(x => x.id !== id);
  await persist(); renderInventory(); renderProducts(); updateCart(); toast("Produto excluído.");
}
$("#addProductBtn").addEventListener("click", () => openProductModal("")); // [NEXUS HW] modal no lugar dos prompts

function loadSecuritySettings() {
  const enabled = Boolean(currentCompany.security?.enabled);
  $("#stockProtectionToggle").checked = enabled;
  $("#passwordSettings").classList.toggle("disabled", !enabled);
  $("#securityStatus").textContent = enabled ? "Proteção ativa neste dispositivo." : "Proteção desativada.";
}
$("#stockProtectionToggle").addEventListener("change", e => {
  $("#passwordSettings").classList.toggle("disabled", !e.target.checked);
  if (!e.target.checked) toast("Salve para desativar a proteção.");
});
$("#saveSecurityBtn").addEventListener("click", async () => {
  const enabled = $("#stockProtectionToggle").checked;
  if (enabled) {
    const p1 = $("#masterPassword").value, p2 = $("#masterPasswordConfirm").value;
    if (p1.length < 4 || p1 !== p2) { $("#securityStatus").textContent = "As senhas devem ter ao menos 4 caracteres e ser iguais."; return; }
    currentCompany.security = { enabled:true, passwordHash:await hashDemoPassword(p1) };
  } else {
    if (currentCompany.security?.enabled && !await authorizeSensitiveAction("desativar proteção de estoque")) return;
    currentCompany.security = { enabled:false, passwordHash:"" };
  }
  await persist(); $("#masterPassword").value = ""; $("#masterPasswordConfirm").value = "";
  loadSecuritySettings(); toast("Configuração de segurança salva.");
});


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
async function openProductModal(code = "", fromScanner = false) {
  if (!await authorizeSensitiveAction("adicionar produto")) { focusScanner(); return; }
  productModalFromScanner = fromScanner;
  $("#productForm").reset();
  $("#pfCode").value = code;
  $("#pfStock").value = "0";
  $("#productFormError").textContent = "";
  $("#productModal").classList.remove("hidden");
  setTimeout(() => (code ? $("#pfName") : $("#pfCode")).focus(), 30);
}
function closeProductModal() {
  $("#productModal").classList.add("hidden");
  focusScanner();
}
$$("[data-close-product]").forEach(b => b.addEventListener("click", closeProductModal));
$("#productModal").addEventListener("click", (e) => { if (e.target.id === "productModal") closeProductModal(); });
$("#pfCode").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#pfName").focus(); } });
$("#productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#productFormError");
  const code = $("#pfCode").value.trim(), name = $("#pfName").value.trim();
  const price = parseMoney($("#pfPrice").value);
  const stock = Number($("#pfStock").value || 0);
  if (!name) { err.textContent = "Informe o nome do produto."; return; }
  if (!Number.isFinite(price) || price < 0) { err.textContent = "Informe um preço válido (ex.: 9,90)."; return; }
  if (!Number.isInteger(stock) || stock < 0) { err.textContent = "O estoque deve ser um número inteiro."; return; }
  if (code && currentCompany.products.some(p => String(p.code || "").trim() === code)) { err.textContent = "Já existe um produto com este código."; return; }
  const product = { id: crypto.randomUUID(), name, category: $("#pfCategory").value, code, price, stock, emoji: "📦" };
  currentCompany.products.push(product);
  try { await persist(); } catch (ex) { console.error(ex); err.textContent = "Não foi possível salvar o produto."; return; }
  renderInventory(); renderProducts();
  $("#productModal").classList.add("hidden");
  if (productModalFromScanner) {
    hideScanAlert(); addToCart(product.id); beep(true);
    toast(`${name} cadastrado e adicionado à venda.`);
  } else {
    toast("Produto cadastrado.");
  }
  focusScanner();
});

// ---------- Finalização de venda: pagamento, troco e impressão ----------
const selectedPay = () => $("input[name=payMethod]:checked")?.value || "Dinheiro";
const cartTotal = () => cart.reduce((sum, line) => {
  const p = currentCompany.products.find(x => x.id === line.id);
  return sum + (p ? p.price * line.qty : 0);
}, 0);
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
  $('input[name=payMethod][value="Dinheiro"]').checked = true;
  updateChange();
  $("#checkoutModal").classList.remove("hidden");
  setTimeout(() => $("#cashReceived").focus(), 30);
}
function closeCheckout() {
  $("#checkoutModal").classList.add("hidden");
  focusScanner();
}
$$("[data-close-checkout]").forEach(b => b.addEventListener("click", closeCheckout));
$("#checkoutModal").addEventListener("click", (e) => { if (e.target.id === "checkoutModal") closeCheckout(); });
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
  const total = items.reduce((s, x) => s + x.price * x.qty, 0);
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
    const sale = { id: crypto.randomUUID(), number: currentCompany.saleSeq, createdAt: now(), items, total, payment, received, change };
    currentCompany.sales.push(sale);
    await persist();
    cart = []; renderProducts(); renderInventory(); updateCart();
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
$("#reprintBtn").addEventListener("click", () => {
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
    await persist();
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
    trialEndsAt: srv.trialEndsAt, mustChangePassword: Boolean(srv.mustChangePassword)
  };
  company.trialEndsAt = srv.trialEndsAt;
}
async function upsertLocalCompany(srv, passwordHash) {
  let company = await getCompany(srv.id);
  company ||= newLocalCompany({ empresa_id: srv.id, storeName: srv.storeName, email: srv.email, passwordHash });
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
    return { company: await upsertLocalCompany(r.data.store, passwordHash) };
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
function stopHeartbeat() { clearInterval(heartbeatTimer); heartbeatTimer = null; }
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

// ---------- Planos (página inicial) ----------
$$(".plan-btn").forEach(b => b.addEventListener("click", () => showModal("register")));

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
$("#masterLoginModal").addEventListener("click", (e) => { if (e.target.id === "masterLoginModal") closeMasterLogin(); });
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
  list.forEach(s => { if (s.plan) { const sel = $(`[data-plan-for="${s.id}"]`); if (sel) sel.value = s.plan; } });
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
  if (!$("#masterLoginModal").classList.contains("hidden")) closeMasterLogin();
  else if (!$("#masterView").classList.contains("hidden")) closeMasterView();
});

window.addEventListener("offline", () => { if (currentCompany) { setConnection(false); toast("Você está offline. O caixa continua funcionando neste aparelho."); } });
loadSession().catch(console.error);
