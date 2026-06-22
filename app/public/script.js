let isLoginMode = true;
let currentUser = null;
let currentUserId = null;
let authToken = null;
const SESSION_KEY = 'o11ylab_session';
const SESSION_EXPIRY_MS = 30 * 60 * 1000;

// Restaurar sessao
(function restoreSession() {
    try {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
        if (saved && saved.username && saved.userId && saved.token && saved.expiresAt && Date.now() < saved.expiresAt) {
            currentUser = saved.username;
            currentUserId = saved.userId;
            authToken = saved.token;
            showStore();
        }
    } catch (e) { localStorage.removeItem(SESSION_KEY); }
})();

// DOM
const loginView = document.getElementById('login-view');
const storeView = document.getElementById('store-view');
const authForm = document.getElementById('auth-form');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const logoutBtn = document.getElementById('logout-btn');
const currentUserDisplay = document.getElementById('current-user-display');
const toastContainer = document.getElementById('toast-container');

// Auth header helper
function authHeaders() {
    return authToken ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` } : { 'Content-Type': 'application/json' };
}

// Tabs auth
tabLogin.addEventListener('click', () => { isLoginMode = true; tabLogin.classList.add('active'); tabRegister.classList.remove('active'); authSubmitBtn.innerText = 'Entrar na Loja'; });
tabRegister.addEventListener('click', () => { isLoginMode = false; tabRegister.classList.add('active'); tabLogin.classList.remove('active'); authSubmitBtn.innerText = 'Criar Conta'; });

// Auth submit
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const endpoint = isLoginMode ? '/login' : '/register';
    try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await res.json();
        if (res.ok) {
            if (isLoginMode) {
                currentUser = data.username || username;
                currentUserId = data.userId;
                authToken = data.token;
                localStorage.setItem(SESSION_KEY, JSON.stringify({ username: currentUser, userId: currentUserId, token: authToken, expiresAt: Date.now() + SESSION_EXPIRY_MS }));
                showStore();
                showToast('Login efetuado!', 'success');
            } else {
                showToast('Conta criada! Faca login.', 'success');
                tabLogin.click();
                document.getElementById('password').value = '';
            }
        } else { showToast(data.error || 'Erro', 'error'); }
    } catch (err) { showToast('Erro de conexao', 'error'); }
});

function showStore() {
    loginView.classList.remove('active');
    setTimeout(() => { loginView.style.display = 'none'; storeView.style.display = 'flex'; setTimeout(() => storeView.classList.add('active'), 50); }, 400);
    currentUserDisplay.innerText = currentUser;
    loadCatalogo();
    loadCarrinho();
    loadPedidos();
}

logoutBtn.addEventListener('click', () => {
    currentUser = null; currentUserId = null; authToken = null; localStorage.removeItem(SESSION_KEY);
    storeView.classList.remove('active');
    setTimeout(() => { storeView.style.display = 'none'; loginView.style.display = 'flex'; setTimeout(() => loginView.classList.add('active'), 50); }, 400);
    document.getElementById('username').value = ''; document.getElementById('password').value = '';
});

// ==================== STORE TABS ====================

document.querySelectorAll('.store-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tabName) {
    document.querySelectorAll('.store-tab').forEach(b => b.classList.remove('active'));
    document.querySelector(`.store-tab[data-tab="${tabName}"]`).classList.add('active');
    document.querySelectorAll('.store-section').forEach(s => s.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if (tabName === 'catalogo') loadCatalogo();
    if (tabName === 'carrinho') loadCarrinho();
    if (tabName === 'pedidos') loadPedidos();
}

// ==================== CATÁLOGO ====================

async function loadCatalogo() {
    try {
        const res = await fetch('/products');
        const produtos = await res.json();
        const grid = document.getElementById('catalog-grid');
        grid.innerHTML = produtos.map(p => `
            <div class="product-card glass-panel">
                <div class="product-image">📦</div>
                <div class="product-info">
                    <span class="product-category">${p.category || ''}</span>
                    <h3>${escapeHtml(p.name)}</h3>
                    <div class="product-price">R$ ${p.price.toFixed(2)}</div>
                    <div class="product-stock ${p.stock === 0 ? 'out' : p.stock < 5 ? 'low' : ''}">
                        ${p.stock === 0 ? 'Esgotado' : `Em estoque: ${p.stock}`}
                    </div>
                </div>
                <button class="btn-primary btn-add-cart" ${p.stock === 0 ? 'disabled' : ''}
                    onclick="addToCart(${p.id})">
                    ${p.stock === 0 ? 'Indisponivel' : 'Adicionar ao Carrinho'}
                </button>
            </div>
        `).join('');
    } catch (err) { showToast('Erro ao carregar catalogo', 'error'); }
}

// Busca (usa query param category no PR #27, adaptado para busca textual)
document.getElementById('search-input').addEventListener('input', async function() {
    const q = this.value.trim().toLowerCase();
    try {
        const res = await fetch('/products');
        const produtos = await res.json();
        const filtered = q ? produtos.filter(p => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)) : produtos;
        const grid = document.getElementById('catalog-grid');
        grid.innerHTML = filtered.map(p => `
            <div class="product-card glass-panel">
                <div class="product-image">📦</div>
                <div class="product-info">
                    <span class="product-category">${p.category || ''}</span>
                    <h3>${escapeHtml(p.name)}</h3>
                    <div class="product-price">R$ ${p.price.toFixed(2)}</div>
                    <div class="product-stock ${p.stock === 0 ? 'out' : p.stock < 5 ? 'low' : ''}">
                        ${p.stock === 0 ? 'Esgotado' : `Em estoque: ${p.stock}`}
                    </div>
                </div>
                <button class="btn-primary btn-add-cart" ${p.stock === 0 ? 'disabled' : ''}
                    onclick="addToCart(${p.id})">
                    ${p.stock === 0 ? 'Indisponivel' : 'Adicionar ao Carrinho'}
                </button>
            </div>
        `).join('');
    } catch (err) { /* silencioso */ }
});

async function addToCart(productId) {
    try {
        const res = await fetch('/cart', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ productId, quantity: 1 })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Adicionado ao carrinho!', 'success');
            loadCarrinho();
        } else {
            showToast(data.error || 'Erro ao adicionar', 'error');
        }
    } catch (err) { showToast('Erro de conexao', 'error'); }
}

// ==================== CARRINHO ====================

async function loadCarrinho() {
    try {
        const res = await fetch('/cart', { headers: authHeaders() });
        const cart = await res.json();
        const items = cart.items || [];
        const cartItems = document.getElementById('cart-items');
        const cartEmpty = document.getElementById('cart-empty');
        const cartSummary = document.getElementById('cart-summary');
        const badge = document.getElementById('cart-badge');
        const tabCount = document.getElementById('tab-cart-count');

        const totalItems = items.reduce((s, i) => s + i.quantity, 0);
        if (totalItems > 0) {
            badge.style.display = 'inline'; badge.innerText = totalItems;
            tabCount.innerText = `(${totalItems})`;
        } else {
            badge.style.display = 'none';
            tabCount.innerText = '';
        }

        if (items.length === 0) {
            cartItems.innerHTML = '';
            cartEmpty.style.display = 'block';
            cartSummary.style.display = 'none';
            return;
        }

        cartEmpty.style.display = 'none';
        cartSummary.style.display = 'flex';
        document.getElementById('cart-total-value').innerText = `R$ ${cart.total.toFixed(2)}`;

        cartItems.innerHTML = items.map(item => `
            <div class="cart-item glass-panel">
                <div class="cart-item-img">📦</div>
                <div class="cart-item-info">
                    <strong>${escapeHtml(item.name)}</strong>
                    <span>R$ ${item.price.toFixed(2)} x ${item.quantity}</span>
                    <span class="cart-item-subtotal">Subtotal: R$ ${(item.subtotal || item.price * item.quantity).toFixed(2)}</span>
                </div>
                <div class="cart-item-actions">
                    <button class="btn-sm btn-danger" onclick="removerDoCarrinho(${item.productId})" title="Remover">✕</button>
                </div>
            </div>
        `).join('');
    } catch (err) { /* silencioso */ }
}

async function removerDoCarrinho(productId) {
    try {
        await fetch(`/cart/${productId}`, { method: 'DELETE', headers: authHeaders() });
        showToast('Item removido', 'info');
        loadCarrinho();
    } catch (err) { showToast('Erro ao remover', 'error'); }
}

async function finalizarCompra() {
    try {
        const res = await fetch('/checkout', {
            method: 'POST',
            headers: authHeaders()
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Pedido #${data.orderId} criado! Total: R$ ${data.totalValue ? data.totalValue.toFixed(2) : '?'}`, 'success');
            loadCarrinho();
            loadPedidos();
            loadCatalogo();
        } else {
            showToast(data.error || 'Erro no checkout', 'error');
        }
    } catch (err) { showToast('Erro de conexao', 'error'); }
}

// ==================== PEDIDOS ====================

async function loadPedidos() {
    try {
        const res = await fetch('/orders', { headers: authHeaders() });
        const pedidos = await res.json();
        const list = document.getElementById('pedidos-list');
        const empty = document.getElementById('pedidos-empty');

        if (!Array.isArray(pedidos) || pedidos.length === 0) {
            list.innerHTML = ''; empty.style.display = 'block'; return;
        }
        empty.style.display = 'none';

        const statusLabels = { pending: '⏳ Pendente', paid: '✅ Pago', cancelled: '🗑️ Cancelado' };
        const statusColors = { pending: 'status-yellow', paid: 'status-green', cancelled: 'status-red' };

        list.innerHTML = [...pedidos].reverse().map(p => `
            <div class="pedido-card glass-panel">
                <div class="pedido-header">
                    <span class="pedido-id">Pedido #${p.id}</span>
                    <span class="pedido-status badge ${statusColors[p.status] || ''}">${statusLabels[p.status] || p.status}</span>
                    <span class="pedido-date">${new Date(p.createdAt).toLocaleString('pt-BR')}</span>
                </div>
                <div class="pedido-items">
                    ${(p.items || []).map(i => `<span class="pedido-item">${i.quantity}x ${escapeHtml(i.name)}</span>`).join('')}
                </div>
                <div class="pedido-total">Total: <strong>R$ ${(p.totalValue || 0).toFixed(2)}</strong></div>
            </div>
        `).join('');
    } catch (err) { /* silencioso */ }
}

// ==================== INCIDENTES ====================

async function triggerIncident(type) {
    showToast(`Incidente: ${type}...`, 'info');
    try {
        const res = await fetch(`/incidente-${type}`);
        const data = await res.json();
        showToast(data.message || 'Executado', res.ok ? 'warning' : 'error');
    } catch (err) { showToast('Timeout (esperado)', 'error'); }
}

async function simularEcommerce(tipo) {
    const logBox = document.getElementById('ecommerce-log');
    const nomes = { 'black-friday': 'Black Friday', 'estoque-esgotado': 'Estoque Esgotado', 'falha-pagamento': 'Falha Pagamento', 'fluxo-completo': 'Fluxo Completo' };
    const nome = nomes[tipo] || tipo;
    logBox.innerHTML = `<p style="color:var(--accent)">Executando: ${nome}...</p>`;
    showToast(`Disparando ${nome}...`, 'info');
    try {
        const res = await fetch(`/simular/${tipo}`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            logBox.innerHTML += `<p style="color:var(--success)">${data.message}</p>`;
            if (data.results && !Array.isArray(data.results)) {
                for (const [key, val] of Object.entries(data.results)) {
                    logBox.innerHTML += `<p>${key}: <span style="color:${key === 'errors' ? 'var(--danger)' : 'var(--success)'}">${val}</span></p>`;
                }
            }
            if (Array.isArray(data.results) && data.results.length > 0) {
                if (data.results[0].success !== undefined) {
                    const s = data.results.filter(r => r.success).length;
                    const f = data.results.filter(r => !r.success).length;
                    logBox.innerHTML += `<p>Sucessos: <span style="color:var(--success)">${s}</span> | Falhas: <span style="color:var(--danger)">${f}</span></p>`;
                }
                logBox.innerHTML += '<p style="margin-top:0.5rem"><strong>Tentativas:</strong></p>';
                data.results.slice(0, 10).forEach(r => {
                    logBox.innerHTML += `<p style="color:${r.success !== false ? 'var(--success)' : 'var(--danger)'}">  → #${r.attempt}: ${r.status || r.error || 'OK'}</p>`;
                });
            }
            if (data.flow) {
                logBox.innerHTML += '<p style="margin-top:0.5rem"><strong>Fluxo:</strong></p>';
                data.flow.forEach(step => {
                    logBox.innerHTML += `<p style="color:var(--success)">  → ${step.step || '?'}: ${step.status || step.username || step.orderId || ''}</p>`;
                });
            }
            showToast(`${nome} concluida!`, 'success');
        } else { logBox.innerHTML += `<p style="color:var(--danger)">${data.error}</p>`; }
    } catch (err) { logBox.innerHTML += `<p style="color:var(--danger)">Erro: ${err.message}</p>`; }
    logBox.scrollTop = logBox.scrollHeight;
}

// ==================== HELPERS ====================

function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`; toast.innerText = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
