const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const sharp = require('sharp');
const { uploadToStorage, isStorageConfigured } = require('./storage-api');

// Configura o caminho do FFmpeg (usa ffmpeg-static ou o do sistema)
const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || '/usr/bin/ffmpeg';
ffmpeg.setFfmpegPath(ffmpegPath);

// Configuração do servidor web
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, 'public')));

// Health check para Railway/Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    botStatus: clientStatus,
    uptime: process.uptime()
  });
});

// Estado do cliente
let client = null;
let clientStatus = 'disconnected';

const REQUIRED_CAPTION = "sticker";
// Usa o serviço de storage (API) quando configurado; senão usa pasta local temp
const TEMP_DIR = process.env.TEMP_DIR || (isStorageConfigured() ? os.tmpdir() : path.join(__dirname, 'temp'));

// Garante que o diretório temporário existe (só necessário para pasta local)
if (!isStorageConfigured() && !fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
if (isStorageConfigured() && TEMP_DIR === os.tmpdir() && !fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Gera um nome de arquivo único
function gerarNomeUnico(base = 'arquivo') {
  return `${base}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// Limpa arquivo de forma segura
function limparArquivo(caminho) {
  try {
    if (fs.existsSync(caminho)) {
      fs.unlinkSync(caminho);
    }
  } catch (err) {
    console.error(`Erro ao limpar arquivo ${caminho}:`, err.message);
  }
}

// Converte imagem estática para sticker WebP quadrado (512x512 esticado)
async function converterImagemParaSticker(bufferInput) {
  const webpBuffer = await sharp(bufferInput)
    .resize(512, 512, {
      fit: 'fill' // Estica a imagem para preencher 512x512
    })
    .webp({ quality: 80 })
    .toBuffer();
  
  return webpBuffer;
}

// Converte mídia animada (vídeo/GIF) para sticker WebP
async function converterParaStickerAnimado(bufferInput, nomeBase, extensao = 'mp4') {
  const caminhoInput = path.join(TEMP_DIR, `${nomeBase}.${extensao}`);
  const caminhoOutput = path.join(TEMP_DIR, `${nomeBase}.webp`);

  // Salva o arquivo de entrada (necessário para o ffmpeg)
  fs.writeFileSync(caminhoInput, bufferInput);

  // Envia para o storage (sempre temporário, TTL por STORAGE_TEMP_TTL_MINUTES)
  if (isStorageConfigured()) {
    uploadToStorage(bufferInput, `${nomeBase}.${extensao}`).then((result) => {
      if (!result.success) {
        console.error('[Storage] Falha ao enviar arquivo temporário:', result.error || result.errors);
      }
    }).catch((err) => {
      console.error('[Storage] Erro ao enviar arquivo:', err.message);
    });
  }

  return new Promise((resolve, reject) => {
    ffmpeg(caminhoInput)
      .outputOptions([
        '-vcodec', 'libwebp',
        '-vf', 'fps=15,scale=512:512', // Estica para 512x512 (quadrado)
        '-lossless', '0',
        '-compression_level', '6',
        '-q:v', '50',
        '-loop', '0',
        '-preset', 'default',
        '-an',
        '-vsync', '0',
        '-t', '6' // Limita a 6 segundos (requisito do WhatsApp)
      ])
      .toFormat('webp')
      .on('end', () => {
        try {
          const bufferWebp = fs.readFileSync(caminhoOutput);
          
          // Limpa arquivos temporários imediatamente
          limparArquivo(caminhoInput);
          limparArquivo(caminhoOutput);
          
          resolve(bufferWebp);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err) => {
        // Limpa arquivos em caso de erro
        limparArquivo(caminhoInput);
        limparArquivo(caminhoOutput);
        reject(err);
      })
      .save(caminhoOutput);
  });
}

// Função para emitir log para todos os clientes
function emitLog(message, type = '') {
  console.log(message);
  io.emit('log', { message, type });
}

// Função para criar e configurar o cliente WhatsApp
function createClient() {
  client = new Client({
    authStrategy: new LocalAuth({ clientId: "sticker-bot" }),
    ffmpegPath: process.env.FFMPEG_PATH || '/usr/bin/ffmpeg',
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on('qr', async (qr) => {
    qrcode.generate(qr, { small: true });
    
    // Gerar QR code como imagem para a web
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 256 });
      io.emit('qr', qrDataUrl);
    } catch (err) {
      console.error('Erro ao gerar QR code:', err);
    }
  });

  client.on('ready', () => {
    clientStatus = 'connected';
    emitLog('✅ Bot pronto!', 'success');
    io.emit('ready');
  });

  client.on('authenticated', () => {
    emitLog('✅ Autenticado!', 'success');
    io.emit('authenticated');
  });

  client.on('auth_failure', (msg) => {
    clientStatus = 'disconnected';
    emitLog(`❌ Falha na autenticação: ${msg}`, 'error');
    io.emit('auth_failure', msg);
  });

  client.on('disconnected', (reason) => {
    clientStatus = 'disconnected';
    emitLog(`⚠️ Desconectado: ${reason}`, 'warning');
    io.emit('disconnected', reason);
  });

  client.on('message_create', async msg => {
    try {
      if (!msg.hasMedia || !msg.body) return;
      if (msg.body.trim().toLocaleLowerCase() !== REQUIRED_CAPTION.trim().toLocaleLowerCase()) return;

      const media = await msg.downloadMedia();
      if (!media || !media.mimetype) {
        emitLog('⚠️ Mídia inválida ou não suportada.', 'warning');
        return;
      }

      const isImage = media.mimetype.startsWith('image/');
      const isGif = media.mimetype === 'image/gif';
      const isVideo = media.mimetype.startsWith('video/');

      // Imagens estáticas (não GIF)
      if (isImage && !isGif) {
        try {
          emitLog('🔄 Convertendo imagem para quadrado...', 'warning');
          const bufferImagem = Buffer.from(media.data, 'base64');
          const webpBuffer = await converterImagemParaSticker(bufferImagem);
          
          const sticker = new MessageMedia('image/webp', webpBuffer.toString('base64'));
          await msg.reply(sticker, undefined, { sendMediaAsSticker: true });
          emitLog('📸 Imagem convertida em figurinha quadrada.', 'success');
        } catch (erro) {
          console.error('Erro ao converter imagem:', erro);
          await msg.reply("❌ Não consegui converter essa imagem para figurinha.");
          emitLog(`❌ Erro ao converter imagem: ${erro.message}`, 'error');
        }
        return;
      }

      // GIFs animados
      if (isGif) {
        try {
          emitLog('🔄 Convertendo GIF...', 'warning');
          const nome = gerarNomeUnico('gif');
          const bufferGif = Buffer.from(media.data, 'base64');
          const webpBuffer = await converterParaStickerAnimado(bufferGif, nome, 'gif');

          const sticker = new MessageMedia('image/webp', webpBuffer.toString('base64'));
          await msg.reply(sticker, undefined, { sendMediaAsSticker: true });

          emitLog('✨ GIF convertido em figurinha animada.', 'success');
        } catch (erro) {
          console.error('Erro ao converter GIF:', erro);
          await msg.reply("❌ Não consegui converter esse GIF para figurinha.");
          emitLog(`❌ Erro ao converter GIF: ${erro.message}`, 'error');
        }
        return;
      }

      // Vídeos
      if (isVideo) {
        try {
          emitLog('🔄 Convertendo vídeo...', 'warning');
          const nome = gerarNomeUnico('video');
          const bufferVideo = Buffer.from(media.data, 'base64');
          const webpBuffer = await converterParaStickerAnimado(bufferVideo, nome, 'mp4');

          const sticker = new MessageMedia('image/webp', webpBuffer.toString('base64'));
          await msg.reply(sticker, undefined, { sendMediaAsSticker: true });

          emitLog('🎬 Vídeo convertido em figurinha animada.', 'success');
        } catch (erro) {
          console.error('Erro ao converter vídeo:', erro);
          await msg.reply("❌ Não consegui converter esse vídeo para figurinha.");
          emitLog(`❌ Erro ao converter vídeo: ${erro.message}`, 'error');
        }
        return;
      }

    } catch (err) {
      console.error('Erro ao processar mídia:', err);
      emitLog(`❌ Erro ao processar mídia: ${err.message}`, 'error');
    }
  });

  return client;
}

// Socket.IO - Conexões
io.on('connection', (socket) => {
  console.log('🌐 Cliente web conectado');

  // Enviar status atual
  socket.on('get-status', () => {
    socket.emit('status', { status: clientStatus });
  });

  // Conectar cliente WhatsApp
  socket.on('connect-client', async () => {
    if (clientStatus === 'connected') {
      socket.emit('status', { status: 'connected', message: 'Já está conectado!' });
      return;
    }

    try {
      emitLog('🔄 Iniciando cliente WhatsApp...', 'warning');
      clientStatus = 'connecting';
      io.emit('status', { status: 'connecting' });
      
      if (client) {
        try {
          await client.destroy();
        } catch (e) {
          // Ignorar erros ao destruir cliente antigo
        }
      }
      
      client = createClient();
      await client.initialize();
    } catch (err) {
      console.error('Erro ao inicializar cliente:', err);
      clientStatus = 'disconnected';
      io.emit('status', { status: 'disconnected', message: 'Erro ao conectar' });
      emitLog(`❌ Erro ao conectar: ${err.message}`, 'error');
    }
  });

  // Desconectar cliente WhatsApp
  socket.on('disconnect-client', async () => {
    if (!client) {
      socket.emit('status', { status: 'disconnected' });
      return;
    }

    try {
      emitLog('🔄 Desconectando...', 'warning');
      await client.logout();
      await client.destroy();
      client = null;
      clientStatus = 'disconnected';
      io.emit('disconnected', 'Desconectado pelo usuário');
    } catch (err) {
      console.error('Erro ao desconectar:', err);
      emitLog(`❌ Erro ao desconectar: ${err.message}`, 'error');
    }
  });

  socket.on('disconnect', () => {
    console.log('🌐 Cliente web desconectado');
  });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🚀 WhatsApp Sticker Bot - Servidor Iniciado         ║
║                                                        ║
║   📱 Acesse: http://localhost:${PORT}                   ║
║                                                        ║
║   Use a interface web para conectar o bot!            ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);
});
