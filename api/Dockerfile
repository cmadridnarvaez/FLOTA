FROM node:22-alpine

WORKDIR /app

# Instalar poppler-utils para conversión PDF → imagen (GPT-4o Vision)
RUN apk add --no-cache poppler-utils

# Instalar dependencias primero (mejor cache)
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Código de la app
COPY src ./src

# Storage de documentos
RUN mkdir -p /data/storage
ENV STORAGE_DIR=/data/storage

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health >/dev/null || exit 1

CMD ["node", "src/server.js"]
