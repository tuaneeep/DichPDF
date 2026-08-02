export const CONFIG = {
  API_BASE_URL:
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://127.0.0.1:41000'
      : '',
  MINERU_API_KEY: '',
  MINERU_SECRET_KEY: '',
  MINERU_REMOTE_ENABLED: false,
  HF_API_KEY: '',
  HF_MODEL: 'facebook/nllb-200-distilled-600M',
  LIBRETRANSLATE_ENDPOINT: 'https://libretranslate.com/translate',
  MINERU_ENDPOINT: 'https://api.mineru.net/v1/document',
  CHUNK_SIZE: 1400,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1200,
  CACHE_PREFIX: 'ai-pdf-translator-cache',
  TRANSLATION_PROMPT: `Dịch tiếng Anh sang tiếng Việt tự nhiên.

Quy tắc:
- Giữ nguyên Markdown.
- Giữ nguyên tiêu đề.
- Giữ nguyên bảng.
- Giữ nguyên danh sách.
- Giữ nguyên xuống dòng.
- Giữ nguyên thuật ngữ kỹ thuật nhất quán.
- Chỉ trả về văn bản đã dịch.
- Không giải thích.`
};
