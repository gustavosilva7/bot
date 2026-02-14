FROM node:18-slim

# Instala dependências do sistema para o Puppeteer e ffmpeg
RUN apt-get update && apt-get install -y \
  ffmpeg \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgdk-pixbuf2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxshmfence1 \
  xdg-utils \
  wget \
  gnupg \
  --no-install-recommends && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Define diretório de trabalho
WORKDIR /app

# Copia e instala dependências Node.js
COPY package*.json ./
RUN npm ci --only=production

# Copia o restante da aplicação
COPY . .

# Cria diretórios necessários com permissões corretas
RUN mkdir -p /app/temp /app/.wwebjs_auth /app/.wwebjs_cache && \
    chmod -R 777 /app/temp /app/.wwebjs_auth /app/.wwebjs_cache

# Variáveis de ambiente
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV PUPPETEER_ARGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu"
ENV NODE_ENV=production

# Expõe a porta
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

# Executa o app
CMD ["node", "index.js"]
