const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "sticker-bot" }),
  ffmpegPath: process.env.FFMPEG_PATH || '/usr/bin/ffmpeg',
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

const REQUIRED_CAPTION = "sticker";
const TEMP_DIR = path.join(__dirname, 'temp');

// Garante que o diretório temporário existe
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Gera um nome de arquivo único
function gerarNomeUnico(base = 'arquivo') {
  return `${base}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// Agenda a exclusão de um arquivo após determinado tempo (em minutos)
function agendarExclusao(caminho, minutos = 30) {
  setTimeout(() => {
    if (fs.existsSync(caminho)) fs.unlinkSync(caminho);
  }, minutos * 60 * 1000);
}

// Converte vídeo para sticker animado (.webp)
async function converterVideoParaSticker(bufferInput, nomeBase) {
  const caminhoInput = path.join(TEMP_DIR, `${nomeBase}.mp4`);
  const caminhoOutput = path.join(TEMP_DIR, `${nomeBase}.webp`);

  fs.writeFileSync(caminhoInput, bufferInput);

  return new Promise((resolve, reject) => {
    const comando = `ffmpeg -i "${caminhoInput}" -vcodec libwebp -filter:v fps=15 -lossless 0 -q:v 50 -preset default -loop 0 -an -vsync 0 -s 512:512 "${caminhoOutput}"`;

    exec(comando, (err) => {
      if (err) return reject(err);

      const bufferWebp = fs.readFileSync(caminhoOutput);

      // Agenda exclusão dos arquivos temporários
      agendarExclusao(caminhoInput, 30);
      agendarExclusao(caminhoOutput, 30);

      resolve(bufferWebp);
    });
  });
}

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Bot pronto!'));

client.on('message_create', async msg => {
  try {
    if (!msg.hasMedia || !msg.body) return;
    if (msg.body.trim().toLocaleLowerCase() !== REQUIRED_CAPTION.trim().toLocaleLowerCase()) return;

    const media = await msg.downloadMedia();
    const isImage = media.mimetype.startsWith('image/');
    const isVideo = media.mimetype.startsWith('video/');

    if (isImage) {
      await msg.reply(media, undefined, { sendMediaAsSticker: true });
      console.log('Imagem recebida e enviada como figurinha.');
      return;
    }

    if (isVideo) {
      try {
        const nome = gerarNomeUnico('video');
        const bufferVideo = Buffer.from(media.data, 'base64');
        const webpBuffer = await converterVideoParaSticker(bufferVideo, nome);

        const sticker = new MessageMedia('image/webp', webpBuffer.toString('base64'));
        await msg.reply(sticker, undefined, { sendMediaAsSticker: true });

        console.log('Vídeo convertido e figurinha enviada.');
      } catch (erro) {
        console.error('Erro ao converter vídeo:', erro);
        await msg.reply("❌ Não consegui converter esse vídeo para figurinha.");
      }
      return;
    }

  } catch (err) {
    console.error('Erro ao processar mídia:', err);
  }
});

client.initialize();
