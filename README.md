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

---

## ☁️ Deploy no Render

O Render é uma plataforma cloud que oferece deploy automático a partir de repositórios GitHub. Siga os passos abaixo para publicar a API.

### Pré-requisitos
- Conta no [Render](https://render.com) (login com GitHub recomendado)
- Repositório conectado ao GitHub

---

## 🚨 Alertas Configurados (Grafana)

As regras de alerta são provisionadas automaticamente via `grafana/provisioning/alerting/rules.yml`. Ao subir o ambiente com `docker compose up -d --build`, os seguintes alertas já estarão ativos:

| Alerta | Condição | Severidade |
|---|---|---|
| Alta utilização de CPU | `rate(cpu)[5m] > 80%` | ⚠️ warning |
| Alta taxa de erro HTTP 5xx | Erros 5xx > 10% das requisições | 🔴 critical |
| Latência P95 elevada | P95 > 2 segundos | ⚠️ warning |
| Serviço DOWN | `up{job="node-app"} == 0` | 🔴 critical |
| Memória alta | Uso > 85% | ⚠️ warning |

### Configurando notificações (Slack, Email, Telegram)

1. Acesse o Grafana em `http://localhost:3000` → **Alerting** → **Contact points**
2. Edite o contact point "Default" (ou crie um novo)
3. Escolha o tipo de notificação desejado e preencha as credenciais:
   - **Email**: requer SMTP configurado no `grafana.ini` (ou variáveis `GF_SMTP_*`)
   - **Slack**: requer um Webhook URL
   - **Telegram**: requer Bot Token + Chat ID
4. Clique em **Save** e depois em **Test** para validar

As regras de alerta estão provisionadas como arquivo; para modificá-las, edite `grafana/provisioning/alerting/rules.yml` e reinicie o Grafana.

<<<<<<< HEAD
### Passo a passo

1. **Crie uma conta no Render**  
   Acesse [render.com](https://render.com) e faça login com sua conta do GitHub.

2. **Crie um novo Web Service**  
   No dashboard, clique em **New +** → **Web Service** e selecione o repositório `Jkvzin/observabilidade-lab-parte-2`.

3. **Configure o serviço:**
   | Campo | Valor |
   |---|---|
   | **Name** | `observabilidade-api` |
   | **Root Directory** | `app` |
   | **Runtime** | Node |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Health Check Path** | `/health` |

4. **Variáveis de ambiente** (opcional):  
   A aplicação já usa `PORT` dinâmico via `process.env.PORT || 3001`, então não é necessário configurar nada adicional.

5. **Clique em "Create Web Service"**  
   O Render fará o build automaticamente e disponibilizará a API em uma URL pública (ex: `https://observabilidade-api.onrender.com`).

### Deploy Hook (GitHub Actions)

Para integrar o deploy automático com GitHub Actions, configure a action `render-deploy` no seu workflow:

```yaml
- name: Trigger Render Deploy
  run: |
    curl -X POST "${{ secrets.RENDER_DEPLOY_HOOK }}"
```

> O **Deploy Hook URL** pode ser encontrado nas configurações do Web Service no Render, na seção **Settings → Deploy Hook**.

O Render também oferece deploy automático em cada push na branch principal — não é obrigatório configurar a action se preferir o auto-deploy nativo.

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

---

## Alertas Configurados (Grafana)

As regras de alerta sao provisionadas automaticamente. Ao subir o ambiente, os seguintes alertas ja estarao ativos:

| Alerta | Condicao | Severidade |
|---|---|---|
| Alta utilizacao de CPU | CPU > 80% por 5min | warning |
| Alta taxa de erro HTTP 5xx | Erros 5xx > 10% | critical |
| Latencia P95 elevada | P95 > 2 segundos | warning |
| Servico DOWN | `up{job="node-app"} == 0` | critical |
| Memoria alta | Uso > 85% | warning |

### Configurando notificacoes

1. Acesse Grafana → Alerting → Contact points
2. Crie/edite um contact point (Slack, Email, Telegram)
3. Preencha as credenciais e teste

---
*Desenvolvido para fins de estudo e aprimoramento em praticas de SRE e DevOps.*
