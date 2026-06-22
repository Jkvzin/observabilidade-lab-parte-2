let isLoginMode = true;
let currentUser = null;
let currentUserId = null;
const SESSION_KEY = 'o11ylab_session';
const SESSION_EXPIRY_MS = 30 * 60 * 1000;

// Restaurar sessao
(function restoreSession() {
    try {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
        if (saved && saved.username && saved.userId && saved.expiresAt && Date.now() < saved.expiresAt) {
            currentUser = saved.username;
            currentUserId = saved.userId;
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
                localStorage.setItem(SESSION_KEY, JSON.stringify({ username: currentUser, userId: currentUserId, expiresAt: Date.now() + SESSION_EXPIRY_MS }));
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
    currentUser = null; currentUserId = null; localStorage.removeItem(SESSION_KEY);
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
        const res = await fetch('/api/produtos');
        const produtos = await res.json();
        const grid = document.getElementById('catalog-grid');
        grid.innerHTML = produtos.map(p => `
            <div class="product-card glass-panel">
                <div class="product-image">${p.imagem || '📦'}</div>
                <div class="product-info">
                    <span class="product-category">${p.categoria || ''}</span>
                    <h3>${escapeHtml(p.nome)}</h3>
                    <div class="product-price">R$ ${p.preco.toFixed(2)}</div>
                    <div class="product-stock ${p.estoque === 0 ? 'out' : p.estoque < 5 ? 'low' : ''}">
                        ${p.estoque === 0 ? 'Esgotado' : `Em estoque: ${p.estoque}`}
                    </div>
                </div>
                <button class="btn-primary btn-add-cart" ${p.estoque === 0 ? 'disabled' : ''}
                    onclick="addToCart(${p.id})">
                    ${p.estoque === 0 ? 'Indisponivel' : 'Adicionar ao Carrinho'}
                </button>
            </div>
        `).join('');
    } catch (err) { showToast('Erro ao carregar catalogo', 'error'); }
}

// Busca
document.getElementById('search-input').addEventListener('input', async function() {
    const q = this.value.trim();
    try {
        const res = await fetch(`/api/produtos${q ? '?q=' + encodeURIComponent(q) : ''}`);
        const produtos = await res.json();
        const grid = document.getElementById('catalog-grid');
        grid.innerHTML = produtos.map(p => `
            <div class="product-card glass-panel">
                <div class="product-image">${p.imagem || '📦'}</div>
                <div class="product-info">
                    <span class="product-category">${p.categoria || ''}</span>
                    <h3>${escapeHtml(p.nome)}</h3>
                    <div class="product-price">R$ ${p.preco.toFixed(2)}</div>
                    <div class="product-stock ${p.estoque === 0 ? 'out' : p.estoque < 5 ? 'low' : ''}">
                        ${p.estoque === 0 ? 'Esgotado' : `Em estoque: ${p.estoque}`}
                    </div>
                </div>
                <button class="btn-primary btn-add-cart" ${p.estoque === 0 ? 'disabled' : ''}
                    onclick="addToCart(${p.id})">
                    ${p.estoque === 0 ? 'Indisponivel' : 'Adicionar ao Carrinho'}
                </button>
            </div>
        `).join('');
    } catch (err) { /* silencioso */ }
});

async function addToCart(produtoId) {
    try {
        const res = await fetch('/api/carrinho', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: String(currentUserId), produtoId, quantidade: 1 })
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
        const res = await fetch(`/api/carrinho/${currentUserId}`);
        const cart = await res.json();
        const items = cart.items || [];
        const cartItems = document.getElementById('cart-items');
        const cartEmpty = document.getElementById('cart-empty');
        const cartSummary = document.getElementById('cart-summary');
        const badge = document.getElementById('cart-badge');
        const tabCount = document.getElementById('tab-cart-count');

        const totalItems = items.reduce((s, i) => s + i.quantidade, 0);
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
                <div class="cart-item-img">${item.imagem || '📦'}</div>
                <div class="cart-item-info">
                    <strong>${escapeHtml(item.nome)}</strong>
                    <span>R$ ${item.preco.toFixed(2)} x ${item.quantidade}</span>
                    <span class="cart-item-subtotal">Subtotal: R$ ${(item.preco * item.quantidade).toFixed(2)}</span>
                </div>
                <div class="cart-item-actions">
                    <button class="btn-sm btn-danger" onclick="removerDoCarrinho(${item.produtoId})" title="Remover">✕</button>
                </div>
            </div>
        `).join('');
    } catch (err) { /* silencioso */ }
}

async function removerDoCarrinho(produtoId) {
    try {
        await fetch(`/api/carrinho/${currentUserId}/${produtoId}`, { method: 'DELETE' });
        showToast('Item removido', 'info');
        loadCarrinho();
    } catch (err) { showToast('Erro ao remover', 'error'); }
}

async function finalizarCompra() {
    try {
        const res = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: String(currentUserId) })
        });
        const data = await res.json();
        if (res.ok) {
            const pedido = data.pedido;
            showToast(`Pedido #${pedido.id} criado! Total: R$ ${pedido.total.toFixed(2)}`, 'success');
            loadCarrinho();
            loadPedidos();
            loadCatalogo(); // atualiza estoque
        } else {
            showToast(data.error || 'Erro no checkout', 'error');
        }
    } catch (err) { showToast('Erro de conexao', 'error'); }
}

// ==================== PEDIDOS ====================

async function loadPedidos() {
    try {
        const res = await fetch(`/api/pedidos?userId=${currentUserId}`);
        const pedidos = await res.json();
        const list = document.getElementById('pedidos-list');
        const empty = document.getElementById('pedidos-empty');

        if (pedidos.length === 0) {
            list.innerHTML = ''; empty.style.display = 'block'; return;
        }
        empty.style.display = 'none';

        const statusLabels = { pendente: '⏳ Pendente', pago: '✅ Pago', pagamento_falhou: '❌ Falhou', enviado: '🚚 Enviado', entregue: '📬 Entregue', cancelado: '🗑️ Cancelado' };
        const statusColors = { pendente: 'status-yellow', pago: 'status-green', pagamento_falhou: 'status-red', enviado: 'status-blue', entregue: 'status-purple', cancelado: 'status-red' };

        list.innerHTML = pedidos.reverse().map(p => `
            <div class="pedido-card glass-panel">
                <div class="pedido-header">
                    <span class="pedido-id">Pedido #${p.id}</span>
                    <span class="pedido-status badge ${statusColors[p.status] || ''}">${statusLabels[p.status] || p.status}</span>
                    <span class="pedido-date">${new Date(p.criadoEm).toLocaleString('pt-BR')}</span>
                </div>
                <div class="pedido-items">
                    ${p.itens.map(i => `<span class="pedido-item">${i.quantidade}x ${escapeHtml(i.nome)}</span>`).join('')}
                </div>
                <div class="pedido-total">Total: <strong>R$ ${p.total.toFixed(2)}</strong></div>
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
            if (data.total) logBox.innerHTML += `<p>Req: ${data.total} | Erros: <span style="color:var(--danger)">${data.erros || 0}</span></p>`;
            if (data.erros400 !== undefined) logBox.innerHTML += `<p>Erros 400: ${data.erros400}</p>`;
            if (data.sucessos !== undefined) logBox.innerHTML += `<p>Sucessos: ${data.sucessos} | Falhas: ${data.falhas}</p>`;
            if (data.log) data.log.forEach(e => logBox.innerHTML += `<p style="color:${e.status >= 400 ? 'var(--danger)' : 'var(--success)'}">→ ${e.etapa}: ${e.status}${e.ok !== undefined ? (e.ok ? ' ✓' : ' ✗') : ''}</p>`);
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
