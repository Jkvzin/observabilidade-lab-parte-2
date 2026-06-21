const express = require('express');
const promClient = require('prom-client');
const path = require('path');
const { Worker } = require('worker_threads');
const os = require('os');
const logger = require('./logger');

const app = express();
app.use(express.json());
app.set('json spaces', 2); // Deixa o output do JSON formatado e com quebra de linha no curl
app.use(express.static(path.join(__dirname, 'public')));

// Registro de métricas Prometheus
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'node_app_' });

// Métrica customizada: requisições HTTP
const httpRequestsTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total de requisições HTTP',
    labelNames: ['method', 'route', 'status_code']
});

// Métrica de Latência: Tempo de resposta (Histogram)
const httpRequestDurationSeconds = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP em segundos',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 15] // Buckets de tempo em segundos
});

// Middleware para contar requisições, medir latência e gerar log estruturado
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

        // Log estruturado da requisição HTTP
        const logCtx = { method: req.method, path: req.path, statusCode: res.statusCode, duration: durationMs };
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

// Rota de métricas pro Prometheus
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

// Banco em memória
const users = [];
let currentId = 1;

// Rotas CRUD e Login
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        logger.warn('Falha ao registrar usuário: dados incompletos', { username });
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    const user = { id: currentId++, username, password };
    users.push(user);
    logger.info('Usuário registrado', { username, userId: user.id });
    res.status(201).json({ id: user.id, username });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        logger.info('Login efetuado', { username, userId: user.id });
        res.status(200).json({ message: 'Login efetuado com sucesso' });
    } else {
        logger.warn('Login falhou', { username, reason: 'credenciais_invalidas' });
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});

app.get('/users', (req, res) => {
    logger.info('Listando usuários', { count: users.length });
    res.json(users.map(u => ({ id: u.id, username: u.username })));
});

app.put('/users/:id', (req, res) => {
    const { id } = req.params;
    const { username, password } = req.body;
    const user = users.find(u => u.id == id);
    if (user) {
        if (username) user.username = username;
        if (password) user.password = password;
        logger.info('Usuário atualizado', { userId: Number(id), username: user.username });
        res.json({ id: user.id, username: user.username });
    } else {
        logger.warn('Usuário não encontrado para atualização', { userId: Number(id) });
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

app.delete('/users/:id', (req, res) => {
    const { id } = req.params;
    const index = users.findIndex(u => u.id == id);
    if (index !== -1) {
        users.splice(index, 1);
        logger.info('Usuário deletado', { userId: Number(id) });
        res.status(204).send();
    } else {
        logger.warn('Usuário não encontrado para deleção', { userId: Number(id) });
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

// Gatilhos de Incidentes
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

// Inicialização
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info('Servidor iniciado', { port: Number(PORT), nodeVersion: process.version });
});
