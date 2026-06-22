let isLoginMode = true;
let currentUser = null;
const SESSION_KEY = 'o11ylab_session';
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutos

// Restaurar sessao ao carregar a pagina
(function restoreSession() {
    try {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
        if (saved && saved.username && saved.expiresAt && Date.now() < saved.expiresAt) {
            currentUser = saved.username;
            showDashboard();
        }
    } catch (e) {
        localStorage.removeItem(SESSION_KEY);
    }
})();

// DOM Elements
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const authForm = document.getElementById('auth-form');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const logoutBtn = document.getElementById('logout-btn');
const usersList = document.getElementById('users-list');
const currentUserDisplay = document.getElementById('current-user-display');
const toastContainer = document.getElementById('toast-container');

// Tabs Toggle
tabLogin.addEventListener('click', () => {
    isLoginMode = true;
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    authSubmitBtn.innerText = 'Entrar no Sistema';
});

tabRegister.addEventListener('click', () => {
    isLoginMode = false;
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    authSubmitBtn.innerText = 'Criar Conta';
});

// Auth Submit
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
                localStorage.setItem(SESSION_KEY, JSON.stringify({
                    username: username,
                    expiresAt: Date.now() + SESSION_EXPIRY_MS
                }));
                showDashboard();
                showToast('Login efetuado! Sessao salva por 30 min.', 'success');
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
    loadUsers();
    updateStats();
    checkHealth();
}

logoutBtn.addEventListener('click', () => {
    currentUser = null;
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

// ==================== CRUD ====================

async function loadUsers() {
    try {
        const res = await fetch('/users');
        const users = await res.json();
        
        usersList.innerHTML = users.map(u => `
            <tr>
                <td>#${u.id}</td>
                <td><strong>${escapeHtml(u.username)}</strong></td>
                <td>${new Date().toLocaleDateString()}</td>
                <td class="actions-cell">
                    <button class="btn-sm btn-edit" onclick="startEdit(${u.id}, '${escapeHtml(u.username)}')">Editar</button>
                    <button class="btn-sm btn-delete" onclick="deleteUser(${u.id})">Deletar</button>
                </td>
            </tr>
        `).join('');
        
        document.getElementById('stat-users').innerText = users.length;
    } catch (err) {
        showToast('Erro ao carregar usuarios', 'error');
    }
}

async function createUser() {
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    
    if (!username || !password) {
        document.getElementById('create-message').innerText = 'Preencha todos os campos';
        return;
    }
    
    try {
        const res = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        if (res.ok) {
            document.getElementById('create-message').innerHTML = '<span style="color:var(--success)">Usuario criado!</span>';
            document.getElementById('new-username').value = '';
            document.getElementById('new-password').value = '';
            loadUsers();
            updateStats();
            showToast(`Usuario "${username}" criado`, 'success');
        } else {
            document.getElementById('create-message').innerHTML = `<span style="color:var(--danger)">${data.error}</span>`;
        }
    } catch (err) {
        document.getElementById('create-message').innerText = 'Erro de conexao';
    }
}

let editingUserId = null;

function startEdit(id, currentUsername) {
    editingUserId = id;
    document.getElementById('edit-user-id').innerText = '#' + id;
    document.getElementById('edit-username').value = currentUsername;
    document.getElementById('edit-password').value = '';
    document.getElementById('edit-form').style.display = 'block';
}

function cancelEdit() {
    editingUserId = null;
    document.getElementById('edit-form').style.display = 'none';
    document.getElementById('edit-username').value = '';
    document.getElementById('edit-password').value = '';
}

async function updateUser() {
    const username = document.getElementById('edit-username').value.trim();
    const password = document.getElementById('edit-password').value;
    
    if (!username && !password) {
        showToast('Preencha ao menos um campo', 'error');
        return;
    }
    
    try {
        const body = {};
        if (username) body.username = username;
        if (password) body.password = password;
        
        const res = await fetch(`/users/${editingUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        
        if (res.ok) {
            showToast('Usuario atualizado!', 'success');
            cancelEdit();
            loadUsers();
        } else {
            showToast(data.error || 'Erro ao atualizar', 'error');
        }
    } catch (err) {
        showToast('Erro de conexao', 'error');
    }
}

async function deleteUser(id) {
    if (!confirm(`Deletar usuario #${id}?`)) return;
    try {
        const res = await fetch(`/users/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast(`Usuario #${id} deletado`, 'success');
            loadUsers();
            updateStats();
        } else {
            const data = await res.json();
            showToast(data.error || 'Erro ao deletar', 'error');
        }
    } catch (err) {
        showToast('Erro de conexao', 'error');
    }
}

// ==================== INCIDENTS ====================

async function triggerIncident(type) {
    showToast(`Disparando incidente: ${type}...`, 'info');
    try {
        const res = await fetch(`/incidente-${type}`);
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || 'Incidente executado', 'warning');
        } else {
            showToast(data.error || 'Incidente gerou erro (esperado)', 'error');
        }
    } catch (err) {
        showToast('Servidor demorou ou falhou (incidente OK)', 'error');
    }
    updateStats();
}

// ==================== ECOMMERCE SIMULATIONS ====================

async function simularEcommerce(tipo) {
    const logBox = document.getElementById('ecommerce-log');
    const nomes = {
        'black-friday': 'Black Friday',
        'estoque-esgotado': 'Estoque Esgotado',
        'falha-pagamento': 'Falha de Pagamento',
        'fluxo-completo': 'Fluxo Completo'
    };
    const nome = nomes[tipo] || tipo;

    logBox.innerHTML = `<p style="color:var(--accent)">Executando simulacao: ${nome}...</p>`;
    showToast(`Disparando ${nome}...`, 'info');

    try {
        const res = await fetch(`/simular/${tipo}`, { method: 'POST' });
        const data = await res.json();

        if (res.ok) {
            logBox.innerHTML += `<p style="color:var(--success)">${data.message || 'Simulacao concluida'}</p>`;
            // Exibe resumo numerico (results como objeto)
            if (data.results && !Array.isArray(data.results)) {
                for (const [key, val] of Object.entries(data.results)) {
                    const color = key === 'errors' ? 'var(--danger)' : 'var(--success)';
                    logBox.innerHTML += `<p>${key}: <span style="color:${color}">${val}</span></p>`;
                }
            }
            // Exibe lista de tentativas (results como array)
            if (Array.isArray(data.results) && data.results.length > 0) {
                if (data.results[0].success !== undefined) {
                    const s = data.results.filter(r => r.success).length;
                    const f = data.results.filter(r => !r.success).length;
                    logBox.innerHTML += `<p>Sucessos: <span style="color:var(--success)">${s}</span> | Falhas: <span style="color:var(--danger)">${f}</span></p>`;
                }
                logBox.innerHTML += '<p style="margin-top:0.5rem"><strong>Tentativas:</strong></p>';
                data.results.slice(0, 10).forEach(r => {
                    const ok = r.success !== false;
                    logBox.innerHTML += `<p style="color:${ok ? 'var(--success)' : 'var(--danger)'}">  → #${r.attempt}: ${r.status || r.error || 'OK'}</p>`;
                });
            }
            // Exibe fluxo (fluxo-completo)
            if (data.flow) {
                logBox.innerHTML += '<p style="margin-top:0.5rem"><strong>Fluxo:</strong></p>';
                data.flow.forEach(step => {
                    logBox.innerHTML += `<p style="color:var(--success)">  → ${step.step}: ${step.status || step.username || step.orderId || JSON.stringify(step)}</p>`;
                });
            }
            showToast(`${nome} concluida!`, 'success');
        } else {
            logBox.innerHTML += `<p style="color:var(--danger)">Erro: ${data.error || 'Falha na simulacao'}</p>`;
            showToast(data.error || 'Erro na simulacao', 'error');
        }
    } catch (err) {
        logBox.innerHTML += `<p style="color:var(--danger)">Erro de conexao: ${err.message}</p>`;
        showToast('Erro de conexao com a API', 'error');
    }

    logBox.scrollTop = logBox.scrollHeight;
    updateStats();
}

// ==================== BRUTE FORCE SIMULATION ====================

async function simulateBruteForce() {
    const logBox = document.getElementById('bruteforce-log');
    logBox.innerHTML = '<p>Iniciando simulacao de ataque...</p>';
    
    // Register test user first
    await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'hacker_target', password: 'realpass' })
    });
    
    for (let i = 1; i <= 8; i++) {
        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'hacker_target', password: 'wrong' + i })
        });
        const status = res.status;
        const color = status === 429 ? 'var(--danger)' : status === 401 ? 'var(--warning)' : 'var(--text-secondary)';
        logBox.innerHTML += `<p style="color:${color}">Tentativa ${i}: HTTP ${status} ${status === 429 ? 'BLOQUEADO' : status === 401 ? 'Falha' : ''}</p>`;
    }
    
    logBox.innerHTML += '<p style="color:var(--success);margin-top:0.5rem">Ataque bloqueado pelo rate limit! Veja as metricas no Grafana.</p>';
    updateStats();
}

// ==================== STATS ====================

async function updateStats() {
    try {
        const res = await fetch('/metrics');
        const text = await res.text();
        
        // Parse Prometheus text format
        const getVal = (name, label) => {
            const regex = label 
                ? new RegExp(`${name}{${label}}[\\s"]+([0-9.e+]+)`)
                : new RegExp(`${name}\\s+([0-9.e+]+)`);
            const match = text.match(regex);
            return match ? parseFloat(match[1]) || 0 : 0;
        };
        
        document.getElementById('stat-registrations').innerText = getVal('app_registrations_total');
        document.getElementById('stat-logins-ok').innerText = getVal('app_logins_total', 'status="success"');
        document.getElementById('stat-logins-fail').innerText = getVal('app_logins_total', 'status="failure"');
        
        // Sum all error types
        const errorMatch = text.match(/app_errors_total\{[^}]*\}\s+([0-9.e+]+)/g);
        let totalErrors = 0;
        if (errorMatch) {
            errorMatch.forEach(m => {
                const v = m.match(/\s+([0-9.e+]+)$/);
                if (v) totalErrors += parseFloat(v[1]) || 0;
            });
        }
        document.getElementById('stat-errors').innerText = totalErrors;
    } catch (e) {
        // Silently fail - stats are cosmetic
    }
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

// Refresh stats every 10 seconds
setInterval(() => {
    if (currentUser) {
        updateStats();
        checkHealth();
    }
}, 10000);

// ==================== HELPERS ====================

function escapeHtml(str) {
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
