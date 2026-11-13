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
function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem("nexus_theme", theme);
  $$("[data-theme-choice]").forEach(b => b.classList.toggle("active", b.dataset.themeChoice === theme));
}
$$("[data-theme-choice]").forEach(b => b.addEventListener("click", () => setTheme(b.dataset.themeChoice)));
setTheme(localStorage.getItem("nexus_theme") || "dark");

function showModal(mode) {
  authMode = mode;
  $("#authModal").classList.remove("hidden");
  $("#authError").textContent = "";
  $("#companyName").classList.toggle("hidden", mode === "login");
  $("#companyLabel").classList.toggle("hidden", mode === "login");
  $("#modalTitle").textContent = mode === "login" ? "Acesse sua loja." : "Crie sua loja.";
  $("#modalDescription").textContent = mode === "login" ? "Entre com os dados do seu estabelecimento." : "Sua demonstração fica pronta em instantes.";
  $("#authSubmit").textContent = mode === "login" ? "Entrar na minha loja →" : "Criar conta e começar →";
  $("#modalSwitch").innerHTML = mode === "login" ? 'Ainda não tem conta? <button id="switchAuthMode">Criar conta grátis</button>' : 'Já tem uma conta? <button id="switchAuthMode">Entrar</button>';
  $("#switchAuthMode").addEventListener("click", () => showModal(mode === "login" ? "register" : "login"));
}
function closeModal() { $("#authModal").classList.add("hidden"); }
$("#openLogin").addEventListener("click", () => showModal("login"));
["openTrial","heroTrial","howTrial","planTrial"].forEach(id => $("#"+id).addEventListener("click", () => showModal("register")));
$$("[data-close-modal]").forEach(b => b.addEventListener("click", closeModal));
$("#authModal").addEventListener("click", e => { if (e.target.id === "authModal") closeModal(); });

function makeCompanyId() { return "emp_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16); }
async function hashDemoPassword(password) {
  // Hash local apenas para reduzir exposição casual; não substitui autenticação segura no backend.
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#emailInput").value.trim().toLowerCase();
  const password = $("#passwordInput").value;
  const passwordHash = await hashDemoPassword(password);
  try {
    if (authMode === "register") {
      const existing = await findCompanyByEmail(email);
      if (existing) { $("#authError").textContent = "Este e-mail já possui uma loja neste navegador. Entre na conta."; return; }
      const startedAt = now();
      currentCompany = {
        empresa_id: makeCompanyId(), storeName: $("#companyName").value.trim(), email, passwordHash,
        createdAt: startedAt, trialEndsAt: startedAt + TRIAL_MS, trialDismissedAt: 0,
        products: structuredClone(DEMO_PRODUCTS), sales: [], security: { enabled: false, passwordHash: "" }
      };
      await saveCompany(currentCompany);
    } else {
      currentCompany = await findCompanyByEmail(email);
      if (!currentCompany || currentCompany.passwordHash !== passwordHash) {
        $("#authError").textContent = "E-mail ou senha não conferem neste dispositivo."; return;
      }
    }
    sessionStorage.setItem("nexus_current_company", currentCompany.empresa_id);
    closeModal(); enterApp();
  } catch (err) { console.error(err); $("#authError").textContent = "Não foi possível salvar os dados. Verifique se o navegador permite armazenamento local."; }
});

async function loadSession() {
  const id = sessionStorage.getItem("nexus_current_company");
  if (!id) return;
  const company = await getCompany(id);
  if (company) { currentCompany = company; enterApp(); }
}
function persist() { return saveCompany(currentCompany); }
function enterApp() {
  $("#landingView").classList.add("hidden"); $("#appView").classList.remove("hidden");
  $("#storeNameSide").textContent = currentCompany.storeName;
  renderProducts(); renderInventory(); updateCart(); renderTrialBanner();
  showPanel("pos");
}
function exitApp() {
  sessionStorage.removeItem("nexus_current_company"); currentCompany = null; cart = [];
  $("#appView").classList.add("hidden"); $("#landingView").classList.remove("hidden");
  $("#trialBanner").classList.add("hidden");
}
$("#logoutBtn").addEventListener("click", exitApp);

function renderTrialBanner() {
  const banner = $("#trialBanner");
  if (!currentCompany) { banner.classList.add("hidden"); return; }
  const remaining = currentCompany.trialEndsAt - now();
  if (remaining <= 0) { banner.classList.remove("hidden"); $("#daysRemaining").textContent = "0"; banner.querySelector("span").innerHTML = "⚠️ Seu período de teste terminou. Escolha um plano para continuar."; return; }
  const hiddenAt = Number(localStorage.getItem(`nexus_banner_hidden_${currentCompany.empresa_id}`) || 0);
  if (now() - hiddenAt < HIDE_MS) { banner.classList.add("hidden"); return; }
  const days = Math.max(1, Math.ceil(remaining / (24*60*60*1000)));
  $("#daysRemaining").textContent = days;
  banner.querySelector("span").innerHTML = `⚠️ Você está no Teste Grátis: <strong id="daysRemaining">${days}</strong> dias restantes.`;
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

$("#secretDot").addEventListener("click", () => $("#secretPanel").classList.toggle("hidden"));
$("#closeSecret").addEventListener("click", () => $("#secretPanel").classList.add("hidden"));
$("#clientCount").textContent = (1240 + Math.floor(Math.random()*90)).toLocaleString("pt-BR");

// ==========================================================================
// [NEXUS HW] Periféricos de balcão: leitor de código de barras USB e impressora térmica
// ==========================================================================
const HW_DEFAULTS = { paperWidth: "80", storeName: "", document: "", contact: "", footer: "Obrigado pela preferência!\nNão é documento fiscal." };
function getHardware() {
  return { ...HW_DEFAULTS, storeName: currentCompany?.storeName || "", ...(currentCompany?.hardware || {}) };
}
const isModalOpen = () => $$(".modal-backdrop").some(m => !m.classList.contains("hidden"));
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

window.addEventListener("online", () => toast("Conexão detectada. Os dados continuam salvos localmente."));
window.addEventListener("offline", () => toast("Você está offline. O modo local continua disponível."));
loadSession().catch(console.error);
