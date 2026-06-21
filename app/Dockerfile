FROM node:22-alpine

# Instala curl para health check (Alpine não inclui por padrão)
RUN apk add --no-cache curl

WORKDIR /usr/src/app

# Copia package.json primeiro para cache de camadas (só reinstala se dependências mudarem)
COPY package*.json ./
RUN npm ci --only=production

# Copia o restante do código
COPY . .

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

EXPOSE 3001

CMD ["node", "app.js"]
