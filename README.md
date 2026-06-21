# Observabilidade Lab 2

Laboratorio pratico de **Engenharia de Confiabilidade (SRE) e Observabilidade** com stack completa: Node.js, Prometheus, Grafana, Loki e Docker.

**Dupla:** Joao Guilherme e Joao Victor

---

## Stack

| Componente | Tecnologia | Porta |
|-----------|-----------|-------|
| API | Node.js + Express | 3001 |
| Metricas | Prometheus | 9090 |
| Dashboards | Grafana | 3000 |
| Logs | Loki + Promtail | 3100 |
| Infra | Node Exporter | 9100 |

---

## Como Rodar

```bash
git clone https://github.com/Jkvzin/observabilidade-lab-parte-2.git
cd observabilidade-lab-parte-2
docker compose up -d --build
```

**Acessar:**
- Dashboard Web: http://localhost:3001
- Grafana: http://localhost:3000 (admin / admin)
- Prometheus: http://localhost:9090

Importe o dashboard em `dashboards/dashboard.json` no Grafana para ver os graficos.

---

## Endpoints da API

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/` | Boas-vindas |
| GET | `/health` | Health check (status, uptime) |
| POST | `/register` | Criar usuario |
| POST | `/login` | Login (bcrypt + rate limit) |
| GET | `/users` | Listar usuarios |
| GET | `/users/:id` | Buscar por ID |
| PUT | `/users/:id` | Atualizar usuario |
| DELETE | `/users/:id` | Deletar usuario |
| GET | `/metrics` | Metricas Prometheus |
| GET | `/incidente-erro` | Simular erro 500 |
| GET | `/incidente-cpu` | Simular pico de CPU |
| GET | `/incidente-delay` | Simular delay 10s |

## Metricas Expostas

- `http_requests_total` — Requisicoes HTTP por metodo, rota e status
- `http_request_duration_seconds` — Latencia (histograma P50/P95/P99)
- `app_registrations_total` — Registros de usuarios
- `app_logins_total{status}` — Logins (success/failure)
- `app_crud_operations_total{operation,status}` — Operacoes CRUD
- `app_errors_total{type,endpoint}` — Erros por tipo
- `app_active_users` — Usuarios cadastrados
- `app_health_status` — UP/DOWN

## Seguranca

- Senhas com bcrypt (SALT_ROUNDS=10)
- Rate limiting (100 req/15min geral, 10 req/15min login)
- Headers HTTP com helmet
- Validacao de input (username 3-30 chars, senha 6+)

## CI/CD

Pipeline GitHub Actions em `.github/workflows/ci.yml`:
- Testes automatizados (23 testes)
- Build Docker
- Deploy via Render Deploy Hook

## Testes

```bash
cd app
npm install
npm test        # 23 testes
npm run test:coverage
```

## Simulando Incidentes

Acesse a Dashboard Web em http://localhost:3001 e use o painel de controle para disparar:
- Erro Critico (500) — afeta taxa de erro no Grafana
- Sobrecarga de CPU — pico nos graficos de CPU
- Instabilidade (Delay) — latencia elevada

Ou via terminal:
```bash
# Simular brute force (detectado e bloqueado)
for i in $(seq 1 12); do
  curl -s -X POST http://localhost:3001/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"errada"}'
done
# 10x 401, depois 429 (bloqueado pelo rate limit)
```

## Estrutura do Projeto

```
.
├── app/                   # Aplicacao Node.js
│   ├── app.js             # Servidor Express
│   ├── tests/             # Testes automatizados
│   └── public/            # Dashboard web
├── prometheus/            # Config de scraping
├── promtail/              # Coleta de logs
├── loki/                  # Armazenamento de logs
├── dashboards/            # Dashboard Grafana JSON
├── ansible/               # Playbook de deploy
├── .github/workflows/     # CI/CD pipeline
└── docker-compose.yml     # Orquestracao
```
