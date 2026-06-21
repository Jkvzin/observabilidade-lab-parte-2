let isLoginMode = true;
let currentUser = null;

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
    const username = document.getElementById('username').value;
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
            showToast(isLoginMode ? 'Login efetuado com sucesso!' : 'Conta criada! Você já pode logar.', 'success');
            if (isLoginMode) {
                currentUser = username;
                showDashboard();
            } else {
                tabLogin.click();
            }
        } else {
            showToast(data.error || 'Erro na autenticação', 'error');
        }
    } catch (err) {
        showToast('Erro de conexão com a API', 'error');
    }
});

function showDashboard() {
    loginView.classList.remove('active');
    setTimeout(() => {
        loginView.style.display = 'none';
        dashboardView.style.display = 'flex';
        setTimeout(() => dashboardView.classList.add('active'), 50);
    }, 400); // Wait for fade out
    
    currentUserDisplay.innerText = currentUser;
    loadUsers();
}

logoutBtn.addEventListener('click', () => {
    currentUser = null;
    dashboardView.classList.remove('active');
    setTimeout(() => {
        dashboardView.style.display = 'none';
        loginView.style.display = 'flex';
        setTimeout(() => loginView.classList.add('active'), 50);
    }, 400);
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
});

// Load Users (CRUD)
async function loadUsers() {
    try {
        const res = await fetch('/users');
        const users = await res.json();
        
        usersList.innerHTML = users.map(u => `
            <tr>
                <td>#${u.id}</td>
                <td>${u.username}</td>
                <td>
                    <button class="btn-secondary" onclick="deleteUser(${u.id})" style="color: var(--danger); border-color: var(--danger); padding: 0.25rem 0.5rem; font-size: 0.8rem;">Deletar</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        showToast('Erro ao carregar usuários', 'error');
    }
}

async function deleteUser(id) {
    if(!confirm('Tem certeza que deseja deletar este usuário?')) return;
    try {
        const res = await fetch(`/users/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Usuário deletado', 'success');
            loadUsers();
        } else {
            showToast('Erro ao deletar', 'error');
        }
    } catch (err) {
        showToast('Erro de conexão', 'error');
    }
}

// Incidents
async function triggerIncident(type) {
    showToast(`Disparando incidente: ${type}...`, 'info');
    try {
        const res = await fetch(`/incidente-${type}`);
        const data = await res.json();
        
        if (res.ok) {
            showToast(data.message || 'Incidente executado.', 'warning');
        } else {
            showToast(data.error || 'Incidente gerou erro (esperado).', 'error');
        }
    } catch (err) {
        showToast('O servidor demorou ou falhou (Incidente com sucesso!)', 'error');
    }
}

// UI Helpers
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}
