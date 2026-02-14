/**
 * Cliente para a API de upload de arquivos (storage).
 * POST {BASE_URL}/api/u/{slug} — multipart/form-data, sem autenticação.
 *
 * Neste sistema TUDO é temporário: todo upload usa temporary=1 + TTL.
 */

const STORAGE_UPLOAD_URL = process.env.STORAGE_UPLOAD_URL || process.env.BASE_URL_API_STORAGE;

/**
 * Envia um arquivo (buffer) para o storage. Sempre como temporário (excluído após TTL).
 *
 * @param {Buffer} buffer - Conteúdo do arquivo
 * @param {string} filename - Nome do arquivo (ex.: "video_123.mp4")
 * @param {object} options
 * @param {number} [options.ttl_minutes] - Minutos até exclusão (usa default se não informado)
 * @param {number} [options.ttl_seconds] - Segundos até exclusão (alternativa a ttl_minutes)
 * @returns {Promise<{ success: boolean, uploaded?: Array, errors?: Array, error?: string }>}
 */
async function uploadToStorage(buffer, filename, options = {}) {
  if (!STORAGE_UPLOAD_URL || !STORAGE_UPLOAD_URL.startsWith('http')) {
    return { success: false, error: 'STORAGE_UPLOAD_URL não configurada.' };
  }

  const ttlMinutes = parseInt(process.env.STORAGE_TEMP_TTL_MINUTES || '15', 10) || 15;
  const { ttl_minutes = ttlMinutes, ttl_seconds } = options;

  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('temporary', '1');
  if (ttl_seconds != null && ttl_seconds > 0) {
    form.append('ttl_seconds', String(ttl_seconds));
  } else if (ttl_minutes != null && ttl_minutes > 0) {
    form.append('ttl_minutes', String(ttl_minutes));
  } else {
    return { success: false, error: 'É obrigatório informar ttl_minutes ou ttl_seconds (valor maior que zero).' };
  }

  const response = await fetch(STORAGE_UPLOAD_URL, {
    method: 'POST',
    body: form,
    headers: {},
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      success: false,
      error: data.error || `HTTP ${response.status}`,
      uploaded: data.uploaded,
      errors: data.errors,
    };
  }

  return {
    success: data.success !== false,
    message: data.message,
    uploaded: data.uploaded || [],
    errors: data.errors || [],
  };
}

/**
 * Verifica se o storage está configurado e deve ser usado.
 */
function isStorageConfigured() {
  return !!(STORAGE_UPLOAD_URL && STORAGE_UPLOAD_URL.startsWith('http'));
}

module.exports = {
  uploadToStorage,
  isStorageConfigured,
  STORAGE_UPLOAD_URL,
};
