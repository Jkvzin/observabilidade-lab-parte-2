let isLoginMode = true;
let currentUser = null;
let authToken = null;
const SESSION_KEY = 'o11ylab_session';
const SESSION_EXPIRY_MS = 30 * 60 * 1000;

(function restoreSession() {
    try {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
        if (saved && saved.username && saved.token && saved.expiresAt && Date.now() < saved.expiresAt) {
            currentUser = saved.username;
            authToken = saved.token;
            showDashboard();
        }
    } catch (e) {
        localStorage.removeItem(SESSION_KEY);
    }
})();

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const authForm = document.getElementById('auth-form');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const logoutBtn = document.getElementById('logout-btn');
const currentUserDisplay = document.getElementById('current-user-display');
const toastContainer = document.getElementById('toast-container');

tabLogin.addEventListener('click', () => {
    isLoginMode = true;
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    authSubmitBtn.innerText = 'Entrar na Loja';
});

tabRegister.addEventListener('click', () => {
    isLoginMode = false;
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    authSubmitBtn.innerText = 'Criar Conta';
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const endpoint = isLoginMode ? '/login' : '/register';
    
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        if (res.ok) {
            if (isLoginMode) {
                currentUser = username;
                authToken = data.token;
                localStorage.setItem(SESSION_KEY, JSON.stringify({
                    username, token: authToken, expiresAt: Date.now() + SESSION_EXPIRY_MS
                }));
                showDashboard();
                showToast('Login efetuado!', 'success');
            } else {
                showToast('Conta criada! Voce ja pode logar.', 'success');
                tabLogin.click();
                document.getElementById('password').value = '';
            }
        } else {
            showToast(data.error || 'Erro na autenticacao', 'error');
        }
    } catch (err) {
        showToast('Erro de conexao com a API', 'error');
    }
});

function showDashboard() {
    loginView.classList.remove('active');
    setTimeout(() => {
        loginView.style.display = 'none';
        dashboardView.style.display = 'flex';
        setTimeout(() => dashboardView.classList.add('active'), 50);
    }, 400);
    currentUserDisplay.innerText = currentUser;
    loadCatalog();
    loadCart();
    loadOrders();
    updateStats();
    checkHealth();
}

logoutBtn.addEventListener('click', () => {
    currentUser = null;
    authToken = null;
    localStorage.removeItem(SESSION_KEY);
    dashboardView.classList.remove('active');
    setTimeout(() => {
        dashboardView.style.display = 'none';
        loginView.style.display = 'flex';
        setTimeout(() => loginView.classList.add('active'), 50);
    }, 400);
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
});

// ==================== CATALOGO ====================

async function loadCatalog(category) {
    const grid = document.getElementById('catalog-grid');
    try {
        const url = category ? `/products?category=${encodeURIComponent(category)}` : '/products';
        const res = await fetch(url);
        const products = await res.json();
        
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        if (category) {
            Array.from(document.querySelectorAll('.cat-btn')).find(b => b.textContent === category)?.classList.add('active');
        } else {
            document.querySelector('.cat-btn').classList.add('active');
        }

        grid.innerHTML = products.map(p => `
            <div class="product-card">
                <div class="product-category">${escapeHtml(p.category)}</div>
                <div class="product-name">${escapeHtml(p.name)}</div>
                <div class="product-desc">${escapeHtml(p.description || '')}</div>
                <div class="product-price">R$ ${p.price.toFixed(2)}</div>
                <div class="product-stock ${p.stock < 5 ? 'low' : ''}">${p.stock} em estoque</div>
                <div class="product-actions">
                    <input type="number" class="qty-input" id="qty-${p.id}" value="1" min="1" max="${p.stock}">
                    <button onclick="addToCart(${p.id})" class="btn-success" ${p.stock === 0 ? 'disabled' : ''}>
                        ${p.stock === 0 ? 'Esgotado' : 'Comprar'}
                    </button>
                </div>
            </div>
        `).join('');
        
        document.getElementById('stat-products').innerText = products.length;
    } catch (err) {
        showToast('Erro ao carregar catalogo', 'error');
    }
}

// ==================== CARRINHO ====================

async function addToCart(productId) {
    const qtyInput = document.getElementById(`qty-${productId}`);
    const quantity = parseInt(qtyInput?.value || 1);
    
    try {
        const res = await fetch('/cart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ productId, quantity })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Adicionado ao carrinho!', 'success');
            loadCart();
        } else {
            showToast(data.error || 'Erro ao adicionar', 'error');
        }
    } catch (err) {
        showToast('Erro de conexao', 'error');
    }
}

async function loadCart() {
    const container = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total');
    const badge = document.getElementById('cart-count-badge');
    
    try {
        const res = await fetch('/cart', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) { container.innerHTML = '<p class="empty-cart">Faca login para ver o carrinho</p>'; return; }
        
        const data = await res.json();
        if (!data.items || data.items.length === 0) {
            container.innerHTML = '<p class="empty-cart">Seu carrinho esta vazio</p>';
            totalEl.style.display = 'none';
            badge.innerText = '0';
            return;
        }
        
        badge.innerText = data.items.length;
        container.innerHTML = data.items.map(item => `
            <div class="cart-item">
                <span class="cart-item-name">${escapeHtml(item.name)}</span>
                <span class="cart-item-qty">x${item.quantity}</span>
                <span class="cart-item-subtotal">R$ ${item.subtotal.toFixed(2)}</span>
                <button class="cart-item-remove" onclick="removeFromCart(${item.productId})">x</button>
            </div>
        `).join('');
        
        document.getElementById('cart-total-value').innerText = `R$ ${data.total.toFixed(2)}`;
        totalEl.style.display = 'flex';
    } catch (err) {
        container.innerHTML = '<p class="empty-cart">Erro ao carregar carrinho</p>';
    }
}

async function removeFromCart(productId) {
    try {
        await fetch(`/cart/${productId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        loadCart();
        showToast('Item removido', 'info');
    } catch (err) {
        showToast('Erro ao remover', 'error');
    }
}

// ==================== CHECKOUT ====================

async function checkout() {
    try {
        const res = await fetch('/checkout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Pedido #${data.orderId} criado! Total: R$ ${data.totalValue.toFixed(2)}`, 'success');
            loadCart();
            loadOrders();
            updateStats();
        } else {
            showToast(data.error || 'Erro no checkout', 'error');
        }
    } catch (err) {
        showToast('Erro de conexao', 'error');
    }
}

// ==================== PEDIDOS ====================

async function loadOrders() {
    const container = document.getElementById('orders-list');
    
    try {
        const res = await fetch('/orders', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) { container.innerHTML = '<p class="empty-cart">Faca login para ver pedidos</p>'; return; }
        
        const orders = await res.json();
        if (!orders || orders.length === 0) {
            container.innerHTML = '<p class="empty-cart">Nenhum pedido ainda</p>';
            document.getElementById('stat-orders').innerText = '0';
            return;
        }
        
        document.getElementById('stat-orders').innerText = orders.length;
        const statusNames = { pending: 'Pendente', paid: 'Pago', shipped: 'Enviado', delivered: 'Entregue', cancelled: 'Cancelado' };
        
        container.innerHTML = orders.map(o => `
            <div class="order-card">
                <div class="order-header">
                    <span class="order-id">Pedido #${o.id}</span>
                    <span class="status-badge status-${o.status}">${statusNames[o.status] || o.status}</span>
                </div>
                <div class="order-items-list">
                    ${(o.items || []).map(i => `${i.name} x${i.quantity} — R$ ${i.subtotal.toFixed(2)}`).join('<br>')}
                </div>
                <div style="margin-top:0.3rem;font-weight:600">Total: R$ ${o.totalValue.toFixed(2)}</div>
                ${o.status === 'pending' ? `<button onclick="payOrder(${o.id})" class="btn-success" style="margin-top:0.5rem;font-size:0.75rem">Pagar Agora</button>` : ''}
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<p class="empty-cart">Erro ao carregar pedidos</p>';
    }
}

async function payOrder(orderId) {
    try {
        const res = await fetch(`/orders/${orderId}/pay`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Pagamento aprovado!', 'success');
        } else {
            showToast(data.error || 'Pagamento recusado', 'error');
        }
        loadOrders();
        updateStats();
    } catch (err) {
        showToast('Erro ao processar pagamento', 'error');
    }
}

// ==================== INCIDENTES ====================

async function triggerIncident(type) {
    showToast(`Disparando incidente: ${type}...`, 'info');
    try {
        const res = await fetch(`/incidente-${type}`);
        const data = await res.json();
        showToast(data.message || 'Incidente executado', 'warning');
    } catch (err) {
        showToast('Incidente disparado (sem resposta)', 'error');
    }
    updateStats();
}

// ==================== SIMULACOES ECOMMERCE ====================

async function simularEcommerce(tipo) {
    const logBox = document.getElementById('simulation-log');
    const nomes = {
        'black-friday': 'Black Friday',
        'estoque-esgotado': 'Estoque Esgotado',
        'falha-pagamento': 'Falha de Pagamento',
        'fluxo-completo': 'Fluxo Completo'
    };
    const nome = nomes[tipo] || tipo;
    
    logBox.innerHTML = `<p style="color:var(--info)">Executando: ${nome}...</p>`;
    showToast(`Disparando ${nome}...`, 'info');
    
    try {
        const res = await fetch(`/simular/${tipo}`, { method: 'POST' });
        const data = await res.json();
        
        if (res.ok) {
            logBox.innerHTML += `<p style="color:var(--success)">${data.message || 'Simulacao concluida'}</p>`;
            if (data.results) logBox.innerHTML += `<p>Catalogo: ${data.results.catalogViews} | Carrinho: ${data.results.cartAdds} | Checkouts: ${data.results.checkouts} | Erros: ${data.results.errors}</p>`;
            if (data.sucessos !== undefined) logBox.innerHTML += `<p>Sucessos: <span style="color:var(--success)">${data.sucessos}</span> | Falhas: <span style="color:var(--danger)">${data.falhas}</span></p>`;
            if (data.log) {
                data.log.forEach(entry => {
                    const color = entry.status >= 400 ? 'var(--danger)' : entry.status >= 200 ? 'var(--success)' : 'var(--text-secondary)';
                    logBox.innerHTML += `<p style="color:${color}">  -> ${entry.etapa}: HTTP ${entry.status}${entry.aprovado !== undefined ? (entry.aprovado ? ' Pago' : ' Recusado') : ''}</p>`;
                });
            }
            showToast(`${nome} concluida!`, 'success');
        } else {
            logBox.innerHTML += `<p style="color:var(--danger)">Erro: ${data.error || 'Falha'}</p>`;
            showToast(data.error || 'Erro na simulacao', 'error');
        }
    } catch (err) {
        logBox.innerHTML += `<p style="color:var(--danger)">Erro: ${err.message}</p>`;
        showToast('Erro de conexao', 'error');
    }
    
    updateStats();
    loadCart();
    loadOrders();
}

// ==================== STATS ====================

async function updateStats() {
    try {
        const res = await fetch('/metrics');
        const text = await res.text();
        const getVal = (name, label) => {
            const regex = label 
                ? new RegExp(`${name}{${label}}[\\\\s\"]+([0-9.e+]+)`)
                : new RegExp(`${name}\\s+([0-9.e+]+)`);
            const match = text.match(regex);
            return match ? parseFloat(match[1]) || 0 : 0;
        };
        
        const revenue = getVal('app_revenue_total');
        document.getElementById('stat-revenue').innerText = `R$ ${revenue.toFixed(2)}`;
        
        const errorMatch = text.match(/app_errors_total\{[^}]*\}\s+([0-9.e+]+)/g);
        let totalErrors = 0;
        if (errorMatch) {
            errorMatch.forEach(m => {
                const v = m.match(/\s+([0-9.e+]+)$/);
                if (v) totalErrors += parseFloat(v[1]) || 0;
            });
        }
        document.getElementById('stat-errors').innerText = totalErrors;
    } catch (e) {}
}

async function checkHealth() {
    try {
        const res = await fetch('/health');
        if (res.ok) {
            document.getElementById('status-health').innerHTML = '<span class="status-dot green"></span> API Online';
        }
    } catch (e) {
        document.getElementById('status-health').innerHTML = '<span class="status-dot red"></span> API Offline';
    }
}

setInterval(() => {
    if (currentUser) { updateStats(); checkHealth(); }
}, 10000);

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
