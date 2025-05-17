const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const ffmpegPath = require('ffmpeg-static');

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "sticker-bot" }),
    ffmpegPath
});

const REQUIRED_CAPTION = "sticker";

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Bot pronto!'));

client.on('message', async msg => {
    try {
        if (!msg.hasMedia || !msg.body) return;

        if (msg.body.trim() !== REQUIRED_CAPTION) return;

        const media = await msg.downloadMedia();

        // imagem → sticker
        if (media.mimetype.startsWith('image/')) {
            await msg.reply(media, undefined, { sendMediaAsSticker: true });
            return;
        }

        // vídeo → sticker animado
        if (media.mimetype.startsWith('video/')) {
            await msg.reply("Infelizmente esse recurso ainda não se encontra disponível", undefined, { sendMediaAsSticker: false });
            return;
        }

    } catch (err) {
        console.error('Erro ao processar mídia:', err);
    }
});


client.initialize();
