const express = require('express');
const promClient = require('prom-client');
const path = require('path');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { Worker } = require('worker_threads');
const os = require('os');

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

app.use((req, res, next) => {
    const startEpoch = Date.now();
    res.on('finish', () => {
        const responseTimeInSeconds = (Date.now() - startEpoch) / 1000;
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
    });
    next();
});

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições, tente novamente mais tarde' }
});
app.use(generalLimiter);

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // 10 tentativas por 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login, tente novamente mais tarde' }
});

// Rota de métricas pro Prometheus
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

app.get('/', (req, res) => {
    console.log('[INFO] Rota raiz acessada');
    res.status(200).send('Laboratório de Observabilidade - API funcionando!');
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
        console.log(`[INFO] Usuário registrado: ${username}`);
        res.status(201).json({ id: user.id, username });
    } catch (err) {
        console.error('[Erro] Falha ao gerar hash da senha:', err.message);
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
        console.error(`[Erro] Login falhou: ${username} (usuário não encontrado)`);
        return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    try {
        const valid = await bcrypt.compare(password, user.password);
        if (valid) {
            loginsTotal.inc({ status: 'success' });
            console.log(`[INFO] Login efetuado: ${username}`);
            res.status(200).json({ message: 'Login efetuado com sucesso' });
        } else {
            loginsTotal.inc({ status: 'failure' });
            console.error(`[Erro] Login falhou: ${username} (senha incorreta)`);
            res.status(401).json({ error: 'Credenciais inválidas' });
        }
    } catch (err) {
        console.error('[Erro] Falha ao verificar senha:', err.message);
        res.status(500).json({ error: 'Erro interno ao processar login' });
    }
});

app.get('/users', (req, res) => {
    crudOperationsTotal.inc({ operation: 'read', status: 'success' });
    console.log('[INFO] Listando usuários');
    res.json(users.map(u => ({ id: u.id, username: u.username })));
});

app.get('/users/:id', (req, res) => {
    const { id } = req.params;
    const user = users.find(u => u.id == id);
    if (user) {
        crudOperationsTotal.inc({ operation: 'read', status: 'success' });
        console.log(`[INFO] Usuário ${id} encontrado`);
        res.json({ id: user.id, username: user.username });
    } else {
        crudOperationsTotal.inc({ operation: 'read', status: 'error' });
        errorsTotal.inc({ type: 'not_found', endpoint: '/users/:id' });
        console.error(`[Erro] Usuário ${id} não encontrado`);
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
        console.error(`[Erro] Falha ao atualizar: Usuário ${id} não encontrado`);
        return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    if (!username && !password) {
        errorsTotal.inc({ type: 'validation', endpoint: '/users/:id' });
        return res.status(400).json({ error: 'Nenhum campo para atualizar. Envie username e/ou password.' });
    }
    if (username) user.username = username;
    if (password) user.password = password;
    crudOperationsTotal.inc({ operation: 'update', status: 'success' });
    console.log(`[INFO] Usuário ${id} atualizado`);
    res.json({ id: user.id, username: user.username });
});

app.delete('/users/:id', (req, res) => {
    const { id } = req.params;
    const index = users.findIndex(u => u.id == id);
    if (index !== -1) {
        users.splice(index, 1);
        crudOperationsTotal.inc({ operation: 'delete', status: 'success' });
        activeUsersGauge.dec();
        console.log(`[INFO] Usuário ${id} deletado`);
        res.status(204).send();
    } else {
        crudOperationsTotal.inc({ operation: 'delete', status: 'error' });
        errorsTotal.inc({ type: 'not_found', endpoint: '/users/:id' });
        console.error(`[Erro] Falha ao deletar: Usuário ${id} não encontrado`);
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

app.get('/incidente-erro', (req, res) => {
    console.error('[Erro] Simulação de incidente de alta taxa de erro disparada!');
    res.status(500).json({ error: 'Internal Server Error Simulado' });
});

app.get('/incidente-cpu', (req, res) => {
    const numCores = os.cpus().length;
    console.log(`[INFO] Iniciando simulação de pico de CPU em ${numCores} núcleos...`);
    let completedWorkers = 0;
    for (let i = 0; i < numCores; i++) {
        const worker = new Worker(path.join(__dirname, 'cpu-worker.js'));
        worker.on('exit', () => {
            completedWorkers++;
            if (completedWorkers === numCores) {
                console.log('[INFO] Simulação de pico de CPU finalizada.');
            }
        });
    }
    res.status(200).json({ message: `Pico de CPU gerado em ${numCores} núcleos` });
});

app.get('/incidente-delay', (req, res) => {
    console.log('[INFO] Iniciando simulação de instabilidade (delay de 10s)...');
    setTimeout(() => {
        console.log('[INFO] Resposta atrasada enviada.');
        res.status(200).json({ message: 'Resposta com delay de 10 segundos' });
    }, 10000);
});

// Arquivos estaticos (deve vir depois das rotas da API)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[INFO] Aplicação rodando na porta ${PORT}`);
    });
}

module.exports = app;
