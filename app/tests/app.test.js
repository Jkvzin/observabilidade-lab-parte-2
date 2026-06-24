const request = require('supertest');
const app = require('../app');

describe('API JJ Eletronicos - Ecommerce', () => {
    // ==================== HEALTH ====================
    describe('GET /', () => {
        test('deve redirecionar para o dashboard HTML (302)', async () => {
            const res = await request(app).get('/');
            expect(res.statusCode).toBe(302);
        });
    });

    describe('GET /health', () => {
        test('deve retornar 200 com status UP', async () => {
            const res = await request(app).get('/health');
            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('UP');
        });
    });

    // ==================== AUTENTICACAO ====================
    describe('POST /register', () => {
        test('deve criar usuario e retornar 201', async () => {
            const res = await request(app)
                .post('/register')
                .send({ username: 'cliente01', password: 'senha123' });
            expect(res.statusCode).toBe(201);
            expect(res.body.username).toBe('cliente01');
            expect(res.body.token).toBeDefined();
        });

        test('deve rejeitar username duplicado (409)', async () => {
            await request(app).post('/register').send({ username: 'duplicado', password: 'senha123' });
            const res = await request(app).post('/register').send({ username: 'duplicado', password: 'senha123' });
            expect(res.statusCode).toBe(409);
        });

        test('deve rejeitar registro sem username (400)', async () => {
            const res = await request(app)
                .post('/register')
                .send({ password: 'senha123' });
            expect(res.statusCode).toBe(400);
        });

        test('deve rejeitar registro sem password (400)', async () => {
            const res = await request(app)
                .post('/register')
                .send({ username: 'falha' });
            expect(res.statusCode).toBe(400);
        });

        test('deve rejeitar registro com body vazio (400)', async () => {
            const res = await request(app).post('/register').send({});
            expect(res.statusCode).toBe(400);
        });
    });

    describe('POST /login', () => {
        const testLoginUser = 'loginuser_' + Date.now();

        beforeAll(async () => {
            await request(app).post('/register').send({ username: testLoginUser, password: 'senha123' });
        });

        test('deve logar com credenciais corretas (200)', async () => {
            const res = await request(app)
                .post('/login')
                .send({ username: testLoginUser, password: 'senha123' });
            expect(res.statusCode).toBe(200);
            expect(res.body.token).toBeDefined();
        });

        test('deve rejeitar senha incorreta (401)', async () => {
            const res = await request(app)
                .post('/login')
                .send({ username: testLoginUser, password: 'errada' });
            expect(res.statusCode).toBe(401);
        });

        test('deve rejeitar usuario inexistente (401)', async () => {
            const res = await request(app)
                .post('/login')
                .send({ username: 'fantasma_xyz', password: 'senha123' });
            expect(res.statusCode).toBe(401);
        });

        test('deve rejeitar campos vazios (400)', async () => {
            const res = await request(app).post('/login').send({});
            expect(res.statusCode).toBe(400);
        });
    });

    // ==================== PRODUTOS ====================
    describe('GET /products', () => {
        test('deve retornar catalogo de produtos (200)', async () => {
            const res = await request(app).get('/products');
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThanOrEqual(10);
            expect(res.body[0]).toHaveProperty('name');
            expect(res.body[0]).toHaveProperty('price');
            expect(res.body[0]).toHaveProperty('category');
            expect(res.body[0]).toHaveProperty('stock');
        });

        test('deve filtrar por categoria', async () => {
            const res = await request(app).get('/products?category=Eletronicos');
            expect(res.statusCode).toBe(200);
            res.body.forEach(p => {
                expect(p.category).toBe('Eletrônicos');
            });
        });
    });

    describe('GET /products/:id', () => {
        test('deve retornar produto existente (200)', async () => {
            const catalog = await request(app).get('/products');
            const firstId = catalog.body[0].id;
            const res = await request(app).get(`/products/${firstId}`);
            expect(res.statusCode).toBe(200);
            expect(res.body.name).toBeDefined();
        });

        test('deve retornar 404 para produto inexistente', async () => {
            const res = await request(app).get('/products/99999');
            expect(res.statusCode).toBe(404);
        });
    });

    describe('POST /products', () => {
        test('deve criar produto (201)', async () => {
            const res = await request(app)
                .post('/products')
                .send({ name: 'Teste Produto', price: 99.90, category: 'Testes', stock: 10 });
            expect(res.statusCode).toBe(201);
            expect(res.body.name).toBe('Teste Produto');
        });

        test('deve rejeitar campos obrigatorios faltando (400)', async () => {
            const res = await request(app).post('/products').send({ name: 'Incompleto' });
            expect(res.statusCode).toBe(400);
        });
    });

    describe('PUT /products/:id', () => {
        test('deve atualizar produto existente (200)', async () => {
            const catalog = await request(app).get('/products');
            const target = catalog.body[0];
            const res = await request(app)
                .put(`/products/${target.id}`)
                .send({ name: 'Produto Atualizado', price: 149.90 });
            expect(res.statusCode).toBe(200);
            expect(res.body.name).toBe('Produto Atualizado');
            expect(res.body.price).toBe(149.90);
        });

        test('deve retornar 404 para produto inexistente', async () => {
            const res = await request(app)
                .put('/products/99999')
                .send({ name: 'Nao existe' });
            expect(res.statusCode).toBe(404);
        });

        test('deve rejeitar body vazio (400)', async () => {
            const catalog = await request(app).get('/products');
            const target = catalog.body[0];
            const res = await request(app)
                .put(`/products/${target.id}`)
                .send({});
            expect(res.statusCode).toBe(400);
        });
    });

    describe('DELETE /products/:id', () => {
        test('deve deletar produto existente (204)', async () => {
            const res = await request(app)
                .post('/products')
                .send({ name: 'Para Deletar', price: 10, category: 'Teste', stock: 5 });
            const id = res.body.id;
            const delRes = await request(app).delete(`/products/${id}`);
            expect(delRes.statusCode).toBe(204);
        });

        test('deve retornar 404 para produto inexistente', async () => {
            const res = await request(app).delete('/products/99999');
            expect(res.statusCode).toBe(404);
        });

        test('deve retornar 404 ao deletar o mesmo ID novamente', async () => {
            const createRes = await request(app)
                .post('/products')
                .send({ name: 'Para Deletar 2', price: 10, category: 'Teste', stock: 5 });
            const id = createRes.body.id;
            await request(app).delete(`/products/${id}`);
            const res = await request(app).delete(`/products/${id}`);
            expect(res.statusCode).toBe(404);
        });
    });

    // ==================== CARRINHO + CHECKOUT (usuario unico) ====================
    describe('Fluxo Ecommerce (carrinho + checkout + pagamento)', () => {
        let token;
        let productId;
        const flowUser = 'flowuser_' + Date.now();

        beforeAll(async () => {
            await request(app).post('/register').send({ username: flowUser, password: 'senha123' });
            const login = await request(app).post('/login').send({ username: flowUser, password: 'senha123' });
            token = login.body.token;
            const catalog = await request(app).get('/products');
            productId = catalog.body[0].id;
        });

        test('deve rejeitar acesso ao carrinho sem token (401)', async () => {
            const res = await request(app).get('/cart');
            expect(res.statusCode).toBe(401);
        });

        test('deve adicionar item ao carrinho (200)', async () => {
            const res = await request(app)
                .post('/cart')
                .set('Authorization', `Bearer ${token}`)
                .send({ productId, quantity: 1 });
            expect(res.statusCode).toBe(200);
        });

        test('deve listar carrinho com itens (200)', async () => {
            const res = await request(app).get('/cart').set('Authorization', `Bearer ${token}`);
            expect(res.statusCode).toBe(200);
            expect(res.body.items.length).toBeGreaterThan(0);
            expect(res.body.total).toBeGreaterThan(0);
        });

        test('deve remover item do carrinho (200)', async () => {
            // Adiciona outro item primeiro
            await request(app).post('/cart').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 1 });
            const res = await request(app)
                .delete(`/cart/${productId}`)
                .set('Authorization', `Bearer ${token}`);
            expect(res.statusCode).toBe(200);
        });

        test('deve criar pedido via checkout (201)', async () => {
            // Garantir que tem item no carrinho
            await request(app).post('/cart').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 1 });
            const res = await request(app)
                .post('/checkout')
                .set('Authorization', `Bearer ${token}`);
            expect(res.statusCode).toBe(201);
            expect(res.body.orderId).toBeDefined();
            expect(res.body.status).toBe('pending');
        });

        test('deve rejeitar checkout com carrinho vazio (400)', async () => {
            const res = await request(app)
                .post('/checkout')
                .set('Authorization', `Bearer ${token}`);
            expect(res.statusCode).toBe(400);
        });

        test('deve listar pedidos do usuario (200)', async () => {
            // Criar mais um pedido
            await request(app).post('/cart').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 1 });
            await request(app).post('/checkout').set('Authorization', `Bearer ${token}`);
            const res = await request(app).get('/orders').set('Authorization', `Bearer ${token}`);
            expect(res.statusCode).toBe(200);
            expect(res.body.length).toBeGreaterThan(0);
        });

        test('deve processar pagamento (200 ou 402)', async () => {
            // Criar pedido fresco
            await request(app).post('/cart').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 1 });
            const checkout = await request(app).post('/checkout').set('Authorization', `Bearer ${token}`);
            const res = await request(app)
                .post(`/orders/${checkout.body.orderId}/pay`)
                .set('Authorization', `Bearer ${token}`);
            expect([200, 402]).toContain(res.statusCode);
        });
    });

    // ==================== INCIDENTES ====================
    describe('Incidentes', () => {
        test('GET /incidente-erro deve retornar 500', async () => {
            const res = await request(app).get('/incidente-erro');
            expect(res.statusCode).toBe(500);
        });

        test('GET /incidente-cpu deve retornar 200', async () => {
            const res = await request(app).get('/incidente-cpu');
            expect(res.statusCode).toBe(200);
        });

        test('GET /incidente-delay deve retornar 200 apos delay', async () => {
            const res = await request(app).get('/incidente-delay');
            expect(res.statusCode).toBe(200);
        }, 15000);
    });

    // ==================== SIMULACOES ====================
    describe('Simulacoes Ecommerce', () => {
        let server;
        beforeAll((done) => {
            // Porta dinamica (0 = SO escolhe) para evitar EADDRINUSE
            server = app.listen(process.env.PORT || 0, () => {
                // Garante que as rotas de simulacao usem a mesma porta
                process.env.PORT = server.address().port;
                done();
            });
        });
        afterAll((done) => {
            server.close(() => {
                delete process.env.PORT;
                done();
            });
        });

        test('POST /simular/fluxo-completo deve retornar 200', async () => {
            const res = await request(app).post('/simular/fluxo-completo');
            expect(res.statusCode).toBe(200);
        }, 30000);

        test('POST /simular/black-friday deve retornar 200', async () => {
            const res = await request(app).post('/simular/black-friday');
            expect(res.statusCode).toBe(200);
            expect(res.body.results).toBeDefined();
        }, 30000);

        test('POST /simular/estoque-esgotado deve retornar 200', async () => {
            const res = await request(app).post('/simular/estoque-esgotado');
            expect(res.statusCode).toBe(200);
        }, 30000);

        test('POST /simular/falha-pagamento deve retornar 200', async () => {
            const res = await request(app).post('/simular/falha-pagamento');
            expect(res.statusCode).toBe(200);
        }, 30000);
    });

    // ==================== METRICAS ====================
    describe('GET /metrics', () => {
        test('deve retornar 200 com metricas Prometheus', async () => {
            const res = await request(app).get('/metrics');
            expect(res.statusCode).toBe(200);
            // Metricas de autenticacao
            expect(res.text).toContain('app_registrations_total');
            expect(res.text).toContain('app_logins_total');
            expect(res.text).toContain('app_active_users');
            // Metricas de negocio Ecommerce
            expect(res.text).toContain('app_products_total');
            expect(res.text).toContain('app_stock_total');
            expect(res.text).toContain('app_orders_total');
            expect(res.text).toContain('app_revenue_total');
            expect(res.text).toContain('app_payments_total');
            expect(res.text).toContain('app_checkouts_total');
            expect(res.text).toContain('app_cart_items_total');
            // Metricas HTTP e health
            expect(res.text).toContain('http_requests_total');
            expect(res.text).toContain('app_errors_total');
            expect(res.text).toContain('app_health_status');
        });
    });

    // ==================== USERS (compatibilidade) ====================
    describe('GET /users', () => {
        test('deve retornar array de usuarios (200)', async () => {
            const res = await request(app).get('/users');
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
    });
});
