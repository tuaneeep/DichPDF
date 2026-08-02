import { CONFIG } from './config.js';

function hashText(text) {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(text))
    .then((buffer) => Array.from(new Uint8Array(buffer)).map((value) => value.toString(16).padStart(2, '0')).join(''));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function splitTextIntoChunks(text, maxChars = CONFIG.CHUNK_SIZE) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return [text.trim()].filter(Boolean);
  }

  const chunks = [];
  let current = '';

  paragraphs.forEach((paragraph) => {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length > maxChars) {
      const parts = paragraph.match(/.{1,1200}/g) || [paragraph];
      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          current = part.trim();
        } else {
          chunks.push(part.trim());
        }
      });
    } else {
      current = paragraph;
    }
  });

  if (current) {
    chunks.push(current);
  }

  return chunks.filter(Boolean);
}

function protectSensitiveContent(text) {
  const replacements = [];
  let safeText = text;

  const patterns = [
    { regex: /```[\s\S]*?```/g, token: 'CODE_BLOCK' },
    { regex: /\$\$[\s\S]*?\$\$/g, token: 'MATH_BLOCK' },
    { regex: /\$[^$]+\$/g, token: 'INLINE_MATH' },
    { regex: /https?:\/\/[^\s)]+/g, token: 'URL' },
    { regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, token: 'EMAIL' },
    { regex: /10\.\d{4,9}\/[\w.-]+/g, token: 'DOI' },
    { regex: /\[[0-9]+\]/g, token: 'CITATION' },
    { regex: /^References[\s\S]*$/gim, token: 'REFERENCES' }
  ];

  patterns.forEach(({ regex, token }) => {
    safeText = safeText.replace(regex, (match) => {
      const replacement = `__${token}_${replacements.length}__`;
      replacements.push(match);
      return replacement;
    });
  });

  return { text: safeText, replacements };
}

function restoreSensitiveContent(text, replacements) {
  let restored = text;
  replacements.forEach((value, index) => {
    restored = restored.replace(new RegExp(`__[^_]+_${index}__`, 'g'), value);
  });
  return restored;
}

function translateWithLocalHeuristic(text) {
  const dictionary = {
    document: 'tài liệu',
    file: 'tệp',
    page: 'trang',
    section: 'phần',
    chapter: 'chương',
    table: 'bảng',
    image: 'hình ảnh',
    title: 'tiêu đề',
    content: 'nội dung',
    summary: 'tóm tắt',
    introduction: 'mở đầu',
    conclusion: 'kết luận',
    translation: 'dịch',
    translated: 'đã dịch',
    english: 'tiếng Anh',
    vietnamese: 'tiếng Việt',
    language: 'ngôn ngữ',
    text: 'văn bản',
    paragraph: 'đoạn văn',
    list: 'danh sách',
    bullet: 'dấu chấm',
    data: 'dữ liệu',
    system: 'hệ thống',
    model: 'mô hình',
    user: 'người dùng',
    api: 'api',
    code: 'mã',
    example: 'ví dụ',
    error: 'lỗi',
    result: 'kết quả',
    output: 'đầu ra',
    input: 'đầu vào',
    method: 'phương pháp',
    value: 'giá trị',
    version: 'phiên bản',
    this: 'điều này',
    that: 'điều đó',
    is: 'là',
    are: 'là',
    and: 'và',
    or: 'hoặc',
    with: 'với',
    for: 'cho',
    from: 'từ',
    into: 'vào',
    to: 'đến',
    of: 'của',
    in: 'trong',
    on: 'trên',
    by: 'bởi',
    at: 'tại',
    be: 'là',
    can: 'có thể',
    use: 'sử dụng',
    using: 'sử dụng',
    not: 'không',
    will: 'sẽ',
    should: 'nên',
    have: 'có',
    has: 'có',
    been: 'đã',
    the: 'the',
    a: 'một',
    an: 'một',
    your: 'của bạn',
    our: 'của chúng ta',
    we: 'chúng ta',
    you: 'bạn',
    they: 'họ',
    it: 'nó'
  };

  return text
    .split(/(\s+|[.,;:!?()\[\]{}"'`/]+)/)
    .map((token) => {
      if (!token || /\s+/.test(token) || /^[-.,;:!?()\[\]{}"'`/]+$/.test(token)) {
        return token;
      }

      const normalized = token.toLowerCase();
      return dictionary[normalized] || token;
    })
    .join('');
}

async function translateWithHuggingFace(text) {
  const response = await fetch(`https://api-inference.huggingface.co/models/${CONFIG.HF_MODEL}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(CONFIG.HF_API_KEY ? { Authorization: `Bearer ${CONFIG.HF_API_KEY}` } : {})
    },
    body: JSON.stringify({
      inputs: text,
      parameters: {
        max_length: 512,
        truncation: true
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HuggingFace API trả về lỗi ${response.status}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    return data[0]?.translation_text || data[0]?.generated_text || '';
  }

  return data?.translation_text || data?.generated_text || '';
}

async function translateWithLibreTranslate(text) {
  const endpoint = CONFIG.LIBRETRANSLATE_ENDPOINT || 'https://libretranslate.com/translate';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q: text,
      source: 'en',
      target: 'vi',
      format: 'text'
    })
  });

  if (!response.ok) {
    throw new Error(`LibreTranslate API trả về lỗi ${response.status}`);
  }

  const data = await response.json();
  return data?.translatedText || '';
}

async function translateChunk(text) {
  const { text: safeText, replacements } = protectSensitiveContent(text);
  const cacheKey = await hashText(text);
  const storageKey = `${CONFIG.CACHE_PREFIX}:${cacheKey}`;

  try {
    const cachedRaw = localStorage.getItem(storageKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      return cached.text;
    }
  } catch (error) {
    console.warn('Không thể đọc cache, bỏ qua.', error);
  }

  let lastError;
  for (let attempt = 0; attempt < CONFIG.MAX_RETRIES; attempt += 1) {
    try {
      let translatedText = '';
      try {
        translatedText = await translateWithHuggingFace(safeText);
      } catch (error) {
        try {
          translatedText = await translateWithLibreTranslate(safeText);
        } catch (fallbackError) {
          translatedText = translateWithLocalHeuristic(safeText);
          console.warn('Dùng fallback cục bộ cho chunk vì dịch mạng thất bại.', fallbackError);
        }
      }

      const restoredText = restoreSensitiveContent(translatedText, replacements);

      try {
        localStorage.setItem(storageKey, JSON.stringify({ text: restoredText }));
      } catch (error) {
        console.warn('Không thể lưu cache.', error);
      }

      return restoredText;
    } catch (error) {
      lastError = error;
      if (attempt < CONFIG.MAX_RETRIES - 1) {
        await sleep((attempt + 1) * (CONFIG.RETRY_DELAY_MS || 1200));
      }
    }
  }

  console.error('Dịch chunk thất bại sau nhiều lần thử.', lastError);
  return translateWithLocalHeuristic(text);
}

export async function translateText(text) {
  const [translated] = await translateBatch([text]);
  return translated || text;
}

export async function translateBatch(texts) {
  const translatedTexts = [];
  for (const item of texts.filter(Boolean)) {
    translatedTexts.push(await translateChunk(item));
  }
  return translatedTexts;
}

export async function translateSegments(segments, onProgress) {
  const normalizedSegments = segments.filter(Boolean);
  const chunkList = normalizedSegments.flatMap((segment) => splitTextIntoChunks(segment));
  const translatedResult = [];
  const total = chunkList.length;

  for (let index = 0; index < chunkList.length; index += 1) {
    const translatedText = await translateChunk(chunkList[index]);
    translatedResult.push(translatedText);
    const percent = Math.round(((index + 1) / Math.max(1, total)) * 100);
    onProgress?.(`Đang dịch đoạn ${index + 1}/${total}`, 35 + percent * 0.6);
    await sleep(400);
  }

  return translatedResult;
}
