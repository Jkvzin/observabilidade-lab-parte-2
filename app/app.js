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

// Métricas de negócio
const registrationsTotal = new promClient.Counter({
    name: 'app_registrations_total',
    help: 'Total de registros de usuários'
});

const loginsTotal = new promClient.Counter({
    name: 'app_logins_total',
    help: 'Total de logins',
    labelNames: ['status']
});

const crudOperationsTotal = new promClient.Counter({
    name: 'app_crud_operations_total',
    help: 'Total de operações CRUD',
    labelNames: ['operation', 'status']
});

const errorsTotal = new promClient.Counter({
    name: 'app_errors_total',
    help: 'Total de erros da aplicação',
    labelNames: ['type', 'endpoint']
});

const activeUsersGauge = new promClient.Gauge({
    name: 'app_active_users',
    help: 'Número de usuários cadastrados'
});

const healthStatusGauge = new promClient.Gauge({
    name: 'app_health_status',
    help: 'Status de saúde da aplicação (1=UP, 0=DOWN)'
});

// ==================== ECOMMERCE DATA MODEL ====================

const produtos = [
    { id: 1, nome: 'Notebook Pro', preco: 4999.90, estoque: 10 },
    { id: 2, nome: 'Monitor 27"', preco: 1899.90, estoque: 15 },
    { id: 3, nome: 'Teclado Mecânico', preco: 349.90, estoque: 30 },
    { id: 4, nome: 'Mouse Gamer', preco: 249.90, estoque: 0 },
    { id: 5, nome: 'Headset Wireless', preco: 599.90, estoque: 8 },
    { id: 6, nome: 'Webcam 4K', preco: 799.90, estoque: 5 },
    { id: 7, nome: 'Hub USB-C', preco: 199.90, estoque: 20 },
    { id: 8, nome: 'SSD 1TB', preco: 449.90, estoque: 12 },
];

const carrinhos = {};
const pedidos = [];
let pedidoIdSeq = 1;

// ==================== ECOMMERCE METRICS ====================

const buscasTotal = new promClient.Counter({
    name: 'ecommerce_buscas_total',
    help: 'Total de buscas de produtos',
    labelNames: ['termo']
});

const carrinhoAddTotal = new promClient.Counter({
    name: 'ecommerce_carrinho_add_total',
    help: 'Total de adições ao carrinho',
    labelNames: ['status']
});

const checkoutsTotal = new promClient.Counter({
    name: 'ecommerce_checkouts_total',
    help: 'Total de checkouts realizados',
    labelNames: ['status']
});

const pagamentosTotal = new promClient.Counter({
    name: 'ecommerce_pagamentos_total',
    help: 'Total de pagamentos processados',
    labelNames: ['status']
});

const receitaGauge = new promClient.Gauge({
    name: 'ecommerce_receita_total',
    help: 'Receita total em reais'
});

const estoqueGauge = new promClient.Gauge({
    name: 'ecommerce_estoque',
    help: 'Estoque atual por produto',
    labelNames: ['produto']
});

// Middleware de métricas + logging estruturado
app.use((req, res, next) => {
    const startEpoch = Date.now();
    res.on('finish', () => {
        const durationMs = Date.now() - startEpoch;
        const responseTimeInSeconds = durationMs / 1000;
        httpRequestsTotal.inc({
            method: req.method,
            route: req.path,
            status_code: res.statusCode
        });
        httpRequestDurationSeconds.observe({
            method: req.method,
            route: req.path,
            status_code: res.statusCode
        }, responseTimeInSeconds);

        // Log estruturado da requisição HTTP (sugestão do review: ip + userAgent)
        const logCtx = {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: durationMs,
            ip: req.ip || req.socket.remoteAddress,
            userAgent: req.get('user-agent') || 'unknown'
        };
        if (res.statusCode >= 500) {
            logger.error('Requisição com erro interno', logCtx);
        } else if (res.statusCode >= 400) {
            logger.warn('Requisição com erro do cliente', logCtx);
        } else {
            logger.info('Requisição concluída', logCtx);
        }
    });
    next();
});

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: 30 * 1000, // 30 segundos (para demonstracao)
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições, tente novamente mais tarde' }
});
app.use(generalLimiter);

const loginLimiter = rateLimit({
    windowMs: 30 * 1000, // 30 segundos (para demonstracao)
    max: 5, // 5 tentativas em 30s
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login, tente novamente em 30 segundos' }
});

// Rota de métricas pro Prometheus
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

// GET / — Redireciona para o dashboard web
app.get('/', (req, res) => {
    logger.info('Rota raiz acessada — redirecionando para dashboard', { path: '/' });
    res.redirect('/index.html');
});

app.get('/health', (req, res) => {
    healthStatusGauge.set(1);
    res.status(200).json({
        status: 'UP',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

const users = [];
let currentId = 1;
const SALT_ROUNDS = 10;

// Validação de entrada
function validateUsername(username) {
    if (!username || typeof username !== 'string') return false;
    if (username.length < 3 || username.length > 30) return false;
    return /^[a-zA-Z0-9_]+$/.test(username);
}

function validatePassword(password) {
    return password && typeof password === 'string' && password.length >= 6;
}

// Rotas CRUD e Login
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!validateUsername(username)) {
        return res.status(400).json({ error: 'Username inválido. Use 3-30 caracteres alfanuméricos.' });
    }
    if (!validatePassword(password)) {
        return res.status(400).json({ error: 'Senha inválida. Minimo de 6 caracteres.' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const user = { id: currentId++, username, password: hashedPassword };
        users.push(user);
        registrationsTotal.inc();
        activeUsersGauge.inc();
        logger.info('Usuário registrado', { username, userId: user.id });
        res.status(201).json({ id: user.id, username });
    } catch (err) {
        logger.error('Falha ao gerar hash da senha', { error: err.message });
        res.status(500).json({ error: 'Erro interno ao registrar usuário' });
    }
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }
    const user = users.find(u => u.username === username);
    if (!user) {
        loginsTotal.inc({ status: 'failure' });
        logger.warn('Login falhou', { username, reason: 'usuario_nao_encontrado' });
        return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    try {
        const valid = await bcrypt.compare(password, user.password);
        if (valid) {
            loginsTotal.inc({ status: 'success' });
            logger.info('Login efetuado', { username, userId: user.id });
            res.status(200).json({ message: 'Login efetuado com sucesso' });
        } else {
            loginsTotal.inc({ status: 'failure' });
            logger.warn('Login falhou', { username, reason: 'senha_incorreta' });
            res.status(401).json({ error: 'Credenciais inválidas' });
        }
    } catch (err) {
        logger.error('Falha ao verificar senha', { error: err.message });
        res.status(500).json({ error: 'Erro interno ao processar login' });
    }
});

app.get('/users', (req, res) => {
    crudOperationsTotal.inc({ operation: 'read', status: 'success' });
    logger.info('Listando usuários', { count: users.length });
    res.json(users.map(u => ({ id: u.id, username: u.username })));
});

app.get('/users/:id', (req, res) => {
    const { id } = req.params;
    const user = users.find(u => u.id == id);
    if (user) {
        crudOperationsTotal.inc({ operation: 'read', status: 'success' });
        logger.info('Usuário encontrado', { userId: Number(id) });
        res.json({ id: user.id, username: user.username });
    } else {
        crudOperationsTotal.inc({ operation: 'read', status: 'error' });
        errorsTotal.inc({ type: 'not_found', endpoint: '/users/:id' });
        logger.warn('Usuário não encontrado', { userId: Number(id) });
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

app.put('/users/:id', (req, res) => {
    const { id } = req.params;
    const { username, password } = req.body;
    const user = users.find(u => u.id == id);
    if (!user) {
        crudOperationsTotal.inc({ operation: 'update', status: 'error' });
        errorsTotal.inc({ type: 'not_found', endpoint: '/users/:id' });
        logger.warn('Usuário não encontrado para atualização', { userId: Number(id) });
        return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    if (!username && !password) {
        errorsTotal.inc({ type: 'validation', endpoint: '/users/:id' });
        return res.status(400).json({ error: 'Nenhum campo para atualizar. Envie username e/ou password.' });
    }
    if (username) user.username = username;
    if (password) user.password = password;
    crudOperationsTotal.inc({ operation: 'update', status: 'success' });
    logger.info('Usuário atualizado', { userId: Number(id), username: user.username });
    res.json({ id: user.id, username: user.username });
});

app.delete('/users/:id', (req, res) => {
    const { id } = req.params;
    const index = users.findIndex(u => u.id == id);
    if (index !== -1) {
        users.splice(index, 1);
        crudOperationsTotal.inc({ operation: 'delete', status: 'success' });
        activeUsersGauge.dec();
        logger.info('Usuário deletado', { userId: Number(id) });
        res.status(204).send();
    } else {
        crudOperationsTotal.inc({ operation: 'delete', status: 'error' });
        errorsTotal.inc({ type: 'not_found', endpoint: '/users/:id' });
        logger.warn('Usuário não encontrado para deleção', { userId: Number(id) });
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

app.get('/incidente-erro', (req, res) => {
    logger.error('Simulação de incidente de alta taxa de erro disparada', { incidente: 'erro_500' });
    res.status(500).json({ error: 'Internal Server Error Simulado' });
});

app.get('/incidente-cpu', (req, res) => {
    const numCores = os.cpus().length;
    logger.info('Iniciando simulação de pico de CPU', { incidente: 'cpu', numCores });
    let completedWorkers = 0;
    for (let i = 0; i < numCores; i++) {
        const worker = new Worker(path.join(__dirname, 'cpu-worker.js'));
        worker.on('exit', () => {
            completedWorkers++;
            if (completedWorkers === numCores) {
                logger.info('Simulação de pico de CPU finalizada', { incidente: 'cpu', numCores });
            }
        });
    }
    res.status(200).json({ message: `Pico de CPU gerado em ${numCores} núcleos` });
});

app.get('/incidente-delay', (req, res) => {
    logger.info('Iniciando simulação de instabilidade (delay)', { incidente: 'delay_10s' });
    setTimeout(() => {
        logger.info('Resposta atrasada enviada', { incidente: 'delay_10s' });
        res.status(200).json({ message: 'Resposta com delay de 10 segundos' });
    }, 10000);
});

// ==================== ECOMMERCE API ====================

// GET /api/produtos?q=termo — busca de produtos
app.get('/api/produtos', (req, res) => {
    const { q } = req.query;
    buscasTotal.inc({ termo: q || 'todos' });
    let resultado = produtos;
    if (q) {
        const termo = q.toLowerCase();
        resultado = produtos.filter(p => p.nome.toLowerCase().includes(termo));
    }
    logger.info('Busca de produtos', { termo: q || 'todos', resultados: resultado.length });
    res.json(resultado.map(p => ({ id: p.id, nome: p.nome, preco: p.preco, estoque: p.estoque })));
});

// GET /api/estoque/:id — verifica estoque de um produto
app.get('/api/estoque/:id', (req, res) => {
    const produto = produtos.find(p => p.id == req.params.id);
    if (!produto) {
        return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json({ id: produto.id, nome: produto.nome, estoque: produto.estoque });
});

// POST /api/carrinho — adiciona item ao carrinho
app.post('/api/carrinho', (req, res) => {
    const { userId, produtoId, quantidade } = req.body;
    if (!userId || !produtoId || !quantidade) {
        carrinhoAddTotal.inc({ status: 'error' });
        return res.status(400).json({ error: 'userId, produtoId e quantidade são obrigatórios' });
    }
    const produto = produtos.find(p => p.id == produtoId);
    if (!produto) {
        carrinhoAddTotal.inc({ status: 'error' });
        return res.status(404).json({ error: 'Produto não encontrado' });
    }
    if (produto.estoque < quantidade) {
        carrinhoAddTotal.inc({ status: 'error' });
        logger.warn('Estoque insuficiente', { produtoId, produto: produto.nome, estoque: produto.estoque, solicitado: quantidade });
        return res.status(400).json({ error: `Estoque insuficiente. Disponível: ${produto.estoque}` });
    }

    if (!carrinhos[userId]) {
        carrinhos[userId] = { items: [], total: 0 };
    }
    const cart = carrinhos[userId];
    const existing = cart.items.find(i => i.produtoId === produtoId);
    if (existing) {
        existing.quantidade += quantidade;
    } else {
        cart.items.push({ produtoId, nome: produto.nome, preco: produto.preco, quantidade });
    }
    cart.total = cart.items.reduce((sum, i) => sum + i.preco * i.quantidade, 0);

    carrinhoAddTotal.inc({ status: 'success' });
    logger.info('Item adicionado ao carrinho', { userId, produtoId, produto: produto.nome, quantidade });
    res.status(200).json({ carrinho: cart });
});

// POST /api/checkout — finaliza carrinho e cria pedido
app.post('/api/checkout', (req, res) => {
    const { userId } = req.body;
    if (!userId || !carrinhos[userId] || carrinhos[userId].items.length === 0) {
        checkoutsTotal.inc({ status: 'error' });
        return res.status(400).json({ error: 'Carrinho vazio ou usuário inválido' });
    }
    const cart = carrinhos[userId];
    const pedido = {
        id: pedidoIdSeq++,
        userId,
        itens: [...cart.items],
        total: cart.total,
        status: 'pendente',
        criadoEm: new Date().toISOString()
    };
    pedidos.push(pedido);

    // Atualiza estoque
    for (const item of cart.items) {
        const produto = produtos.find(p => p.id === item.produtoId);
        if (produto) {
            produto.estoque -= item.quantidade;
            estoqueGauge.set({ produto: produto.nome }, produto.estoque);
        }
    }

    // Limpa carrinho
    delete carrinhos[userId];

    checkoutsTotal.inc({ status: 'success' });
    logger.info('Checkout realizado', { userId, pedidoId: pedido.id, total: pedido.total, itens: pedido.itens.length });
    res.status(201).json({ pedido });
});

// POST /api/pagamento — processa pagamento (~15% falha)
app.post('/api/pagamento', (req, res) => {
    const { pedidoId } = req.body;
    if (!pedidoId) {
        pagamentosTotal.inc({ status: 'error' });
        return res.status(400).json({ error: 'pedidoId é obrigatório' });
    }
    const pedido = pedidos.find(p => p.id == pedidoId);
    if (!pedido) {
        pagamentosTotal.inc({ status: 'error' });
        return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    if (pedido.status !== 'pendente') {
        pagamentosTotal.inc({ status: 'error' });
        return res.status(400).json({ error: `Pedido já está ${pedido.status}` });
    }

    // ~15% de falha simulada
    const falhou = Math.random() < 0.15;
    if (falhou) {
        pedido.status = 'pagamento_falhou';
        pagamentosTotal.inc({ status: 'failure' });
        logger.warn('Pagamento falhou', { pedidoId, userId: pedido.userId, total: pedido.total });
        return res.status(402).json({ error: 'Pagamento recusado', pedidoId });
    }

    pedido.status = 'pago';
    pagamentosTotal.inc({ status: 'success' });
    receitaGauge.inc(pedido.total);
    logger.info('Pagamento aprovado', { pedidoId, userId: pedido.userId, total: pedido.total });
    res.status(200).json({ message: 'Pagamento aprovado', pedidoId, total: pedido.total });
});

// Inicializa métricas de estoque
produtos.forEach(p => estoqueGauge.set({ produto: p.nome }, p.estoque));

// ==================== SIMULAÇÕES ECOMMERCE ====================

// Helper: faz requisição HTTP interna para gerar métricas reais
async function internalFetch(method, path, body = null) {
    const PORT = process.env.PORT || 3001;
    const url = `http://localhost:${PORT}${path}`;
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    try {
        const res = await fetch(url, opts);
        const data = await res.json();
        return { status: res.status, data };
    } catch (err) {
        return { status: 0, error: err.message };
    }
}

// POST /simular/black-friday — 50 requisições paralelas simulando pico de tráfego
app.post('/simular/black-friday', async (req, res) => {
    logger.info('Simulação Black Friday iniciada');
    const tarefas = [];

    // 30 buscas de produtos
    const termos = ['notebook', 'monitor', 'teclado', 'mouse', 'headset', 'webcam', 'ssd', 'hub'];
    for (let i = 0; i < 30; i++) {
        const termo = termos[Math.floor(Math.random() * termos.length)];
        tarefas.push(internalFetch('GET', `/api/produtos?q=${termo}`));
    }

    // 15 adições ao carrinho
    for (let i = 0; i < 15; i++) {
        const produtoId = (Math.floor(Math.random() * 7) + 1); // 1-7 (evita Mouse Gamer sem estoque)
        const userId = `bf_user_${Math.floor(Math.random() * 5)}`;
        tarefas.push(internalFetch('POST', '/api/carrinho', { userId, produtoId, quantidade: 1 }));
    }

    // 5 checkouts
    for (let i = 0; i < 5; i++) {
        const userId = `bf_user_${i}`;
        // Garante que o carrinho tem itens (adiciona antes do checkout)
        await internalFetch('POST', '/api/carrinho', { userId, produtoId: 3, quantidade: 2 });
        tarefas.push(internalFetch('POST', '/api/checkout', { userId }));
    }

    const resultados = await Promise.all(tarefas);
    const erros = resultados.filter(r => r.status >= 400 || r.status === 0).length;
    logger.info('Simulação Black Friday concluída', { totalRequisicoes: 50, erros });
    res.json({ message: 'Black Friday simulada: 50 requisições disparadas', total: 50, erros });
});

// POST /simular/estoque-esgotado — 10 tentativas de comprar produto sem estoque
app.post('/simular/estoque-esgotado', async (req, res) => {
    logger.info('Simulação estoque esgotado iniciada');
    const userId = 'sim_estoque';
    const resultados = [];

    for (let i = 0; i < 10; i++) {
        const r = await internalFetch('POST', '/api/carrinho', {
            userId,
            produtoId: 4, // Mouse Gamer — estoque = 0
            quantidade: 1
        });
        resultados.push(r);
    }

    const erros400 = resultados.filter(r => r.status === 400).length;
    logger.info('Simulação estoque esgotado concluída', { tentativas: 10, erros400 });
    res.json({ message: 'Estoque esgotado simulado: 10 tentativas', total: 10, erros400 });
});

// POST /simular/falha-pagamento — cria pedido e tenta pagar 5x
app.post('/simular/falha-pagamento', async (req, res) => {
    logger.info('Simulação falha pagamento iniciada');
    const userId = 'sim_pagto';

    // Cria carrinho e faz checkout
    await internalFetch('POST', '/api/carrinho', { userId, produtoId: 1, quantidade: 1 });
    const checkoutRes = await internalFetch('POST', '/api/checkout', { userId });

    if (checkoutRes.status !== 201) {
        logger.error('Falha ao criar pedido para simulação de pagamento');
        return res.status(500).json({ error: 'Não foi possível criar pedido para simulação' });
    }

    const pedidoId = checkoutRes.data.pedido.id;
    const resultados = [];

    // Tenta pagar 5x
    for (let i = 0; i < 5; i++) {
        const r = await internalFetch('POST', '/api/pagamento', { pedidoId });
        resultados.push(r);
    }

    const falhas = resultados.filter(r => r.status !== 200).length;
    const sucessos = resultados.filter(r => r.status === 200).length;
    logger.info('Simulação falha pagamento concluída', { pedidoId, tentativas: 5, sucessos, falhas });
    res.json({ message: 'Falha de pagamento simulada: 5 tentativas', pedidoId, sucessos, falhas });
});

// POST /simular/fluxo-completo — funil completo do ecommerce
app.post('/simular/fluxo-completo', async (req, res) => {
    logger.info('Simulação fluxo completo iniciada');
    const userId = `fluxo_${Date.now()}`;
    const log = [];

    // 1. Cria usuário
    const regRes = await internalFetch('POST', '/register', { username: userId, password: 'fluxo123' });
    log.push({ etapa: 'registro', status: regRes.status });

    // 2. Busca produtos
    const buscaRes = await internalFetch('GET', '/api/produtos?q=notebook');
    log.push({ etapa: 'busca', status: buscaRes.status, encontrados: buscaRes.data?.length });

    // 3. Adiciona 3 itens ao carrinho
    const itens = [
        { produtoId: 1, quantidade: 1 }, // Notebook Pro
        { produtoId: 3, quantidade: 2 }, // Teclado Mecânico
        { produtoId: 5, quantidade: 1 }, // Headset Wireless
    ];
    for (const item of itens) {
        const carRes = await internalFetch('POST', '/api/carrinho', { userId, ...item });
        log.push({ etapa: 'add_carrinho', produtoId: item.produtoId, status: carRes.status });
    }

    // 4. Checkout
    const checkoutRes = await internalFetch('POST', '/api/checkout', { userId });
    log.push({ etapa: 'checkout', status: checkoutRes.status, pedidoId: checkoutRes.data?.pedido?.id });

    // 5. Pagamento
    let pagtoRes = { status: 0 };
    if (checkoutRes.data?.pedido?.id) {
        pagtoRes = await internalFetch('POST', '/api/pagamento', { pedidoId: checkoutRes.data.pedido.id });
        log.push({ etapa: 'pagamento', status: pagtoRes.status, aprovado: pagtoRes.status === 200 });
    }

    logger.info('Simulação fluxo completo concluída', { userId, etapas: log.length });
    res.json({ message: 'Fluxo completo simulado', userId, log });
});

// Arquivos estaticos (deve vir depois das rotas da API)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info('Servidor iniciado', { port: Number(PORT), nodeVersion: process.version });
    });
}

module.exports = app;
