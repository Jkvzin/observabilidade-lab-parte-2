const express = require('express');
const promClient = require('prom-client');
const path = require('path');
const { Worker } = require('worker_threads');
const os = require('os');

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

// Middleware para contar requisições e medir latência
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
        console.error('[Erro] Falha ao registrar usuário: dados incompletos');
        return res.status(400).json({ error: 'Dados incompletos' });
    }
    const user = { id: currentId++, username, password };
    users.push(user);
    console.log(`[INFO] Usuário registrado com sucesso: ${username}`);
    res.status(201).json({ id: user.id, username });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        console.log(`[INFO] Login efetuado com sucesso para o usuário: ${username}`);
        res.status(200).json({ message: 'Login efetuado com sucesso' });
    } else {
        console.error('[Erro] Login falhou para o usuário: ' + username);
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});

app.get('/users', (req, res) => {
    console.log('[INFO] Listando usuários');
    res.json(users.map(u => ({ id: u.id, username: u.username })));
});

app.put('/users/:id', (req, res) => {
    const { id } = req.params;
    const { username, password } = req.body;
    const user = users.find(u => u.id == id);
    if (user) {
        if (username) user.username = username;
        if (password) user.password = password;
        console.log(`[INFO] Usuário ${id} atualizado com sucesso`);
        res.json({ id: user.id, username: user.username });
    } else {
        console.error(`[Erro] Falha ao atualizar: Usuário ${id} não encontrado`);
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

app.delete('/users/:id', (req, res) => {
    const { id } = req.params;
    const index = users.findIndex(u => u.id == id);
    if (index !== -1) {
        users.splice(index, 1);
        console.log(`[INFO] Usuário ${id} deletado com sucesso`);
        res.status(204).send();
    } else {
        console.error(`[Erro] Falha ao deletar: Usuário ${id} não encontrado`);
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});

// Gatilhos de Incidentes
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

// Inicialização
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`[INFO] Aplicação rodando na porta ${PORT}`);
});
