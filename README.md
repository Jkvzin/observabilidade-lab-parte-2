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
- Dashboard Web (JJ Eletrônicos): http://localhost:3001
- Grafana: http://localhost:3000 (admin / admin)
- Prometheus: http://localhost:9090

> O dashboard do Grafana (`dashboards/dashboard.json`) é provisionado automaticamente junto com datasources e alertas. Não precisa importar manualmente — tudo já sobe configurado.

---

## Endpoints da API

### Saúde
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/` | Redireciona (302) para a dashboard web `/index.html` |
| GET | `/health` | Health check (status, uptime) |
| GET | `/metrics` | Metricas Prometheus |

### Autenticacao
| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/register` | Criar usuario (`{username, password}`) |
| POST | `/login` | Login com bcrypt + rate limit (5 req/30s) |
| GET | `/users` | Listar todos os usuarios (sem senhas) |

### Produtos (CRUD Ecommerce)
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/products` | Catalogo completo (filtro opcional `?category=`) |
| GET | `/products/:id` | Detalhes de um produto |
| POST | `/products` | Criar produto (`{name, price, category, stock}`) |
| PUT | `/products/:id` | Atualizar produto |
| DELETE | `/products/:id` | Remover produto |

### Carrinho, Checkout e Pedidos
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/cart` | Ver carrinho do usuario autenticado |
| POST | `/cart` | Adicionar item (`{productId, quantity}`) |
| DELETE | `/cart/:productId` | Remover item do carrinho |
| POST | `/checkout` | Finalizar pedido (esvazia carrinho) |
| GET | `/orders` | Listar pedidos do usuario |
| POST | `/orders/:id/pay` | Processar pagamento (85% chance de sucesso) |

> Rotas de carrinho/checkout/orders exigem header `Authorization: Bearer <token>` (obtido no login).

### Simulacoes Ecommerce (geram metricas e logs reais)
| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/simular/fluxo-completo` | Registro → catalogo → carrinho → checkout → pagamento |
| POST | `/simular/black-friday` | 50 chamadas HTTP paralelas simulando pico de vendas |
| POST | `/simular/estoque-esgotado` | 10 tentativas de comprar produto com estoque zerado |
| POST | `/simular/falha-pagamento` | 5 tentativas de pagamento com 15% de falha cada |

### Incidentes
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/incidente-erro` | Simular erro 500 (dispara alerta de taxa de erro) |
| GET | `/incidente-cpu` | Simular pico de CPU (Worker Threads) |
| GET | `/incidente-delay` | Simular latencia elevada (resposta atrasada em 10s) |

---

## Metricas Expostas

### HTTP e Saude
- `http_requests_total{method, route, status_code}` — Total de requisicoes HTTP
- `http_request_duration_seconds` — Latencia (histograma com buckets P50/P95/P99)
- `app_health_status` — UP (1) / DOWN (0)

### Autenticacao
- `app_registrations_total` — Total de registros
- `app_logins_total{status}` — Logins (success/failure)
- `app_active_users` — Usuarios cadastrados ativos

### Negocio Ecommerce
- `app_products_total` — Total de produtos no catalogo
- `app_stock_total{product}` — Estoque por produto
- `app_cart_items_total` — Itens nos carrinhos de todos os usuarios
- `app_orders_total{status}` — Pedidos por status (pending/paid/shipped/delivered/cancelled)
- `app_revenue_total` — Receita total em R$ (pedidos pagos)
- `app_payments_total{status}` — Pagamentos processados (success/failure)
- `app_checkouts_total` — Total de checkouts realizados
- `app_page_views_total{page}` — Visualizacoes de pagina (funil de vendas)
- `app_product_sales_total{product}` — Produtos vendidos por nome
- `app_cart_creations_total{status}` — Carrinhos criados

### Erros
- `app_errors_total{type, endpoint}` — Erros por tipo (not_found, validation, auth, internal, rate_limit)

---

## Seguranca

- Senhas com bcrypt (SALT_ROUNDS=10)
- Rate limiting: 100 req/30s geral, 5 req/30s login, 10 req/30s checkout
- Headers HTTP com helmet
- Validacao de input (username 3-30 chars alfanumericos, senha 6+ chars)

---

## Testes

```bash
cd app
npm install
npm test               # 40 testes
npm run test:coverage  # relatorio de cobertura
```

Os testes cobrem: health, autenticacao, CRUD de produtos, fluxo ecommerce completo (carrinho → checkout → pagamento), simulacoes de cenario realista, incidentes e metricas Prometheus.

---

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
# 5x 401, depois 429 (bloqueado pelo rate limit)

# Disparar simulacao de Black Friday
curl -X POST http://localhost:3001/simular/black-friday

# Simular fluxo completo de compra
curl -X POST http://localhost:3001/simular/fluxo-completo
```

---

## CI/CD

Pipeline GitHub Actions em `.github/workflows/ci-cd.yml` executado a cada push na `main`:

| Job | O que faz |
|-----|-----------|
| `test` | `npm ci` → `npm test` (40 testes) → `npm run test:coverage` |
| `build` | `docker build -t observabilidade-lab ./app` |
| `deploy` | Dispara webhook do Render (se `RENDER_DEPLOY_HOOK` estiver configurado nos secrets) |

---

## Deploy no Render

O Render oferece deploy automatico a partir de repositorios GitHub.

### Pre-requisitos
- Conta no [Render](https://render.com) (login com GitHub recomendado)

### Passo a passo

1. Acesse [render.com](https://render.com) e faca login com sua conta do GitHub

2. No dashboard, clique em **New +** → **Web Service** e selecione `Jkvzin/observabilidade-lab-parte-2`

3. Configure o servico:

   | Campo | Valor |
   |---|---|
   | **Name** | `observabilidade-api` |
   | **Root Directory** | `app` |
   | **Runtime** | Node |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Health Check Path** | `/health` |

4. **Variaveis de ambiente** (opcional): a aplicacao usa `PORT` dinamico via `process.env.PORT || 3001`. Nao e necessario configurar nada adicional.

5. Clique em **Create Web Service** — o Render faz o build e disponibiliza a API em uma URL publica.

### Deploy Hook (GitHub Actions)

Para ativar o deploy automatico via CI/CD:

1. No Render, va em **Settings → Deploy Hook** e copie a URL
2. No GitHub, va em **Settings → Secrets and variables → Actions** e crie o secret `RENDER_DEPLOY_HOOK` com a URL

> O Render tambem oferece auto-deploy nativo em cada push na branch principal — nao e obrigatorio configurar a action se preferir o auto-deploy nativo.

---

## Alertas Configurados (Grafana)

As regras de alerta sao provisionadas automaticamente via `grafana/provisioning/alerting/rules.yml`. Ao subir o ambiente com `docker compose up -d --build`, os seguintes alertas ja estarao ativos:

| Alerta | Condicao | Severidade |
|---|---|---|
| Alta utilizacao de CPU | `rate(cpu)[5m] > 80%` | warning |
| Alta taxa de erro HTTP 5xx | Erros 5xx > 10% das requisicoes | critical |
| Latencia P95 elevada | P95 > 2 segundos | warning |
| Servico DOWN | `up{job="node-app"} == 0` | critical |
| Memoria alta | Uso > 85% | warning |

### Configurando notificacoes (Slack, Email, Telegram)

1. Acesse o Grafana em `http://localhost:3000` → **Alerting** → **Contact points**
2. Edite o contact point "Default" (ou crie um novo)
3. Escolha o tipo de notificacao e preencha as credenciais:
   - **Email**: requer SMTP configurado no `grafana.ini` (ou variaveis `GF_SMTP_*`)
   - **Slack**: requer um Webhook URL
   - **Telegram**: requer Bot Token + Chat ID
4. Clique em **Save** e depois em **Test** para validar

As regras de alerta estao provisionadas como arquivo; para modifica-las, edite `grafana/provisioning/alerting/rules.yml` e reinicie o Grafana.

---

## Estrutura do Projeto

```
.
├── app/                      # Aplicacao Node.js
│   ├── app.js                # Servidor Express (API Ecommerce)
│   ├── Dockerfile            # Imagem Docker (node:22-alpine)
│   ├── logger.js             # Logger estruturado (JSON)
│   ├── package.json          # Dependencias e scripts
│   ├── tests/                # 40 testes automatizados (Jest + Supertest)
│   └── public/               # Dashboard web (HTML/CSS/JS)
├── prometheus/               # Config de scraping
│   └── prometheus.yml
├── promtail/                 # Coleta de logs
│   └── promtail-config.yml
├── loki/                     # Armazenamento de logs
│   └── loki-config.yml
├── grafana/                  # Provisionamento automatico
│   └── provisioning/
│       ├── dashboards/       # Dashboard JSON (23 paineis)
│       ├── datasources/      # Prometheus + Loki
│       └── alerting/         # Regras de alerta + contact points
├── dashboards/               # Dashboard Grafana (fonte)
│   └── dashboard.json
├── ansible/                  # Playbook de deploy
│   └── playbook.yml
├── .github/workflows/        # CI/CD pipeline
│   └── ci-cd.yml
└── docker-compose.yml        # Orquestracao (6 servicos)
```

---

*Desenvolvido para fins de estudo e aprimoramento em praticas de SRE e DevOps.*
