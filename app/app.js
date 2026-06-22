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

// ==================== METRICAS HTTP ====================
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

// ==================== METRICAS DE AUTENTICACAO ====================
const registrationsTotal = new promClient.Counter({
    name: 'app_registrations_total',
    help: 'Total de registros de usuários'
});

const loginsTotal = new promClient.Counter({
    name: 'app_logins_total',
    help: 'Total de logins',
    labelNames: ['status']
});

const activeUsersGauge = new promClient.Gauge({
    name: 'app_active_users',
    help: 'Número de usuários cadastrados'
});

// ==================== METRICAS DE NEGOCIO (ECOMMERCE) ====================
const productsTotal = new promClient.Gauge({
    name: 'app_products_total',
    help: 'Total de produtos cadastrados'
});

const stockByProduct = new promClient.Gauge({
    name: 'app_stock_total',
    help: 'Estoque por produto',
    labelNames: ['product']
});

const cartItemsTotal = new promClient.Gauge({
    name: 'app_cart_items_total',
    help: 'Total de itens nos carrinhos de todos os usuarios'
});

const ordersTotal = new promClient.Counter({
    name: 'app_orders_total',
    help: 'Pedidos por status',
    labelNames: ['status']
});

const revenueTotal = new promClient.Counter({
    name: 'app_revenue_total',
    help: 'Receita total em R$ (pedidos pagos)'
});

const paymentsTotal = new promClient.Counter({
    name: 'app_payments_total',
    help: 'Pagamentos processados',
    labelNames: ['status']
});

const checkoutsTotal = new promClient.Counter({
    name: 'app_checkouts_total',
    help: 'Total de checkouts realizados'
});

const errorsTotal = new promClient.Counter({
    name: 'app_errors_total',
    help: 'Total de erros da aplicação',
    labelNames: ['type', 'endpoint']
});

const healthStatusGauge = new promClient.Gauge({
    name: 'app_health_status',
    help: 'Status de saúde da aplicação (1=UP, 0=DOWN)'
});

// ==================== MIDDLEWARE DE METRICAS + LOGGING ====================
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

// ==================== RATE LIMITING ====================
const generalLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições, tente novamente mais tarde' }
});
app.use(generalLimiter);

const loginLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login, tente novamente em 30 segundos' }
});

const checkoutLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitos checkouts, tente novamente em 30 segundos' }
});

// ==================== DADOS EM MEMORIA ====================
const users = [];
const products = [];
const carts = {};  // userId -> [{productId, quantity}]
const orders = [];
let currentId = 1;
const SALT_ROUNDS = 10;

// Seed de produtos iniciais
function seedProducts() {
    if (products.length > 0) return;
    const catalog = [
        { name: 'Notebook Gamer Pro', price: 4999.90, description: 'RTX 4060, 16GB RAM, 512GB SSD', category: 'Eletrônicos', stock: 15 },
        { name: 'Smartphone X1', price: 2999.90, description: '6.7" AMOLED, 256GB, 5G', category: 'Eletrônicos', stock: 30 },
        { name: 'Fone Bluetooth ANC', price: 349.90, description: 'Cancelamento de ruído ativo, 30h bateria', category: 'Acessórios', stock: 50 },
        { name: 'Mouse Gamer RGB', price: 199.90, description: '16000 DPI, 8 botões programáveis', category: 'Acessórios', stock: 40 },
        { name: 'Teclado Mecânico Switch Blue', price: 449.90, description: 'RGB, ABNT2, switches Outemu Blue', category: 'Acessórios', stock: 25 },
        { name: 'Monitor 27" 144Hz', price: 1599.90, description: 'IPS, 1ms, FreeSync', category: 'Eletrônicos', stock: 12 },
        { name: 'Cadeira Gamer Ergonômica', price: 1899.90, description: 'Reclinável, apoio lombar, 150kg', category: 'Móveis', stock: 8 },
        { name: 'SSD NVMe 1TB', price: 449.90, description: 'Leitura 3500MB/s, PCIe 4.0', category: 'Componentes', stock: 60 },
        { name: 'Webcam 4K', price: 599.90, description: 'Auto-foco, microfone integrado, USB-C', category: 'Acessórios', stock: 18 },
        { name: 'Roteador Wi-Fi 6', price: 799.90, description: 'AX3000, dual-band, mesh-ready', category: 'Redes', stock: 22 },
    ];
    catalog.forEach(p => {
        const product = { id: currentId++, ...p };
        products.push(product);
        productsTotal.inc();
        stockByProduct.set({ product: product.name }, product.stock);
    });
    logger.info('Catálogo de produtos inicializado', { totalProducts: products.length });
}

seedProducts();

// ==================== VALIDACAO ====================
function validateUsername(username) {
    if (!username || typeof username !== 'string') return false;
    if (username.length < 3 || username.length > 30) return false;
    return /^[a-zA-Z0-9_]+$/.test(username);
}

function validatePassword(password) {
    return password && typeof password === 'string' && password.length >= 6;
}

function getCart(userId) {
    if (!carts[userId]) carts[userId] = [];
    return carts[userId];
}

function getUserIdFromAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    const user = users.find(u => u.token === token);
    return user ? user.id : null;
}

// ==================== ROTAS DE METRICAS E HEALTH ====================
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

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

// ==================== AUTENTICACAO ====================
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!validateUsername(username)) {
        return res.status(400).json({ error: 'Username inválido. Use 3-30 caracteres alfanuméricos.' });
    }
    if (!validatePassword(password)) {
        return res.status(400).json({ error: 'Senha inválida. Mínimo de 6 caracteres.' });
    }
    if (users.find(u => u.username === username)) {
        return res.status(409).json({ error: 'Usuário já existe' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const token = require('crypto').randomBytes(32).toString('hex');
        const user = { id: currentId++, username, password: hashedPassword, token };
        users.push(user);
        registrationsTotal.inc();
        activeUsersGauge.inc();
        logger.info('Usuário registrado', { username, userId: user.id, action: 'user_registered' });
        res.status(201).json({ id: user.id, username, token });
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
        logger.warn('Login falhou', { username, reason: 'usuario_nao_encontrado', action: 'login_failed' });
        return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    try {
        const valid = await bcrypt.compare(password, user.password);
        if (valid) {
            user.token = require('crypto').randomBytes(32).toString('hex');
            loginsTotal.inc({ status: 'success' });
            logger.info('Login efetuado', { username, userId: user.id, action: 'login_success' });
            res.status(200).json({ message: 'Login efetuado com sucesso', token: user.token, userId: user.id });
        } else {
            loginsTotal.inc({ status: 'failure' });
            logger.warn('Login falhou', { username, reason: 'senha_incorreta', action: 'login_failed' });
            res.status(401).json({ error: 'Credenciais inválidas' });
        }
    } catch (err) {
        logger.error('Falha ao verificar senha', { error: err.message });
        res.status(500).json({ error: 'Erro interno ao processar login' });
    }
});

// ==================== USUARIOS (mantido para compatibilidade) ====================
app.get('/users', (req, res) => {
    logger.info('Listando usuários', { count: users.length });
    res.json(users.map(u => ({ id: u.id, username: u.username })));
});

// ==================== PRODUTOS ====================
app.get('/products', (req, res) => {
    const { category } = req.query;
    let result = products;
    if (category) {
        result = products.filter(p => p.category.toLowerCase() === category.toLowerCase());
    }
    logger.info('Catálogo consultado', { totalProducts: products.length, filtered: result.length, category: category || 'todas', action: 'catalog_view' });
    res.json(result.map(p => ({ id: p.id, name: p.name, price: p.price, description: p.description, category: p.category, stock: p.stock })));
});

app.get('/products/:id', (req, res) => {
    const { id } = req.params;
    const product = products.find(p => p.id == id);
    if (product) {
        logger.info('Produto visualizado', { productId: Number(id), productName: product.name, action: 'product_view' });
        res.json(product);
    } else {
        errorsTotal.inc({ type: 'not_found', endpoint: '/products/:id' });
        logger.warn('Produto não encontrado', { productId: Number(id), action: 'product_not_found' });
        res.status(404).json({ error: 'Produto não encontrado' });
    }
});

app.post('/products', (req, res) => {
    const { name, price, description, category, stock } = req.body;
    if (!name || !price || !category || stock === undefined) {
        return res.status(400).json({ error: 'Campos obrigatórios: name, price, category, stock' });
    }
    const product = {
        id: currentId++,
        name,
        price: parseFloat(price),
        description: description || '',
        category,
        stock: parseInt(stock)
    };
    products.push(product);
    productsTotal.inc();
    stockByProduct.set({ product: product.name }, product.stock);
    logger.info('Produto criado', { productId: product.id, productName: product.name, price: product.price, category: product.category, stock: product.stock, action: 'product_created' });
    res.status(201).json(product);
});

app.put('/products/:id', (req, res) => {
    const { id } = req.params;
    const { name, price, description, category, stock } = req.body;
    const product = products.find(p => p.id == id);
    if (!product) {
        errorsTotal.inc({ type: 'not_found', endpoint: '/products/:id' });
        logger.warn('Produto nao encontrado para atualizacao', { productId: Number(id), action: 'product_update_failed' });
        return res.status(404).json({ error: 'Produto nao encontrado' });
    }
    if (!name && !price && !category && stock === undefined) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar. Envie name, price, category, description e/ou stock.' });
    }
    const oldStock = product.stock;
    if (name) product.name = name;
    if (price !== undefined) product.price = parseFloat(price);
    if (description !== undefined) product.description = description;
    if (category) product.category = category;
    if (stock !== undefined) {
        product.stock = parseInt(stock);
        stockByProduct.set({ product: product.name }, product.stock);
        if (product.stock < 5 && oldStock >= 5) {
            logger.warn('Alerta de estoque baixo apos atualizacao', { productId: product.id, productName: product.name, currentStock: product.stock, threshold: 5, action: 'low_stock_alert' });
        }
    }
    logger.info('Produto atualizado', { productId: product.id, productName: product.name, price: product.price, category: product.category, stock: product.stock, action: 'product_updated' });
    res.json(product);
});

app.delete('/products/:id', (req, res) => {
    const { id } = req.params;
    const index = products.findIndex(p => p.id == id);
    if (index !== -1) {
        const removed = products[index];
        products.splice(index, 1);
        productsTotal.dec();
        stockByProduct.remove({ product: removed.name });
        logger.info('Produto removido', { productId: Number(id), productName: removed.name, action: 'product_deleted' });
        res.status(204).send();
    } else {
        errorsTotal.inc({ type: 'not_found', endpoint: '/products/:id' });
        logger.warn('Produto nao encontrado para remocao', { productId: Number(id), action: 'product_delete_failed' });
        res.status(404).json({ error: 'Produto nao encontrado' });
    }
});

// ==================== CARRINHO ====================
app.get('/cart', (req, res) => {
    const userId = getUserIdFromAuth(req);
    if (!userId) return res.status(401).json({ error: 'Token de autenticação necessário (header Authorization: Bearer <token>)' });

    const cart = getCart(userId);
    const items = cart.map(item => {
        const product = products.find(p => p.id === item.productId);
        return product
            ? { productId: product.id, name: product.name, price: product.price, quantity: item.quantity, subtotal: product.price * item.quantity }
            : null;
    }).filter(Boolean);
    const total = items.reduce((sum, i) => sum + i.subtotal, 0);
    logger.info('Carrinho consultado', { userId, itemsCount: items.length, cartTotal: total, action: 'cart_view' });
    res.json({ items, total });
});

app.post('/cart', (req, res) => {
    const userId = getUserIdFromAuth(req);
    if (!userId) return res.status(401).json({ error: 'Token de autenticação necessário' });

    const { productId, quantity = 1 } = req.body;
    const product = products.find(p => p.id == productId);
    if (!product) {
        errorsTotal.inc({ type: 'not_found', endpoint: '/cart' });
        return res.status(404).json({ error: 'Produto não encontrado' });
    }
    if (product.stock < quantity) {
        logger.warn('Estoque insuficiente', { userId, productId, productName: product.name, requested: quantity, available: product.stock, action: 'cart_add_failed' });
        return res.status(400).json({ error: `Estoque insuficiente. Disponível: ${product.stock}` });
    }

    const cart = getCart(userId);
    const existing = cart.find(i => i.productId == productId);
    if (existing) {
        if (product.stock < existing.quantity + quantity) {
            return res.status(400).json({ error: `Estoque insuficiente. Disponível: ${product.stock}, já no carrinho: ${existing.quantity}` });
        }
        existing.quantity += quantity;
    } else {
        cart.push({ productId: product.id, quantity });
    }
    cartItemsTotal.inc(quantity);
    logger.info('Item adicionado ao carrinho', { userId, productId, productName: product.name, quantity, unitPrice: product.price, action: 'cart_add' });
    res.json({ message: 'Item adicionado ao carrinho', cartSize: cart.length });
});

app.delete('/cart/:productId', (req, res) => {
    const userId = getUserIdFromAuth(req);
    if (!userId) return res.status(401).json({ error: 'Token de autenticação necessário' });

    const { productId } = req.params;
    const cart = getCart(userId);
    const idx = cart.findIndex(i => i.productId == productId);
    if (idx === -1) return res.status(404).json({ error: 'Item não está no carrinho' });

    const removed = cart.splice(idx, 1)[0];
    cartItemsTotal.dec(removed.quantity);
    logger.info('Item removido do carrinho', { userId, productId: Number(productId), quantity: removed.quantity, action: 'cart_remove' });
    res.json({ message: 'Item removido do carrinho' });
});

// ==================== CHECKOUT E PEDIDOS ====================
app.post('/checkout', checkoutLimiter, (req, res) => {
    const userId = getUserIdFromAuth(req);
    if (!userId) return res.status(401).json({ error: 'Token de autenticação necessário' });

    const cart = getCart(userId);
    if (cart.length === 0) return res.status(400).json({ error: 'Carrinho vazio' });

    // Validar estoque
    for (const item of cart) {
        const product = products.find(p => p.id === item.productId);
        if (!product || product.stock < item.quantity) {
            return res.status(400).json({ error: `Estoque insuficiente para o produto ID ${item.productId}` });
        }
    }

    // Criar pedido
    const orderItems = cart.map(item => {
        const product = products.find(p => p.id === item.productId);
        product.stock -= item.quantity;
        stockByProduct.set({ product: product.name }, product.stock);
        if (product.stock < 5) {
            logger.warn('Alerta de estoque baixo', { productId: product.id, productName: product.name, currentStock: product.stock, threshold: 5, action: 'low_stock_alert' });
        }
        return {
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity: item.quantity,
            subtotal: product.price * item.quantity
        };
    });

    const totalValue = orderItems.reduce((sum, i) => sum + i.subtotal, 0);
    const order = {
        id: currentId++,
        userId,
        items: orderItems,
        totalValue,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    orders.push(order);

    // Limpar carrinho
    const cartSize = cart.length;
    carts[userId] = [];

    ordersTotal.inc({ status: 'pending' });
    checkoutsTotal.inc();
    cartItemsTotal.set(0); // reset após checkout (aproximado)

    logger.info('Checkout realizado', { userId, orderId: order.id, totalItems: cartSize, totalValue, action: 'checkout' });
    res.status(201).json({ orderId: order.id, totalValue, status: 'pending', message: 'Pedido criado com sucesso!' });
});

app.get('/orders', (req, res) => {
    const userId = getUserIdFromAuth(req);
    if (!userId) return res.status(401).json({ error: 'Token de autenticação necessário' });

    const userOrders = orders.filter(o => o.userId === userId).reverse();
    logger.info('Pedidos consultados', { userId, ordersCount: userOrders.length, action: 'orders_view' });
    res.json(userOrders);
});

app.get('/orders/:id', (req, res) => {
    const { id } = req.params;
    const order = orders.find(o => o.id == id);
    if (order) {
        logger.info('Pedido visualizado', { orderId: Number(id), status: order.status, action: 'order_view' });
        res.json(order);
    } else {
        errorsTotal.inc({ type: 'not_found', endpoint: '/orders/:id' });
        res.status(404).json({ error: 'Pedido não encontrado' });
    }
});

// ==================== PAGAMENTO ====================
app.post('/orders/:id/pay', (req, res) => {
    const { id } = req.params;
    const order = orders.find(o => o.id == id);
    if (!order) {
        errorsTotal.inc({ type: 'not_found', endpoint: '/orders/:id/pay' });
        return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    if (order.status !== 'pending') {
        return res.status(400).json({ error: `Pedido com status "${order.status}" não pode ser pago` });
    }

    // Simular pagamento: ~85% sucesso, ~15% falha
    const success = Math.random() > 0.15;
    const oldStatus = order.status;
    order.status = success ? 'paid' : 'cancelled';
    ordersTotal.inc({ status: order.status });
    paymentsTotal.inc({ status: success ? 'success' : 'failure' });

    if (success) {
        revenueTotal.inc(order.totalValue);
        logger.info('Pagamento processado com sucesso', { userId: order.userId, orderId: order.id, orderValue: order.totalValue, paymentStatus: 'success', action: 'payment_processed' });
        res.json({ orderId: order.id, status: 'paid', message: 'Pagamento aprovado!' });
    } else {
        logger.warn('Pagamento recusado', { userId: order.userId, orderId: order.id, orderValue: order.totalValue, paymentStatus: 'failure', action: 'payment_processed' });
        res.status(402).json({ orderId: order.id, status: 'cancelled', error: 'Pagamento recusado pela operadora' });
    }
});

// Adicionar rota para admin atualizar status do pedido (shipped, delivered)
app.patch('/orders/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Status inválido. Válidos: ${validStatuses.join(', ')}` });
    }
    const order = orders.find(o => o.id == id);
    if (!order) {
        errorsTotal.inc({ type: 'not_found', endpoint: '/orders/:id/status' });
        return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    const oldStatus = order.status;
    order.status = status;
    logger.info('Status do pedido atualizado', { orderId: Number(id), oldStatus, newStatus: status, action: 'order_status_changed' });
    res.json({ orderId: order.id, status, oldStatus });
});

// ==================== INCIDENTES (TECNICOS) ====================
app.get('/incidente-erro', (req, res) => {
    logger.error('Simulação de incidente de alta taxa de erro disparada', { incidente: 'erro_500', action: 'incident_trigger' });
    res.status(500).json({ error: 'Internal Server Error Simulado' });
});

app.get('/incidente-cpu', (req, res) => {
    const numCores = os.cpus().length;
    logger.info('Iniciando simulação de pico de CPU', { incidente: 'cpu', numCores, action: 'incident_trigger' });
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
    logger.info('Iniciando simulação de instabilidade (delay)', { incidente: 'delay_10s', action: 'incident_trigger' });
    setTimeout(() => {
        logger.info('Resposta atrasada enviada', { incidente: 'delay_10s' });
        res.status(200).json({ message: 'Resposta com delay de 10 segundos' });
    }, 10000);
});

// ==================== SIMULACOES DE CENARIOS REALISTAS (ECOMMERCE) ====================
app.post('/simular/black-friday', async (req, res) => {
    logger.info('Simulação Black Friday iniciada', { action: 'simulation_black_friday_start' });
    const results = { catalogViews: 0, cartAdds: 0, checkouts: 0, errors: 0 };

    for (let i = 0; i < 50; i++) {
        try {
            const rand = Math.random();
            if (rand < 0.6) {
                // 60%: visualizar catálogo
                results.catalogViews++;
            } else if (rand < 0.9) {
                // 30%: adicionar ao carrinho (produto aleatório)
                const product = products[Math.floor(Math.random() * products.length)];
                if (product && product.stock > 0) {
                    const cart = getCart(999); // usuário anônimo de simulação
                    const existing = cart.find(c => c.productId === product.id);
                    if (existing) existing.quantity++;
                    else cart.push({ productId: product.id, quantity: 1 });
                    cartItemsTotal.inc();
                    results.cartAdds++;
                }
            } else {
                // 10%: checkout (se tiver itens no carrinho)
                const cart = getCart(999);
                if (cart.length > 0) {
                    for (const item of cart) {
                        const prod = products.find(p => p.id === item.productId);
                        if (prod && prod.stock >= item.quantity) {
                            prod.stock -= item.quantity;
                            stockByProduct.set({ product: prod.name }, prod.stock);
                        }
                    }
                    const order = {
                        id: currentId++,
                        userId: 999,
                        items: cart.map(item => {
                            const p = products.find(pr => pr.id === item.productId);
                            return { productId: item.productId, name: p.name, price: p.price, quantity: item.quantity, subtotal: p.price * item.quantity };
                        }),
                        totalValue: cart.reduce((sum, item) => {
                            const p = products.find(pr => pr.id === item.productId);
                            return sum + (p ? p.price * item.quantity : 0);
                        }, 0),
                        status: 'pending',
                        createdAt: new Date().toISOString()
                    };
                    orders.push(order);
                    ordersTotal.inc({ status: 'pending' });
                    checkoutsTotal.inc();
                    carts[999] = [];
                    cartItemsTotal.set(0);
                    results.checkouts++;
                }
            }
        } catch (e) {
            results.errors++;
        }
    }

    logger.info('Simulação Black Friday concluída', { action: 'simulation_black_friday_end', ...results });
    res.json({ message: 'Black Friday simulada!', results });
});

app.post('/simular/estoque-esgotado', (req, res) => {
    logger.info('Simulação estoque esgotado iniciada', { action: 'simulation_stock_out_start' });
    const outOfStockProduct = products.find(p => p.stock === 0) || products[0];
    const originalStock = outOfStockProduct.stock;
    outOfStockProduct.stock = 0;
    stockByProduct.set({ product: outOfStockProduct.name }, 0);

    const results = [];
    for (let i = 0; i < 10; i++) {
        const cart = getCart(998);
        const existing = cart.find(c => c.productId === outOfStockProduct.id);
        if (existing && existing.quantity >= 99) {
            results.push({ attempt: i + 1, status: 400, error: 'Estoque insuficiente' });
        } else if (originalStock === 0) {
            results.push({ attempt: i + 1, status: 400, error: 'Estoque insuficiente' });
        } else {
            results.push({ attempt: i + 1, status: 400, error: 'Estoque insuficiente' });
        }
        errorsTotal.inc({ type: 'validation', endpoint: '/cart' });
    }

    outOfStockProduct.stock = originalStock;
    stockByProduct.set({ product: outOfStockProduct.name }, originalStock);
    logger.info('Simulação estoque esgotado concluída', { action: 'simulation_stock_out_end', attempts: 10, product: outOfStockProduct.name });
    res.json({ message: `Simulação concluída: 10 tentativas de comprar "${outOfStockProduct.name}" com estoque zerado`, results });
});

app.post('/simular/falha-pagamento', async (req, res) => {
    logger.info('Simulação falha de pagamento iniciada', { action: 'simulation_payment_failure_start' });

    // Criar pedido de teste
    const product = products.find(p => p.stock > 2) || products[0];
    const order = {
        id: currentId++,
        userId: 997,
        items: [{
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity: 1,
            subtotal: product.price
        }],
        totalValue: product.price,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    orders.push(order);
    ordersTotal.inc({ status: 'pending' });

    // Tentar pagar 5x (a lógica normal tem 15% falha, então estatisticamente teremos falhas)
    const payResults = [];
    for (let i = 0; i < 5; i++) {
        // Recriar pedido se já foi pago/cancelado
        if (order.status !== 'pending') {
            order.id = currentId++;
            order.status = 'pending';
            orders.push(order);
            ordersTotal.inc({ status: 'pending' });
        }
        const success = Math.random() > 0.15;
        order.status = success ? 'paid' : 'cancelled';
        ordersTotal.inc({ status: order.status });
        paymentsTotal.inc({ status: success ? 'success' : 'failure' });
        if (success) revenueTotal.inc(order.totalValue);
        payResults.push({ attempt: i + 1, success, status: order.status });
    }

    logger.info('Simulação falha de pagamento concluída', { action: 'simulation_payment_failure_end', results: payResults });
    res.json({ message: '5 tentativas de pagamento simuladas', results: payResults });
});

app.post('/simular/fluxo-completo', async (req, res) => {
    logger.info('Simulação fluxo completo iniciada', { action: 'simulation_flow_start' });
    const flow = [];

    try {
        // 1. Registrar usuário
        const testUser = `cliente_${Date.now()}`;
        const hashedPassword = await bcrypt.hash('teste123', SALT_ROUNDS);
        const token = require('crypto').randomBytes(32).toString('hex');
        const user = { id: currentId++, username: testUser, password: hashedPassword, token };
        users.push(user);
        registrationsTotal.inc();
        activeUsersGauge.inc();
        flow.push({ step: 'registro', username: testUser, userId: user.id });

        // 2. Buscar catálogo
        const availableProducts = products.filter(p => p.stock > 0);
        flow.push({ step: 'catalogo', produtosDisponiveis: availableProducts.length });

        // 3. Adicionar 3 itens ao carrinho
        const cart = getCart(user.id);
        const selected = availableProducts.slice(0, 3);
        for (const p of selected) {
            cart.push({ productId: p.id, quantity: 1 });
            cartItemsTotal.inc();
        }
        flow.push({ step: 'carrinho', itens: selected.map(p => p.name) });

        // 4. Checkout
        const orderItems = cart.map(item => {
            const p = products.find(pr => pr.id === item.productId);
            p.stock -= item.quantity;
            stockByProduct.set({ product: p.name }, p.stock);
            return { productId: p.id, name: p.name, price: p.price, quantity: item.quantity, subtotal: p.price * item.quantity };
        });
        const totalValue = orderItems.reduce((s, i) => s + i.subtotal, 0);
        const order = {
            id: currentId++,
            userId: user.id,
            items: orderItems,
            totalValue,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        orders.push(order);
        ordersTotal.inc({ status: 'pending' });
        checkoutsTotal.inc();
        carts[user.id] = [];
        flow.push({ step: 'checkout', orderId: order.id, totalValue });

        // 5. Pagar
        const paySuccess = Math.random() > 0.15;
        order.status = paySuccess ? 'paid' : 'cancelled';
        ordersTotal.inc({ status: order.status });
        paymentsTotal.inc({ status: paySuccess ? 'success' : 'failure' });
        if (paySuccess) revenueTotal.inc(order.totalValue);
        flow.push({ step: 'pagamento', status: order.status, success: paySuccess });

        logger.info('Simulação fluxo completo concluída', { action: 'simulation_flow_end', userId: user.id, orderId: order.id, paymentStatus: order.status });
        res.json({ message: 'Fluxo completo simulado!', flow });
    } catch (err) {
        logger.error('Erro na simulação de fluxo completo', { error: err.message, action: 'simulation_flow_error' });
        res.status(500).json({ error: 'Erro na simulação', flow });
    }
});

// ==================== ARQUIVOS ESTATICOS ====================
app.use(express.static(path.join(__dirname, 'public')));

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info('Servidor iniciado', { port: Number(PORT), nodeVersion: process.version, mode: 'ecommerce' });
    });
}

module.exports = app;
