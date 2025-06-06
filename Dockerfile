FROM node:18

# Instala dependências do sistema para o Puppeteer e ffmpeg
RUN apt-get update && apt-get install -y \
  ffmpeg \
  ca-certificates \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libgdk-pixbuf2.0-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils \
  --no-install-recommends && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Define diretório de trabalho
WORKDIR /app

# Copia e instala dependências Node.js
COPY package*.json ./
RUN npm install

# Copia o restante da aplicação
COPY . .

# Cria diretório para arquivos temporários
RUN mkdir -p /app/temp

# Define variável de ambiente para ffmpeg
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# Executa o app
CMD ["node", "index.js"]
