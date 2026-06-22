const express = require('express');
const promClient = require('prom-client');
const path = require('path');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { Worker } = require('worker_threads');
const os = require('os');
const logger = require('./logger');

const app = express();
app.use(express.json());
app.use(helmet());
app.set('json spaces', 2);

const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'node_app_' });

const httpRequestsTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total de requisições HTTP',
    labelNames: ['method', 'route', 'status_code']
});

const httpRequestDurationSeconds = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP em segundos',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 15]
});

const registrationsTotal = new promClient.Counter({
    name: 'app_registrations_total', help: 'Total de registros de usuários'
});
const loginsTotal = new promClient.Counter({
    name: 'app_logins_total', help: 'Total de logins', labelNames: ['status']
});
const crudOperationsTotal = new promClient.Counter({
    name: 'app_crud_operations_total', help: 'Total de operações CRUD', labelNames: ['operation', 'status']
});
const errorsTotal = new promClient.Counter({
    name: 'app_errors_total', help: 'Total de erros da aplicação', labelNames: ['type', 'endpoint']
});
const activeUsersGauge = new promClient.Gauge({
    name: 'app_active_users', help: 'Número de usuários cadastrados'
});
const healthStatusGauge = new promClient.Gauge({
    name: 'app_health_status', help: 'Status de saúde da aplicação (1=UP, 0=DOWN)'
});

// ==================== ECOMMERCE DATA ====================

const produtos = [
    { id: 1, nome: 'Notebook Pro', preco: 4999.90, estoque: 10, categoria: 'Informática', imagem: '💻' },
    { id: 2, nome: 'Monitor 27"', preco: 1899.90, estoque: 15, categoria: 'Periféricos', imagem: '🖥️' },
    { id: 3, nome: 'Teclado Mecânico', preco: 349.90, estoque: 30, categoria: 'Periféricos', imagem: '⌨️' },
    { id: 4, nome: 'Mouse Gamer', preco: 249.90, estoque: 0, categoria: 'Periféricos', imagem: '🖱️' },
    { id: 5, nome: 'Headset Wireless', preco: 599.90, estoque: 8, categoria: 'Áudio', imagem: '🎧' },
    { id: 6, nome: 'Webcam 4K', preco: 799.90, estoque: 5, categoria: 'Periféricos', imagem: '📷' },
    { id: 7, nome: 'Hub USB-C', preco: 199.90, estoque: 20, categoria: 'Acessórios', imagem: '🔌' },
    { id: 8, nome: 'SSD 1TB', preco: 449.90, estoque: 12, categoria: 'Informática', imagem: '💾' },
];

const carrinhos = {};
const pedidos = [];
let pedidoIdSeq = 1;

// ==================== ECOMMERCE METRICS ====================

const buscasTotal = new promClient.Counter({ name: 'ecommerce_buscas_total', help: 'Total de buscas de produtos', labelNames: ['termo'] });
const carrinhoAddTotal = new promClient.Counter({ name: 'ecommerce_carrinho_add_total', help: 'Total de adições ao carrinho', labelNames: ['status'] });
const checkoutsTotal = new promClient.Counter({ name: 'ecommerce_checkouts_total', help: 'Total de checkouts realizados', labelNames: ['status'] });
const pagamentosTotal = new promClient.Counter({ name: 'ecommerce_pagamentos_total', help: 'Total de pagamentos processados', labelNames: ['status'] });
const receitaGauge = new promClient.Gauge({ name: 'ecommerce_receita_total', help: 'Receita total em reais' });
const estoqueGauge = new promClient.Gauge({ name: 'ecommerce_estoque', help: 'Estoque atual por produto', labelNames: ['produto'] });
const carrinhoItensGauge = new promClient.Gauge({ name: 'ecommerce_carrinho_itens', help: 'Total de itens atualmente nos carrinhos' });
const pedidosStatusGauge = new promClient.Gauge({ name: 'ecommerce_pedidos_status', help: 'Pedidos ativos por status', labelNames: ['status'] });

function updateCarrinhoItensGauge() {
    let total = 0;
    for (const uid of Object.keys(carrinhos)) {
        total += carrinhos[uid].items.reduce((s, i) => s + i.quantidade, 0);
    }
    carrinhoItensGauge.set(total);
}

function updatePedidosStatusGauge() {
    const cnt = {};
    for (const p of pedidos) cnt[p.status] = (cnt[p.status] || 0) + 1;
    ['pendente', 'pago', 'pagamento_falhou', 'enviado', 'entregue', 'cancelado'].forEach(s => {
        pedidosStatusGauge.set({ status: s }, cnt[s] || 0);
    });
}

// Middleware HTTP metrics + logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        httpRequestsTotal.inc({ method: req.method, route: req.path, status_code: res.statusCode });
        httpRequestDurationSeconds.observe({ method: req.method, route: req.path, status_code: res.statusCode }, ms / 1000);
        const ctx = { method: req.method, path: req.path, statusCode: res.statusCode, duration: ms, ip: req.ip || req.socket.remoteAddress, userAgent: req.get('user-agent') || 'unknown' };
        if (res.statusCode >= 500) logger.error('Erro interno', ctx);
        else if (res.statusCode >= 400) logger.warn('Erro cliente', ctx);
        else logger.info('OK', ctx);
    });
    next();
});

// Rate limiting
app.use(rateLimit({ windowMs: 30000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas requisições' } }));
const loginLimiter = rateLimit({ windowMs: 30000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas de login' } });

// Metrics
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

app.get('/', (req, res) => { res.redirect('/index.html'); });

app.get('/health', (req, res) => {
    healthStatusGauge.set(1);
    res.json({ status: 'UP', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

const users = [];
let currentId = 1;
const SALT_ROUNDS = 10;

function validateUsername(u) { return u && typeof u === 'string' && u.length >= 3 && u.length <= 30 && /^[a-zA-Z0-9_]+$/.test(u); }
function validatePassword(p) { return p && typeof p === 'string' && p.length >= 6; }

// Auth routes
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!validateUsername(username)) return res.status(400).json({ error: 'Username inválido (3-30 chars alfanuméricos)' });
    if (!validatePassword(password)) return res.status(400).json({ error: 'Senha inválida (mínimo 6 chars)' });
    try {
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        const user = { id: currentId++, username, password: hash };
        users.push(user);
        registrationsTotal.inc(); activeUsersGauge.inc();
        logger.info('Registro', { username, userId: user.id });
        res.status(201).json({ id: user.id, username });
    } catch (e) { res.status(500).json({ error: 'Erro interno' }); }
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
    const user = users.find(u => u.username === username);
    if (!user) { loginsTotal.inc({ status: 'failure' }); return res.status(401).json({ error: 'Credenciais inválidas' }); }
    try {
        const ok = await bcrypt.compare(password, user.password);
        if (ok) { loginsTotal.inc({ status: 'success' }); res.json({ message: 'Login efetuado com sucesso', userId: user.id, username: user.username }); }
        else { loginsTotal.inc({ status: 'failure' }); res.status(401).json({ error: 'Credenciais inválidas' }); }
    } catch (e) { res.status(500).json({ error: 'Erro interno' }); }
});

// CRUD (mantido)
app.get('/users', (req, res) => { crudOperationsTotal.inc({ operation: 'read', status: 'success' }); res.json(users.map(u => ({ id: u.id, username: u.username }))); });
app.get('/users/:id', (req, res) => { const u = users.find(x => x.id == req.params.id); if (u) { crudOperationsTotal.inc({ operation: 'read', status: 'success' }); res.json({ id: u.id, username: u.username }); } else { res.status(404).json({ error: 'Não encontrado' }); } });
app.put('/users/:id', (req, res) => {
    const { id } = req.params; const { username, password } = req.body;
    const user = users.find(u => u.id == id);
    if (!user) { crudOperationsTotal.inc({ operation: 'update', status: 'error' }); return res.status(404).json({ error: 'Não encontrado' }); }
    if (!username && !password) { errorsTotal.inc({ type: 'validation', endpoint: '/users/:id' }); return res.status(400).json({ error: 'Nenhum campo para atualizar' }); }
    if (username) user.username = username;
    if (password) user.password = password;
    crudOperationsTotal.inc({ operation: 'update', status: 'success' });
    res.json({ id: user.id, username: user.username });
});
app.delete('/users/:id', (req, res) => {
    const i = users.findIndex(u => u.id == req.params.id);
    if (i !== -1) { users.splice(i, 1); activeUsersGauge.dec(); crudOperationsTotal.inc({ operation: 'delete', status: 'success' }); res.status(204).send(); }
    else res.status(404).json({ error: 'Não encontrado' });
});

// Incidentes
app.get('/incidente-erro', (req, res) => { logger.error('Incidente erro 500'); res.status(500).json({ error: 'Erro simulado' }); });
app.get('/incidente-cpu', (req, res) => {
    const n = os.cpus().length; let done = 0;
    for (let i = 0; i < n; i++) { const w = new Worker(path.join(__dirname, 'cpu-worker.js')); w.on('exit', () => { if (++done === n) logger.info('CPU pico fim'); }); }
    res.json({ message: `Pico de CPU gerado em ${n} núcleos` });
});
app.get('/incidente-delay', (req, res) => { setTimeout(() => res.json({ message: 'Resposta com delay de 10 segundos' }), 10000); });

// ==================== ECOMMERCE API ====================

// GET /api/produtos
app.get('/api/produtos', (req, res) => {
    const { q } = req.query;
    buscasTotal.inc({ termo: q || 'todos' });
    let r = produtos;
    if (q) { const t = q.toLowerCase(); r = produtos.filter(p => p.nome.toLowerCase().includes(t)); }
    res.json(r.map(p => ({ id: p.id, nome: p.nome, preco: p.preco, estoque: p.estoque, categoria: p.categoria, imagem: p.imagem })));
});

// GET /api/estoque/:id
app.get('/api/estoque/:id', (req, res) => {
    const p = produtos.find(x => x.id == req.params.id);
    p ? res.json({ id: p.id, nome: p.nome, estoque: p.estoque }) : res.status(404).json({ error: 'Não encontrado' });
});

// POST /api/carrinho
app.post('/api/carrinho', (req, res) => {
    const { userId, produtoId, quantidade } = req.body;
    if (!userId || !produtoId || !quantidade) { carrinhoAddTotal.inc({ status: 'error' }); return res.status(400).json({ error: 'Campos obrigatórios' }); }
    const p = produtos.find(x => x.id == produtoId);
    if (!p) { carrinhoAddTotal.inc({ status: 'error' }); return res.status(404).json({ error: 'Produto não encontrado' }); }
    if (p.estoque < quantidade) { carrinhoAddTotal.inc({ status: 'error' }); return res.status(400).json({ error: `Estoque insuficiente (${p.estoque})` }); }
    if (!carrinhos[userId]) carrinhos[userId] = { items: [], total: 0 };
    const cart = carrinhos[userId];
    const ex = cart.items.find(i => i.produtoId === produtoId);
    ex ? ex.quantidade += quantidade : cart.items.push({ produtoId, nome: p.nome, preco: p.preco, quantidade, imagem: p.imagem });
    cart.total = cart.items.reduce((s, i) => s + i.preco * i.quantidade, 0);
    carrinhoAddTotal.inc({ status: 'success' }); updateCarrinhoItensGauge();
    res.json({ carrinho: cart });
});

// GET /api/carrinho/:userId
app.get('/api/carrinho/:userId', (req, res) => {
    const cart = carrinhos[req.params.userId];
    res.json(cart || { items: [], total: 0 });
});

// DELETE /api/carrinho/:userId/:produtoId
app.delete('/api/carrinho/:userId/:produtoId', (req, res) => {
    const cart = carrinhos[req.params.userId];
    if (!cart) return res.status(404).json({ error: 'Carrinho não encontrado' });
    const idx = cart.items.findIndex(i => i.produtoId == req.params.produtoId);
    if (idx === -1) return res.status(404).json({ error: 'Item não encontrado' });
    cart.items.splice(idx, 1);
    cart.total = cart.items.reduce((s, i) => s + i.preco * i.quantidade, 0);
    if (cart.items.length === 0) delete carrinhos[req.params.userId];
    updateCarrinhoItensGauge();
    res.json({ carrinho: cart.items.length ? cart : { items: [], total: 0 } });
});

// POST /api/checkout
app.post('/api/checkout', (req, res) => {
    const { userId } = req.body;
    if (!userId || !carrinhos[userId] || carrinhos[userId].items.length === 0) { checkoutsTotal.inc({ status: 'error' }); return res.status(400).json({ error: 'Carrinho vazio' }); }
    const cart = carrinhos[userId];
    const pedido = { id: pedidoIdSeq++, userId, itens: [...cart.items], total: cart.total, status: 'pendente', criadoEm: new Date().toISOString() };
    pedidos.push(pedido);
    for (const item of cart.items) { const p = produtos.find(x => x.id === item.produtoId); if (p) { p.estoque -= item.quantidade; estoqueGauge.set({ produto: p.nome }, p.estoque); } }
    delete carrinhos[userId]; updateCarrinhoItensGauge();
    checkoutsTotal.inc({ status: 'success' }); updatePedidosStatusGauge();
    res.status(201).json({ pedido });
});

// POST /api/pagamento
app.post('/api/pagamento', (req, res) => {
    const { pedidoId } = req.body;
    if (!pedidoId) return res.status(400).json({ error: 'pedidoId obrigatório' });
    const pedido = pedidos.find(p => p.id == pedidoId);
    if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (pedido.status !== 'pendente') { pagamentosTotal.inc({ status: 'error' }); return res.status(400).json({ error: `Pedido ${pedido.status}` }); }
    if (Math.random() < 0.15) { pedido.status = 'pagamento_falhou'; pagamentosTotal.inc({ status: 'failure' }); updatePedidosStatusGauge(); return res.status(402).json({ error: 'Pagamento recusado', pedidoId }); }
    pedido.status = 'pago'; pagamentosTotal.inc({ status: 'success' }); receitaGauge.inc(pedido.total); updatePedidosStatusGauge();
    res.json({ message: 'Pagamento aprovado', pedidoId, total: pedido.total });
});

// GET /api/pedidos?userId=X
app.get('/api/pedidos', (req, res) => {
    const { userId } = req.query;
    let result = pedidos;
    if (userId) result = pedidos.filter(p => p.userId == userId);
    res.json(result);
});

// Inicializa métricas
produtos.forEach(p => estoqueGauge.set({ produto: p.nome }, p.estoque));
['pendente','pago','pagamento_falhou','enviado','entregue','cancelado'].forEach(s => pedidosStatusGauge.set({ status: s }, 0));
carrinhoItensGauge.set(0);

// ==================== SIMULAÇÕES ====================

async function internalFetch(method, path, body = null) {
    const url = `http://localhost:${process.env.PORT || 3001}${path}`;
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    try { const r = await fetch(url, opts); const d = await r.json(); return { status: r.status, data: d }; }
    catch (e) { return { status: 0, error: e.message }; }
}

app.post('/simular/black-friday', async (req, res) => {
    const t = []; const termos = ['notebook','monitor','teclado','mouse','headset','webcam','ssd','hub'];
    for (let i = 0; i < 30; i++) t.push(internalFetch('GET', `/api/produtos?q=${termos[Math.floor(Math.random()*8)]}`));
    for (let i = 0; i < 15; i++) t.push(internalFetch('POST', '/api/carrinho', { userId: `bf_${Math.floor(Math.random()*5)}`, produtoId: Math.floor(Math.random()*7)+1, quantidade: 1 }));
    for (let i = 0; i < 5; i++) { await internalFetch('POST', '/api/carrinho', { userId: `bf_${i}`, produtoId: 3, quantidade: 2 }); t.push(internalFetch('POST', '/api/checkout', { userId: `bf_${i}` })); }
    const r = await Promise.all(t); const e = r.filter(x => x.status >= 400 || x.status === 0).length;
    res.json({ message: 'Black Friday: 50 req', total: 50, erros: e });
});

app.post('/simular/estoque-esgotado', async (req, res) => {
    const r = []; for (let i = 0; i < 10; i++) r.push(await internalFetch('POST', '/api/carrinho', { userId: 'sim_est', produtoId: 4, quantidade: 1 }));
    res.json({ message: 'Estoque esgotado: 10 tentativas', total: 10, erros400: r.filter(x => x.status === 400).length });
});

app.post('/simular/falha-pagamento', async (req, res) => {
    await internalFetch('POST', '/api/carrinho', { userId: 'sim_pg', produtoId: 1, quantidade: 1 });
    const c = await internalFetch('POST', '/api/checkout', { userId: 'sim_pg' });
    if (c.status !== 201) return res.status(500).json({ error: 'Falha ao criar pedido' });
    const pid = c.data.pedido.id; const r = [];
    for (let i = 0; i < 5; i++) r.push(await internalFetch('POST', '/api/pagamento', { pedidoId: pid }));
    res.json({ message: 'Falha pagamento: 5 tentativas', pedidoId: pid, sucessos: r.filter(x => x.status === 200).length, falhas: r.filter(x => x.status !== 200).length });
});

app.post('/simular/fluxo-completo', async (req, res) => {
    const uid = `fluxo_${Date.now()}`; const log = [];
    log.push({ etapa: 'registro', status: (await internalFetch('POST', '/register', { username: uid, password: 'fluxo123' })).status });
    log.push({ etapa: 'busca', status: (await internalFetch('GET', '/api/produtos?q=notebook')).status });
    for (const it of [{ produtoId: 1, quantidade: 1 }, { produtoId: 3, quantidade: 2 }, { produtoId: 5, quantidade: 1 }])
        log.push({ etapa: 'carrinho', produtoId: it.produtoId, status: (await internalFetch('POST', '/api/carrinho', { userId: uid, ...it })).status });
    const co = await internalFetch('POST', '/api/checkout', { userId: uid });
    log.push({ etapa: 'checkout', status: co.status, pedidoId: co.data?.pedido?.id });
    if (co.data?.pedido?.id) { const pg = await internalFetch('POST', '/api/pagamento', { pedidoId: co.data.pedido.id }); log.push({ etapa: 'pagamento', status: pg.status, ok: pg.status === 200 }); }
    res.json({ message: 'Fluxo completo', userId: uid, log });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;
if (require.main === module) app.listen(PORT, () => logger.info('Servidor', { port: PORT }));
module.exports = app;
