const request = require('supertest');
const app = require('../app');

describe('API de Observabilidade', () => {

    describe('GET /', () => {
        test('deve retornar 200 com mensagem de boas-vindas', async () => {
            const res = await request(app).get('/');
            expect(res.statusCode).toBe(200);
            expect(res.text).toContain('API funcionando');
        });
    });

    describe('GET /health', () => {
        test('deve retornar 200 com status UP', async () => {
            const res = await request(app).get('/health');
            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('UP');
            expect(res.body).toHaveProperty('uptime');
            expect(res.body).toHaveProperty('timestamp');
        });
    });

    describe('POST /register', () => {
        test('deve criar usuario e retornar 201', async () => {
            const res = await request(app)
                .post('/register')
                .send({ username: 'testuser', password: '123456' });
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('id');
            expect(res.body.username).toBe('testuser');
        });

        test('deve rejeitar registro sem username (400)', async () => {
            const res = await request(app)
                .post('/register')
                .send({ password: '123456' });
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toBeDefined();
        });

        test('deve rejeitar registro sem password (400)', async () => {
            const res = await request(app)
                .post('/register')
                .send({ username: 'testuser' });
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toBeDefined();
        });

        test('deve rejeitar registro com body vazio (400)', async () => {
            const res = await request(app)
                .post('/register')
                .send({});
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toBeDefined();
        });
    });

    describe('POST /login', () => {
        beforeAll(async () => {
            await request(app)
                .post('/register')
                .send({ username: 'loginuser', password: 'senha123' });
        });

        test('deve logar com credenciais corretas (200)', async () => {
            const res = await request(app)
                .post('/login')
                .send({ username: 'loginuser', password: 'senha123' });
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain('sucesso');
        });

        test('deve rejeitar senha incorreta (401)', async () => {
            const res = await request(app)
                .post('/login')
                .send({ username: 'loginuser', password: 'errada' });
            expect(res.statusCode).toBe(401);
        });

        test('deve rejeitar usuario inexistente (401)', async () => {
            const res = await request(app)
                .post('/login')
                .send({ username: 'fantasma', password: '123456' });
            expect(res.statusCode).toBe(401);
        });

        test('deve rejeitar campos vazios (400)', async () => {
            const res = await request(app)
                .post('/login')
                .send({});
            expect(res.statusCode).toBe(400);
        });
    });

    describe('GET /users', () => {
        test('deve retornar array de usuarios (200)', async () => {
            const res = await request(app).get('/users');
            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
    });

    describe('GET /users/:id', () => {
        beforeAll(async () => {
            await request(app)
                .post('/register')
                .send({ username: 'busca', password: '123456' });
        });

        test('deve retornar usuario existente (200)', async () => {
            const users = await request(app).get('/users');
            const id = users.body[users.body.length - 1].id;
            const res = await request(app).get('/users/' + id);
            expect(res.statusCode).toBe(200);
            expect(res.body.username).toBe('busca');
        });

        test('deve retornar 404 para ID inexistente', async () => {
            const res = await request(app).get('/users/99999');
            expect(res.statusCode).toBe(404);
        });
    });

    describe('PUT /users/:id', () => {
        let userId;

        beforeAll(async () => {
            const res = await request(app)
                .post('/register')
                .send({ username: 'update', password: 'oldpass' });
            userId = res.body.id;
        });

        test('deve atualizar usuario existente (200)', async () => {
            const res = await request(app)
                .put('/users/' + userId)
                .send({ username: 'updated' });
            expect(res.statusCode).toBe(200);
            expect(res.body.username).toBe('updated');
        });

        test('deve rejeitar body vazio (400)', async () => {
            const res = await request(app)
                .put('/users/' + userId)
                .send({});
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toBeDefined();
        });

        test('deve retornar 404 para ID inexistente', async () => {
            const res = await request(app)
                .put('/users/99999')
                .send({ username: 'x' });
            expect(res.statusCode).toBe(404);
        });
    });

    describe('DELETE /users/:id', () => {
        let userId;

        beforeAll(async () => {
            const res = await request(app)
                .post('/register')
                .send({ username: 'todelete', password: '123456' });
            userId = res.body.id;
        });

        test('deve deletar usuario existente (204)', async () => {
            const res = await request(app).delete('/users/' + userId);
            expect(res.statusCode).toBe(204);
        });

        test('deve retornar 404 ao deletar o mesmo ID novamente', async () => {
            const res = await request(app).delete('/users/' + userId);
            expect(res.statusCode).toBe(404);
        });

        test('deve retornar 404 para ID inexistente', async () => {
            const res = await request(app).delete('/users/99999');
            expect(res.statusCode).toBe(404);
        });
    });

    describe('GET /incidente-erro', () => {
        test('deve retornar 500 (simulacao de erro)', async () => {
            const res = await request(app).get('/incidente-erro');
            expect(res.statusCode).toBe(500);
            expect(res.body.error).toBeDefined();
        });
    });

    describe('GET /incidente-cpu', () => {
        test('deve retornar 200 com mensagem', async () => {
            const res = await request(app).get('/incidente-cpu');
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain('Pico de CPU');
        });
    });

    describe('GET /incidente-delay', () => {
        test('deve retornar 200 apos delay', async () => {
            jest.setTimeout(15000);
            const res = await request(app).get('/incidente-delay');
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain('delay');
        }, 15000);
    });

    describe('GET /metrics', () => {
        test('deve retornar 200 com metricas Prometheus', async () => {
            const res = await request(app).get('/metrics');
            expect(res.statusCode).toBe(200);
            expect(res.text).toContain('http_requests_total');
            expect(res.text).toContain('http_request_duration_seconds');
            expect(res.text).toContain('node_app_');
            // Métricas de negócio
            expect(res.text).toContain('app_registrations_total');
            expect(res.text).toContain('app_logins_total');
            expect(res.text).toContain('app_crud_operations_total');
            expect(res.text).toContain('app_errors_total');
            expect(res.text).toContain('app_active_users');
            expect(res.text).toContain('app_health_status');
        });
    });
});
