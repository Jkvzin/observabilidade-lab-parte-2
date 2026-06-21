# 🚀 Laboratório de Observabilidade Completo (O11yLab)
Dupla: João Guilherme e João Victor

![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=Prometheus&logoColor=white)
![Grafana](https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white)

Um laboratório prático de **Engenharia de Confiabilidade (SRE) e Observabilidade**, construído para demonstrar a coleta, visualização e análise de métricas e logs em tempo real.

O projeto inclui uma API RESTful completa com interface Web (Dashboard) que permite a **simulação de incidentes** (Picos de CPU, Gargalos de Rede e Erros Críticos) para que você possa observar o comportamento de um sistema em colapso nos gráficos do Grafana.

---

## 🛠️ Tecnologias e Arquitetura

Este laboratório utiliza a stack padrão da indústria para observabilidade:

- **Node.js + Express**: Aplicação alvo (API) instrumentada nativamente.
- **Prometheus**: Coleta de métricas (Time-Series Database).
- **Node Exporter**: Coleta de métricas da infraestrutura da máquina host.
- **Loki & Promtail**: Coleta e agregação de Logs da aplicação.
- **Grafana**: Plataforma de visualização e Dashboards dinâmicos.
- **Docker Compose**: Orquestração de todos os serviços.

---

## ⚙️ Como Executar o Laboratório

Você precisa ter o **Docker** e o **Docker Compose** instalados na sua máquina.

1. Clone este repositório:
```bash
git clone https://github.com/Jkvzin/observabilidade-lab.git
cd observabilidade-lab
```

2. Suba a infraestrutura completa:
```bash
docker compose up -d --build
```

3. Acesse os serviços nos seus respectivos links:
- **Dashboard Web / API**: [http://localhost:3001](http://localhost:3001)
- **Grafana**: [http://localhost:3000](http://localhost:3000) *(Login: admin / admin)*
- **Prometheus**: [http://localhost:9090](http://localhost:9090)

*(Nota: Na pasta `dashboards`, há um arquivo JSON do Grafana pronto para ser importado com todos os gráficos do lab).*

---

## 💥 Simulando Incidentes (Chaos Engineering)

Acesse a interface web em `http://localhost:3001` para interagir com o sistema. Do lado direito, você verá o "Painel de Controle de Incidentes":

1. **Erro Crítico (500)**: Força a API a disparar erros internos. Acompanhe a agulha de *Taxa de Erro (%)* no Grafana subir para 100%.
2. **Sobrecarga de CPU**: Utiliza `worker_threads` para estressar **todos os núcleos** do seu processador por 5 segundos. O gráfico de Uso de CPU registrará picos altíssimos.
3. **Instabilidade (Delay)**: Segura as requisições ativas por 10 segundos antes de responder. Comprova visualmente o engarrafamento de rede no gráfico de *Latência*.

---

## 📈 Gráficos Implementados

O Dashboard do Grafana foi configurado para monitorar 3 frentes principais:

- **Infraestrutura**: Uso de CPU por processo, Uso de Memória em % e Tráfego de Rede (I/O).
- **Aplicação (Logs)**: Volume de Logs em barras, Logs agregados em tempo real e Taxa de Erros em ponteiro (Gauge).
- **Tráfego e Latência**: Histograma de tempo de resposta HTTP e Correlação visual (Dual Y-Axis) entre Picos de Falha e Uso de CPU.

---
---

## ☁️ Deploy no Render

O Render é uma plataforma cloud que oferece deploy automático a partir de repositórios GitHub. Siga os passos abaixo para publicar a API.

### Pré-requisitos
- Conta no [Render](https://render.com) (login com GitHub recomendado)
- Repositório conectado ao GitHub

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

---

*Desenvolvido para fins de estudo e aprimoramento em práticas de SRE e DevOps.*
