FROM node:22-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

EXPOSE 3001

CMD ["npm", "start"]
