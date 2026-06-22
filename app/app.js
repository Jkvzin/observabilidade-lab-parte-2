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

// Arquivos estaticos (deve vir depois das rotas da API)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info('Servidor iniciado', { port: Number(PORT), nodeVersion: process.version });
    });
}

module.exports = app;
